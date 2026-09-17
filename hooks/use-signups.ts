"use client";

// Client sign-ups filled on phones at the bridge's /inscription form. Polled from the bridge,
// which only serves them to this PC.
import { useCallback, useEffect, useState } from "react";
import { fetchSignups, setSignupStatus, signupFormUrl, type Signup } from "@/lib/bridge-client";

export function useSignups(pollMs = 5000) {
  const [signups, setSignups] = useState<Signup[]>([]);
  const [formUrl, setFormUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "offline">("loading");

  const reload = useCallback(async () => {
    try {
      const list = await fetchSignups();
      setSignups(list);
      setState("ready");
    } catch {
      setState("offline");
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    const tick = () => {
      if (!stopped) void reload();
    };
    tick();
    void signupFormUrl().then((url) => {
      if (!stopped) setFormUrl(url);
    });
    const timer = window.setInterval(tick, pollMs);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [pollMs, reload]);

  const update = useCallback(
    async (id: string, status: Signup["status"]) => {
      setSignups((list) => list.map((s) => (s.id === id ? { ...s, status } : s)));
      await setSignupStatus(id, status);
      void reload();
    },
    [reload],
  );

  return { signups, formUrl, state, reload, update };
}
