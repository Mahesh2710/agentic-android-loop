const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..');
const SCRIPTS = path.join(ROOT, '.agent');

function makeFixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-test-'));
  Object.entries(files).forEach(([rel, content]) => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  });
  return dir;
}

function run(script, args, cwd) {
  const res = spawnSync('node', [path.join(SCRIPTS, script), ...args], { cwd, encoding: 'utf-8' });
  return { ...res, json: res.stdout ? JSON.parse(res.stdout) : null };
}

const MINIMAL_AGENTRC = JSON.stringify({
  project: { resRoot: 'app/src/main/res', sourceRoot: 'app/src/main/java' },
  languages: ['en', 'hi'],
  defaultLanguage: 'en',
  evaluate: { pixelMatchThreshold: 95 },
  ci: { branchPrefix: 'feature/', defaultBranch: 'develop' },
  jira: { baseUrl: 'https://example.atlassian.net' },
  agent: { payloadDir: '.agent' }
});

test('string-checker flags hardcoded Kotlin and layout XML strings', () => {
  const dir = makeFixture({
    '.agentrc': MINIMAL_AGENTRC,
    'app/src/main/java/Foo.kt': 'Text("Hello world")\nText(stringResource(R.string.ok))\n',
    'app/src/main/res/layout/screen.xml': '<TextView android:text="Sign in now" />\n<TextView android:text="@string/ok" />\n',
    'app/src/main/res/values/strings.xml': '<resources><string name="ok">OK</string></resources>\n'
  });
  const res = run('string-checker.js', [], dir);
  assert.strictEqual(res.status, 1);
  assert.strictEqual(res.json.passed, false);
  assert.strictEqual(res.json.violationCount, 2);
  const texts = res.json.violations.map(v => v.text);
  assert.ok(texts.includes('Hello world'));
  assert.ok(texts.includes('Sign in now'));
});

test('string-checker passes a clean project', () => {
  const dir = makeFixture({
    '.agentrc': MINIMAL_AGENTRC,
    'app/src/main/java/Foo.kt': 'Text(stringResource(R.string.hello))\n',
    'app/src/main/res/layout/screen.xml': '<TextView android:text="@string/hello" />\n'
  });
  const res = run('string-checker.js', [], dir);
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.json.passed, true);
});

test('localisation-check reports missing keys, ignores translatable=false', () => {
  const dir = makeFixture({
    '.agentrc': MINIMAL_AGENTRC,
    'app/src/main/res/values/strings.xml':
      '<resources>\n' +
      '  <string name="hello">Hello</string>\n' +
      '  <string name="app_id" translatable="false">com.example</string>\n' +
      '</resources>\n',
    'app/src/main/res/values-hi/strings.xml': '<resources>\n</resources>\n'
  });
  const res = run('localisation-check.js', [], dir);
  assert.strictEqual(res.status, 1);
  assert.deepStrictEqual(res.json.missingByLanguage.hi, ['hello']);
});

test('localisation-check passes when all translatable keys exist', () => {
  const dir = makeFixture({
    '.agentrc': MINIMAL_AGENTRC,
    'app/src/main/res/values/strings.xml': '<resources><string name="hello">Hello</string></resources>\n',
    'app/src/main/res/values-hi/strings.xml': '<resources><string name="hello">नमस्ते</string></resources>\n'
  });
  const res = run('localisation-check.js', [], dir);
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.json.passed, true);
});

test('pr-builder slugifies branch names and handles array screen_name', () => {
  const payload = {
    meta: { ticket_id: 'APP-101', confidence_score: 'high' },
    normalised: {
      feature_summary: 'Add login screen',
      requires_design: true,
      screen_name: ['Login Screen', 'OTP Screen'],
      ui_type: 'compose',
      flags: []
    },
    phase_outputs: { design: {}, implement: {}, evaluate: {} }
  };
  const dir = makeFixture({
    '.agentrc': MINIMAL_AGENTRC,
    '.agent/run_APP-101.json': JSON.stringify(payload)
  });
  const res = run('pr-builder.js', ['APP-101'], dir);
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.json.branch, 'feature/app-101-login-screen');
  assert.ok(res.json.body.includes('Login Screen, OTP Screen'));
  assert.ok(res.json.body.includes('⚠ not verified'));
});

test('pixeldiff handles images of different sizes without crashing', () => {
  function png(w, h, rgba) {
    const img = new PNG({ width: w, height: h });
    for (let i = 0; i < img.data.length; i += 4) img.data.set(rgba, i);
    return PNG.sync.write(img);
  }
  const dir = makeFixture({ '.agentrc': MINIMAL_AGENTRC });
  fs.writeFileSync(path.join(dir, 'shot.png'), png(100, 200, [255, 0, 0, 255]));
  fs.writeFileSync(path.join(dir, 'figma.png'), png(50, 100, [255, 0, 0, 255]));
  const res = run('pixeldiff.js', ['shot.png', 'figma.png', 'out/diff.png'], dir);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.json.passed, true);
  assert.strictEqual(res.json.matchPercent, 100);
  assert.strictEqual(res.json.screenshotResized, true);
  assert.deepStrictEqual(res.json.dimensions, { width: 50, height: 100 });
});

