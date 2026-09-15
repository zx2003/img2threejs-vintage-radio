export type Vector3Tuple = [number, number, number];

export type PrimitiveShape = 'box' | 'sphere' | 'cylinder' | 'cone' | 'plane' | 'torus';

export interface GeometrySpec {
  shape: PrimitiveShape;
  size?: Vector3Tuple;
  radius?: number;
  radiusTop?: number;
  radiusBottom?: number;
  tube?: number;
  height?: number;
  segments?: number;
}

export interface MaterialSpec {
  color: string;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  transparent?: boolean;
  emissive?: string;
  emissiveIntensity?: number;
}

export interface TransformSpec {
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  scale: Vector3Tuple;
}

export type InteractionType = 'toggle' | 'hinge' | 'rotate' | 'drag' | 'hover';

export interface InteractionSpec {
  type: InteractionType;
  axis?: 'x' | 'y' | 'z';
  min?: number;
  max?: number;
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export interface SceneObjectSpec {
  id: string;
  name: string;
  type: string;
  geometry: GeometrySpec;
  material: MaterialSpec;
  transform: TransformSpec;
  interactions?: InteractionSpec[];
  children?: SceneObjectSpec[];
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export interface CameraSpec {
  type: 'perspective';
  position: Vector3Tuple;
  target: Vector3Tuple;
  fov: number;
  near: number;
  far: number;
}

export interface LightSpec {
  id: string;
  type: 'ambient' | 'hemisphere' | 'directional' | 'point';
  color: string;
  groundColor?: string;
  intensity: number;
  position?: Vector3Tuple;
  castShadow?: boolean;
}

export interface SceneSpec {
  version: '1.0';
  name: string;
  title: string;
  style: {
    preset: string;
    background: string;
    groundColor: string;
  };
  camera: CameraSpec;
  lights: LightSpec[];
  objects: SceneObjectSpec[];
  source?: { kind: 'prompt' | 'json'; value?: string };
}

export const identityTransform = (position: Vector3Tuple = [0, 0, 0]): TransformSpec => ({
  position,
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
});
