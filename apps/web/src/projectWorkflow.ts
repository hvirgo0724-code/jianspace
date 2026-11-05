import type { Asset, Design, Project, Scene, Validation } from './types';

export type ProjectSort = 'updated' | 'name' | 'area';
export function selectProjects(
  projects: Project[],
  search: string,
  archived: boolean,
  status: string,
  sort: ProjectSort,
) {
  const term = search.trim().toLocaleLowerCase();
  return projects
    .filter((p) => p.archived === archived)
    .filter((p) => `${p.name} ${p.description}`.toLocaleLowerCase().includes(term))
    .filter((p) =>
      status === 'all'
        ? true
        : status === 'confirmed'
          ? p.geometryStatus === 'confirmed'
          : p.geometryStatus !== 'confirmed',
    )
    .sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id);
      if (sort === 'area') {
        const difference = (b.areaM2 ?? -1) - (a.areaM2 ?? -1);
        if (difference) return difference;
      }
      return b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
    });
}

export function projectReadiness(
  scene: Scene,
  designs: Design[],
  assets: Asset[],
  validation?: Validation,
) {
  const confirmed = scene.confirmation.status === 'confirmed';
  // A locally edited structure can retain its ID until the next save/confirmation.
  const currentDesigns = designs.filter(
    (d) =>
      confirmed &&
      d.geometryVersionId === scene.geometryVersionId &&
      JSON.stringify(d.scene.floors) === JSON.stringify(scene.floors),
  );
  const entries = new Map(scene.layout.catalogSnapshot.map((entry) => [entry.skuId, entry]));
  const unknownPrices = scene.layout.furniture.filter(
    (f) => entries.get(f.skuId)?.priceMinor == null,
  ).length;
  const roomsWithQuotes =
    scene.layout.renovation?.rooms?.filter(
      (r) =>
        r.enabled &&
        [
          r.floorMaterialMinor,
          r.floorLaborMinor,
          r.wallMaterialMinor,
          r.wallLaborMinor,
          r.ceilingMaterialMinor,
          r.ceilingLaborMinor,
        ].some((price) => price != null && Number.isFinite(price) && price >= 0),
    ).length || 0;
  const photos = assets.filter((a) => a.kind === 'photo');
  const errors = validation?.issues.filter((i) => i.severity === 'error') || [];
  const warnings = validation?.issues.filter((i) => i.severity !== 'error') || [];
  const validationState = !validation ? 'unavailable' : validation.valid ? 'passed' : 'failed';
  return {
    confirmed,
    currentDesigns,
    unknownPrices,
    roomsWithQuotes,
    photos,
    errors,
    warnings,
    validationState,
  };
}
