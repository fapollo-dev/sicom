import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());

// Polyfills do jsdom para componentes do DS (DataTable usa matchMedia/ResizeObserver
// para responsivo/auto-fit; jsdom não os implementa).
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

if (!(globalThis as any).ResizeObserver) {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// canvas getContext (auto-fit do DataTable mede texto via canvas)
if (typeof HTMLCanvasElement !== 'undefined' && !HTMLCanvasElement.prototype.getContext) {
  // @ts-expect-error jsdom polyfill mínimo
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: () => ({ width: 0 }) });
}
