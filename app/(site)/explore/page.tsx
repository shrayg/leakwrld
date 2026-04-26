import { Chip } from "@/components/ui/chip";
import { platformCategories } from "@/lib/categories";

export default function ExplorePage() {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-bold">Explore categories</h1>
      <p className="text-sm text-[var(--text-2)]">Browse by category, creator channels, and trend velocity.</p>
      <div className="flex flex-wrap gap-2">
        {platformCategories.map((category) => (
          <Chip key={category.slug}>{category.label}</Chip>
        ))}
      </div>
    </section>
  );
}
