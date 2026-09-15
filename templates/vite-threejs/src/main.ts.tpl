import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createScene } from './createScene';
import { InteractionController } from './interactions';
import { sceneSpec } from './sceneSpec';
import './styles.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app container');

const scene = new THREE.Scene();
scene.background = new THREE.Color(sceneSpec.style.background);
const camera = new THREE.PerspectiveCamera(sceneSpec.camera.fov, innerWidth / innerHeight, sceneSpec.camera.near, sceneSpec.camera.far);
camera.position.set(...sceneSpec.camera.position);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const runtime = createScene(sceneSpec);
scene.add(runtime.root);
for (const light of runtime.lights) scene.add(light);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(...sceneSpec.camera.target);
controls.minDistance = 4;
controls.maxDistance = 35;
controls.update();

const hud = document.createElement('aside');
hud.className = 'hud';
hud.innerHTML = `<h1>${sceneSpec.title}</h1><p id="hint">拖动旋转视角 · 滚轮缩放 · 悬停查看可交互物体</p><button id="reset" type="button">重置场景</button>`;
app.appendChild(hud);
const hint = hud.querySelector<HTMLParagraphElement>('#hint');
const reset = hud.querySelector<HTMLButtonElement>('#reset');
if (!hint || !reset) throw new Error('Failed to create controls');

const interactions = new InteractionController(renderer.domElement, camera, controls, runtime, (message) => { hint.textContent = message; });
reset.addEventListener('click', () => {
  interactions.reset();
  camera.position.set(...sceneSpec.camera.position);
  controls.target.set(...sceneSpec.camera.target);
  controls.update();
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
function render(): void {
  const delta = Math.min(clock.getDelta(), 0.05);
  interactions.update(delta);
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}
render();
