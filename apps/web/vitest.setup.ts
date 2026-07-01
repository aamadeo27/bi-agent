import "@testing-library/jest-dom";

// jsdom doesn't implement ResizeObserver — polyfill for component tests.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserverStub;

// jsdom doesn't implement HTMLCanvasElement.getContext; axe-core's color-contrast
// rule calls it and would throw without this stub.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(HTMLCanvasElement.prototype as any).getContext = () => null;

// jsdom doesn't implement Element.scrollTo — used by the ChatTimeline auto-scroll.
Element.prototype.scrollTo = () => {};

// jsdom doesn't implement the Clipboard API.
// Expose a stable stub object so component tests can spy on writeText.
const _clipboardStub: Pick<Clipboard, "writeText" | "readText"> = {
  writeText: (_text: string): Promise<void> => Promise.resolve(),
  readText: (): Promise<string> => Promise.resolve(""),
};
Object.defineProperty(navigator, "clipboard", {
  get: () => _clipboardStub,
  configurable: true,
});
