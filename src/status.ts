// The status strip under the top bar. It has three parts: the player,
// the reading of the pages, and the last event. Only the event part is a
// live region, because the other parts change often.
//
// The strip is one line of a fixed height, so the page under it never
// moves. A long text ends with an ellipsis, and its title attribute holds
// the full text. A phone cannot hover to read the title, so a tap on the
// strip shows the full texts in a panel over the top of the page. While an
// event shows, it takes the place of the player text.

import { stripTexts, type ActionId, type Message } from './messages';

/** Milliseconds that an event message stays before it fades. */
export const EVENT_MS = 6000;

/** Milliseconds of the fade. The same as the transition of #status in style.css. */
const FADE_MS = 600;

function el(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing element #${id}`);
  return e;
}

const strip = el('strip');
const player = el('player-status');
const reading = el('pages-status');
const event = el('status');
const full = el('strip-full');

let fadeTimer: ReturnType<typeof setTimeout> | undefined;
let fullTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Writes a message into `target`: the text in its own element, so that the
 * strip can cut it with an ellipsis, then the link or the button. A click
 * on the button runs the handler of onAction.
 */
export function fill(target: HTMLElement, m: Message): void {
  const text = document.createElement('span');
  text.className = 'text';
  text.textContent = m.text;
  target.replaceChildren(text);
  if (m.link) {
    const a = document.createElement('a');
    a.href = m.link.href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = m.link.text;
    target.append(' ', a);
  }
  if (m.action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action';
    button.dataset.action = m.action.id;
    button.textContent = m.action.text;
    target.append(' ', button);
  }
}

/** Writes a message into a part of the strip, with the full text in the title attribute. */
function fillPart(target: HTMLElement, m: Message): void {
  fill(target, m);
  if (m.text) target.title = m.text;
  else target.removeAttribute('title');
}

let runAction: ((id: ActionId) => void) | null = null;

/** Sets the handler of the buttons that fill makes. */
export function onAction(handler: (id: ActionId) => void): void {
  runAction = handler;
}

/**
 * Shows the full texts of the parts of the strip in a panel over the top of
 * the page, until the next tap or for EVENT_MS. The page does not move.
 */
function showFull(): void {
  const parts = [...strip.children].filter((p): p is HTMLElement => p instanceof HTMLElement);
  const texts = stripTexts(
    parts.map((p) => ({ shown: !p.hidden, title: p.title, text: p.textContent ?? '' })),
  );
  if (texts.length === 0) return;
  full.replaceChildren(
    ...texts.map((text) => {
      const line = document.createElement('p');
      line.textContent = text;
      return line;
    }),
  );
  full.hidden = false;
  clearTimeout(fullTimer);
  fullTimer = setTimeout(hideFull, EVENT_MS);
}

function hideFull(): void {
  clearTimeout(fullTimer);
  full.hidden = true;
}

// A click on a button that fill made runs its action. The next tap closes
// the panel of the full texts. A tap on the strip, not on a link or a
// button in it, opens the panel.
document.addEventListener('click', (e) => {
  const target = e.target instanceof Element ? e.target : null;
  const button = target?.closest('button[data-action]');
  if (button instanceof HTMLButtonElement && button.dataset.action) {
    runAction?.(button.dataset.action as ActionId);
  }
  if (!full.hidden) hideFull();
  else if (target && strip.contains(target) && !target.closest('a, button')) showFull();
});

let lastPlayer = '';

/** Shows the state of the player. Null hides this part. */
export function showPlayer(m: Message | null): void {
  // The clock sends a state four times a second. A new link under the
  // finger can lose a tap, so the part changes only when the text changes.
  const key = m ? `${m.text}|${m.link?.href ?? ''}|${m.action?.id ?? ''}` : '';
  if (key === lastPlayer) return;
  lastPlayer = key;
  player.hidden = m === null;
  fillPart(player, m ?? { text: '' });
}

/** Shows how far the reading of the pages is. Null hides this part. */
export function showReading(m: Message | string | null): void {
  reading.hidden = m === null;
  fillPart(reading, typeof m === 'string' ? { text: m } : (m ?? { text: '' }));
}

/**
 * Shows an event, for example a lookup or an error. It fades after EVENT_MS.
 * While it shows, it takes the place of the player text (style.css): on a
 * phone the parts do not fit in one line. An open panel of the full texts
 * shows the new event too.
 */
export function say(m: Message | string): void {
  fillPart(event, typeof m === 'string' ? { text: m } : m);
  event.classList.remove('faded');
  strip.classList.add('event');
  if (!full.hidden) showFull();
  clearTimeout(fadeTimer);
  fadeTimer = setTimeout(() => {
    event.classList.add('faded');
    fadeTimer = setTimeout(() => {
      event.replaceChildren();
      event.removeAttribute('title');
      event.classList.remove('faded');
      strip.classList.remove('event');
    }, FADE_MS);
  }, EVENT_MS);
}
