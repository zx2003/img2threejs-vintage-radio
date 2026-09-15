import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { SceneSpec } from '../spec/types.js';
import { promptToSceneSpec } from './promptToSpec.js';

export interface PromptRequest {
  prompt: string;
  name?: string;
  title?: string;
}

function isSceneSpec(value: unknown): value is SceneSpec {
  return Boolean(value && typeof value === 'object' && (value as SceneSpec).version === '1.0' && Array.isArray((value as SceneSpec).objects));
}

export async function loadSceneRequest(input: { prompt?: string; requestFile?: string }): Promise<SceneSpec> {
  if (input.prompt) return promptToSceneSpec(input.prompt);
  if (!input.requestFile) throw new Error('Use --prompt "..." or provide a request.json path');
  const requestPath = resolve(input.requestFile);
  const parsed = JSON.parse(await readFile(requestPath, 'utf8')) as unknown;
  if (isSceneSpec(parsed)) return { ...parsed, source: { kind: 'json', value: requestPath } };
  if (parsed && typeof parsed === 'object' && typeof (parsed as PromptRequest).prompt === 'string') {
    const request = parsed as PromptRequest;
    const spec = await promptToSceneSpec(request.prompt);
    if (request.name) spec.name = request.name;
    if (request.title) spec.title = request.title;
    spec.source = { kind: 'json', value: requestPath };
    return spec;
  }
  throw new Error('request.json must be a complete Scene Spec or contain a prompt string');
}
