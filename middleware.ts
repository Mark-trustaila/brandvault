import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { PUBLIC_ROUTE_PATTERNS } from './lib/public-routes';

// The list itself lives in lib/public-routes.ts, with a comment per entry
// explaining why it needs no session. Everything else requires auth.
const isPublicRoute = createRouteMatcher([...PUBLIC_ROUTE_PATTERNS]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Run on everything except Next internals and static files...
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|gif|png|svg|ico|webp|woff2?|ttf|map)).*)',
    // ...and always on API routes.
    '/(api|trpc)(.*)',
  ],
};
