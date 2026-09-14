import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { InteractiveKind, RoomRuntime } from './createRoomScene';

type HintHandler = (message: string, active?: boolean) => void;

const hints: Record<InteractiveKind, string> = {
  door: '点击开门 / 关门',
  chair: '按住并拖动椅子',
  drawer: '点击拉开 / 关闭抽屉',
  lamp: '点击开灯 / 关灯',
};

interface HighlightState {
  material: THREE.MeshStandardMaterial;
  emissive: THREE.Color;
  emissiveIntensity: number;
}

export class RoomInteractionController {
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: THREE.Camera;
  private readonly controls: OrbitControls;
  private readonly runtime: RoomRuntime;
  private readonly onHint: HintHandler;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly intersection = new THREE.Vector3();
  private readonly dragOffset = new THREE.Vector3();
  private readonly pointerDown = new THREE.Vector2();
  private readonly chairInitial = new THREE.Vector3();
  private hovered: THREE.Object3D | null = null;
  private highlighted: HighlightState[] = [];
  private draggingChair = false;
  private chairResetTarget: THREE.Vector3 | null = null;
  private doorTarget = 0;
  private drawerTarget = 0;
  private lampTarget = 0;
  private readonly drawerClosedZ: number;

  constructor(
    canvas: HTMLCanvasElement,
    camera: THREE.Camera,
    controls: OrbitControls,
    runtime: RoomRuntime,
    onHint: HintHandler,
  ) {
    this.canvas = canvas;
    this.camera = camera;
    this.controls = controls;
    this.runtime = runtime;
    this.onHint = onHint;
    this.chairInitial.copy(runtime.chair.position);
    this.drawerClosedZ = runtime.drawer.position.z;
    this.drawerTarget = this.drawerClosedZ;
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointercancel', this.finishChairDrag);
    canvas.addEventListener('pointerleave', this.handlePointerLeave);
  }

