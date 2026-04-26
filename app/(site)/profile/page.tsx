import { Card } from "@/components/ui/card";

export default function ProfilePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Profile</h1>
      <Card>
        <h2 className="text-sm font-semibold">Creator channel</h2>
        <p className="mt-1 text-sm text-[var(--text-2)]">Subscriptions, playlists, strikes, and moderation statuses render here.</p>
      </Card>
    </div>
  );
}
