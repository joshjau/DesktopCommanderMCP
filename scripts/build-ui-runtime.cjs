#!/usr/bin/env node
/**
 * Build script that compiles and stages browser UI assets used by MCP tool pages. It centralizes bundling/runtime generation so UI resources are deterministic in local dev and CI.
 */
const path = require('path');
const fs = require('fs/promises');
const { createHash } = require('node:crypto');
const { build } = require('esbuild');

const target = process.argv[2];

const TARGETS = {
  'file-preview': {
    entry: 'src/ui/file-preview/src/main.ts',
    output: 'dist/ui/file-preview/preview-runtime.js',
    staticDir: 'src/ui/file-preview',
    styleLayers: [
      'src/ui/styles/base.css',
      'src/ui/styles/components/compact-row.css',
      'src/ui/styles/apps/file-preview.css'
    ]
  },
  'config-editor': {
    entry: 'src/ui/config-editor/src/main.ts',
    output: 'dist/ui/config-editor/config-editor-runtime.js',
    staticDir: 'src/ui/config-editor',
    styleLayers: [
      'src/ui/styles/base.css',
      'src/ui/styles/components/compact-row.css',
      'src/ui/styles/apps/config-editor.css'
    ]
  }
};

const STATIC_FILES = ['index.html'];
const projectRoot = path.resolve(__dirname, '..');

function relativePath(filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join('/');
}

async function fileHash(filePath) {
  return createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

async function writeProvenance(targetName, result, staticInputs) {
  const lockPath = path.join(projectRoot, 'package-lock.json');
  const lock = JSON.parse(await fs.readFile(lockPath, 'utf8'));
  const packages = new Map();
  const inputs = [];
  for (const [input, metadata] of Object.entries(result.metafile.inputs).sort(([a], [b]) => a.localeCompare(b))) {
    const absolute = path.resolve(projectRoot, input);
    inputs.push({ path: relativePath(absolute), sha256: await fileHash(absolute), bytes: metadata.bytes });
    if (!input.split(/[\\/]/).includes('node_modules')) continue;
    let directory = path.dirname(absolute);
    while (directory !== projectRoot) {
      const manifestPath = path.join(directory, 'package.json');
      try {
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
        if (!manifest.name || !manifest.version) {
          directory = path.dirname(directory);
          continue;
        }
        const location = relativePath(directory);
        if (lock.packages?.[location]?.version !== manifest.version) {
          throw new Error(`UI dependency does not match package-lock.json: ${location}`);
        }
        packages.set(location, { path: location, name: manifest.name, version: manifest.version,
          manifestSha256: await fileHash(manifestPath) });
        break;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const parent = path.dirname(directory);
        if (parent === directory) throw new Error(`UI dependency manifest not found: ${input}`);
        directory = parent;
      }
    }
  }
  const outputDir = path.dirname(path.join(projectRoot, TARGETS[targetName].output));
  const outputs = await Promise.all([TARGETS[targetName].output, relativePath(path.join(outputDir, 'index.html')),
    relativePath(path.join(outputDir, 'styles.css'))].map(async (file) => ({ path: file,
      sha256: await fileHash(path.join(projectRoot, file)) })));
  const provenance = { schemaVersion: 1, target: targetName, entry: TARGETS[targetName].entry,
    esbuildVersion: require('esbuild/package.json').version,
    packageLockSha256: await fileHash(lockPath),
    buildScriptSha256: await fileHash(__filename),
    inputs, staticInputs: await Promise.all(staticInputs.map(async (file) => ({ path: file,
      sha256: await fileHash(path.join(projectRoot, file)) }))),
    packages: [...packages.values()].sort((a, b) => a.path.localeCompare(b.path)), outputs };
  await fs.writeFile(path.join(outputDir, 'build-provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
}

const selectedTargets =
  target
    ? [target]
    : Object.keys(TARGETS);

if (target && !TARGETS[target]) {
  console.error(
    `Usage: node scripts/build-ui-runtime.cjs [${Object.keys(TARGETS).join('|')}]`
  );
  process.exit(1);
}

async function buildTarget(targetName) {
  const { entry, output, staticDir, styleLayers } = TARGETS[targetName];
  const outputPath = path.join(projectRoot, output);
  const outputDir = path.dirname(outputPath);

  await fs.mkdir(outputDir, { recursive: true });

  for (const fileName of STATIC_FILES) {
    await fs.copyFile(
      path.join(projectRoot, staticDir, fileName),
      path.join(outputDir, fileName)
    );
  }

  const styles = await Promise.all(
    styleLayers.map((layerPath) => fs.readFile(path.join(projectRoot, layerPath), 'utf8'))
  );
  await fs.writeFile(path.join(outputDir, 'styles.css'), `${styles.join('\n\n')}\n`, 'utf8');

  const result = await build({
    absWorkingDir: projectRoot,
    entryPoints: [path.join(projectRoot, entry)],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    outfile: outputPath,
    minify: true,
    sourcemap: false,
    metafile: true
  });
  await writeProvenance(targetName, result, [...STATIC_FILES.map((fileName) => `${staticDir}/${fileName}`), ...styleLayers]);
}

async function main() {
  for (const targetName of selectedTargets) {
    await buildTarget(targetName);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
