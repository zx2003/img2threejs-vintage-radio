import type { GeometrySpec, SceneObjectSpec, SceneSpec, Vector3Tuple } from './types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const hexColor = /^#[0-9a-f]{6}$/i;
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const shapes = new Set(['box', 'sphere', 'cylinder', 'cone', 'plane', 'torus']);
const interactionTypes = new Set(['toggle', 'hinge', 'rotate', 'drag', 'hover']);

function validVector(value: unknown): value is Vector3Tuple {
  return Array.isArray(value) && value.length === 3 && value.every((entry) => Number.isFinite(entry));
}

function validateGeometry(geometry: GeometrySpec, path: string, errors: string[]): void {
  if (!geometry || !shapes.has(geometry.shape)) errors.push(`${path}.geometry.shape is unsupported`);
  if ((geometry.shape === 'box' || geometry.shape === 'plane') && (!validVector(geometry.size) || geometry.size.some((n) => n <= 0))) {
    errors.push(`${path}.geometry.size must contain three positive numbers`);
  }
  if ((geometry.shape === 'sphere' || geometry.shape === 'torus') && !(Number.isFinite(geometry.radius) && geometry.radius! > 0)) {
    errors.push(`${path}.geometry.radius must be positive`);
  }
  if ((geometry.shape === 'cylinder' || geometry.shape === 'cone') && !(Number.isFinite(geometry.height) && geometry.height! > 0)) {
    errors.push(`${path}.geometry.height must be positive`);
  }
}

function validateObject(object: SceneObjectSpec, path: string, ids: Set<string>, errors: string[], warnings: string[]): void {
  if (!object.id?.trim()) errors.push(`${path}.id is required`);
  else if (ids.has(object.id)) errors.push(`${path}.id duplicates "${object.id}"`);
  else ids.add(object.id);
  if (!object.name?.trim()) errors.push(`${path}.name is required`);
  if (!object.type?.trim()) errors.push(`${path}.type is required`);
  validateGeometry(object.geometry, path, errors);
  if (!hexColor.test(object.material?.color ?? '')) errors.push(`${path}.material.color must be #RRGGBB`);
  if (!validVector(object.transform?.position)) errors.push(`${path}.transform.position must be a finite vec3`);
  if (!validVector(object.transform?.rotation)) errors.push(`${path}.transform.rotation must be a finite vec3`);
  if (!validVector(object.transform?.scale) || object.transform.scale.some((n) => n <= 0)) errors.push(`${path}.transform.scale must be a positive vec3`);
  for (const [index, interaction] of (object.interactions ?? []).entries()) {
    const interactionPath = `${path}.interactions[${index}]`;
    if (!interactionTypes.has(interaction.type)) errors.push(`${interactionPath}.type is unsupported`);
    if ((interaction.type === 'hinge' || interaction.type === 'rotate') && (!interaction.axis || !Number.isFinite(interaction.min) || !Number.isFinite(interaction.max))) {
      errors.push(`${interactionPath} requires axis, min and max`);
    }
    if (interaction.type === 'drag' && !interaction.bounds) errors.push(`${interactionPath} requires ground bounds`);
  }
  if (!object.interactions?.length) warnings.push(`${path} has no interaction; it will remain static`);
  for (const [index, child] of (object.children ?? []).entries()) validateObject(child, `${path}.children[${index}]`, ids, errors, warnings);
}

export function validateSceneSpec(spec: SceneSpec): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (spec?.version !== '1.0') errors.push('version must be "1.0"');
  if (!slug.test(spec?.name ?? '')) errors.push('name must be a lowercase kebab-case slug');
  if (!spec?.title?.trim()) errors.push('title is required');
  if (!hexColor.test(spec?.style?.background ?? '')) errors.push('style.background must be #RRGGBB');
  if (!hexColor.test(spec?.style?.groundColor ?? '')) errors.push('style.groundColor must be #RRGGBB');
  if (spec?.camera?.type !== 'perspective') errors.push('camera.type must be perspective');
  if (!validVector(spec?.camera?.position) || !validVector(spec?.camera?.target)) errors.push('camera position and target must be finite vec3 values');
  if (!(spec?.camera?.fov > 0 && spec.camera.fov < 180)) errors.push('camera.fov must be between 0 and 180');
  if (!(spec?.camera?.near > 0 && spec.camera.far > spec.camera.near)) errors.push('camera near/far range is invalid');
  if (!Array.isArray(spec?.lights) || spec.lights.length === 0) errors.push('at least one light is required');
  for (const [index, light] of (spec?.lights ?? []).entries()) {
    if (!light.id?.trim()) errors.push(`lights[${index}].id is required`);
    if (!hexColor.test(light.color ?? '')) errors.push(`lights[${index}].color must be #RRGGBB`);
    if (!Number.isFinite(light.intensity) || light.intensity < 0) errors.push(`lights[${index}].intensity must be non-negative`);
  }
  if (!Array.isArray(spec?.objects) || spec.objects.length === 0) errors.push('at least one object is required');
  const ids = new Set<string>();
  for (const [index, object] of (spec?.objects ?? []).entries()) validateObject(object, `objects[${index}]`, ids, errors, warnings);
  return { valid: errors.length === 0, errors, warnings };
}

export function assertValidSceneSpec(spec: SceneSpec): void {
  const result = validateSceneSpec(spec);
  if (!result.valid) throw new Error(`Scene Spec validation failed:\n- ${result.errors.join('\n- ')}`);
}
