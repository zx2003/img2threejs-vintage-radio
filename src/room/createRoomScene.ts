import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export type InteractiveKind = 'door' | 'chair' | 'drawer' | 'lamp';

export interface RoomRuntime {
  root: THREE.Group;
  interactiveMeshes: THREE.Object3D[];
  interactiveRoots: Map<string, THREE.Object3D>;
  doorPivot: THREE.Group;
  drawer: THREE.Group;
  chair: THREE.Group;
  lampLight: THREE.PointLight;
  lampBulb: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  chairBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

const palette = {
  wall: 0xf3e6cc,
  wallTrim: 0xfff4dc,
  floor: 0xc99358,
  floorAlt: 0xd7a56a,
  wood: 0xa9642f,
  lightWood: 0xc88745,
  woodDark: 0x744124,
  cream: 0xf4ead8,
  creamShadow: 0xdccdb7,
  charcoal: 0x30312f,
  metal: 0x574b40,
  brass: 0xb88b52,
  rug: 0x74685e,
  rugLight: 0xe8dcc8,
  foliage: 0x536f2d,
  foliageDark: 0x365220,
  ceramic: 0xd5b188,
};

function material(
  color: THREE.ColorRepresentation,
  roughness = 0.72,
  metalness = 0,
  extra: Partial<THREE.MeshStandardMaterialParameters> = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}

function box(
  parent: THREE.Object3D,
  name: string,
  size: [number, number, number],
  position: [number, number, number],
  surface: THREE.Material,
  bevel = 0,
): THREE.Mesh {
  const geometry = bevel > 0
    ? new RoundedBoxGeometry(size[0], size[1], size[2], 2, bevel)
    : new THREE.BoxGeometry(...size);
  const mesh = new THREE.Mesh(geometry, surface);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function cylinder(
  parent: THREE.Object3D,
  name: string,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  position: [number, number, number],
  surface: THREE.Material,
  segments = 12,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments),
    surface,
  );
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function markInteractive(
  root: THREE.Object3D,
  kind: InteractiveKind,
  objectId: string,
  interactiveMeshes: THREE.Object3D[],
  interactiveRoots: Map<string, THREE.Object3D>,
): void {
  root.userData.interactiveType = kind;
  root.userData.objectId = objectId;
  interactiveRoots.set(objectId, root);
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.userData.interactiveType = kind;
    node.userData.objectId = objectId;
    node.material = Array.isArray(node.material)
      ? node.material.map((entry) => entry.clone())
      : node.material.clone();
    interactiveMeshes.push(node);
  });
}

function createRugTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create rug texture');
  context.fillStyle = '#75695f';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#eadfca';
  context.lineWidth = 12;
  for (let row = -1; row < 5; row += 1) {
    for (let column = -1; column < 5; column += 1) {
      const x = column * 128 + (row % 2) * 64;
      const y = row * 128;
      context.beginPath();
      context.moveTo(x + 64, y + 8);
      context.lineTo(x + 120, y + 64);
      context.lineTo(x + 64, y + 120);
      context.lineTo(x + 8, y + 64);
      context.closePath();
      context.stroke();
      context.beginPath();
      context.moveTo(x + 64, y + 34);
      context.lineTo(x + 94, y + 64);
      context.lineTo(x + 64, y + 94);
      context.lineTo(x + 34, y + 64);
      context.closePath();
      context.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.4, 1.6);
  texture.anisotropy = 8;
  return texture;
}

function createArchitecture(parent: THREE.Group): void {
  const wallMaterial = material(palette.wall, 0.94);
  const trimMaterial = material(palette.wallTrim, 0.82);
  const floorMaterials = [material(palette.floor, 0.67), material(palette.floorAlt, 0.7)];
  box(parent, 'Floor slab', [10.4, 0.3, 9.4], [0, 0, 0], material(palette.woodDark, 0.72), 0.04);

  const boardGeometry = new THREE.BoxGeometry(0.57, 0.08, 9);
  for (let index = 0; index < 18; index += 1) {
    const board = new THREE.Mesh(boardGeometry, floorMaterials[index % floorMaterials.length]);
    board.name = `Floor board ${index + 1}`;
    board.position.set(-4.845 + index * 0.57, 0.19, 0);
    board.castShadow = true;
    board.receiveShadow = true;
    parent.add(board);
  }

  box(parent, 'Rear wall', [10.4, 5.25, 0.24], [0, 2.72, -4.58], wallMaterial);
  box(parent, 'Left wall', [0.24, 5.25, 9.4], [-5.08, 2.72, 0], wallMaterial);
  box(parent, 'Rear baseboard', [10.1, 0.28, 0.13], [0, 0.43, -4.38], trimMaterial, 0.035);
  box(parent, 'Left baseboard', [0.13, 0.28, 9.1], [-4.88, 0.43, 0], trimMaterial, 0.035);
  box(parent, 'Rear wall cap', [10.55, 0.18, 0.38], [0, 5.38, -4.58], trimMaterial, 0.05);
  box(parent, 'Left wall cap', [0.38, 0.18, 9.55], [-5.08, 5.38, 0], trimMaterial, 0.05);
}

