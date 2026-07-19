import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";

class TestResizeObserver implements ResizeObserver {
  disconnect(): void {}
  observe(): void {}
  unobserve(): void {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: TestResizeObserver,
});

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string): MediaQueryList => ({
    addEventListener: () => undefined,
    addListener: () => undefined,
    dispatchEvent: () => false,
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: () => undefined,
    removeListener: () => undefined,
  }),
});