test('string-checker suppression file silences listed literals', () => {
  const dir = makeFixture({
    '.agentrc': MINIMAL_AGENTRC,
    '.agent/string-checker-ignore': '# legit literals\nHello world\n',
    'app/src/main/java/Foo.kt': 'Text("Hello world")\n'
  });
  const res = run('string-checker.js', [], dir);
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.json.passed, true);
});

test('string-checker --changed-only scans only changed/untracked files', () => {
  const dir = makeFixture({
    '.agentrc': MINIMAL_AGENTRC,
    'app/src/main/java/Legacy.kt': 'Text("Old hardcoded legacy string")\n'
  });
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'app/src/main/java/New.kt'), 'Text("Brand new string")\n');
  const res = run('string-checker.js', ['--changed-only', 'HEAD'], dir);
  assert.strictEqual(res.json.violationCount, 1);
  assert.strictEqual(res.json.violations[0].text, 'Brand new string');
});

test('localisation-check --fix creates missing files and placeholders', () => {
  const dir = makeFixture({
    '.agentrc': MINIMAL_AGENTRC,
    'app/src/main/res/values/strings.xml': '<resources><string name="hello">Hello</string></resources>\n'
  });
  const first = run('localisation-check.js', [], dir);
  assert.strictEqual(first.status, 1);
  assert.ok(first.json.flags.some(f => f.type === 'LANGUAGE_FILE_MISSING'));

  const fixed = run('localisation-check.js', ['--fix'], dir);
  assert.strictEqual(fixed.status, 0);
  assert.strictEqual(fixed.json.fixed, 1);
  const hiFile = fs.readFileSync(path.join(dir, 'app/src/main/res/values-hi/strings.xml'), 'utf-8');
  assert.ok(hiFile.includes('<string name="hello">[NEEDS_TRANSLATION]</string>'));

  const recheck = run('localisation-check.js', [], dir);
  assert.strictEqual(recheck.status, 0);
});

test('pr-builder fails with a clear list when payload is incomplete', () => {
  const dir = makeFixture({
    '.agentrc': MINIMAL_AGENTRC,
    '.agent/run_APP-1.json': JSON.stringify({ meta: { ticket_id: 'APP-1' }, normalised: {} })
  });
  const res = run('pr-builder.js', ['APP-1'], dir);
  assert.strictEqual(res.status, 1);
  const err = JSON.parse(res.stderr);
  assert.ok(err.missing.includes('normalised.feature_summary'));
  assert.ok(err.missing.includes('normalised.screen_name'));
});

test('doctor passes on a valid project and blocks on a missing language file', () => {
  const files = {
    '.agentrc': JSON.stringify({
      project: {
        sourceRoot: 'app/src/main/java', resRoot: 'app/src/main/res',
        testRoot: 'app/src/test/java', uiTestRoot: 'app/src/androidTest/java'
      },
      architecture: { di: 'Hilt', async: 'Coroutines', stateHolder: 'StateFlow', ui: ['Compose'], networking: 'Retrofit' },
      languages: ['en', 'hi'], defaultLanguage: 'en',
      ci: { defaultBranch: 'main' },
      evaluate: { pixelMatchThreshold: 95 }
    }),
    'app/src/main/java/.keep': '', 'app/src/test/java/.keep': '', 'app/src/androidTest/java/.keep': '',
    'app/src/main/res/values/strings.xml': '<resources><string name="hello">Hello</string></resources>\n',
    'app/src/main/res/values-hi/strings.xml': '<resources><string name="hello">नमस्ते</string></resources>\n'
  };
  const dir = makeFixture(files);
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base'], { cwd: dir });

  const good = run('doctor.js', [], dir);
  assert.strictEqual(good.status, 0, JSON.stringify(good.json));
  assert.strictEqual(good.json.passed, true);

  fs.rmSync(path.join(dir, 'app/src/main/res/values-hi'), { recursive: true });
  const bad = run('doctor.js', [], dir);
  assert.strictEqual(bad.status, 1);
  assert.ok(bad.json.errors.some(e => e.includes('values-hi')));
});

test('pixeldiff fails below threshold on different images', () => {
  function png(w, h, rgba) {
    const img = new PNG({ width: w, height: h });
    for (let i = 0; i < img.data.length; i += 4) img.data.set(rgba, i);
    return PNG.sync.write(img);
  }
  const dir = makeFixture({ '.agentrc': MINIMAL_AGENTRC });
  fs.writeFileSync(path.join(dir, 'shot.png'), png(50, 50, [255, 0, 0, 255]));
  fs.writeFileSync(path.join(dir, 'figma.png'), png(50, 50, [0, 0, 255, 255]));
  const res = run('pixeldiff.js', ['shot.png', 'figma.png', 'out/diff.png'], dir);
  assert.strictEqual(res.status, 1);
  assert.strictEqual(res.json.passed, false);
});
