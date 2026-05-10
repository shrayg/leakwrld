import { Filter, Lock, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiGet } from '../api';
import { SHORTS } from '../data/catalog';
import { ShortCard } from '../components/CreatorCard';

export function ShortsPage() {
  const [items, setItems] = useState(SHORTS);
  const [tier, setTier] = useState('all');

  useEffect(() => {
    document.title = 'Shorts - Leak World';
    apiGet('/api/shorts', { shorts: SHORTS }).then((data) => setItems(data.shorts || SHORTS));
  }, []);

  const visible = items.filter((item) => tier === 'all' || item.tier === tier);
  const heroShort = visible[0] || items[0];

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(300px,430px)_1fr]">
      <section className="lw-shorts-stage">
        <div className="lw-phone-frame">
          <div className="lw-short-preview accent-pink h-full min-h-[560px]">
            <span className="lw-rank">{heroShort?.duration || '0:24'}</span>
            <button type="button" className="lw-play big" aria-label="Play featured short">
              <Play size={34} fill="currentColor" />
            </button>
            <div className="absolute inset-x-4 bottom-4">
              <p className="text-[12px] uppercase text-white/50">Featured short</p>
              <h1 className="mt-1 text-[24px] font-semibold text-white">{heroShort?.title || 'Preview'}</h1>
              <p className="mt-1 text-sm text-white/70">{heroShort?.creatorName}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-5">
        <div className="lw-page-head">
          <span className="lw-eyebrow">Vertical feed</span>
          <h1>Shorts</h1>
          <p>Quick free previews from every creator in the archive — tap any premium clip to unlock the full set.</p>
        </div>

        <div className="lw-toolbar">
          <div className="flex items-center gap-2 text-sm text-white/60">
            <Filter size={16} />
            Filter
          </div>
          <div className="flex gap-2">
            {['all', 'free', 'premium'].map((item) => (
              <button key={item} type="button" className={`lw-filter ${tier === item ? 'active' : ''}`} onClick={() => setTier(item)}>
                {item === 'premium' ? <Lock size={13} /> : null}
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((item, index) => (
            <ShortCard key={item.id} item={item} index={index} />
          ))}
        </div>
      </section>
    </div>
  );
}
