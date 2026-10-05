import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// App surfaces require sign-in; marketing + auth + blog stay public.
const isAppRoute = createRouteMatcher([
  "/picks(.*)",
  "/calendar(.*)",
  "/analytics(.*)",
  "/onboarding(.*)",
  "/settings(.*)",
  "/admin(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  // An invitation link carries __clerk_ticket to whatever redirect_url the
  // invitation was created with. Only <SignUp/> can redeem a ticket, and every
  // app route is behind auth.protect(), so a ticket aimed anywhere else bounced
  // the invited tester to sign-in and the invitation stayed pending forever.
  // Send any ticket to the one page that can spend it, whatever it was aimed at.
  const ticket = req.nextUrl.searchParams.get("__clerk_ticket");
  if (ticket && req.nextUrl.pathname !== "/signup") {
    const url = req.nextUrl.clone();
    url.pathname = "/signup";
    return NextResponse.redirect(url);
  }
  if (isAppRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static assets
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
