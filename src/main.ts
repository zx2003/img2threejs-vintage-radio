import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  configureVintagePortableRadioRenderer,
  createVintagePortableRadioEnvironment,
  createVintagePortableRadioLookDevLights,
  createVintagePortableRadioModel,
  frameVintagePortableRadioCamera,
} from './createObjectModel';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app container');

const query = new URLSearchParams(location.search);
const captureMode = query.get('capture') === '1';
const geometryMaskMode = query.get('mask') === '1';
const silhouetteMode = query.get('silhouette') === '1';
const manifestMode = query.get('manifest') === '1';
const requestedLightMode = query.get('light') ?? 'reference';
const lookDevMode = (['neutral', 'grazing', 'reference'].includes(requestedLightMode)
  ? requestedLightMode
  : 'reference') as 'neutral' | 'grazing' | 'reference';
const azimuthDeg = Number(query.get('az') ?? 20);
const elevationDeg = Number(query.get('el') ?? 12);
const framingMargin = Number(query.get('margin') ?? (captureMode ? 1.22 : 1.3));
const requestedExplode = THREE.MathUtils.clamp(Number(query.get('explode') ?? 0), 0, 1);
const requestedSelection = query.get('select');

const badge = document.createElement('div');
badge.className = 'badge';
badge.innerHTML = '<strong>Three.js Scene Factory</strong>收音机示例 · 拖动旋转 · 滚轮缩放 · 点击选择部件';
if (!captureMode) app.appendChild(badge);

const scene = new THREE.Scene();
scene.background = new THREE.Color(silhouetteMode ? 0x000000 : 0xd8dadd);

const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.01, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMappingExposure = lookDevMode === 'reference' ? 1.05 : lookDevMode === 'grazing' ? 0.95 : 1.0;
configureVintagePortableRadioRenderer(renderer);
if (silhouetteMode) {
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = false;
}
app.appendChild(renderer.domElement);

scene.environment = silhouetteMode ? null : createVintagePortableRadioEnvironment(renderer);

const model = createVintagePortableRadioModel();
model.userData.previewStage = 'optimization-pass';
model.traverse((node) => {
  if (node instanceof THREE.Mesh) {
    node.castShadow = true;
    node.receiveShadow = true;
    if (silhouetteMode) {
      node.material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    } else if (geometryMaskMode) {
      if (node.userData.sculptComponent?.id === 'feet') {
        node.visible = false;
        return;
      }
      node.material = new THREE.MeshBasicMaterial({ color: 0x3f6563 });
    }
  }
});

if (manifestMode) {
  const aggregated = new Map<string, { name: string; kind: string; module: string; triangles: number }>();
  let unnamedMeshes = 0;
  let integralMeshes = 0;
  model.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    integralMeshes += 1;
    if (!node.name.trim()) unnamedMeshes += 1;
    const componentId = node.userData.sculptComponent?.id as string | undefined;
    if (!componentId) return;
    const geometry = node.geometry as THREE.BufferGeometry;
    const baseTriangles = geometry.index
      ? geometry.index.count / 3
      : (geometry.getAttribute('position')?.count ?? 0) / 3;
    const triangles = baseTriangles * (node instanceof THREE.InstancedMesh ? node.count : 1);
    const existing = aggregated.get(componentId);
    if (existing) existing.triangles += triangles;
    else aggregated.set(componentId, {
      name: componentId,
      kind: 'part',
      module: componentId,
      triangles,
    });
  });
  const boundsFor = (name: string): THREE.Box3 => {
    const object = model.getObjectByName(name);
    return object ? new THREE.Box3().setFromObject(object) : new THREE.Box3();
  };
  const axisOverlap = (aName: string, bName: string, axis: 'x' | 'y' | 'z'): number => {
    const a = boundsFor(aName);
    const b = boundsFor(bName);
    if (a.isEmpty() || b.isEmpty()) return -1;
    return Math.max(0, Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]));
  };
  const bodyName = 'Rounded teal enclosure';
  const connections = [
    ['speaker-recess-to-body', 'Speaker recessed mounting well', bodyName, 'z'],
    ['dial-frame-to-body', 'Tuning window outer frame', bodyName, 'z'],
    ['knob-left-base-to-body', 'Rotary knob left mounting base', bodyName, 'z'],
    ['knob-right-base-to-body', 'Rotary knob right mounting base', bodyName, 'z'],
    ['handle-left-hinge-to-body', 'Handle left hinge housing', bodyName, 'x'],
    ['handle-right-hinge-to-body', 'Handle right hinge housing', bodyName, 'x'],
    ['foot-front-left-to-body', 'Cream support foot front-left', bodyName, 'y'],
    ['foot-front-right-to-body', 'Cream support foot front-right', bodyName, 'y'],
    ['foot-rear-left-to-body', 'Cream support foot rear-left', bodyName, 'y'],
    ['foot-rear-right-to-body', 'Cream support foot rear-right', bodyName, 'y'],
  ].map(([id, child, parent, axis]) => ({
    id,
    child,
    parent,
    axis,
    overlap: Number(axisOverlap(child, parent, axis as 'x' | 'y' | 'z').toFixed(5)),
  }));
  const runtime = model.userData.sculptRuntime as {
    nodes: Record<string, THREE.Object3D>;
    sockets: Record<string, THREE.Object3D>;
  };
  const manifest = {
    model: 'vintage-portable-radio-optimized',
    pass: 'optimization-pass',
    parts: [...aggregated.values()].sort((a, b) => a.name.localeCompare(b.name)),
    unnamedMeshes,
    integralMeshes,
    performance: {
      estimatedDrawCalls: integralMeshes,
      renderedTriangles: [...aggregated.values()].reduce((sum, part) => sum + part.triangles, 0),
      maxDrawCalls: 55,
      targetTriangles: 45000,
    },
    nodes: Object.keys(runtime.nodes).sort(),
    sockets: Object.keys(runtime.sockets).sort(),
    connections,
    macroLock: {
      referenceCamera: { fov: 34, azimuthDeg: 20, elevationDeg: 12, framingMargin: 1.22 },
      enclosure: { width: 4.45, height: 2.82, depth: 1.7, y: -0.06, bevel: 0.3 },
      handle: { topY: 1.74, radius: 0.13, leftX: -2.05, rightX: 2.05 },
      feet: { x: 1.72, y: -1.51, z: 0.48 },
      scaleDeltaLimit: 0.08,
    },
  };
  const output = document.createElement('pre');
  output.id = 'runtime-manifest';
  output.textContent = JSON.stringify(manifest, null, 2);
  app.appendChild(output);
}
scene.add(model);

