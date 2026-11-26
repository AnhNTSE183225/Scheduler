import { createSignal, onCleanup, onMount } from 'solid-js';

/**
 * Reactive viewport check (`< 768px`) so mobile-only remodel components
 * never alter the desktop layout.
 */
export function useIsMobile() {
  const query = '(max-width: 767px)';
  const [isMobile, setIsMobile] = createSignal(
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );

  onMount(() => {
    const mql = window.matchMedia(query);
    setIsMobile(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', onChange);
    onCleanup(() => mql.removeEventListener('change', onChange));
  });

  return isMobile;
}
