import { signal } from '@preact/signals';

export type Route =
  | { name: 'routes' }
  | { name: 'edit'; route: string }
  | { name: 'run' };

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  if (h === 'run') return { name: 'run' };
  if (h.startsWith('edit/')) {
    try { return { name: 'edit', route: decodeURIComponent(h.slice(5)) }; } catch { /* fallthrough */ }
  }
  return { name: 'routes' };
}

export function hrefFor(r: Route): string {
  switch (r.name) {
    case 'routes': return '#/';
    case 'run': return '#/run';
    case 'edit': return `#/edit/${encodeURIComponent(r.route)}`;
  }
}

export const route = signal<Route>(typeof location !== 'undefined' ? parseHash(location.hash) : { name: 'routes' });

export function navigate(r: Route) { location.hash = hrefFor(r); }

if (typeof addEventListener !== 'undefined') {
  addEventListener('hashchange', () => { route.value = parseHash(location.hash); });
}