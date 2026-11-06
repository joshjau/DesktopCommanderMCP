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
- The maintained build uses TypeScript 7, Node 26 typings, MCP Apps 2,
  jsdom 31, markdown-it 15, isbinaryfile 6, open 11, Commander 15 and unpdf 2.
  Unused `ts-node` is removed; the existing `tsx` development commands remain.
  The dependency minimum is Node 24.15; GamingPC uses the exact Node 26.13.0 pin.
- PDF image extraction handles unpdf 2's RGBA bytes explicitly. The text
  converter uses pdf2md 0.3.6, whose upstream font-metadata fix permits its
  compatible unpdf 1.9.1 dependency without the former 1.8.1 override. The root
  image reader and text reader retain their own supported version ranges and
  are tested together, including the production-only installation.
- MCP Apps 2 retains the existing UI protocol and host-side model-context
  capability negotiation. Partial host theme tokens, editor mount, settings
  edits and teardown are checked against the actual rebuilt bundles.
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

Retain the former official launcher as historical recovery evidence only. Its
`npx @latest` route can download the vulnerable published package again;
returning to official requires a fresh security/compatibility review and an idle
handoff. Keep the validated source release, receipt, approved selection and
pairing outside any cache cleanup target.

The old official npm execution cache was removed on 2026-11-06 after verifying
its physical boundary and lack of active consumers. The reviewed RDC agent
remained online; package metadata and baseline hashes were retained separately.
For later cache cleanup, first verify that the exact superseded directory has
no links, mounts or active jobs. Do not activate automatic startup, reset pairing
or stop unrelated processes. Source changes are committed and pushed to this
fork; no upstream PR, npm publication or hosted CI is part of this workflow.

## Validated on GamingPC, 2026-11-06

- npm audit reported zero advisories in the full locked development/runtime
  tree. All 655 installed registry packages had verified signatures; 99 had
  verified attestations. This is a registry-advisory check, not a comprehensive
  security certification.
- The major-toolchain baseline's 182 unit/regression modules were validated by the full run and four
  affected reruns. The startup failure-injection fixture now targets the text
  converter's separate dependency. PDF RGBA pixels/dimensions and the existing
  UI protocol with partial theme updates have explicit regression coverage.
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
- The installed-release smoke check reads synthetic PDF text and an embedded
  image through the real MCP tool, in addition to file/edit/search/process,
  XLSX, Sharp, ripgrep and both rebuilt UI resources.

### PDF maintenance follow-up

Only pdf2md 0.3.4 to 0.3.6 and its compatible nested unpdf 1.8.1 to 1.9.1
changed in the locked dependency graph. The temporary font-compatibility
override is removed. Eight affected PDF/startup/UI-provenance modules passed
their checks and focused rerun, including an actual PDF font regression checked
through a Markdown renderer. The local MCP/native smoke check and registry
audit, signature and dependency-consistency checks passed. Reuse the baseline
release gates for unchanged code; install and accept the exact published commit
before an idle RDC handoff.
