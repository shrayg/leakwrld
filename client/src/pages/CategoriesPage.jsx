import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiGet } from '../api';
import { CATEGORIES, CREATORS } from '../data/catalog';
import { CreatorCard } from '../components/CreatorCard';

export function CategoriesPage() {
  const [creators, setCreators] = useState(CREATORS);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');

  useEffect(() => {
    document.title = 'Categories - Leak World';
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (category) params.set('category', category);
    apiGet(`/api/creators?${params.toString()}`, { creators: CREATORS }).then((data) => {
      setCreators(data.creators || CREATORS);
    });
  }, [query, category]);

  const visible = creators.filter((creator) => {
    const matchesQuery = !query.trim() || creator.name.toLowerCase().includes(query.trim().toLowerCase());
    const matchesCategory = !category || creator.category === category;
    return matchesQuery && matchesCategory;
  });

  return (
    <div className="space-y-6">
      <section className="lw-page-head">
        <span className="lw-eyebrow">Creator index</span>
        <h1>Categories</h1>
        <p>Top 100 creators grouped into a clean content model for free and paid access.</p>
      </section>

      <section className="lw-toolbar">
        <label className="lw-search-field">
          <Search size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the top 100" />
        </label>
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button type="button" className={`lw-filter ${category === '' ? 'active' : ''}`} onClick={() => setCategory('')}>
            All
          </button>
          {CATEGORIES.map((item) => (
            <button
              type="button"
              key={item}
              className={`lw-filter ${category === item ? 'active' : ''}`}
              onClick={() => setCategory(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visible.map((creator) => (
          <CreatorCard key={creator.slug} creator={creator} />
        ))}
      </section>
    </div>
  );
}
