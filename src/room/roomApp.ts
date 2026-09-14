import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomInteractionController } from './RoomInteractionController';
import { createRoomScene } from './createRoomScene';
import './room.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app container');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe8ded1);

const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.05, 100);
const cameraHome = new THREE.Vector3(15.2, 12.2, 16.2);
const targetHome = new THREE.Vector3(0, 1.5, -0.05);
camera.position.copy(cameraHome);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const room = createRoomScene();
scene.add(room.root);

const hemisphere = new THREE.HemisphereLight(0xffecd0, 0x796655, 1.7);
hemisphere.name = 'Warm ambient light';
scene.add(hemisphere);

const key = new THREE.DirectionalLight(0xffd59b, 2.6);
key.name = 'Warm main light';
key.position.set(-7, 11, 8);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -9;
key.shadow.camera.right = 9;
key.shadow.camera.top = 9;
key.shadow.camera.bottom = -9;
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 32;
key.shadow.bias = -0.00035;
key.shadow.normalBias = 0.025;
scene.add(key);

const fill = new THREE.DirectionalLight(0xfff3df, 0.62);
fill.name = 'Soft fill light';
fill.position.set(8, 5, 5);
scene.add(fill);

const outsideFloor = new THREE.Mesh(
  new THREE.PlaneGeometry(35, 35),
  new THREE.MeshStandardMaterial({ color: 0xdfd3c5, roughness: 1 }),
);
outsideFloor.name = 'Exterior shadow ground';
outsideFloor.rotation.x = -Math.PI / 2;
outsideFloor.position.y = -0.19;
outsideFloor.receiveShadow = true;
scene.add(outsideFloor);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.target.copy(targetHome);
controls.minDistance = 9;
controls.maxDistance = 32;
controls.minPolarAngle = THREE.MathUtils.degToRad(28);
controls.maxPolarAngle = THREE.MathUtils.degToRad(78);
controls.update();

const hud = document.createElement('aside');
hud.className = 'room-hud';
hud.innerHTML = `
  <div class="room-title-row">
    <div>
      <span class="room-kicker">INTERACTIVE LOW-POLY SCENE</span>
      <h1>温暖卧室书房</h1>
    </div>
    <a class="scene-link" href="./" title="返回原有收音机预览">收音机</a>
  </div>
  <p id="room-hint" class="room-hint">点击门、抽屉或台灯 · 拖动办公椅 · 鼠标拖动旋转视角</p>
  <div class="room-help-grid" aria-label="交互说明">
    <span><b>门</b> 点击开关</span>
    <span><b>椅子</b> 按住拖动</span>
    <span><b>抽屉</b> 点击拉开</span>
    <span><b>台灯</b> 点击点亮</span>
  </div>
  <button id="reset-room" type="button">重置场景</button>
`;
app.appendChild(hud);

const hint = hud.querySelector<HTMLParagraphElement>('#room-hint');
const resetButton = hud.querySelector<HTMLButtonElement>('#reset-room');
if (!hint || !resetButton) throw new Error('Room controls failed to initialize');

let hintTimer = 0;
const defaultHint = '点击门、抽屉或台灯 · 拖动办公椅 · 鼠标拖动旋转视角';
const setHint = (message: string, active = false): void => {
  hint.textContent = message;
  hint.classList.toggle('is-active', active);
  window.clearTimeout(hintTimer);
  if (active) {
    hintTimer = window.setTimeout(() => {
      hint.textContent = defaultHint;
      hint.classList.remove('is-active');
    }, 2200);
  }
};

const interactions = new RoomInteractionController(renderer.domElement, camera, controls, room, setHint);
let cameraResetActive = false;
controls.addEventListener('start', () => {
  cameraResetActive = false;
});
resetButton.addEventListener('click', () => {
  interactions.reset();
  cameraResetActive = true;
});

function resize(): void {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);

const clock = new THREE.Clock();
function render(): void {
  const delta = Math.min(clock.getDelta(), 0.05);
  interactions.update(delta);
  if (cameraResetActive) {
    const blend = 1 - Math.exp(-5.2 * delta);
    camera.position.lerp(cameraHome, blend);
    controls.target.lerp(targetHome, blend);
    if (camera.position.distanceTo(cameraHome) < 0.005 && controls.target.distanceTo(targetHome) < 0.005) {
      camera.position.copy(cameraHome);
      controls.target.copy(targetHome);
      cameraResetActive = false;
      setHint('场景已恢复到初始状态', true);
    }
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}
render();