function createDoor(
  parent: THREE.Group,
  interactiveMeshes: THREE.Object3D[],
  interactiveRoots: Map<string, THREE.Object3D>,
): THREE.Group {
  const wood = material(palette.wood, 0.58);
  const lightWood = material(palette.lightWood, 0.62);
  const metal = material(0xb9a68c, 0.34, 0.65);
  const frame = new THREE.Group();
  frame.name = 'Door frame';
  frame.position.set(-4.9, 0.25, -0.75);
  parent.add(frame);
  box(frame, 'Door frame upright A', [0.32, 4.1, 0.24], [0, 2.05, -0.18], lightWood, 0.04);
  box(frame, 'Door frame upright B', [0.32, 4.1, 0.24], [0, 2.05, 2.2], lightWood, 0.04);
  box(frame, 'Door frame lintel', [0.32, 0.28, 2.65], [0, 4.0, 1.02], lightWood, 0.04);

  const pivot = new THREE.Group();
  pivot.name = 'Door hinge pivot';
  pivot.position.set(-4.72, 0.28, -0.65);
  pivot.userData.objectId = 'room-door';
  parent.add(pivot);
  const panel = box(pivot, 'Interactive door panel', [0.18, 3.75, 2.12], [0, 1.88, 1.06], wood, 0.045);
  box(pivot, 'Door upper inset', [0.09, 1.25, 1.55], [0.11, 2.72, 1.06], lightWood, 0.025);
  box(pivot, 'Door lower inset', [0.09, 1.35, 1.55], [0.11, 1.15, 1.06], lightWood, 0.025);
  const handle = cylinder(pivot, 'Door handle hub', 0.1, 0.1, 0.16, [0.2, 1.92, 1.75], metal, 12);
  handle.rotation.z = Math.PI / 2;
  const lever = cylinder(pivot, 'Door lever', 0.045, 0.045, 0.5, [0.31, 1.92, 1.55], metal, 10);
  lever.rotation.x = Math.PI / 2;
  panel.userData.hingeSide = 'frame-left';
  markInteractive(pivot, 'door', 'room-door', interactiveMeshes, interactiveRoots);
  return pivot;
}

