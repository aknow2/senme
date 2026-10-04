import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { createImageSampler, type ImageSampler } from './src/lithophane/imageSampler';
import { validateClosedSolid } from './src/lithophane/meshTopology';
import {
  createLithophaneTileGeometry,
  type TileOutlineVertex,
} from './lithophaneTile';
import {
  findSpiralTileByIndex,
  generateSpiralTileDescriptors,
  jointClearanceToTileInset,
  MIN_FRAGMENT_AREA_RATIO,
  spiralTileFileName,
  textureSourceSpiralIndex,
  type SpiralTileDescriptor,
} from './spiralTiles';
import {
  compactPanelFileName,
  partitionSpiralTilesByPieceCount,
  type SphericalPanelGroup,
} from './panelPartition';
import {
  collectPanelBoundaryEdges,
  type PanelBoundaryEdge,
} from './panelBoundary';
import {
  createSphericalPanelGeometry,
  MINIMUM_PANEL_GROOVE_DEPTH_MM,
} from './sphericalPanel';
import {
  clearStoredTextureRecords,
  deleteStoredTextureRecord,
  loadPolyhedronSettings,
  loadStoredTextureRecords,
  normalizePolyhedronSettings,
  replaceStoredTextureRecords,
  savePolyhedronSettings,
  saveStoredTextureRecords,
  type PersistedPolyhedronSettings,
  type StoredTextureRecord,
} from './persistence';
import { createBackupZip, readBackupZip, type BackupTexture } from './backupArchive';
import './styles.css';

type PolyhedronSettings = PersistedPolyhedronSettings;

type TextureEntry = {
  id: number;
  name: string;
  bitmap: ImageBitmap;
  blob: Blob;
};

type SurfaceBuffers = {
  positions: number[];
  uvs: number[];
  indices: number[];
};

type PolyhedronGeometry = {
  solid: THREE.BufferGeometry;
  surfaces: [THREE.BufferGeometry, THREE.BufferGeometry];
  tileCount: number;
  descriptors: SpiralTileDescriptor[];
  exportTiles: SpiralTileDescriptor[];
};

type WritableFileLike = {
  write(data: Uint8Array | string): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
};

type FileHandleLike = {
  createWritable(): Promise<WritableFileLike>;
};

