import { auth, clerkClient } from "@clerk/nextjs/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { GUEST } from "@/lib/site";

/** Guest invites (convex/guests.ts). Clerk sends the email and owns the sign-up
 *  link; Convex decides who gets one and enforces the cap of GUEST.cap. Every
 *  call is gated on the operator flag in Convex, so a stolen session on a
 *  normal account can't invite anyone. */

async function operatorToken(): Promise<string | null> {
  const { getToken, userId } = await auth();
  if (!userId) return null;
  const token = await getToken({ template: "convex" });
  if (!token) return null;
  return (await fetchQuery(api.admin.amIAdmin, {}, { token })) ? token : null;
}

async function requireOperator() {
  return (await operatorToken()) !== null;
}

/** The sentence from a Convex "GUEST|reason|message" error, or null. */
function guestError(err: unknown): string | null {
  const data = (err as { data?: unknown })?.data;
  const text = typeof data === "string" ? data : err instanceof Error ? err.message : "";
  const m = /GUEST\|[a-z_]+\|([^\n]*)/.exec(text);
  return m ? m[1].trim() : null;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://manfriday.app";

export async function GET() {
  if (!(await requireOperator())) return Response.json({ error: "not allowed" }, { status: 403 });
  const client = await clerkClient();
  const list = await client.invitations.getInvitationList({ limit: 50 });
  return Response.json({
    invitations: list.data.map((i) => ({
      id: i.id,
      email: i.emailAddress,
      status: i.status,
      createdAt: i.createdAt,
    })),
  });
}

/** Invite a guest. Body: { email, notify? }. notify:false creates the invite
 *  without Clerk's email and returns the sign-up link to pass on by hand. */
export async function POST(req: Request) {
  const token = await operatorToken();
  if (!token) return Response.json({ error: "not allowed" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { email?: unknown; notify?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const notify = body?.notify !== false;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Response.json({ error: "that isn't an email address" }, { status: 400 });

  // 1. Take a guest slot (refuses the 11th, and existing accounts). Nothing is sent yet.
  try {
    await fetchMutation(api.guests.reserve, { email }, { token });
  } catch (err) {
    return Response.json({ error: guestError(err) ?? "couldn't reserve a guest slot" }, { status: 409 });
  }
  // 2. Clerk creates the invite (and emails it unless notify is false).
  try {
    const client = await clerkClient();
    const invitation = await client.invitations.createInvitation({
      emailAddress: email,
      // Must land on the page that renders <SignUp/> — that is what redeems the ticket.
      redirectUrl: `${APP_URL}/signup`,
      notify,
      ignoreExisting: true,
      expiresInDays: GUEST.inviteDays,
    });
    return Response.json({
      id: invitation.id,
      email: invitation.emailAddress,
      status: invitation.status,
      emailed: notify,
      url: notify ? null : (invitation.url ?? null),
    });
  } catch (err) {
    await fetchMutation(api.guests.release, { email }, { token }).catch(() => undefined);
    const message = err instanceof Error ? err.message : "invite failed";
    return Response.json({ error: message.slice(0, 200) }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const token = await operatorToken();
  if (!token) return Response.json({ error: "not allowed" }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "missing id" }, { status: 400 });
  const client = await clerkClient();
  const revoked = await client.invitations.revokeInvitation(id);
  // A revoked invite frees its guest slot.
  await fetchMutation(api.guests.release, { email: revoked.emailAddress }, { token }).catch(() => undefined);
  return Response.json({ revoked: id });
}
