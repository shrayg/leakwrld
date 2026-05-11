import { ClipboardCopy } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useAuth } from './AuthContext';
import { isAdminAccountTier } from '../lib/media';

/**
 * Admin-only: copies the R2 / manifest object key (e.g. `videos/slug/free/...`).
 * Renders nothing for non-admins or while auth is loading — no key in the DOM for others.
 *
 * @param {{ storageKey: string | null | undefined, variant?: 'tile' | 'lightbox' | 'short' | 'hero' }} props
 */
export function AdminCopyStorageKeyButton({ storageKey, variant = 'tile' }) {
  const { user, loading } = useAuth();
  const [copied, setCopied] = useState(false);

  const key = String(storageKey || '').trim();
  const isAdmin = !loading && user && isAdminAccountTier(user.tier);

  const onCopy = useCallback(
    async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!key) return;
      try {
        await navigator.clipboard.writeText(key);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      } catch {
        /* clipboard unavailable */
      }
    },
    [key],
  );

  if (!isAdmin || !key) return null;

  const variantClass =
    variant === 'lightbox'
      ? 'lw-admin-copy-storage-key lw-admin-copy-storage-key--lightbox'
      : variant === 'short'
        ? 'lw-admin-copy-storage-key lw-admin-copy-storage-key--short'
        : variant === 'hero'
          ? 'lw-admin-copy-storage-key lw-admin-copy-storage-key--hero'
          : 'lw-admin-copy-storage-key lw-admin-copy-storage-key--tile';

  return (
    <button
      type="button"
      className={variantClass}
      title={key}
      aria-label="Copy R2 object key (admin)"
      onClick={onCopy}
    >
      <ClipboardCopy size={14} aria-hidden />
      <span className="lw-admin-copy-storage-key-label">{copied ? 'Copied' : 'Copy key'}</span>
    </button>
  );
}