function createDesk(
  parent: THREE.Group,
  interactiveMeshes: THREE.Object3D[],
  interactiveRoots: Map<string, THREE.Object3D>,
): { drawer: THREE.Group; lampLight: THREE.PointLight; lampBulb: RoomRuntime['lampBulb'] } {
  const desk = new THREE.Group();
  desk.name = 'Study desk assembly';
  parent.add(desk);
  const wood = material(palette.wood, 0.58);
  const lightWood = material(palette.lightWood, 0.64);
  const page = material(0xfff8e8, 0.95);
  const ink = material(0x655647, 0.8);
  box(desk, 'Desk top', [4.2, 0.22, 1.65], [-2.45, 2.08, -3.45], lightWood, 0.06);
  box(desk, 'Desk left pedestal', [1.1, 1.95, 1.45], [-3.85, 1.08, -3.48], wood, 0.04);
  box(desk, 'Desk right side panel', [0.22, 1.95, 1.45], [-0.48, 1.08, -3.48], wood, 0.035);
  box(desk, 'Desk modesty panel', [3.25, 1.3, 0.18], [-2.05, 1.23, -4.05], wood, 0.03);
  for (let index = 0; index < 2; index += 1) {
    box(desk, `Static drawer ${index + 1}`, [0.91, 0.46, 0.12], [-3.85, 0.74 + index * 0.53, -2.72], lightWood, 0.025);
    const knob = cylinder(desk, `Static drawer knob ${index + 1}`, 0.055, 0.055, 0.09, [-3.85, 0.74 + index * 0.53, -2.62], material(palette.metal, 0.45, 0.3), 10);
    knob.rotation.x = Math.PI / 2;
  }

  const drawer = new THREE.Group();
  drawer.name = 'Interactive desk drawer';
  drawer.position.set(-3.85, 1.8, -2.72);
  parent.add(drawer);
  box(drawer, 'Drawer box', [0.92, 0.42, 1.18], [0, 0, -0.52], wood, 0.025);
  box(drawer, 'Drawer front', [0.98, 0.48, 0.12], [0, 0, 0.04], lightWood, 0.025);
  const drawerKnob = cylinder(drawer, 'Drawer pull', 0.06, 0.06, 0.1, [0, 0, 0.14], material(palette.metal, 0.4, 0.35), 10);
  drawerKnob.rotation.x = Math.PI / 2;
  markInteractive(drawer, 'drawer', 'desk-drawer', interactiveMeshes, interactiveRoots);

  const book = new THREE.Group();
  book.name = 'Open book';
  book.position.set(-2.2, 2.27, -3.08);
  parent.add(book);
  const leftPage = box(book, 'Open book left page', [0.72, 0.035, 0.58], [-0.37, 0, 0], page, 0.02);
  leftPage.rotation.y = -0.12;
  const rightPage = box(book, 'Open book right page', [0.72, 0.035, 0.58], [0.37, 0, 0], page, 0.02);
  rightPage.rotation.y = 0.12;
  for (const side of [-1, 1]) {
    for (let line = 0; line < 3; line += 1) {
      box(book, 'Book line', [0.38, 0.008, 0.012], [side * 0.36, 0.027, -0.16 + line * 0.14], ink);
    }
  }

  const lamp = new THREE.Group();
  lamp.name = 'Interactive task lamp';
  lamp.position.set(-3.35, 2.2, -3.25);
  parent.add(lamp);
  const lampMetal = material(palette.metal, 0.38, 0.48);
  cylinder(lamp, 'Lamp base', 0.28, 0.34, 0.08, [0, 0, 0], lampMetal, 16);
  const stem = cylinder(lamp, 'Lamp stem', 0.045, 0.045, 0.92, [0, 0.48, 0], lampMetal, 10);
  stem.rotation.z = -0.08;
  const arm = cylinder(lamp, 'Lamp angled arm', 0.04, 0.04, 0.72, [0.17, 1.0, 0], lampMetal, 10);
  arm.rotation.z = -0.62;
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.42, 14, 1, true), lampMetal.clone());
  shade.name = 'Lamp shade';
  shade.position.set(0.39, 1.27, 0);
  shade.rotation.z = -0.35;
  shade.castShadow = true;
  lamp.add(shade);
  const bulbMaterial = material(0xffd18a, 0.25, 0, { emissive: 0xffb347, emissiveIntensity: 0.05 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), bulbMaterial);
  bulb.name = 'Lamp bulb';
  bulb.position.set(0.47, 1.16, 0);
  lamp.add(bulb);
  const lampLight = new THREE.PointLight(0xffbd68, 0, 5.5, 2);
  lampLight.name = 'Toggleable desk lamp light';
  lampLight.position.set(0.5, 1.08, 0.08);
  lampLight.castShadow = true;
  lampLight.shadow.mapSize.set(512, 512);
  lamp.add(lampLight);
  markInteractive(lamp, 'lamp', 'desk-lamp', interactiveMeshes, interactiveRoots);
  return { drawer, lampLight, lampBulb: bulb };
}

