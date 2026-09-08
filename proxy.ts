import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// App surfaces require sign-in; marketing + auth + blog stay public.
const isAppRoute = createRouteMatcher([
  "/picks(.*)",
  "/calendar(.*)",
  "/analytics(.*)",
  "/onboarding(.*)",
  "/settings(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
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
