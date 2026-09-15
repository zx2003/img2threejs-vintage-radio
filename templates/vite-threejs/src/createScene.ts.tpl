import * as THREE from 'three';
import type { SceneObjectSpec, SceneSpec } from './sceneSpec';

export interface SceneRuntime {
  root: THREE.Group;
  lights: THREE.Light[];
  interactiveMeshes: THREE.Object3D[];
  interactiveRoots: Map<string, THREE.Group>;
}

function createGeometry(spec: SceneObjectSpec['geometry']): THREE.BufferGeometry {
  const segments = Math.max(3, spec.segments ?? 12);
  switch (spec.shape) {
    case 'sphere': return new THREE.SphereGeometry(spec.radius ?? 0.5, segments, Math.max(3, Math.floor(segments * 0.65)));
    case 'cylinder': return new THREE.CylinderGeometry(spec.radiusTop ?? spec.radius ?? 0.5, spec.radiusBottom ?? spec.radius ?? 0.5, spec.height ?? 1, segments);
    case 'cone': return new THREE.ConeGeometry(spec.radius ?? spec.radiusBottom ?? 0.5, spec.height ?? 1, segments);
    case 'plane': return new THREE.PlaneGeometry(...(spec.size ?? [1, 1, 0]).slice(0, 2) as [number, number]);
    case 'torus': return new THREE.TorusGeometry(spec.radius ?? 0.5, spec.tube ?? 0.12, Math.max(3, Math.floor(segments / 2)), segments);
    case 'box':
    default: return new THREE.BoxGeometry(...(spec.size ?? [1, 1, 1]));
  }
}

function createMaterial(spec: SceneObjectSpec['material']): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: spec.color,
    roughness: spec.roughness ?? 0.72,
    metalness: spec.metalness ?? 0,
    transparent: spec.transparent ?? false,
    opacity: spec.opacity ?? 1,
    emissive: spec.emissive ?? '#000000',
    emissiveIntensity: spec.emissiveIntensity ?? 0,
  });
}

function applyTransform(object: THREE.Object3D, spec: SceneObjectSpec): void {
  object.position.set(...spec.transform.position);
  object.rotation.set(...spec.transform.rotation);
  object.scale.set(...spec.transform.scale);
}

function buildObject(spec: SceneObjectSpec, runtime: SceneRuntime, parentInteractiveId?: string): THREE.Group {
  const group = new THREE.Group();
  group.name = spec.name;
  group.userData.objectId = spec.id;
  group.userData.interactions = spec.interactions ?? [];
  applyTransform(group, spec);

  const mesh = new THREE.Mesh(createGeometry(spec.geometry), createMaterial(spec.material));
  mesh.name = `${spec.name} geometry`;
  mesh.castShadow = spec.castShadow ?? true;
  mesh.receiveShadow = spec.receiveShadow ?? true;
  const hinge = spec.interactions?.find((entry) => entry.type === 'hinge');
  if (hinge && spec.geometry.shape === 'box' && spec.geometry.size) mesh.position.x = spec.geometry.size[0] / 2;
  group.add(mesh);

  const interactiveId = spec.interactions?.length ? spec.id : parentInteractiveId;
  if (interactiveId) {
    mesh.userData.objectId = interactiveId;
    runtime.interactiveMeshes.push(mesh);
  }
  if (spec.interactions?.length) runtime.interactiveRoots.set(spec.id, group);

  for (const child of spec.children ?? []) group.add(buildObject(child, runtime, interactiveId));

  if (spec.interactions?.some((entry) => entry.type === 'toggle')) {
    group.traverse((node) => {
      if (!(node instanceof THREE.Mesh) || !(node.material instanceof THREE.MeshStandardMaterial)) return;
      if (node.material.emissive.getHex() === 0) node.material.emissive.copy(node.material.color).multiplyScalar(0.45);
      node.material.emissiveIntensity = Math.max(node.material.emissiveIntensity, 0.05);
    });
  }
  if (spec.type === 'light' && spec.interactions?.some((entry) => entry.type === 'toggle')) {
    const light = new THREE.PointLight('#ffc56d', 0, 8, 2);
    light.name = `${spec.name} interactive light`;
    light.position.set(0, -1.25, 0);
    light.castShadow = true;
    group.add(light);
    group.userData.toggleLight = light;
  }
  return group;
}

function buildLight(spec: SceneSpec['lights'][number]): THREE.Light {
  let light: THREE.Light;
  if (spec.type === 'hemisphere') light = new THREE.HemisphereLight(spec.color, spec.groundColor ?? '#555555', spec.intensity);
  else if (spec.type === 'directional') light = new THREE.DirectionalLight(spec.color, spec.intensity);
  else if (spec.type === 'point') light = new THREE.PointLight(spec.color, spec.intensity);
  else light = new THREE.AmbientLight(spec.color, spec.intensity);
  light.name = spec.id;
  if (spec.position) light.position.set(...spec.position);
  if ('castShadow' in light) light.castShadow = spec.castShadow ?? false;
  if (light instanceof THREE.DirectionalLight && light.castShadow) {
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.camera.left = -8;
    light.shadow.camera.right = 8;
    light.shadow.camera.top = 8;
    light.shadow.camera.bottom = -8;
  }
  return light;
}

export function createScene(spec: SceneSpec): SceneRuntime {
  const runtime: SceneRuntime = {
    root: new THREE.Group(),
    lights: spec.lights.map(buildLight),
    interactiveMeshes: [],
    interactiveRoots: new Map(),
  };
  runtime.root.name = spec.title;
  for (const object of spec.objects) runtime.root.add(buildObject(object, runtime));
  return runtime;
}