function createChair(
  parent: THREE.Group,
  interactiveMeshes: THREE.Object3D[],
  interactiveRoots: Map<string, THREE.Object3D>,
): THREE.Group {
  const chair = new THREE.Group();
  chair.name = 'Draggable office chair';
  chair.position.set(-1.35, 0.25, -1.45);
  chair.rotation.y = Math.PI;
  parent.add(chair);
  const dark = material(palette.charcoal, 0.7);
  const metal = material(0x242523, 0.48, 0.25);
  const seat = box(chair, 'Chair seat', [1.12, 0.22, 1.05], [0, 0.92, 0], dark, 0.18);
  seat.rotation.y = -0.08;
  const back = box(chair, 'Chair curved back', [1.08, 1.35, 0.18], [0, 1.67, -0.5], dark, 0.18);
  back.rotation.x = -0.12;
  cylinder(chair, 'Chair center post', 0.08, 0.09, 0.65, [0, 0.58, 0], metal, 10);
  cylinder(chair, 'Chair lift collar', 0.18, 0.18, 0.16, [0, 0.4, 0], metal, 10);
  const armGeometry = new THREE.BoxGeometry(0.75, 0.08, 0.12);
  const casterGeometry = new THREE.CylinderGeometry(0.09, 0.09, 0.08, 10);
  for (let index = 0; index < 5; index += 1) {
    const angle = (index / 5) * Math.PI * 2;
    const arm = new THREE.Mesh(armGeometry, metal);
    arm.name = `Chair caster arm ${index + 1}`;
    arm.position.set(Math.cos(angle) * 0.34, 0.28, Math.sin(angle) * 0.34);
    arm.rotation.y = -angle;
    arm.castShadow = true;
    chair.add(arm);
    const caster = new THREE.Mesh(casterGeometry, dark);
    caster.name = `Chair caster ${index + 1}`;
    caster.position.set(Math.cos(angle) * 0.72, 0.2, Math.sin(angle) * 0.72);
    caster.rotation.z = Math.PI / 2;
    caster.castShadow = true;
    chair.add(caster);
  }
  markInteractive(chair, 'chair', 'office-chair', interactiveMeshes, interactiveRoots);
  return chair;
}

function createBookshelf(parent: THREE.Group): void {
  const shelf = new THREE.Group();
  shelf.name = 'Corner bookshelf';
  parent.add(shelf);
  const wood = material(palette.lightWood, 0.6);
  const woodDark = material(palette.woodDark, 0.65);
  const bookMaterials = [
    material(0x7e4d35, 0.82), material(0x50605a, 0.82), material(0xd0aa6a, 0.82),
    material(0x8c6a4f, 0.82), material(0x6f7660, 0.82),
  ];
  box(shelf, 'Shelf left rail', [0.18, 4.65, 1.18], [-0.18, 2.55, -3.82], wood, 0.035);
  box(shelf, 'Shelf right rail', [0.18, 4.65, 1.18], [2.02, 2.55, -3.82], wood, 0.035);
  for (let level = 0; level < 5; level += 1) {
    const y = 0.48 + level * 1.0;
    box(shelf, `Shelf board ${level + 1}`, [2.25, 0.14, 1.2], [0.92, y, -3.82], wood, 0.025);
    const count = level === 4 ? 3 : 4;
    for (let index = 0; index < count; index += 1) {
      const width = 0.16 + ((index + level) % 3) * 0.035;
      const height = 0.48 + ((index * 2 + level) % 3) * 0.09;
      const book = box(
        shelf,
        `Shelf book ${level + 1}-${index + 1}`,
        [width, height, 0.62],
        [0.2 + index * 0.28, y + height / 2 + 0.08, -3.7],
        bookMaterials[(index + level) % bookMaterials.length],
        0.015,
      );
      book.rotation.z = ((index + level) % 2 ? 1 : -1) * 0.04;
    }
  }
  box(shelf, 'Shelf top photo frame', [0.55, 0.62, 0.09], [0.45, 5.15, -3.75], woodDark, 0.025).rotation.z = -0.08;
  box(shelf, 'Shelf top photo inset', [0.4, 0.47, 0.03], [0.45, 5.15, -3.69], material(palette.cream, 0.9));
  for (let index = 0; index < 4; index += 1) {
    const ornament = new THREE.Mesh(
      index % 2 ? new THREE.SphereGeometry(0.11, 10, 7) : new THREE.ConeGeometry(0.12, 0.28, 8),
      material(index % 2 ? palette.ceramic : palette.brass, 0.62, index % 2 ? 0 : 0.25),
    );
    ornament.name = `Shelf ornament ${index + 1}`;
    ornament.position.set(1.55 - (index % 2) * 0.35, 1.65 + Math.floor(index / 2) * 2.0, -3.55);
    ornament.castShadow = true;
    shelf.add(ornament);
  }
}