type DirectoryHandleLike = {
  getFileHandle(name: string, options: { create: true }): Promise<FileHandleLike>;
  getDirectoryHandle(name: string, options: { create: true }): Promise<DirectoryHandleLike>;
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
  }) => Promise<DirectoryHandleLike>;
};

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required element was not found: ${selector}`);
  return element;
}

const canvas = requiredElement<HTMLCanvasElement>('#scene');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x10100f, 0.001);

const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 6000);
camera.position.set(600, 330, 726);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.enablePan = false;
controls.minDistance = 570;
controls.maxDistance = 1650;
controls.target.set(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xe9f4ff, 0x31251b, 1.35));

const keyLight = new THREE.DirectionalLight(0xfff1d6, 5.2);
keyLight.position.set(55, 72, 52);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = -65;
keyLight.shadow.camera.right = 65;
keyLight.shadow.camera.top = 65;
keyLight.shadow.camera.bottom = -65;
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x6b8cff, 3.4);
rimLight.position.set(-55, 8, -48);
scene.add(rimLight);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(1, 72),
  new THREE.MeshStandardMaterial({ color: 0x11110f, roughness: 0.96, metalness: 0 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -387;
floor.receiveShadow = true;
scene.add(floor);

const sphereGroup = new THREE.Group();
scene.add(sphereGroup);

const material = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.58,
  metalness: 0.12,
  flatShading: true,
  side: THREE.DoubleSide,
});

function createTextureMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.72,
    metalness: 0.02,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

const textureMaterials: [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial] = [
  createTextureMaterial(),
  createTextureMaterial(),
];

const panelBoundaryMaterial = new THREE.MeshBasicMaterial({
  color: 0xff2020,
  transparent: true,
  opacity: 0.95,
  side: THREE.DoubleSide,
  depthTest: true,
  depthWrite: false,
  toneMapped: false,
  blending: THREE.AdditiveBlending,
});

const panelHighlightMaterial = new THREE.MeshBasicMaterial({
  color: 0x25e85f,
  side: THREE.DoubleSide,
  depthTest: true,
  depthWrite: false,
  toneMapped: false,
});

function localSettingsStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const settingsStorage = localSettingsStorage();
const settings: PolyhedronSettings = loadPolyhedronSettings(settingsStorage);

let polyhedron: THREE.Mesh | null = null;
let textureSurfaces: [THREE.Mesh | null, THREE.Mesh | null] = [null, null];
let panelBoundaryPreview: THREE.Mesh | null = null;
const atlasTextures: [THREE.Texture | null, THREE.Texture | null] = [null, null];
const spiralTextures: [TextureEntry[], TextureEntry[]] = [[], []];
let nextTextureId = 1;
let autoRotate = settings.autoRotate;
let rebuildFrame = 0;
let sceneRadius = 0;
let tileDescriptors: SpiralTileDescriptor[] = [];
let tileHighlight: THREE.Group | null = null;

function currentTextureCounts(): [number, number] {
  return [spiralTextures[0].length, spiralTextures[1].length];
}

function texturesForSpiral(spiralIndex: 0 | 1): TextureEntry[] {
  const source = textureSourceSpiralIndex(currentTextureCounts(), spiralIndex);
  return source === null ? [] : spiralTextures[source];
}

const tileHighlightMaterial = new THREE.MeshBasicMaterial({
  color: 0xff2d2d,
  depthTest: true,
  depthWrite: false,
  toneMapped: false,
});

function disposeObjectGeometries(object: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) geometries.add(child.geometry);
  });
  geometries.forEach((geometry) => geometry.dispose());
}

function removeTileHighlight(): void {
  if (!tileHighlight) return;
  sphereGroup.remove(tileHighlight);
  disposeObjectGeometries(tileHighlight);
  tileHighlight = null;
}

function createBoundaryPreviewMesh(
  edges: readonly PanelBoundaryEdge[],
  config: PolyhedronSettings,
  previewMaterial: THREE.Material,
  radialOffsetScale = 1,
  halfWidthScale = 1,
  renderOrder = 20,
): THREE.Mesh | null {
  if (edges.length === 0) return null;

  const positions: number[] = [];
  const indices: number[] = [];
  const radialOffsetMm = Math.max(0.35, config.diameterMm * 0.001) * radialOffsetScale;
  const halfWidthMm = Math.max(0.3, config.diameterMm * 0.00075) * halfWidthScale;
  for (const { start, end } of edges) {
    const outwardStart = start.clone().setLength(start.length() + radialOffsetMm);
    const outwardEnd = end.clone().setLength(end.length() + radialOffsetMm);
    const edgeDirection = outwardEnd.clone().sub(outwardStart);
    if (edgeDirection.lengthSq() <= 1e-12) continue;
    edgeDirection.normalize();
    const startSide = new THREE.Vector3()
      .crossVectors(outwardStart.clone().normalize(), edgeDirection)
      .setLength(halfWidthMm);
    const endSide = new THREE.Vector3()
      .crossVectors(outwardEnd.clone().normalize(), edgeDirection)
      .setLength(halfWidthMm);
    const quad = [
      outwardStart.clone().add(startSide),
      outwardEnd.clone().add(endSide),
      outwardEnd.clone().sub(endSide),
      outwardStart.clone().sub(startSide),
    ];
    const offset = positions.length / 3;
    for (const point of quad) positions.push(point.x, point.y, point.z);
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  }
  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  const preview = new THREE.Mesh(geometry, previewMaterial);
  preview.renderOrder = renderOrder;
  // Preview-only overlay: it is never passed to either STL export route.
  return preview;
}

function createPanelBoundaryPreview(
  descriptors: readonly SpiralTileDescriptor[],
  config: PolyhedronSettings,
): THREE.Mesh | null {
  if (config.stlExportMode !== 'panels') return null;
  const panels = partitionSpiralTilesByPieceCount(descriptors, {
    targetPieceCount: config.panelTargetPieceCount,
  });
  return createBoundaryPreviewMesh(
    collectPanelBoundaryEdges(panels),
    config,
    panelBoundaryMaterial,
  );
}

function createPanelHighlight(
  panel: SphericalPanelGroup,
  config: PolyhedronSettings,
): THREE.Group | null {
  const preview = createBoundaryPreviewMesh(
    collectPanelBoundaryEdges([panel]),
    config,
    panelHighlightMaterial,
    1.18,
    1.45,
    21,
  );
  if (!preview) return null;
  const group = new THREE.Group();
  group.renderOrder = 21;
  group.add(preview);
  return group;
}

function createTileHighlight(descriptor: SpiralTileDescriptor): THREE.Group {
  // Preview-only overlay: cloned positions keep this geometry outside the STL export path.
  const group = new THREE.Group();
  group.renderOrder = 10;
  const borderRadius = Math.max(0.65, settings.diameterMm * 0.0013);
  const points = descriptor.outline.map(({ position }) => (
    position.clone().setLength(position.length() + borderRadius * 1.35)
  ));
  const cornerGeometry = new THREE.SphereGeometry(borderRadius, 10, 6);

  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    const direction = next.clone().sub(point);
    const segmentGeometry = new THREE.CylinderGeometry(
      borderRadius,
      borderRadius,
      direction.length(),
      8,
      1,
      false,
    );
    const segment = new THREE.Mesh(segmentGeometry, tileHighlightMaterial);
    segment.position.copy(point).add(next).multiplyScalar(0.5);
    segment.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.normalize(),
    );
    segment.renderOrder = 10;
    group.add(segment);

    const corner = new THREE.Mesh(cornerGeometry, tileHighlightMaterial);
    corner.position.copy(point);
    corner.renderOrder = 10;
    group.add(corner);
  });

  return group;
}

function updateSceneForDiameter(diameterMm: number): void {
  const radius = diameterMm * 0.5;
  const radiusChanged = Math.abs(radius - sceneRadius) > 0.001;
  sceneRadius = radius;

  if (scene.fog instanceof THREE.FogExp2) scene.fog.density = 0.205 / radius;
  floor.scale.setScalar(radius * 2.16);
  floor.position.y = -radius * 1.29;
  keyLight.position.set(radius * 1.45, radius * 1.9, radius * 1.37);
  rimLight.position.set(-radius * 1.45, radius * 0.21, -radius * 1.26);

  keyLight.shadow.camera.left = -radius * 1.72;
  keyLight.shadow.camera.right = radius * 1.72;
  keyLight.shadow.camera.top = radius * 1.72;
  keyLight.shadow.camera.bottom = -radius * 1.72;
  keyLight.shadow.camera.near = Math.max(0.1, radius * 0.01);
  keyLight.shadow.camera.far = radius * 6;
  keyLight.shadow.camera.updateProjectionMatrix();

  camera.near = Math.max(0.1, radius * 0.001);
  camera.far = radius * 20;
  controls.minDistance = radius * 1.9;
  controls.maxDistance = radius * 5.5;
  if (radiusChanged) {
    camera.position.set(radius * 2, radius * 1.1, radius * 2.42);
    controls.target.set(0, 0, 0);
    controls.update();
  }
  camera.updateProjectionMatrix();
}

function addTriangle(
  positions: number[],
  colors: number[],
  indices: number[],
  points: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
  color: THREE.Color,
  reverse = false,
): void {
  const offset = positions.length / 3;
  const ordered = reverse ? [points[0], points[2], points[1]] : points;
  for (const point of ordered) {
    positions.push(point.x, point.y, point.z);
    colors.push(color.r, color.g, color.b);
  }
  indices.push(offset, offset + 1, offset + 2);
}

function addQuad(
  positions: number[],
  colors: number[],
  indices: number[],
  points: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3],
  color: THREE.Color,
  reverse = false,
): void {
  addTriangle(positions, colors, indices, [points[0], points[1], points[2]], color, reverse);
  addTriangle(positions, colors, indices, [points[0], points[2], points[3]], color, reverse);
}

function addPolygon(
  positions: number[],
  colors: number[],
  indices: number[],
  points: THREE.Vector3[],
  color: THREE.Color,
  reverse = false,
): void {
  for (let index = 1; index < points.length - 1; index += 1) {
    addTriangle(
      positions,
      colors,
      indices,
      [points[0], points[index], points[index + 1]],
      color,
      reverse,
    );
  }
}

function addTexturedPolygon(
  positions: number[],
  uvs: number[],
  indices: number[],
  vertices: readonly TileOutlineVertex[],
): void {
  for (let index = 1; index < vertices.length - 1; index += 1) {
    const offset = positions.length / 3;
    for (const vertex of [vertices[0], vertices[index], vertices[index + 1]]) {
      positions.push(vertex.position.x, vertex.position.y, vertex.position.z);
      uvs.push(vertex.uv.x, vertex.uv.y);
    }
    indices.push(offset, offset + 1, offset + 2);
  }
}

function mapUvToAtlas(localUv: THREE.Vector2, textureIndex: number, textureCount: number): THREE.Vector2 {
  if (textureCount <= 0) return localUv.clone();
  const columns = Math.ceil(Math.sqrt(textureCount));
  const rows = Math.ceil(textureCount / columns);
  const column = textureIndex % columns;
  const rowFromTop = Math.floor(textureIndex / columns);
  const edgeInset = 1 / 512;
  const insetU = edgeInset + localUv.x * (1 - edgeInset * 2);
  const insetV = edgeInset + localUv.y * (1 - edgeInset * 2);
  return new THREE.Vector2(
    (column + insetU) / columns,
    (rows - rowFromTop - 1 + insetV) / rows,
  );
}

function tileColor(row: number, column: number, config: PolyhedronSettings): THREE.Color {
  const progress = (row * config.around + column) / (config.around * config.bands);
  const wave = Math.sin((column + row * config.twist) * 0.72) * 0.025;
  return new THREE.Color().setHSL(0.075 + progress * 0.055 + wave, 0.72, 0.52 + wave);
}

function buildPolyhedron(
  config: PolyhedronSettings,
  textureCounts: [number, number],
  collectExportTiles = false,
): PolyhedronGeometry {
  const descriptors = generateSpiralTileDescriptors(config, textureCounts);
  const panelColorByTile = new Map<string, THREE.Color>();
  if (config.stlExportMode === 'panels') {
    const panels = partitionSpiralTilesByPieceCount(descriptors, {
      targetPieceCount: config.panelTargetPieceCount,
    });
    panels.forEach((panel, panelIndex) => {
      const color = new THREE.Color().setHSL(
        (panelIndex * 0.61803398875) % 1,
        0.58,
        0.48 + (panelIndex % 2) * 0.08,
      );
      for (const tile of panel.tiles) {
        panelColorByTile.set(`${tile.spiral}:${tile.order}`, color);
      }
    });
  }
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const surfaceBuffers: [SurfaceBuffers, SurfaceBuffers] = [
    { positions: [], uvs: [], indices: [] },
    { positions: [], uvs: [], indices: [] },
  ];
  if (!collectExportTiles) for (const descriptor of descriptors) {
    const spiralIndex = descriptor.spiral - 1 as 0 | 1;
    const textureSource = textureSourceSpiralIndex(textureCounts, spiralIndex);
    const textureCount = textureSource === null ? 0 : textureCounts[textureSource];
    const panelColor = panelColorByTile.get(`${descriptor.spiral}:${descriptor.order}`);
    const color = panelColor
      ? panelColor.clone()
      : tileColor(descriptor.row, descriptor.column, config);
    if (!panelColor && descriptor.spiral === 2) color.offsetHSL(0.018, -0.06, -0.035);
    const clippedOuter = descriptor.outline.map((vertex) => vertex.position);
    const innerScale = (descriptor.outerRadius - config.tileThicknessMm) / descriptor.outerRadius;
    const inner = clippedOuter.map((point) => point.clone().multiplyScalar(innerScale));

    const tilePositions: number[] = [];
    const tileColors: number[] = [];
    const tileIndices: number[] = [];
    addPolygon(tilePositions, tileColors, tileIndices, clippedOuter, color);
    const buffers = surfaceBuffers[spiralIndex];
    addTexturedPolygon(
      buffers.positions,
      buffers.uvs,
      buffers.indices,
      descriptor.outline.map((vertex) => ({
        position: vertex.position,
        uv: mapUvToAtlas(
          vertex.uv,
          descriptor.textureIndex ?? 0,
          textureCount,
        ),
      })),
    );
    addPolygon(tilePositions, tileColors, tileIndices, inner, color.clone().multiplyScalar(0.38), true);
    for (let index = 0; index < clippedOuter.length; index += 1) {
      const next = (index + 1) % clippedOuter.length;
      const sideShade = 0.56 + (index % 3) * 0.07;
      addQuad(
        tilePositions,
        tileColors,
        tileIndices,
        [clippedOuter[index], inner[index], inner[next], clippedOuter[next]],
        color.clone().multiplyScalar(sideShade),
      );
    }

    const vertexOffset = positions.length / 3;
    positions.push(...tilePositions);
    colors.push(...tileColors);
    indices.push(...tileIndices.map((index) => index + vertexOffset));
  }

  const solid = new THREE.BufferGeometry();
  solid.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  solid.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  solid.setIndex(indices);
  solid.computeVertexNormals();
  solid.computeBoundingSphere();

  const surfaces = surfaceBuffers.map((buffers) => {
    const surface = new THREE.BufferGeometry();
    surface.setAttribute('position', new THREE.Float32BufferAttribute(buffers.positions, 3));
    surface.setAttribute('uv', new THREE.Float32BufferAttribute(buffers.uvs, 2));
    surface.setIndex(buffers.indices);
    surface.computeVertexNormals();
    surface.computeBoundingSphere();
    return surface;
  }) as [THREE.BufferGeometry, THREE.BufferGeometry];

  return {
    solid,
    surfaces,
    tileCount: descriptors.length,
    descriptors,
    exportTiles: collectExportTiles ? descriptors : [],
  };
}

function rebuildPolyhedron(): void {
  const previous = polyhedron;
  const previousTextureSurfaces = textureSurfaces;
  const previousPanelBoundaryPreview = panelBoundaryPreview;
  const geometry = buildPolyhedron(settings, currentTextureCounts());
  tileDescriptors = geometry.descriptors;
  polyhedron = new THREE.Mesh(geometry.solid, material);
  const nextTextureSurfaces: [THREE.Mesh, THREE.Mesh] = [
    new THREE.Mesh(geometry.surfaces[0], textureMaterials[0]),
    new THREE.Mesh(geometry.surfaces[1], textureMaterials[1]),
  ];
  nextTextureSurfaces[0].visible = texturesForSpiral(0).length > 0;
  nextTextureSurfaces[1].visible = texturesForSpiral(1).length > 0;
  textureSurfaces = nextTextureSurfaces;
  panelBoundaryPreview = createPanelBoundaryPreview(geometry.descriptors, settings);
  polyhedron.castShadow = true;
  polyhedron.receiveShadow = true;
  sphereGroup.add(polyhedron);
  sphereGroup.add(...nextTextureSurfaces);
  if (panelBoundaryPreview) sphereGroup.add(panelBoundaryPreview);
  updateSceneForDiameter(settings.diameterMm);
  if (previous) {
    sphereGroup.remove(previous);
    previous.geometry.dispose();
  }
  for (const previousSurface of previousTextureSurfaces) {
    if (!previousSurface) continue;
    sphereGroup.remove(previousSurface);
    previousSurface.geometry.dispose();
  }
  if (previousPanelBoundaryPreview) {
    sphereGroup.remove(previousPanelBoundaryPreview);
    previousPanelBoundaryPreview.geometry.dispose();
  }

  const tileTotal = document.querySelector<HTMLOutputElement>('#tile-total');
  if (tileTotal) tileTotal.value = `${String(geometry.tileCount)} pieces`;
  refreshTileHighlight();
}

function scheduleRebuild(): void {
  window.cancelAnimationFrame(rebuildFrame);
  rebuildFrame = window.requestAnimationFrame(rebuildPolyhedron);
}

function bindRange(
  id: string,
  outputId: string,
  update: (value: number) => void,
  format: (value: number) => string = String,
  rebuild = true,
  initialValue?: number,
): void {
  const input = document.querySelector<HTMLInputElement>(`#${id}`);
  const output = document.querySelector<HTMLOutputElement>(`#${outputId}`);
  if (!input || !output) return;
  if (initialValue !== undefined) input.value = String(initialValue);
  output.value = format(Number(input.value));
  input.addEventListener('input', () => {
    const value = Number(input.value);
    output.value = format(value);
    update(value);
    savePolyhedronSettings(settingsStorage, settings);
    if (rebuild) scheduleRebuild();
  });
}

