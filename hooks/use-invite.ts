"use client";

// The counter's inscription QR code. The bridge mints the link, the database kills it on first use,
// and this hook simply keeps the screen showing whichever link is alive right now.
import { useCallback, useEffect, useState } from "react";
import { fetchInvite, type Invite } from "@/lib/bridge-client";

export function useInvite(pollMs = 4000) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [renewing, setRenewing] = useState(false);

  const load = useCallback(async (fresh: boolean) => {
    const result = await fetchInvite(fresh);
    if (typeof result === "string") {
      setError(result);
      setInvite(null);
    } else {
      setError(null);
      setInvite((current) => (current && current.token === result.token ? current : result));
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    const tick = () => {
      if (!stopped) void load(false);
    };
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, pollMs);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [pollMs, load]);

  // Counted down on the screen so the staff sees at a glance whether the QR is still worth scanning.
  useEffect(() => {
    if (!invite) return;
    const tick = () => setRemainingMs(Math.max(0, invite.expiresAt - Date.now()));
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [invite]);

  const renew = useCallback(async () => {
    setRenewing(true);
    try {
      await load(true);
    } finally {
      setRenewing(false);
    }
  }, [load]);

  return { invite, error, remainingMs: invite ? remainingMs : null, renewing, renew };
}
