import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

/** One-click unsubscribe from the footer of every product email. No sign-in:
 *  the token in the link is the proof, which is what makes it one click. */
async function handle(req: Request) {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  let ok = false;
  try {
    ok = token ? await fetchMutation(api.email.unsubscribe, { token }) : false;
  } catch {
    ok = false;
  }
  const message = ok
    ? "You're unsubscribed. Friday won't email you again. You can turn emails back on in Settings."
    : "That link has expired. Turn emails off in Settings instead.";
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Email preferences · Man Friday</title>
<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:480px;margin:18vh auto;padding:0 24px;line-height:1.6;color:#14131a">
<p style="font-size:13px;letter-spacing:.12em;color:#6b6880;margin:0 0 10px">MAN FRIDAY</p>
<p style="font-size:18px;margin:0 0 18px">${message}</p>
<a href="https://manfriday.app/settings" style="color:#ff4d6d">Open Settings →</a>
</div>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export const GET = handle;
export const POST = handle;
