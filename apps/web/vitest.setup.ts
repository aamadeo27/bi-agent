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
