import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createTestEnv } from './helpers/test-env.js';
import { runIfMain, skip } from './helpers/run-if-main.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const pwsh = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';

export async function runTests() {
  if (process.platform !== 'win32') return skip('Windows command launcher requires native PowerShell 7');
  const fixture = createTestEnv();
  try {
    const checkout = path.join(fixture.home, 'checkout with spaces');
    fs.mkdirSync(path.join(checkout, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(checkout, 'dist'));
    for (const file of ['desktop-commander.ps1', 'install-command.ps1']) {
      fs.copyFileSync(path.join(root, 'scripts', file), path.join(checkout, 'scripts', file));
    }
    const packageManager = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).packageManager;
    fs.writeFileSync(path.join(checkout, 'package.json'), JSON.stringify({ packageManager }));
    fs.copyFileSync(path.join(root, '.node-version'), path.join(checkout, '.node-version'));
    // An inert CLI proves quoting and exit codes without accessing the real device or config.
    fs.writeFileSync(path.join(checkout, 'dist', 'index.js'),
      'console.log(JSON.stringify(process.argv.slice(2))); if (process.argv[2] === "exit-seven") process.exitCode = 7;');
    const command = path.join(fixture.home, '.local', 'bin', 'desktop-commander.cmd');
    const env = { ...fixture.env, DC_TEST_COMMAND: command };
    const run = args => spawnSync(pwsh, ['-NoLogo', '-NoProfile', ...args], {
      env, encoding: 'utf8', timeout: 30_000,
    });
    const installer = path.join(checkout, 'scripts', 'install-command.ps1');
    let result = run(['-File', installer]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(command));
    result = run(['-Command', '& $env:DC_TEST_COMMAND probe "two words" --flag; exit $LASTEXITCODE']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), ['probe', 'two words', '--flag']);
    result = run(['-Command', '& $env:DC_TEST_COMMAND exit-seven; exit $LASTEXITCODE']);
    assert.equal(result.status, 7, result.stderr);
    result = run(['-Command', `
      $mutex = [Threading.Mutex]::new($true, ('Local\\DesktopCommanderRemote-' + $env:USERNAME.ToLowerInvariant()))
      try { & $env:DC_TEST_COMMAND remote --REPORT; exit $LASTEXITCODE }
      finally { $mutex.Dispose() }
    `]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /already running/,
      'uppercase diagnostic options must not bypass the duplicate guard');
    result = run(['-Command', '& $env:DC_TEST_COMMAND remote --report; exit $LASTEXITCODE']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), ['remote', '--report'],
      'supported diagnostic options remain usable while an agent is running');
    result = run(['-File', installer]);
    assert.equal(result.status, 0, 'reinstalling the same command is harmless');
    fs.appendFileSync(command, 'REM another owner\r\n');
    result = run(['-File', installer]);
    assert.notEqual(result.status, 0, 'installer must preserve a different existing command');
    assert.match(fs.readFileSync(command, 'utf8'), /another owner/);
    fs.renameSync(path.join(checkout, 'dist', 'index.js'), path.join(checkout, 'dist', 'held.js'));
    result = run(['-File', path.join(checkout, 'scripts', 'desktop-commander.ps1'), '--help']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Build the checkout/);
    fs.renameSync(path.join(checkout, 'dist', 'held.js'), path.join(checkout, 'dist', 'index.js'));
    fs.writeFileSync(path.join(checkout, '.node-version'), '0.0.0');
    result = run(['-File', path.join(checkout, 'scripts', 'desktop-commander.ps1'), '--help']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /pinned Node runtime is missing/);
    console.log('Windows command: paths with spaces, arguments, exit status, duplicate guard, installer ownership and missing build pass.');
  } finally {
    fixture.cleanup();
  }
}

await runIfMain(import.meta.url, runTests);
