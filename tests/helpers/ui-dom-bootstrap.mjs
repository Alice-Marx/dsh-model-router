import { JSDOM } from 'jsdom'

// Browser modules can import react-dom before a test mounts its own fixture.
// Give feature detection a DOM at module-load time, as it has in the shipped UI.
// Each specification still installs and restores its own isolated document.
if (typeof globalThis.window === 'undefined') {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://ui-bootstrap.fixture/', pretendToBeVisual: true })
  for (const key of ['window', 'document', 'Element', 'HTMLElement']) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? dom.window : dom.window[key] })
  }
}
