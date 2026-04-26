"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

const KEY = "pw_age_gate_v1";

export function AgeGate() {
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return !window.localStorage.getItem(KEY);
  });

  const confirm = () => {
    window.localStorage.setItem(KEY, "accepted");
    setOpen(false);
  };

  return (
    <Modal open={open} onClose={() => {}} title="Age confirmation required">
      <p className="mb-4 text-sm text-[var(--text-2)]">
        This service is intended for adults only. Confirm you are at least 18 years old and comply with local laws.
      </p>
      <div className="flex gap-2">
        <Button onClick={confirm}>I am 18+</Button>
        <Button variant="secondary" onClick={() => (window.location.href = "https://www.google.com")}>
          Leave site
        </Button>
      </div>
    </Modal>
  );
}
