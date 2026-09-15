import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { GeometrySpec, InteractionSpec, MaterialSpec, SceneObjectSpec, SceneSpec, Vector3Tuple } from '../spec/types.js';
import { identityTransform } from '../spec/types.js';

interface CatalogChild {
  suffix: string;
  name: string;
  type: string;
  geometry: GeometrySpec;
  material: MaterialSpec;
  position: Vector3Tuple;
}

interface CatalogComponent {
  key: string;
  aliases: string[];
  name: string;
  type: string;
  geometry: GeometrySpec;
  material: MaterialSpec;
  position: Vector3Tuple;
  children?: CatalogChild[];
}

interface Catalog {
  version: string;
  components: CatalogComponent[];
}

const architectureObjects = (): SceneObjectSpec[] => [
  {
    id: 'floor',
    name: 'Scene floor',
    type: 'architecture',
    geometry: { shape: 'box', size: [10, 0.18, 10] },
    material: { color: '#b98655', roughness: 0.88 },
    transform: identityTransform([0, -0.1, 0]),
    receiveShadow: true,
  },
  {
    id: 'back-wall',
    name: 'Back wall',
    type: 'architecture',
    geometry: { shape: 'box', size: [10, 5.5, 0.16] },
    material: { color: '#eadfcf', roughness: 0.95 },
    transform: identityTransform([0, 2.65, -5]),
    receiveShadow: true,
  },
  {
    id: 'side-wall',
    name: 'Side wall',
    type: 'architecture',
    geometry: { shape: 'box', size: [0.16, 5.5, 10] },
    material: { color: '#f1e7d6', roughness: 0.95 },
    transform: identityTransform([-5, 2.65, 0]),
    receiveShadow: true,
  },
];

function slugForPrompt(prompt: string): string {
  const lower = prompt.toLowerCase();
  const known: Array<[RegExp, string]> = [
    [/咖啡店|coffee\s*shop|cafe/, 'low-poly-cafe'],
    [/卧室|bedroom/, 'low-poly-bedroom'],
    [/办公室|office/, 'low-poly-office'],
    [/展厅|showroom/, 'low-poly-showroom'],
  ];
  const match = known.find(([pattern]) => pattern.test(lower));
  if (match) return match[1];
  const ascii = lower
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 42);
  if (ascii) return ascii;
  return `scene-${createHash('sha1').update(prompt).digest('hex').slice(0, 8)}`;
}

function titleForPrompt(prompt: string): string {
  const firstClause = prompt.split(/[，。,.]/)[0]
    .replace(/^(请)?(生成|创建|搭建|制作)(一个|一间)?/, '')
    .trim();
  return firstClause || 'Generated Three.js Scene';
}

function interactionsFor(component: CatalogComponent, prompt: string): InteractionSpec[] | undefined {
  const lower = prompt.toLowerCase();
  const hasOpen = /打开|开合|open/.test(lower);
  const hasDrag = /拖动|拖拽|drag/.test(lower);
  const hasToggle = /开关|点亮|点击.*(灯|light|lamp)|toggle/.test(lower);
  const interactions: InteractionSpec[] = [];
  if (component.type === 'door' && hasOpen) interactions.push({ type: 'hinge', axis: 'y', min: 0, max: Math.PI / 2 });
  if (component.type === 'chair' && hasDrag) interactions.push({ type: 'drag', bounds: { minX: -4.3, maxX: 4.3, minZ: -4.2, maxZ: 4.2 } });
  if (component.type === 'light' && hasToggle) interactions.push({ type: 'toggle' });
  if (interactions.length) interactions.push({ type: 'hover' });
  return interactions.length ? interactions : undefined;
}

function instantiate(component: CatalogComponent, prompt: string, index: number): SceneObjectSpec {
  const id = `${component.key}-${index + 1}`;
  return {
    id,
    name: component.name,
    type: component.type,
    geometry: structuredClone(component.geometry),
    material: structuredClone(component.material),
    transform: identityTransform([...component.position] as Vector3Tuple),
    interactions: interactionsFor(component, prompt),
    castShadow: true,
    receiveShadow: true,
    children: component.children?.map((child) => ({
      id: `${id}-${child.suffix}`,
      name: child.name,
      type: child.type,
      geometry: structuredClone(child.geometry),
      material: structuredClone(child.material),
      transform: identityTransform([...child.position] as Vector3Tuple),
      castShadow: true,
      receiveShadow: true,
    })),
  };
}

