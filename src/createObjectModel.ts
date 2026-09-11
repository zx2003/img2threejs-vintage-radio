import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
  parts?: Record<string, THREE.Object3D>;
  setExplode?: (amount: number) => void;
};

type SculptMaterialSpec = Record<string, any>;

// THREE.CapsuleGeometry duplicates every UV-seam vertex (measured: 194 boundary
// edges on the default radius/segments below) -- same benign pattern as box/
// cylinder/sphere/torus, all of which weld cleanly to 0 given a CORRECT weld.
// (A naive vertex-only mergeVertices() reports 64 'non-manifold' edges here, but
// that is a counting artifact, not a real defect: it double-counts a handful of
// near-pole triangles that become degenerate once two of their three corners
// coincide -- confirmed by replicating subdivideCatmullClark's own degenerate-
// triangle-aware vertex identity, which finds a perfectly ordinary 2-manifold.)
// A capsule is the primary shape for skinned limbs/torso (PLAN_1.5), and skinning
// weight computation is O(vertices x bones), so fewer, guaranteed-simple vertices
// is worth having regardless -- authored as a deterministic, closed-by-
// construction mesh instead: shared pole vertices, and
// the radial index taken `% radialSegments` so the seam is never a duplicate
// vertex in the first place, rather than something to weld away afterward.
// Adapted from forge/stage5_rig/emit_rig.py's buildWatertightCapsule (verified
// there: 0 boundary edges, 0 non-manifold edges, deterministic across repeated
// runs) -- ported here rather than imported because this factory and the rig
// emitter are separate generated-output surfaces with no shared runtime module;
// see forge/tests/test_primitive_watertightness.py for the measured proof, and
// coordinate with the rig owner before changing either copy independently.
function buildWatertightCapsule(
  radius: number,
  cylLength: number,
  capSegments: number,
  radialSegments: number,
  heightSegments: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const halfCyl = cylLength / 2;
  const totalSpan = 2 * (Math.PI / 2 * radius) + Math.max(0, cylLength);
  const vOf = (fromBottom: number) => (totalSpan > 0 ? fromBottom / totalSpan : 0);

  const bottomPoleIndex = positions.length / 3;
  positions.push(0, -halfCyl - radius, 0);
  uvs.push(0.5, vOf(0));

  const ringStarts: number[] = [];
  const ringV: number[] = [];
  for (let ring = 1; ring <= capSegments; ring += 1) {
    const phi = (Math.PI / 2) * (ring / capSegments);
    const y = -halfCyl - radius * Math.cos(phi);
    const r = radius * Math.sin(phi);
    const start = positions.length / 3;
    ringStarts.push(start);
    ringV.push(vOf(radius * phi));
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const theta = (radial / radialSegments) * Math.PI * 2;
      positions.push(r * Math.cos(theta), y, r * Math.sin(theta));
      uvs.push(radial / radialSegments, vOf(radius * phi));
    }
  }

  const cylinderRingStarts: number[] = [];
  if (cylLength > 0) {
    for (let step = 1; step <= heightSegments; step += 1) {
      const y = -halfCyl + (cylLength * step) / heightSegments;
      const start = positions.length / 3;
      cylinderRingStarts.push(start);
      const v = vOf(radius * (Math.PI / 2) + halfCyl + y);
      for (let radial = 0; radial < radialSegments; radial += 1) {
        const theta = (radial / radialSegments) * Math.PI * 2;
        positions.push(radius * Math.cos(theta), y, radius * Math.sin(theta));
        uvs.push(radial / radialSegments, v);
      }
    }
  }

  const topRingStarts: number[] = [];
  for (let ring = capSegments - 1; ring >= 1; ring -= 1) {
    const phi = (Math.PI / 2) * (ring / capSegments);
    const y = halfCyl + radius * Math.cos(phi);
    const r = radius * Math.sin(phi);
    const start = positions.length / 3;
    topRingStarts.push(start);
    const v = vOf(radius * (Math.PI / 2) + Math.max(0, cylLength) + radius * (Math.PI / 2 - phi));
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const theta = (radial / radialSegments) * Math.PI * 2;
      positions.push(r * Math.cos(theta), y, r * Math.sin(theta));
      uvs.push(radial / radialSegments, v);
    }
  }

  const topPoleIndex = positions.length / 3;
  positions.push(0, halfCyl + radius, 0);
  uvs.push(0.5, vOf(totalSpan));

  const firstBottomRing = ringStarts[0];
  for (let radial = 0; radial < radialSegments; radial += 1) {
    const next = (radial + 1) % radialSegments;
    indices.push(bottomPoleIndex, firstBottomRing + radial, firstBottomRing + next);
  }

  const allRings = [...ringStarts, ...cylinderRingStarts, ...topRingStarts];
  for (let i = 0; i < allRings.length - 1; i += 1) {
    const a = allRings[i];
    const b = allRings[i + 1];
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const next = (radial + 1) % radialSegments;
      indices.push(a + radial, a + next, b + next);
      indices.push(a + radial, b + next, b + radial);
    }
  }

  const lastRing = allRings[allRings.length - 1];
  for (let radial = 0; radial < radialSegments; radial += 1) {
    const next = (radial + 1) % radialSegments;
    indices.push(topPoleIndex, lastRing + next, lastRing + radial);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Plan 1.3 F.6 — sweep a thin 2D cross-section along a 3D spine so a curved
// form (hooked blade, handle) reads correctly from EVERY camera angle, not just
// the reference angle a flat extrude happens to match. Uses ExtrudeGeometry's
// native extrudePath; bevelEnabled: false keeps sharp tips (same rule as F.5).
function buildCurveSweepGeometry(
  sweep: { spine: [number, number, number][]; crossSection: { points: [number, number][] }; closed?: boolean },
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const cs = sweep.crossSection.points;
  if (cs.length > 0) {
    shape.moveTo(cs[0][0], cs[0][1]);
    for (let i = 1; i < cs.length; i += 1) shape.lineTo(cs[i][0], cs[i][1]);
    shape.closePath();
  }
  const spine = sweep.spine.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const path = new THREE.CatmullRomCurve3(spine, sweep.closed ?? false);
  return new THREE.ExtrudeGeometry(shape, {
    extrudePath: path,
    steps: Math.max(24, spine.length * 8),
    bevelEnabled: false,
  });
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  // setStyle with an explicit SRGBColorSpace, NOT the numeric constructor.
  //
  // `new THREE.Color(r, g, b)` treats its arguments as LINEAR working-space components,
  // while an authored `baseColor` hex is sRGB. Feeding one to the other skipped the
  // transfer function and lifted every dark albedo: #2e2a28, authored as a near-black
  // vinyl, rendered at roughly sRGB 0.46 — a mid grey. The error is largest exactly where
  // it matters most, because the transfer curve is steepest near black.
  return new THREE.Color().setStyle(source, THREE.SRGBColorSpace);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  // A material that declares -- with evidence -- that its subject carries no texture
  // detail gets NO texture set. Synthesising one anyway is not a harmless default: the
  // branch below then forces color to white and roughness to 1 and reads both from the
  // generated maps, so the authored albedo and the reference-derived roughness are both
  // discarded, and the model gains mottling the reference does not have. Measured on the
  // tuxedo cat, whose black fur rendered as speckled grey-and-white from a palette that
  // only ever described two flat regions.
  const textureless = (spec.textureless as { declared?: boolean } | undefined)?.declared === true;
  const textures = textureless
    ? null
    : makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Vintage Portable Radio
// Sculpt build pass: form-refinement
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
function createGeneratedVintagePortableRadioModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Vintage Portable Radio";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 34.0, "aspect": 1.0, "orientation": {"yaw": 20.0, "pitch": 12.0, "roll": 0.0}, "positionHint": [4.7, 3.0, 7.2], "note": "Silhouette-calibrated front-right three-quarter review view; capture margin 1.20 and no texture projection required."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["tealPlastic"] = createSculptMaterial(
    "tealPlastic",
    {"id": "tealPlastic", "name": "Teal molded enclosure plastic", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#4E918D", "color": "#4E918D", "albedo": {"dominant": "#668483", "secondary": ["#557F7C", "#4B7471", "#2A4541"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\teal\\tealplastic_albedo.png", "url": "tealplastic_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}}, "colorVariation": {"palette": ["#668483", "#557F7C", "#4B7471", "#2A4541", "#9AA096"], "pattern": "reference-derived pixel palette", "amplitude": 0.08, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "generated", "repeat": [6, 6], "anisotropy": 4, "texelDensityIntent": "stable micro-scale stipple"}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.317, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.722, "variation": 0.082, "map": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\teal\\tealplastic_roughness.png", "url": "tealplastic_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 0, "variation": 0}, "normal": {"pattern": "reference-derived height-gradient normal map", "strength": 0.214, "map": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\teal\\tealplastic_normal.png", "url": "tealplastic_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "heightSource": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\teal\\tealplastic_height.png", "url": "tealplastic_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.022, "map": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\teal\\tealplastic_height.png", "url": "tealplastic_height.png", "channel": "height", "source": "reference-pixel-extraction"}}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "map": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\teal\\tealplastic_ao.png", "url": "tealplastic_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#244A48"}, "localOverrides": [{"id": "fine-molded-variation", "region": "front and side shell", "roughness": 0.6, "normalStrength": 0.08, "evidenceRefs": ["detail-inventory/zone-r2c1.png"]}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["Dielectric molded plastic; keep metalness at zero.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "referencePbr": {"version": "1.0", "sourceImage": "D:\\桌面\\img2threejs-test\\material-crops\\zone-r2c3.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.831, "estimatedFidelity": 0.831, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\teal\\tealplastic_albedo.png", "url": "tealplastic_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\teal\\tealplastic_roughness.png", "url": "tealplastic_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\teal\\tealplastic_height.png", "url": "tealplastic_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\teal\\tealplastic_normal.png", "url": "tealplastic_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\teal\\tealplastic_ao.png", "url": "tealplastic_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 314, "sourceHeight": 314, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 215, "height": 314}, "mask": {"backgroundColor": "#CAC7BD", "backgroundNoise": 18.466, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.6372}, "mapStats": {"valueRange": 0.1064, "heightP90Gradient": 0.04957, "roughnessBase": 0.722, "roughnessVariation": 0.082, "normalStrength": 0.214, "blurRadius": 21}, "palette": ["#668483", "#557F7C", "#4B7471", "#2A4541", "#9AA096"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"]}},
    options
  );
  materialMap["ivoryPlastic"] = createSculptMaterial(
    "ivoryPlastic",
    {"id": "ivoryPlastic", "name": "Warm ivory plastic", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#E7E1D1", "color": "#E7E1D1", "albedo": {"dominant": "#EAE5DC", "secondary": ["#F2EDE2", "#919183", "#BAB5A6"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\ivory\\ivoryplastic_albedo.png", "url": "ivoryplastic_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}}, "colorVariation": {"palette": ["#EAE5DC", "#F2EDE2", "#919183", "#BAB5A6", "#E4DED3"], "pattern": "reference-derived pixel palette", "amplitude": 0.173, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "generated", "repeat": [4, 4], "anisotropy": 4, "texelDensityIntent": "stable micro-scale plastic"}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.424, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.201, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.084, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.68, "variation": 0.05, "map": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\ivory\\ivoryplastic_roughness.png", "url": "ivoryplastic_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 0, "variation": 0}, "clearcoat": 0.22, "clearcoatRoughness": 0.28, "normal": {"pattern": "reference-derived height-gradient normal map", "strength": 0.171, "map": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\ivory\\ivoryplastic_normal.png", "url": "ivoryplastic_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "heightSource": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\ivory\\ivoryplastic_height.png", "url": "ivoryplastic_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.01, "map": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\ivory\\ivoryplastic_height.png", "url": "ivoryplastic_height.png", "channel": "height", "source": "reference-pixel-extraction"}}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "map": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\ivory\\ivoryplastic_ao.png", "url": "ivoryplastic_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#9E9889"}, "localOverrides": [{"id": "handle-crest-highlight", "region": "outer handle arch", "roughness": 0.18, "clearcoat": 0.28, "evidenceRefs": ["detail-inventory/zone-r0c1.png"]}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["Slightly glossier than the teal enclosure.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "referencePbr": {"version": "1.0", "sourceImage": "D:\\桌面\\img2threejs-test\\material-crops\\zone-r0c1.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.77, "estimatedFidelity": 0.77, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\ivory\\ivoryplastic_albedo.png", "url": "ivoryplastic_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\ivory\\ivoryplastic_roughness.png", "url": "ivoryplastic_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\ivory\\ivoryplastic_height.png", "url": "ivoryplastic_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\ivory\\ivoryplastic_normal.png", "url": "ivoryplastic_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\ivory\\ivoryplastic_ao.png", "url": "ivoryplastic_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 314, "sourceHeight": 314, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 137, "width": 314, "height": 177}, "mask": {"backgroundColor": "#CECECF", "backgroundNoise": 4.69, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.0731}, "mapStats": {"valueRange": 0.4109, "heightP90Gradient": 0.01216, "roughnessBase": 0.68, "roughnessVariation": 0.05, "normalStrength": 0.171, "blurRadius": 21}, "palette": ["#EAE5DC", "#F2EDE2", "#919183", "#BAB5A6", "#E4DED3"]}, "warnings": ["foreground mask is very small", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}},
    options
  );
  materialMap["charcoalPlastic"] = createSculptMaterial(
    "charcoalPlastic",
    {"id": "charcoalPlastic", "name": "Charcoal speaker plastic", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#343536", "color": "#343536", "albedo": {"dominant": "#5D8A87", "secondary": ["#6F9C99", "#81A6A4", "#070807"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\charcoal\\charcoalplastic_albedo.png", "url": "charcoalplastic_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}}, "colorVariation": {"palette": ["#5D8A87", "#6F9C99", "#81A6A4", "#070807", "#49726F"], "pattern": "reference-derived pixel palette", "amplitude": 0.252, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "cylindrical", "repeat": [2, 2], "anisotropy": 4, "texelDensityIntent": "stable speaker plate finish"}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.49, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.306, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.693, "variation": 0.05, "map": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\charcoal\\charcoalplastic_roughness.png", "url": "charcoalplastic_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 0, "variation": 0}, "normal": {"pattern": "reference-derived height-gradient normal map", "strength": 0.2, "map": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\charcoal\\charcoalplastic_normal.png", "url": "charcoalplastic_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "heightSource": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\charcoal\\charcoalplastic_height.png", "url": "charcoalplastic_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.017, "map": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\charcoal\\charcoalplastic_height.png", "url": "charcoalplastic_height.png", "channel": "height", "source": "reference-pixel-extraction"}}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "map": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\charcoal\\charcoalplastic_ao.png", "url": "charcoalplastic_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0.02, "cavityBias": 0.3, "color": "#161718"}, "localOverrides": [{"id": "bezel-crown", "region": "outer speaker bezel", "roughness": 0.36, "evidenceRefs": ["detail-inventory/zone-r1c0.png"]}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["Keep plate dielectric; depth comes from real recess geometry.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "referencePbr": {"version": "1.0", "sourceImage": "D:\\桌面\\img2threejs-test\\material-crops\\zone-r1c1.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\charcoal\\charcoalplastic_albedo.png", "url": "charcoalplastic_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\charcoal\\charcoalplastic_roughness.png", "url": "charcoalplastic_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\charcoal\\charcoalplastic_height.png", "url": "charcoalplastic_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\charcoal\\charcoalplastic_normal.png", "url": "charcoalplastic_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "D:\\桌面\\img2threejs-test\\material-evidence\\charcoal\\charcoalplastic_ao.png", "url": "charcoalplastic_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 314, "sourceHeight": 314, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 8, "width": 314, "height": 306}, "mask": {"backgroundColor": "#859493", "backgroundNoise": 112.597, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.4219}, "mapStats": {"valueRange": 0.6009, "heightP90Gradient": 0.03721, "roughnessBase": 0.693, "roughnessVariation": 0.05, "normalStrength": 0.2, "blurRadius": 21}, "palette": ["#5D8A87", "#6F9C99", "#81A6A4", "#070807", "#49726F"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}},
    options
  );
  materialMap["grilleCavity"] = createSculptMaterial(
    "grilleCavity",
    {"id": "grilleCavity", "name": "Speaker cavity black", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#090A0A", "color": "#090A0A", "albedo": {"dominant": "#090A0A", "secondary": ["#050606", "#111212"], "samplingNotes": "Dark hole interiors."}, "colorVariation": {"palette": ["#090A0A", "#050606"], "pattern": "none", "amplitude": 0.001, "heightCorrelation": 0}, "textureResolution": 512, "textureProjection": {"mode": "generated", "repeat": [1, 1], "anisotropy": 1, "texelDensityIntent": "solid cavity"}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 1, "amplitude": 0.001, "role": "solid cavity"}, {"id": "meso", "frequency": 8, "amplitude": 0.001, "role": "near-uniform"}, {"id": "micro", "frequency": 32, "amplitude": 0.001, "role": "near-uniform"}], "roughness": {"base": 0.78, "variation": 0.02, "map": "independent constant", "localResponse": "uniform cavity"}, "metalness": {"base": 0, "variation": 0}, "normal": {"pattern": "none", "strength": 0, "scale": 1, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0, "scale": 1}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.7, "contactShadowBias": 0.5, "notes": "deep visual recess"}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#000000"}, "localOverrides": [], "shaderNotes": ["Non-reflective cavity contrast."]},
    options
  );
  materialMap["dialFaceMaterial"] = createSculptMaterial(
    "dialFaceMaterial",
    {"id": "dialFaceMaterial", "name": "Pale tuning face", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#D8D2C2", "color": "#D8D2C2", "albedo": {"dominant": "#D8D2C2", "secondary": ["#C9C3B4", "#E5DFCF"], "samplingNotes": "Inset dial face midtone."}, "colorVariation": {"palette": ["#D8D2C2", "#D0CABB"], "pattern": "subtle vertical value rolloff", "amplitude": 0.015, "heightCorrelation": 0}, "textureResolution": 512, "textureProjection": {"mode": "generated", "repeat": [1, 1], "anisotropy": 2, "texelDensityIntent": "flat dial face"}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 1, "amplitude": 0.015, "role": "soft face gradient"}, {"id": "meso", "frequency": 8, "amplitude": 0.004, "role": "print carrier"}, {"id": "micro", "frequency": 40, "amplitude": 0.002, "role": "matte paper-plastic breakup"}], "roughness": {"base": 0.63, "variation": 0.025, "map": "independent procedural field", "localResponse": "uniform matte face"}, "metalness": {"base": 0, "variation": 0}, "normal": {"pattern": "fine matte grain", "strength": 0.02, "scale": 40, "space": "tangent"}, "bump": {"pattern": "fine matte grain", "amplitude": 0.002, "scale": 40}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.16, "contactShadowBias": 0.2, "notes": "frame reveal"}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#918B7C"}, "localOverrides": [{"id": "frame-reveal-shadow", "region": "dial inset perimeter", "roughness": 0.68, "evidenceRefs": ["detail-inventory/zone-r1c1.png"]}], "shaderNotes": ["Matte pale carrier behind line geometry."]},
    options
  );
  materialMap["dialInk"] = createSculptMaterial(
    "dialInk",
    {"id": "dialInk", "name": "Charcoal dial ink", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#343330", "color": "#343330", "albedo": {"dominant": "#343330", "secondary": ["#292825"], "samplingNotes": "Dial baseline and tick marks."}, "colorVariation": {"palette": ["#343330"], "pattern": "none", "amplitude": 0.001, "heightCorrelation": 0}, "textureResolution": 512, "textureProjection": {"mode": "generated", "repeat": [1, 1], "anisotropy": 1, "texelDensityIntent": "solid linework"}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 1, "amplitude": 0.001, "role": "solid ink"}, {"id": "meso", "frequency": 8, "amplitude": 0.001, "role": "near-uniform"}, {"id": "micro", "frequency": 32, "amplitude": 0.001, "role": "near-uniform"}], "roughness": {"base": 0.56, "variation": 0.01, "map": "independent constant", "localResponse": "uniform ink"}, "metalness": {"base": 0, "variation": 0}, "normal": {"pattern": "none", "strength": 0, "scale": 1, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0, "scale": 1}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.05, "contactShadowBias": 0.05, "notes": "none"}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#000000"}, "localOverrides": [], "shaderNotes": ["Thin dark line geometry."]},
    options
  );
  materialMap["redPaint"] = createSculptMaterial(
    "redPaint",
    {"id": "redPaint", "name": "Muted red indicator paint", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#B92F2D", "color": "#B92F2D", "albedo": {"dominant": "#B92F2D", "secondary": ["#8F2322", "#CF4540"], "samplingNotes": "Central red tuning needle."}, "colorVariation": {"palette": ["#B92F2D", "#A82927"], "pattern": "none", "amplitude": 0.01, "heightCorrelation": 0}, "textureResolution": 512, "textureProjection": {"mode": "generated", "repeat": [1, 1], "anisotropy": 1, "texelDensityIntent": "solid indicator"}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 1, "amplitude": 0.01, "role": "slight value variation"}, {"id": "meso", "frequency": 8, "amplitude": 0.001, "role": "near-uniform"}, {"id": "micro", "frequency": 32, "amplitude": 0.001, "role": "near-uniform"}], "roughness": {"base": 0.38, "variation": 0.02, "map": "independent constant", "localResponse": "small highlight on needle"}, "metalness": {"base": 0, "variation": 0}, "normal": {"pattern": "none", "strength": 0, "scale": 1, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0, "scale": 1}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.08, "contactShadowBias": 0.08, "notes": "slight contact shadow"}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#5C1110"}, "localOverrides": [{"id": "needle-crown", "region": "needle center", "roughness": 0.32, "evidenceRefs": ["detail-inventory/zone-r1c1.png"]}], "shaderNotes": ["Primary accent color; dielectric paint."]},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_enclosure_0 = makeAttachmentEndpoint(null);
  const node_enclosure_0 = new THREE.Group();
  node_enclosure_0.name = "Rounded teal enclosure__pivot";
  node_enclosure_0.scale.set(1, 1, 1);
  if (endpoint_enclosure_0) {
    node_enclosure_0.position.copy(endpoint_enclosure_0.start);
    node_enclosure_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_enclosure_0.position.set(0.0, -0.06, 0.0);
    node_enclosure_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_enclosure_0.userData.sculptComponent = {"id": "enclosure", "name": "Rounded teal enclosure", "level": "macro", "role": "root-body", "importance": 1.0, "confidence": 0.94, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Rigid molded chassis with countable faces and large fillets; a rounded box is structurally appropriate.", "geometryDescriptor": {"topologyIntent": "wide rounded cuboid with deep corner fillets", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.3, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "weighted vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 4.45, "height": 2.82, "depth": 1.7, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, -0.06, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(78, 145, 141, 1.0)", "secondaryAlbedo": "rgba(101, 162, 158, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.94, "evidence": ["full-object"], "samplingNotes": "Teal shell midtone excluding highlights."}, "material": "tealPlastic", "materialLayers": ["tealPlastic"], "localFeatures": [{"id": "rounded-front-perimeter", "description": "Large continuous molded front fillet", "level": "macro", "confidence": 0.97, "evidence": ["full-object"]}, {"id": "top-shell-seam", "description": "Shallow upper perimeter seam", "level": "meso", "confidence": 0.88, "evidence": ["detail-inventory/zone-r0c2.png"]}], "surfaceDetail": {"macroRoughness": 0.05, "microRoughness": 0.08, "bumpAmplitude": 0.006, "normalPattern": "fine molded stipple", "displacementPattern": "none", "occlusionPattern": "seams and front insets", "edgeWearPattern": "none", "notes": "new-looking molded plastic"}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 1.0}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "frontSocket", "localPosition": [0, 0, 0.84], "localRotation": [0, 0, 0]}, {"id": "handleLeftSocket", "localPosition": [-2.08, 0.62, 0], "localRotation": [0, 0, 0]}, {"id": "handleRightSocket", "localPosition": [2.08, 0.62, 0], "localRotation": [0, 0, 0]}, {"id": "feetSocket", "localPosition": [0, -1.31, 0], "localRotation": [0, 0, 0]}, {"id": "topSeamSocket", "localPosition": [0, 1.12, 0.86], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [4.45, 2.82, 1.7], "isTrigger": false, "notes": "coarse body proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "enclosure", "seamRefs": ["top-shell-seam"], "detachableFragments": ["frontPanel", "handle"], "breakImpulse": 0, "debrisMaterial": "tealPlastic"}}, "evidenceRefs": ["full-object"]};
  node_enclosure_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 1.0}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "frontSocket", "localPosition": [0, 0, 0.84], "localRotation": [0, 0, 0]}, {"id": "handleLeftSocket", "localPosition": [-2.08, 0.62, 0], "localRotation": [0, 0, 0]}, {"id": "handleRightSocket", "localPosition": [2.08, 0.62, 0], "localRotation": [0, 0, 0]}, {"id": "feetSocket", "localPosition": [0, -1.31, 0], "localRotation": [0, 0, 0]}, {"id": "topSeamSocket", "localPosition": [0, 1.12, 0.86], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [4.45, 2.82, 1.7], "isTrigger": false, "notes": "coarse body proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "enclosure", "seamRefs": ["top-shell-seam"], "detachableFragments": ["frontPanel", "handle"], "breakImpulse": 0, "debrisMaterial": "tealPlastic"}};
  (nodes["root"] ?? root).add(node_enclosure_0);
  nodes["enclosure"] = node_enclosure_0;
  const mesh_enclosure_0Geometry = endpoint_enclosure_0
    ? new THREE.CylinderGeometry(endpoint_enclosure_0.endRadius, endpoint_enclosure_0.baseRadius, endpoint_enclosure_0.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_enclosure_0) {
    mesh_enclosure_0Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_enclosure_0 = new THREE.Mesh(
    mesh_enclosure_0Geometry,
    materialMap["tealPlastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_enclosure_0.name = "Rounded teal enclosure";
  if (endpoint_enclosure_0) {
    mesh_enclosure_0.position.copy(endpoint_enclosure_0.midpoint);
    mesh_enclosure_0.quaternion.copy(endpoint_enclosure_0.quaternion);
  }
  mesh_enclosure_0.castShadow = options.castShadow ?? true;
  mesh_enclosure_0.receiveShadow = options.receiveShadow ?? true;
  mesh_enclosure_0.userData.sculptComponent = {"id": "enclosure", "name": "Rounded teal enclosure", "level": "macro", "role": "root-body", "importance": 1.0, "confidence": 0.94, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Rigid molded chassis with countable faces and large fillets; a rounded box is structurally appropriate.", "geometryDescriptor": {"topologyIntent": "wide rounded cuboid with deep corner fillets", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.3, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "weighted vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 4.45, "height": 2.82, "depth": 1.7, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, -0.06, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(78, 145, 141, 1.0)", "secondaryAlbedo": "rgba(101, 162, 158, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.94, "evidence": ["full-object"], "samplingNotes": "Teal shell midtone excluding highlights."}, "material": "tealPlastic", "materialLayers": ["tealPlastic"], "localFeatures": [{"id": "rounded-front-perimeter", "description": "Large continuous molded front fillet", "level": "macro", "confidence": 0.97, "evidence": ["full-object"]}, {"id": "top-shell-seam", "description": "Shallow upper perimeter seam", "level": "meso", "confidence": 0.88, "evidence": ["detail-inventory/zone-r0c2.png"]}], "surfaceDetail": {"macroRoughness": 0.05, "microRoughness": 0.08, "bumpAmplitude": 0.006, "normalPattern": "fine molded stipple", "displacementPattern": "none", "occlusionPattern": "seams and front insets", "edgeWearPattern": "none", "notes": "new-looking molded plastic"}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 1.0}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "frontSocket", "localPosition": [0, 0, 0.84], "localRotation": [0, 0, 0]}, {"id": "handleLeftSocket", "localPosition": [-2.08, 0.62, 0], "localRotation": [0, 0, 0]}, {"id": "handleRightSocket", "localPosition": [2.08, 0.62, 0], "localRotation": [0, 0, 0]}, {"id": "feetSocket", "localPosition": [0, -1.31, 0], "localRotation": [0, 0, 0]}, {"id": "topSeamSocket", "localPosition": [0, 1.12, 0.86], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [4.45, 2.82, 1.7], "isTrigger": false, "notes": "coarse body proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "enclosure", "seamRefs": ["top-shell-seam"], "detachableFragments": ["frontPanel", "handle"], "breakImpulse": 0, "debrisMaterial": "tealPlastic"}}, "evidenceRefs": ["full-object"]};
  node_enclosure_0.add(mesh_enclosure_0);
  meshes["enclosure"] = mesh_enclosure_0;
  colliders["enclosure"] = {"type": "box", "offset": [0, 0, 0], "scale": [4.45, 2.82, 1.7], "isTrigger": false, "notes": "coarse body proxy"};
  destructionGroups["enclosure"] ??= [];
  destructionGroups["enclosure"].push(node_enclosure_0);
  const socket_enclosure_frontSocket_0 = new THREE.Object3D();
  socket_enclosure_frontSocket_0.name = "frontSocket";
  socket_enclosure_frontSocket_0.position.set(0.0, 0.0, 0.84);
  socket_enclosure_frontSocket_0.rotation.set(0.0, 0.0, 0.0);
  socket_enclosure_frontSocket_0.userData.socket = {"id": "frontSocket", "localPosition": [0, 0, 0.84], "localRotation": [0, 0, 0]};
  node_enclosure_0.add(socket_enclosure_frontSocket_0);
  sockets["enclosure:frontSocket"] = socket_enclosure_frontSocket_0;
  const socket_enclosure_handleLeftSocket_1 = new THREE.Object3D();
  socket_enclosure_handleLeftSocket_1.name = "handleLeftSocket";
  socket_enclosure_handleLeftSocket_1.position.set(-2.08, 0.62, 0.0);
  socket_enclosure_handleLeftSocket_1.rotation.set(0.0, 0.0, 0.0);
  socket_enclosure_handleLeftSocket_1.userData.socket = {"id": "handleLeftSocket", "localPosition": [-2.08, 0.62, 0], "localRotation": [0, 0, 0]};
  node_enclosure_0.add(socket_enclosure_handleLeftSocket_1);
  sockets["enclosure:handleLeftSocket"] = socket_enclosure_handleLeftSocket_1;
  const socket_enclosure_handleRightSocket_2 = new THREE.Object3D();
  socket_enclosure_handleRightSocket_2.name = "handleRightSocket";
  socket_enclosure_handleRightSocket_2.position.set(2.08, 0.62, 0.0);
  socket_enclosure_handleRightSocket_2.rotation.set(0.0, 0.0, 0.0);
  socket_enclosure_handleRightSocket_2.userData.socket = {"id": "handleRightSocket", "localPosition": [2.08, 0.62, 0], "localRotation": [0, 0, 0]};
  node_enclosure_0.add(socket_enclosure_handleRightSocket_2);
  sockets["enclosure:handleRightSocket"] = socket_enclosure_handleRightSocket_2;
  const socket_enclosure_feetSocket_3 = new THREE.Object3D();
  socket_enclosure_feetSocket_3.name = "feetSocket";
  socket_enclosure_feetSocket_3.position.set(0.0, -1.31, 0.0);
  socket_enclosure_feetSocket_3.rotation.set(0.0, 0.0, 0.0);
  socket_enclosure_feetSocket_3.userData.socket = {"id": "feetSocket", "localPosition": [0, -1.31, 0], "localRotation": [0, 0, 0]};
  node_enclosure_0.add(socket_enclosure_feetSocket_3);
  sockets["enclosure:feetSocket"] = socket_enclosure_feetSocket_3;
  const socket_enclosure_topSeamSocket_4 = new THREE.Object3D();
  socket_enclosure_topSeamSocket_4.name = "topSeamSocket";
  socket_enclosure_topSeamSocket_4.position.set(0.0, 1.12, 0.86);
  socket_enclosure_topSeamSocket_4.rotation.set(0.0, 0.0, 0.0);
  socket_enclosure_topSeamSocket_4.userData.socket = {"id": "topSeamSocket", "localPosition": [0, 1.12, 0.86], "localRotation": [0, 0, 0]};
  node_enclosure_0.add(socket_enclosure_topSeamSocket_4);
  sockets["enclosure:topSeamSocket"] = socket_enclosure_topSeamSocket_4;

  const attachment_handle_1 = {"parentId": "enclosure", "parentSocket": "handleLeftSocket+handleRightSocket", "localStart": [-1.93, 0.63, 0], "localEnd": [1.93, 0.63, 0], "contactType": "dual-pivot", "embedDepth": 0.08, "overlap": 0.08, "gapTolerance": 0.03, "evidenceRefs": ["full-object"]};
  const endpoint_handle_1 = makeAttachmentEndpoint(attachment_handle_1);
  const node_handle_1 = new THREE.Group();
  node_handle_1.name = "Cream carry handle__pivot";
  node_handle_1.scale.set(1, 1, 1);
  if (endpoint_handle_1) {
    node_handle_1.position.copy(endpoint_handle_1.start);
    node_handle_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_handle_1.position.set(0.0, 1.6, -0.05);
    node_handle_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_handle_1.userData.sculptComponent = {"id": "handle", "name": "Cream carry handle", "level": "macro", "role": "carry-handle", "importance": 0.92, "confidence": 0.91, "primitive": "curve-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "One continuous U-shaped volume follows a measured arch and cannot be represented by a straight box.", "geometryDescriptor": {"topologyIntent": "flattened arch with vertical lower legs", "curveSweep": {"spine": [[-0.5, -0.48, 0], [-0.47, 0.1, 0], [-0.34, 0.38, 0], [0, 0.5, 0], [0.34, 0.38, 0], [0.47, 0.1, 0], [0.5, -0.48, 0]], "crossSection": {"points": [[-0.06, -0.04], [0.06, -0.04], [0.06, 0.04], [-0.06, 0.04]]}, "closed": false}, "edgeTreatment": {"type": "rounded", "bevelRadius": 0.05, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "enclosure", "attachment": {"parentId": "enclosure", "parentSocket": "handleLeftSocket+handleRightSocket", "localStart": [-1.93, 0.63, 0], "localEnd": [1.93, 0.63, 0], "contactType": "dual-pivot", "embedDepth": 0.08, "overlap": 0.08, "gapTolerance": 0.03, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 4.36, "height": 1.25, "depth": 0.26, "units": "relative", "confidence": 0.85}, "transform": {"position": [0, 1.6, -0.05], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(231, 225, 209, 1.0)", "secondaryAlbedo": "rgba(242, 236, 221, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.92, "evidence": ["detail-inventory/zone-r0c1.png"], "samplingNotes": "Warm ivory handle midtone."}, "material": "ivoryPlastic", "materialLayers": ["ivoryPlastic"], "localFeatures": [{"id": "arch-bevel", "description": "Soft rounded rectangular handle section", "level": "meso", "confidence": 0.94, "evidence": ["detail-inventory/zone-r0c1.png"]}], "actionProfile": {"animationRole": "hinge", "pivot": {"mode": "explicit", "localPosition": [0, -0.48, 0], "axis": [1, 0, 0], "confidence": 0.72}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0.45, 0], "scale": [4.25, 1.5, 0.34], "isTrigger": false, "notes": "coarse arch proxy"}, "constraints": [{"type": "hinge-limit", "min": 0, "max": 1.35}], "destruction": {"breakable": false, "fractureGroup": "handle", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "ivoryPlastic"}}, "evidenceRefs": ["full-object"]};
  node_handle_1.userData.actionProfile = {"animationRole": "hinge", "pivot": {"mode": "explicit", "localPosition": [0, -0.48, 0], "axis": [1, 0, 0], "confidence": 0.72}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0.45, 0], "scale": [4.25, 1.5, 0.34], "isTrigger": false, "notes": "coarse arch proxy"}, "constraints": [{"type": "hinge-limit", "min": 0, "max": 1.35}], "destruction": {"breakable": false, "fractureGroup": "handle", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "ivoryPlastic"}};
  (nodes["enclosure"] ?? root).add(node_handle_1);
  nodes["handle"] = node_handle_1;
  const mesh_handle_1Geometry = endpoint_handle_1
    ? new THREE.CylinderGeometry(endpoint_handle_1.endRadius, endpoint_handle_1.baseRadius, endpoint_handle_1.length, 16, 6)
    : buildCurveSweepGeometry({"spine": [[-0.5, -0.48, 0], [-0.47, 0.1, 0], [-0.34, 0.38, 0], [0, 0.5, 0], [0.34, 0.38, 0], [0.47, 0.1, 0], [0.5, -0.48, 0]], "crossSection": {"points": [[-0.06, -0.04], [0.06, -0.04], [0.06, 0.04], [-0.06, 0.04]]}, "closed": false});
  if (!endpoint_handle_1) {
    mesh_handle_1Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_handle_1 = new THREE.Mesh(
    mesh_handle_1Geometry,
    materialMap["ivoryPlastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_handle_1.name = "Cream carry handle";
  if (endpoint_handle_1) {
    mesh_handle_1.position.copy(endpoint_handle_1.midpoint);
    mesh_handle_1.quaternion.copy(endpoint_handle_1.quaternion);
  }
  mesh_handle_1.castShadow = options.castShadow ?? true;
  mesh_handle_1.receiveShadow = options.receiveShadow ?? true;
  mesh_handle_1.userData.sculptComponent = {"id": "handle", "name": "Cream carry handle", "level": "macro", "role": "carry-handle", "importance": 0.92, "confidence": 0.91, "primitive": "curve-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "One continuous U-shaped volume follows a measured arch and cannot be represented by a straight box.", "geometryDescriptor": {"topologyIntent": "flattened arch with vertical lower legs", "curveSweep": {"spine": [[-0.5, -0.48, 0], [-0.47, 0.1, 0], [-0.34, 0.38, 0], [0, 0.5, 0], [0.34, 0.38, 0], [0.47, 0.1, 0], [0.5, -0.48, 0]], "crossSection": {"points": [[-0.06, -0.04], [0.06, -0.04], [0.06, 0.04], [-0.06, 0.04]]}, "closed": false}, "edgeTreatment": {"type": "rounded", "bevelRadius": 0.05, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "enclosure", "attachment": {"parentId": "enclosure", "parentSocket": "handleLeftSocket+handleRightSocket", "localStart": [-1.93, 0.63, 0], "localEnd": [1.93, 0.63, 0], "contactType": "dual-pivot", "embedDepth": 0.08, "overlap": 0.08, "gapTolerance": 0.03, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 4.36, "height": 1.25, "depth": 0.26, "units": "relative", "confidence": 0.85}, "transform": {"position": [0, 1.6, -0.05], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(231, 225, 209, 1.0)", "secondaryAlbedo": "rgba(242, 236, 221, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.92, "evidence": ["detail-inventory/zone-r0c1.png"], "samplingNotes": "Warm ivory handle midtone."}, "material": "ivoryPlastic", "materialLayers": ["ivoryPlastic"], "localFeatures": [{"id": "arch-bevel", "description": "Soft rounded rectangular handle section", "level": "meso", "confidence": 0.94, "evidence": ["detail-inventory/zone-r0c1.png"]}], "actionProfile": {"animationRole": "hinge", "pivot": {"mode": "explicit", "localPosition": [0, -0.48, 0], "axis": [1, 0, 0], "confidence": 0.72}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0.45, 0], "scale": [4.25, 1.5, 0.34], "isTrigger": false, "notes": "coarse arch proxy"}, "constraints": [{"type": "hinge-limit", "min": 0, "max": 1.35}], "destruction": {"breakable": false, "fractureGroup": "handle", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "ivoryPlastic"}}, "evidenceRefs": ["full-object"]};
  node_handle_1.add(mesh_handle_1);
  meshes["handle"] = mesh_handle_1;
  colliders["handle"] = {"type": "box", "offset": [0, 0.45, 0], "scale": [4.25, 1.5, 0.34], "isTrigger": false, "notes": "coarse arch proxy"};
  destructionGroups["handle"] ??= [];
  destructionGroups["handle"].push(node_handle_1);

  const endpoint_frontPanel_2 = makeAttachmentEndpoint(null);
  const node_frontPanel_2 = new THREE.Group();
  node_frontPanel_2.name = "Front component carrier__pivot";
  node_frontPanel_2.scale.set(1, 1, 1);
  if (endpoint_frontPanel_2) {
    node_frontPanel_2.position.copy(endpoint_frontPanel_2.start);
    node_frontPanel_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_frontPanel_2.position.set(0.0, -0.03, 0.84);
    node_frontPanel_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_frontPanel_2.userData.sculptComponent = {"id": "frontPanel", "name": "Front component carrier", "level": "macro", "role": "front-panel", "importance": 0.88, "confidence": 0.9, "primitive": "box", "topologyClass": "conforming-shell", "topologyRationale": "Thin rigid front layer follows the enclosure face and carries the visible controls.", "geometryDescriptor": {"topologyIntent": "thin inset carrier following rounded front face", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.12, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals"}, "parent": "enclosure", "attachment": {"parentId": "enclosure", "parentSocket": "frontSocket", "localStart": [0, 0, 0.82], "localEnd": [0, 0, 0.9], "contactType": "flush-overlap", "embedDepth": 0.04, "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 4.28, "height": 2.38, "depth": 0.08, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, -0.03, 0.84], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(78, 145, 141, 1.0)", "secondaryAlbedo": "rgba(101, 162, 158, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidence": ["full-object"], "samplingNotes": "Same teal plastic as enclosure."}, "material": "tealPlastic", "materialLayers": ["tealPlastic"], "localFeatures": [], "evidenceRefs": ["full-object"]};
  node_frontPanel_2.userData.actionProfile = {};
  (nodes["enclosure"] ?? root).add(node_frontPanel_2);
  nodes["frontPanel"] = node_frontPanel_2;
  const mesh_frontPanel_2Geometry = endpoint_frontPanel_2
    ? new THREE.CylinderGeometry(endpoint_frontPanel_2.endRadius, endpoint_frontPanel_2.baseRadius, endpoint_frontPanel_2.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_frontPanel_2) {
    mesh_frontPanel_2Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_frontPanel_2 = new THREE.Mesh(
    mesh_frontPanel_2Geometry,
    materialMap["tealPlastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_frontPanel_2.name = "Front component carrier";
  if (endpoint_frontPanel_2) {
    mesh_frontPanel_2.position.copy(endpoint_frontPanel_2.midpoint);
    mesh_frontPanel_2.quaternion.copy(endpoint_frontPanel_2.quaternion);
  }
  mesh_frontPanel_2.castShadow = options.castShadow ?? true;
  mesh_frontPanel_2.receiveShadow = options.receiveShadow ?? true;
  mesh_frontPanel_2.userData.sculptComponent = {"id": "frontPanel", "name": "Front component carrier", "level": "macro", "role": "front-panel", "importance": 0.88, "confidence": 0.9, "primitive": "box", "topologyClass": "conforming-shell", "topologyRationale": "Thin rigid front layer follows the enclosure face and carries the visible controls.", "geometryDescriptor": {"topologyIntent": "thin inset carrier following rounded front face", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.12, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals"}, "parent": "enclosure", "attachment": {"parentId": "enclosure", "parentSocket": "frontSocket", "localStart": [0, 0, 0.82], "localEnd": [0, 0, 0.9], "contactType": "flush-overlap", "embedDepth": 0.04, "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 4.28, "height": 2.38, "depth": 0.08, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, -0.03, 0.84], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(78, 145, 141, 1.0)", "secondaryAlbedo": "rgba(101, 162, 158, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidence": ["full-object"], "samplingNotes": "Same teal plastic as enclosure."}, "material": "tealPlastic", "materialLayers": ["tealPlastic"], "localFeatures": [], "evidenceRefs": ["full-object"]};
  node_frontPanel_2.add(mesh_frontPanel_2);
  meshes["frontPanel"] = mesh_frontPanel_2;
  colliders["frontPanel"] = {};

  const attachment_feet_3 = {"parentId": "enclosure", "parentSocket": "feetSocket", "localStart": [-1.75, -1.24, 0.52], "localEnd": [-1.75, -1.54, 0.52], "contactType": "socket-overlap", "embedDepth": 0.08, "overlap": 0.08, "gapTolerance": 0.02, "evidenceRefs": ["detail-inventory/zone-r2c2.png"]};
  const endpoint_feet_3 = makeAttachmentEndpoint(attachment_feet_3);
  const node_feet_3 = new THREE.Group();
  node_feet_3.name = "Four cream support feet__pivot";
  node_feet_3.scale.set(1, 1, 1);
  if (endpoint_feet_3) {
    node_feet_3.position.copy(endpoint_feet_3.start);
    node_feet_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_feet_3.position.set(-1.72, -1.42, 0.48);
    node_feet_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_feet_3.userData.sculptComponent = {"id": "feet", "name": "Four cream support feet", "level": "macro", "role": "support-feet", "importance": 0.72, "confidence": 0.82, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Discrete short molded supports approximated by tapered rounded solids and repeated at four corners.", "geometryDescriptor": {"topologyIntent": "short tapered rounded support template", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.08, "segments": 3}, "deformationStack": [{"type": "taper", "axis": "y", "factor": 0.82, "notes": "narrower at ground contact"}], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "enclosure", "attachment": {"parentId": "enclosure", "parentSocket": "feetSocket", "localStart": [-1.75, -1.24, 0.52], "localEnd": [-1.75, -1.54, 0.52], "contactType": "socket-overlap", "embedDepth": 0.08, "overlap": 0.08, "gapTolerance": 0.02, "evidenceRefs": ["detail-inventory/zone-r2c2.png"]}, "dimensions": {"width": 0.38, "height": 0.48, "depth": 0.42, "units": "relative", "confidence": 0.8}, "transform": {"position": [-1.72, -1.42, 0.48], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(231, 225, 209, 1.0)", "secondaryAlbedo": "rgba(210, 204, 188, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "evidence": ["detail-inventory/zone-r2c2.png"], "samplingNotes": "Warm ivory foot midtone."}, "material": "ivoryPlastic", "materialLayers": ["ivoryPlastic"], "localFeatures": [{"id": "rounded-taper", "description": "Rounded foot narrows toward the floor", "level": "meso", "confidence": 0.84, "evidence": ["detail-inventory/zone-r2c2.png"]}], "evidenceRefs": ["full-object"]};
  node_feet_3.userData.actionProfile = {};
  (nodes["enclosure"] ?? root).add(node_feet_3);
  nodes["feet"] = node_feet_3;
  const mesh_feet_3Geometry = endpoint_feet_3
    ? new THREE.CylinderGeometry(endpoint_feet_3.endRadius, endpoint_feet_3.baseRadius, endpoint_feet_3.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_feet_3) {
    mesh_feet_3Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_feet_3 = new THREE.Mesh(
    mesh_feet_3Geometry,
    materialMap["ivoryPlastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_feet_3.name = "Four cream support feet";
  if (endpoint_feet_3) {
    mesh_feet_3.position.copy(endpoint_feet_3.midpoint);
    mesh_feet_3.quaternion.copy(endpoint_feet_3.quaternion);
  }
  mesh_feet_3.castShadow = options.castShadow ?? true;
  mesh_feet_3.receiveShadow = options.receiveShadow ?? true;
  mesh_feet_3.userData.sculptComponent = {"id": "feet", "name": "Four cream support feet", "level": "macro", "role": "support-feet", "importance": 0.72, "confidence": 0.82, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Discrete short molded supports approximated by tapered rounded solids and repeated at four corners.", "geometryDescriptor": {"topologyIntent": "short tapered rounded support template", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.08, "segments": 3}, "deformationStack": [{"type": "taper", "axis": "y", "factor": 0.82, "notes": "narrower at ground contact"}], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "enclosure", "attachment": {"parentId": "enclosure", "parentSocket": "feetSocket", "localStart": [-1.75, -1.24, 0.52], "localEnd": [-1.75, -1.54, 0.52], "contactType": "socket-overlap", "embedDepth": 0.08, "overlap": 0.08, "gapTolerance": 0.02, "evidenceRefs": ["detail-inventory/zone-r2c2.png"]}, "dimensions": {"width": 0.38, "height": 0.48, "depth": 0.42, "units": "relative", "confidence": 0.8}, "transform": {"position": [-1.72, -1.42, 0.48], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(231, 225, 209, 1.0)", "secondaryAlbedo": "rgba(210, 204, 188, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "evidence": ["detail-inventory/zone-r2c2.png"], "samplingNotes": "Warm ivory foot midtone."}, "material": "ivoryPlastic", "materialLayers": ["ivoryPlastic"], "localFeatures": [{"id": "rounded-taper", "description": "Rounded foot narrows toward the floor", "level": "meso", "confidence": 0.84, "evidence": ["detail-inventory/zone-r2c2.png"]}], "evidenceRefs": ["full-object"]};
  node_feet_3.add(mesh_feet_3);
  meshes["feet"] = mesh_feet_3;
  colliders["feet"] = {};

  const attachment_handlePivots_4 = {"parentId": "enclosure", "parentSocket": "handleRightSocket", "localStart": [1.98, 0.62, 0], "localEnd": [2.22, 0.62, 0], "contactType": "pivot-overlap", "embedDepth": 0.08, "overlap": 0.08, "gapTolerance": 0.02, "evidenceRefs": ["detail-inventory/zone-r1c2.png"]};
  const endpoint_handlePivots_4 = makeAttachmentEndpoint(attachment_handlePivots_4);
  const node_handlePivots_4 = new THREE.Group();
  node_handlePivots_4.name = "Handle pivot housings__pivot";
  node_handlePivots_4.scale.set(1, 1, 1);
  if (endpoint_handlePivots_4) {
    node_handlePivots_4.position.copy(endpoint_handlePivots_4.start);
    node_handlePivots_4.rotation.set(0.0, 0.0, 1.5708);
  } else {
    node_handlePivots_4.position.set(2.08, 0.62, 0.0);
    node_handlePivots_4.rotation.set(0.0, 0.0, 1.5708);
  }
  node_handlePivots_4.userData.sculptComponent = {"id": "handlePivots", "name": "Handle pivot housings", "level": "meso", "role": "pivot-housings", "importance": 0.68, "confidence": 0.83, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete circular side caps mechanically connect the handle to the enclosure.", "geometryDescriptor": {"topologyIntent": "short cylindrical side caps", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.04, "segments": 2}, "deformationStack": [], "uvStrategy": "cylindrical projection", "normalStrategy": "smooth vertex normals"}, "parent": "enclosure", "attachment": {"parentId": "enclosure", "parentSocket": "handleRightSocket", "localStart": [1.98, 0.62, 0], "localEnd": [2.22, 0.62, 0], "contactType": "pivot-overlap", "embedDepth": 0.08, "overlap": 0.08, "gapTolerance": 0.02, "evidenceRefs": ["detail-inventory/zone-r1c2.png"]}, "dimensions": {"width": 0.5, "height": 0.22, "depth": 0.5, "units": "relative", "confidence": 0.82}, "transform": {"position": [2.08, 0.62, 0], "rotation": [0, 0, 1.5708], "scale": [1, 1, 1]}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(231, 225, 209, 1.0)", "secondaryAlbedo": "rgba(242, 236, 221, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidence": ["detail-inventory/zone-r1c2.png"], "samplingNotes": "Ivory pivot plastic."}, "material": "ivoryPlastic", "materialLayers": ["ivoryPlastic"], "localFeatures": [{"id": "round-caps", "description": "Mirrored outer cap disks", "level": "meso", "confidence": 0.86, "evidence": ["detail-inventory/zone-r1c2.png"]}], "evidenceRefs": ["full-object"]};
  node_handlePivots_4.userData.actionProfile = {};
  (nodes["enclosure"] ?? root).add(node_handlePivots_4);
  nodes["handlePivots"] = node_handlePivots_4;
  const mesh_handlePivots_4Geometry = endpoint_handlePivots_4
    ? new THREE.CylinderGeometry(endpoint_handlePivots_4.endRadius, endpoint_handlePivots_4.baseRadius, endpoint_handlePivots_4.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_handlePivots_4) {
    mesh_handlePivots_4Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_handlePivots_4 = new THREE.Mesh(
    mesh_handlePivots_4Geometry,
    materialMap["ivoryPlastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_handlePivots_4.name = "Handle pivot housings";
  if (endpoint_handlePivots_4) {
    mesh_handlePivots_4.position.copy(endpoint_handlePivots_4.midpoint);
    mesh_handlePivots_4.quaternion.copy(endpoint_handlePivots_4.quaternion);
  }
  mesh_handlePivots_4.castShadow = options.castShadow ?? true;
  mesh_handlePivots_4.receiveShadow = options.receiveShadow ?? true;
  mesh_handlePivots_4.userData.sculptComponent = {"id": "handlePivots", "name": "Handle pivot housings", "level": "meso", "role": "pivot-housings", "importance": 0.68, "confidence": 0.83, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete circular side caps mechanically connect the handle to the enclosure.", "geometryDescriptor": {"topologyIntent": "short cylindrical side caps", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.04, "segments": 2}, "deformationStack": [], "uvStrategy": "cylindrical projection", "normalStrategy": "smooth vertex normals"}, "parent": "enclosure", "attachment": {"parentId": "enclosure", "parentSocket": "handleRightSocket", "localStart": [1.98, 0.62, 0], "localEnd": [2.22, 0.62, 0], "contactType": "pivot-overlap", "embedDepth": 0.08, "overlap": 0.08, "gapTolerance": 0.02, "evidenceRefs": ["detail-inventory/zone-r1c2.png"]}, "dimensions": {"width": 0.5, "height": 0.22, "depth": 0.5, "units": "relative", "confidence": 0.82}, "transform": {"position": [2.08, 0.62, 0], "rotation": [0, 0, 1.5708], "scale": [1, 1, 1]}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(231, 225, 209, 1.0)", "secondaryAlbedo": "rgba(242, 236, 221, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidence": ["detail-inventory/zone-r1c2.png"], "samplingNotes": "Ivory pivot plastic."}, "material": "ivoryPlastic", "materialLayers": ["ivoryPlastic"], "localFeatures": [{"id": "round-caps", "description": "Mirrored outer cap disks", "level": "meso", "confidence": 0.86, "evidence": ["detail-inventory/zone-r1c2.png"]}], "evidenceRefs": ["full-object"]};
  node_handlePivots_4.add(mesh_handlePivots_4);
  meshes["handlePivots"] = mesh_handlePivots_4;
  colliders["handlePivots"] = {};

  const endpoint_speakerAssembly_5 = makeAttachmentEndpoint(null);
  const node_speakerAssembly_5 = new THREE.Group();
  node_speakerAssembly_5.name = "Speaker outer bezel__pivot";
  node_speakerAssembly_5.scale.set(1, 1, 1);
  if (endpoint_speakerAssembly_5) {
    node_speakerAssembly_5.position.copy(endpoint_speakerAssembly_5.start);
    node_speakerAssembly_5.rotation.set(1.5708, 0.0, 0.0);
  } else {
    node_speakerAssembly_5.position.set(-1.15, -0.02, 1.0);
    node_speakerAssembly_5.rotation.set(1.5708, 0.0, 0.0);
  }
  node_speakerAssembly_5.userData.sculptComponent = {"id": "speakerAssembly", "name": "Speaker outer bezel", "level": "meso", "role": "speaker-bezel", "importance": 0.98, "confidence": 0.97, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Discrete circular bezel ring mounted on the front face.", "geometryDescriptor": {"topologyIntent": "broad annular bezel", "torusTubeRatio": 0.13, "edgeTreatment": {"type": "rounded", "bevelRadius": 0.05, "segments": 3}, "deformationStack": [], "uvStrategy": "cylindrical projection", "normalStrategy": "smooth vertex normals"}, "parent": "frontPanel", "attachment": {"parentId": "frontPanel", "parentSocket": "speakerSocket", "localStart": [-1.12, 0.02, 0], "localEnd": [-1.12, 0.02, 0.13], "contactType": "recessed-overlap", "embedDepth": 0.04, "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["detail-inventory/zone-r1c0.png"]}, "dimensions": {"width": 2.05, "height": 2.05, "depth": 0.16, "units": "relative", "confidence": 0.96}, "transform": {"position": [-1.15, -0.02, 1.0], "rotation": [1.5708, 0, 0], "scale": [1, 1, 0.75]}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 53, 54, 1.0)", "secondaryAlbedo": "rgba(74, 75, 76, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidence": ["detail-inventory/zone-r1c0.png"], "samplingNotes": "Charcoal bezel midtone."}, "material": "charcoalPlastic", "materialLayers": ["charcoalPlastic"], "localFeatures": [{"id": "double-rim", "description": "Broad outer ring with a thinner inner lip", "level": "meso", "confidence": 0.96, "evidence": ["detail-inventory/zone-r1c0.png"]}], "evidenceRefs": ["full-object"]};
  node_speakerAssembly_5.userData.actionProfile = {};
  (nodes["frontPanel"] ?? root).add(node_speakerAssembly_5);
  nodes["speakerAssembly"] = node_speakerAssembly_5;
  const mesh_speakerAssembly_5Geometry = endpoint_speakerAssembly_5
    ? new THREE.CylinderGeometry(endpoint_speakerAssembly_5.endRadius, endpoint_speakerAssembly_5.baseRadius, endpoint_speakerAssembly_5.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.0585, 12, 48);
  if (!endpoint_speakerAssembly_5) {
    mesh_speakerAssembly_5Geometry.scale(1.0, 1.0, 0.75);
  }
  const mesh_speakerAssembly_5 = new THREE.Mesh(
    mesh_speakerAssembly_5Geometry,
    materialMap["charcoalPlastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_speakerAssembly_5.name = "Speaker outer bezel";
  if (endpoint_speakerAssembly_5) {
    mesh_speakerAssembly_5.position.copy(endpoint_speakerAssembly_5.midpoint);
    mesh_speakerAssembly_5.quaternion.copy(endpoint_speakerAssembly_5.quaternion);
  }
  mesh_speakerAssembly_5.castShadow = options.castShadow ?? true;
  mesh_speakerAssembly_5.receiveShadow = options.receiveShadow ?? true;
  mesh_speakerAssembly_5.userData.sculptComponent = {"id": "speakerAssembly", "name": "Speaker outer bezel", "level": "meso", "role": "speaker-bezel", "importance": 0.98, "confidence": 0.97, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Discrete circular bezel ring mounted on the front face.", "geometryDescriptor": {"topologyIntent": "broad annular bezel", "torusTubeRatio": 0.13, "edgeTreatment": {"type": "rounded", "bevelRadius": 0.05, "segments": 3}, "deformationStack": [], "uvStrategy": "cylindrical projection", "normalStrategy": "smooth vertex normals"}, "parent": "frontPanel", "attachment": {"parentId": "frontPanel", "parentSocket": "speakerSocket", "localStart": [-1.12, 0.02, 0], "localEnd": [-1.12, 0.02, 0.13], "contactType": "recessed-overlap", "embedDepth": 0.04, "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["detail-inventory/zone-r1c0.png"]}, "dimensions": {"width": 2.05, "height": 2.05, "depth": 0.16, "units": "relative", "confidence": 0.96}, "transform": {"position": [-1.15, -0.02, 1.0], "rotation": [1.5708, 0, 0], "scale": [1, 1, 0.75]}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 53, 54, 1.0)", "secondaryAlbedo": "rgba(74, 75, 76, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidence": ["detail-inventory/zone-r1c0.png"], "samplingNotes": "Charcoal bezel midtone."}, "material": "charcoalPlastic", "materialLayers": ["charcoalPlastic"], "localFeatures": [{"id": "double-rim", "description": "Broad outer ring with a thinner inner lip", "level": "meso", "confidence": 0.96, "evidence": ["detail-inventory/zone-r1c0.png"]}], "evidenceRefs": ["full-object"]};
  node_speakerAssembly_5.add(mesh_speakerAssembly_5);
  meshes["speakerAssembly"] = mesh_speakerAssembly_5;
  colliders["speakerAssembly"] = {};

  const attachment_speakerGrille_6 = {"parentId": "speakerAssembly", "parentSocket": "grilleInset", "localStart": [0, 0, 0], "localEnd": [0, 0, 0.08], "contactType": "inset", "embedDepth": 0.03, "overlap": 0.03, "gapTolerance": 0.008, "evidenceRefs": ["detail-inventory/zone-r1c0.png"]};
  const endpoint_speakerGrille_6 = makeAttachmentEndpoint(attachment_speakerGrille_6);
  const node_speakerGrille_6 = new THREE.Group();
  node_speakerGrille_6.name = "Perforated speaker plate__pivot";
  node_speakerGrille_6.scale.set(1, 1, 1);
  if (endpoint_speakerGrille_6) {
    node_speakerGrille_6.position.copy(endpoint_speakerGrille_6.start);
    node_speakerGrille_6.rotation.set(1.5708, 0.0, 0.0);
  } else {
    node_speakerGrille_6.position.set(-1.15, -0.02, 1.05);
    node_speakerGrille_6.rotation.set(1.5708, 0.0, 0.0);
  }
  node_speakerGrille_6.userData.sculptComponent = {"id": "speakerGrille", "name": "Perforated speaker plate", "level": "meso", "role": "speaker-grille", "importance": 0.96, "confidence": 0.97, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Thin rigid circular plate inset behind the bezel.", "geometryDescriptor": {"topologyIntent": "shallow circular plate carrying clipped perforations", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "cylindrical projection", "normalStrategy": "smooth vertex normals"}, "parent": "speakerAssembly", "attachment": {"parentId": "speakerAssembly", "parentSocket": "grilleInset", "localStart": [0, 0, 0], "localEnd": [0, 0, 0.08], "contactType": "inset", "embedDepth": 0.03, "overlap": 0.03, "gapTolerance": 0.008, "evidenceRefs": ["detail-inventory/zone-r1c0.png"]}, "dimensions": {"width": 1.78, "height": 0.08, "depth": 1.78, "units": "relative", "confidence": 0.95}, "transform": {"position": [-1.15, -0.02, 1.05], "rotation": [1.5708, 0, 0], "scale": [1, 1, 1]}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 53, 54, 1.0)", "secondaryAlbedo": "rgba(36, 37, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidence": ["detail-inventory/zone-r1c0.png"], "samplingNotes": "Charcoal grille plate."}, "material": "charcoalPlastic", "materialLayers": ["charcoalPlastic"], "localFeatures": [{"id": "perforation-grid", "description": "Staggered hole field clipped to circular boundary", "level": "micro", "confidence": 0.97, "evidence": ["detail-inventory/zone-r1c0.png"]}], "evidenceRefs": ["full-object"]};
  node_speakerGrille_6.userData.actionProfile = {};
  (nodes["speakerAssembly"] ?? root).add(node_speakerGrille_6);
  nodes["speakerGrille"] = node_speakerGrille_6;
  const mesh_speakerGrille_6Geometry = endpoint_speakerGrille_6
    ? new THREE.CylinderGeometry(endpoint_speakerGrille_6.endRadius, endpoint_speakerGrille_6.baseRadius, endpoint_speakerGrille_6.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_speakerGrille_6) {
    mesh_speakerGrille_6Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_speakerGrille_6 = new THREE.Mesh(
    mesh_speakerGrille_6Geometry,
    materialMap["charcoalPlastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_speakerGrille_6.name = "Perforated speaker plate";
  if (endpoint_speakerGrille_6) {
    mesh_speakerGrille_6.position.copy(endpoint_speakerGrille_6.midpoint);
    mesh_speakerGrille_6.quaternion.copy(endpoint_speakerGrille_6.quaternion);
  }
  mesh_speakerGrille_6.castShadow = options.castShadow ?? true;
  mesh_speakerGrille_6.receiveShadow = options.receiveShadow ?? true;
  mesh_speakerGrille_6.userData.sculptComponent = {"id": "speakerGrille", "name": "Perforated speaker plate", "level": "meso", "role": "speaker-grille", "importance": 0.96, "confidence": 0.97, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Thin rigid circular plate inset behind the bezel.", "geometryDescriptor": {"topologyIntent": "shallow circular plate carrying clipped perforations", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "cylindrical projection", "normalStrategy": "smooth vertex normals"}, "parent": "speakerAssembly", "attachment": {"parentId": "speakerAssembly", "parentSocket": "grilleInset", "localStart": [0, 0, 0], "localEnd": [0, 0, 0.08], "contactType": "inset", "embedDepth": 0.03, "overlap": 0.03, "gapTolerance": 0.008, "evidenceRefs": ["detail-inventory/zone-r1c0.png"]}, "dimensions": {"width": 1.78, "height": 0.08, "depth": 1.78, "units": "relative", "confidence": 0.95}, "transform": {"position": [-1.15, -0.02, 1.05], "rotation": [1.5708, 0, 0], "scale": [1, 1, 1]}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 53, 54, 1.0)", "secondaryAlbedo": "rgba(36, 37, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidence": ["detail-inventory/zone-r1c0.png"], "samplingNotes": "Charcoal grille plate."}, "material": "charcoalPlastic", "materialLayers": ["charcoalPlastic"], "localFeatures": [{"id": "perforation-grid", "description": "Staggered hole field clipped to circular boundary", "level": "micro", "confidence": 0.97, "evidence": ["detail-inventory/zone-r1c0.png"]}], "evidenceRefs": ["full-object"]};
  node_speakerGrille_6.add(mesh_speakerGrille_6);
  meshes["speakerGrille"] = mesh_speakerGrille_6;
  colliders["speakerGrille"] = {};

  const endpoint_dialAssembly_7 = makeAttachmentEndpoint(null);
  const node_dialAssembly_7 = new THREE.Group();
  node_dialAssembly_7.name = "Ivory tuning window frame__pivot";
  node_dialAssembly_7.scale.set(1, 1, 1);
  if (endpoint_dialAssembly_7) {
    node_dialAssembly_7.position.copy(endpoint_dialAssembly_7.start);
    node_dialAssembly_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_dialAssembly_7.position.set(0.95, 0.42, 1.01);
    node_dialAssembly_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_dialAssembly_7.userData.sculptComponent = {"id": "dialAssembly", "name": "Ivory tuning window frame", "level": "meso", "role": "tuning-window", "importance": 0.9, "confidence": 0.95, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Rigid rounded rectangular trim mounted as a shallow front assembly.", "geometryDescriptor": {"topologyIntent": "rounded rectangular raised frame with inset face", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.12, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "weighted vertex normals"}, "parent": "frontPanel", "attachment": {"parentId": "frontPanel", "parentSocket": "dialSocket", "localStart": [0.55, 0.28, 0], "localEnd": [1.76, 0.28, 0.12], "contactType": "recessed-overlap", "embedDepth": 0.03, "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["detail-inventory/zone-r1c1.png"]}, "dimensions": {"width": 1.62, "height": 0.72, "depth": 0.12, "units": "relative", "confidence": 0.94}, "transform": {"position": [0.95, 0.42, 1.01], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(231, 225, 209, 1.0)", "secondaryAlbedo": "rgba(216, 210, 194, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.92, "evidence": ["detail-inventory/zone-r1c1.png"], "samplingNotes": "Ivory frame with paler inset."}, "material": "ivoryPlastic", "materialLayers": ["ivoryPlastic", "dialFaceMaterial"], "localFeatures": [{"id": "inset-rounded-frame", "description": "Raised outer frame and recessed face reveal", "level": "meso", "confidence": 0.96, "evidence": ["detail-inventory/zone-r1c1.png"]}], "evidenceRefs": ["full-object"]};
  node_dialAssembly_7.userData.actionProfile = {};
  (nodes["frontPanel"] ?? root).add(node_dialAssembly_7);
  nodes["dialAssembly"] = node_dialAssembly_7;
  const mesh_dialAssembly_7Geometry = endpoint_dialAssembly_7
    ? new THREE.CylinderGeometry(endpoint_dialAssembly_7.endRadius, endpoint_dialAssembly_7.baseRadius, endpoint_dialAssembly_7.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_dialAssembly_7) {
    mesh_dialAssembly_7Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_dialAssembly_7 = new THREE.Mesh(
    mesh_dialAssembly_7Geometry,
    materialMap["ivoryPlastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_dialAssembly_7.name = "Ivory tuning window frame";
  if (endpoint_dialAssembly_7) {
    mesh_dialAssembly_7.position.copy(endpoint_dialAssembly_7.midpoint);
    mesh_dialAssembly_7.quaternion.copy(endpoint_dialAssembly_7.quaternion);
  }
  mesh_dialAssembly_7.castShadow = options.castShadow ?? true;
  mesh_dialAssembly_7.receiveShadow = options.receiveShadow ?? true;
  mesh_dialAssembly_7.userData.sculptComponent = {"id": "dialAssembly", "name": "Ivory tuning window frame", "level": "meso", "role": "tuning-window", "importance": 0.9, "confidence": 0.95, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Rigid rounded rectangular trim mounted as a shallow front assembly.", "geometryDescriptor": {"topologyIntent": "rounded rectangular raised frame with inset face", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.12, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "weighted vertex normals"}, "parent": "frontPanel", "attachment": {"parentId": "frontPanel", "parentSocket": "dialSocket", "localStart": [0.55, 0.28, 0], "localEnd": [1.76, 0.28, 0.12], "contactType": "recessed-overlap", "embedDepth": 0.03, "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["detail-inventory/zone-r1c1.png"]}, "dimensions": {"width": 1.62, "height": 0.72, "depth": 0.12, "units": "relative", "confidence": 0.94}, "transform": {"position": [0.95, 0.42, 1.01], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(231, 225, 209, 1.0)", "secondaryAlbedo": "rgba(216, 210, 194, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.92, "evidence": ["detail-inventory/zone-r1c1.png"], "samplingNotes": "Ivory frame with paler inset."}, "material": "ivoryPlastic", "materialLayers": ["ivoryPlastic", "dialFaceMaterial"], "localFeatures": [{"id": "inset-rounded-frame", "description": "Raised outer frame and recessed face reveal", "level": "meso", "confidence": 0.96, "evidence": ["detail-inventory/zone-r1c1.png"]}], "evidenceRefs": ["full-object"]};
  node_dialAssembly_7.add(mesh_dialAssembly_7);
  meshes["dialAssembly"] = mesh_dialAssembly_7;
  colliders["dialAssembly"] = {};

  const attachment_controlKnobs_8 = {"parentId": "frontPanel", "parentSocket": "knobLeftSocket", "localStart": [0.5, -0.48, 0], "localEnd": [0.5, -0.48, 0.22], "contactType": "shaft-overlap", "embedDepth": 0.04, "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["detail-inventory/zone-r1c1.png"]};
  const endpoint_controlKnobs_8 = makeAttachmentEndpoint(attachment_controlKnobs_8);
  const node_controlKnobs_8 = new THREE.Group();
  node_controlKnobs_8.name = "Twin rotary knobs__pivot";
  node_controlKnobs_8.scale.set(1, 1, 1);
  if (endpoint_controlKnobs_8) {
    node_controlKnobs_8.position.copy(endpoint_controlKnobs_8.start);
    node_controlKnobs_8.rotation.set(1.5708, 0.0, 0.0);
  } else {
    node_controlKnobs_8.position.set(0.52, -0.48, 1.15);
    node_controlKnobs_8.rotation.set(1.5708, 0.0, 0.0);
  }
  node_controlKnobs_8.userData.sculptComponent = {"id": "controlKnobs", "name": "Twin rotary knobs", "colorMaterialRecipe": {"dominantAlbedo": "rgba(231, 225, 209, 1.0)", "secondaryAlbedo": "rgba(242, 236, 221, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.94, "evidence": ["detail-inventory/zone-r1c2.png"], "samplingNotes": "Ivory knob faces and ribs."}, "level": "meso", "role": "rotary-controls", "importance": 0.88, "confidence": 0.94, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Two discrete short cylindrical controls mounted to the front panel.", "geometryDescriptor": {"topologyIntent": "short cylinders with plain front caps", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.06, "segments": 3}, "deformationStack": [], "uvStrategy": "cylindrical projection", "normalStrategy": "smooth vertex normals"}, "parent": "frontPanel", "attachment": {"parentId": "frontPanel", "parentSocket": "knobLeftSocket", "localStart": [0.5, -0.48, 0], "localEnd": [0.5, -0.48, 0.22], "contactType": "shaft-overlap", "embedDepth": 0.04, "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["detail-inventory/zone-r1c1.png"]}, "dimensions": {"width": 0.7, "height": 0.28, "depth": 0.7, "units": "relative", "confidence": 0.93}, "transform": {"position": [0.52, -0.48, 1.15], "rotation": [1.5708, 0, 0], "scale": [1, 1, 1]}, "material": "ivoryPlastic", "materialLayers": ["ivoryPlastic"], "localFeatures": [{"id": "radial-ribs", "description": "Dense repeated grip ribs around both knob sidewalls", "level": "micro", "confidence": 0.92, "evidence": ["detail-inventory/zone-r1c2.png"]}], "actionProfile": {"animationRole": "rotary-control", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.7, 0.28, 0.7], "isTrigger": false, "notes": "knob interaction proxy"}, "constraints": [{"type": "rotation", "min": -2.7, "max": 2.7}], "destruction": {"breakable": false, "fractureGroup": "controls", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "ivoryPlastic"}}, "evidenceRefs": ["full-object"]};
  node_controlKnobs_8.userData.actionProfile = {"animationRole": "rotary-control", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.7, 0.28, 0.7], "isTrigger": false, "notes": "knob interaction proxy"}, "constraints": [{"type": "rotation", "min": -2.7, "max": 2.7}], "destruction": {"breakable": false, "fractureGroup": "controls", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "ivoryPlastic"}};
  (nodes["frontPanel"] ?? root).add(node_controlKnobs_8);
  nodes["controlKnobs"] = node_controlKnobs_8;
  const mesh_controlKnobs_8Geometry = endpoint_controlKnobs_8
    ? new THREE.CylinderGeometry(endpoint_controlKnobs_8.endRadius, endpoint_controlKnobs_8.baseRadius, endpoint_controlKnobs_8.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_controlKnobs_8) {
    mesh_controlKnobs_8Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_controlKnobs_8 = new THREE.Mesh(
    mesh_controlKnobs_8Geometry,
    materialMap["ivoryPlastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_controlKnobs_8.name = "Twin rotary knobs";
  if (endpoint_controlKnobs_8) {
    mesh_controlKnobs_8.position.copy(endpoint_controlKnobs_8.midpoint);
    mesh_controlKnobs_8.quaternion.copy(endpoint_controlKnobs_8.quaternion);
  }
  mesh_controlKnobs_8.castShadow = options.castShadow ?? true;
  mesh_controlKnobs_8.receiveShadow = options.receiveShadow ?? true;
  mesh_controlKnobs_8.userData.sculptComponent = {"id": "controlKnobs", "name": "Twin rotary knobs", "colorMaterialRecipe": {"dominantAlbedo": "rgba(231, 225, 209, 1.0)", "secondaryAlbedo": "rgba(242, 236, 221, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.94, "evidence": ["detail-inventory/zone-r1c2.png"], "samplingNotes": "Ivory knob faces and ribs."}, "level": "meso", "role": "rotary-controls", "importance": 0.88, "confidence": 0.94, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Two discrete short cylindrical controls mounted to the front panel.", "geometryDescriptor": {"topologyIntent": "short cylinders with plain front caps", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.06, "segments": 3}, "deformationStack": [], "uvStrategy": "cylindrical projection", "normalStrategy": "smooth vertex normals"}, "parent": "frontPanel", "attachment": {"parentId": "frontPanel", "parentSocket": "knobLeftSocket", "localStart": [0.5, -0.48, 0], "localEnd": [0.5, -0.48, 0.22], "contactType": "shaft-overlap", "embedDepth": 0.04, "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["detail-inventory/zone-r1c1.png"]}, "dimensions": {"width": 0.7, "height": 0.28, "depth": 0.7, "units": "relative", "confidence": 0.93}, "transform": {"position": [0.52, -0.48, 1.15], "rotation": [1.5708, 0, 0], "scale": [1, 1, 1]}, "material": "ivoryPlastic", "materialLayers": ["ivoryPlastic"], "localFeatures": [{"id": "radial-ribs", "description": "Dense repeated grip ribs around both knob sidewalls", "level": "micro", "confidence": 0.92, "evidence": ["detail-inventory/zone-r1c2.png"]}], "actionProfile": {"animationRole": "rotary-control", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.9}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.7, 0.28, 0.7], "isTrigger": false, "notes": "knob interaction proxy"}, "constraints": [{"type": "rotation", "min": -2.7, "max": 2.7}], "destruction": {"breakable": false, "fractureGroup": "controls", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "ivoryPlastic"}}, "evidenceRefs": ["full-object"]};
  node_controlKnobs_8.add(mesh_controlKnobs_8);
  meshes["controlKnobs"] = mesh_controlKnobs_8;
  colliders["controlKnobs"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.7, 0.28, 0.7], "isTrigger": false, "notes": "knob interaction proxy"};
  destructionGroups["controls"] ??= [];
  destructionGroups["controls"].push(node_controlKnobs_8);

  const endpoint_topShellSeam_9 = makeAttachmentEndpoint(null);
  const node_topShellSeam_9 = new THREE.Group();
  node_topShellSeam_9.name = "Upper shell seam relief__pivot";
  node_topShellSeam_9.scale.set(1, 1, 1);
  if (endpoint_topShellSeam_9) {
    node_topShellSeam_9.position.copy(endpoint_topShellSeam_9.start);
    node_topShellSeam_9.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_topShellSeam_9.position.set(0.0, 1.12, 0.86);
    node_topShellSeam_9.rotation.set(0.0, 0.0, 0.0);
  }
  node_topShellSeam_9.userData.sculptComponent = {"id": "topShellSeam", "name": "Upper shell seam relief", "colorMaterialRecipe": {"dominantAlbedo": "rgba(70, 127, 124, 1.0)", "secondaryAlbedo": "rgba(78, 145, 141, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.82, "evidence": ["detail-inventory/zone-r0c2.png"], "samplingNotes": "Slightly shadowed teal seam."}, "level": "meso", "role": "surface-seam", "importance": 0.48, "confidence": 0.82, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Thin perimeter relief changes local shading but not the main volume.", "geometryDescriptor": {"topologyIntent": "thin shallow seam strip", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals"}, "parent": "enclosure", "attachment": {"parentId": "enclosure", "parentSocket": "topSeamSocket", "localStart": [-2.0, 1.12, 0.8], "localEnd": [2.0, 1.12, 0.8], "contactType": "flush-relief", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.005, "evidenceRefs": ["detail-inventory/zone-r0c2.png"]}, "dimensions": {"width": 4.0, "height": 0.035, "depth": 0.035, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 1.12, 0.86], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "material": "tealPlastic", "materialLayers": ["tealPlastic"], "localFeatures": [], "evidenceRefs": ["full-object"]};
  node_topShellSeam_9.userData.actionProfile = {};
  (nodes["enclosure"] ?? root).add(node_topShellSeam_9);
  nodes["topShellSeam"] = node_topShellSeam_9;
  const mesh_topShellSeam_9Geometry = endpoint_topShellSeam_9
    ? new THREE.CylinderGeometry(endpoint_topShellSeam_9.endRadius, endpoint_topShellSeam_9.baseRadius, endpoint_topShellSeam_9.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_topShellSeam_9) {
    mesh_topShellSeam_9Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_topShellSeam_9 = new THREE.Mesh(
    mesh_topShellSeam_9Geometry,
    materialMap["tealPlastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_topShellSeam_9.name = "Upper shell seam relief";
  if (endpoint_topShellSeam_9) {
    mesh_topShellSeam_9.position.copy(endpoint_topShellSeam_9.midpoint);
    mesh_topShellSeam_9.quaternion.copy(endpoint_topShellSeam_9.quaternion);
  }
  mesh_topShellSeam_9.castShadow = options.castShadow ?? true;
  mesh_topShellSeam_9.receiveShadow = options.receiveShadow ?? true;
  mesh_topShellSeam_9.userData.sculptComponent = {"id": "topShellSeam", "name": "Upper shell seam relief", "colorMaterialRecipe": {"dominantAlbedo": "rgba(70, 127, 124, 1.0)", "secondaryAlbedo": "rgba(78, 145, 141, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.82, "evidence": ["detail-inventory/zone-r0c2.png"], "samplingNotes": "Slightly shadowed teal seam."}, "level": "meso", "role": "surface-seam", "importance": 0.48, "confidence": 0.82, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Thin perimeter relief changes local shading but not the main volume.", "geometryDescriptor": {"topologyIntent": "thin shallow seam strip", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals"}, "parent": "enclosure", "attachment": {"parentId": "enclosure", "parentSocket": "topSeamSocket", "localStart": [-2.0, 1.12, 0.8], "localEnd": [2.0, 1.12, 0.8], "contactType": "flush-relief", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.005, "evidenceRefs": ["detail-inventory/zone-r0c2.png"]}, "dimensions": {"width": 4.0, "height": 0.035, "depth": 0.035, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 1.12, 0.86], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "material": "tealPlastic", "materialLayers": ["tealPlastic"], "localFeatures": [], "evidenceRefs": ["full-object"]};
  node_topShellSeam_9.add(mesh_topShellSeam_9);
  meshes["topShellSeam"] = mesh_topShellSeam_9;
  colliders["topShellSeam"] = {};

  const endpoint_dialFace_10 = makeAttachmentEndpoint(null);
  const node_dialFace_10 = new THREE.Group();
  node_dialFace_10.name = "Pale dial face__pivot";
  node_dialFace_10.scale.set(1, 1, 1);
  if (endpoint_dialFace_10) {
    node_dialFace_10.position.copy(endpoint_dialFace_10.start);
    node_dialFace_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_dialFace_10.position.set(0.95, 0.42, 1.09);
    node_dialFace_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_dialFace_10.userData.sculptComponent = {"id": "dialFace", "name": "Pale dial face", "colorMaterialRecipe": {"dominantAlbedo": "rgba(216, 210, 194, 1.0)", "secondaryAlbedo": "rgba(229, 223, 207, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "evidence": ["detail-inventory/zone-r1c1.png"], "samplingNotes": "Pale matte inset face."}, "level": "meso", "role": "dial-face", "importance": 0.78, "confidence": 0.94, "primitive": "box", "topologyClass": "material-only", "topologyRationale": "Very thin color carrier inside the frame; it adds no independent silhouette.", "geometryDescriptor": {"topologyIntent": "thin recessed rounded rectangular face", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.08, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals"}, "parent": "dialAssembly", "attachment": {"parentId": "dialAssembly", "parentSocket": "dialFaceInset", "localStart": [0, 0, 0.04], "localEnd": [0, 0, 0.07], "contactType": "inset", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.005, "evidenceRefs": ["detail-inventory/zone-r1c1.png"]}, "dimensions": {"width": 1.42, "height": 0.52, "depth": 0.035, "units": "relative", "confidence": 0.93}, "transform": {"position": [0.95, 0.42, 1.09], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "material": "dialFaceMaterial", "materialLayers": ["dialFaceMaterial"], "localFeatures": [], "evidenceRefs": ["full-object"]};
  node_dialFace_10.userData.actionProfile = {};
  (nodes["dialAssembly"] ?? root).add(node_dialFace_10);
  nodes["dialFace"] = node_dialFace_10;
  const mesh_dialFace_10Geometry = endpoint_dialFace_10
    ? new THREE.CylinderGeometry(endpoint_dialFace_10.endRadius, endpoint_dialFace_10.baseRadius, endpoint_dialFace_10.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_dialFace_10) {
    mesh_dialFace_10Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_dialFace_10 = new THREE.Mesh(
    mesh_dialFace_10Geometry,
    materialMap["dialFaceMaterial"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_dialFace_10.name = "Pale dial face";
  if (endpoint_dialFace_10) {
    mesh_dialFace_10.position.copy(endpoint_dialFace_10.midpoint);
    mesh_dialFace_10.quaternion.copy(endpoint_dialFace_10.quaternion);
  }
  mesh_dialFace_10.castShadow = options.castShadow ?? true;
  mesh_dialFace_10.receiveShadow = options.receiveShadow ?? true;
  mesh_dialFace_10.userData.sculptComponent = {"id": "dialFace", "name": "Pale dial face", "colorMaterialRecipe": {"dominantAlbedo": "rgba(216, 210, 194, 1.0)", "secondaryAlbedo": "rgba(229, 223, 207, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "evidence": ["detail-inventory/zone-r1c1.png"], "samplingNotes": "Pale matte inset face."}, "level": "meso", "role": "dial-face", "importance": 0.78, "confidence": 0.94, "primitive": "box", "topologyClass": "material-only", "topologyRationale": "Very thin color carrier inside the frame; it adds no independent silhouette.", "geometryDescriptor": {"topologyIntent": "thin recessed rounded rectangular face", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.08, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals"}, "parent": "dialAssembly", "attachment": {"parentId": "dialAssembly", "parentSocket": "dialFaceInset", "localStart": [0, 0, 0.04], "localEnd": [0, 0, 0.07], "contactType": "inset", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.005, "evidenceRefs": ["detail-inventory/zone-r1c1.png"]}, "dimensions": {"width": 1.42, "height": 0.52, "depth": 0.035, "units": "relative", "confidence": 0.93}, "transform": {"position": [0.95, 0.42, 1.09], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "material": "dialFaceMaterial", "materialLayers": ["dialFaceMaterial"], "localFeatures": [], "evidenceRefs": ["full-object"]};
  node_dialFace_10.add(mesh_dialFace_10);
  meshes["dialFace"] = mesh_dialFace_10;
  colliders["dialFace"] = {};

  const endpoint_speakerInnerLip_11 = makeAttachmentEndpoint(null);
  const node_speakerInnerLip_11 = new THREE.Group();
  node_speakerInnerLip_11.name = "Speaker inner bezel lip__pivot";
  node_speakerInnerLip_11.scale.set(1, 1, 1);
  if (endpoint_speakerInnerLip_11) {
    node_speakerInnerLip_11.position.copy(endpoint_speakerInnerLip_11.start);
    node_speakerInnerLip_11.rotation.set(1.5708, 0.0, 0.0);
  } else {
    node_speakerInnerLip_11.position.set(-1.15, -0.02, 1.08);
    node_speakerInnerLip_11.rotation.set(1.5708, 0.0, 0.0);
  }
  node_speakerInnerLip_11.userData.sculptComponent = {"id": "speakerInnerLip", "name": "Speaker inner bezel lip", "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 53, 54, 1.0)", "secondaryAlbedo": "rgba(74, 75, 76, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidence": ["detail-inventory/zone-r1c0.png"], "samplingNotes": "Charcoal inner ring."}, "level": "meso", "role": "speaker-inner-ring", "importance": 0.62, "confidence": 0.9, "primitive": "torus", "topologyClass": "surface-relief", "topologyRationale": "A thinner annular lip is raised between the outer bezel and grille plate.", "geometryDescriptor": {"topologyIntent": "thin annular raised lip", "torusTubeRatio": 0.055, "edgeTreatment": {"type": "rounded", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "cylindrical projection", "normalStrategy": "smooth vertex normals"}, "parent": "speakerAssembly", "attachment": {"parentId": "speakerAssembly", "parentSocket": "innerLipSocket", "localStart": [0, 0, 0.03], "localEnd": [0, 0, 0.07], "contactType": "surface-overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.004, "evidenceRefs": ["detail-inventory/zone-r1c0.png"]}, "dimensions": {"width": 1.84, "height": 1.84, "depth": 0.07, "units": "relative", "confidence": 0.88}, "transform": {"position": [-1.15, -0.02, 1.08], "rotation": [1.5708, 0, 0], "scale": [1, 1, 0.55]}, "material": "charcoalPlastic", "materialLayers": ["charcoalPlastic"], "localFeatures": [], "evidenceRefs": ["full-object"]};
  node_speakerInnerLip_11.userData.actionProfile = {};
  (nodes["speakerAssembly"] ?? root).add(node_speakerInnerLip_11);
  nodes["speakerInnerLip"] = node_speakerInnerLip_11;
  const mesh_speakerInnerLip_11Geometry = endpoint_speakerInnerLip_11
    ? new THREE.CylinderGeometry(endpoint_speakerInnerLip_11.endRadius, endpoint_speakerInnerLip_11.baseRadius, endpoint_speakerInnerLip_11.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.0248, 12, 48);
  if (!endpoint_speakerInnerLip_11) {
    mesh_speakerInnerLip_11Geometry.scale(1.0, 1.0, 0.55);
  }
  const mesh_speakerInnerLip_11 = new THREE.Mesh(
    mesh_speakerInnerLip_11Geometry,
    materialMap["charcoalPlastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_speakerInnerLip_11.name = "Speaker inner bezel lip";
  if (endpoint_speakerInnerLip_11) {
    mesh_speakerInnerLip_11.position.copy(endpoint_speakerInnerLip_11.midpoint);
    mesh_speakerInnerLip_11.quaternion.copy(endpoint_speakerInnerLip_11.quaternion);
  }
  mesh_speakerInnerLip_11.castShadow = options.castShadow ?? true;
  mesh_speakerInnerLip_11.receiveShadow = options.receiveShadow ?? true;
  mesh_speakerInnerLip_11.userData.sculptComponent = {"id": "speakerInnerLip", "name": "Speaker inner bezel lip", "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 53, 54, 1.0)", "secondaryAlbedo": "rgba(74, 75, 76, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidence": ["detail-inventory/zone-r1c0.png"], "samplingNotes": "Charcoal inner ring."}, "level": "meso", "role": "speaker-inner-ring", "importance": 0.62, "confidence": 0.9, "primitive": "torus", "topologyClass": "surface-relief", "topologyRationale": "A thinner annular lip is raised between the outer bezel and grille plate.", "geometryDescriptor": {"topologyIntent": "thin annular raised lip", "torusTubeRatio": 0.055, "edgeTreatment": {"type": "rounded", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "cylindrical projection", "normalStrategy": "smooth vertex normals"}, "parent": "speakerAssembly", "attachment": {"parentId": "speakerAssembly", "parentSocket": "innerLipSocket", "localStart": [0, 0, 0.03], "localEnd": [0, 0, 0.07], "contactType": "surface-overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.004, "evidenceRefs": ["detail-inventory/zone-r1c0.png"]}, "dimensions": {"width": 1.84, "height": 1.84, "depth": 0.07, "units": "relative", "confidence": 0.88}, "transform": {"position": [-1.15, -0.02, 1.08], "rotation": [1.5708, 0, 0], "scale": [1, 1, 0.55]}, "material": "charcoalPlastic", "materialLayers": ["charcoalPlastic"], "localFeatures": [], "evidenceRefs": ["full-object"]};
  node_speakerInnerLip_11.add(mesh_speakerInnerLip_11);
  meshes["speakerInnerLip"] = mesh_speakerInnerLip_11;
  colliders["speakerInnerLip"] = {};

  const attachment_speakerDot_12 = {"parentId": "speakerGrille", "parentSocket": "perforationField", "localStart": [0, 0, -0.04], "localEnd": [0, 0, 0.01], "contactType": "embedded-insert", "embedDepth": 0.04, "overlap": 0.04, "gapTolerance": 0.003, "evidenceRefs": ["detail-inventory/zone-r1c0.png"]};
  const endpoint_speakerDot_12 = makeAttachmentEndpoint(attachment_speakerDot_12);
  const node_speakerDot_12 = new THREE.Group();
  node_speakerDot_12.name = "Speaker dark perforation insert template__pivot";
  node_speakerDot_12.scale.set(1, 1, 1);
  if (endpoint_speakerDot_12) {
    node_speakerDot_12.position.copy(endpoint_speakerDot_12.start);
    node_speakerDot_12.rotation.set(1.5708, 0.0, 0.0);
  } else {
    node_speakerDot_12.position.set(-1.15, -0.02, 1.09);
    node_speakerDot_12.rotation.set(1.5708, 0.0, 0.0);
  }
  node_speakerDot_12.userData.sculptComponent = {"id": "speakerDot", "name": "Speaker dark perforation insert template", "colorMaterialRecipe": {"dominantAlbedo": "rgba(9, 10, 10, 1.0)", "secondaryAlbedo": "rgba(17, 18, 18, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidence": ["detail-inventory/zone-r1c0.png"], "samplingNotes": "Near-black embedded dot."}, "level": "micro", "role": "perforation-insert", "importance": 0.7, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Low-cost real-time approximation uses dark cylinders embedded behind the grille surface; it is explicitly not claimed as boolean-cut topology.", "geometryDescriptor": {"topologyIntent": "short dark cylinder embedded behind plate", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "cylindrical projection", "normalStrategy": "smooth vertex normals"}, "parent": "speakerGrille", "attachment": {"parentId": "speakerGrille", "parentSocket": "perforationField", "localStart": [0, 0, -0.04], "localEnd": [0, 0, 0.01], "contactType": "embedded-insert", "embedDepth": 0.04, "overlap": 0.04, "gapTolerance": 0.003, "evidenceRefs": ["detail-inventory/zone-r1c0.png"]}, "dimensions": {"width": 0.095, "height": 0.06, "depth": 0.095, "units": "relative", "confidence": 0.88}, "transform": {"position": [-1.15, -0.02, 1.09], "rotation": [1.5708, 0, 0], "scale": [1, 1, 1]}, "material": "grilleCavity", "materialLayers": ["grilleCavity"], "localFeatures": [], "evidenceRefs": ["full-object"]};
  node_speakerDot_12.userData.actionProfile = {};
  (nodes["speakerGrille"] ?? root).add(node_speakerDot_12);
  nodes["speakerDot"] = node_speakerDot_12;
  const mesh_speakerDot_12Geometry = endpoint_speakerDot_12
    ? new THREE.CylinderGeometry(endpoint_speakerDot_12.endRadius, endpoint_speakerDot_12.baseRadius, endpoint_speakerDot_12.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_speakerDot_12) {
    mesh_speakerDot_12Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_speakerDot_12 = new THREE.Mesh(
    mesh_speakerDot_12Geometry,
    materialMap["grilleCavity"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_speakerDot_12.name = "Speaker dark perforation insert template";
  if (endpoint_speakerDot_12) {
    mesh_speakerDot_12.position.copy(endpoint_speakerDot_12.midpoint);
    mesh_speakerDot_12.quaternion.copy(endpoint_speakerDot_12.quaternion);
  }
  mesh_speakerDot_12.castShadow = options.castShadow ?? true;
  mesh_speakerDot_12.receiveShadow = options.receiveShadow ?? true;
  mesh_speakerDot_12.userData.sculptComponent = {"id": "speakerDot", "name": "Speaker dark perforation insert template", "colorMaterialRecipe": {"dominantAlbedo": "rgba(9, 10, 10, 1.0)", "secondaryAlbedo": "rgba(17, 18, 18, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidence": ["detail-inventory/zone-r1c0.png"], "samplingNotes": "Near-black embedded dot."}, "level": "micro", "role": "perforation-insert", "importance": 0.7, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Low-cost real-time approximation uses dark cylinders embedded behind the grille surface; it is explicitly not claimed as boolean-cut topology.", "geometryDescriptor": {"topologyIntent": "short dark cylinder embedded behind plate", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "cylindrical projection", "normalStrategy": "smooth vertex normals"}, "parent": "speakerGrille", "attachment": {"parentId": "speakerGrille", "parentSocket": "perforationField", "localStart": [0, 0, -0.04], "localEnd": [0, 0, 0.01], "contactType": "embedded-insert", "embedDepth": 0.04, "overlap": 0.04, "gapTolerance": 0.003, "evidenceRefs": ["detail-inventory/zone-r1c0.png"]}, "dimensions": {"width": 0.095, "height": 0.06, "depth": 0.095, "units": "relative", "confidence": 0.88}, "transform": {"position": [-1.15, -0.02, 1.09], "rotation": [1.5708, 0, 0], "scale": [1, 1, 1]}, "material": "grilleCavity", "materialLayers": ["grilleCavity"], "localFeatures": [], "evidenceRefs": ["full-object"]};
  node_speakerDot_12.add(mesh_speakerDot_12);
  meshes["speakerDot"] = mesh_speakerDot_12;
  colliders["speakerDot"] = {};

  const endpoint_dialMarks_13 = makeAttachmentEndpoint(null);
  const node_dialMarks_13 = new THREE.Group();
  node_dialMarks_13.name = "Dial baseline and tick template__pivot";
  node_dialMarks_13.scale.set(1, 1, 1);
  if (endpoint_dialMarks_13) {
    node_dialMarks_13.position.copy(endpoint_dialMarks_13.start);
    node_dialMarks_13.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_dialMarks_13.position.set(0.42, 0.42, 1.13);
    node_dialMarks_13.rotation.set(0.0, 0.0, 0.0);
  }
  node_dialMarks_13.userData.sculptComponent = {"id": "dialMarks", "name": "Dial baseline and tick template", "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 51, 48, 1.0)", "secondaryAlbedo": "rgba(41, 40, 37, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.92, "evidence": ["detail-inventory/zone-r1c1.png"], "samplingNotes": "Charcoal dial ink."}, "level": "micro", "role": "painted-line-geometry", "importance": 0.72, "confidence": 0.93, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Thin raised line geometry preserves dial legibility under browser antialiasing.", "geometryDescriptor": {"topologyIntent": "thin dark tick mark template", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals"}, "parent": "dialFace", "attachment": {"parentId": "dialFace", "parentSocket": "dialMarkPlane", "localStart": [-0.58, 0, 0.02], "localEnd": [0.58, 0, 0.02], "contactType": "flush-print", "embedDepth": 0.005, "overlap": 0.005, "gapTolerance": 0.002, "evidenceRefs": ["detail-inventory/zone-r1c1.png"]}, "dimensions": {"width": 0.025, "height": 0.18, "depth": 0.018, "units": "relative", "confidence": 0.92}, "transform": {"position": [0.42, 0.42, 1.13], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "material": "dialInk", "materialLayers": ["dialInk"], "localFeatures": [{"id": "baseline-and-ticks", "description": "One baseline plus alternating long and short ticks", "level": "micro", "confidence": 0.94, "evidence": ["detail-inventory/zone-r1c1.png"]}], "evidenceRefs": ["full-object"]};
  node_dialMarks_13.userData.actionProfile = {};
  (nodes["dialFace"] ?? root).add(node_dialMarks_13);
  nodes["dialMarks"] = node_dialMarks_13;
  const mesh_dialMarks_13Geometry = endpoint_dialMarks_13
    ? new THREE.CylinderGeometry(endpoint_dialMarks_13.endRadius, endpoint_dialMarks_13.baseRadius, endpoint_dialMarks_13.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_dialMarks_13) {
    mesh_dialMarks_13Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_dialMarks_13 = new THREE.Mesh(
    mesh_dialMarks_13Geometry,
    materialMap["dialInk"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_dialMarks_13.name = "Dial baseline and tick template";
  if (endpoint_dialMarks_13) {
    mesh_dialMarks_13.position.copy(endpoint_dialMarks_13.midpoint);
    mesh_dialMarks_13.quaternion.copy(endpoint_dialMarks_13.quaternion);
  }
  mesh_dialMarks_13.castShadow = options.castShadow ?? true;
  mesh_dialMarks_13.receiveShadow = options.receiveShadow ?? true;
  mesh_dialMarks_13.userData.sculptComponent = {"id": "dialMarks", "name": "Dial baseline and tick template", "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 51, 48, 1.0)", "secondaryAlbedo": "rgba(41, 40, 37, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.92, "evidence": ["detail-inventory/zone-r1c1.png"], "samplingNotes": "Charcoal dial ink."}, "level": "micro", "role": "painted-line-geometry", "importance": 0.72, "confidence": 0.93, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Thin raised line geometry preserves dial legibility under browser antialiasing.", "geometryDescriptor": {"topologyIntent": "thin dark tick mark template", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals"}, "parent": "dialFace", "attachment": {"parentId": "dialFace", "parentSocket": "dialMarkPlane", "localStart": [-0.58, 0, 0.02], "localEnd": [0.58, 0, 0.02], "contactType": "flush-print", "embedDepth": 0.005, "overlap": 0.005, "gapTolerance": 0.002, "evidenceRefs": ["detail-inventory/zone-r1c1.png"]}, "dimensions": {"width": 0.025, "height": 0.18, "depth": 0.018, "units": "relative", "confidence": 0.92}, "transform": {"position": [0.42, 0.42, 1.13], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "material": "dialInk", "materialLayers": ["dialInk"], "localFeatures": [{"id": "baseline-and-ticks", "description": "One baseline plus alternating long and short ticks", "level": "micro", "confidence": 0.94, "evidence": ["detail-inventory/zone-r1c1.png"]}], "evidenceRefs": ["full-object"]};
  node_dialMarks_13.add(mesh_dialMarks_13);
  meshes["dialMarks"] = mesh_dialMarks_13;
  colliders["dialMarks"] = {};

  const endpoint_dialNeedle_14 = makeAttachmentEndpoint(null);
  const node_dialNeedle_14 = new THREE.Group();
  node_dialNeedle_14.name = "Red tuning needle__pivot";
  node_dialNeedle_14.scale.set(1, 1, 1);
  if (endpoint_dialNeedle_14) {
    node_dialNeedle_14.position.copy(endpoint_dialNeedle_14.start);
    node_dialNeedle_14.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_dialNeedle_14.position.set(1.03, 0.42, 1.15);
    node_dialNeedle_14.rotation.set(0.0, 0.0, 0.0);
  }
  node_dialNeedle_14.userData.sculptComponent = {"id": "dialNeedle", "name": "Red tuning needle", "colorMaterialRecipe": {"dominantAlbedo": "rgba(185, 47, 45, 1.0)", "secondaryAlbedo": "rgba(207, 69, 64, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.96, "evidence": ["detail-inventory/zone-r1c1.png"], "samplingNotes": "Muted red indicator."}, "level": "micro", "role": "indicator", "importance": 0.8, "confidence": 0.98, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Thin raised colored indicator sits over the dial face and is silhouette-neutral.", "geometryDescriptor": {"topologyIntent": "narrow vertical rounded indicator", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.015, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals"}, "parent": "dialFace", "attachment": {"parentId": "dialFace", "parentSocket": "indicatorTrack", "localStart": [0.1, -0.2, 0.03], "localEnd": [0.1, 0.2, 0.03], "contactType": "flush-overlap", "embedDepth": 0.005, "overlap": 0.005, "gapTolerance": 0.002, "evidenceRefs": ["detail-inventory/zone-r1c1.png"]}, "dimensions": {"width": 0.045, "height": 0.42, "depth": 0.025, "units": "relative", "confidence": 0.97}, "transform": {"position": [1.03, 0.42, 1.15], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "material": "redPaint", "materialLayers": ["redPaint"], "localFeatures": [{"id": "red-vertical-indicator", "description": "Muted red line crosses the dial baseline", "level": "micro", "confidence": 0.98, "evidence": ["detail-inventory/zone-r1c1.png"]}], "evidenceRefs": ["full-object"]};
  node_dialNeedle_14.userData.actionProfile = {};
  (nodes["dialFace"] ?? root).add(node_dialNeedle_14);
  nodes["dialNeedle"] = node_dialNeedle_14;
  const mesh_dialNeedle_14Geometry = endpoint_dialNeedle_14
    ? new THREE.CylinderGeometry(endpoint_dialNeedle_14.endRadius, endpoint_dialNeedle_14.baseRadius, endpoint_dialNeedle_14.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_dialNeedle_14) {
    mesh_dialNeedle_14Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_dialNeedle_14 = new THREE.Mesh(
    mesh_dialNeedle_14Geometry,
    materialMap["redPaint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_dialNeedle_14.name = "Red tuning needle";
  if (endpoint_dialNeedle_14) {
    mesh_dialNeedle_14.position.copy(endpoint_dialNeedle_14.midpoint);
    mesh_dialNeedle_14.quaternion.copy(endpoint_dialNeedle_14.quaternion);
  }
  mesh_dialNeedle_14.castShadow = options.castShadow ?? true;
  mesh_dialNeedle_14.receiveShadow = options.receiveShadow ?? true;
  mesh_dialNeedle_14.userData.sculptComponent = {"id": "dialNeedle", "name": "Red tuning needle", "colorMaterialRecipe": {"dominantAlbedo": "rgba(185, 47, 45, 1.0)", "secondaryAlbedo": "rgba(207, 69, 64, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.96, "evidence": ["detail-inventory/zone-r1c1.png"], "samplingNotes": "Muted red indicator."}, "level": "micro", "role": "indicator", "importance": 0.8, "confidence": 0.98, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Thin raised colored indicator sits over the dial face and is silhouette-neutral.", "geometryDescriptor": {"topologyIntent": "narrow vertical rounded indicator", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.015, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals"}, "parent": "dialFace", "attachment": {"parentId": "dialFace", "parentSocket": "indicatorTrack", "localStart": [0.1, -0.2, 0.03], "localEnd": [0.1, 0.2, 0.03], "contactType": "flush-overlap", "embedDepth": 0.005, "overlap": 0.005, "gapTolerance": 0.002, "evidenceRefs": ["detail-inventory/zone-r1c1.png"]}, "dimensions": {"width": 0.045, "height": 0.42, "depth": 0.025, "units": "relative", "confidence": 0.97}, "transform": {"position": [1.03, 0.42, 1.15], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "material": "redPaint", "materialLayers": ["redPaint"], "localFeatures": [{"id": "red-vertical-indicator", "description": "Muted red line crosses the dial baseline", "level": "micro", "confidence": 0.98, "evidence": ["detail-inventory/zone-r1c1.png"]}], "evidenceRefs": ["full-object"]};
  node_dialNeedle_14.add(mesh_dialNeedle_14);
  meshes["dialNeedle"] = mesh_dialNeedle_14;
  colliders["dialNeedle"] = {};

  const endpoint_knobRib_15 = makeAttachmentEndpoint(null);
  const node_knobRib_15 = new THREE.Group();
  node_knobRib_15.name = "Knob grip rib template__pivot";
  node_knobRib_15.scale.set(1, 1, 1);
  if (endpoint_knobRib_15) {
    node_knobRib_15.position.copy(endpoint_knobRib_15.start);
    node_knobRib_15.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_knobRib_15.position.set(0.87, -0.48, 1.15);
    node_knobRib_15.rotation.set(0.0, 0.0, 0.0);
  }
  node_knobRib_15.userData.sculptComponent = {"id": "knobRib", "name": "Knob grip rib template", "colorMaterialRecipe": {"dominantAlbedo": "rgba(231, 225, 209, 1.0)", "secondaryAlbedo": "rgba(210, 204, 188, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidence": ["detail-inventory/zone-r1c2.png"], "samplingNotes": "Ivory grip ridge."}, "level": "micro", "role": "grip-ridge", "importance": 0.52, "confidence": 0.88, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Thin raised rib repeats around the cylindrical knob edge.", "geometryDescriptor": {"topologyIntent": "narrow radial grip ridge", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals"}, "parent": "controlKnobs", "attachment": {"parentId": "controlKnobs", "parentSocket": "knobRibRing", "localStart": [0.33, 0, 0], "localEnd": [0.36, 0, 0], "contactType": "surface-ridge", "embedDepth": 0.01, "overlap": 0.01, "gapTolerance": 0.002, "evidenceRefs": ["detail-inventory/zone-r1c2.png"]}, "dimensions": {"width": 0.035, "height": 0.12, "depth": 0.05, "units": "relative", "confidence": 0.86}, "transform": {"position": [0.87, -0.48, 1.15], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "material": "ivoryPlastic", "materialLayers": ["ivoryPlastic"], "localFeatures": [], "evidenceRefs": ["full-object"]};
  node_knobRib_15.userData.actionProfile = {};
  (nodes["controlKnobs"] ?? root).add(node_knobRib_15);
  nodes["knobRib"] = node_knobRib_15;
  const mesh_knobRib_15Geometry = endpoint_knobRib_15
    ? new THREE.CylinderGeometry(endpoint_knobRib_15.endRadius, endpoint_knobRib_15.baseRadius, endpoint_knobRib_15.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_knobRib_15) {
    mesh_knobRib_15Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_knobRib_15 = new THREE.Mesh(
    mesh_knobRib_15Geometry,
    materialMap["ivoryPlastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_knobRib_15.name = "Knob grip rib template";
  if (endpoint_knobRib_15) {
    mesh_knobRib_15.position.copy(endpoint_knobRib_15.midpoint);
    mesh_knobRib_15.quaternion.copy(endpoint_knobRib_15.quaternion);
  }
  mesh_knobRib_15.castShadow = options.castShadow ?? true;
  mesh_knobRib_15.receiveShadow = options.receiveShadow ?? true;
  mesh_knobRib_15.userData.sculptComponent = {"id": "knobRib", "name": "Knob grip rib template", "colorMaterialRecipe": {"dominantAlbedo": "rgba(231, 225, 209, 1.0)", "secondaryAlbedo": "rgba(210, 204, 188, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88, "evidence": ["detail-inventory/zone-r1c2.png"], "samplingNotes": "Ivory grip ridge."}, "level": "micro", "role": "grip-ridge", "importance": 0.52, "confidence": 0.88, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Thin raised rib repeats around the cylindrical knob edge.", "geometryDescriptor": {"topologyIntent": "narrow radial grip ridge", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals"}, "parent": "controlKnobs", "attachment": {"parentId": "controlKnobs", "parentSocket": "knobRibRing", "localStart": [0.33, 0, 0], "localEnd": [0.36, 0, 0], "contactType": "surface-ridge", "embedDepth": 0.01, "overlap": 0.01, "gapTolerance": 0.002, "evidenceRefs": ["detail-inventory/zone-r1c2.png"]}, "dimensions": {"width": 0.035, "height": 0.12, "depth": 0.05, "units": "relative", "confidence": 0.86}, "transform": {"position": [0.87, -0.48, 1.15], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "material": "ivoryPlastic", "materialLayers": ["ivoryPlastic"], "localFeatures": [], "evidenceRefs": ["full-object"]};
  node_knobRib_15.add(mesh_knobRib_15);
  meshes["knobRib"] = mesh_knobRib_15;
  colliders["knobRib"] = {};

  const attachment_pivotCap_16 = {"parentId": "handlePivots", "parentSocket": "outerCapSocket", "localStart": [0, 0, 0.08], "localEnd": [0, 0, 0.16], "contactType": "cap-overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.004, "evidenceRefs": ["detail-inventory/zone-r1c2.png"]};
  const endpoint_pivotCap_16 = makeAttachmentEndpoint(attachment_pivotCap_16);
  const node_pivotCap_16 = new THREE.Group();
  node_pivotCap_16.name = "Outer pivot cap template__pivot";
  node_pivotCap_16.scale.set(1, 1, 1);
  if (endpoint_pivotCap_16) {
    node_pivotCap_16.position.copy(endpoint_pivotCap_16.start);
    node_pivotCap_16.rotation.set(0.0, 0.0, 1.5708);
  } else {
    node_pivotCap_16.position.set(2.18, 0.62, 0.0);
    node_pivotCap_16.rotation.set(0.0, 0.0, 1.5708);
  }
  node_pivotCap_16.userData.sculptComponent = {"id": "pivotCap", "name": "Outer pivot cap template", "colorMaterialRecipe": {"dominantAlbedo": "rgba(231, 225, 209, 1.0)", "secondaryAlbedo": "rgba(242, 236, 221, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidence": ["detail-inventory/zone-r1c2.png"], "samplingNotes": "Ivory cap."}, "level": "micro", "role": "pivot-cap", "importance": 0.42, "confidence": 0.78, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small discrete cap overlays the larger pivot housing.", "geometryDescriptor": {"topologyIntent": "short outer cap disk", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "cylindrical projection", "normalStrategy": "smooth vertex normals"}, "parent": "handlePivots", "attachment": {"parentId": "handlePivots", "parentSocket": "outerCapSocket", "localStart": [0, 0, 0.08], "localEnd": [0, 0, 0.16], "contactType": "cap-overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.004, "evidenceRefs": ["detail-inventory/zone-r1c2.png"]}, "dimensions": {"width": 0.38, "height": 0.12, "depth": 0.38, "units": "relative", "confidence": 0.78}, "transform": {"position": [2.18, 0.62, 0], "rotation": [0, 0, 1.5708], "scale": [1, 1, 1]}, "material": "ivoryPlastic", "materialLayers": ["ivoryPlastic"], "localFeatures": [], "evidenceRefs": ["full-object"]};
  node_pivotCap_16.userData.actionProfile = {};
  (nodes["handlePivots"] ?? root).add(node_pivotCap_16);
  nodes["pivotCap"] = node_pivotCap_16;
  const mesh_pivotCap_16Geometry = endpoint_pivotCap_16
    ? new THREE.CylinderGeometry(endpoint_pivotCap_16.endRadius, endpoint_pivotCap_16.baseRadius, endpoint_pivotCap_16.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_pivotCap_16) {
    mesh_pivotCap_16Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_pivotCap_16 = new THREE.Mesh(
    mesh_pivotCap_16Geometry,
    materialMap["ivoryPlastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pivotCap_16.name = "Outer pivot cap template";
  if (endpoint_pivotCap_16) {
    mesh_pivotCap_16.position.copy(endpoint_pivotCap_16.midpoint);
    mesh_pivotCap_16.quaternion.copy(endpoint_pivotCap_16.quaternion);
  }
  mesh_pivotCap_16.castShadow = options.castShadow ?? true;
  mesh_pivotCap_16.receiveShadow = options.receiveShadow ?? true;
  mesh_pivotCap_16.userData.sculptComponent = {"id": "pivotCap", "name": "Outer pivot cap template", "colorMaterialRecipe": {"dominantAlbedo": "rgba(231, 225, 209, 1.0)", "secondaryAlbedo": "rgba(242, 236, 221, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidence": ["detail-inventory/zone-r1c2.png"], "samplingNotes": "Ivory cap."}, "level": "micro", "role": "pivot-cap", "importance": 0.42, "confidence": 0.78, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small discrete cap overlays the larger pivot housing.", "geometryDescriptor": {"topologyIntent": "short outer cap disk", "edgeTreatment": {"type": "rounded", "bevelRadius": 0.035, "segments": 2}, "deformationStack": [], "uvStrategy": "cylindrical projection", "normalStrategy": "smooth vertex normals"}, "parent": "handlePivots", "attachment": {"parentId": "handlePivots", "parentSocket": "outerCapSocket", "localStart": [0, 0, 0.08], "localEnd": [0, 0, 0.16], "contactType": "cap-overlap", "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.004, "evidenceRefs": ["detail-inventory/zone-r1c2.png"]}, "dimensions": {"width": 0.38, "height": 0.12, "depth": 0.38, "units": "relative", "confidence": 0.78}, "transform": {"position": [2.18, 0.62, 0], "rotation": [0, 0, 1.5708], "scale": [1, 1, 1]}, "material": "ivoryPlastic", "materialLayers": ["ivoryPlastic"], "localFeatures": [], "evidenceRefs": ["full-object"]};
  node_pivotCap_16.add(mesh_pivotCap_16);
  meshes["pivotCap"] = mesh_pivotCap_16;
  colliders["pivotCap"] = {};

  const endpoint_dialBaseline_17 = makeAttachmentEndpoint(null);
  const node_dialBaseline_17 = new THREE.Group();
  node_dialBaseline_17.name = "Dial horizontal baseline__pivot";
  node_dialBaseline_17.scale.set(1, 1, 1);
  if (endpoint_dialBaseline_17) {
    node_dialBaseline_17.position.copy(endpoint_dialBaseline_17.start);
    node_dialBaseline_17.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_dialBaseline_17.position.set(0.95, 0.42, 1.13);
    node_dialBaseline_17.rotation.set(0.0, 0.0, 0.0);
  }
  node_dialBaseline_17.userData.sculptComponent = {"id": "dialBaseline", "name": "Dial horizontal baseline", "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 51, 48, 1.0)", "secondaryAlbedo": "rgba(41, 40, 37, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.92, "evidence": ["detail-inventory/zone-r1c1.png"], "samplingNotes": "Charcoal baseline."}, "level": "micro", "role": "dial-line", "importance": 0.58, "confidence": 0.94, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Thin line geometry on the dial face.", "geometryDescriptor": {"topologyIntent": "thin horizontal dark line", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals"}, "parent": "dialFace", "attachment": {"parentId": "dialFace", "parentSocket": "dialMarkPlane", "localStart": [-0.6, 0, 0.02], "localEnd": [0.6, 0, 0.02], "contactType": "flush-print", "embedDepth": 0.005, "overlap": 0.005, "gapTolerance": 0.002, "evidenceRefs": ["detail-inventory/zone-r1c1.png"]}, "dimensions": {"width": 1.18, "height": 0.018, "depth": 0.018, "units": "relative", "confidence": 0.93}, "transform": {"position": [0.95, 0.42, 1.13], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "material": "dialInk", "materialLayers": ["dialInk"], "localFeatures": [], "evidenceRefs": ["full-object"]};
  node_dialBaseline_17.userData.actionProfile = {};
  (nodes["dialFace"] ?? root).add(node_dialBaseline_17);
  nodes["dialBaseline"] = node_dialBaseline_17;
  const mesh_dialBaseline_17Geometry = endpoint_dialBaseline_17
    ? new THREE.CylinderGeometry(endpoint_dialBaseline_17.endRadius, endpoint_dialBaseline_17.baseRadius, endpoint_dialBaseline_17.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_dialBaseline_17) {
    mesh_dialBaseline_17Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_dialBaseline_17 = new THREE.Mesh(
    mesh_dialBaseline_17Geometry,
    materialMap["dialInk"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_dialBaseline_17.name = "Dial horizontal baseline";
  if (endpoint_dialBaseline_17) {
    mesh_dialBaseline_17.position.copy(endpoint_dialBaseline_17.midpoint);
    mesh_dialBaseline_17.quaternion.copy(endpoint_dialBaseline_17.quaternion);
  }
  mesh_dialBaseline_17.castShadow = options.castShadow ?? true;
  mesh_dialBaseline_17.receiveShadow = options.receiveShadow ?? true;
  mesh_dialBaseline_17.userData.sculptComponent = {"id": "dialBaseline", "name": "Dial horizontal baseline", "colorMaterialRecipe": {"dominantAlbedo": "rgba(52, 51, 48, 1.0)", "secondaryAlbedo": "rgba(41, 40, 37, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.92, "evidence": ["detail-inventory/zone-r1c1.png"], "samplingNotes": "Charcoal baseline."}, "level": "micro", "role": "dial-line", "importance": 0.58, "confidence": 0.94, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Thin line geometry on the dial face.", "geometryDescriptor": {"topologyIntent": "thin horizontal dark line", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals"}, "parent": "dialFace", "attachment": {"parentId": "dialFace", "parentSocket": "dialMarkPlane", "localStart": [-0.6, 0, 0.02], "localEnd": [0.6, 0, 0.02], "contactType": "flush-print", "embedDepth": 0.005, "overlap": 0.005, "gapTolerance": 0.002, "evidenceRefs": ["detail-inventory/zone-r1c1.png"]}, "dimensions": {"width": 1.18, "height": 0.018, "depth": 0.018, "units": "relative", "confidence": 0.93}, "transform": {"position": [0.95, 0.42, 1.13], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "material": "dialInk", "materialLayers": ["dialInk"], "localFeatures": [], "evidenceRefs": ["full-object"]};
  node_dialBaseline_17.add(mesh_dialBaseline_17);
  meshes["dialBaseline"] = mesh_dialBaseline_17;
  colliders["dialBaseline"] = {};

  // repetition system: speakerHoleField (InstancedMesh, radial, count=177, level=meso)
  {
    const parent = nodes["root"] ?? root;
    const geo = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    const mat = materialMap["tealPlastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.1, 0.1, 0.1];
    const axis = new THREE.Vector3(0.0, 0.0, 1.0).normalize();
    const radius = 0.0;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 177);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 177; i++) {
      const ang = ((0.0) + (i * 360) / 177) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "speakerHoleField";
    parent.add(cluster);
  }

  // repetition system: dialTickArray (InstancedMesh, radial, count=15, level=meso)
  {
    const parent = nodes["root"] ?? root;
    const geo = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    const mat = materialMap["tealPlastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.1, 0.1, 0.1];
    const axis = new THREE.Vector3(0.0, 0.0, 1.0).normalize();
    const radius = 0.0;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 15);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 15; i++) {
      const ang = ((0.0) + (i * 360) / 15) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "dialTickArray";
    parent.add(cluster);
  }

  // repetition system: knobPair (InstancedMesh, radial, count=2, level=meso)
  {
    const parent = nodes["root"] ?? root;
    const geo = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    const mat = materialMap["tealPlastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.1, 0.1, 0.1];
    const axis = new THREE.Vector3(0.0, 0.0, 1.0).normalize();
    const radius = 0.0;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 2);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 2; i++) {
      const ang = ((0.0) + (i * 360) / 2) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "knobPair";
    parent.add(cluster);
  }

  // repetition system: knobRibRadial (InstancedMesh, radial, count=28, level=meso)
  {
    const parent = nodes["root"] ?? root;
    const geo = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    const mat = materialMap["tealPlastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.1, 0.1, 0.1];
    const axis = new THREE.Vector3(0.0, 0.0, 1.0).normalize();
    const radius = 0.0;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 28);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 28; i++) {
      const ang = ((0.0) + (i * 360) / 28) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "knobRibRadial";
    parent.add(cluster);
  }

  // repetition system: handlePivotPair (InstancedMesh, radial, count=2, level=meso)
  {
    const parent = nodes["root"] ?? root;
    const geo = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    const mat = materialMap["tealPlastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.1, 0.1, 0.1];
    const axis = new THREE.Vector3(0.0, 0.0, 1.0).normalize();
    const radius = 0.0;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 2);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 2; i++) {
      const ang = ((0.0) + (i * 360) / 2) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "handlePivotPair";
    parent.add(cluster);
  }

  // repetition system: feetFourCorner (InstancedMesh, radial, count=4, level=meso)
  {
    const parent = nodes["root"] ?? root;
    const geo = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    const mat = materialMap["tealPlastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.1, 0.1, 0.1];
    const axis = new THREE.Vector3(0.0, 0.0, 1.0).normalize();
    const radius = 0.0;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 4);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 4; i++) {
      const ang = ((0.0) + (i * 360) / 4) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "feetFourCorner";
    parent.add(cluster);
  }

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity within a low-cost browser budget", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 512, "preferredTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image inference"}}, "lightingPass": {"requiredTerms": ["key light", "fill light", "environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "missing contact shadow"]}};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

// Form-pass correction: the generic emitter treats world-space component transforms as
// local transforms when a parent is present. Keep the generated factory above as an
// auditable source artifact, but expose this compact hierarchy with explicit local-space
// placement so the structural silhouette stays frozen while form details are introduced.
export function createVintagePortableRadioModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = 'Vintage portable radio';
  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};
  const wireframe = options.wireframe ?? false;

  const makeReferenceDerivedMaps = (
    color: number,
    roughnessBase: number,
    roughnessVariation: number,
    normalStrength: number,
    seed: number,
  ) => {
    const size = 1024;
    const height = new Float32Array(size * size);
    const albedo = new Uint8Array(size * size * 4);
    const roughness = new Uint8Array(size * size * 4);
    const normal = new Uint8Array(size * size * 4);
    const ao = new Uint8Array(size * size * 4);
    const base = new THREE.Color(color);
    const noise = (x: number, y: number, salt: number) => {
      let value = Math.imul(x + seed * 101 + salt * 17, 374761393) ^ Math.imul(y + salt * 31, 668265263);
      value = Math.imul(value ^ (value >>> 13), 1274126177);
      return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
    };
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const p = y * size + x;
        const i = p * 4;
        const macro = Math.sin((x + seed * 7) * 0.012) * Math.sin((y - seed * 3) * 0.01);
        const meso = noise(x >> 3, y >> 3, 3) * 2 - 1;
        const micro = noise(x, y, 11) * 2 - 1;
        const signal = macro * 0.18 + meso * 0.34 + micro * 0.48;
        height[p] = 0.5 + signal * 0.12;
        const value = 0.985 + signal * 0.018;
        albedo[i] = Math.round(base.r * 255 * value);
        albedo[i + 1] = Math.round(base.g * 255 * value);
        albedo[i + 2] = Math.round(base.b * 255 * value);
        albedo[i + 3] = 255;
        const r = THREE.MathUtils.clamp(roughnessBase + signal * roughnessVariation, 0, 1) * 255;
        roughness[i] = roughness[i + 1] = roughness[i + 2] = Math.round(r);
        roughness[i + 3] = 255;
        const cavity = THREE.MathUtils.clamp(0.96 - Math.max(0, 0.5 - height[p]) * 0.45, 0, 1) * 255;
        ao[i] = ao[i + 1] = ao[i + 2] = Math.round(cavity);
        ao[i + 3] = 255;
      }
    }
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const p = y * size + x;
        const i = p * 4;
        const left = height[y * size + ((x - 1 + size) % size)];
        const right = height[y * size + ((x + 1) % size)];
        const down = height[((y - 1 + size) % size) * size + x];
        const up = height[((y + 1) % size) * size + x];
        const nx = (left - right) * normalStrength * 8;
        const ny = (down - up) * normalStrength * 8;
        const invLength = 1 / Math.sqrt(nx * nx + ny * ny + 1);
        normal[i] = Math.round((nx * invLength * 0.5 + 0.5) * 255);
        normal[i + 1] = Math.round((ny * invLength * 0.5 + 0.5) * 255);
        normal[i + 2] = Math.round((invLength * 0.5 + 0.5) * 255);
        normal[i + 3] = 255;
      }
    }
    const texture = (data: Uint8Array, colorSpace: THREE.ColorSpace) => {
      const value = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
      value.colorSpace = colorSpace;
      value.wrapS = value.wrapT = THREE.RepeatWrapping;
      value.repeat.set(4, 4);
      value.anisotropy = options.textureAnisotropy ?? 4;
      value.needsUpdate = true;
      return value;
    };
    return {
      albedo: texture(albedo, THREE.SRGBColorSpace),
      roughness: texture(roughness, THREE.NoColorSpace),
      normal: texture(normal, THREE.NoColorSpace),
      ao: texture(ao, THREE.NoColorSpace),
    };
  };
  const physicalPlastic = (color: number, roughnessBase: number, variation: number, normalStrength: number, seed: number) => {
    const maps = makeReferenceDerivedMaps(color, roughnessBase, variation, normalStrength, seed);
    return new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: maps.albedo,
      roughness: roughnessBase,
      roughnessMap: maps.roughness,
      normalMap: maps.normal,
      normalScale: new THREE.Vector2(normalStrength, normalStrength),
      aoMap: maps.ao,
      aoMapIntensity: 0.38,
      metalness: 0,
      clearcoat: 0.12,
      clearcoatRoughness: 0.54,
      envMapIntensity: 0.72,
      wireframe,
    });
  };
  const material = (color: number, roughness: number, metalness = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, wireframe });
  const teal = physicalPlastic(0x70aaa5, 0.64, 0.065, 0.18, 17);
  const tealDark = material(0x315f5d, 0.66);
  const cream = physicalPlastic(0xeae5dc, 0.68, 0.05, 0.171, 29);
  const creamDark = physicalPlastic(0xc6bda8, 0.62, 0.035, 0.09, 31);
  const charcoal = physicalPlastic(0x343330, 0.693, 0.05, 0.2, 43);
  const dialInk = material(0x252421, 0.7);
  const needleRed = new THREE.MeshPhysicalMaterial({
    color: 0xb8332f,
    roughness: 0.38,
    metalness: 0,
    clearcoat: 0.22,
    clearcoatRoughness: 0.3,
    envMapIntensity: 0.72,
    wireframe,
  });

  const group = (id: string, name: string, parent: THREE.Object3D, parentId: string | null) => {
    const value = new THREE.Group();
    value.name = `${name}__pivot`;
    value.userData.sculptComponent = { id, name, parent: parentId, pass: 'interaction-pass' };
    value.userData.partId = id;
    value.userData.selectable = true;
    value.userData.actionProfile = {
      pivot: { mode: 'stable-component-pivot', localPosition: [0, 0, 0] },
      transformChannels: { visibility: true, materialState: true },
    };
    parent.add(value);
    nodes[id] = value;
    return value;
  };
  const addMesh = (
    id: string,
    name: string,
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    meshMaterial: THREE.Material,
  ) => {
    const uv = geometry.getAttribute('uv');
    if (uv && !geometry.getAttribute('uv1')) geometry.setAttribute('uv1', uv.clone());
    const value = new THREE.Mesh(geometry, meshMaterial);
    value.name = name;
    value.castShadow = options.castShadow ?? true;
    value.receiveShadow = options.receiveShadow ?? true;
    value.userData.sculptComponent = { id, name, pass: 'interaction-pass' };
    parent.add(value);
    meshes[id] = value;
    return value;
  };
  const addSocket = (ownerId: string, id: string, parent: THREE.Object3D, position: THREE.Vector3) => {
    const value = new THREE.Object3D();
    value.name = id;
    value.position.copy(position);
    value.userData.socket = { id, localPosition: position.toArray() };
    parent.add(value);
    sockets[`${ownerId}:${id}`] = value;
  };

  const enclosure = group('enclosure', 'Rounded teal enclosure', root, null);
  enclosure.position.y = -0.06;
  addMesh('enclosure', 'Rounded teal enclosure', enclosure, new RoundedBoxGeometry(4.45, 2.82, 1.7, 6, 0.3), teal);
  colliders.enclosure = { type: 'box', scale: [4.45, 2.82, 1.7] };
  addSocket('enclosure', 'frontSocket', enclosure, new THREE.Vector3(0, 0.06, 0.84));
  addSocket('enclosure', 'handleLeftSocket', enclosure, new THREE.Vector3(-2.05, 0.68, 0));
  addSocket('enclosure', 'handleRightSocket', enclosure, new THREE.Vector3(2.05, 0.68, 0));

  const frontPanel = group('frontPanel', 'Inset teal front panel', enclosure, 'enclosure');
  frontPanel.position.set(0, 0.06, 0.84);
  addMesh('frontPanel', 'Inset teal front panel', frontPanel, new RoundedBoxGeometry(4.05, 2.43, 0.04, 4, 0.2), teal);

  const handle = group('handle', 'Cream carry handle', enclosure, 'enclosure');
  handle.userData.actionProfile = {
    animationRole: 'hinge',
    pivot: { mode: 'dual-hinge-axis', localPosition: [0, 0.68, 0], axis: [1, 0, 0] },
    constraints: [{ type: 'hinge-limit', min: 0, max: 1.35 }],
  };
  const handlePath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-2.05, 0.68, 0), new THREE.Vector3(-2.05, 1.28, -0.05),
    new THREE.Vector3(-1.68, 1.72, -0.05), new THREE.Vector3(1.68, 1.72, -0.05),
    new THREE.Vector3(2.05, 1.28, -0.05), new THREE.Vector3(2.05, 0.68, 0),
  ]);
  addMesh('handle', 'Cream carry handle', handle, new THREE.TubeGeometry(handlePath, 64, 0.13, 8, false), cream);

  const handlePivots = group('handlePivots', 'Handle hinge housings', enclosure, 'enclosure');
  for (const side of [-1, 1]) {
    const pivot = addMesh(
      `handlePivot-${side < 0 ? 'left' : 'right'}`,
      `Handle ${side < 0 ? 'left' : 'right'} hinge housing`,
      handlePivots,
      new THREE.CylinderGeometry(0.24, 0.24, 0.22, 16), creamDark,
    );
    pivot.userData.sculptComponent.id = 'handlePivots';
    pivot.rotation.z = Math.PI / 2;
    pivot.position.set(side * 2.04, 0.68, 0);
    const pivotId = `handlePivot-${side < 0 ? 'left' : 'right'}`;
    nodes[pivotId] = pivot;
    addSocket(pivotId, 'handleAxisSocket', pivot, new THREE.Vector3(0, 0, 0));
  }
  const pivotCap = group('pivotCap', 'Outer pivot caps', handlePivots, 'handlePivots');
  for (const side of [-1, 1]) {
    const cap = addMesh(`pivotCap-${side}`, `Outer pivot cap ${side}`, pivotCap, new THREE.CylinderGeometry(0.18, 0.18, 0.08, 16), cream);
    cap.userData.sculptComponent.id = 'pivotCap';
    cap.rotation.z = Math.PI / 2;
    cap.position.set(side * 2.16, 0.68, 0);
  }

  const feet = group('feet', 'Four attached support feet', enclosure, 'enclosure');
  for (const [x, z, suffix] of [[-1.72, 0.48, 'front-left'], [1.72, 0.48, 'front-right'], [-1.72, -0.48, 'rear-left'], [1.72, -0.48, 'rear-right']] as const) {
    const foot = addMesh(`foot-${suffix}`, `Cream support foot ${suffix}`, feet, new RoundedBoxGeometry(0.43, 0.34, 0.5, 3, 0.08), creamDark);
    foot.userData.sculptComponent.id = 'feet';
    foot.position.set(x, -1.45, z);
    const footId = `foot-${suffix}`;
    nodes[footId] = foot;
    addSocket(footId, 'bodyContactSocket', foot, new THREE.Vector3(0, 0.12, 0));
  }

  const speakerAssembly = group('speakerAssembly', 'Speaker recessed mounting well', frontPanel, 'frontPanel');
  speakerAssembly.position.set(-1.05, -0.05, 0.08);
  addSocket('speakerAssembly', 'grilleInset', speakerAssembly, new THREE.Vector3(0, 0, 0.11));
  addSocket('speakerAssembly', 'innerLipSocket', speakerAssembly, new THREE.Vector3(0, 0, 0.15));
  const recess = addMesh('speakerRecess', 'Speaker recessed mounting well', speakerAssembly, new THREE.CylinderGeometry(0.96, 0.96, 0.12, 48), teal);
  recess.userData.sculptComponent.id = 'speakerAssembly';
  recess.rotation.x = Math.PI / 2;
  const bezel = addMesh('speakerBezel', 'Speaker outer bezel', speakerAssembly, new THREE.TorusGeometry(0.94, 0.075, 10, 64), charcoal);
  bezel.userData.sculptComponent.id = 'speakerAssembly';
  bezel.position.z = 0.075;
  const speakerGrille = group('speakerGrille', 'Independent speaker grille panel', speakerAssembly, 'speakerAssembly');
  const grille = addMesh('speakerGrille', 'Independent speaker grille panel', speakerGrille, new THREE.CylinderGeometry(0.84, 0.84, 0.055, 48), charcoal);
  grille.rotation.x = Math.PI / 2;
  grille.position.z = 0.11;
  const speakerInnerLip = group('speakerInnerLip', 'Speaker inner lip', speakerAssembly, 'speakerAssembly');
  const innerLip = addMesh('speakerInnerLip', 'Speaker inner lip', speakerInnerLip, new THREE.TorusGeometry(0.85, 0.035, 8, 48), tealDark);
  innerLip.position.z = 0.15;

  const speakerDot = group('speakerDot', 'Speaker perforation field', speakerGrille, 'speakerGrille');
  const holeGeometry = new THREE.CylinderGeometry(0.027, 0.027, 0.024, 6);
  const holePoints: THREE.Vector3[] = [];
  for (let y = -0.72; y <= 0.72; y += 0.105) {
    for (let x = -0.72; x <= 0.72; x += 0.105) {
      if (x * x + y * y <= 0.72 * 0.72) holePoints.push(new THREE.Vector3(x, y, 0.145));
    }
  }
  const holes = new THREE.InstancedMesh(holeGeometry, dialInk, holePoints.length);
  holes.name = 'Speaker perforations';
  holes.userData.sculptComponent = { id: 'speakerDot', pass: 'form-refinement' };
  const holeMatrix = new THREE.Matrix4();
  const holeQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
  holePoints.forEach((point, index) => {
    holeMatrix.compose(point, holeQuaternion, new THREE.Vector3(1, 1, 1));
    holes.setMatrixAt(index, holeMatrix);
  });
  holes.instanceMatrix.needsUpdate = true;
  speakerDot.add(holes);
  meshes.speakerDot = holes;

  const dialAssembly = group('dialAssembly', 'Tuning window outer frame', frontPanel, 'frontPanel');
  dialAssembly.position.set(0.98, 0.42, 0.11);
  addSocket('dialAssembly', 'dialFaceInset', dialAssembly, new THREE.Vector3(0, 0, 0.075));
  addMesh('dialAssembly', 'Tuning window outer frame', dialAssembly, new RoundedBoxGeometry(1.5, 0.82, 0.12, 4, 0.11), creamDark);
  const dialFace = group('dialFace', 'Inset tuning scale panel', dialAssembly, 'dialAssembly');
  dialFace.position.z = 0.075;
  addMesh('dialFace', 'Inset tuning scale panel', dialFace, new RoundedBoxGeometry(1.3, 0.62, 0.045, 3, 0.07), cream);
  const dialMarks = group('dialMarks', 'Dial scale marks', dialFace, 'dialFace');
  const tickGeometry = new THREE.BoxGeometry(0.018, 1, 0.018);
  const ticks = new THREE.InstancedMesh(tickGeometry, dialInk, 13);
  ticks.name = 'Dial scale marks';
  ticks.userData.sculptComponent = { id: 'dialMarks', name: 'Dial scale marks', pass: 'optimization-pass' };
  ticks.userData.explodeWithParent = true;
  ticks.castShadow = options.castShadow ?? true;
  ticks.receiveShadow = options.receiveShadow ?? true;
  const tickMatrix = new THREE.Matrix4();
  for (let i = 0; i < 13; i += 1) {
    tickMatrix.compose(
      new THREE.Vector3(-0.54 + i * 0.09, 0.08, 0.045),
      new THREE.Quaternion(),
      new THREE.Vector3(1, i % 3 === 0 ? 0.18 : 0.12, 1),
    );
    ticks.setMatrixAt(i, tickMatrix);
  }
  ticks.instanceMatrix.needsUpdate = true;
  dialMarks.add(ticks);
  meshes.dialMarks = ticks;
  const dialBaseline = group('dialBaseline', 'Dial horizontal baseline', dialFace, 'dialFace');
  const baseline = addMesh('dialBaseline', 'Dial horizontal baseline', dialBaseline, new THREE.BoxGeometry(1.16, 0.018, 0.018), dialInk);
  baseline.position.set(0, -0.08, 0.045);
  const dialNeedle = group('dialNeedle', 'Red tuning needle', dialFace, 'dialFace');
  const needle = addMesh('dialNeedle', 'Red tuning needle', dialNeedle, new THREE.BoxGeometry(0.026, 0.48, 0.024), needleRed);
  needle.position.set(0.16, 0, 0.062);

  const controlKnobs = group('controlKnobs', 'Two independent rotary knobs', frontPanel, 'frontPanel');
  controlKnobs.userData.actionProfile = {
    animationRole: 'rotary-controls',
    pivot: { mode: 'per-knob-axis', axis: [0, 0, 1] },
    constraints: [{ type: 'rotation', min: -2.7, max: 2.7 }],
  };
  const knobRib = group('knobRib', 'Knob radial ribs', controlKnobs, 'controlKnobs');
  const ribGeometry = new THREE.BoxGeometry(0.025, 0.055, 0.075);
  const ribs = new THREE.InstancedMesh(ribGeometry, creamDark, 24);
  ribs.name = 'Knob radial ribs';
  ribs.userData.sculptComponent = { id: 'knobRib', name: 'Knob radial ribs', pass: 'optimization-pass' };
  ribs.userData.explodeWithParent = true;
  ribs.castShadow = options.castShadow ?? true;
  ribs.receiveShadow = options.receiveShadow ?? true;
  const ribMatrix = new THREE.Matrix4();
  const ribQuaternion = new THREE.Quaternion();
  let ribIndex = 0;
  for (const [x, label] of [[0.48, 'left'], [1.48, 'right']] as const) {
    const base = addMesh(`knob-${label}-base`, `Rotary knob ${label} mounting base`, controlKnobs, new THREE.CylinderGeometry(0.29, 0.29, 0.11, 24), charcoal);
    base.userData.sculptComponent.id = 'controlKnobs';
    base.rotation.x = Math.PI / 2;
    base.position.set(x, -0.57, 0.1);
    const knob = addMesh(`knob-${label}`, `Rotary knob ${label}`, controlKnobs, new THREE.CylinderGeometry(0.24, 0.24, 0.2, 16), creamDark);
    knob.userData.sculptComponent.id = 'controlKnobs';
    knob.rotation.x = Math.PI / 2;
    knob.position.set(x, -0.57, 0.2);
    const knobId = `controlKnob-${label}`;
    nodes[knobId] = knob;
    addSocket(knobId, 'knobAxisSocket', knob, new THREE.Vector3(0, 0, 0));
    for (let i = 0; i < 12; i += 1) {
      const angle = i * Math.PI * 2 / 12;
      ribQuaternion.setFromEuler(new THREE.Euler(0, 0, angle - Math.PI / 2));
      ribMatrix.compose(
        new THREE.Vector3(x + Math.cos(angle) * 0.235, -0.57 + Math.sin(angle) * 0.235, 0.31),
        ribQuaternion,
        new THREE.Vector3(1, 1, 1),
      );
      ribs.setMatrixAt(ribIndex, ribMatrix);
      ribIndex += 1;
    }
  }
  ribs.instanceMatrix.needsUpdate = true;
  knobRib.add(ribs);
  meshes.knobRib = ribs;

  const topShellSeam = group('topShellSeam', 'Top shell seam', enclosure, 'enclosure');
  const seam = addMesh('topShellSeam', 'Top shell seam', topShellSeam, new THREE.BoxGeometry(3.7, 0.022, 0.025), tealDark);
  seam.position.set(0, 1.18, 0.857);

  const detailIds = new Set([
    'topShellSeam', 'speakerInnerLip', 'speakerDot', 'dialMarks',
    'dialNeedle', 'knobRib', 'pivotCap', 'dialBaseline',
  ]);
  for (const id of detailIds) {
    if (nodes[id]) nodes[id].userData.explodeWithParent = true;
  }
  colliders.handle = { type: 'box', offset: [0, 1.2, 0], scale: [4.25, 1.5, 0.34] };
  colliders.feet = { type: 'compound-box', count: 4, scale: [0.43, 0.34, 0.5] };
  colliders.speakerAssembly = { type: 'cylinder', radius: 0.96, depth: 0.24, axis: 'z' };
  colliders.dialAssembly = { type: 'box', scale: [1.5, 0.82, 0.18] };
  colliders.controlKnobs = { type: 'compound-cylinder', count: 2, radius: 0.29, depth: 0.31, axis: 'z' };
  destructionGroups.body = [enclosure];
  destructionGroups.carry = [handle, handlePivots];
  destructionGroups.supports = [feet];
  destructionGroups.frontPanel = [frontPanel];
  destructionGroups.speaker = [speakerAssembly, speakerGrille];
  destructionGroups.dial = [dialAssembly];
  destructionGroups.controls = [controlKnobs];

  const parts = Object.fromEntries(
    Object.entries(nodes).filter(([id]) => id !== 'root'),
  ) as Record<string, THREE.Object3D>;
  const explodeVectors: Record<string, THREE.Vector3> = {
    handle: new THREE.Vector3(0, 0.72, -0.08),
    handlePivots: new THREE.Vector3(0, 0.08, -0.12),
    frontPanel: new THREE.Vector3(0, 0, 0.55),
    feet: new THREE.Vector3(0, -0.48, 0),
    speakerAssembly: new THREE.Vector3(-0.52, 0, 0.42),
    speakerGrille: new THREE.Vector3(0, 0, 0.30),
    dialAssembly: new THREE.Vector3(0.45, 0.12, 0.42),
    controlKnobs: new THREE.Vector3(0.45, -0.18, 0.46),
  };
  const assembledPositions = new Map<string, THREE.Vector3>();
  for (const [id, node] of Object.entries(parts)) assembledPositions.set(id, node.position.clone());
  const setExplode = (amount: number) => {
    const t = THREE.MathUtils.clamp(amount, 0, 1);
    for (const [id, vector] of Object.entries(explodeVectors)) {
      const node = parts[id];
      const base = assembledPositions.get(id);
      if (node && base) node.position.copy(base).addScaledVector(vector, t);
    }
  };

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups, parts, setExplode } satisfies ProceduralModelRuntime;
  root.userData.pass = 'optimization-pass';
  root.userData.optimizationEvidence = {
    targetTriangles: 45000,
    maxDrawCalls: 55,
    repeatedGeometry: {
      speakerPerforations: 'InstancedMesh',
      dialMarks: 'InstancedMesh',
      knobRibs: 'InstancedMesh',
    },
    preserved: ['silhouette', 'component hierarchy', 'materials', 'lighting', 'interaction'],
  };
  root.userData.interactionEvidence = {
    selectablePartCount: Object.keys(parts).length,
    explodablePartIds: Object.keys(explodeVectors),
    surfaceDetailsRideParent: [...detailIds],
    stableTransformNodes: ['handle', 'controlKnob-left', 'controlKnob-right'],
    colliderIds: Object.keys(colliders),
    destructionGroupIds: Object.keys(destructionGroups),
  };
  root.userData.materialEvidence = {
    mapResolution: 1024,
    channels: ['albedo', 'roughness', 'normal', 'ambient-occlusion'],
    independentChannels: true,
    dielectric: true,
    tealPlastic: { confidence: 0.831, roughnessBase: 0.64 },
    ivoryPlastic: { confidence: 0.77, roughnessBase: 0.68 },
    charcoalPlastic: { confidence: 0.86, roughnessBase: 0.693 },
  };
  root.userData.surfaceEvidence = {
    status: 'implemented',
    silhouetteNeutral: true,
    moldedPlastic: { normalMaps: true, roughnessMaps: true, aoMaps: true },
    cavityResponse: ['speakerDot', 'speakerGrille', 'dialAssembly', 'topShellSeam'],
    tactileRelief: ['enclosure', 'handle', 'controlKnobs', 'knobRib'],
    resolvedDeferredFeature: 'dialNeedle red painted finish',
  };
  root.userData.lightingEvidence = {
    key: { color: '#fff7e8', intensity: 2.4, position: [-4.5, 7.5, 5.0] },
    fill: { color: '#dfeaff', intensity: 0.65, position: [4.0, 3.0, 3.5] },
    environment: { color: '#ffffff', intensity: 0.75 },
    exposure: 1.05,
    toneMapping: 'ACESFilmicToneMapping',
    background: '#d8dadd',
    contactShadow: { ground: '#cdd0d3', enabled: true },
  };
  return root;
}

export function createVintagePortableRadioLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Vintage Portable Radio look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xffffff : 0xf2f4ff,
    0x4d5155,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.75 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xfff7e8 : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.4 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xdfeaff, mode === 'grazing' ? 0.12 : mode === 'reference' ? 0.65 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.25);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = [{"type": "key light", "direction": [-0.6, 1.0, 0.8], "color": "#fff7e8", "intensity": 2.4, "notes": "large soft studio key from upper front-left"}, {"type": "fill light", "direction": [0.8, 0.4, 0.5], "color": "#dfeaff", "intensity": 0.65, "notes": "cooler right-side fill"}, {"type": "environment light", "color": "#ffffff", "intensity": 0.75, "notes": "neutral ambient environment"}, {"type": "contact shadow", "color": "#4d5155", "intensity": 0.35, "notes": "soft shadow on light-grey ground"}, {"type": "exposure", "value": 1.05, "notes": "neutral browser exposure with preserved ivory highlights"}, {"type": "tone mapping", "value": "ACESFilmicToneMapping", "notes": "moderate contrast without clipping the cream handle"}, {"type": "background", "color": "#d8dadd", "notes": "uniform light grey with a slightly darker ground plane"}];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity within a low-cost browser budget", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 512, "preferredTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image inference"}}, "lightingPass": {"requiredTerms": ["key light", "fill light", "environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "missing contact shadow"]}};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createVintagePortableRadioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameVintagePortableRadioCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createVintagePortableRadioPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureVintagePortableRadioRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createVintagePortableRadioInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
