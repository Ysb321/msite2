/** Native scroll helpers — the page scrolls 100% on the browser's compositor
 *  thread (zero JS in the scroll path = zero lag, immune to main-thread work). */

export function scrollToEl(el: HTMLElement | null, offset = -84) {
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY + offset;
  window.scrollTo({ top, behavior: "smooth" });
}