function genericObject(label: string, index: number, prompt: string): SceneObjectSpec {
  const id = `generic-object-${index + 1}`;
  const hasDrag = /拖动|拖拽|drag/i.test(prompt);
  const hasOpen = /打开|开合|open/i.test(prompt);
  const hasRotate = /旋转|转动|rotate/i.test(prompt);
  const hasToggle = /开关|点击|toggle/i.test(prompt);
  const lightLike = /灯|lamp|light/i.test(label);
  const interactions: InteractionSpec[] = [];
  if (hasDrag) interactions.push({ type: 'drag', bounds: { minX: -4.2, maxX: 4.2, minZ: -4.2, maxZ: 4.2 } });
  else if (hasOpen) interactions.push({ type: 'hinge', axis: 'y', min: 0, max: Math.PI / 2 });
  else if (hasRotate) interactions.push({ type: 'rotate', axis: 'y', min: -Math.PI, max: Math.PI });
  else if (hasToggle) interactions.push({ type: 'toggle' });
  if (interactions.length) interactions.push({ type: 'hover' });
  const column = index % 3;
  const row = Math.floor(index / 3);
  return {
    id,
    name: label || `Generic object ${index + 1}`,
    type: lightLike ? 'light' : 'generic',
    geometry: lightLike ? { shape: 'sphere', radius: 0.32, segments: 10 } : { shape: 'box', size: [1.2, 1.2, 1.2] },
    material: lightLike
      ? { color: '#ffe0a1', roughness: 0.35, emissive: '#ffb45c', emissiveIntensity: 0.05 }
      : { color: '#6c8f86', roughness: 0.72 },
    transform: lightLike
      ? identityTransform([3.7, 3.25, -4.72])
      : identityTransform([-2.2 + column * 2.2, 0.6, -1 + row * 2]),
    interactions: interactions.length ? interactions : undefined,
    castShadow: true,
    receiveShadow: true,
    children: [
      {
        id: `${id}-accent`,
        name: `${label} accent`,
        type: lightLike ? 'light-mount' : 'generic-detail',
        geometry: lightLike
          ? { shape: 'cylinder', radiusTop: 0.18, radiusBottom: 0.24, height: 0.35, segments: 8 }
          : { shape: 'cylinder', radiusTop: 0.32, radiusBottom: 0.42, height: 0.7, segments: 8 },
        material: { color: lightLike ? '#8b633f' : '#d7aa64', roughness: 0.65 },
        transform: identityTransform(lightLike ? [0, 0, -0.22] : [0, 0.9, 0]),
      },
    ],
  };
}

async function loadCatalog(): Promise<Catalog> {
  const catalogPath = fileURLToPath(new URL('../../component-library/catalog.json', import.meta.url));
  return JSON.parse(await readFile(catalogPath, 'utf8')) as Catalog;
}

function unmatchedSubjects(prompt: string, matchedAliases: string[]): Array<{ subject: string; clause: string }> {
  return prompt
    .split(/[，。,.；;]/)
    .slice(1)
    .map((clause) => clause.trim())
    .filter(Boolean)
    .filter((clause) => !matchedAliases.some((alias) => clause.toLowerCase().includes(alias.toLowerCase())))
    .map((clause) => ({ clause, subject: clause.split(/可以|能够|支持|can\s|should\s/i)[0].replace(/^(并且|以及|和|and)\s*/i, '').trim() }))
    .filter(({ subject }) => subject.length > 0 && subject.length < 40);
}

export async function promptToSceneSpec(prompt: string): Promise<SceneSpec> {
  const cleanPrompt = prompt.trim();
  if (!cleanPrompt) throw new Error('Prompt cannot be empty');
  const catalog = await loadCatalog();
  const lower = cleanPrompt.toLowerCase();
  const matched = catalog.components.filter((component) => component.aliases.some((alias) => lower.includes(alias.toLowerCase())));
  const objects = matched.map((component, index) => instantiate(component, cleanPrompt, index));
  const aliases = matched.flatMap((component) => component.aliases);
  const unknowns = unmatchedSubjects(cleanPrompt, aliases);
  const genericStartIndex = objects.length;
  unknowns.forEach(({ subject, clause }, index) => objects.push(genericObject(subject, genericStartIndex + index, clause)));
  if (!objects.length) objects.push(genericObject(titleForPrompt(cleanPrompt), 0, cleanPrompt));

  return {
    version: '1.0',
    name: slugForPrompt(cleanPrompt),
    title: titleForPrompt(cleanPrompt),
    style: {
      preset: /低多边形|low[ -]?poly/i.test(cleanPrompt) ? 'low-poly' : 'clean-procedural',
      background: '#ded6ca',
      groundColor: '#b98655',
    },
    camera: {
      type: 'perspective',
      position: [12, 10, 13],
      target: [0, 1.4, 0],
      fov: 36,
      near: 0.05,
      far: 100,
    },
    lights: [
      { id: 'ambient', type: 'hemisphere', color: '#ffe4bc', groundColor: '#6b625a', intensity: 1.4 },
      { id: 'key', type: 'directional', color: '#ffd398', intensity: 2.4, position: [-6, 10, 7], castShadow: true },
      { id: 'fill', type: 'directional', color: '#e8f0ff', intensity: 0.45, position: [7, 5, 4] },
    ],
    objects: [...architectureObjects(), ...objects],
    source: { kind: 'prompt', value: cleanPrompt },
  };
}