function syncPolarOpeningLimits(diameterMm: number): void {
  const maximum = Math.floor((diameterMm * 0.8) / 10) * 10;
  const controls = [
    {
      inputId: 'top-opening',
      outputId: 'top-opening-value',
      setting: 'topOpeningDiameterMm',
    },
    {
      inputId: 'bottom-opening',
      outputId: 'bottom-opening-value',
      setting: 'bottomOpeningDiameterMm',
    },
  ] as const;
  for (const control of controls) {
    const input = document.querySelector<HTMLInputElement>(`#${control.inputId}`);
    const output = document.querySelector<HTMLOutputElement>(`#${control.outputId}`);
    if (!input || !output) continue;
    input.max = String(maximum);
    if (settings[control.setting] > maximum) {
      settings[control.setting] = maximum;
      input.value = String(maximum);
      output.value = `${maximum} mm`;
    }
  }
}

function syncLithophaneMinimumLimit(maximumThicknessMm: number): void {
  const input = document.querySelector<HTMLInputElement>('#lithophane-min-thickness');
  const output = document.querySelector<HTMLOutputElement>('#lithophane-min-thickness-value');
  if (!input || !output) return;
  const maximum = Math.max(Number(input.min), maximumThicknessMm - 0.1);
  input.max = maximum.toFixed(1);
  if (settings.lithophaneMinThicknessMm > maximum) {
    settings.lithophaneMinThicknessMm = maximum;
    input.value = maximum.toFixed(1);
    output.value = `${maximum.toFixed(1)} mm`;
  }
}

function syncLithophaneRimLimits(): void {
  const input = document.querySelector<HTMLInputElement>('#lithophane-rim-thickness');
  const output = document.querySelector<HTMLOutputElement>('#lithophane-rim-thickness-value');
  if (!input || !output) return;
  input.min = settings.lithophaneMinThicknessMm.toFixed(1);
  input.max = settings.tileThicknessMm.toFixed(1);
  settings.lithophaneRimThicknessMm = Math.min(
    settings.tileThicknessMm,
    Math.max(settings.lithophaneMinThicknessMm, settings.lithophaneRimThicknessMm),
  );
  input.value = settings.lithophaneRimThicknessMm.toFixed(1);
  output.value = `${settings.lithophaneRimThicknessMm.toFixed(1)} mm`;
}

