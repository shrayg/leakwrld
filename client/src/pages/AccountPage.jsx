import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AccountAffiliateProgram } from '../components/account/AccountAffiliateProgram';
import { AccountReferralPanel } from '../components/account/AccountReferralPanel';
import { disconnectProvider, fetchAccount, fetchConnectUrl, updateAccount, uploadUserAssets } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useShell } from '../context/ShellContext';
import { folderDisplayName } from '../lib/cleanUrls';
import { UserAvatar } from '../components/ui/UserAvatar';
import { PwNavTabRow } from '../components/ui/PwNavTabRow';

const PRIMARY_TABS = ['profile', 'referrals', 'affiliate'];
const CONTENT_TABS = ['videos', 'photos', 'gifs', 'upload', 'about'];

const PRIMARY_TAB_LABELS = {
  profile: 'Profile',
  referrals: 'Referral Program',
  affiliate: 'Affiliate Program',
};

const CONTENT_TAB_LABELS = {
  videos: 'Videos',
  photos: 'Photos',
  gifs: 'GIFs',
  upload: 'Upload',
  about: 'About',
};

const USERASSET_CATEGORIES = [
  'NSFW Straight',
  'Alt and Goth',
  'Petite',
  'Teen (18+ only)',
  'MILF',
  'Asian',
  'Ebony',
  'Feet',
  'Hentai',
  'Yuri',
  'Yaoi',
  'Nip Slips',
  'Omegle',
  'OF Leaks',
];

const OMEGLE_SUBFOLDERS = ['Dick Reactions', 'Monkey App Streamers', 'Points Game', 'Regular Wins'];

function toNum(v) {
  return Number(v || 0).toLocaleString();
}

