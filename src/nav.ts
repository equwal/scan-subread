// Page turns by the user: the arrows of the top bar, the keys, a swipe on
// the viewer, and the page jump of the page label. The decisions are in
// paging.ts.

import { arrowsOff, arrowStep, keyStep, parsePage, swipeStep, type Step } from './paging';
import { say } from './status';

/** A click this soon after the end of a swipe comes from the swipe, and does no lookup. */
const CLICK_AFTER_SWIPE_MS = 400;

/** A click this soon after the tap that cancels the page jump comes from that tap. */
const CLICK_AFTER_CANCEL_MS = 1000;

/** A page zoomed in more than this is zoomed. */
const ZOOMED = 1.01;

export interface NavElements {
  viewer: HTMLElement;
  pageLeft: HTMLButtonElement;
  pageRight: HTMLButtonElement;
  pageLabel: HTMLButtonElement;
  pageInput: HTMLInputElement;
}

export interface NavState {
  /** The count of pages, or 0 with no PDF. */
  pages(): number;
  /** The index of the page shown. */
  current(): number;
  /** True when the pages turn right to left. */
  rtl(): boolean;
  /** True while the drawer covers the page. */
  drawerOpen(): boolean;
}

export interface Nav {
  /** Shows the page label, and the state and the names of the arrows. */
  update(): void;
  /** True while the page jump is open. */
  jumpOpen(): boolean;
  /** Closes the page jump. */
  closeJump(): void;
}

function zoomed(): boolean {
  return (window.visualViewport?.scale ?? 1) > ZOOMED;
}

/** `turnTo(index)` shows the page that the user asked for. */
export function setupNav(ui: NavElements, s: NavState, turnTo: (index: number) => void): Nav {
  function go(step: Step): void {
    const to = s.current() + step;
    if (to >= 0 && to < s.pages()) turnTo(to);
  }

  // --- The arrows ---

  ui.pageLeft.addEventListener('click', () => go(arrowStep('left', s.rtl())));
  ui.pageRight.addEventListener('click', () => go(arrowStep('right', s.rtl())));

  function name(button: HTMLButtonElement, step: Step): void {
    const text = step > 0 ? 'Next page' : 'Previous page';
    if (button.title === text) return;
    button.title = text;
    button.setAttribute('aria-label', text);
  }

  // --- The keys ---

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || s.drawerOpen()) return;
    const target = e.target;
    if (
      target instanceof HTMLElement &&
      (target.closest('input, select, textarea') || target.isContentEditable)
    ) {
      return;
    }
    const step = keyStep(e.key, s.rtl());
    if (step === 0) return;
    e.preventDefault();
    go(step);
  });

  // --- The swipe ---

  // The browser pans the page only vertically, so a sideways move stays
  // with the swipe. A zoomed page pans in each direction.
  const markZoom = (): void => {
    document.body.classList.toggle('zoomed', zoomed());
  };
  window.visualViewport?.addEventListener('resize', markZoom);
  markZoom();

  let start: { id: number; x: number; y: number } | null = null;
  let swipedAt = -Infinity;
  ui.viewer.addEventListener('pointerdown', (e) => {
    // A second finger makes a pinch, not a swipe.
    start = e.isPrimary ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
  });
  ui.viewer.addEventListener('pointercancel', () => {
    start = null;
  });
  ui.viewer.addEventListener('pointerup', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (s.drawerOpen()) return;
    const v = ui.viewer;
    const step = swipeStep(
      { dx, dy, zoomed: zoomed(), wide: v.scrollWidth > v.clientWidth + 1 },
      s.rtl(),
    );
    if (step === 0) return;
    swipedAt = e.timeStamp;
    go(step);
  });
  // The click after a swipe is not a tap on a word.
  ui.viewer.addEventListener(
    'click',
    (e) => {
      if (e.timeStamp - swipedAt < CLICK_AFTER_SWIPE_MS) {
        swipedAt = -Infinity;
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true,
  );

  // --- The page jump ---

  function openJump(): void {
    if (s.pages() === 0) return;
    ui.pageInput.value = String(s.current() + 1);
    ui.pageInput.placeholder = `1-${s.pages()}`;
    ui.pageLabel.hidden = true;
    ui.pageInput.hidden = false;
    ui.pageInput.focus();
    ui.pageInput.select();
  }

  function closeJump(): void {
    if (ui.pageInput.hidden) return;
    ui.pageInput.hidden = true;
    ui.pageLabel.hidden = false;
  }

  ui.pageLabel.addEventListener('click', openJump);
  ui.pageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeJump();
      ui.pageLabel.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const index = parsePage(ui.pageInput.value, s.pages());
      if (index === null) {
        say(`Type a page number from 1 to ${s.pages()}.`);
        return;
      }
      closeJump();
      ui.pageLabel.focus();
      if (index !== s.current()) turnTo(index);
    }
  });
  // Tab or another focus change cancels the jump.
  ui.pageInput.addEventListener('blur', closeJump);

  // A tap outside the open page jump only cancels it: the click that
  // follows does nothing else.
  let cancelledAt = -Infinity;
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (ui.pageInput.hidden || e.target === ui.pageInput) return;
      closeJump();
      cancelledAt = e.timeStamp;
    },
    true,
  );
  document.addEventListener(
    'click',
    (e) => {
      if (e.timeStamp - cancelledAt < CLICK_AFTER_CANCEL_MS) {
        cancelledAt = -Infinity;
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true,
  );

  return {
    update() {
      const pages = s.pages();
      const page = s.current();
      const rtl = s.rtl();
      ui.pageLabel.disabled = pages === 0;
      ui.pageLabel.textContent = pages > 0 ? `${page + 1} / ${pages}` : 'No PDF';
      ui.pageLabel.setAttribute(
        'aria-label',
        pages > 0 ? `Page ${page + 1} of ${pages}. Go to a page.` : 'No PDF',
      );
      const off = arrowsOff(page, pages, rtl);
      ui.pageLeft.disabled = off.left;
      ui.pageRight.disabled = off.right;
      name(ui.pageLeft, arrowStep('left', rtl));
      name(ui.pageRight, arrowStep('right', rtl));
      if (pages === 0) closeJump();
    },
    jumpOpen: () => !ui.pageInput.hidden,
    closeJump,
  };
}
