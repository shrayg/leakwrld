import { ArrowRight, Clock3, Crown, ShieldCheck, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { apiGet } from '../api';
import { CREATORS, SHORTS } from '../data/catalog';
import { CreatorCard, ShortCard } from '../components/CreatorCard';

export function HomePage() {
  const [creators, setCreators] = useState(CREATORS);
  const [shorts, setShorts] = useState(SHORTS);
  const [queue, setQueue] = useState({ online: 0, capacity: 100, queued: false, position: 0 });

  useEffect(() => {
    document.title = 'Leak World';
    apiGet('/api/creators', { creators: CREATORS }).then((data) => setCreators(data.creators || CREATORS));
    apiGet('/api/shorts', { shorts: SHORTS }).then((data) => setShorts(data.shorts || SHORTS));
    apiGet('/api/queue/status', queue).then(setQueue);
  }, []);

  const topCreators = creators.slice(0, 8);
  const featuredShorts = shorts.slice(0, 6);

  return (
    <div className="space-y-8">
      <section className="lw-hero">
        <div className="lw-hero-media" aria-hidden="true">
          <div className="lw-hero-window">
            {topCreators.slice(0, 6).map((creator, index) => (
              <div key={creator.slug} className={`lw-hero-tile accent-${creator.accent}`} style={{ animationDelay: `${index * 90}ms` }}>
                <span>#{creator.rank}</span>
                <b>{creator.name}</b>
              </div>
            ))}
          </div>
        </div>

        <div className="lw-hero-copy">
          <span className="lw-eyebrow">Top 100 creators rebuilt for Postgres</span>
          <h1>Leak World</h1>
          <p>
            A clean creator-first rebuild with free previews, premium-ready media slots, login, signup, and a queue
            system foundation for high traffic.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link to="/categories" className="lw-btn primary">
              Browse creators
              <ArrowRight size={16} />
            </Link>
            <Link to="/shorts" className="lw-btn ghost">
              Watch shorts
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lw-stat">
          <Users size={18} />
          <b>{creators.length}</b>
          <span>Creators loaded</span>
        </div>
        <div className="lw-stat">
          <ShieldCheck size={18} />
          <b>Postgres</b>
          <span>Auth and content database</span>
        </div>
        <div className="lw-stat">
          <Clock3 size={18} />
          <b>{queue.online}/{queue.capacity}</b>
          <span>{queue.queued ? `Queue position ${queue.position}` : 'Queue clear'}</span>
        </div>
        <div className="lw-stat">
          <Crown size={18} />
          <b>3 tiers</b>
          <span>Payments ready later</span>
        </div>
      </section>

      <section className="lw-section">
        <div className="lw-section-head">
          <div>
            <span className="lw-eyebrow">Featured</span>
            <h2>Top creator cards</h2>
          </div>
          <Link to="/categories" className="lw-link">
            View all
            <ArrowRight size={15} />
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {topCreators.map((creator) => (
            <CreatorCard key={creator.slug} creator={creator} />
          ))}
        </div>
      </section>

      <section className="lw-section">
        <div className="lw-section-head">
          <div>
            <span className="lw-eyebrow">Shorts</span>
            <h2>Free and premium previews</h2>
          </div>
          <Link to="/shorts" className="lw-link">
            Open shorts
            <ArrowRight size={15} />
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {featuredShorts.map((item, index) => (
            <ShortCard key={item.id} item={item} index={index} />
          ))}
        </div>
      </section>
    </div>
  );
}
