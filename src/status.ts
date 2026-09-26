// The status strip under the top bar. It has three parts: the player,
// the reading of the pages, and the last event. Only the event part is a
// live region, because the other parts change often.

import type { Message } from './messages';

/** Milliseconds that an event message stays before it fades. */
export const EVENT_MS = 6000;

/** Milliseconds of the fade. The same as the transition of #status in style.css. */
const FADE_MS = 600;

function el(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing element #${id}`);
  return e;
}

const player = el('player-status');
const reading = el('pages-status');
const event = el('status');

let fadeTimer: ReturnType<typeof setTimeout> | undefined;

/** Writes a message into `target`: the text, then the link. */
function fill(target: HTMLElement, m: Message): void {
  target.textContent = m.text;
  if (m.link) {
    const a = document.createElement('a');
    a.href = m.link.href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = m.link.text;
    target.append(' ', a);
  }
}

let lastPlayer = '';

/** Shows the state of the player. Null hides this part. */
export function showPlayer(m: Message | null): void {
  // The clock sends a state four times a second. A new link under the
  // finger can lose a tap, so the part changes only when the text changes.
  const key = m ? `${m.text}|${m.link?.href ?? ''}` : '';
  if (key === lastPlayer) return;
  lastPlayer = key;
  player.hidden = m === null;
  fill(player, m ?? { text: '' });
}

/** Shows how far the reading of the pages is. Null hides this part. */
export function showReading(text: string | null): void {
  reading.hidden = text === null;
  reading.textContent = text ?? '';
}

/** Shows an event, for example a lookup or an error. It fades after EVENT_MS. */
export function say(m: Message | string): void {
  fill(event, typeof m === 'string' ? { text: m } : m);
  event.classList.remove('faded');
  clearTimeout(fadeTimer);
  fadeTimer = setTimeout(() => {
    event.classList.add('faded');
    fadeTimer = setTimeout(() => {
      event.replaceChildren();
      event.classList.remove('faded');
    }, FADE_MS);
  }, EVENT_MS);
}
