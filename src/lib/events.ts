import { useEffect } from 'react';

// Pages call this after changing groups or progress, so the sidebar refetches.
export const notifyChanged = () => window.dispatchEvent(new Event('sb:changed'));

export function useOnChanged(fn: () => void) {
  useEffect(() => {
    window.addEventListener('sb:changed', fn);
    return () => window.removeEventListener('sb:changed', fn);
  }, [fn]);
}
