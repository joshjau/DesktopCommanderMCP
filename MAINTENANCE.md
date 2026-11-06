# GamingPC reviewed source build

This fork starts from upstream Desktop Commander **v0.3.1** (MIT). It retains
the remote protocol, device pairing and configuration locations. It is a local
maintenance build, not an official Desktop Commander release.

## What changes

- Zod 4 replaces Zod 3 and the archived JSON Schema converter. Tool schemas are
  checked against the released v0.3.1 contracts, including defaults and unknown
  parameter handling.
- Both browser UIs are rebuilt from source and the locked patched dependencies.
  Build provenance records actual bundle inputs and output hashes.
- The unused direct `glob` dependency is removed. Compatible dependency updates
  and upstream's root overrides are retained in the lockfile.
- Unused `nexe` and release-only `@anthropic-ai/mcpb` are excluded from this
  fork's development install. Native Node watch replaces `nodemon`. The UI
  builder uses patched esbuild. Upstream npm/MCPB publishing is not supported
  by this maintenance workflow; do not invoke the upstream release scripts or
  download release tools with `npx`.

## Rebuild and validate

Use native PowerShell 7 on GamingPC and the Node version in `.node-version`
with npm 12.2.2. Keep the runtime directory first in this child process's PATH.

```powershell
npm ci --ignore-scripts --install-links
npm run build
npm audit
npm audit signatures
npm ls --all
node test/run-all-tests.js
node scripts/validate-tools-sync.js
node scripts/smoke-installed-release.js
```

Lifecycle scripts stay disabled during installation; build explicitly after
reviewing source. `install-links=true` is required for the bundled local
telemetry-contract dependency. Run tests through their isolated-home runner,
never import the server against the real user home for tests. Native ripgrep
comes from the locked platform package; check it before search acceptance.
The manifest validator and receiving-host smoke command also use isolated
temporary homes and disable telemetry and production feature-flag calls.

## Install and preserve access

Deploy only the exact published, validated commit into an immutable directory:
`%LOCALAPPDATA%\Programs\DesktopCommanderRemote\releases\<full-commit>`.
Copy the validated `dist` output, install production dependencies from its
committed lock with `npm ci --omit=dev --ignore-scripts --install-links`, then
perform isolated local MCP and native-module smoke checks. Retain a local
`release-receipt.json` with the source commit and SHA256 hashes of the lock,
entry point and rebuilt UI outputs. Host receipts and dependencies are not Git
source.

The reviewed `scripts/start-reviewed-remote.ps1` checks the receipt, exact Node
version, existing agents and the launch mutex. Copy the tracked
`scripts/Start-DesktopCommanderRemote.ps1` wrapper into the existing shortcut
directory. Its local `approved-release.json` selects `sourceCommit` and
`nodePath`; it delegates to the immutable release. It never installs packages at launch.
Keep one remote agent; leave a running agent and its jobs alive until a safe
handoff. Pairing/configuration remain in their original user directories.

Keep the previous launcher as a rollback file. Restoring it selects the official
`@latest` package on the next start; it does not change an already running
agent. Do not activate automatic startup, reset pairing or stop unrelated
processes. Source changes are committed and pushed to this fork; no upstream
PR, npm publication or hosted CI is part of this workflow.

## Validated on GamingPC, 2026-11-06

- npm audit reported zero advisories in the full locked development/runtime
  tree. All 644 installed registry packages had verified signatures; 79 had
  verified attestations. This is a registry-advisory check, not a comprehensive
  security certification.
- All 182 unit/regression modules were covered by the full run and affected
  reruns. The initial run passed 179/181; its two failures were corrected and
  the final nine affected modules passed. The added Phoenix fixture test also
  passes with explicit heartbeat deadlines.
- All 26 released tool input schemas match exactly; 547 frozen baseline JSON
  validation cases pass. Non-JSON infinities are now rejected and inherited
  record properties ignored by Zod 4.
- Five Windows-applicable session restart integration cases pass, including
  token rotation, transient HTTP 500 recovery, persistence and durable logout.
- Eight unit checks and one integration check require another OS or privileges
  unavailable to this non-elevated Windows user and remain skipped.
- Real rebuilt UI bundles pass inert host/DOM tests, including editor mount,
  settings edits, source/lock provenance and no unsolicited writes. Live
  ChatGPT widget rendering and visual layout are outside this local proof.