  private updatePointer(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private pickInteractive(): THREE.Object3D | null {
    const hit = this.raycaster.intersectObjects(this.runtime.interactiveMeshes, false)[0];
    if (!hit) return null;
    const objectId = hit.object.userData.objectId as string | undefined;
    return objectId ? this.runtime.interactiveRoots.get(objectId) ?? null : null;
  }

  private setHover(target: THREE.Object3D | null): void {
    if (this.hovered === target) return;
    for (const entry of this.highlighted) {
      entry.material.emissive.copy(entry.emissive);
      entry.material.emissiveIntensity = entry.emissiveIntensity;
    }
    this.highlighted = [];
    this.hovered = target;
    if (!target) {
      this.canvas.style.cursor = 'grab';
      this.onHint('点击门、抽屉或台灯 · 拖动办公椅 · 鼠标拖动旋转视角');
      return;
    }
    target.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const entry of materials) {
        if (!(entry instanceof THREE.MeshStandardMaterial)) continue;
        this.highlighted.push({
          material: entry,
          emissive: entry.emissive.clone(),
          emissiveIntensity: entry.emissiveIntensity,
        });
        entry.emissive.set(0xf6b85c);
        entry.emissiveIntensity = 0.28;
      }
    });
    this.canvas.style.cursor = target.userData.interactiveType === 'chair' ? 'grab' : 'pointer';
    this.onHint(hints[target.userData.interactiveType as InteractiveKind], true);
  }

  private handlePointerMove = (event: PointerEvent): void => {
    this.updatePointer(event);
    if (this.draggingChair) {
      if (this.raycaster.ray.intersectPlane(this.groundPlane, this.intersection)) {
        const { minX, maxX, minZ, maxZ } = this.runtime.chairBounds;
        this.runtime.chair.position.x = THREE.MathUtils.clamp(this.intersection.x + this.dragOffset.x, minX, maxX);
        this.runtime.chair.position.z = THREE.MathUtils.clamp(this.intersection.z + this.dragOffset.z, minZ, maxZ);
        this.runtime.chair.position.y = this.chairInitial.y;
      }
      this.canvas.style.cursor = 'grabbing';
      this.onHint('正在拖动椅子：移动范围已限制在房间地面内', true);
      return;
    }
    this.setHover(this.pickInteractive());
  };

  private handlePointerDown = (event: PointerEvent): void => {
    this.updatePointer(event);
    this.pointerDown.set(event.clientX, event.clientY);
    const picked = this.pickInteractive();
    if (picked?.userData.interactiveType !== 'chair') return;
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, this.intersection)) return;
    this.draggingChair = true;
    this.chairResetTarget = null;
    this.dragOffset.set(
      this.runtime.chair.position.x - this.intersection.x,
      0,
      this.runtime.chair.position.z - this.intersection.z,
    );
    this.controls.enabled = false;
    this.canvas.setPointerCapture(event.pointerId);
    this.canvas.style.cursor = 'grabbing';
    event.preventDefault();
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (this.draggingChair) {
      this.finishChairDrag(event);
      return;
    }
    if (this.pointerDown.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 5) return;
    this.updatePointer(event);
    const picked = this.pickInteractive();
    if (!picked) return;
    const kind = picked.userData.interactiveType as InteractiveKind;
    if (kind === 'door') {
      this.doorTarget = this.doorTarget > 0 ? 0 : Math.PI / 2;
      this.onHint(this.doorTarget > 0 ? '门正在打开' : '门正在关闭', true);
    } else if (kind === 'drawer') {
      this.drawerTarget = this.drawerTarget > this.drawerClosedZ + 0.1
        ? this.drawerClosedZ
        : this.drawerClosedZ + 0.88;
      this.onHint(this.drawerTarget > this.drawerClosedZ ? '抽屉正在拉开' : '抽屉正在关闭', true);
    } else if (kind === 'lamp') {
      this.lampTarget = this.lampTarget > 0 ? 0 : 3.2;
      this.onHint(this.lampTarget > 0 ? '台灯已开启' : '台灯已关闭', true);
    }
  };

  private finishChairDrag = (event?: PointerEvent): void => {
    if (!this.draggingChair) return;
    this.draggingChair = false;
    this.controls.enabled = true;
    if (event && this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    this.onHint('椅子位置已更新；仍可继续拖动');
  };

  private handlePointerLeave = (): void => {
    if (!this.draggingChair) this.setHover(null);
  };

  update(deltaSeconds: number): void {
    const blend = 1 - Math.exp(-7.5 * deltaSeconds);
    this.runtime.doorPivot.rotation.y = THREE.MathUtils.clamp(
      THREE.MathUtils.lerp(this.runtime.doorPivot.rotation.y, this.doorTarget, blend),
      0,
      Math.PI / 2,
    );
    this.runtime.drawer.position.z = THREE.MathUtils.lerp(this.runtime.drawer.position.z, this.drawerTarget, blend);
    this.runtime.lampLight.intensity = THREE.MathUtils.lerp(this.runtime.lampLight.intensity, this.lampTarget, blend);
    this.runtime.lampBulb.material.emissiveIntensity = THREE.MathUtils.lerp(
      this.runtime.lampBulb.material.emissiveIntensity,
      this.lampTarget > 0 ? 3.5 : 0.05,
      blend,
    );
    if (this.chairResetTarget && !this.draggingChair) {
      this.runtime.chair.position.lerp(this.chairResetTarget, blend);
      if (this.runtime.chair.position.distanceTo(this.chairResetTarget) < 0.003) {
        this.runtime.chair.position.copy(this.chairResetTarget);
        this.chairResetTarget = null;
      }
    }
  }

  reset(): void {
    this.doorTarget = 0;
    this.drawerTarget = this.drawerClosedZ;
    this.lampTarget = 0;
    this.chairResetTarget = this.chairInitial.clone();
    this.onHint('正在恢复门、椅子、抽屉、灯光和相机', true);
  }
}
