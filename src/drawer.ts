// The menu. On a phone it is a drawer over the page. On a desktop it is a
// side panel that always shows.

/** The width from which the menu is a side panel. The same as the media query in style.css. */
const desktop = window.matchMedia('(min-width: 900px)');

export interface Drawer {
  /** True while the drawer covers the page: a phone with the drawer open. */
  covers(): boolean;
  /** True while the menu shows: a desktop, or an open drawer. */
  shows(): boolean;
  /** Opens or closes the drawer. */
  set(open: boolean): void;
  /** Closes the drawer on a phone, so the user sees the page after an action in the menu. */
  closeOnPhone(): void;
}

/** `onOpen` runs each time the drawer opens. */
export function setupDrawer(
  ui: { menu: HTMLButtonElement; panel: HTMLElement },
  onOpen: () => void,
): Drawer {
  const open = (): boolean => document.body.classList.contains('menu-open');
  const covers = (): boolean => !desktop.matches && open();

  function set(value: boolean): void {
    if (value === open()) return;
    document.body.classList.toggle('menu-open', value);
    ui.menu.setAttribute('aria-expanded', String(value));
    if (value) onOpen();
  }

  ui.menu.addEventListener('click', () => set(!open()));

  // With the drawer open, a tap outside it only closes it. The capture
  // phase runs before the handlers of the page, so the tap does no lookup.
  document.addEventListener(
    'click',
    (e) => {
      if (!covers()) return;
      const target = e.target as Node;
      if (ui.panel.contains(target) || ui.menu.contains(target)) return;
      e.stopPropagation();
      e.preventDefault();
      set(false);
    },
    true,
  );

  return {
    covers,
    shows: () => desktop.matches || open(),
    set,
    closeOnPhone() {
      if (!desktop.matches) set(false);
    },
  };
}
