// Preloaded into the real server (node --import) by test/helpers/server-modules.js
// when a test makes a package fail to load once: the first CommonJS file of
// DC_TEST_FAIL_PACKAGE_ONCE that runs throws, as a broken package does, whether
// require() or import() loads it (DC_TEST_FAILED_MARKER records that it did).
// Node keeps such an import() failed; a require() can try again. Only the
// explicitly selected copy under node_modules fails. A nested package path
// selects a converter's own dependency without affecting the root copy.
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';

const FAIL_ONCE = process.env.DC_TEST_FAIL_PACKAGE_ONCE;
const FAILED_MARKER = process.env.DC_TEST_FAILED_MARKER;
// Its real path, as Node names its files (node_modules can be a link)
const PACKAGE_DIR = fs.realpathSync(path.join(process.cwd(), 'node_modules', FAIL_ONCE)) + path.sep;

const compileJs = Module._extensions['.js'];
Module._extensions['.js'] = function (module, filename) {
  if (filename.startsWith(PACKAGE_DIR) && !fs.existsSync(FAILED_MARKER)) {
    fs.writeFileSync(FAILED_MARKER, '');
    throw new Error(`${FAIL_ONCE} failed to load (test)`);
  }
  return compileJs.call(this, module, filename);
};
