import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { SceneSpec } from '../spec/types.js';

const templateRoot = resolve('templates/vite-threejs');

function assertInside(parent: string, child: string): void {
  const rel = relative(resolve(parent), resolve(child));
  if (rel.startsWith('..') || rel === '' || rel.split(sep).includes('..')) throw new Error(`Unsafe output path: ${child}`);
}

function renderTemplate(source: string, spec: SceneSpec): string {
  return source
    .replaceAll('__SCENE_NAME__', spec.name)
    .replaceAll('__SCENE_TITLE__', spec.title);
}

async function copyTemplates(sourceDir: string, targetDir: string, spec: SceneSpec): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
    const sourcePath = join(sourceDir, entry.name);
    const outputName = entry.name.endsWith('.tpl') ? entry.name.slice(0, -4) : entry.name;
    const targetPath = join(targetDir, outputName);
    if (entry.isDirectory()) await copyTemplates(sourcePath, targetPath, spec);
    else await writeFile(targetPath, renderTemplate(await readFile(sourcePath, 'utf8'), spec), 'utf8');
  }
}

function sceneSpecModule(spec: SceneSpec): string {
  const serialized = JSON.stringify(spec);
  return `export type Vector3Tuple = [number, number, number];
export interface GeometrySpec { shape: 'box' | 'sphere' | 'cylinder' | 'cone' | 'plane' | 'torus'; size?: Vector3Tuple; radius?: number; radiusTop?: number; radiusBottom?: number; tube?: number; height?: number; segments?: number }
export interface MaterialSpec { color: string; roughness?: number; metalness?: number; opacity?: number; transparent?: boolean; emissive?: string; emissiveIntensity?: number }
export interface TransformSpec { position: Vector3Tuple; rotation: Vector3Tuple; scale: Vector3Tuple }
export interface InteractionSpec { type: 'toggle' | 'hinge' | 'rotate' | 'drag' | 'hover'; axis?: 'x' | 'y' | 'z'; min?: number; max?: number; bounds?: { minX: number; maxX: number; minZ: number; maxZ: number } }
export interface SceneObjectSpec { id: string; name: string; type: string; geometry: GeometrySpec; material: MaterialSpec; transform: TransformSpec; interactions?: InteractionSpec[]; children?: SceneObjectSpec[]; castShadow?: boolean; receiveShadow?: boolean }
export interface SceneSpec { version: '1.0'; name: string; title: string; style: { preset: string; background: string; groundColor: string }; camera: { type: 'perspective'; position: Vector3Tuple; target: Vector3Tuple; fov: number; near: number; far: number }; lights: Array<{ id: string; type: 'ambient' | 'hemisphere' | 'directional' | 'point'; color: string; groundColor?: string; intensity: number; position?: Vector3Tuple; castShadow?: boolean }>; objects: SceneObjectSpec[] }
export const sceneSpec = JSON.parse(${JSON.stringify(serialized)}) as SceneSpec;
`;
}

export async function generateProject(spec: SceneSpec, outputsDir = resolve('outputs')): Promise<string> {
  const projectDir = resolve(outputsDir, spec.name);
  assertInside(outputsDir, projectDir);
  await rm(projectDir, { recursive: true, force: true });
  await mkdir(dirname(projectDir), { recursive: true });
  await copyTemplates(templateRoot, projectDir, spec);
  await writeFile(join(projectDir, 'scene-spec.json'), `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
  await writeFile(join(projectDir, 'src', 'sceneSpec.ts'), sceneSpecModule(spec), 'utf8');
  return projectDir;
}
