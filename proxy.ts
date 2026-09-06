import { clerkMiddleware } from "@clerk/nextjs/server";

// No protected routes yet — marketing + waitlist are public. Route protection
// arrives with the app surfaces in M2 (picks/calendar/analytics/settings).
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and static assets
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
