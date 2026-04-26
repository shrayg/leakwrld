import { UploadForm } from "@/app/(site)/upload/upload-form";

export default function UploadPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-bold">Upload Studio</h1>
      <p className="text-sm text-[var(--text-2)]">
        Source uploads go into the raw bucket by category folder. Worker generates a 720p sibling file in the same folder.
      </p>
      <UploadForm />
    </div>
  );
}
