// Single source of truth for reorder index math shared by the
// category/playlist reorder grids (live preview and final drop must use the
// exact same computation, exactly once per update).
//
// moveItem convention: `from` and `to` are indexes into the SAME (original)
// list. The element ends up exactly at index `to`: after an element that used
// to sit at `to` when moving right, before it when moving left. No direction
// adjustment is needed; callers must not re-apply a move on top of a preview
// that already contains it.

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) return next;
  if (from === to) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function moveItemByKey(list: string[], draggedKey: string, targetKey: string): string[] {
  const from = list.indexOf(draggedKey);
  const to = list.indexOf(targetKey);
  if (from < 0 || to < 0 || from === to) return [...list];
  return moveItem(list, from, to);
}

// Resolves the final visible key order for a drop. The live preview is
// authoritative: it is the product of every processed pointer position and
// exactly what the user saw on screen. Re-applying the release point on top
// of a non-empty preview double-counts (a one-card overshoot at release
// lands two slots away; drifting back over the swap partner cancels the
// move). Only a fast flick with no interleaved preview resolves the release
// point, and it does so against the origin order.
export function resolveDropOrder(
  originKeys: string[],
  previewKeys: string[],
  draggedKey: string,
  targetKey: string,
  isDirectHit: boolean,
): string[] {
  if (previewKeys.length > 0) return [...previewKeys];
  if (!isDirectHit) return [...originKeys];
  return moveItemByKey(originKeys, draggedKey, targetKey);
}

// Maps a reordered VISIBLE key list back onto the full key list, preserving
// the relative order of hidden (e.g. filtered-out) items. `visibleKeys` must
// contain the same visible keys in their new order.
export function mergeVisibleOrder(allKeys: string[], visibleKeys: string[]): string[] {
  const visibleKeySet = new Set(visibleKeys);
  let visibleIndex = 0;
  return allKeys.map((key) => {
    if (!visibleKeySet.has(key)) return key;
    const nextKey = visibleKeys[visibleIndex];
    visibleIndex += 1;
    return nextKey ?? key;
  });
}

// Layout box of a card: the viewport rect minus the card's own in-flight FLIP
// transform (read back from the computed style, so it is exact at any point
// of the 220ms animation). Layout boxes are the stable grid slots; visual
// boxes mid-flight belong to cards gliding elsewhere.
export function layoutRectOf(card: HTMLElement): {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
} {
  const rect = card.getBoundingClientRect();
  let dx = 0;
  let dy = 0;
  try {
    const transform = getComputedStyle(card).transform;
    if (transform && transform !== "none") {
      const matrix = new DOMMatrix(transform);
      dx = matrix.m41;
      dy = matrix.m42;
    }
  } catch {
    // If the transform cannot be parsed, fall back to the visual rect.
  }
  return {
    left: rect.left - dx,
    top: rect.top - dy,
    right: rect.right - dx,
    bottom: rect.bottom - dy,
    width: rect.width,
    height: rect.height,
  };
}

// Topmost reorder card (in DOM order) whose LAYOUT slot contains the point,
// excluding `excludeKey` (the dragged source card). Unlike elementsFromPoint,
// this is immune to the animation phase: a release or hover always resolves
// to a stable slot, never to a card that is merely gliding through.
export function directReorderTargetAt(
  x: number,
  y: number,
  excludeKey: string,
): string | undefined {
  const cards = document.querySelectorAll<HTMLElement>("[data-reorder-card]");
  for (let index = cards.length - 1; index >= 0; index -= 1) {
    const card = cards[index];
    const key = card.dataset.reorderKey;
    if (!key || key === excludeKey) continue;
    const box = layoutRectOf(card);
    if (box.width <= 0 || box.height <= 0) continue;
    if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return key;
  }
  return undefined;
}
