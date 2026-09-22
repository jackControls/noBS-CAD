// Small contract checks for the repository's workflow layout. Validate full
// YAML/expression syntax with actionlint when changing the workflows too.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { flagshipTests } from './run-mcp-tests.mjs';

const read = file => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const desktop = read('.github/workflows/desktop-packages.yml');
const mcp = read('.github/workflows/mcp-server.yml');
const version = read('.github/workflows/version-guard.yml');
const warmer = read('.github/workflows/windows-occt-cache.yml');
const sdk = read('.github/actions/setup-windows-occt/action.yml');

function job(source, id) {
  const match = source.match(new RegExp(`^  ${id}:\\n([\\s\\S]*?)(?=^  [\\w-]+:|$(?![\\s\\S]))`, 'm'));
  assert(match, `Missing job: ${id}`);
  return match[1];
}

test('every package job requires both successful cheap preflights, including tags/manual builds', () => {
  assert.match(job(desktop, 'frontend_regressions'), /uses: \.\/\.github\/workflows\/frontend.yml/);
  assert.match(job(desktop, 'version_preflight'), /uses: \.\/\.github\/workflows\/version-guard.yml/);
  for (const name of ['build-windows-portable', 'build-linux-ubuntu', 'build-macos-apple-silicon']) {
    const config = job(desktop, name);
    assert.match(config, /needs: \[classify_changes, frontend_regressions, version_preflight\]/);
    assert.match(config, /if: needs\.classify_changes\.outputs\.\w+_should_build == 'true'/);
    // No job-level always()/cancelled()/failure() may bypass failed dependencies.
    assert.doesNotMatch(config, /^    if:.*(?:always|cancelled|failure)\(/m);
  }
  assert.match(version, /^  workflow_call:/m);
  assert.match(version, /group: version-guard-\$\{\{ github.workflow \}\}-\$\{\{ github.ref \}\}/);
  assert.match(version, /name: VERSION matches every carrier/);
  assert.match(version, /node --test scripts\/ci\/\*.test.mjs/);
});

test('SDK warmer is default-branch-only and shares exact ARM architecture/cache setup', () => {
  assert.match(warmer, /^  push:\n    branches: \[main\]/m);
  assert.match(warmer, /^  workflow_dispatch:/m);
  assert.match(warmer, /^  schedule:/m);
  assert.doesNotMatch(warmer, /^  pull_request(?:_target)?:/m);
  assert.match(job(warmer, 'warm-arm64'), /if: github.ref == format\('refs\/heads\/\{0\}', github.event.repository.default_branch\)/);
  for (const source of [desktop, mcp, warmer]) {
    assert.match(source, /uses: \.\/\.github\/actions\/setup-windows-occt/);
  }
  for (const value of ['windows-11-vs2026-arm', 'windows-11-vs2026-arm-arm64-windows-msvc',
    'arm64-windows', 'Microsoft.VisualStudio.Component.VC.Tools.ARM64']) {
    assert(desktop.includes(value));
    assert(warmer.includes(value));
  }
  assert.doesNotMatch(warmer, /run:.*(?:cargo|npm|tauri)/);
  assert.match(sdk, /default: 716b42043743cdceabed9c8e2e6cf80ddae1e0c1/);
  for (const prefix of ['vcpkg-installed-v1', 'vcpkg-binary-v2']) {
    const key = `${prefix}-\${{ inputs.runner-cache-key }}-\${{ steps.msvc.outputs.toolset }}-\${{ inputs.vcpkg-commit }}-\${{ hashFiles('vcpkg.json') }}`;
    assert.equal(sdk.split(`key: ${key}`).length - 1, 2, 'restore/save keys must match and retain all ABI inputs');
  }
  assert.doesNotMatch(sdk, /restore-keys:/);
});

test('both native platforms run every shard and all CI inputs trigger native acceptance', () => {
  assert.match(job(mcp, 'mcp-windows'), /strategy: &acceptance-shards\n      fail-fast: false/);
  assert.match(job(mcp, 'mcp-linux'), /strategy: \*acceptance-shards/);
  for (const [shard, project] of [['core', 'garden-bench'], ['turbine', 'vertical-axis-turbine'], ['vise', 'd-screw-vise']]) {
    assert(mcp.includes(`- shard: ${shard}\n            project: ${project}`));
  }
  for (const name of ['mcp-windows', 'mcp-linux']) {
    const config = job(mcp, name);
    assert.match(config, /node scripts\/ci\/run-mcp-tests.mjs \$\{\{ matrix.shard \}\}/);
    assert.match(config, /name: MCP bench and complete feature workshop\n        if: matrix.shard == 'core'/);
    assert.match(config, /name: Upload successful demo input[\s\S]*?if-no-files-found: error\n          overwrite: true/);
  }
  for (const input of ['crates/cam/**', 'scripts/ci/**', '.github/actions/setup-windows-occt/**']) {
    assert.equal(mcp.split(`- '${input}'`).length - 1, 2, `${input} must be in both event filters`);
  }
  assert(read('mcp-server/tests/recipes.rs').includes(`fn ${flagshipTests.turbine}()`));
  assert(read('mcp-server/tests/recipes/vise.rs').includes(`fn ${flagshipTests.vise.split('::')[1]}()`));
});

test('native geometry regressions remain required once per platform in the core shard', () => {
  for (const name of ['mcp-windows', 'mcp-linux']) {
    const config = job(mcp, name);
    const steps = config.match(/      - name: Native geometry integration regressions\n[\s\S]*?(?=\n      -|$)/g);
    assert.equal(steps?.length, 1, `${name} must retain native geometry coverage`);
    const step = steps[0];
    assert.match(step, /^        if: matrix\.shard == 'core'$/m);
    assert.match(step, /CARGO_TARGET_DIR: \$\{\{ github.workspace \}\}\/mcp-server\/target/);
    assert.match(step, /cargo test --locked -p nbcad-occt --features native-occt --tests -- --test-threads=1/);
    assert.doesNotMatch(step, /continue-on-error:/);
    if (name === 'mcp-windows') {
      assert.match(step, /OCCT_ROOT: \$\{\{ steps.occt.outputs.root \}\}/);
      assert.match(step, /if \(\$LASTEXITCODE -ne 0\) \{ throw "native integration tests failed" \}/);
    } else {
      assert.match(step, /OCCT_ROOT: \/usr/);
    }
    assert(config.indexOf('Native geometry integration regressions') > config.indexOf('name: MCP server tests'));
    assert(config.indexOf('Native geometry integration regressions') < config.indexOf('name: Upload successful demo input'));
  }
});

test('publication keeps existing check/artifact names and requires every platform shard', () => {
  const config = job(mcp, 'mcp-tests');
  assert.match(config, /needs: mcp-windows\n    if: always\(\)/);
  assert.match(config, /NATIVE_RESULT: \$\{\{ needs.mcp-windows.result \}\}/);
  assert.match(config, /MCP_PLATFORM: windows/);
  const linux = job(mcp, 'mcp-tests-linux');
  assert.match(linux, /name: MCP tests \(Ubuntu\)/);
  assert.match(linux, /needs: mcp-linux\n    if: always\(\)/);
  assert.match(linux, /NATIVE_RESULT: \$\{\{ needs.mcp-linux.result \}\}/);
  assert.match(linux, /MCP_PLATFORM: linux/);
  assert.match(linux, /steps: \*publish-demo-projects/);
  assert.match(config, /name: noBS-CAD-demo-projects-\$\{\{ env.MCP_PLATFORM \}\}-\$\{\{ github.sha \}\}/);
  assert(config.indexOf('Require every platform acceptance shard') < config.indexOf('uses: actions/checkout'));
  for (const shard of ['core', 'turbine', 'vise']) {
    assert(config.includes(`name: mcp-demo-\${{ env.MCP_PLATFORM }}-${shard}`));
  }
  assert.equal(config.split('uses: actions/download-artifact@v4').length - 1, 3);
  assert.doesNotMatch(config, /run-id:|repository:|github-token:|pattern:/);
});

test('actual publication gate fails closed for failed, cancelled, skipped or missing shards', () => {
  const config = job(mcp, 'mcp-tests');
  const script = config.match(/        run: \|\n((?:          .*\n)+)/)?.[1].replace(/^          /gm, '');
  assert(script, 'Missing publication gate');
  for (const platform of ['windows', 'linux']) {
    for (const result of ['success', 'failure', 'cancelled', 'skipped', '']) {
      const gate = spawnSync('bash', ['-e', '-c', script], {
        env: { ...process.env, MCP_PLATFORM: platform, NATIVE_RESULT: result }, encoding: 'utf8',
      });
      assert.ifError(gate.error);
      assert.equal(gate.status === 0, result === 'success');
    }
  }
});
