// ============================================================
// Link — an <a> that navigates in-app (pushState) on a plain click and
// behaves like a normal link otherwise (new tab, copy link, middle-click).
// ============================================================

import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { navigate } from '../router.ts';

interface Props extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  /** Called after an in-app navigation (e.g. to close the mobile drawer). */
  onNavigate?: () => void;
  state?: unknown;
}

export function Link({ href, onNavigate, state, onClick, ...rest }: Props) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(href, state ?? null);
    onNavigate?.();
  };
  return <a href={href} onClick={handle} {...rest} />;
}
