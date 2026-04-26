import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import articleBodies from '../data/blogArticles.raw.json';
import { PageHero } from '../components/layout/PageHero';

const INDEX = [
  {
    slug: 'what-happened-to-omegle',
    title: 'What Happened to Omegle? Why It Shut Down & Where to Find Omegle Wins in 2026',
    meta: 'Published April 4, 2026',
    excerpt:
      'Omegle shut down in November 2023 after 14 years. Learn why it closed, what happened to all the content, and where you can still find the best Omegle wins, flashing compilations, and reactions in 2026.',
    tags: ['omegle', 'omegle wins', 'omegle shut down'],
  },
  {
    slug: 'best-omegle-wins',
    title: 'Best Omegle Wins of All Time — Top Flashing, Reactions & Compilations',
    meta: 'Published April 4, 2026',
    excerpt:
      'A curated guide to the greatest Omegle wins ever recorded. From legendary flashing reactions to hilarious points game moments and Monkey App clips — the definitive list of top Omegle content.',
    tags: ['omegle wins', 'omegle compilation', 'best omegle'],
  },
  {
    slug: 'omegle-alternatives',
    title: 'Omegle Alternatives in 2026 — Best Random Video Chat Sites for Wins',
    meta: 'Published April 4, 2026',
    excerpt:
      'Since Omegle shut down, users have moved to OmeTV, MiniChat, Monkey App, and other platforms. Here are the best Omegle alternatives in 2026 and where the most wins are happening now.',
    tags: ['omegle alternatives', 'ometv', 'monkey app'],
  },
  {
    slug: 'tiktok-leaks-guide',
    title: 'TikTok Leaks & NSFW TikTok — Where to Find Leaked TikTok Content in 2026',
    meta: 'Published April 4, 2026',
    excerpt:
      'TikTok continues to be one of the biggest sources of viral adult content. Learn about TikTok leaks, NSFW TikTok trends, and where banned TikTok videos end up.',
    tags: ['tiktok leaks', 'tiktok porn', 'nsfw tiktok'],
  },
];

export function BlogPage() {
  const location = useLocation();
  const [slug, setSlug] = useState(() => (location.hash ? location.hash.replace(/^#/, '') : ''));

  useEffect(() => {
    document.title = 'Pornyard Blog — Omegle Wins, Adult Content Guides & News';
    function onHash() {
      setSlug(window.location.hash.replace(/^#/, ''));
    }
    window.addEventListener('hashchange', onHash);
    onHash();
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const html = slug && articleBodies[slug];

  if (html) {
    return (
      <main className="page-content blog-route">
        <div className="blog-article-wrap hanime-blog-article">
          <Link to="/blog" className="blog-back hanime-blog-back">
            &larr; All posts
          </Link>
          <div className="blog-article-inner" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </main>
    );
  }

  return (
    <main className="page-content blog-route" id="blog-index">
      <div className="blog-container hanime-blog-index">
        <Link to="/" className="blog-back hanime-blog-back">
          &larr; Back to Pornyard
        </Link>
        <PageHero title="Pornyard blog" subtitle="Guides, news, and articles about Omegle wins, adult content, and more." />
        <div className="blog-grid">
          {INDEX.map((post) => (
            <article key={post.slug} className="blog-card">
              <h2>
                <Link to={`/blog#${post.slug}`}>{post.title}</Link>
              </h2>
              <div className="blog-meta">{post.meta}</div>
              <p>{post.excerpt}</p>
              <div className="blog-tags">
                {post.tags.map((t) => (
                  <span key={t} className="blog-tag">
                    {t}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
