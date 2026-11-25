import { useCallback, useEffect, useState } from 'react';
import { isEmbeddedBuild } from './services/connection';

/**
 * Client-side routes. "/" is the instrument UI, "/devices" the cloud device manager,
 * "/docs" the documentation page. The remaining three are diagnostics pages that are
 * deliberately not linked from the UI.
 */
export type Route = '/' | '/devices' | '/docs' | '/hw-monitor' | '/serial' | '/log';

const ROUTES: readonly Route[] = ['/devices', '/docs', '/hw-monitor', '/serial', '/log'];

export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '');
  for (const route of ROUTES) {
    if (path.endsWith(route)) return route;
  }
  return '/';
}

/**
 * History routing only works when a server answers every path with index.html
 * (the cloud worker does). Electron loads `file:` and the ESP32 serves a single
 * file, so there the route lives in memory only.
 */
function canUseHistory(): boolean {
  if (isEmbeddedBuild()) return false;
  return window.location.protocol === 'http:' || window.location.protocol === 'https:';
}

export function showDevicesLink(): boolean {
  return canUseHistory();
}

export function useRoute(): { route: Route; navigate: (route: Route) => void } {
  const [route, setRoute] = useState<Route>(() => (canUseHistory() ? parseRoute(window.location.pathname) : '/'));

  useEffect(() => {
    if (!canUseHistory()) return;
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((next: Route) => {
    if (canUseHistory()) {
      // Relative paths keep Vite's `base: './'` assets resolving; never push a trailing slash.
      window.history.pushState(null, '', next === '/' ? './' : `.${next}`);
    }
    setRoute(next);
    window.scrollTo(0, 0);
  }, []);

  return { route, navigate };
}
