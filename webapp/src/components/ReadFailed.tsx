"use client";

/** What a screen shows when the read didn't get through.

    The failure it exists for is specific: `loadChannelData` used to hand back
    an empty object whether the account was new or Supabase was unreachable, so
    a connected creator with a network problem was told to connect a channel
    they had already connected. Every surface that reads channel data branches
    here first, on the `failed` marker, before any "you have nothing yet" copy
    can run. */

export function readFailed(data: { failed: boolean } | null | undefined): boolean {
  return Boolean(data?.failed);
}

export function ReadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="card">
      <div className="err">
        Couldn&apos;t reach your numbers just now, so nothing here would be true. Nothing is lost —
        your channel and your Ledger are untouched.
      </div>
      <button className="btn btn-acc btn-sm" onClick={onRetry}>Try again</button>
    </div>
  );
}
