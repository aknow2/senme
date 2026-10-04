import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { createServer } from 'vite';

const projectRoot = resolve(import.meta.dirname, '..');
const testRoots = ['tests/integration', 'tests/unit'];
const virtualProbePrefix = 'virtual:vite-runner-probe/';
const virtualProbeModules = [
  `${virtualProbePrefix}alpha.test.ts`,
  `${virtualProbePrefix}zeta.test.ts`,
].sort((left, right) => left.localeCompare(right));
const virtualProbeRegistrationsKey = '__viteRunnerProbeRegistrations';

function moduleName(file) {
  return basename(file).replace(/\.test\.ts$/, '');
}

function selectedModules(files, requested) {
  if (!requested) return files;
  return files.filter((file) => moduleName(file) === requested);
}

async function discoverTestModules() {
  const files = [];
  async function discoverIn(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await discoverIn(join(directory, entry.name));
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.test.ts')) {
        files.push(join(directory, entry.name));
      }
    }
  }
  for (const testRoot of testRoots) {
    await discoverIn(join(projectRoot, testRoot));
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function viteRunnerProbePlugin() {
  return {
    name: 'vite-runner-probes',
    resolveId(id) {
      return id.startsWith(virtualProbePrefix) ? `\0${id}` : null;
    },
    load(id) {
      if (!id.startsWith(`\0${virtualProbePrefix}`)) return null;
      const probeId = id.slice(1);
      return `
        export const probeId = ${JSON.stringify(probeId)};
        export async function registerTests(t) {
          globalThis.${virtualProbeRegistrationsKey}.push(probeId);
          await t.test('vite runner virtual probe ' + probeId, () => {});
        }
      `;
    },
  };
}

test('vite runner discovers, sorts, and registers requested test modules', async (t) => {
  if (process.env.TEST_MODULE && process.env.TEST_MODULE !== 'vite-runner') {
    t.skip('runner contract selected only by TEST_MODULE=vite-runner');
    return;
  }

  assert.deepEqual(
    selectedModules(
      ['/project/tests/unit/zeta.test.ts', '/project/tests/integration/alpha.test.ts'],
      'alpha',
    ),
    ['/project/tests/integration/alpha.test.ts'],
  );
  const discovered = await discoverTestModules();
  assert.deepEqual(discovered, [...discovered].sort((left, right) => left.localeCompare(right)));
  assert.equal(relative(projectRoot, discovered[0] ?? projectRoot).startsWith('..'), false);
});

test('loads every selected registerTests module through one Vite SSR server', async (t) => {
  const requested = process.env.TEST_MODULE;
  const runningProbes = requested === 'vite-runner';
  const modules = runningProbes
    ? virtualProbeModules
    : selectedModules(await discoverTestModules(), requested);
  assert.ok(modules.length > 0, `No test modules matched TEST_MODULE=${requested ?? '(all)'}.`);

  const server = await createServer({
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
    plugins: [viteRunnerProbePlugin()],
  });
  try {
    if (runningProbes) globalThis[virtualProbeRegistrationsKey] = [];
    const loadedProbeIds = [];
    for (const file of modules) {
      const loaded = await server.ssrLoadModule(file);
      assert.equal(typeof loaded.registerTests, 'function', `${file} must export registerTests(t).`);
      if (runningProbes) loadedProbeIds.push(loaded.probeId);
      await loaded.registerTests(t);
    }
    if (runningProbes) {
      assert.deepEqual(loadedProbeIds, virtualProbeModules);
      assert.deepEqual(globalThis[virtualProbeRegistrationsKey], virtualProbeModules);
    }
  } finally {
    delete globalThis[virtualProbeRegistrationsKey];
    await server.close();
  }
});