export function AccountPage() {
  const { refresh: refreshAuth } = useAuth();
  const { openAuth } = useShell();
  const location = useLocation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState(null);
  const [error, setError] = useState('');
  const [primaryTab, setPrimaryTab] = useState('profile');
  const [contentTab, setContentTab] = useState('videos');
  const [isEditing, setIsEditing] = useState(false);
  const [providerPending, setProviderPending] = useState({});
  const [providerMessage, setProviderMessage] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [uploadCategory, setUploadCategory] = useState('NSFW Straight');
  const [uploadSubfolder, setUploadSubfolder] = useState('');
  const [uploadFiles, setUploadFiles] = useState([]);
  const [uploadPending, setUploadPending] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');

  const [form, setForm] = useState({
    username: '',
    displayName: '',
    avatarUrl: '',
    bannerUrl: '',
    bio: '',
    twitterUrl: '',
    instagramUrl: '',
    websiteUrl: '',
    followersCount: 0,
    videoViews: 0,
    rank: 0,
  });

  const loadAccount = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchAccount();
      if (!res.ok || !res.data?.authed) {
        setAccount(false);
        if (res.status >= 500) setError('Unable to load account right now.');
        return;
      }
      setAccount(res.data);
      const p = res.data.profile || {};
      setForm({
        username: res.data.username || '',
        displayName: p.display_name || res.data.username || '',
        avatarUrl: p.avatar_url || '',
        bannerUrl: p.banner_url || '',
        bio: p.bio || '',
        twitterUrl: p.twitter_url || '',
        instagramUrl: p.instagram_url || '',
        websiteUrl: p.website_url || '',
        followersCount: Number(p.followers_count || 0),
        videoViews: Number(p.video_views || 0),
        rank: Number(p.rank || 0),
      });
    } catch {
      setError('Network error while loading account.');
      setAccount(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'Account — Pornwrld';
    loadAccount();
    return () => {
      document.title = 'Pornwrld';
    };
  }, [loadAccount]);

  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    const tab = String(params.get('tab') || '').toLowerCase();
    if (tab && PRIMARY_TABS.includes(tab)) {
      setPrimaryTab(tab);
    }
    const panel = String(params.get('panel') || '').toLowerCase();
    if (panel && CONTENT_TABS.includes(panel)) {
      setContentTab(panel);
    }
  }, [location.search]);

  const applyAccountSearch = useCallback(
    (updates) => {
      const params = new URLSearchParams(location.search || '');
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === undefined || value === '') params.delete(key);
        else params.set(key, value);
      });
      const qs = params.toString();
      navigate(qs ? `/account?${qs}` : '/account');
    },
    [location.search, navigate],
  );

  const primaryTabsConfig = useMemo(() => PRIMARY_TABS.map((key) => ({ key, label: PRIMARY_TAB_LABELS[key] })), []);
  const contentTabsConfig = useMemo(() => CONTENT_TABS.map((key) => ({ key, label: CONTENT_TAB_LABELS[key] })), []);

  const setPrimaryTabAndUrl = useCallback(
    (tab) => {
      setPrimaryTab(tab);
      if (tab === 'referrals') applyAccountSearch({ tab: 'referrals', panel: '' });
      else if (tab === 'affiliate') applyAccountSearch({ tab: 'affiliate', panel: '' });
      else applyAccountSearch({ tab: 'profile', panel: contentTab });
    },
    [applyAccountSearch, contentTab],
  );

  const setContentTabAndUrl = useCallback(
    (panel) => {
      setContentTab(panel);
      applyAccountSearch({ tab: 'profile', panel });
    },
    [applyAccountSearch],
  );

  const mediaList = useMemo(() => {
    const p = account?.profile || {};
    if (contentTab === 'photos') return Array.isArray(p.photos) ? p.photos : [];
    if (contentTab === 'gifs') return Array.isArray(p.gifs) ? p.gifs : [];
    return Array.isArray(p.videos) ? p.videos : [];
  }, [account, contentTab]);

  function mediaThumbStyle(item) {
    const u = String(item?.url || '').trim();
    if (!u || !/\.(jpe?g|png|webp|gif)$/i.test(u.split('?')[0] || '')) return undefined;
    return {
      backgroundImage: `url(${u})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }

  async function submitUserAssetUpload(e) {
    e.preventDefault();
    setUploadMessage('');
    if (!uploadFiles.length) return setUploadMessage('Select at least one file.');
    if (uploadFiles.length > 10) return setUploadMessage('Max 10 files per upload.');
    const tooLarge = uploadFiles.find((f) => Number(f.size || 0) > 50 * 1024 * 1024);
    if (tooLarge) return setUploadMessage(`"${tooLarge.name}" exceeds 50MB.`);
    if (!USERASSET_CATEGORIES.includes(uploadCategory)) return setUploadMessage('Invalid category.');
    if (uploadCategory === 'Omegle' && uploadSubfolder && !OMEGLE_SUBFOLDERS.includes(uploadSubfolder)) {
      return setUploadMessage('Choose a valid Omegle subfolder.');
    }

    const fd = new FormData();
    fd.set('category', uploadCategory);
    if (uploadSubfolder) fd.set('subfolder', uploadSubfolder);
    uploadFiles.forEach((f) => fd.append('files', f));

    setUploadPending(true);
    try {
      const res = await uploadUserAssets(fd);
      if (!res.ok) {
        setUploadMessage(res.data?.error || 'Upload failed.');
        return;
      }
      const count = Array.isArray(res.data?.uploaded) ? res.data.uploaded.length : 0;
      setUploadMessage(`Uploaded ${count} file${count === 1 ? '' : 's'} to userassets.`);
      setUploadFiles([]);
    } catch {
      setUploadMessage('Network error while uploading.');
    } finally {
      setUploadPending(false);
    }
  }

  async function saveProfile(e) {
    e.preventDefault();
    if (!account) return;
    setProfileSaving(true);
    setSaveMessage('');
    try {
      const res = await updateAccount({
        username: form.username.trim(),
        displayName: form.displayName.trim(),
        avatarUrl: form.avatarUrl.trim(),
        bannerUrl: form.bannerUrl.trim(),
        bio: form.bio,
        twitterUrl: form.twitterUrl.trim(),
        instagramUrl: form.instagramUrl.trim(),
        websiteUrl: form.websiteUrl.trim(),
        followersCount: form.followersCount,
        videoViews: form.videoViews,
        rank: form.rank,
      });
      if (!res.ok) {
        setSaveMessage(res.data?.error || 'Unable to save profile.');
        return;
      }
      setSaveMessage('Profile updated.');
      setIsEditing(false);
      await loadAccount();
      await refreshAuth();
    } catch {
      setSaveMessage('Network error while saving profile.');
    } finally {
      setProfileSaving(false);
    }
  }

  async function connect(provider) {
    setProviderPending((prev) => ({ ...prev, [provider]: true }));
    setProviderMessage('');
    try {
      const res = await fetchConnectUrl(provider);
      if (!res.ok || !res.data?.url) {
        setProviderMessage(res.data?.error || `Unable to connect ${provider}.`);
        return;
      }
      window.location.href = res.data.url;
    } catch {
      setProviderMessage(`Network error while connecting ${provider}.`);
    } finally {
      setProviderPending((prev) => ({ ...prev, [provider]: false }));
    }
  }

  async function disconnect(provider) {
    setProviderPending((prev) => ({ ...prev, [provider]: true }));
    setProviderMessage('');
    try {
      const res = await disconnectProvider(provider);
      if (!res.ok) {
        setProviderMessage(res.data?.error || `Unable to disconnect ${provider}.`);
        return;
      }
      await loadAccount();
      setProviderMessage(`${provider} disconnected.`);
    } catch {
      setProviderMessage(`Network error while disconnecting ${provider}.`);
    } finally {
      setProviderPending((prev) => ({ ...prev, [provider]: false }));
    }
  }

  if (loading) {
    return <div className="account-profile-page"><div className="account-profile-shell"><p>Loading account...</p></div></div>;
  }

  if (!account) {
    return (
      <div className="account-profile-page">
        <div className="account-profile-shell">
          <h2>Account</h2>
          {error ? <p className="account-profile-alert">{error}</p> : null}
          <div className="account-profile-auth-actions">
            <button type="button" className="account-profile-btn account-profile-btn--gold" onClick={() => openAuth('login')}>Log in</button>
            <button type="button" className="account-profile-btn account-profile-btn--ghost" onClick={() => openAuth('signup')}>Create account</button>
          </div>
        </div>
      </div>
    );
  }

  const profile = account.profile || {};
  const providers = account.providers || {};

  return (
    <div className="account-profile-page">
      <section className="account-profile-hero">
        <div className="account-profile-shell">
          <div
            className="account-profile-banner"
            style={{
              backgroundImage: form.bannerUrl ? `url(${form.bannerUrl})` : undefined,
            }}
          />
          <div className="account-profile-header-row">
            <div className="account-profile-avatar-wrap">
              <UserAvatar
                username={form.username || form.displayName || 'Account'}
                src={form.avatarUrl}
                size={108}
                className="account-profile-avatar"
                alt=""
              />
            </div>
            <div className="account-profile-head-copy">
              <h1>{form.displayName || form.username}</h1>
              <p>@{form.username}</p>
            </div>
            <div className="account-profile-head-actions">
              <button type="button" className="account-profile-btn account-profile-btn--ghost" onClick={() => setIsEditing((v) => !v)}>
                Edit Profile
              </button>
              <button type="button" className="account-profile-btn account-profile-btn--follow">Follow</button>
            </div>
          </div>
          <div className="account-profile-stats">
            <div><strong>{toNum(form.followersCount)}</strong><span>Followers</span></div>
            <div><strong>{toNum(form.videoViews)}</strong><span>Video Views</span></div>
            <div><strong>#{toNum(form.rank || 0)}</strong><span>Rank</span></div>
          </div>
        </div>
      </section>

      <div className="account-profile-shell">
        <PwNavTabRow
          activeKey={primaryTab}
          tabs={primaryTabsConfig}
          onChange={setPrimaryTabAndUrl}
          className="account-pw-tabs"
          glideClassName="account-pw-glide"
          ariaLabel="Account sections"
        />

        {primaryTab === 'profile' ? (
          <>
            <PwNavTabRow
              activeKey={contentTab}
              tabs={contentTabsConfig}
              onChange={setContentTabAndUrl}
              className="account-pw-tabs"
              glideClassName="account-pw-glide"
              ariaLabel="Profile content"
            />

            {contentTab === 'about' ? (
              <section className="account-profile-about">
                <h3>About</h3>
                <p>{form.bio || 'No bio yet.'}</p>
                <h4>Links</h4>
                <ul>
                  {form.twitterUrl ? <li><a href={form.twitterUrl} target="_blank" rel="noopener noreferrer">Twitter</a></li> : null}
                  {form.instagramUrl ? <li><a href={form.instagramUrl} target="_blank" rel="noopener noreferrer">Instagram</a></li> : null}
                  {form.websiteUrl ? <li><a href={form.websiteUrl} target="_blank" rel="noopener noreferrer">Website</a></li> : null}
                  {!form.twitterUrl && !form.instagramUrl && !form.websiteUrl ? <li>No links added.</li> : null}
                </ul>
              </section>
            ) : contentTab === 'upload' ? (
              <section className="account-profile-upload" aria-label="Upload content">
                <h3>Upload to Userassets</h3>
                <p className="account-profile-upload__lede">Upload up to 10 files per batch (max 50MB each), sorted by category.</p>
                <form className="account-profile-upload-form" onSubmit={submitUserAssetUpload}>
                  <label>
                    Category
                    <select value={uploadCategory} onChange={(e) => setUploadCategory(e.target.value)}>
                      {USERASSET_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {folderDisplayName(c)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {uploadCategory === 'Omegle' ? (
                    <label>
                      Omegle Subfolder
                      <select value={uploadSubfolder} onChange={(e) => setUploadSubfolder(e.target.value)}>
                        <option value="">None</option>
                        {OMEGLE_SUBFOLDERS.map((sf) => <option key={sf} value={sf}>{sf}</option>)}
                      </select>
                    </label>
                  ) : null}
                  <label>
                    Files
                    <input
                      type="file"
                      multiple
                      onChange={(e) => setUploadFiles(Array.from(e.target.files || []))}
                      accept="video/*,image/*"
                    />
                  </label>
                  <p className="account-profile-muted">{uploadFiles.length} file(s) selected</p>
                  <button type="submit" disabled={uploadPending}>
                    {uploadPending ? 'Uploading...' : 'Upload to userassets'}
                  </button>
                  {uploadMessage ? <p className="account-profile-muted">{uploadMessage}</p> : null}
                </form>
              </section>
            ) : (
              <section className="account-profile-grid">
                <button
                  type="button"
                  className="account-profile-grid-card account-profile-grid-card--upload"
                  onClick={() => setContentTabAndUrl('upload')}
                >
                  <div className="account-profile-grid-thumb account-profile-grid-thumb--upload" />
                  <p>Upload</p>
                  <span>Add {contentTab === 'gifs' ? 'GIFs' : contentTab}</span>
                </button>
                {mediaList.length ? mediaList.map((item, idx) => (
                  <a key={idx} href={item.url} target="_blank" rel="noopener noreferrer" className="account-profile-grid-card">
                    <div className="account-profile-grid-thumb" style={mediaThumbStyle(item)} />
                    <p>{item.title || 'Untitled'}</p>
                    <span>{toNum(item.views || 0)} views</span>
                  </a>
                )) : <p className="account-profile-muted">No {contentTab} yet.</p>}
              </section>
            )}

            {isEditing ? (
              <form className="account-profile-edit" onSubmit={saveProfile}>
                <h3>Edit profile</h3>
                <label>Username (can change once every 7 days)<input value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} minLength={3} maxLength={24} required /></label>
                <label>Display name<input value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} maxLength={80} /></label>
                <label>Profile picture URL<input value={form.avatarUrl} onChange={(e) => setForm((f) => ({ ...f, avatarUrl: e.target.value }))} /></label>
                <label>Banner URL<input value={form.bannerUrl} onChange={(e) => setForm((f) => ({ ...f, bannerUrl: e.target.value }))} /></label>
                <label>About me<textarea value={form.bio} onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))} rows={4} /></label>
                <label>Twitter URL<input value={form.twitterUrl} onChange={(e) => setForm((f) => ({ ...f, twitterUrl: e.target.value }))} /></label>
                <label>Instagram URL<input value={form.instagramUrl} onChange={(e) => setForm((f) => ({ ...f, instagramUrl: e.target.value }))} /></label>
                <label>Website URL<input value={form.websiteUrl} onChange={(e) => setForm((f) => ({ ...f, websiteUrl: e.target.value }))} /></label>
                <div className="account-profile-edit-grid">
                  <label>Followers<input type="number" min={0} value={form.followersCount} onChange={(e) => setForm((f) => ({ ...f, followersCount: Number(e.target.value || 0) }))} /></label>
                  <label>Video views<input type="number" min={0} value={form.videoViews} onChange={(e) => setForm((f) => ({ ...f, videoViews: Number(e.target.value || 0) }))} /></label>
                  <label>Rank<input type="number" min={0} value={form.rank} onChange={(e) => setForm((f) => ({ ...f, rank: Number(e.target.value || 0) }))} /></label>
                </div>
                <div className="account-profile-edit-actions">
                  <button type="submit" disabled={profileSaving}>{profileSaving ? 'Saving...' : 'Save changes'}</button>
                  <button type="button" onClick={() => setIsEditing(false)}>Cancel</button>
                </div>
              </form>
            ) : null}
          </>
        ) : primaryTab === 'referrals' ? (
          <AccountReferralPanel referral={account.referral} onToast={setSaveMessage} />
        ) : (
          <AccountAffiliateProgram affiliate={account.affiliate} />
        )}

        <section className="account-profile-providers">
          <h3>Connected Accounts</h3>
          {['discord', 'google'].map((provider) => (
            <div key={provider} className="account-profile-provider-row">
              <div>
                <strong>{provider[0].toUpperCase() + provider.slice(1)}</strong>
                <span>{providers[provider] ? 'Connected' : 'Not connected'}</span>
              </div>
              <div>
                <button type="button" onClick={() => connect(provider)} disabled={providerPending[provider]}>
                  {providerPending[provider] ? 'Working...' : providers[provider] ? 'Reconnect' : 'Connect'}
                </button>
                {providers[provider] ? <button type="button" onClick={() => disconnect(provider)} disabled={providerPending[provider]}>Disconnect</button> : null}
              </div>
            </div>
          ))}
        </section>

        {saveMessage ? <p className="account-profile-muted">{saveMessage}</p> : null}
        {providerMessage ? <p className="account-profile-muted">{providerMessage}</p> : null}
      </div>
    </div>
  );
}