function createBed(parent: THREE.Group): void {
  const bed = new THREE.Group();
  bed.name = 'Wood bed assembly';
  parent.add(bed);
  const wood = material(palette.lightWood, 0.58);
  const woodDark = material(palette.wood, 0.62);
  const cream = material(palette.cream, 0.9);
  const creamShadow = material(palette.creamShadow, 0.9);
  const rugMaterial = material(palette.rug, 0.96, 0, { map: createRugTexture() });
  box(bed, 'Geometric rug', [5.0, 0.08, 5.6], [2.2, 0.27, 1.45], rugMaterial, 0.04);
  box(bed, 'Bed left rail', [0.22, 0.62, 5.45], [0.25, 0.72, 1.2], woodDark, 0.045);
  box(bed, 'Bed right rail', [0.22, 0.62, 5.45], [4.35, 0.72, 1.2], woodDark, 0.045);
  box(bed, 'Bed footboard', [4.3, 0.95, 0.24], [2.3, 0.78, 3.92], wood, 0.055);
  box(bed, 'Bed headboard', [4.3, 2.05, 0.26], [2.3, 1.35, -1.5], wood, 0.07);
  box(bed, 'Headboard inset', [3.8, 1.28, 0.12], [2.3, 1.48, -1.32], material(0xd99e59, 0.64), 0.05);
  for (const x of [0.45, 4.15]) {
    for (const z of [-1.22, 3.72]) box(bed, 'Bed leg', [0.28, 0.75, 0.28], [x, 0.48, z], woodDark, 0.04);
  }
  box(bed, 'Mattress', [3.82, 0.5, 5.0], [2.3, 1.13, 1.2], cream, 0.18);
  box(bed, 'Duvet', [3.88, 0.3, 3.75], [2.3, 1.52, 1.72], cream, 0.18);
  box(bed, 'Duvet fold band', [3.92, 0.2, 0.48], [2.3, 1.64, -0.05], creamShadow, 0.08);
  const pillowA = box(bed, 'Pillow left', [1.55, 0.36, 1.0], [1.58, 1.68, -0.62], cream, 0.19);
  pillowA.rotation.y = -0.1;
  pillowA.rotation.z = -0.08;
  const pillowB = box(bed, 'Pillow right', [1.55, 0.34, 1.0], [3.02, 1.66, -0.68], material(0xe5e0d8, 0.9), 0.19);
  pillowB.rotation.y = 0.1;
  pillowB.rotation.z = 0.07;
  const accent = box(bed, 'Accent pillow', [0.95, 0.38, 0.82], [2.35, 1.92, -0.4], material(0xd1b892, 0.88), 0.16);
  accent.rotation.y = -0.18;
}

function createWallDecor(parent: THREE.Group): void {
  const frameMaterial = material(palette.lightWood, 0.58);
  const paperMaterial = material(0xf8f0df, 0.95);
  const charcoal = material(palette.charcoal, 0.74);
  const clock = new THREE.Group();
  clock.name = 'Wall clock';
  clock.position.set(-2.25, 3.78, -4.39);
  parent.add(clock);
  const rim = cylinder(clock, 'Clock rim', 0.43, 0.43, 0.12, [0, 0, 0], material(palette.woodDark, 0.58), 18);
  rim.rotation.x = Math.PI / 2;
  const face = cylinder(clock, 'Clock face', 0.36, 0.36, 0.13, [0, 0, 0.04], paperMaterial, 18);
  face.rotation.x = Math.PI / 2;
  const minuteHand = box(clock, 'Clock minute hand', [0.035, 0.28, 0.03], [0.05, 0.09, 0.12], charcoal, 0.01);
  minuteHand.rotation.z = -0.45;
  const hourHand = box(clock, 'Clock hour hand', [0.03, 0.2, 0.035], [-0.04, 0.05, 0.13], charcoal, 0.01);
  hourHand.rotation.z = 0.65;

  const artColors = [0xd69b4d, 0x9d724f, 0x4f4941];
  const artPositions = [2.7, 4.0];
  artPositions.forEach((x, index) => {
    const art = new THREE.Group();
    art.name = `Geometric wall artwork ${index + 1}`;
    art.position.set(x, 3.5, -4.37);
    parent.add(art);
    box(art, 'Artwork frame', [1.0, 1.55, 0.12], [0, 0, 0], frameMaterial, 0.035);
    box(art, 'Artwork paper', [0.78, 1.3, 0.035], [0, 0, 0.09], paperMaterial, 0.015);
    const triangleShape = new THREE.Shape();
    triangleShape.moveTo(-0.31, -0.48);
    triangleShape.lineTo(0.31, index ? -0.1 : 0.5);
    triangleShape.lineTo(0.31, -0.48);
    triangleShape.closePath();
    const triangle = new THREE.Mesh(new THREE.ShapeGeometry(triangleShape), material(artColors[index], 0.82));
    triangle.name = 'Artwork geometric inset';
    triangle.position.z = 0.12;
    art.add(triangle);
    const smallShape = new THREE.Shape();
    smallShape.moveTo(-0.25, 0.44);
    smallShape.lineTo(0.27, 0.18);
    smallShape.lineTo(-0.25, -0.05);
    smallShape.closePath();
    const small = new THREE.Mesh(new THREE.ShapeGeometry(smallShape), material(artColors[index + 1], 0.82));
    small.name = 'Artwork secondary inset';
    small.position.z = 0.125;
    art.add(small);
  });

  const smallPrint = new THREE.Group();
  smallPrint.position.set(-3.25, 3.42, -4.38);
  parent.add(smallPrint);
  box(smallPrint, 'Small print frame', [0.72, 1.0, 0.11], [0, 0, 0], frameMaterial, 0.03);
  box(smallPrint, 'Small print paper', [0.5, 0.76, 0.03], [0, 0, 0.08], paperMaterial, 0.015);
  box(smallPrint, 'Small print inset', [0.3, 0.48, 0.025], [0, 0, 0.11], material(0xe2c89f, 0.85), 0.01);
}

