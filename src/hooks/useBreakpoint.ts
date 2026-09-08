import { useEffect, useState } from 'react';

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

function getBreakpoint(w: number): Breakpoint {
  if (w < 768) return 'mobile';
  if (w < 1024) return 'tablet';
  return 'desktop';
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(() =>
    typeof window === 'undefined' ? 'desktop' : getBreakpoint(window.innerWidth)
  );

  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setBp(getBreakpoint(window.innerWidth)));
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return bp;
}

export function useIsDesktop(): boolean {
  return useBreakpoint() === 'desktop';
}

export function useIsMobile(): boolean {
  return useBreakpoint() === 'mobile';
}