if (!silhouetteMode) scene.add(createVintagePortableRadioLookDevLights(lookDevMode));

const bounds = new THREE.Box3().setFromObject(model);
const size = bounds.getSize(new THREE.Vector3());
const center = bounds.getCenter(new THREE.Vector3());
const floorY = bounds.min.y - Math.max(size.y * 0.02, 0.025);
if (!silhouetteMode) {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshStandardMaterial({ color: 0xcdd0d3, roughness: 0.92 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = floorY;
  floor.receiveShadow = true;
  scene.add(floor);
}

frameVintagePortableRadioCamera(camera, model, {
  margin: framingMargin,
  azimuthDeg,
  elevationDeg,
});

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.copy(center);
if (captureMode) controls.target.x += 0.02;
if (captureMode) controls.target.y -= 0.15;
controls.minDistance = Math.max(size.length() * 0.45, 1);
controls.maxDistance = Math.max(size.length() * 3.5, 8);
controls.update();

const runtime = model.userData.sculptRuntime as {
  nodes: Record<string, THREE.Object3D>;
  parts?: Record<string, THREE.Object3D>;
  setExplode?: (amount: number) => void;
};
const selectionBox = new THREE.BoxHelper(model, 0xff7043);
selectionBox.visible = false;
scene.add(selectionBox);
let selectedPart: THREE.Object3D | null = null;

const selectPart = (part: THREE.Object3D | null) => {
  selectedPart = part;
  selectionBox.visible = Boolean(part);
  if (part) selectionBox.setFromObject(part);
  const label = document.querySelector<HTMLElement>('#selected-part');
  if (label) label.textContent = part ? part.name.replace('__pivot', '') : '未选择部件';
};

if (requestedExplode > 0) {
  runtime.setExplode?.(requestedExplode);
  frameVintagePortableRadioCamera(camera, model, {
    margin: Math.max(framingMargin, 1.55),
    azimuthDeg,
    elevationDeg,
  });
  controls.target.copy(new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3()));
  controls.update();
}
if (requestedSelection && runtime.parts?.[requestedSelection]) {
  selectPart(runtime.parts[requestedSelection]);
}

if (!captureMode && !silhouetteMode && !manifestMode) {
  const toolbar = document.createElement('div');
  toolbar.className = 'interaction-panel';
  toolbar.innerHTML = `
    <span id="selected-part">未选择部件</span>
    <label>爆炸视图 <input id="explode-control" type="range" min="0" max="1" step="0.01" value="0"></label>
    <button id="reset-interaction" type="button">复位</button>
  `;
  app.appendChild(toolbar);
  const initialSelectedPart = requestedSelection ? runtime.parts?.[requestedSelection] : undefined;
  if (initialSelectedPart) {
    const label = toolbar.querySelector<HTMLElement>('#selected-part');
    if (label) label.textContent = initialSelectedPart.name.replace('__pivot', '');
  }
  toolbar.querySelector<HTMLInputElement>('#explode-control')?.addEventListener('input', (event) => {
    runtime.setExplode?.(Number((event.target as HTMLInputElement).value));
    if (selectedPart) selectionBox.setFromObject(selectedPart);
  });
  toolbar.querySelector<HTMLButtonElement>('#reset-interaction')?.addEventListener('click', () => {
    runtime.setExplode?.(0);
    const slider = toolbar.querySelector<HTMLInputElement>('#explode-control');
    if (slider) slider.value = '0';
    selectPart(null);
    frameVintagePortableRadioCamera(camera, model, { margin: 1.3, azimuthDeg: 20, elevationDeg: 12 });
    controls.target.copy(new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3()));
    controls.update();
  });

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerStart = new THREE.Vector2();
  renderer.domElement.addEventListener('pointerdown', (event) => pointerStart.set(event.clientX, event.clientY));
  renderer.domElement.addEventListener('pointerup', (event) => {
    if (pointerStart.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(model, true).find((item) => item.object instanceof THREE.Mesh);
    let candidate: THREE.Object3D | null = hit?.object ?? null;
    while (candidate && candidate !== model) {
      const id = candidate.userData.partId ?? candidate.userData.sculptComponent?.id;
      if (id && runtime.parts?.[id]) {
        selectPart(runtime.parts[id]);
        return;
      }
      candidate = candidate.parent;
    }
    selectPart(null);
  });
}

function resize(): void {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

addEventListener('resize', resize);

function render(): void {
  controls.update();
  if (selectedPart) selectionBox.setFromObject(selectedPart);
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

render();
