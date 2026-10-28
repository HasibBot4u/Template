import {
  CapabilityType,
  CatalogItem,
  CategoryFilter,
  ModuleId,
  ProjectLibraryItem,
  TemplateLicenseType,
  TemplateValidationState,
} from '../types/sowveil';

export interface CatalogFilterOptions {
  moduleId?: ModuleId;
  categoryId?: string; // 'all' | 'favorites' | 'recent' | specific categoryId
  capabilityType?: CapabilityType | 'all';
  validationState?: TemplateValidationState | 'all';
  licenseType?: TemplateLicenseType | 'all';
  searchQuery?: string;
  sortBy?: 'name' | 'newest' | 'updated' | 'favorites' | 'recent';
  favoritesOnly?: boolean;
  favoriteIds?: string[];
  recentOnly?: boolean;
  recentIds?: string[];
  statusFilter?: string;
  categories?: CategoryFilter[];
  viewerUid?: string | null;
  viewerIsAdmin?: boolean;
  includeDraftOrArchived?: boolean;
}

export function sanitizeSearchQuery(raw?: string): string {
  if (!raw) return '';
  return raw.trim().slice(0, 120).toLowerCase();
}

/**
 * Determines whether a caller is permitted to see a catalog item in search/filter results.
 * - 'published' / 'public' / 'community' items are visible to everyone.
 * - 'private' items are strictly visible ONLY to their ownerUid (never to another user).
 * - 'draft' / 'archived' items require includeDraftOrArchived + (ownerUid === viewerUid || viewerIsAdmin).
 */
export function isCatalogItemVisibleToViewer(
  item: CatalogItem,
  viewerUid?: string | null,
  viewerIsAdmin = false,
  includeDraftOrArchived = true
): boolean {
  if (item.visibility === 'private') {
    return Boolean(viewerUid && item.ownerUid === viewerUid);
  }
  if (item.visibility === 'draft' || item.visibility === 'archived') {
    if (!includeDraftOrArchived) return false;
    return Boolean(viewerIsAdmin || (viewerUid && item.ownerUid === viewerUid));
  }
  // 'published', 'public', 'community'
  return true;
}

export function filterAndSortCatalogItems(
  items: CatalogItem[],
  options: CatalogFilterOptions
): CatalogItem[] {
  const {
    moduleId,
    categoryId = 'all',
    capabilityType = 'all',
    validationState = 'all',
    licenseType = 'all',
    searchQuery = '',
    sortBy = 'name',
    favoritesOnly = false,
    favoriteIds = [],
    recentOnly = false,
    recentIds = [],
    statusFilter = 'all',
    categories = [],
    viewerUid = null,
    viewerIsAdmin = false,
    includeDraftOrArchived = true,
  } = options;

  const favSet = new Set(favoriteIds);
  const recentOrderMap = new Map<string, number>();
  recentIds.forEach((id, idx) => recentOrderMap.set(id, idx));

  const categoryLabelMap = new Map<string, string>();
  for (const cat of categories) {
    categoryLabelMap.set(cat.id, cat.label.toLowerCase());
  }

  const cleanQuery = sanitizeSearchQuery(searchQuery);

  return items
    .filter((item) => {
      if (
        !isCatalogItemVisibleToViewer(
          item,
          viewerUid,
          viewerIsAdmin,
          includeDraftOrArchived
        )
      ) {
        return false;
      }

      if (moduleId && item.moduleId !== moduleId) return false;

      if ((categoryId === 'favorites' || favoritesOnly) && !favSet.has(item.id)) {
        return false;
      }
      if ((categoryId === 'recent' || recentOnly) && !recentOrderMap.has(item.id)) {
        return false;
      }
      if (statusFilter && statusFilter !== 'all' && item.status !== statusFilter) {
        return false;
      }
      if (
        categoryId !== 'all' &&
        categoryId !== 'favorites' &&
        categoryId !== 'recent' &&
        item.categoryId !== categoryId
      ) {
        return false;
      }

      if (capabilityType && capabilityType !== 'all' && item.capabilityType !== capabilityType) {
        return false;
      }

      if (
        validationState &&
        validationState !== 'all' &&
        (item.validationState || 'Validated') !== validationState
      ) {
        return false;
      }

      if (licenseType && licenseType !== 'all' && item.licenseType !== licenseType) {
        return false;
      }

      if (cleanQuery.length > 0) {
        const nameMatch = item.name.toLowerCase().includes(cleanQuery);
        const packMatch = item.packLabel.toLowerCase().includes(cleanQuery);
        const catLabel = categoryLabelMap.get(item.categoryId) || '';
        const catMatch = catLabel.includes(cleanQuery);
        const summaryMatch = item.summary.toLowerCase().includes(cleanQuery);
        const descMatch = item.description.toLowerCase().includes(cleanQuery);
        const tagMatch = item.tags.some((t) => t.toLowerCase().includes(cleanQuery));

        return (
          nameMatch ||
          packMatch ||
          catMatch ||
          summaryMatch ||
          descMatch ||
          tagMatch
        );
      }

      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'favorites') {
        const aFav = favSet.has(a.id) ? 1 : 0;
        const bFav = favSet.has(b.id) ? 1 : 0;
        if (aFav !== bFav) return bFav - aFav;
      }
      if (sortBy === 'recent') {
        const aRec = recentOrderMap.has(a.id) ? recentOrderMap.get(a.id)! : 999999;
        const bRec = recentOrderMap.has(b.id) ? recentOrderMap.get(b.id)! : 999999;
        if (aRec !== bRec) return aRec - bRec;
      }
      if (sortBy === 'newest') {
        const cmp = b.createdAt.localeCompare(a.createdAt);
        if (cmp !== 0) return cmp;
      }
      if (sortBy === 'updated') {
        const cmp = b.updatedAt.localeCompare(a.updatedAt);
        if (cmp !== 0) return cmp;
      }
      return a.name.localeCompare(b.name);
    });
}

export const filterAndSortCatalog = filterAndSortCatalogItems;

export function computeActualCategoryCounts(
  moduleItems: CatalogItem[],
  viewerUid?: string | null
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of moduleItems) {
    if (!isCatalogItemVisibleToViewer(item, viewerUid, false, false)) continue;
    counts[item.categoryId] = (counts[item.categoryId] || 0) + 1;
  }
  return counts;
}

export function computeActualModuleCounts(
  allItems: CatalogItem[],
  projects: ProjectLibraryItem[],
  viewerUid?: string | null
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of allItems) {
    if (!isCatalogItemVisibleToViewer(item, viewerUid, false, false)) continue;
    counts[item.moduleId] = (counts[item.moduleId] || 0) + 1;
  }
  counts['project-library'] = projects.filter((p) => !p.archived).length;
  return counts;
}

export function supportsInteractiveTemplateComparison(item: CatalogItem): boolean {
  return Boolean(
    item.supportsTemplateComparison &&
      Array.isArray(item.editableParams) &&
      item.editableParams.length > 0
  );
}