function syncPanelExportControls(): void {
  const mode = requiredElement<HTMLSelectElement>('#stl-export-mode');
  const settingsPanel = requiredElement<HTMLDivElement>('#panel-export-settings');
  const targetPieceCount = requiredElement<HTMLInputElement>('#panel-target-piece-count');
  const backing = requiredElement<HTMLInputElement>('#panel-backing-thickness');
  const glueAllowance = requiredElement<HTMLInputElement>('#panel-glue-allowance');
  const summary = requiredElement<HTMLOutputElement>('#panel-export-summary');
  const exportButton = requiredElement<HTMLButtonElement>('#export-stl-directory');

  settings.panelTargetPieceCount = Math.min(64, Math.max(1, settings.panelTargetPieceCount));
  settings.panelBackingThicknessMm = Math.min(
    settings.lithophaneRimThicknessMm,
    Math.max(0.1, settings.panelBackingThicknessMm),
  );
  settings.panelGlueAllowanceMm = Math.min(10, Math.max(0, settings.panelGlueAllowanceMm));
  mode.value = settings.stlExportMode;
  settingsPanel.hidden = settings.stlExportMode !== 'panels';
  targetPieceCount.value = String(settings.panelTargetPieceCount);
  backing.max = settings.lithophaneRimThicknessMm.toFixed(1);
  backing.value = settings.panelBackingThicknessMm.toFixed(1);
  glueAllowance.value = settings.panelGlueAllowanceMm.toFixed(1);
  summary.value = `隣接するpieceを最大${settings.panelTargetPieceCount}個ずつ、コンパクトに結合`;
  exportButton.textContent = settings.stlExportMode === 'panels'
    ? '球面パネルSTLを出力'
    : '全タイルを個別STLで出力';
}

syncPolarOpeningLimits(settings.diameterMm);
syncLithophaneMinimumLimit(settings.tileThicknessMm);
syncLithophaneRimLimits();

bindRange(
  'diameter',
  'diameter-value',
  (value) => {
    settings.diameterMm = value;
    syncPolarOpeningLimits(value);
  },
  (value) => `${value} mm`,
  true,
  settings.diameterMm,
);
bindRange(
  'tile-thickness',
  'tile-thickness-value',
  (value) => {
    settings.tileThicknessMm = value;
    syncLithophaneMinimumLimit(value);
    syncLithophaneRimLimits();
    syncPanelExportControls();
  },
  (value) => `${value.toFixed(1)} mm`,
  true,
  settings.tileThicknessMm,
);
bindRange(
  'lithophane-min-thickness',
  'lithophane-min-thickness-value',
  (value) => {
    settings.lithophaneMinThicknessMm = value;
    syncLithophaneRimLimits();
    syncPanelExportControls();
  },
  (value) => `${value.toFixed(1)} mm`,
  false,
  settings.lithophaneMinThicknessMm,
);
bindRange(
  'lithophane-rim-thickness',
  'lithophane-rim-thickness-value',
  (value) => {
    settings.lithophaneRimThicknessMm = value;
    syncPanelExportControls();
  },
  (value) => `${value.toFixed(1)} mm`,
  false,
  settings.lithophaneRimThicknessMm,
);
bindRange(
  'lithophane-resolution',
  'lithophane-resolution-value',
  (value) => { settings.lithophaneResolutionMm = value; },
  (value) => `${value.toFixed(1)} mm`,
  false,
  settings.lithophaneResolutionMm,
);
bindRange(
  'top-opening',
  'top-opening-value',
  (value) => { settings.topOpeningDiameterMm = value; },
  (value) => `${value} mm`,
  true,
  settings.topOpeningDiameterMm,
);
bindRange(
  'bottom-opening',
  'bottom-opening-value',
  (value) => { settings.bottomOpeningDiameterMm = value; },
  (value) => `${value} mm`,
  true,
  settings.bottomOpeningDiameterMm,
);
bindRange(
  'around',
  'around-value',
  (value) => {
    settings.around = value;
    syncPanelExportControls();
  },
  String,
  true,
  settings.around,
);
bindRange(
  'bands',
  'bands-value',
  (value) => {
    settings.bands = value;
    syncPanelExportControls();
  },
  String,
  true,
  settings.bands,
);
bindRange(
  'twist',
  'twist-value',
  (value) => { settings.twist = value; },
  (value) => value.toFixed(2),
  true,
  settings.twist,
);
bindRange(
  'joint-clearance',
  'joint-clearance-value',
  (value) => { settings.jointClearanceMm = value; },
  (value) => `${value.toFixed(2)} mm`,
  true,
  settings.jointClearanceMm,
);
bindRange(
  'explode',
  'explode-value',
  (value) => { settings.explode = value / 5; },
  (value) => `${value}%`,
  true,
  settings.explode * 5,
);
bindRange(
  'rotation-speed',
  'rotation-speed-value',
  (value) => { settings.rotationSpeedDegPerSec = value; },
  (value) => `${value}°/s`,
  false,
  settings.rotationSpeedDegPerSec,
);
bindRange(
  'refresh-rate',
  'refresh-rate-value',
  (value) => { settings.refreshRateHz = value; },
  (value) => `${value} Hz`,
  false,
  settings.refreshRateHz,
);

const stlExportMode = requiredElement<HTMLSelectElement>('#stl-export-mode');
const panelTargetPieceCount = requiredElement<HTMLInputElement>('#panel-target-piece-count');
const panelBackingThickness = requiredElement<HTMLInputElement>('#panel-backing-thickness');
const panelGlueAllowance = requiredElement<HTMLInputElement>('#panel-glue-allowance');

stlExportMode.addEventListener('change', () => {
  settings.stlExportMode = stlExportMode.value === 'panels' ? 'panels' : 'individual';
  syncPanelExportControls();
  savePolyhedronSettings(settingsStorage, settings);
  scheduleRebuild();
});

function bindPanelNumber(
  input: HTMLInputElement,
  update: (value: number) => void,
): void {
  input.addEventListener('change', () => {
    const value = Number(input.value);
    if (Number.isFinite(value)) update(value);
    syncPanelExportControls();
    savePolyhedronSettings(settingsStorage, settings);
    scheduleRebuild();
  });
}

bindPanelNumber(panelTargetPieceCount, (value) => {
  settings.panelTargetPieceCount = Math.round(value);
});
bindPanelNumber(panelBackingThickness, (value) => {
  settings.panelBackingThicknessMm = value;
});
bindPanelNumber(panelGlueAllowance, (value) => {
  settings.panelGlueAllowanceMm = value;
});
syncPanelExportControls();

const highlightSpiral = requiredElement<HTMLSelectElement>('#highlight-spiral');
const highlightIndex = requiredElement<HTMLInputElement>('#highlight-index');
const highlightStatus = requiredElement<HTMLOutputElement>('#highlight-status');
const tileHighlightPanel = requiredElement<HTMLDivElement>('#tile-highlight-panel');
const highlightHeading = requiredElement<HTMLElement>('#highlight-heading');
const highlightFields = requiredElement<HTMLDivElement>('#highlight-fields');
const highlightSpiralField = requiredElement<HTMLLabelElement>('#highlight-spiral-field');
const highlightIndexLabel = requiredElement<HTMLElement>('#highlight-index-label');
const highlightNote = requiredElement<HTMLElement>('#highlight-note');

function maximumHighlightIndex(spiral: 1 | 2): number {
  const tileCount = spiral === 1
    ? settings.around * settings.bands
    : settings.around * Math.max(0, settings.bands - 1);
  return Math.max(0, tileCount - 1);
}

