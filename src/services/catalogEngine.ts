import {
  CatalogItem,
  CategoryFilter,
  ModuleId,
  ProjectLibraryItem,
} from '../types/sowveil';

export interface CatalogFilterOptions {
  moduleId?: ModuleId;
  categoryId?: string; // 'all' | 'favorites' | specific categoryId
  searchQuery?: string;
  sortBy?: 'name' | 'newest' | 'favorites';
  favoriteIds?: string[];
  categories?: CategoryFilter[];
}

export function sanitizeSearchQuery(raw?: string): string {
  if (!raw) return '';
  return raw.trim().slice(0, 120).toLowerCase();
}

export function filterAndSortCatalogItems(
  items: CatalogItem[],
  options: CatalogFilterOptions
): CatalogItem[] {
  const {
    moduleId,
    categoryId = 'all',
    searchQuery = '',
    sortBy = 'name',
    favoriteIds = [],
    categories = [],
  } = options;

  const favSet = new Set(favoriteIds);
  const categoryLabelMap = new Map<string, string>();
  for (const cat of categories) {
    categoryLabelMap.set(cat.id, cat.label.toLowerCase());
  }

  const cleanQuery = sanitizeSearchQuery(searchQuery);

  return items
    .filter((item) => {
      if (item.visibility !== 'published') return false;
      if (moduleId && item.moduleId !== moduleId) return false;

      if (categoryId === 'favorites' && !favSet.has(item.id)) {
        return false;
      }
      if (
        categoryId !== 'all' &&
        categoryId !== 'favorites' &&
        item.categoryId !== categoryId
      ) {
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
      if (sortBy === 'newest') {
        const cmp = b.createdAt.localeCompare(a.createdAt);
        if (cmp !== 0) return cmp;
      }
      return a.name.localeCompare(b.name);
    });
}

export function computeActualCategoryCounts(
  moduleItems: CatalogItem[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of moduleItems) {
    if (item.visibility !== 'published') continue;
    counts[item.categoryId] = (counts[item.categoryId] || 0) + 1;
  }
  return counts;
}

export function computeActualModuleCounts(
  allItems: CatalogItem[],
  projects: ProjectLibraryItem[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of allItems) {
    if (item.visibility !== 'published') continue;
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
