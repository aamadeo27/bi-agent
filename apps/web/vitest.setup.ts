import "@testing-library/jest-dom";

// jsdom doesn't implement ResizeObserver — polyfill for component tests.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserverStub;
