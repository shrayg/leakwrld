/** Embeds standalone admin UI from `client/public/admin-panel.html` (Vite → `/admin-panel.html`). */
export function AdminPage() {
  return (
    <iframe
      title="Admin"
      src="/admin-panel.html"
      style={{
        position: 'fixed',
        inset: 0,
        border: 'none',
        width: '100%',
        height: '100%',
        zIndex: 100000,
        background: '#0a0a0f',
      }}
    />
  );
}
