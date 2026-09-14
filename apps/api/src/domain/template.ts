export interface TemplateItem {
  name: string;
  category: string | null;
}

export interface TemplateContext {
  count: number;
  shop: string;
  place: string;
  person: string;
  items: TemplateItem[];
  groupByCategory: boolean;
}

const MAX_ITEMS_IN_MESSAGE = 15;

function formatItems(items: TemplateItem[], groupByCategory: boolean): string {
  if (items.length === 0) return '';
  if (!groupByCategory) {
    const names = items.slice(0, MAX_ITEMS_IN_MESSAGE).map((i) => i.name);
    const more = items.length - names.length;
    return names.join(', ') + (more > 0 ? ` (+${more} more)` : '');
  }
  const groups = new Map<string, string[]>();
  for (const it of items) {
    const key = it.category ?? 'Other';
    const arr = groups.get(key) ?? [];
    arr.push(it.name);
    groups.set(key, arr);
  }
  return [...groups.entries()].map(([cat, names]) => `${cat}: ${names.join(', ')}`).join(' · ');
}

/** Replace {count} {shop} {items} {place} {person} {categories} placeholders. */
export function renderMessage(template: string, ctx: TemplateContext): string {
  const categories = [
    ...new Set(ctx.items.map((i) => i.category).filter((c): c is string => !!c)),
  ].join(', ');
  const values: Record<string, string> = {
    count: String(ctx.count),
    shop: ctx.shop,
    place: ctx.place,
    person: ctx.person,
    items: formatItems(ctx.items, ctx.groupByCategory),
    categories,
  };
  return template.replace(/\{(\w+)\}/g, (m, key: string) => values[key] ?? m).trim();
}
