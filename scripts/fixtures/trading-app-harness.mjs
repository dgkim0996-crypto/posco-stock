import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { transformSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import React from 'react';
import { createRoot } from 'react-dom/client';

const requirePackage = createRequire(import.meta.url);
const rootPath = path.resolve(import.meta.dirname, '../..');

/** 실제 API/인증 대신 기존 격리 fixture로 React 화면을 실행한다. */
export async function mountTradingApp({ sourceOverride, storage = {} } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost' });
  const saved = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
  const calls = [];
  const oldFetch = globalThis.fetch;
  const oldSocket = globalThis.WebSocket;
  const nativeRandom = Math.random;
  Math.random = () => 0.5;
  window.setInterval = () => 0;
  window.clearInterval = () => {};
  window.setTimeout = () => 0;
  window.clearTimeout = () => {};
  window.matchMedia = () => ({ matches: false });
  window.confirm = () => true;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value);
  globalThis.WebSocket = class { static OPEN = 1; readyState = 0; addEventListener() {} close() {} };
  globalThis.fetch = async (url) => {
    calls.push({ url, method: 'GET', public: true });
    return new Response(JSON.stringify({ items: [], candles: [
      { time: 1750000000000, open: 330000, high: 334000, low: 327000, close: 331000, volume: 1000 },
      { time: 1750000060000, open: 331000, high: 335000, low: 328000, close: 332000, volume: 1500 },
    ] }));
  };
  const cache = new Map();
  function load(filename) {
    filename = path.resolve(filename);
    if (cache.has(filename)) return cache.get(filename).exports;
    if (/\.(css|png)$/.test(filename)) return { default: filename };
    const module = { exports: {} };
    cache.set(filename, module);
    if (['src/lib/supabase.js', 'src/utils/api.js'].some((p) => filename === path.join(rootPath, p))) {
      const fixture = load(path.join(rootPath, 'scripts/fixtures/brokerage-ui.js'));
      module.exports = { ...fixture, apiFetch: async (url, options = {}) => {
        calls.push({ url, method: options.method || 'GET', body: JSON.parse(options.body || '{}') });
        return fixture.apiFetch(url, options);
      } };
      return module.exports;
    }
    let source = sourceOverride && filename === path.join(rootPath, 'src/App.jsx')
      ? sourceOverride : fs.readFileSync(filename, 'utf8');
    // React.lazy stays asynchronous while using this isolated module registry.
    source = source.replace(/import\((["'])([^"']+)\1\)/g, 'Promise.resolve(require("$2"))');
    const code = transformSync(source, { loader: filename.endsWith('.jsx') ? 'jsx' : 'js', format: 'cjs', jsx: 'automatic' }).code;
    const localRequire = (specifier) => specifier.startsWith('.')
      ? load(path.resolve(path.dirname(filename), specifier)) : requirePackage(specifier);
    new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
    return module.exports;
  }
  const App = load(path.join(rootPath, 'src/App.jsx')).default;
  const container = document.getElementById('root');
  const root = createRoot(container);
  await React.act(async () => { root.render(React.createElement(App)); });
  return {
    container, calls,
    async click(element) {
      if (!element) throw new Error('Expected an existing UI element');
      await React.act(async () => element.click());
    },
    button(label, scope = container) {
      return [...scope.querySelectorAll('button')].find((button) => button.textContent.trim() === label);
    },
    async change(element, value) {
      if (!element) throw new Error('Expected an existing input');
      const prototype = element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
      await React.act(async () => {
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
        element.dispatchEvent(new window.Event('change', { bubbles: true }));
        element.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
    },
    async close() {
      await React.act(async () => root.unmount());
      dom.window.close();
      globalThis.fetch = oldFetch;
      globalThis.WebSocket = oldSocket;
      Math.random = nativeRandom;
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}
