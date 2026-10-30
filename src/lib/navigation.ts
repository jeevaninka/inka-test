/**
 * Modifier-click navigation helpers.
 *
 * Plain `router.push()` in a click handler swallows Cmd/Ctrl/Shift-clicks, so a
 * user cannot open a case, run or report in a new tab the way they can with a
 * normal anchor. These helpers keep the fast client-side navigation for plain
 * clicks and fall back to a new tab when the click is modified.
 */

export interface ModifierClickLike {
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  button?: number;
}

/** Cmd (macOS), Ctrl (Windows/Linux), Shift, Alt, or a middle-button click. */
export function isModifiedClick(event?: ModifierClickLike | null): boolean {
  if (!event) return false;
  return Boolean(
    event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button === 1
  );
}

/** Open `href` in a new tab without leaking the opener. */
export function openInNewTab(href: string): void {
  if (typeof window === 'undefined' || !href) return;
  window.open(href, '_blank', 'noopener,noreferrer');
}

/**
 * Navigate with modifier support.
 *
 * ```tsx
 * onClick={(e) => navigateTo(e, href, router.push)}
 * ```
 *
 * Returns `true` when the click was redirected to a new tab, so callers can
 * stop further work (e.g. closing a menu, selecting a row).
 */
export function navigateTo(
  event: ModifierClickLike | null | undefined,
  href: string,
  push: (href: string) => void
): boolean {
  if (!href) return false;
  if (isModifiedClick(event)) {
    openInNewTab(href);
    return true;
  }
  push(href);
  return false;
}
