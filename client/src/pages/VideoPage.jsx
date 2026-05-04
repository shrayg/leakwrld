import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CustomVideoPlayer } from '../components/video/CustomVideoPlayer';
import {
  fetchComments,
  fetchRelatedRecommendations,
  fetchVideoStats,
  postComment,
  postVideoStats,
} from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useShell } from '../context/ShellContext';
import { folderToCleanUrl } from '../lib/cleanUrls';
import { isTierLockedVideo } from '../constants/lockedVideos';
import { seoCleanTitle } from '../lib/seoTitle';
import { formatTimeAgo } from '../lib/time';
import { PageHero } from '../components/layout/PageHero';
import { buildVideoId, sendTelemetry } from '../lib/telemetry';

const VAULT_FOLDERS = ['free', 'basic', 'premium', 'ultimate', 'elite'];

function videoQuery(folder, name, subfolder, vault) {
  const q = new URLSearchParams();
  q.set('folder', folder);
  q.set('name', name);
  if (subfolder) q.set('subfolder', subfolder);
  if (vault) q.set('vault', vault);
  return '/video?' + q.toString();
}

export function VideoPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, isAuthed, tier, loading: authLoading } = useAuth();
  const { openAuth, openReferral } = useShell();

  const folder = params.get('folder') || '';
  const name = params.get('name') || '';
  const subfolder = params.get('subfolder') || '';
  const vault = params.get('vault') || '';

  const [stats, setStats] = useState(null);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [related, setRelated] = useState([]);

  const cleanTitle = useMemo(() => (name ? seoCleanTitle(name, folder) : ''), [name, folder]);
  const videoKey = useMemo(() => {
    if (!name) return '';
    const v = (vault || '').trim().toLowerCase();
    if (v && VAULT_FOLDERS.includes(v)) {
      return [folder, subfolder || '', v, name].join('|');
    }
    return name;
  }, [folder, subfolder, name, vault]);

  const mediaSrc = useMemo(() => {
    if (!folder || !name) return '';
    let s = '/media?folder=' + encodeURIComponent(folder) + '&name=' + encodeURIComponent(name);
    if (subfolder) s += '&subfolder=' + encodeURIComponent(subfolder);
    if (vault) s += '&vault=' + encodeURIComponent(vault);
    return s;
  }, [folder, name, subfolder, vault]);

  const previewSrc = useMemo(() => {
    if (!folder || !name) return '';
    let s = '/preview-media?folder=' + encodeURIComponent(folder) + '&name=' + encodeURIComponent(name);
    if (subfolder) s += '&subfolder=' + encodeURIComponent(subfolder);
    return s;
  }, [folder, name, subfolder]);

  const folderHref = useMemo(() => {
    const base = folderToCleanUrl(folder);
    return subfolder ? base + (base.includes('?') ? '&' : '?') + 'subfolder=' + encodeURIComponent(subfolder) : base;
  }, [folder, subfolder]);

  useEffect(() => {
    if (!folder || !name || !cleanTitle) return;
    document.title = cleanTitle + ' — ' + folder + ' | Pornwrld';
  }, [folder, name, cleanTitle]);

  useEffect(() => {
    if (!videoKey) return;
    fetchVideoStats(videoKey).then(({ ok, data }) => {
      if (ok && data) setStats(data);
    });
  }, [videoKey]);

  useEffect(() => {
    if (!videoKey) return;
    fetchComments(videoKey).then(({ ok, data }) => {
      const list = data?.comments || data;
      if (ok && Array.isArray(list)) setComments(list);
    });
  }, [videoKey]);

  useEffect(() => {
    if (!folder || !name) return;
    let cancelled = false;
    const currentVideoId = buildVideoId(folder, subfolder || '', name, vault);
    fetchRelatedRecommendations(currentVideoId, 8).then(({ ok, data }) => {
      if (cancelled || !ok || !Array.isArray(data?.files)) return;
      setRelated(data.files);
      data.files.forEach((f, idx) => {
        sendTelemetry('impression', {
          surface: 'video_related',
          slot: idx,
          rank: idx + 1,
          videoId:
            f.videoId ||
            buildVideoId(f.folder || folder, f.subfolder || '', f.name, f.vault),
          folder: f.folder || folder,
          subfolder: f.subfolder || '',
          name: f.name,
        });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [folder, name, subfolder, vault]);

  const onFirstPlay = useCallback(() => {
    postVideoStats({ videoKey, action: 'view' }).then(({ ok, data }) => {
      if (ok && data?.views !== undefined) {
        setStats((s) => ({ ...(s || {}), views: data.views, likes: data.likes, dislikes: data.dislikes }));
      }
    });
    sendTelemetry('video_progress', {
      surface: 'video',
      videoId: buildVideoId(folder, subfolder || '', name, vault),
      folder,
      subfolder,
      name,
      watchMs: 1000,
      percentWatched: 1,
    });
  }, [videoKey, folder, subfolder, name]);

  const onProgress = useCallback((progress) => {
    sendTelemetry('video_progress', {
      surface: 'video',
      videoId: buildVideoId(folder, subfolder || '', name, vault),
      folder,
      subfolder,
      name,
      positionSec: progress.positionSec,
      durationSec: progress.durationSec,
      percentWatched: progress.percentWatched,
      completed: progress.completed,
      watchMs: progress.watchMs,
    });
  }, [videoKey]);

  const updateStats = (d) => {
    setStats((prev) => ({
      ...(prev || {}),
      likes: d.likes,
      dislikes: d.dislikes,
      views: d.views ?? prev?.views,
      myVote: d.myVote,
    }));
  };

  const vote = (action) => {
    postVideoStats({ videoKey, action }).then((r) => {
      if (r.status === 401) {
        openAuth('login');
        return;
      }
      if (r.ok && r.data) updateStats(r.data);
    });
  };

  const ratingPct =
    (stats?.likes || 0) + (stats?.dislikes || 0) > 0
      ? Math.round(((stats?.likes || 0) / ((stats?.likes || 0) + (stats?.dislikes || 0))) * 100)
      : 50;

  const submitComment = () => {
    const text = commentText.trim();
    if (!text) return;
    postComment(videoKey, text).then(({ ok, data }) => {
      if (data?.error) {
        alert(data.error);
        return;
      }
      if (ok && data?.comment) {
        setCommentText('');
        setComments((c) => [{ ...data.comment, user: data.comment.user || 'You', ts: new Date().toISOString() }, ...c]);
        setStats((s) => ({
          ...(s || {}),
          commentCount: (s?.commentCount || 0) + 1,
        }));
      }
    });
  };

  if (!folder || !name) {
    return (
      <main className="page-content video-page pornwrld-video-fallback">
        <PageHero title="Video not found" subtitle="Check the link or browse from a category." align="start" />
        <Link to="/" className="pornwrld-inline-link-btn">
          Back to homepage
        </Link>
      </main>
    );
  }

  if (isTierLockedVideo(folder, name)) {
    return (
      <main className="page-content video-page pornwrld-video-fallback">
        <PageHero title="Tier required" subtitle="You need Tier 1 or Premium to view this video." align="start" />
        <Link to="/omegle-wins" className="pornwrld-inline-link-btn">
          Back
        </Link>
      </main>
    );
  }

  const showUnlock = !authLoading && (!isAuthed || (tier || 0) < 2);

  return (
    <div className="page-content video-page">
      <header className="video-page-toolbar" aria-label="Video navigation">
        <Link to={folderHref} className="video-page-back-btn">
          <svg
            className="video-page-back-btn__icon"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M15 18l-6-6 6-6"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="video-page-back-btn__label">Back</span>
        </Link>
        {showUnlock && (
          <button
            type="button"
            className="video-page-unlock-btn"
            onClick={() => {
              if (!isAuthed) openAuth('login');
              else openReferral();
            }}
          >
            Unlock more videos
          </button>
        )}
      </header>

      <div className="video-page-player-wrap" id="video-page-player-wrap">
        <CustomVideoPlayer
          mediaSrc={mediaSrc}
          previewSrc={previewSrc}
          folder={folder}
          name={name}
          subfolder={subfolder}
          onFirstPlay={onFirstPlay}
          onProgress={onProgress}
        />
      </div>

      <div className="video-page-info" id="video-page-info">
        <h1 className="video-page-title">{cleanTitle}</h1>
        <div className="video-page-meta">
          <button
            type="button"
            className="video-page-category"
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', font: 'inherit' }}
            onClick={() => navigate(folderHref)}
          >
            {folder + (subfolder ? ' — ' + subfolder : '')}
          </button>
          <span className="video-page-views">{(stats?.views ?? 0).toLocaleString()} views</span>
        </div>
        <div className="video-page-actions" id="video-page-actions">
          <div className="video-page-reactions-group">
            <div className="video-page-reactions-row">
              <button
                type="button"
                className={'video-page-like-btn' + (stats?.myVote === 'like' ? ' voted-like' : '')}
                id="video-page-like-btn"
                onClick={() => vote('like')}
              >
                👍 <span id="video-page-like-count">{stats?.likes ?? 0}</span>
              </button>
              <button
                type="button"
                className={'video-page-dislike-btn' + (stats?.myVote === 'dislike' ? ' voted-dislike' : '')}
                id="video-page-dislike-btn"
                onClick={() => vote('dislike')}
              >
                👎 <span id="video-page-dislike-count">{stats?.dislikes ?? 0}</span>
              </button>
            </div>
            <div className="video-page-rating-bar">
              <div className="video-page-rating-fill" id="video-page-rating-fill" style={{ width: `${ratingPct}%` }} />
            </div>
          </div>
          <button
            type="button"
            className="video-page-share-btn"
            id="video-page-share-btn"
            onClick={() => {
              const url = window.location.href;
              const toast = document.getElementById('video-share-toast');
              const done = () => {
                toast?.classList.add('visible');
                setTimeout(() => toast?.classList.remove('visible'), 2000);
              };
              if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(url).then(done).catch(() => {});
              }
            }}
          >
            Share
          </button>
        </div>
        <div className="video-share-toast" id="video-share-toast" aria-live="polite">
          Link copied!
        </div>
      </div>

      {related.length > 0 && (
      <div className="video-page-related" id="video-page-related">
        <h3>Related Videos</h3>
        <div className="video-page-related-grid" id="video-page-related-grid">
          {related.map((f) => {
            const rTitle = seoCleanTitle(f.name, folder);
            const href = videoQuery(folder, f.name, f.subfolder || subfolder || '', f.vault);
            return (
              <Link
                key={(f.videoKey || '') + f.name + (f.subfolder || '') + (f.vault || '')}
                to={href}
                className="video-page-related-card"
                onClick={(e) => {
                  sendTelemetry('click', {
                    surface: 'video_related',
                    videoId:
                      f.videoId ||
                      buildVideoId(f.folder || folder, f.subfolder || '', f.name, f.vault),
                    folder: f.folder || folder,
                    subfolder: f.subfolder || '',
                    name: f.name,
                  });
                  if (typeof window._pyPaywallCheck === 'function') {
                    e.preventDefault();
                    window._pyPaywallCheck().then(() => navigate(href));
                  }
                }}
              >
                <div className="video-page-related-thumb-wrap">
                  {f.thumb ? (
                    <img className="video-page-related-thumb" src={f.thumb} alt="" loading="lazy" />
                  ) : (
                    <div className="video-page-related-thumb video-page-related-thumb-placeholder">▶</div>
                  )}
                  <div className="video-page-related-play">▶</div>
                </div>
                <div className="video-page-related-info">
                  <div className="video-page-related-title">{rTitle}</div>
                  <div className="video-page-related-meta">{(f.views || 0).toLocaleString()} views</div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
      )}

      <div className="video-page-comments" id="video-page-comments">
        <h3>
          💬 Comments <span id="video-page-comment-count">({stats?.commentCount ?? comments.length})</span>
        </h3>
        <div className="video-page-comment-form" id="video-page-comment-form">
          <textarea
            id="video-page-comment-input"
            placeholder="Write a comment..."
            rows={2}
            maxLength={500}
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
          />
          <button type="button" id="video-page-comment-submit" onClick={submitComment}>
            Post Comment
          </button>
        </div>
        <div className="video-page-comment-list" id="video-page-comment-list">
          {comments.length === 0 ? (
            <p className="no-comments">No comments yet. Be the first!</p>
          ) : (
            comments.map((c, i) => (
              <div key={i} className="video-comment">
                <div className="video-comment-header">
                  <strong>{c.username || c.user || 'Anonymous'}</strong>
                  <span className="video-comment-time">{formatTimeAgo(c.ts || c.createdAt)}</span>
                </div>
                <p className="video-comment-text" dangerouslySetInnerHTML={{ __html: c.text || '' }} />
              </div>
            ))
          )}
        </div>
      </div>

      <div id="video-seo" className="folder-seo-text" />
    </div>
  );
}
