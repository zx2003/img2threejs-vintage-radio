import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SceneRuntime } from './createScene';
import type { InteractionSpec } from './sceneSpec';

interface ObjectState {
  root: THREE.Group;
  interactions: InteractionSpec[];
  homePosition: THREE.Vector3;
  homeRotation: THREE.Euler;
  hingeTarget: number;
  rotationTarget: number;
  toggleTarget: number;
}

interface HighlightRecord { material: THREE.MeshStandardMaterial; emissive: THREE.Color; intensity: number }

export class InteractionController {
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hitPoint = new THREE.Vector3();
  private readonly dragOffset = new THREE.Vector3();
  private readonly pointerDown = new THREE.Vector2();
  private readonly states = new Map<string, ObjectState>();
  private hovered: THREE.Group | null = null;
  private highlight: HighlightRecord[] = [];
  private dragging: ObjectState | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.Camera,
    private readonly controls: OrbitControls,
    private readonly runtime: SceneRuntime,
    private readonly showHint: (message: string) => void,
  ) {
    for (const [id, root] of runtime.interactiveRoots) {
      const interactions = root.userData.interactions as InteractionSpec[];
      const hinge = interactions.find((entry) => entry.type === 'hinge');
      const rotate = interactions.find((entry) => entry.type === 'rotate');
      const axis = hinge?.axis ?? rotate?.axis ?? 'y';
      this.states.set(id, {
        root,
        interactions,
        homePosition: root.position.clone(),
        homeRotation: root.rotation.clone(),
        hingeTarget: root.rotation[axis] + (hinge?.min ?? 0),
        rotationTarget: root.rotation[axis],
        toggleTarget: 0,
      });
    }
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.finishDrag);
    canvas.addEventListener('pointerleave', () => { if (!this.dragging) this.setHover(null); });
  }

  private updateRay(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private pick(): ObjectState | null {
    const hit = this.raycaster.intersectObjects(this.runtime.interactiveMeshes, false)[0];
    return hit ? this.states.get(hit.object.userData.objectId as string) ?? null : null;
  }

  private setHover(state: ObjectState | null): void {
    if (this.hovered === state?.root) return;
    for (const record of this.highlight) {
      record.material.emissive.copy(record.emissive);
      record.material.emissiveIntensity = record.intensity;
    }
    this.highlight = [];
    this.hovered = state?.root ?? null;
    if (!state) {
      this.canvas.style.cursor = 'grab';
      this.showHint('拖动旋转视角 · 滚轮缩放 · 悬停查看可交互物体');
      return;
    }
    state.root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        this.highlight.push({ material, emissive: material.emissive.clone(), intensity: material.emissiveIntensity });
        material.emissive.set('#ffb45e');
        material.emissiveIntensity = Math.max(material.emissiveIntensity, 0.28);
      }
    });
    const draggable = state.interactions.some((entry) => entry.type === 'drag');
    this.canvas.style.cursor = draggable ? 'grab' : 'pointer';
    this.showHint(draggable ? `拖动 ${state.root.name}` : `点击 ${state.root.name}`);
  }

  private onPointerMove = (event: PointerEvent): void => {
    this.updateRay(event);
    if (this.dragging) {
      const drag = this.dragging.interactions.find((entry) => entry.type === 'drag');
      if (drag?.bounds && this.raycaster.ray.intersectPlane(this.ground, this.hitPoint)) {
        this.dragging.root.position.x = THREE.MathUtils.clamp(this.hitPoint.x + this.dragOffset.x, drag.bounds.minX, drag.bounds.maxX);
        this.dragging.root.position.z = THREE.MathUtils.clamp(this.hitPoint.z + this.dragOffset.z, drag.bounds.minZ, drag.bounds.maxZ);
        this.dragging.root.position.y = this.dragging.homePosition.y;
      }
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    this.setHover(this.pick());
  };

  private onPointerDown = (event: PointerEvent): void => {
    this.updateRay(event);
    this.pointerDown.set(event.clientX, event.clientY);
    const picked = this.pick();
    if (!picked?.interactions.some((entry) => entry.type === 'drag')) return;
    if (!this.raycaster.ray.intersectPlane(this.ground, this.hitPoint)) return;
    this.dragging = picked;
    this.dragOffset.set(picked.root.position.x - this.hitPoint.x, 0, picked.root.position.z - this.hitPoint.z);
    this.controls.enabled = false;
    this.canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (this.dragging) {
      this.finishDrag(event);
      return;
    }
    if (this.pointerDown.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 5) return;
    this.updateRay(event);
    const picked = this.pick();
    if (!picked) return;
    const hinge = picked.interactions.find((entry) => entry.type === 'hinge');
    if (hinge) {
      const axis = hinge.axis ?? 'y';
      const closed = picked.homeRotation[axis] + (hinge.min ?? 0);
      const open = picked.homeRotation[axis] + (hinge.max ?? Math.PI / 2);
      picked.hingeTarget = Math.abs(picked.hingeTarget - closed) < 0.01 ? open : closed;
    }
    const rotate = picked.interactions.find((entry) => entry.type === 'rotate');
    if (rotate) {
      const minimum = picked.homeRotation[rotate.axis ?? 'y'] + (rotate.min ?? -Math.PI);
      const maximum = picked.homeRotation[rotate.axis ?? 'y'] + (rotate.max ?? Math.PI);
      const next = picked.rotationTarget + Math.PI / 4;
      picked.rotationTarget = next > maximum ? minimum : next;
    }
    if (picked.interactions.some((entry) => entry.type === 'toggle')) picked.toggleTarget = picked.toggleTarget > 0 ? 0 : 1;
  };

  private finishDrag = (event?: PointerEvent): void => {
    if (!this.dragging) return;
    this.dragging = null;
    this.controls.enabled = true;
    if (event && this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
  };

  update(delta: number): void {
    const blend = 1 - Math.exp(-7 * delta);
    for (const state of this.states.values()) {
      const hinge = state.interactions.find((entry) => entry.type === 'hinge');
      if (hinge) {
        const axis = hinge.axis ?? 'y';
        state.root.rotation[axis] = THREE.MathUtils.lerp(state.root.rotation[axis], state.hingeTarget, blend);
      }
      const rotate = state.interactions.find((entry) => entry.type === 'rotate');
      if (rotate) {
        const axis = rotate.axis ?? 'y';
        state.root.rotation[axis] = THREE.MathUtils.lerp(state.root.rotation[axis], state.rotationTarget, blend);
      }
      if (state.interactions.some((entry) => entry.type === 'toggle')) {
        const light = state.root.userData.toggleLight as THREE.PointLight | undefined;
        if (light) light.intensity = THREE.MathUtils.lerp(light.intensity, state.toggleTarget * 4, blend);
        state.root.traverse((node) => {
          if (!(node instanceof THREE.Mesh)) return;
          const material = node.material;
          if (material instanceof THREE.MeshStandardMaterial && material.emissive.getHex() !== 0) {
            material.emissiveIntensity = THREE.MathUtils.lerp(material.emissiveIntensity, state.toggleTarget * 3.5 + 0.05, blend);
          }
        });
      }
    }
  }

  reset(): void {
    this.finishDrag();
    for (const state of this.states.values()) {
      state.root.position.copy(state.homePosition);
      state.root.rotation.copy(state.homeRotation);
      const hinge = state.interactions.find((entry) => entry.type === 'hinge');
      const axis = hinge?.axis ?? 'y';
      state.hingeTarget = state.homeRotation[axis] + (hinge?.min ?? 0);
      state.rotationTarget = state.homeRotation[axis];
      state.toggleTarget = 0;
    }
    this.showHint('场景状态和相机已重置');
  }
}
