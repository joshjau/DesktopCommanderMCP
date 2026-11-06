#!/usr/bin/env node
/** Compare the maintained manifest with the actual local MCP tool list. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createTestEnv } from '../test/helpers/test-env.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const manifest = JSON.parse((await readFile(new URL('../manifest.template.json', import.meta.url), 'utf8'))
  .replace('{{VERSION}}', packageJson.version));
const testEnv = createTestEnv();
const client = new Client({ name: 'validate-tools-sync', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../dist/index.js', import.meta.url)), '--no-onboarding'],
  cwd: root,
  env: { ...testEnv.env, DESKTOP_COMMANDER_DISABLE_TELEMETRY: '1', DC_FLAG_URL: 'http://127.0.0.1:9/' },
  stderr: 'pipe',
});
let stderr = '';
transport.stderr?.on('data', data => { stderr = (stderr + data.toString()).slice(-4000); });
try {
  await client.connect(transport);
  const { tools } = await client.listTools({}, { timeout: 30_000 });
  const names = tools.map(tool => tool.name).sort();
  assert.deepEqual(names, manifest.tools.map(tool => tool.name).sort(), 'manifest and MCP tool list differ');
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, 'object', `${tool.name} must publish object input`);
    assert.ok(tool.inputSchema.properties, `${tool.name} must publish parameter properties`);
  }
  console.log(`PASS: maintained manifest and live local MCP agree on all ${tools.length} tools with object input schemas.`);
} catch (error) {
  console.error(error.message);
  if (stderr) console.error(stderr);
  process.exitCode = 1;
} finally {
  try { await client.close(); }
  finally {
    try { await transport.close(); }
    finally { testEnv.cleanup(); }
  }
}
