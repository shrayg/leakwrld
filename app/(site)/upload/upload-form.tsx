"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { platformCategories } from "@/lib/categories";

export function UploadForm() {
  const [ownerId, setOwnerId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categorySlug, setCategorySlug] = useState<string>(platformCategories[0].slug);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");

  async function onSubmit() {
    if (!file) {
      setStatus("Select a video file first.");
      return;
    }
    setStatus("Creating signed upload...");
    const response = await fetch("/api/videos/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId,
        categorySlug,
        title,
        description,
        fileName: file.name,
        fileSizeBytes: file.size,
        mimeType: file.type || "video/mp4",
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      setStatus(data.error ?? "Unable to create upload URL");
      return;
    }

    setStatus("Uploading source file to R2...");
    const uploadResponse = await fetch(data.uploadUrl, {
      method: "PUT",
      headers: {
        "content-type": file.type || "video/mp4",
      },
      body: file,
    });

    if (!uploadResponse.ok) {
      setStatus("R2 upload failed");
      return;
    }

    setStatus(`Uploaded. Video ${data.videoId} is queued for 720p transcode.`);
  }

  return (
    <div className="space-y-3 rounded-[12px] border border-[var(--border-1)] bg-[var(--surface-2)] p-4">
      <Input
        placeholder="Owner profile UUID"
        value={ownerId}
        onChange={(event) => setOwnerId(event.target.value)}
      />
      <Input
        placeholder="Video title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <Textarea
        placeholder="Description"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <label className="text-sm text-[var(--text-2)]" htmlFor="category">
        Category
      </label>
      <select
        id="category"
        className="h-10 w-full rounded-[10px] border border-[var(--border-1)] bg-[var(--surface-3)] px-3 text-sm"
        value={categorySlug}
        onChange={(event) => setCategorySlug(event.target.value)}
      >
        {platformCategories.map((category) => (
          <option key={category.slug} value={category.slug}>
            {category.label}
          </option>
        ))}
      </select>
      <Input
        type="file"
        accept="video/*"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <Button onClick={onSubmit}>Upload to raw bucket</Button>
      {status ? <p className="text-xs text-[var(--text-2)]">{status}</p> : null}
    </div>
  );
}
