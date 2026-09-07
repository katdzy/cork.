/**
 * A tiny registry of live item nodes, so the detail view can expand out of the
 * exact place a memory sits on the board (and fall back to it on close).
 */
const nodes = new Map<string, HTMLElement>();

export function registerItemNode(id: string, el: HTMLElement | null) {
  if (el) nodes.set(id, el);
  return () => {
    nodes.delete(id);
  };
}

export function getItemRect(id: string): DOMRect | null {
  const el = nodes.get(id);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 ? rect : null;
}
