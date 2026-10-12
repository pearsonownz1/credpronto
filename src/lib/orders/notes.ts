import { requireStaff } from "./staff";
import { getOrderById, insertEvent, insertOrderNote, listOrderNotes } from "./db";
import { HttpError } from "./errors";

export function parseNoteBody(body: unknown): string {
  if (!body || typeof body !== "object") throw new HttpError("Expected a JSON body", 400);
  const text = (body as { body?: unknown }).body;
  if (typeof text !== "string") throw new HttpError("body is required", 400);
  const trimmed = text.trim();
  if (trimmed.length < 1 || trimmed.length > 4000) {
    throw new HttpError("body must be 1 to 4000 characters", 400);
  }
  return trimmed;
}

export async function getOrderNotes(orderId: string) {
  const { db } = await requireStaff();
  const order = await getOrderById(db, orderId);
  if (!order) throw new HttpError("Order not found", 404);
  const notes = await listOrderNotes(db, order.id);
  return {
    notes: notes.map((note) => ({
      id: note.id,
      authorId: note.authorId,
      body: note.body,
      createdAt: note.createdAt,
    })),
  };
}

export async function addOrderNote(orderId: string, body: unknown) {
  const text = parseNoteBody(body);
  const { db, userId } = await requireStaff();
  const order = await getOrderById(db, orderId);
  if (!order) throw new HttpError("Order not found", 404);
  const note = await insertOrderNote(db, { orderId: order.id, authorId: userId, body: text });
  await insertEvent(db, order.id, "note_added", { noteId: note.id });
  return {
    id: note.id,
    authorId: note.authorId,
    body: note.body,
    createdAt: note.createdAt,
  };
}
