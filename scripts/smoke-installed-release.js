#!/usr/bin/env node
/** Minimal receiving-host acceptance; never connects a remote device or real home. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createTestEnv } from '../test/helpers/test-env.js';
import { readSearchAnswer } from '../test/helpers/mcp-client.js';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { rgPath } from '@vscode/ripgrep';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const expectedRootIndex = process.argv.indexOf('--expected-root');
if (expectedRootIndex !== -1) {
  const expected = await fs.realpath(process.argv[expectedRootIndex + 1]);
  const actual = await fs.realpath(root);
  const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
  assert.equal(normalize(actual), normalize(expected), 'smoke script must reside in the release being accepted');
}
const testEnv = createTestEnv();
const client = new Client({ name: 'reviewed-source-smoke', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, 'dist/index.js'), '--no-onboarding'],
  cwd: root,
  env: { ...testEnv.env, DESKTOP_COMMANDER_DISABLE_TELEMETRY: '1', DC_FLAG_URL: 'http://127.0.0.1:9/' },
  stderr: 'pipe',
});
let stderr = '';
transport.stderr?.on('data', data => { stderr = (stderr + data.toString()).slice(-4000); });
const text = result => result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
const call = async (name, args) => {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 30_000 });
  assert.ok(!result.isError, `${name}: ${text(result)}`);
  return result;
};
try {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Smoke').addRow(['reviewed', 42]);
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(await workbook.xlsx.writeBuffer());
  assert.equal(restored.getWorksheet('Smoke').getCell('B1').value, 42);
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer();
  assert.equal((await sharp(image).metadata()).width, 2);
  const pdf = await PDFDocument.create();
  pdf.addPage();
  assert.equal((await PDFDocument.load(await pdf.save())).getPageCount(), 1);
  assert.match(execFileSync(rgPath, ['--version'], { encoding: 'utf8' }), /^ripgrep /);

  await client.connect(transport);
  const tools = (await client.listTools()).tools;
  assert.ok(tools.length >= 25);
  assert.ok(tools.every(tool => tool.inputSchema.type === 'object'));
  const file = path.join(testEnv.home, 'reviewed smoke.txt');
  await call('write_file', { path: file, content: 'reviewed-source-smoke\n' });
  assert.match(text(await call('read_file', { path: file })), /reviewed-source-smoke/);
  await call('edit_block', { file_path: file, old_string: 'reviewed-source-smoke', new_string: 'edited-source-smoke' });
  assert.equal(await fs.readFile(file, 'utf8'), 'edited-source-smoke\n');
  const started = await call('start_search', { path: testEnv.home, pattern: 'edited-source-smoke', searchType: 'content', timeout_ms: 5000 });
  const sessionId = readSearchAnswer(started).sessionId;
  assert.ok(sessionId, 'installed search must return its session ID');
  try {
    const deadline = Date.now() + 10_000;
    let page;
    do {
      page = await call('get_more_search_results', { sessionId, offset: 0, length: 100 });
      if (readSearchAnswer(page).isComplete) break;
      assert.ok(Date.now() < deadline, 'installed search must complete');
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (true);
    assert.ok(readSearchAnswer(page).totalMatches > 0, 'installed ripgrep must return an actual result');
    assert.ok(text(page).split('\n').some(line => line.startsWith('📄 ') && line.includes(file) && line.includes('edited-source-smoke')));
  } finally {
    await call('stop_search', { sessionId });
  }
  if (process.platform === 'win32') {
    await call('set_config_value', { key: 'defaultShell', value: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' });
    const command = `& '${process.execPath.replaceAll("'", "''")}' -e "console.log(['source','process','smoke'].join('-'))"`;
    assert.match(text(await call('start_process', { command, timeout_ms: 10_000 })), /source-process-smoke/);
  }
  const resources = (await client.listResources()).resources;
  assert.ok(resources.length >= 2);
  for (const resource of resources) {
    const response = await client.readResource({ uri: resource.uri });
    assert.ok(response.contents.some(item => typeof item.text === 'string' && item.text.length > 100));
  }
  console.log(`PASS: ${root}: installed MCP ${tools.length} tools, text/edit/search/process, ${resources.length} rebuilt UI resources, XLSX/PDF/Sharp/ripgrep; isolated home only.`);
} catch (error) {
  console.error(error.stack);
  if (stderr) console.error(stderr);
  process.exitCode = 1;
} finally {
  try { await client.close(); }
  finally {
    try { await transport.close(); }
    finally { testEnv.cleanup(); }
  }
}
