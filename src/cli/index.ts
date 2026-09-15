#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateScene } from '../pipeline/generateScene.js';
import { loadSceneRequest } from '../pipeline/loadRequest.js';

function help(): void {
  console.log(`Three.js Scene Factory

Usage:
  generate-scene --prompt "生成一个低多边形卧室，门可以打开，椅子可以拖动"
  generate-scene request.json

Options:
  --prompt <text>       Generate from a natural-language description
  --output <directory> Write project and ZIP to a custom output directory
  --help                Show this help`);
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function runCli(args = process.argv.slice(2)): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) { help(); return; }
  const prompt = valueAfter(args, '--prompt');
  const output = valueAfter(args, '--output');
  const positional = args.find((arg, index) => !arg.startsWith('-') && (index === 0 || args[index - 1] !== '--prompt') && (index === 0 || args[index - 1] !== '--output'));
  const spec = await loadSceneRequest({ prompt, requestFile: prompt ? undefined : positional });
  const result = await generateScene(spec, { outputsDir: output ? resolve(output) : undefined });
  console.log(`\nGenerated: ${result.spec.title}`);
  for (const check of result.checks) console.log(`  ${check.passed ? 'PASS' : 'FAIL'}  ${check.name} — ${check.details}`);
  console.log(`\nProject: ${result.projectDir}`);
  console.log(`ZIP:     ${result.zipPath}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
