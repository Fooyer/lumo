const INTERACTIVE_SELECTOR =
  'button, a, input, select, textarea, label, summary, form, [role="button"], [draggable="true"], [contenteditable="true"]'

/**
 * Whether an event came from something the user can click (a tab, a button, a field, …). Window-level
 * gestures such as double-click-to-maximize must ignore these and act only on empty space.
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null
}
