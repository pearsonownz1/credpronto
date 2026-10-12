import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/redirect";
import { waitsForCheckoutOrder } from "@/lib/orders/checkout-return";
import { publicOrderSegment } from "@/lib/orders/public-order";
import { publicOrderExists } from "@/lib/orders/public-order-server";
import { isOrderId, isOrderToken } from "@/lib/orders/token";
import { ROBOTS_NOINDEX } from "@/lib/seo";
import { updateSession } from "@/lib/supabase/proxy";

const PRIVATE_NO_STORE = "private, no-store";

function isDashboardPath(pathname: string): boolean {
  return pathname === "/dashboard" || pathname.startsWith("/dashboard/");
}

function signInRedirect(request: NextRequest): NextResponse {
  const next = safeNextPath(`${request.nextUrl.pathname}${request.nextUrl.search}`, "/dashboard");
  const url = request.nextUrl.clone();
  url.pathname = "/sign-in";
  url.search = "";
  url.searchParams.set("next", next);
  const response = NextResponse.redirect(url, 307);
  response.headers.set("Cache-Control", PRIVATE_NO_STORE);
  return response;
}

function withPrivateRobots(response: NextResponse, pathname: string): NextResponse {
  if (pathname === "/preview" || pathname.startsWith("/preview/") || pathname === "/order" || pathname.startsWith("/order/")) {
    response.headers.set("X-Robots-Tag", ROBOTS_NOINDEX);
  }
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = publicOrderSegment(pathname);
  if (token != null && isOrderId(token)) {
    const session = await updateSession(request);
    if (!session.signedIn) {
      const redirect = signInRedirect(request);
      for (const cookie of session.response.headers.getSetCookie()) {
        redirect.headers.append("set-cookie", cookie);
      }
      return withPrivateRobots(redirect, pathname);
    }
    session.response.headers.set("Cache-Control", PRIVATE_NO_STORE);
    return withPrivateRobots(session.response, pathname);
  }

  if (token != null) {
    const checkout = request.nextUrl.searchParams.get("checkout");
    // A checkout return can beat the webhook. Leave the token in the URL and let the page retry.
    const waitForOrder = isOrderToken(token) && waitsForCheckoutOrder(checkout);
    if (!waitForOrder) {
      try {
        if (!isOrderToken(token) || !(await publicOrderExists(token))) {
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
  }

  const session = await updateSession(request);
  if (isDashboardPath(pathname)) {
    // Cache Components would stream a public shell before the layout redirect,
    // so a signed-out document request stayed 200. Redirect before that shell.
    if (!session.signedIn) {
      const redirect = signInRedirect(request);
      for (const cookie of session.response.headers.getSetCookie()) {
        redirect.headers.append("set-cookie", cookie);
      }
      return withPrivateRobots(redirect, pathname);
    }
    session.response.headers.set("Cache-Control", PRIVATE_NO_STORE);
  }

  return withPrivateRobots(session.response, pathname);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
