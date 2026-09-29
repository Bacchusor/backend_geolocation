export interface TemplateContext {
  count: number;
  shop: string;
  place: string;
  person: string;
  /** Item names, already sorted. */
  items: string[];
}

const MAX_ITEMS_IN_MESSAGE = 15;

function formatItems(items: string[]): string {
  if (items.length === 0) return '';
  const names = items.slice(0, MAX_ITEMS_IN_MESSAGE);
  const more = items.length - names.length;
  return names.join(', ') + (more > 0 ? ` (+${more} more)` : '');
}

/** Replace {count} {shop} {items} {place} {person} placeholders. */
export function renderMessage(template: string, ctx: TemplateContext): string {
  const values: Record<string, string> = {
    count: String(ctx.count),
    shop: ctx.shop,
    place: ctx.place,
    person: ctx.person,
    items: formatItems(ctx.items),
  };
  return template.replace(/\{(\w+)\}/g, (m, key: string) => values[key] ?? m).trim();
}
