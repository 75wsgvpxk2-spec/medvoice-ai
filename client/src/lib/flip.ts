import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Section 9, motion 2 — queue re-ranking.
 *
 * "Rows move to new positions over roughly half a second so the change is
 * witnessed. The single most important animation in the product."
 *
 * FLIP: measure where each row was, let React reorder, measure where it is now,
 * then animate from the old position to the new one. Animating transform means
 * no layout work per frame and no reflow of the rest of the queue.
 *
 * PA-2: with reduced motion the reorder is instant and the moved row is
 * highlighted instead, so the change is still witnessed without movement.
 */
export function useQueueFlip(
  containerRef: RefObject<HTMLElement | null>,
  orderKey: string,
): void {
  const previousTops = useRef(new Map<string, number>());
  const isFirstRender = useRef(true);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-flip-key]'));
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    for (const row of rows) {
      const key = row.dataset['flipKey'];
      if (!key) continue;

      const top = row.getBoundingClientRect().top;
      const previous = previousTops.current.get(key);
      previousTops.current.set(key, top);

      // Nothing to animate on the first paint, or if the row did not move.
      if (isFirstRender.current || previous === undefined) continue;
      const delta = previous - top;
      if (Math.abs(delta) < 1) continue;

      if (reduced) {
        row.classList.add('moved-instantly');
        window.setTimeout(() => row.classList.remove('moved-instantly'), 2400);
        continue;
      }

      row.classList.add('moving');
      const animation = row.animate(
        [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
        // Roughly half a second, decelerating, so the eye can follow it.
        { duration: 480, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      );
      animation.finished.then(() => row.classList.remove('moving')).catch(() => {
        row.classList.remove('moving');
      });
    }

    isFirstRender.current = false;
  }, [containerRef, orderKey]);
}
