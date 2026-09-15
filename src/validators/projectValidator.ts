import { access, readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import type { SceneSpec } from '../spec/types.js';

export interface CheckResult {
  name: string;
  passed: boolean;
  details: string;
}

const requiredFiles = [
  'package.json',
  'index.html',
  'README.md',
  'scene-spec.json',
  'src/main.ts',
  'src/createScene.ts',
  'src/interactions.ts',
  'src/styles.css',
  'src/sceneSpec.ts',
  'public/assets/README.md',
];

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function walkFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(path));
    else files.push(path);
  }
  return files;
}

export async function checkRequiredFiles(projectDir: string): Promise<CheckResult> {
  const missing = [];
  for (const file of requiredFiles) if (!(await exists(join(projectDir, file)))) missing.push(file);
  return { name: 'required-files', passed: missing.length === 0, details: missing.length ? `Missing: ${missing.join(', ')}` : `${requiredFiles.length} required files found` };
}

export async function checkAssetPaths(projectDir: string): Promise<CheckResult> {
  const bad: string[] = [];
  const files = (await walkFiles(projectDir)).filter((file) => /\.(?:html|css|ts|json)$/i.test(file));
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (/file:\/\/|[A-Za-z]:[\\/]/.test(source)) bad.push(`${relative(projectDir, file)} contains an absolute local path`);
    const parentRefs = source.match(/(?:src=|href=|url\()["']?\.\.\//g);
    if (parentRefs) bad.push(`${relative(projectDir, file)} contains parent-relative asset paths`);
  }
  return { name: 'asset-paths', passed: bad.length === 0, details: bad.length ? bad.join('; ') : 'No unsafe or machine-local asset paths found' };
}

export function checkBasicQuality(spec: SceneSpec, projectSources: string): CheckResult {
  const ids = new Set<string>();
  let objectCount = 0;
  const visit = (objects: SceneSpec['objects']): void => {
    for (const object of objects) {
      objectCount += 1;
      ids.add(object.id);
      if (object.children) visit(object.children);
    }
  };
  visit(spec.objects);
  const requirements = ['Raycaster', 'requestAnimationFrame', 'OrbitControls', 'reset()'];
  const missing = requirements.filter((token) => !projectSources.includes(token));
  const passed = objectCount === ids.size && objectCount >= 4 && missing.length === 0;
  return {
    name: 'basic-quality',
    passed,
    details: passed
      ? `${objectCount} uniquely identified objects; generic interaction and animation runtime present`
      : `objectCount=${objectCount}, uniqueIds=${ids.size}, missing runtime tokens=${missing.join(', ') || 'none'}`,
  };
}

function run(command: string, args: string[], cwd: string): Promise<{ code: number; output: string }> {
  return new Promise((resolveRun) => {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      const normalized = key.toLowerCase();
      if (normalized === 'npm_config_cache' || normalized === 'npm_config_offline') delete env[key];
    }
    env.NPM_CONFIG_CACHE = resolve(cwd, '..', '.npm-cache');
    env.NPM_CONFIG_OFFLINE = 'false';
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === 'win32',
      env: { ...env, NO_COLOR: '1' },
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.on('error', (error) => resolveRun({ code: 1, output: error.message }));
    child.on('close', (code) => resolveRun({ code: code ?? 1, output }));
  });
}

export async function installAndBuild(projectDir: string): Promise<CheckResult[]> {
  const install = await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], projectDir);
  const installCheck: CheckResult = {
    name: 'npm-install',
    passed: install.code === 0,
    details: install.code === 0 ? 'Dependencies installed successfully' : install.output.slice(-1600),
  };
  if (!installCheck.passed) return [installCheck];
  const build = await run('npm', ['run', 'build'], projectDir);
  return [
    installCheck,
    {
      name: 'typescript-vite-build',
      passed: build.code === 0,
      details: build.code === 0 ? 'TypeScript check and Vite production build passed' : build.output.slice(-2400),
    },
  ];
}

export async function readProjectSources(projectDir: string): Promise<string> {
  const sourceFiles = (await walkFiles(resolve(projectDir, 'src'))).filter((file) => file.endsWith('.ts'));
  return (await Promise.all(sourceFiles.map((file) => readFile(file, 'utf8')))).join('\n');
}
