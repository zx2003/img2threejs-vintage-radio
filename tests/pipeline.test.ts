import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateScene } from '../src/pipeline/generateScene.js';
import { loadSceneRequest } from '../src/pipeline/loadRequest.js';
import { promptToSceneSpec } from '../src/pipeline/promptToSpec.js';

export async function runPipelineTests(): Promise<void> {
  const temp = await mkdtemp(join(tmpdir(), 'scene-factory-'));
  try {
    const spec = await promptToSceneSpec('生成一个低多边形实验室，机器人终端可以点击开关');
    const result = await generateScene(spec, { outputsDir: temp, installAndBuild: false });
    assert.ok(result.checks.every((check) => check.passed));
    assert.equal((await readFile(join(result.projectDir, 'package.json'), 'utf8')).includes('three'), true);
    const zip = await readFile(result.zipPath);
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    assert.ok(zip.includes(Buffer.from('src/createScene.ts')));
    assert.ok(zip.includes(Buffer.from('validation-report.json')));

    const requestPath = join(temp, 'request.json');
    await writeFile(requestPath, JSON.stringify({ prompt: '生成一个展厅，未知展品可以拖动', name: 'json-input-scene' }));
    const jsonSpec = await loadSceneRequest({ requestFile: requestPath });
    assert.equal(jsonSpec.name, 'json-input-scene');
    assert.equal(jsonSpec.source?.kind, 'json');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
