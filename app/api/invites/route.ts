import { auth, clerkClient } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

/** Beta invites. Clerk sends the email and owns the sign-up link; we only decide
 *  who gets one. Every call is gated on the operator flag in Convex, so a stolen
 *  session on a normal account can't invite anyone. */

async function requireOperator() {
  const { getToken, userId } = await auth();
  if (!userId) return false;
  const token = await getToken({ template: "convex" });
  if (!token) return false;
  return await fetchQuery(api.admin.amIAdmin, {}, { token });
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

export async function POST(req: Request) {
  if (!(await requireOperator())) return Response.json({ error: "not allowed" }, { status: 403 });
  const body: unknown = await req.json().catch(() => null);
  const email = typeof (body as { email?: unknown })?.email === "string" ? (body as { email: string }).email.trim() : "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Response.json({ error: "that isn't an email address" }, { status: 400 });
  try {
    const client = await clerkClient();
    const invitation = await client.invitations.createInvitation({
      emailAddress: email,
      redirectUrl: `${APP_URL}/onboarding`,
      notify: true,
      ignoreExisting: true,
    });
    return Response.json({ id: invitation.id, email: invitation.emailAddress, status: invitation.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "invite failed";
    return Response.json({ error: message.slice(0, 200) }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  if (!(await requireOperator())) return Response.json({ error: "not allowed" }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "missing id" }, { status: 400 });
  const client = await clerkClient();
  await client.invitations.revokeInvitation(id);
  return Response.json({ revoked: id });
}
