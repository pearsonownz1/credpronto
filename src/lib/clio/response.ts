import { NextResponse } from "next/server";

export function redirectPrivate(location: string): NextResponse {
  const response = NextResponse.redirect(location, 302);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
