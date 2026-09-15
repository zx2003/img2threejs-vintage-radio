import { rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { generateProject } from '../generators/projectGenerator.js';
import { createZip } from '../packager/zip.js';
import { validateSceneSpec } from '../spec/validateSceneSpec.js';
import type { SceneSpec } from '../spec/types.js';
import { checkAssetPaths, checkBasicQuality, checkRequiredFiles, installAndBuild, readProjectSources, type CheckResult } from '../validators/projectValidator.js';

export interface PipelineOptions {
  outputsDir?: string;
  installAndBuild?: boolean;
}

export interface PipelineResult {
  spec: SceneSpec;
  projectDir: string;
  zipPath: string;
  checks: CheckResult[];
}

export async function generateScene(spec: SceneSpec, options: PipelineOptions = {}): Promise<PipelineResult> {
  const outputsDir = resolve(options.outputsDir ?? 'outputs');
  const zipPath = join(outputsDir, `${spec.name}.zip`);
  await rm(zipPath, { force: true });
  const specValidation = validateSceneSpec(spec);
  const checks: CheckResult[] = [{
    name: 'scene-spec',
    passed: specValidation.valid,
    details: specValidation.valid ? `Scene Spec valid (${specValidation.warnings.length} non-blocking warnings)` : specValidation.errors.join('; '),
  }];
  if (!specValidation.valid) throw new Error(checks[0].details);

  const projectDir = await generateProject(spec, outputsDir);
  checks.push(await checkRequiredFiles(projectDir));
  checks.push(await checkAssetPaths(projectDir));
  checks.push(checkBasicQuality(spec, await readProjectSources(projectDir)));
  if (options.installAndBuild !== false) checks.push(...await installAndBuild(projectDir));

  await writeFile(join(projectDir, 'validation-report.json'), `${JSON.stringify({ scene: spec.name, checks }, null, 2)}\n`, 'utf8');
  const failed = checks.filter((check) => !check.passed);
  if (failed.length) throw new Error(`Generation stopped before packaging:\n${failed.map((check) => `- ${check.name}: ${check.details}`).join('\n')}`);

  await createZip(projectDir, zipPath);
  return { spec, projectDir, zipPath, checks };
}
