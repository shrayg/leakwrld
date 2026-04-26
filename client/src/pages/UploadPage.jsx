import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchMe } from '../api/client';
import { PageHero } from '../components/layout/PageHero';

export function UploadPage() {
  const [me, setMe] = useState(null);
  const [category, setCategory] = useState('');
  const [subfolder, setSubfolder] = useState('');
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState({ kind: '', text: '' });
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ i: 0, n: 0, label: '' });

  useEffect(() => {
    document.title = 'Upload — Pornyard';
    let cancelled = false;
    (async () => {
      const r = await fetchMe();
      if (cancelled) return;
      if (r.ok && r.data?.authed) setMe(r.data);
      else setMe(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isOmegle = false;

  function addFiles(fileList) {
    const next = [...rows];
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      if (
        !f.type.startsWith('video/') &&
        !f.name.match(/\.(mp4|webm|mov|avi|mkv|wmv|flv|m4v|3gp|mpg|mpeg|ts|vob|ogv)$/i)
      ) {
        continue;
      }
      const baseName = f.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').trim();
      next.push({ file: f, title: baseName.slice(0, 40) });
    }
    setRows(next);
  }

  const ready =
    rows.length > 0 &&
    category &&
    rows.every((r) => r.title.trim().length > 0) &&
    (!isOmegle || subfolder);

  async function onSubmit(e) {
    e.preventDefault();
    if (!ready || uploading) return;
    setUploading(true);
    setStatus({ kind: '', text: '' });
    const total = rows.length;
    let ok = 0;
    let fail = 0;

    for (let i = 0; i < total; i++) {
      const item = rows[i];
      let shortName = item.title.trim() || item.file.name;
      if (shortName.length > 25) shortName = shortName.slice(0, 22) + '...';
      setProgress({ i: i + 1, n: total, label: shortName });

      const fd = new FormData();
      fd.append('video', item.file);
      fd.append('name', item.title.trim());
      fd.append('category', category);
      if (isOmegle && subfolder) fd.append('subfolder', subfolder);

      let retries = 0;
      let done = false;
      while (retries < 3 && !done) {
        try {
          const r = await fetch('/api/upload', { method: 'POST', credentials: 'include', body: fd });
          if (r.status === 429) {
            const d = await r.json().catch(() => ({}));
            const wait = (d.retryAfter || 12) * 1000;
            await new Promise((res) => setTimeout(res, wait));
            retries++;
            continue;
          }
          if (!r.ok) {
            fail++;
            done = true;
          } else {
            ok++;
            done = true;
          }
        } catch {
          fail++;
          done = true;
        }
      }
      if (!done) fail++;
    }

    setRows([]);
    setUploading(false);
    setProgress({ i: 0, n: 0, label: '' });

    if (fail === 0) {
      setStatus({ kind: 'success', text: `Uploaded ${ok} video${ok !== 1 ? 's' : ''} successfully.` });
    } else {
      setStatus({
        kind: 'error',
        text: `Finished with errors: ${ok} ok, ${fail} failed.`,
      });
    }
  }

  if (me === null) {
    return (
      <div className="page-content upload-route">
        <div className="page-shell upload-wrap">
          <p className="page-loading">Checking session…</p>
        </div>
      </div>
    );
  }

  if (me === false) {
    return (
      <div className="page-content upload-route">
        <PageHero title="Upload video" subtitle="Log in to submit videos to the library." />
        <div className="page-shell upload-wrap">
          <div className="upload-gate">
            <p>Please log in to upload.</p>
            <Link to="/login" className="upload-gate-btn">
              Log In
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content upload-route">
      <PageHero title="Upload video" subtitle="Pick a category, attach files, and push to the library." />
      <div className="page-shell upload-wrap">
        <form id="upload-form" onSubmit={onSubmit}>
        <div className="upload-field">
          <label htmlFor="upload-category">Category</label>
          <select
            id="upload-category"
            name="category"
            required
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              if (e.target.value !== 'Omegle') setSubfolder('');
            }}
          >
            <option value="" disabled>
              Select a category
            </option>
            <option value="NSFW Straight">NSFW Straight</option>
            <option value="Alt and Goth">Alt and Goth</option>
            <option value="Petitie">Petitie</option>
            <option value="Teen (18+ only)">Teen (18+ only)</option>
            <option value="MILF">MILF</option>
            <option value="Asian">Asian</option>
            <option value="Ebony">Ebony</option>
            <option value="Hentai">Hentai</option>
            <option value="Yuri">Yuri</option>
            <option value="Yaoi">Yaoi</option>
            <option value="Nip Slips">Nip Slips</option>
            <option value="Omegle">Omegle</option>
            <option value="OF Leaks">OF Leaks</option>
            <option value="Premium Leaks">Premium Leaks</option>
          </select>
        </div>

        <div className="upload-field">
          <label>Select Videos</label>
          <div
            className="upload-dropzone"
            onClick={() => document.getElementById('upload-files')?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              e.currentTarget.classList.add('dragover');
            }}
            onDragLeave={(e) => e.currentTarget.classList.remove('dragover')}
            onDrop={(e) => {
              e.preventDefault();
              e.currentTarget.classList.remove('dragover');
              addFiles(e.dataTransfer.files);
            }}
          >
            <div className="upload-dropzone-text">
              {rows.length ? `${rows.length} video${rows.length !== 1 ? 's' : ''} selected` : 'Click to select videos or drag them here'}
            </div>
            <div className="upload-dropzone-sub">{rows.length ? 'Click to add more' : 'All video formats accepted'}</div>
          </div>
          <input
            type="file"
            id="upload-files"
            multiple
            accept="video/*"
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        <div id="upload-video-list" className="upload-video-list">
          {rows.map((row, idx) => (
            <div key={idx} className="upload-video-row">
              <div className="upload-video-row-info">
                <span className="upload-video-row-name">{row.file.name}</span>
                <span className="upload-video-row-size">{(row.file.size / (1024 * 1024)).toFixed(1)} MB</span>
              </div>
              <input
                type="text"
                className="upload-video-row-title"
                placeholder="Video title"
                maxLength={40}
                required
                value={row.title}
                onChange={(e) => {
                  const copy = [...rows];
                  copy[idx] = { ...copy[idx], title: e.target.value };
                  setRows(copy);
                }}
              />
              <button
                type="button"
                className="upload-video-row-remove"
                onClick={() => setRows(rows.filter((_, j) => j !== idx))}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <button type="submit" className="upload-submit-btn" disabled={!ready || uploading}>
          {uploading ? 'Uploading…' : rows.length > 1 ? `Upload All (${rows.length} videos)` : 'Upload'}
        </button>

        {uploading && (
          <div className="upload-progress">
            <div className="upload-progress-bar">
              <div
                className="upload-progress-fill"
                style={{ width: `${progress.n ? Math.round(((progress.i - 1) / progress.n) * 100) : 0}%` }}
              />
            </div>
            <div className="upload-progress-text">
              Uploading &quot;{progress.label}&quot; ({progress.i}/{progress.n})
            </div>
          </div>
        )}

        {status.kind && (
          <div className={'upload-status ' + status.kind}>{status.text}</div>
        )}
      </form>
      </div>
    </div>
  );
}
