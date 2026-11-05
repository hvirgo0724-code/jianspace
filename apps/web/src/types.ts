export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export interface Room {
  id: string;
  name: string;
  type: string;
  boundaryMm: Vec2[];
  heightMm: number;
  computedAreaMm2: number;
  wallRefs: { wallId: string; side: 'left' | 'right' }[];
}
export interface Wall {
  id: string;
  startMm: Vec2;
  endMm: Vec2;
  thicknessMm: number;
  heightMm: number;
  structuralRole: string;
  locked: boolean;
}
export interface Opening {
  id: string;
  kind: 'door' | 'window';
  wallId: string;
  offsetMm: number;
  widthMm: number;
  bottomMm: number;
  heightMm: number;
  connects: (string | null)[];
  model?: 'hinged' | 'archway' | 'casement' | 'panoramic' | 'floor-to-ceiling';
  swing?: { hinge: 'start' | 'end'; direction: 'cw' | 'ccw'; angleDeg: number; roomId: string };
}
export interface Furniture {
  id: string;
  floorId: string;
  roomId: string;
  skuId: string;
  positionMm: Vec3;
  sizeMm: Vec3;
  rotationDeg: number;
  locked: boolean;
}
export interface CatalogEntry {
  skuId: string;
  name: string;
  sizeMm: Vec3;
  priceMinor: number | null;
  currency: string;
  sourceType: string;
  quotedAt: string;
  modelAssetId: string | null;
  productUrl: string | null;
}
export interface Measurement {
  id: string;
  floorId: string;
  targetType: string;
  targetId: string;
  measurementType: string;
  rawValue: number;
  rawUnit: 'm' | 'cm' | 'mm';
  normalizedMm: number;
  method: string;
  measuredAt: string;
  sourceAssetIds: string[];
  notes: string;
}
export interface Scene {
  schemaVersion: '1.0';
  sceneId: string;
  geometryVersionId: string;
  unit: 'mm';
  coordinateSystem: 'RIGHT_HANDED_Z_UP';
  floors: {
    id: string;
    name: string;
    elevationMm: number;
    stairs?: Stair[];
    rooms: Room[];
    walls: Wall[];
    openings: Opening[];
    obstacles: {
      id: string;
      kind: string;
      polygonMm: Vec2[];
      baseZMm: number;
      heightMm: number;
      locked: boolean;
    }[];
  }[];
  measurements: Measurement[];
  confirmation: {
    status: string;
    basis?: 'user_measured' | 'demo';
    measurementRevision: number;
    confirmedBy?: string;
    confirmedAt?: string;
  };
  layout: {
    id: string;
    name: string;
    styleId: string;
    exterior?: { styleId: 'modern' | 'nordic' | 'mediterranean' | 'chinese' };
    planSource?: {
      assetId: string;
      method: 'vision-draft';
      referenceWidthMm: number;
      unverifiedDimensions: true;
    };
    preferences?: {
      occupants?: number;
      children?: boolean;
      elderly?: boolean;
      storagePriority?: boolean;
      passageMm?: number;
      budgetMinor?: number | null;
    };
    analysis?: { score: number; reasons: string[]; warnings: string[] };
    renovation?: {
      wastePercent?: number;
      contingencyPercent?: number;
      rooms?: RoomRates[];
      extraLines?: ExtraCost[];
    };
    furniture: Furniture[];
    materials: { targetType: string; targetId: string; materialId: string }[];
    cameraViews: {
      id: string;
      floorId: string;
      roomId: string;
      positionMm: Vec3;
      targetMm: Vec3;
      fovDeg: number;
      aspectRatio: number;
    }[];
    catalogSnapshot: CatalogEntry[];
  };
}
export type Floor = Scene['floors'][number];
export interface RoomRates {
  roomId: string;
  enabled: boolean;
  floorMaterialMinor?: number | null;
  floorLaborMinor?: number | null;
  wallMaterialMinor?: number | null;
  wallLaborMinor?: number | null;
  ceilingMaterialMinor?: number | null;
  ceilingLaborMinor?: number | null;
}
export interface ExtraCost {
  id: string;
  title: string;
  roomId?: string | null;
  category: 'material' | 'labor' | 'electrical' | 'plumbing' | 'other';
  quantity: number;
  unit: string;
  unitPriceMinor: number | null;
}
export interface Stair {
  id: string;
  startMm: Vec2;
  endMm: Vec2;
  widthMm: number;
  targetFloorId: string;
  stepCount: number;
}
export interface HomeTemplate {
  id: string;
  name: string;
  tag: string;
  description: string;
  areaM2: number;
  outdoorAreaM2?: number;
  floorCount: number;
  roomCount: number;
  scenePreview: Scene;
}
export interface Project {
  id: string;
  name: string;
  description: string;
  revision: number;
  confirmationBasis?: 'user_measured' | 'demo' | null;
  geometryStatus?: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  currentGeometryId: string | null;
  currentDesignId: string | null;
  areaM2?: number;
  rooms?: number;
  styleId?: string;
  scenePreview?: Scene;
}
export interface ProjectPage {
  items: Project[];
  total: number;
  activeTotal: number;
  offset: number;
  nextCursor: string | null;
}
export interface User {
  id: string;
  email: string;
  displayName: string;
  isDemo: boolean;
  role: string;
}
export interface Working {
  scene: Scene;
  revision: number;
  baseDesignId: string | null;
  updatedAt: string;
}
export interface Design {
  id: string;
  projectId: string;
  title: string;
  geometryVersionId: string;
  scene: Scene;
  sceneHash: string;
  createdAt: string;
  parentDesignId: string | null;
}
export interface Geometry {
  id: string;
  structureHash: string;
  status: string;
}
export interface Issue {
  code: string;
  message: string;
  objectIds: string[];
  field: string;
  severity: string;
}
export interface Validation {
  valid: boolean;
  issues: Issue[];
  structureHash?: string;
}
export interface Asset {
  id: string;
  name: string;
  kind: string;
  mediaType: string;
  bytes: number;
  roomId: string | null;
  url: string;
  thumbUrl?: string | null;
  metadata: Record<string, unknown>;
}
export interface Job {
  id: string;
  type: string;
  status: string;
  stage: string;
  progress: number;
  createdAt: string;
  output: { designIds?: string[]; assets?: Asset[]; note?: string; limitations?: string[] };
  error: { code: string; message: string } | null;
  chargedCredits: number;
  reservedCredits?: number;
  currentlyReservedCredits?: number;
  creditState?: string;
  providerBillingUncertain?: boolean;
}
export interface Item {
  id: string;
  name: string;
  category: string;
  sizeMm: Vec3;
  priceMinor: number | null;
  color: string;
  group?: string;
  modelKind?: string;
  baseZMm?: number;
  placement?: 'floor' | 'wall' | 'surface';
  keywords?: string[];
}
export interface Style {
  id: string;
  name: string;
  description: string;
  floor: string;
  wall: string;
  accent: string;
  color: string;
}
export interface Capabilities {
  aiImage: boolean;
  aiInpaint?: boolean;
  aiInpaintCredits?: number;
  aiPlan?: boolean;
  aiPlanCredits?: number;
  aiCreditsPerImage: number;
  aiModels?: string[];
  aiConfigurationError?: string | null;
  structuralAuditEnabled?: boolean;
  structuralAuditModel?: string | null;
  demo: boolean;
  registration: boolean;
  payment: boolean;
  email: boolean;
  features: Record<string, unknown>;
}

export interface SceneCapture {
  imageDataUrl: string;
  roomId: string;
  scene: Scene;
  camera: {
    positionMm: Vec3;
    targetMm: Vec3;
    fovDeg: number;
    aspectRatio: number;
  };
}