function refreshTileHighlight(): void {
  removeTileHighlight();
  const panelMode = settings.stlExportMode === 'panels';
  tileHighlightPanel.classList.toggle('is-panel-mode', panelMode);
  highlightFields.classList.toggle('is-panel-mode', panelMode);
  highlightSpiralField.hidden = panelMode;
  highlightHeading.textContent = panelMode ? 'パネルを緑枠表示' : 'マスを赤枠表示';
  highlightIndexLabel.textContent = panelMode ? 'パネルIndex' : 'Index';
  highlightNote.textContent = panelMode
    ? 'プレビューのみ・緑枠はSTLに含まれません'
    : 'プレビューのみ・赤枠はSTLに含まれません';
  highlightStatus.classList.remove('is-error', 'is-active');

  if (panelMode) {
    const panels = partitionSpiralTilesByPieceCount(tileDescriptors, {
      targetPieceCount: settings.panelTargetPieceCount,
    });
    const maximumIndex = Math.max(0, panels.length - 1);
    highlightIndex.max = String(maximumIndex);

    if (highlightIndex.value === '') {
      highlightStatus.value = `パネルIndexを入力してください（0〜${maximumIndex}）`;
      return;
    }

    const index = Number(highlightIndex.value);
    if (!Number.isSafeInteger(index) || index < 0 || index >= panels.length) {
      highlightStatus.value = `パネルIndexは0〜${maximumIndex}の整数で指定してください`;
      highlightStatus.classList.add('is-error');
      return;
    }

    const panel = panels[index];
    tileHighlight = createPanelHighlight(panel, settings);
    if (!tileHighlight) {
      highlightStatus.value = `パネルIndex ${index} の外周を表示できません`;
      highlightStatus.classList.add('is-error');
      return;
    }
    sphereGroup.add(tileHighlight);
    const panelFileName = compactPanelFileName(
      index,
      panel.tiles.length,
      Math.max(4, String(panels.length).length),
    );
    highlightStatus.value = `パネルIndex ${index}（${panelFileName}）を緑枠で表示中`;
    highlightStatus.classList.add('is-active');
    return;
  }

  const spiral = Number(highlightSpiral.value) as 1 | 2;
  const maximumIndex = maximumHighlightIndex(spiral);
  highlightIndex.max = String(maximumIndex);

  if (highlightIndex.value === '') {
    highlightStatus.value = `Indexを入力してください（0〜${maximumIndex}）`;
    return;
  }

  const index = Number(highlightIndex.value);
  if (!Number.isSafeInteger(index) || index < 0 || index > maximumIndex) {
    highlightStatus.value = `Indexは0〜${maximumIndex}の整数で指定してください`;
    highlightStatus.classList.add('is-error');
    return;
  }

  const descriptor = findSpiralTileByIndex(tileDescriptors, spiral, index);
  if (!descriptor) {
    highlightStatus.value = `渦${spiral} / Index ${index} は開口部で省略されています`;
    highlightStatus.classList.add('is-error');
    return;
  }

  tileHighlight = createTileHighlight(descriptor);
  sphereGroup.add(tileHighlight);
  highlightStatus.value = `渦${spiral} / Index ${index} を表示中`;
  highlightStatus.classList.add('is-active');
}

highlightSpiral.addEventListener('change', refreshTileHighlight);
highlightIndex.addEventListener('input', refreshTileHighlight);

const textureDialog = requiredElement<HTMLDialogElement>('#texture-dialog');
const textureSummary = requiredElement<HTMLSpanElement>('#texture-summary');
const textureDialogStatus = requiredElement<HTMLSpanElement>('#texture-dialog-status');
const textureLists: [HTMLOListElement, HTMLOListElement] = [
  requiredElement<HTMLOListElement>('#spiral-1-list'),
  requiredElement<HTMLOListElement>('#spiral-2-list'),
];
const textureEmptyStates: [HTMLParagraphElement, HTMLParagraphElement] = [
  requiredElement<HTMLParagraphElement>('#spiral-1-empty'),
  requiredElement<HTMLParagraphElement>('#spiral-2-empty'),
];
const textureInputs: [HTMLInputElement, HTMLInputElement] = [
  requiredElement<HTMLInputElement>('#spiral-1-files'),
  requiredElement<HTMLInputElement>('#spiral-2-files'),
];
const resetAllTexturesButton = requiredElement<HTMLButtonElement>('#reset-all-textures');
const resetTexturesConfirmDialog = requiredElement<HTMLDialogElement>('#reset-textures-confirm-dialog');
const cancelResetTexturesButton = requiredElement<HTMLButtonElement>('#cancel-reset-textures');
const confirmResetTexturesButton = requiredElement<HTMLButtonElement>('#confirm-reset-textures');

