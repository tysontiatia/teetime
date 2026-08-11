import { useEffect } from 'react';

let lockCount = 0;
let lockedScrollY = 0;

function pinStickyHeaderIfNeeded(): (() => void) | undefined {
  const header = document.querySelector('.app-header');
  if (!(header instanceof HTMLElement)) return undefined;

  // After body is offset with top:-scrollY, sticky stops and the header sits at
  // the document top (off-screen). Pin it to the viewport so the freeze matches
  // what the user was seeing.
  if (header.getBoundingClientRect().top >= -1) return undefined;

  const prev = {
    position: header.style.position,
    top: header.style.top,
    left: header.style.left,
    right: header.style.right,
    width: header.style.width,
    zIndex: header.style.zIndex,
  };
  header.style.position = 'fixed';
  header.style.top = '0';
  header.style.left = '0';
  header.style.right = '0';
  header.style.width = '100%';
  header.style.zIndex = 'var(--z-header)';

  return () => {
    header.style.position = prev.position;
    header.style.top = prev.top;
    header.style.left = prev.left;
    header.style.right = prev.right;
    header.style.width = prev.width;
    header.style.zIndex = prev.zIndex;
  };
}

function acquireBodyScrollLock() {
  if (lockCount === 0) {
    lockedScrollY = window.scrollY;
    const { body, documentElement: html } = document;
    // html/body use height:100%, so position:fixed alone shrinks body to the
    // viewport — when scrolled, that leaves empty paper under the scrim (looks
    // like a full blackout). height:auto keeps full page content in place.
    html.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${lockedScrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.height = 'auto';
    body.style.overflow = 'hidden';
  }
  lockCount += 1;

  const unpinHeader = lockCount === 1 ? pinStickyHeaderIfNeeded() : undefined;

  return () => {
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) {
      unpinHeader?.();
      const { body, documentElement: html } = document;
      html.style.overflow = '';
      body.style.position = '';
      body.style.top = '';
      body.style.left = '';
      body.style.right = '';
      body.style.width = '';
      body.style.height = '';
      body.style.overflow = '';
      window.scrollTo(0, lockedScrollY);
    }
  };
}

/** Prevents background scroll while a modal/sheet is open. Safe with nested locks. */
export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    return acquireBodyScrollLock();
  }, [locked]);
}
