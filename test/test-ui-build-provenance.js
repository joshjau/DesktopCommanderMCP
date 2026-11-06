import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const hash = async (file) => createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex');
const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));

for (const target of ['file-preview', 'config-editor']) {
  const receipt = JSON.parse(await fs.readFile(path.join(root, 'dist/ui', target, 'build-provenance.json'), 'utf8'));
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.target, target);
  assert.equal(receipt.packageLockSha256, await hash('package-lock.json'), 'bundles must use the reviewed lock');
  assert.equal(receipt.buildScriptSha256, await hash('scripts/build-ui-runtime.cjs'));
  assert.ok(receipt.inputs.some((input) => input.path === receipt.entry), 'the actual UI entry must be bundled');
  assert.ok(receipt.packages.some((pkg) => pkg.name === '@modelcontextprotocol/ext-apps'), 'the real host SDK must be bundled');
  for (const file of [...receipt.inputs, ...receipt.staticInputs, ...receipt.outputs]) {
    assert.ok(!path.isAbsolute(file.path) && !file.path.split('/').includes('..'), 'receipts must use project-relative paths');
    assert.equal(file.sha256, await hash(file.path), `stale UI build input/output: ${file.path}`);
  }
  for (const pkg of receipt.packages) {
    assert.equal(pkg.version, lock.packages[pkg.path]?.version, `unlocked bundle dependency: ${pkg.name}`);
    assert.equal(pkg.manifestSha256, await hash(`${pkg.path}/package.json`));
  }
  if (target === 'file-preview') {
    for (const name of ['@tiptap/core', '@tiptap/starter-kit', '@tiptap/extension-table', 'tiptap-markdown']) {
      assert.ok(receipt.packages.some((pkg) => pkg.name === name), `the shipped editor must actually bundle ${name}`);
    }
  }
  console.log(`PASS ${target}: ${receipt.inputs.length} source inputs, ${receipt.packages.length} locked dependencies, and all output hashes verified`);
}