function buildAtlasTexture(entries: TextureEntry[]): THREE.Texture | null {
  if (entries.length === 0) return null;
  const columns = Math.ceil(Math.sqrt(entries.length));
  const rows = Math.ceil(entries.length / columns);
  const maxTextureSize = renderer.capabilities.maxTextureSize;
  const cellSize = Math.max(1, Math.min(512, Math.floor(maxTextureSize / Math.max(columns, rows))));
  const atlas = document.createElement('canvas');
  atlas.width = columns * cellSize;
  atlas.height = rows * cellSize;
  const context = atlas.getContext('2d');
  if (!context) throw new Error('Texture atlas canvas is unavailable.');
  context.clearRect(0, 0, atlas.width, atlas.height);
  entries.forEach((entry, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    context.drawImage(entry.bitmap, column * cellSize, row * cellSize, cellSize, cellSize);
  });

  const texture = new THREE.CanvasTexture(atlas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function refreshTextureAtlases(): void {
  for (const spiralIndex of [0, 1] as const) {
    atlasTextures[spiralIndex]?.dispose();
    const atlas = buildAtlasTexture(spiralTextures[spiralIndex]);
    atlasTextures[spiralIndex] = atlas;
  }
  const counts = currentTextureCounts();
  for (const spiralIndex of [0, 1] as const) {
    const source = textureSourceSpiralIndex(counts, spiralIndex);
    const atlas = source === null ? null : atlasTextures[source];
    textureMaterials[spiralIndex].map = atlas;
    textureMaterials[spiralIndex].needsUpdate = true;
    const surface = textureSurfaces[spiralIndex];
    if (surface) surface.visible = atlas !== null;
  }
  const textureCount = spiralTextures[0].length + spiralTextures[1].length;
  const fallback = spiralTextures[0].length === 0 && spiralTextures[1].length > 0
    ? '（渦1は渦2を共用）'
    : spiralTextures[1].length === 0 && spiralTextures[0].length > 0
      ? '（渦2は渦1を共用）'
      : '';
  textureSummary.textContent = `渦1: ${spiralTextures[0].length} / 渦2: ${spiralTextures[1].length}${fallback}`;
  resetAllTexturesButton.disabled = textureCount === 0;
}

function setTextureDialogStatus(message: string, isError = false): void {
  textureDialogStatus.textContent = message;
  textureDialogStatus.classList.toggle('is-error', isError);
}

async function createSquareTextureBitmap(blob: Blob): Promise<ImageBitmap> {
  if (blob.type !== 'image/png' && blob.type !== 'image/jpeg') {
    throw new Error('Unsupported texture format.');
  }
  let bitmap = await createImageBitmap(blob);
  if (bitmap.width !== bitmap.height) {
    bitmap.close();
    throw new Error('Texture must have a 1:1 aspect ratio.');
  }
  if (bitmap.width > 512) {
    bitmap.close();
    bitmap = await createImageBitmap(blob, {
      resizeWidth: 512,
      resizeHeight: 512,
      resizeQuality: 'high',
    });
  }
  return bitmap;
}

function storedRecordsForSpiral(spiralIndex: 0 | 1): StoredTextureRecord[] {
  return spiralTextures[spiralIndex].map((entry, order) => ({
    id: entry.id,
    spiral: (spiralIndex + 1) as 1 | 2,
    order,
    name: entry.name,
    blob: entry.blob,
  }));
}

async function persistTextureSequence(spiralIndex: 0 | 1): Promise<void> {
  await saveStoredTextureRecords(storedRecordsForSpiral(spiralIndex));
}

function reportTexturePersistenceError(): void {
  setTextureDialogStatus('画像のブラウザー保存に失敗しました', true);
}

function renderTextureList(spiralIndex: 0 | 1): void {
  const entries = spiralTextures[spiralIndex];
  const list = textureLists[spiralIndex];
  list.replaceChildren();
  textureEmptyStates[spiralIndex].hidden = entries.length > 0;

  entries.forEach((entry, index) => {
    const item = document.createElement('li');
    item.className = 'texture-item';

    const preview = document.createElement('canvas');
    preview.width = 60;
    preview.height = 60;
    preview.getContext('2d')?.drawImage(entry.bitmap, 0, 0, 60, 60);

    const label = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'texture-item-name';
    name.textContent = entry.name;
    name.title = entry.name;
    const order = document.createElement('span');
    order.className = 'texture-item-order';
    order.textContent = `#${index + 1}`;
    label.append(name, order);

    const actions = document.createElement('div');
    actions.className = 'texture-item-actions';
    const up = document.createElement('button');
    up.type = 'button';
    up.textContent = '↑';
    up.title = '前へ移動';
    up.disabled = index === 0;
    up.addEventListener('click', () => {
      [entries[index - 1], entries[index]] = [entries[index], entries[index - 1]];
      refreshTextureAtlases();
      renderTextureList(spiralIndex);
      scheduleRebuild();
      void persistTextureSequence(spiralIndex).catch(reportTexturePersistenceError);
    });
    const down = document.createElement('button');
    down.type = 'button';
    down.textContent = '↓';
    down.title = '後ろへ移動';
    down.disabled = index === entries.length - 1;
    down.addEventListener('click', () => {
      [entries[index], entries[index + 1]] = [entries[index + 1], entries[index]];
      refreshTextureAtlases();
      renderTextureList(spiralIndex);
      scheduleRebuild();
      void persistTextureSequence(spiralIndex).catch(reportTexturePersistenceError);
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = '削除';
    remove.addEventListener('click', () => {
      const [removed] = entries.splice(index, 1);
      removed?.bitmap.close();
      if (removed) textureSamplerCache.delete(removed.id);
      refreshTextureAtlases();
      renderTextureList(spiralIndex);
      scheduleRebuild();
      if (removed) {
        void deleteStoredTextureRecord(removed.id).catch(reportTexturePersistenceError);
      }
    });
    actions.append(up, down, remove);
    item.append(preview, label, actions);
    list.append(item);
  });
}

async function addTextureFiles(spiralIndex: 0 | 1, files: FileList): Promise<void> {
  setTextureDialogStatus('画像を読み込んでいます…');
  let rejectedCount = 0;
  let addedCount = 0;
  for (const file of Array.from(files)) {
    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      rejectedCount += 1;
      continue;
    }
    try {
      const bitmap = await createSquareTextureBitmap(file);
      spiralTextures[spiralIndex].push({
        id: nextTextureId,
        name: file.name,
        bitmap,
        blob: file,
      });
      nextTextureId += 1;
      addedCount += 1;
    } catch {
      rejectedCount += 1;
    }
  }

  refreshTextureAtlases();
  renderTextureList(spiralIndex);
  scheduleRebuild();
  try {
    await persistTextureSequence(spiralIndex);
    if (rejectedCount > 0) {
      setTextureDialogStatus(`${addedCount}枚追加・${rejectedCount}枚除外（1:1のPNG/JPGのみ）`, true);
    } else {
      setTextureDialogStatus(`${addedCount}枚追加しました`);
    }
  } catch {
    setTextureDialogStatus(`${addedCount}枚追加しましたがブラウザー保存に失敗しました`, true);
  }
}

async function restoreStoredTextures(): Promise<void> {
  try {
    const records = await loadStoredTextureRecords();
    let rejectedCount = 0;
    for (const record of records) {
      if (
        !Number.isSafeInteger(record.id)
        || (record.spiral !== 1 && record.spiral !== 2)
        || typeof record.name !== 'string'
        || !(record.blob instanceof Blob)
      ) {
        rejectedCount += 1;
        continue;
      }
      try {
        const bitmap = await createSquareTextureBitmap(record.blob);
        spiralTextures[record.spiral - 1].push({
          id: record.id,
          name: record.name,
          bitmap,
          blob: record.blob,
        });
        nextTextureId = Math.max(nextTextureId, record.id + 1);
      } catch {
        rejectedCount += 1;
      }
    }
    refreshTextureAtlases();
    renderTextureList(0);
    renderTextureList(1);
    scheduleRebuild();
    if (records.length > 0) {
      const restoredCount = spiralTextures[0].length + spiralTextures[1].length;
      setTextureDialogStatus(
        rejectedCount > 0
          ? `${restoredCount}枚を復元・${rejectedCount}枚を除外`
          : `${restoredCount}枚の保存画像を復元しました`,
        rejectedCount > 0,
      );
    }
  } catch {
    setTextureDialogStatus('保存画像を読み込めませんでした', true);
  }
}

textureInputs.forEach((input, index) => {
  input.addEventListener('change', () => {
    const files = input.files;
    if (files?.length) void addTextureFiles(index as 0 | 1, files);
    input.value = '';
  });
});

requiredElement<HTMLButtonElement>('#open-texture-dialog').addEventListener('click', () => {
  setTextureDialogStatus('');
  textureDialog.showModal();
});
const closeTextureDialog = () => textureDialog.close();
requiredElement<HTMLButtonElement>('#close-texture-dialog').addEventListener('click', closeTextureDialog);
requiredElement<HTMLButtonElement>('#close-texture-dialog-x').addEventListener('click', closeTextureDialog);

const stlExportMaterial = new THREE.MeshBasicMaterial();
const textureSamplerCache = new Map<number, ImageSampler>();

resetAllTexturesButton.addEventListener('click', () => {
  if (spiralTextures[0].length + spiralTextures[1].length === 0) return;
  resetTexturesConfirmDialog.showModal();
});

cancelResetTexturesButton.addEventListener('click', () => {
  resetTexturesConfirmDialog.close();
});

confirmResetTexturesButton.addEventListener('click', async () => {
  confirmResetTexturesButton.disabled = true;
  cancelResetTexturesButton.disabled = true;
  try {
    await clearStoredTextureRecords();
    for (const entries of spiralTextures) {
      for (const entry of entries) entry.bitmap.close();
      entries.splice(0);
    }
    textureSamplerCache.clear();
    refreshTextureAtlases();
    renderTextureList(0);
    renderTextureList(1);
    scheduleRebuild();
    resetTexturesConfirmDialog.close();
    setTextureDialogStatus('すべてのテクスチャを削除しました');
  } catch {
    resetTexturesConfirmDialog.close();
    setTextureDialogStatus('テクスチャの一括削除に失敗しました', true);
  } finally {
    confirmResetTexturesButton.disabled = false;
    cancelResetTexturesButton.disabled = false;
  }
});

const exportProjectBackupButton = requiredElement<HTMLButtonElement>('#export-project-backup');
const importProjectBackupInput = requiredElement<HTMLInputElement>('#import-project-backup');
const projectBackupStatus = requiredElement<HTMLOutputElement>('#project-backup-status');

function setProjectBackupStatus(message: string, isError = false): void {
  projectBackupStatus.value = message;
  projectBackupStatus.classList.toggle('is-error', isError);
}

function setProjectBackupBusy(busy: boolean): void {
  exportProjectBackupButton.disabled = busy;
  importProjectBackupInput.disabled = busy;
}

async function backupTextures(): Promise<BackupTexture[]> {
  const result: BackupTexture[] = [];
  for (const spiralIndex of [0, 1] as const) {
    for (let order = 0; order < spiralTextures[spiralIndex].length; order += 1) {
      const entry = spiralTextures[spiralIndex][order];
      if (entry.blob.type !== 'image/png' && entry.blob.type !== 'image/jpeg') {
        throw new Error(`${entry.name} はPNG/JPEGではありません`);
      }
      result.push({
        spiral: (spiralIndex + 1) as 1 | 2,
        order,
        name: entry.name,
        mimeType: entry.blob.type,
        bytes: new Uint8Array(await entry.blob.arrayBuffer()),
      });
    }
  }
  return result;
}

exportProjectBackupButton.addEventListener('click', async () => {
  setProjectBackupBusy(true);
  setProjectBackupStatus('ZIPを作成しています…');
  try {
    const textures = await backupTextures();
    const zip = createBackupZip({ ...settings }, textures);
    const blob = new Blob([zip.slice().buffer], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    anchor.href = url;
    anchor.download = `360li-project-${timestamp}.zip`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setProjectBackupStatus(`設定と画像${textures.length}枚をExportしました`);
  } catch (error) {
    console.error(error);
    const detail = error instanceof Error ? error.message : String(error);
    setProjectBackupStatus(`Exportに失敗しました: ${detail}`, true);
  } finally {
    setProjectBackupBusy(false);
  }
});

importProjectBackupInput.addEventListener('change', async () => {
  const [file] = Array.from(importProjectBackupInput.files ?? []);
  importProjectBackupInput.value = '';
  if (!file) return;
  setProjectBackupBusy(true);
  setProjectBackupStatus('ZIPを検証しています…');
  const validationBitmaps: ImageBitmap[] = [];
  try {
    const archive = readBackupZip(new Uint8Array(await file.arrayBuffer()));
    const importedSettings = normalizePolyhedronSettings(archive.settings);
    const records: StoredTextureRecord[] = [];
    for (let index = 0; index < archive.textures.length; index += 1) {
      const texture = archive.textures[index];
      const blob = new Blob([texture.bytes.slice().buffer], { type: texture.mimeType });
      validationBitmaps.push(await createSquareTextureBitmap(blob));
      records.push({
        id: index + 1,
        spiral: texture.spiral,
        order: texture.order,
        name: texture.name,
        blob,
      });
    }

    const previousSettings = { ...settings };
    if (!savePolyhedronSettings(settingsStorage, importedSettings)) {
      throw new Error('設定をブラウザーへ保存できません');
    }
    try {
      await replaceStoredTextureRecords(records);
    } catch (error) {
      savePolyhedronSettings(settingsStorage, previousSettings);
      throw error;
    }
    setProjectBackupStatus(`設定と画像${records.length}枚をImportしました。再読み込みします…`);
    window.setTimeout(() => window.location.reload(), 200);
  } catch (error) {
    console.error(error);
    const detail = error instanceof Error ? error.message : String(error);
    setProjectBackupStatus(`Importに失敗しました（現在の内容は変更されていません）: ${detail}`, true);
    setProjectBackupBusy(false);
  } finally {
    for (const bitmap of validationBitmaps) bitmap.close();
  }
});

function geometryToBinaryStl(geometry: THREE.BufferGeometry): Uint8Array {
  const exporter = new STLExporter();
  const mesh = new THREE.Mesh(geometry, stlExportMaterial);
  const output = exporter.parse(mesh, { binary: true });
  if (typeof output === 'string') return new TextEncoder().encode(output);
  return new Uint8Array(output.buffer, output.byteOffset, output.byteLength);
}

function samplerForTexture(entry: TextureEntry): ImageSampler {
  const cached = textureSamplerCache.get(entry.id);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = entry.bitmap.width;
  canvas.height = entry.bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('画像の輝度データを読み取れませんでした。');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(entry.bitmap, 0, 0);
  const sampler = createImageSampler(context.getImageData(0, 0, canvas.width, canvas.height));
  textureSamplerCache.set(entry.id, sampler);
  return sampler;
}

async function writeDirectoryFile(
  directory: DirectoryHandleLike,
  name: string,
  data: Uint8Array | string,
): Promise<void> {
  const file = await directory.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (error) {
    await writable.abort?.().catch(() => undefined);
    throw error;
  }
}

function directoryComponent(value: number): string {
  return String(value).replace('.', '_');
}

const exportStlButton = requiredElement<HTMLButtonElement>('#export-stl-directory');
const exportStlStatus = requiredElement<HTMLOutputElement>('#stl-export-status');

exportStlButton.addEventListener('click', async () => {
  exportStlStatus.classList.remove('is-error');
  if (!(settings.lithophaneMinThicknessMm > 0
    && settings.lithophaneMinThicknessMm < settings.tileThicknessMm)) {
    exportStlStatus.value = '最小厚はタイル厚さ未満にしてください';
    exportStlStatus.classList.add('is-error');
    return;
  }
  if (!(settings.lithophaneRimThicknessMm >= settings.lithophaneMinThicknessMm
    && settings.lithophaneRimThicknessMm <= settings.tileThicknessMm)) {
    exportStlStatus.value = '縁の高さは最小厚さ以上・最大厚さ以下にしてください';
    exportStlStatus.classList.add('is-error');
    return;
  }
  if (settings.stlExportMode === 'panels'
    && (settings.topOpeningDiameterMm <= 0 || settings.bottomOpeningDiameterMm <= 0)) {
    exportStlStatus.value = '球面パネル出力には上下とも開口径10 mm以上が必要です';
    exportStlStatus.classList.add('is-error');
    return;
  }

  const showDirectoryPicker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!showDirectoryPicker) {
    exportStlStatus.value = 'このブラウザはフォルダ出力に対応していません';
    exportStlStatus.classList.add('is-error');
    return;
  }

  exportStlStatus.value = '保存先フォルダを選択してください';
  let parentDirectory: DirectoryHandleLike;
  try {
    parentDirectory = await showDirectoryPicker({
      id: 'spiral-lithophane-stl',
      mode: 'readwrite',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      exportStlStatus.value = '出力をキャンセルしました';
      return;
    }
    console.error(error);
    exportStlStatus.value = '保存先を開けませんでした';
    exportStlStatus.classList.add('is-error');
    return;
  }

  exportStlButton.disabled = true;
  exportStlStatus.value = 'タイル一覧を生成中…';
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

  try {
    const generated = buildPolyhedron(
      { ...settings, explode: 0 },
      currentTextureCounts(),
      true,
    );
    const sortedTiles = [...generated.exportTiles].sort(
      (left, right) => left.order - right.order || left.spiral - right.spiral,
    );
    generated.solid.dispose();
    generated.surfaces.forEach((surface) => surface.dispose());

    const exportingPanels = settings.stlExportMode === 'panels';
    const outputFolderName = [
      exportingPanels ? 'spiral-panels' : 'spiral-tiles',
      `d${directoryComponent(settings.diameterMm)}`,
      `max${directoryComponent(settings.tileThicknessMm)}`,
      `min${directoryComponent(settings.lithophaneMinThicknessMm)}`,
      `rim${directoryComponent(settings.lithophaneRimThicknessMm)}`,
      `res${directoryComponent(settings.lithophaneResolutionMm)}`,
      `clr${directoryComponent(settings.jointClearanceMm)}`,
      `top${directoryComponent(settings.topOpeningDiameterMm)}`,
      `bottom${directoryComponent(settings.bottomOpeningDiameterMm)}`,
      ...(exportingPanels ? [
        `pieces${settings.panelTargetPieceCount}`,
        `back${directoryComponent(settings.panelBackingThicknessMm)}`,
        `glue${directoryComponent(settings.panelGlueAllowanceMm)}`,
      ] : []),
    ].join('-');
    const outputDirectory = await parentDirectory.getDirectoryHandle(
      outputFolderName,
      { create: true },
    );
    const digits = Math.max(
      4,
      String(Math.max(...sortedTiles.map((tile) => tile.order), 1)).length,
    );

    const writeValidatedGeometry = async (
      geometry: THREE.BufferGeometry,
      fileName: string,
    ): Promise<void> => {
      try {
        const position = geometry.getAttribute('position');
        const geometryIndex = geometry.getIndex();
        if (!(position.array instanceof Float32Array) || !geometryIndex
          || !(geometryIndex.array instanceof Uint16Array || geometryIndex.array instanceof Uint32Array)) {
          throw new Error(`${fileName} の形状バッファが不正です。`);
        }
        try {
          validateClosedSolid({
            positions: position.array,
            indices: geometryIndex.array,
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new Error(`${fileName}: ${detail}`, { cause: error });
        }
        const stl = geometryToBinaryStl(geometry);
        await writeDirectoryFile(outputDirectory, fileName, stl);
      } finally {
        geometry.dispose();
      }
    };

    let exportedFileCount = 0;
    if (exportingPanels) {
      const panels = partitionSpiralTilesByPieceCount(sortedTiles, {
        targetPieceCount: settings.panelTargetPieceCount,
      });
      const panelDigits = Math.max(4, String(panels.length).length);
      for (let index = 0; index < panels.length; index += 1) {
        const panel = panels[index];
        const fileName = compactPanelFileName(index, panel.tiles.length, panelDigits);
        const geometry = createSphericalPanelGeometry(
          panel.tiles.map((descriptor) => {
            const textureEntries = texturesForSpiral(descriptor.spiral - 1 as 0 | 1);
            const textureEntry = descriptor.textureIndex === null
              ? null
              : textureEntries[descriptor.textureIndex] ?? null;
            return {
              descriptor,
              brightnessSampler: textureEntry ? samplerForTexture(textureEntry) : undefined,
            };
          }),
          {
            minThicknessMm: settings.lithophaneMinThicknessMm,
            maxThicknessMm: settings.tileThicknessMm,
            rimThicknessMm: settings.lithophaneRimThicknessMm,
            backingThicknessMm: settings.panelBackingThicknessMm,
            glueAllowanceMm: settings.panelGlueAllowanceMm,
            rimWidthMm: 0.3,
            targetEdgeMm: settings.lithophaneResolutionMm,
          },
        );
        await writeValidatedGeometry(geometry, fileName);
        exportedFileCount += 1;
        exportStlStatus.value = `${index + 1} / ${panels.length} 曲面パネルSTL`;
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      }
    } else {
      for (let index = 0; index < sortedTiles.length; index += 1) {
        const tile = sortedTiles[index];
        const fileName = spiralTileFileName(tile.order, tile.spiral, digits);
        const textureEntries = texturesForSpiral(tile.spiral - 1 as 0 | 1);
        const textureEntry = tile.textureIndex === null
          ? null
          : textureEntries[tile.textureIndex] ?? null;
        const geometry = createLithophaneTileGeometry(
          tile.outline,
          tile.outwardCenter,
          {
            minThicknessMm: settings.lithophaneMinThicknessMm,
            maxThicknessMm: settings.tileThicknessMm,
            rimThicknessMm: settings.lithophaneRimThicknessMm,
            rimWidthMm: 0.3,
            targetEdgeMm: settings.lithophaneResolutionMm,
            brightnessSampler: textureEntry ? samplerForTexture(textureEntry) : undefined,
          },
        );
        await writeValidatedGeometry(geometry, fileName);
        exportedFileCount += 1;

        exportStlStatus.value = `${index + 1} / ${sortedTiles.length} STL`;
        if ((index + 1) % 10 === 0) {
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        }
      }
    }

    const manifest = [
      'Spiral Tile Polyhedron',
      `Diameter: ${settings.diameterMm} mm`,
      `Maximum tile thickness / black: ${settings.tileThicknessMm} mm`,
      `Minimum lithophane thickness / white: ${settings.lithophaneMinThicknessMm} mm`,
      `Perimeter height / thickness: ${settings.lithophaneRimThicknessMm} mm`,
      'Perimeter width: up to 0.3 mm',
      `Lithophane sampling pitch: approximately ${settings.lithophaneResolutionMm} mm`,
      `Top polar opening diameter: ${settings.topOpeningDiameterMm} mm`,
      `Bottom polar opening diameter: ${settings.bottomOpeningDiameterMm} mm`,
      `Tiles around one turn: ${settings.around}`,
      `Spiral turns: ${settings.bands}`,
      `Joint clearance between adjacent tiles: ${settings.jointClearanceMm.toFixed(2)} mm total`,
      `Per-tile edge inset: ${jointClearanceToTileInset(settings.jointClearanceMm).toFixed(2)} mm`,
      `Minimum polar fragment: ${MIN_FRAGMENT_AREA_RATIO * 100}% of its original tile area`,
      `Exported tiles: ${sortedTiles.length}`,
      `Export mode: ${exportingPanels ? 'spherical panels' : 'individual flat tiles'}`,
      ...(exportingPanels ? [
        `Maximum pieces per panel: ${settings.panelTargetPieceCount}`,
        'Panel grouping: edge-adjacent pieces, compact shape preferred',
        `Spherical backing thickness below tile grooves: ${settings.panelBackingThicknessMm.toFixed(1)} mm`,
        `Minimum retained groove depth: ${MINIMUM_PANEL_GROOVE_DEPTH_MM.toFixed(2)} mm`,
        `Inward glue allowance around every tile: ${settings.panelGlueAllowanceMm.toFixed(1)} mm`,
        `Exported panels: ${exportedFileCount}`,
      ] : []),
      '',
      ...(exportingPanels ? [
        'Each STL retains its original spherical coordinates and curvature.',
        'Importing all panel STL files without changing their coordinates reconstructs the sphere.',
        'Tile boundaries remain visible as backed grooves; tiles in one panel form one connected solid.',
        'Panel files are numbered in assembly order and include their piece count: panel-0001-p04.stl, ...',
        'Remainder panels contain no more than the configured maximum piece count.',
      ] : [
        'Each STL is centered and oriented with its inner face toward the print bed.',
        'The print-bed face is flat; only the perimeter side walls are beveled for assembly.',
        'Files are sorted by assembly position, then spiral: 0001-s1.stl, 0001-s2.stl, ...',
      ]),
      'Numbers near the polar openings may be absent because those tiles are intentionally omitted.',
      'A tile with a texture is exported as a lithophane; an untextured tile remains at maximum thickness.',
      'If only one spiral has textures, that sequence is reused for the other spiral.',
      'A narrow polar fragment uses the widest safe perimeter up to 0.3 mm so its lithophane relief is retained.',
      '',
      `Spiral 1 texture sequence: ${spiralTextures[0].map((entry) => entry.name).join(', ') || '(none)'}`,
      `Spiral 2 texture sequence: ${spiralTextures[1].map((entry) => entry.name).join(', ') || '(none)'}`,
    ].join('\n');
    await writeDirectoryFile(outputDirectory, 'README.txt', manifest);
    exportStlStatus.value = `${exportedFileCount}ファイルを ${outputFolderName} へ出力`;
  } catch (error) {
    console.error(error);
    exportStlStatus.value = 'STL出力に失敗しました（出力済みファイルは残ります）';
    exportStlStatus.classList.add('is-error');
  } finally {
    textureSamplerCache.clear();
    exportStlButton.disabled = false;
  }
});

const rotationToggle = document.querySelector<HTMLButtonElement>('#rotation-toggle');
if (rotationToggle) {
  rotationToggle.ariaPressed = String(autoRotate);
  rotationToggle.classList.toggle('is-paused', !autoRotate);
}
rotationToggle?.addEventListener('click', () => {
  autoRotate = !autoRotate;
  settings.autoRotate = autoRotate;
  savePolyhedronSettings(settingsStorage, settings);
  rotationToggle.ariaPressed = String(autoRotate);
  rotationToggle.classList.toggle('is-paused', !autoRotate);
});

document.querySelector<HTMLButtonElement>('#reset-view')?.addEventListener('click', () => {
  camera.position.set(sceneRadius * 2, sceneRadius * 1.1, sceneRadius * 2.42);
  controls.target.set(0, 0, 0);
  sphereGroup.rotation.set(0, 0, 0);
  controls.update();
});

function resize(): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
}

const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(canvas);

let lastRenderTimeMs = 0;
function render(nowMs: number): void {
  window.requestAnimationFrame(render);

  const intervalMs = 1000 / settings.refreshRateHz;
  const elapsedMs = nowMs - lastRenderTimeMs;
  if (lastRenderTimeMs !== 0 && elapsedMs < intervalMs) return;

  const deltaSec = lastRenderTimeMs === 0 ? 0 : Math.min(elapsedMs / 1000, 0.1);
  lastRenderTimeMs = nowMs - (elapsedMs % intervalMs);

  if (autoRotate) {
    sphereGroup.rotation.y += THREE.MathUtils.degToRad(settings.rotationSpeedDegPerSec) * deltaSec;
  }
  controls.update();
  renderer.render(scene, camera);
}

rebuildPolyhedron();
resize();
window.requestAnimationFrame(render);
void restoreStoredTextures();
