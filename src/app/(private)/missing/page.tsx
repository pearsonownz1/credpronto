import { notFound } from "next/navigation";

/** Static 404 target. Proxy rewrites unknown order and preview links here before streaming. */
export default function MissingOrderPage() {
  notFound();
}
