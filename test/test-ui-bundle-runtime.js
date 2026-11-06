import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = fileURLToPath(new URL('..', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, description) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `Timed out waiting for ${description}`);
    await sleep(10);
  }
}

async function mountBundle(target, callTool, hostContext = {}) {
  const errors = [];
  const calls = [];
  const messages = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(error.message));
  const directory = path.join(root, 'dist/ui', target);
  const html = await fs.readFile(path.join(directory, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: `https://ui.fixture.invalid/${target}/`,
    runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  const host = new JSDOM('', { url: 'https://host.fixture.invalid/' });
  const { window } = dom;
  Object.defineProperty(window, 'parent', { value: host.window });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.TextEncoder = globalThis.TextEncoder;
  window.TextDecoder = globalThis.TextDecoder;
  const rejectNetwork = () => { throw new Error('Network access is forbidden in the UI fixture'); };
  window.fetch = rejectNetwork;
  window.XMLHttpRequest = rejectNetwork;
  window.WebSocket = rejectNetwork;
  window.EventSource = rejectNetwork;
  window.navigator.sendBeacon = rejectNetwork;
  window.console.error = (...args) => errors.push(args.map(String).join(' '));
  const send = (message, source = host.window) => window.dispatchEvent(new window.MessageEvent('message', {
    data: message, origin: 'https://host.fixture.invalid', source,
  }));
  host.window.postMessage = (message) => {
    messages.push(message);
    if (!Object.hasOwn(message, 'id') || typeof message.method !== 'string') return;
    void Promise.resolve().then(async () => {
      try {
        let result;
        if (message.method === 'ui/initialize') {
          assert.equal(message.params.appCapabilities.updateModelContext, undefined,
            'context updates belong to host capabilities');
          result = { protocolVersion: '2026-01-26',
            hostInfo: { name: 'Inert UI test host', version: '1.0.0' },
            hostCapabilities: { serverTools: {}, updateModelContext: {} },
            hostContext: { theme: 'light', displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'],
              initiallyExpanded: true, ...hostContext } };
        } else if (message.method === 'tools/call') {
          calls.push(message.params);
          result = await callTool(message.params.name, message.params.arguments);
        } else if (message.method === 'ui/update-model-context') {
          result = {};
        } else {
          throw new Error(`Unexpected UI request: ${message.method}`);
        }
        send({ jsonrpc: '2.0', id: message.id, result });
      } catch (error) {
        errors.push(error.message);
        send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error.message } });
      }
    });
  };
  const runtime = target === 'file-preview' ? 'preview-runtime.js' : 'config-editor-runtime.js';
  window.eval(await fs.readFile(path.join(directory, runtime), 'utf8'));
  await waitFor(() => messages.some((message) => message.method === 'ui/notifications/initialized'), 'real SDK handshake');
  return { window, calls, errors, send,
    async close() {
      send({ jsonrpc: '2.0', id: 'fixture-teardown', method: 'ui/resource-teardown', params: {} });
      await waitFor(() => messages.some((message) => message.id === 'fixture-teardown' && Object.hasOwn(message, 'result')), 'UI teardown');
      window.close();
      host.window.close();
      assert.deepEqual(errors, [], 'UI lifecycle must remain error-free through teardown');
    } };
}

async function testFilePreviewBundle() {
  const markdown = '# Preserved heading\n\n| A | B |\n|---|---|\n| one | two |\n\nLiteral ~/Documents and [[Other Note]].\n';
  const result = { content: [{ type: 'text', text: markdown }], structuredContent: {
    fileName: 'fixture.md', filePath: 'C:/synthetic/fixture.md', fileType: 'markdown', sourceTool: 'read_file',
  } };
  const view = await mountBundle('file-preview', (name) => {
    if (name === 'read_file') return result;
    if (name === 'track_ui_event') return { content: [{ type: 'text', text: 'Tracked synthetic UI event' }] };
    throw new Error(`Unexpected preview tool: ${name}`);
  }, { displayMode: 'fullscreen' });
  try {
    const input = { jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: { path: 'C:/synthetic/fixture.md' } } };
    view.send(input, view.window);
    await sleep(30);
    assert.equal(view.calls.filter((call) => call.name === 'read_file').length, 0, 'foreign frames cannot supply tool input');
    view.send(input);
    await waitFor(() => view.window.document.querySelector('[contenteditable="true"]'), 'rebuilt Tiptap editor');
    const editor = view.window.document.querySelector('[contenteditable="true"]');
    assert.ok(editor.textContent.includes('Preserved heading'));
    assert.equal(editor.querySelectorAll('table td').length, 2, 'the rebuilt editor retains real table extensions');
    assert.ok(editor.textContent.includes('~/Documents'));
    assert.ok(view.calls.filter((call) => call.name === 'read_file').every((call) => call.arguments.origin === 'ui'));
    assert.equal(view.calls.filter((call) => call.name === 'edit_block' || call.name === 'write_file').length, 0,
      'opening a document must not rewrite it');
    assert.deepEqual(view.errors, []);
  } finally {
    await view.close();
  }
  console.log('PASS rebuilt file-preview IIFE: real host handshake/source guard, Tiptap/table mount, no unsolicited writes');
}

async function testConfigEditorBundle() {
  let enabled = false;
  const view = await mountBundle('config-editor', (name, args) => {
    if (name === 'get_config') return { content: [], structuredContent: { entries: [
      { key: 'telemetryEnabled', value: enabled, valueType: 'boolean', editable: true },
    ] } };
    if (name === 'set_config_value') {
      assert.equal(args.key, 'telemetryEnabled');
      assert.equal(typeof args.value, 'boolean');
      enabled = args.value;
      return { content: [{ type: 'text', text: 'Updated synthetic setting' }] };
    }
    if (name === 'track_ui_event') return { content: [] };
    throw new Error(`Unexpected config tool: ${name}`);
  }, { theme: 'dark', styles: { variables: { '--color-background-primary': 'rgb(1, 2, 3)' } } });
  try {
    await waitFor(() => view.window.document.querySelector('[data-action="toggle-boolean"]'), 'synthetic config payload');
    assert.equal(view.window.document.documentElement.dataset.theme, 'dark');
    assert.equal(view.window.document.documentElement.style.getPropertyValue('--color-background-primary'), 'rgb(1, 2, 3)',
      'partial host style tokens remain supported');
    view.window.document.querySelector('[data-action="toggle-boolean"]').click();
    await waitFor(() => enabled, 'typed config update through the real bridge');
    assert.ok(view.calls.some((call) => call.name === 'set_config_value'));
    assert.deepEqual(view.errors, []);
  } finally {
    await view.close();
  }
  console.log('PASS rebuilt config-editor IIFE: real host handshake, read/render, typed edit through inert tool bridge');
}

await testFilePreviewBundle();
await testConfigEditorBundle();
