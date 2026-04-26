"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";

export function ReportButton({ entityId }: { entityId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const submit = async () => {
    await fetch("/api/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityType: "video", entityId, reason }),
    });
    setOpen(false);
    setReason("");
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Report
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Report content">
        <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Describe the issue..." />
        <Button className="mt-3" onClick={submit}>
          Submit report
        </Button>
      </Modal>
    </>
  );
}
