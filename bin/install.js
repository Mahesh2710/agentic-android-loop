#!/usr/bin/env node
/**
 * Installs the Android Agentic Dev Loop into an existing Android repo
 * that already has its own CLAUDE.md and MCP servers configured.
 *
 * Usage: npx agentic-android-loop          (installs into the current directory)
 *        node bin/install.js <target-dir>  (explicit target, for local testing)
 *
 * Safe by design:
 * - Never overwrites an existing CLAUDE.md — appends a delimited section (idempotent re-run)
 * - Never overwrites an existing .agentrc — deep-merges in only missing keys
 * - Never overwrites an existing CI workflow with the same name — writes alongside it
 * - Never touches package.json dependency versions the target already has
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SOURCE_ROOT = path.join(__dirname, '..');
const MARKER_START = '<!-- AGENTIC_LOOP:START — do not edit between markers, re-running install.js replaces this block -->';
const MARKER_END = '<!-- AGENTIC_LOOP:END -->';

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`✔ ${msg}`);
}

function warn(msg) {
  console.log(`⚠ ${msg}`);
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function deepMergeMissing(base, incoming) {
  for (const key of Object.keys(incoming)) {
    if (!(key in base)) {
      base[key] = incoming[key];
    } else if (
      typeof base[key] === 'object' && base[key] !== null && !Array.isArray(base[key]) &&
      typeof incoming[key] === 'object' && incoming[key] !== null && !Array.isArray(incoming[key])
    ) {
      deepMergeMissing(base[key], incoming[key]);
    }
    // existing scalar/array values are never overwritten
  }
  return base;
}

function installAgentScripts(targetRoot) {
  const srcAgentDir = path.join(SOURCE_ROOT, '.agent');
  const destAgentDir = path.join(targetRoot, '.agent');
  const scripts = ['pixeldiff.js', 'string-checker.js', 'localisation-check.js', 'pr-builder.js'];

  fs.mkdirSync(path.join(destAgentDir, 'screenshots', 'device'), { recursive: true });
  fs.mkdirSync(path.join(destAgentDir, 'screenshots', 'figma-exports'), { recursive: true });
  fs.mkdirSync(path.join(destAgentDir, 'logs'), { recursive: true });

  scripts.forEach(name => {
    const src = path.join(srcAgentDir, name);
    const dest = path.join(destAgentDir, name);
    if (!fs.existsSync(src)) {
      warn(`Source script missing, skipped: ${name}`);
      return;
    }
    if (fs.existsSync(dest)) {
      warn(`.agent/${name} already exists in target — left untouched`);
      return;
    }
    copyFile(src, dest);
    ok(`Installed .agent/${name}`);
  });
}

function findGradleModuleDir(targetRoot) {
  // Most Android Studio projects keep the app module at ./app — fall back to
  // scanning one level deep for any dir with a build.gradle(.kts) if not.
  if (fs.existsSync(path.join(targetRoot, 'app', 'build.gradle')) ||
      fs.existsSync(path.join(targetRoot, 'app', 'build.gradle.kts'))) {
    return 'app';
  }
  const entries = fs.readdirSync(targetRoot, { withFileTypes: true }).filter(e => e.isDirectory());
  for (const e of entries) {
    if (fs.existsSync(path.join(targetRoot, e.name, 'build.gradle')) ||
        fs.existsSync(path.join(targetRoot, e.name, 'build.gradle.kts'))) {
      return e.name;
    }
  }
  return 'app';
}

function detectPackageName(targetRoot, moduleDir) {
  const buildFiles = ['build.gradle.kts', 'build.gradle'].map(f => path.join(targetRoot, moduleDir, f));
  for (const file of buildFiles) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf-8');
    const match = content.match(/(?:applicationId|namespace)\s*[=(]?\s*["']([\w.]+)["']/);
    if (match) return match[1];
  }
  return null;
}

function autoDetectProjectValues(targetRoot, config) {
  const moduleDir = findGradleModuleDir(targetRoot);
  const packageName = detectPackageName(targetRoot, moduleDir);

  config.project.sourceRoot = `${moduleDir}/src/main/java`;
  config.project.resRoot = `${moduleDir}/src/main/res`;
  config.project.testRoot = `${moduleDir}/src/test/java`;
  config.project.uiTestRoot = `${moduleDir}/src/androidTest/java`;
  config.project.name = path.basename(targetRoot);

  if (packageName) {
    config.project.packageName = packageName;
    const packagePath = packageName.replace(/\./g, '/');
    config.project.sharedComponentsPath = `${moduleDir}/src/main/java/${packagePath}/shared/components`;
    config.dynamicUI.componentRegistryPath = `${moduleDir}/src/main/java/${packagePath}/shared/components/ComponentRegistry.kt`;
    ok(`Auto-detected package name: ${packageName}`);
  } else {
    warn('Could not auto-detect packageName from Gradle files — set .agentrc.project.packageName manually');
  }
  return config;
}

function installAgentrc(targetRoot) {
  const srcPath = path.join(SOURCE_ROOT, '.agentrc');
  const destPath = path.join(targetRoot, '.agentrc');
  const srcConfig = JSON.parse(fs.readFileSync(srcPath, 'utf-8'));

  if (!fs.existsSync(destPath)) {
    const config = autoDetectProjectValues(targetRoot, srcConfig);
    fs.writeFileSync(destPath, JSON.stringify(config, null, 2) + '\n');
    ok('Created .agentrc with auto-detected project values — review jira/figma values before first run');
    return;
  }

  const destConfig = JSON.parse(fs.readFileSync(destPath, 'utf-8'));
  const before = JSON.stringify(destConfig);
  const merged = deepMergeMissing(destConfig, srcConfig);
  if (JSON.stringify(merged) === before) {
    ok('.agentrc already has all required keys — left untouched');
  } else {
    fs.writeFileSync(destPath, JSON.stringify(merged, null, 2) + '\n');
    ok('.agentrc updated — added missing keys only, existing values preserved');
  }
}

function installWorkflow(targetRoot) {
  const srcPath = path.join(SOURCE_ROOT, '.github', 'workflows', 'agent-evaluate.yml');
  const destDir = path.join(targetRoot, '.github', 'workflows');
  const destPath = path.join(destDir, 'agent-evaluate.yml');

  if (!fs.existsSync(srcPath)) {
    warn('Source workflow file missing, skipped');
    return;
  }
  if (fs.existsSync(destPath)) {
    warn('.github/workflows/agent-evaluate.yml already exists in target — left untouched');
    return;
  }
  copyFile(srcPath, destPath);
  ok('Installed .github/workflows/agent-evaluate.yml');
}

function installClaudeMdSection(targetRoot) {
  const srcClaudeMd = fs.readFileSync(path.join(SOURCE_ROOT, 'CLAUDE.md'), 'utf-8');
  const section = `${MARKER_START}\n\n${srcClaudeMd.trim()}\n\n${MARKER_END}`;
  const destPath = path.join(targetRoot, 'CLAUDE.md');

  if (!fs.existsSync(destPath)) {
    fs.writeFileSync(destPath, section + '\n');
    ok('Created CLAUDE.md with the agentic loop section');
    return;
  }

  const existing = fs.readFileSync(destPath, 'utf-8');
  const startIdx = existing.indexOf(MARKER_START);
  const endIdx = existing.indexOf(MARKER_END);

  let updated;
  if (startIdx !== -1 && endIdx !== -1) {
    updated = existing.slice(0, startIdx) + section + existing.slice(endIdx + MARKER_END.length);
    ok('CLAUDE.md already had an agentic loop section — replaced it in place');
  } else {
    updated = existing.trim() + '\n\n---\n\n' + section + '\n';
    ok('Appended agentic loop section to existing CLAUDE.md');
  }
  fs.writeFileSync(destPath, updated);
}

function ensurePackageJsonDeps(targetRoot) {
  const required = { pixelmatch: '^7.2.0', pngjs: '^7.0.0', glob: '^13.0.6' };
  const destPkgPath = path.join(targetRoot, 'package.json');
  let depsChanged = false;

  if (!fs.existsSync(destPkgPath)) {
    const pkg = {
      name: path.basename(targetRoot).toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      version: '1.0.0',
      private: true,
      description: 'Node deps for the .agent/ agentic-loop helper scripts — not part of the Android app build.',
      dependencies: required
    };
    fs.writeFileSync(destPkgPath, JSON.stringify(pkg, null, 2) + '\n');
    ok('No package.json found — created one with the required dependencies');
    return true;
  }

  const pkg = JSON.parse(fs.readFileSync(destPkgPath, 'utf-8'));
  pkg.dependencies = pkg.dependencies || {};
  const missing = Object.entries(required).filter(([name]) => !pkg.dependencies[name] && !(pkg.devDependencies || {})[name]);

  if (missing.length === 0) {
    ok('package.json already has all required dependencies');
    return false;
  }

  missing.forEach(([name, version]) => { pkg.dependencies[name] = version; });
  fs.writeFileSync(destPkgPath, JSON.stringify(pkg, null, 2) + '\n');
  ok(`Added missing dependencies to package.json: ${missing.map(([n]) => n).join(', ')}`);
  return true;
}

function runNpmInstall(targetRoot) {
  console.log('\nRunning npm install...');
  try {
    execSync('npm install', { cwd: targetRoot, stdio: 'inherit' });
    ok('npm install completed');
  } catch (err) {
    warn('npm install failed — run it manually inside the project once you have network/registry access');
  }
}

function checkIsAndroidStudioProject(targetRoot) {
  const markers = ['settings.gradle', 'settings.gradle.kts', 'build.gradle', 'build.gradle.kts'];
  const found = markers.some(name => fs.existsSync(path.join(targetRoot, name)));
  if (!found) {
    warn(`No Gradle files found in ${targetRoot} — this doesn't look like an Android Studio project root.`);
    warn('Open the Terminal tab inside Android Studio (bottom toolbar) so it starts in your project root, then re-run this command.');
  }
  return found;
}

function ensureGitignoreEntry(targetRoot) {
  const gitignorePath = path.join(targetRoot, '.gitignore');
  const entry = 'node_modules/';

  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, entry + '\n');
    ok('Created .gitignore with node_modules/');
    return;
  }

  const content = fs.readFileSync(gitignorePath, 'utf-8');
  if (content.split('\n').some(line => line.trim() === 'node_modules' || line.trim() === entry)) {
    return;
  }
  fs.writeFileSync(gitignorePath, content.trimEnd() + `\n${entry}\n`);
  ok('Added node_modules/ to existing .gitignore');
}

function main() {
  // No argument → install into the directory the command was run from.
  // This is what makes `npx agentic-android-loop` work with zero setup:
  // the developer just runs it from inside their own repo root.
  const target = process.argv[2] || process.cwd();

  const targetRoot = path.resolve(target);
  if (!fs.existsSync(targetRoot) || !fs.statSync(targetRoot).isDirectory()) {
    fail(`Target is not a directory: ${targetRoot}`);
  }

  console.log(`Installing Android Agentic Dev Loop into ${targetRoot}\n`);

  checkIsAndroidStudioProject(targetRoot);
  installAgentScripts(targetRoot);
  installAgentrc(targetRoot);
  installWorkflow(targetRoot);
  installClaudeMdSection(targetRoot);
  ensurePackageJsonDeps(targetRoot);
  ensureGitignoreEntry(targetRoot);
  runNpmInstall(targetRoot);

  console.log('\nDone. Next steps for the developer:');
  console.log('  1. Open .agentrc and fill in project/jira/figma values for this repo');
  console.log('  2. Confirm Rovo MCP and Figma MCP are connected (claude mcp list)');
  console.log('  3. In Claude Code: "Run the agentic loop for ticket <ID>"');
}

main();