function createPlant(parent: THREE.Group, position: [number, number, number], scale: number, name: string): void {
  const plant = new THREE.Group();
  plant.name = name;
  plant.position.set(...position);
  plant.scale.setScalar(scale);
  parent.add(plant);
  const pot = cylinder(plant, `${name} pot`, 0.28, 0.22, 0.46, [0, 0.23, 0], material(palette.ceramic, 0.72), 12);
  pot.castShadow = true;
  cylinder(plant, `${name} soil`, 0.245, 0.245, 0.04, [0, 0.47, 0], material(0x4e3826, 0.98), 12);
  const stemMaterial = material(0x4b6529, 0.86);
  const leafMaterials = [material(palette.foliage, 0.82), material(palette.foliageDark, 0.84)];
  const leafGeometry = new THREE.ConeGeometry(0.13, 0.65, 5);
  for (let index = 0; index < 4; index += 1) {
    const y = 0.55 + index * 0.33;
    cylinder(plant, `${name} stem ${index + 1}`, 0.025, 0.035, 0.7, [0, y, 0], stemMaterial, 7);
    for (let side = 0; side < 3; side += 1) {
      const angle = side * (Math.PI * 2 / 3) + index * 0.7;
      const leaf = new THREE.Mesh(leafGeometry, leafMaterials[(index + side) % 2]);
      leaf.name = `${name} leaf ${index + 1}-${side + 1}`;
      leaf.position.set(Math.cos(angle) * 0.22, y + 0.18, Math.sin(angle) * 0.22);
      leaf.rotation.z = Math.PI / 2.7;
      leaf.rotation.y = -angle;
      leaf.castShadow = true;
      plant.add(leaf);
    }
  }
}

export function createRoomScene(): RoomRuntime {
  const root = new THREE.Group();
  root.name = 'Warm Low-Poly Bedroom Study Diorama';
  root.userData.objectId = 'room-root';
  const interactiveMeshes: THREE.Object3D[] = [];
  const interactiveRoots = new Map<string, THREE.Object3D>();
  createArchitecture(root);
  const doorPivot = createDoor(root, interactiveMeshes, interactiveRoots);
  const { drawer, lampLight, lampBulb } = createDesk(root, interactiveMeshes, interactiveRoots);
  const chair = createChair(root, interactiveMeshes, interactiveRoots);
  createBookshelf(root);
  createBed(root);
  createWallDecor(root);
  createPlant(root, [-4.25, 0.27, 3.35], 1.05, 'Corner floor plant');
  createPlant(root, [-1.55, 2.2, -3.25], 0.48, 'Desk plant one');
  createPlant(root, [-0.95, 2.2, -3.32], 0.42, 'Desk plant two');

  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.castShadow = true;
    node.receiveShadow = true;
  });

  return {
    root,
    interactiveMeshes,
    interactiveRoots,
    doorPivot,
    drawer,
    chair,
    lampLight,
    lampBulb,
    chairBounds: { minX: -3.7, maxX: 3.8, minZ: -2.35, maxZ: 3.45 },
  };
}
