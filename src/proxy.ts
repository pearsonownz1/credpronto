import { NextResponse, type NextRequest } from "next/server";
import { publicOrderSegment } from "@/lib/orders/public-order";
import { publicOrderExists } from "@/lib/orders/public-order-server";
import { ROBOTS_NOINDEX } from "@/lib/seo";
import { updateSession } from "@/lib/supabase/proxy";

function withPrivateRobots(response: NextResponse, pathname: string): NextResponse {
  if (pathname === "/preview" || pathname.startsWith("/preview/") || pathname === "/order" || pathname.startsWith("/order/")) {
    response.headers.set("X-Robots-Tag", ROBOTS_NOINDEX);
  }
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = publicOrderSegment(pathname);
  if (token != null) {
    try {
      if (!(await publicOrderExists(token))) {
        // Cache Components streams a shell before notFound(), which would stay
        // 200. Rewrite to the static notFound() page before that shell starts.
        const url = request.nextUrl.clone();
        url.pathname = "/missing";
        url.search = "";
        return withPrivateRobots(NextResponse.rewrite(url), pathname);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : "order lookup failed");
    }
  }

  return withPrivateRobots(await updateSession(request), pathname);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
