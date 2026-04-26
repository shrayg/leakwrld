"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

const KEY = "pw_cookie_consent_v1";

export function CookieConsent() {
  const [visible, setVisible] = useState(() => {
    if (typeof window === "undefined") return false;
    return !window.localStorage.getItem(KEY);
  });

  const setConsent = (value: "essential" | "all") => {
    window.localStorage.setItem(KEY, value);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-16 left-3 right-3 z-40 rounded-[10px] border border-[var(--border-1)] bg-[var(--surface-2)] p-3 shadow-[0_8px_30px_rgba(0,0,0,0.35)] md:bottom-4 md:left-4 md:right-auto md:w-[380px]">
      <p className="mb-3 text-xs text-[var(--text-2)]">
        We use essential cookies for security and optional analytics cookies to improve feed quality.
      </p>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => setConsent("all")}>
          Accept all
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setConsent("essential")}>
          Essential only
        </Button>
      </div>
    </div>
  );
}
