import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AssetMetadataRecord,
  CatalogItem,
  CategoryFilter,
  CompanionState,
  JobRecord,
  ModuleDefinition,
  ProjectLibraryItem,
  ReplaceableMediaSlot,
  TargetMobileEditorId,
  TemplateValidationEvidence,
  TemplateValidationState,
  TemplateVariantInstance,
} from '../types/sowveil';
import {
  computeActualCategoryCounts,
  filterAndSortCatalogItems,
  supportsInteractiveTemplateComparison,
} from '../services/catalogEngine';
import {
  enrichCatalogItemWithMarketplaceDefaults,
  forkTemplateFromVariant,
  runTemplateValidationJob,
} from '../services/marketplaceEngine';
import {
  deleteLocalTemplateVariant,
  getLocalForkedTemplates,
  getRecentCatalogItemIds,
  getSavedTemplateVariants,
  getStarterAndUserAssets,
  recordRecentCatalogItemId,
  saveLocalForkedTemplate,
  saveLocalTemplateVariant,
  saveStarterAndUserAssets,
} from '../repositories/workspaceRepository';
import { PreviewRenderer } from './PreviewRenderer';
import { ExportOpenInModal } from './ExportOpenInModal';
import { AssetLibraryModal } from './AssetLibraryModal';
import { MobileProEditorModal } from './MobileProEditorModal';
import {
  canonicalProjectToLibraryRecord,
  createCanonicalProjectFromTemplate,
} from '../services/canonicalProjectEngine';
import {
  ArrowLeft,
  BookmarkPlus,
  CheckCircle2,
  Clock,
  FolderOpen,
  GitFork,
  Search,
  Share2,
  ShieldCheck,
  Smartphone,
  Star,
  Trash2,
  X,
} from 'lucide-react';

interface CatalogBrowserWorkspaceProps {
  moduleDef: ModuleDefinition;
  items: CatalogItem[];
  categories: CategoryFilter[];
  favoriteIds: string[];
  onToggleFavorite: (itemId: string) => Promise<void> | void;
  companion: CompanionState;
  reducedMotion: boolean;
  defaultSortOrder?: 'name' | 'newest' | 'favorites' | 'updated' | 'recent';
  preserveSearchOnModuleSwitch?: boolean;
  onQueueJob: (
    job: Omit<
      JobRecord,
      'id' | 'createdAt' | 'updatedAt' | 'requestId' | 'attemptCount' | 'idempotencyKey'
    >
  ) => void;
  onSaveProject?: (proj: Omit<ProjectLibraryItem, 'id' | 'updatedAt'>) => Promise<void> | void;
  onNotify: (message: string, tone?: 'info' | 'warning' | 'error' | 'success') => void;
}

export const CatalogBrowserWorkspace: React.FC<CatalogBrowserWorkspaceProps> = ({
  moduleDef,
  items,
  categories,
  favoriteIds,
  onToggleFavorite,
  companion,
  reducedMotion,
  defaultSortOrder = 'name',
  preserveSearchOnModuleSwitch = false,
  onQueueJob,
  onSaveProject,
  onNotify,
}) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const initialCat = searchParams.get('cat') || 'all';
  const initialQuery = searchParams.get('q') || '';
  const initialSort =
    (searchParams.get('sort') as 'name' | 'newest' | 'favorites' | 'updated' | 'recent') ||
    defaultSortOrder;
  const initialItem = searchParams.get('item') || items[0]?.id || '';

  const [selectedCategory, setSelectedCategory] = useState<string>(initialCat);
  const [selectedPackFilter, setSelectedPackFilter] = useState<string>('all');
  const [rawSearchInput, setRawSearchInput] = useState<string>(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState<string>(initialQuery);
  const [sortBy, setSortBy] = useState<'name' | 'newest' | 'favorites' | 'updated' | 'recent'>(
    initialSort
  );
  const [selectedItemId, setSelectedItemId] = useState<string>(initialItem);
  const [comparisonMode, setComparisonMode] = useState<'template' | 'edits'>('template');
  const [customValues, setCustomValues] = useState<Record<string, string | number | boolean>>({});
  const [mobilePane, setMobilePane] = useState<'catalog' | 'inspector'>('catalog');
  const [sfxVolumeDb, setSfxVolumeDb] = useState<number>(0);
  const [bgTargetLayerMode, setBgTargetLayerMode] = useState<'new' | 'selected'>('new');
  const [carouselSwatches, setCarouselSwatches] = useState<string[]>([
    '#F06464',
    '#F06424',
    '#E4B45A',
    '#55B98B',
    '#38BDF8',
    '#818CF8',
    '#E879F9',
    '#FB7185',
  ]);
  const [exportModalState, setExportModalState] = useState<{
    open: boolean;
    initialEditor: TargetMobileEditorId;
  }>({ open: false, initialEditor: 'capcut' });

  // Marketplace & Variant State
  const [forkedTemplates, setForkedTemplates] = useState<CatalogItem[]>(() =>
    getLocalForkedTemplates()
  );
  const [recentItemIds, setRecentItemIds] = useState<string[]>(() => getRecentCatalogItemIds());
  const [savedVariants, setSavedVariants] = useState<TemplateVariantInstance[]>([]);
  const [activeVariantId, setActiveVariantId] = useState<string>('');
  const [variantNameInput, setVariantNameInput] = useState<string>('');
  const [assetSlotBindings, setAssetSlotBindings] = useState<Record<string, string>>({});
  const [assetModalState, setAssetModalState] = useState<{
    open: boolean;
    targetSlot: ReplaceableMediaSlot | null;
  }>({ open: false, targetSlot: null });
  const [libraryAssets, setLibraryAssets] = useState<AssetMetadataRecord[]>(() =>
    getStarterAndUserAssets()
  );
  const [validationReceipts, setValidationReceipts] = useState<
    Record<string, { state: TemplateValidationState; evidence: TemplateValidationEvidence }>
  >({});
  const [isProEditorOpen, setIsProEditorOpen] = useState<boolean>(false);

  // Combine module items with any user-forked templates in this module
  const combinedItems = useMemo(() => {
    const moduleForks = forkedTemplates.filter((f) => f.moduleId === moduleDef.id);
    const existingIds = new Set(items.map((i) => i.id));
    const uniqueForks = moduleForks.filter((f) => !existingIds.has(f.id));
    return [...uniqueForks, ...items];
  }, [items, forkedTemplates, moduleDef.id]);

  // Debounce search input by 180ms
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(rawSearchInput);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [rawSearchInput]);

  // Sync URL query params so returning to or bookmarking a view preserves state
  useEffect(() => {
    const nextParams = new URLSearchParams();
    if (selectedCategory !== 'all') nextParams.set('cat', selectedCategory);
    if (debouncedQuery.trim()) nextParams.set('q', debouncedQuery.trim());
    if (sortBy !== 'name') nextParams.set('sort', sortBy);
    if (selectedItemId) nextParams.set('item', selectedItemId);
    setSearchParams(nextParams, { replace: true });
  }, [selectedCategory, debouncedQuery, sortBy, selectedItemId]);

  // Reset category and selection when module changes (unless preserveSearchOnModuleSwitch is enabled)
  useEffect(() => {
    setSelectedCategory('all');
    setSelectedPackFilter('all');
    if (!preserveSearchOnModuleSwitch) {
      setRawSearchInput('');
      setDebouncedQuery('');
    }
    setSelectedItemId(items[0]?.id || '');
    setComparisonMode('template');
  }, [moduleDef.id]);

  useEffect(() => {
    setSelectedPackFilter('all');
  }, [selectedCategory]);

  // Keyboard shortcut: '/' focuses search input when not typing in an input/textarea
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const moduleFavoritesCount = useMemo(
    () => combinedItems.filter((i) => favoriteIds.includes(i.id)).length,
    [combinedItems, favoriteIds]
  );

  const moduleRecentCount = useMemo(
    () => combinedItems.filter((i) => recentItemIds.includes(i.id)).length,
    [combinedItems, recentItemIds]
  );

  const categoryCounts = useMemo(
    () => computeActualCategoryCounts(combinedItems),
    [combinedItems]
  );

  const baseFilteredItems = useMemo(
    () =>
      filterAndSortCatalogItems(combinedItems, {
        moduleId: moduleDef.id,
        categoryId: selectedCategory === 'recent' ? 'all' : selectedCategory,
        searchQuery: debouncedQuery,
        sortBy,
        favoriteIds,
        recentOnly: selectedCategory === 'recent',
        recentIds: recentItemIds,
        categories,
      }),
    [
      combinedItems,
      moduleDef.id,
      selectedCategory,
      debouncedQuery,
      sortBy,
      favoriteIds,
      recentItemIds,
      categories,
    ]
  );

  const availablePacksInFilter = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of baseFilteredItems) {
      if (it.packLabel) {
        map.set(it.packLabel, (map.get(it.packLabel) || 0) + 1);
      }
    }
    return Array.from(map.entries()).map(([label, count]) => ({ label, count }));
  }, [baseFilteredItems]);

  const filteredItems = useMemo(() => {
    if (selectedPackFilter === 'all') return baseFilteredItems;
    return baseFilteredItems.filter((i) => i.packLabel === selectedPackFilter);
  }, [baseFilteredItems, selectedPackFilter]);

  const activeItemRaw = useMemo(
    () => filteredItems.find((i) => i.id === selectedItemId) || filteredItems[0] || null,
    [filteredItems, selectedItemId]
  );

  const activeItem = useMemo(() => {
    if (!activeItemRaw) return null;
    const enriched = enrichCatalogItemWithMarketplaceDefaults(activeItemRaw);
    const localReceipt = validationReceipts[enriched.id];
    if (localReceipt) {
      return {
        ...enriched,
        validationState: localReceipt.state,
        lastValidationRecord: localReceipt.evidence,
      };
    }
    return enriched;
  }, [activeItemRaw, validationReceipts]);

  useEffect(() => {
    if (!activeItem) return;
    const defaults: Record<string, string | number | boolean> = {};
    activeItem.editableParams?.forEach((p) => {
      defaults[p.key] = p.defaultValue;
    });
    const itemVariants = getSavedTemplateVariants(activeItem.id);
    setSavedVariants(itemVariants);
    setActiveVariantId('');
    setVariantNameInput(`${activeItem.name} — Edit 1`);
    setAssetSlotBindings({});
    setCustomValues(defaults);
    setComparisonMode('template');
    const updatedRecents = recordRecentCatalogItemId(activeItem.id);
    setRecentItemIds(updatedRecents);
  }, [activeItem?.id]);

  const isConnectorPaired = companion.status === 'Connected';

  const handleHostPrimaryAction = (item: CatalogItem) => {
    // Open Mobile Editor Gateway to configure preset and generate real artifacts
    setExportModalState({ open: true, initialEditor: 'capcut' });
    onNotify(
      `Opened Mobile Editor Gateway for "${item.name}". Configure preset parameters and generate validated exports for CapCut, Alight Motion, Node Video, or KineMaster.`,
      'info'
    );
  };

  const handleRecordNeedsSetupJob = (item: CatalogItem) => {
    onQueueJob({
      type: 'mobile-export',
      title: `${item.primaryActionLabel}: ${item.name}`,
      moduleId: item.moduleId,
      itemId: item.id,
      operation: item.supportedOperations[0] || 'exportPreset',
      status: 'needs-setup',
      deviceId: null,
      errorCode: 'RENDER_WORKER_NOT_CONFIGURED',
      redactedMessage: `Export job for "${item.name}" staged in Job History. Heavy background worker rendering requires server setup.`,
    });
    onNotify(
      `Recorded "${item.name}" in Job History with status "needs-setup".`,
      'info'
    );
  };

  const handleSecondaryAction = (item: CatalogItem) => {
    if (item.secondaryActionLabel === 'Reset values' || item.secondaryActionLabel === 'Reset') {
      const defaults: Record<string, string | number | boolean> = {};
      item.editableParams?.forEach((p) => {
        defaults[p.key] = p.defaultValue;
      });
      setCustomValues(defaults);
      setComparisonMode('template');
      onNotify(`Reset parameters for "${item.name}" to default template values.`, 'info');
      return;
    }

    if (item.secondaryActionLabel === 'Export JSON Scene Spec') {
      const spec = {
        schemaVersion: '1.0.0',
        generator: 'Sowveil Studio Carousel Builder',
        itemId: item.id,
        parameters: customValues,
        exportedAt: new Date().toISOString(),
      };
      const blob = new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${item.slug}-scene-spec.json`;
      a.click();
      URL.revokeObjectURL(url);
      onNotify(`Downloaded validated JSON scene specification (${item.slug}-scene-spec.json).`, 'success');
      return;
    }

    if (item.secondaryActionLabel === 'Download SVG') {
      const svgSource = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="1500" height="1500"><rect width="200" height="200" fill="#080707"/><path d="M90 20h20v70h70v20h-70v70H90v-70H20V90h70V20z" fill="#F06424"/></svg>`;
      const blob = new Blob([svgSource], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${item.slug}.svg`;
      a.click();
      URL.revokeObjectURL(url);
      onNotify(`Downloaded original vector SVG (${item.slug}.svg).`, 'success');
      return;
    }

    onNotify(
      `Action "${item.secondaryActionLabel}" is available through Mobile Editor Gateway export or paired device handoff.`,
      'info'
    );
  };

  const canCompareTemplate = activeItem
    ? supportsInteractiveTemplateComparison(activeItem)
    : false;

  const isTemplatesGalleryModule = moduleDef.id === 'templates';

  const handleSaveVariant = () => {
    if (!activeItem) return;
    const title = variantNameInput.trim() || `${activeItem.name} — Custom Edit`;
    const now = new Date().toISOString();
    const existing = savedVariants.find((v) => v.id === activeVariantId);
    const variant: TemplateVariantInstance = {
      id: existing ? existing.id : `var-${activeItem.id}-${Date.now()}`,
      baseTemplateId: activeItem.id,
      baseTemplateVersion: activeItem.templateSchemaVersion || '1.0.0',
      ownerUid: 'local_user',
      title,
      description: `Saved user edit instance for ${activeItem.name}`,
      parameterOverrides: { ...customValues },
      assetSlotBindings: { ...assetSlotBindings },
      timingOverrides: {
        durationSec: Number(customValues.durationSec || activeItem.metadata.durationSec || 3),
        fps: Number(customValues.fps || activeItem.metadata.fps || 60),
      },
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };
    const updatedList = saveLocalTemplateVariant(variant);
    const forThisItem = updatedList.filter((v) => v.baseTemplateId === activeItem.id);
    setSavedVariants(forThisItem);
    setActiveVariantId(variant.id);
    setComparisonMode('edits');
    onNotify(
      `Saved variant "${variant.title}" in Your edits without modifying the base template.`,
      'success'
    );
  };

  const handleLoadVariant = (variantId: string) => {
    if (!activeItem) return;
    if (!variantId) {
      const defaults: Record<string, string | number | boolean> = {};
      activeItem.editableParams?.forEach((p) => {
        defaults[p.key] = p.defaultValue;
      });
      setActiveVariantId('');
      setCustomValues(defaults);
      setAssetSlotBindings({});
      setComparisonMode('template');
      return;
    }
    const found = savedVariants.find((v) => v.id === variantId);
    if (!found) return;
    setActiveVariantId(found.id);
    setVariantNameInput(found.title || found.name || '');
    setCustomValues({ ...found.parameterOverrides });
    setAssetSlotBindings({ ...(found.assetSlotBindings || found.assetOverrides || {}) });
    setComparisonMode('edits');
    onNotify(`Loaded saved variant "${found.title}" into Your edits.`, 'info');
  };

  const handleDeleteVariant = (variantId: string) => {
    if (!activeItem || !variantId) return;
    const updated = deleteLocalTemplateVariant(variantId);
    setSavedVariants(updated.filter((v) => v.baseTemplateId === activeItem.id));
    if (activeVariantId === variantId) {
      setActiveVariantId('');
    }
    onNotify('Removed saved template variant.', 'info');
  };

  const handleForkTemplate = () => {
    if (!activeItem) return;
    const now = new Date().toISOString();
    const ephemeralVariant: TemplateVariantInstance = {
      id: activeVariantId || `var-fork-${Date.now()}`,
      baseTemplateId: activeItem.id,
      baseTemplateVersion: activeItem.templateSchemaVersion || '1.0.0',
      ownerUid: 'local_user',
      title: variantNameInput.trim() || `${activeItem.name} (Forked)`,
      description: `Forked standalone template from ${activeItem.name}`,
      parameterOverrides: { ...customValues },
      assetSlotBindings: { ...assetSlotBindings },
      timingOverrides: {
        durationSec: Number(customValues.durationSec || activeItem.metadata.durationSec || 3),
        fps: Number(customValues.fps || activeItem.metadata.fps || 60),
      },
      createdAt: now,
      updatedAt: now,
    };
    const forked = forkTemplateFromVariant(activeItem, ephemeralVariant, {
      newId: `fork-${activeItem.id}-${Date.now()}`,
      newTitle: `${activeItem.name} (Fork)`,
      ownerUid: 'local_user',
    });
    const nextForks = saveLocalForkedTemplate(forked);
    setForkedTemplates(nextForks);
    setSelectedItemId(forked.id);
    onNotify(
      `Forked "${activeItem.name}" into standalone private template "${forked.name}". Original template preserved.`,
      'success'
    );
  };

  const handleRunValidationJob = () => {
    if (!activeItem) return;
    const assets = getStarterAndUserAssets();
    const availableAssetIds = new Set<string>(assets.map((a) => a.id));
    Object.values(assetSlotBindings).forEach((id) => availableAssetIds.add(id));
    const candidateItem: CatalogItem = {
      ...activeItem,
      mediaRequirements: activeItem.mediaRequirements
        ? {
            ...activeItem.mediaRequirements,
            replaceableSlots: activeItem.mediaRequirements.replaceableSlots.map((slot) => ({
              ...slot,
              boundAssetId: assetSlotBindings[slot.slotId] ?? slot.boundAssetId,
            })),
          }
        : undefined,
    };
    const result = runTemplateValidationJob(candidateItem, availableAssetIds);
    setValidationReceipts((prev) => ({
      ...prev,
      [activeItem.id]: { state: result.nextValidationState, evidence: result.evidence },
    }));
    onNotify(
      `Validation job ${result.evidence.jobId} completed: status is "${result.nextValidationState}".`,
      result.evidence.passed ? 'success' : 'warning'
    );
  };

  const handleSelectAssetForSlot = (asset: AssetMetadataRecord) => {
    const slot = assetModalState.targetSlot;
    const displayTitle = asset.title || asset.name || asset.id;
    if (slot) {
      setAssetSlotBindings((prev) => ({ ...prev, [slot.slotId]: asset.id }));
      setCustomValues((prev) => ({ ...prev, [`slot_${slot.slotId}`]: displayTitle }));
      if (canCompareTemplate) setComparisonMode('edits');
      onNotify(`Bound asset "${displayTitle}" to slot "${slot.label}" in Your edits.`, 'success');
    }
    setAssetModalState({ open: false, targetSlot: null });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[calc(100vh-135px)] bg-[#090808]">
      {/* Mobile View Switcher (Android Portrait Ergonomics) */}
      {!isTemplatesGalleryModule && (
        <div className="lg:hidden border-b border-[#2A231E] bg-[#11100F] px-4 py-2 flex items-center justify-between gap-2">
          <div className="grid grid-cols-2 gap-1.5 flex-1">
            <button
              type="button"
              onClick={() => setMobilePane('catalog')}
              className={`min-h-[44px] rounded-xl text-xs font-semibold transition-colors ${
                mobilePane === 'catalog'
                  ? 'bg-[#F06424] text-[#080707]'
                  : 'bg-[#191614] text-[#B8AAA0] border border-[#342A24]'
              }`}
            >
              Catalog ({filteredItems.length})
            </button>
            <button
              type="button"
              onClick={() => setMobilePane('inspector')}
              className={`min-h-[44px] rounded-xl text-xs font-semibold transition-colors truncate px-2 ${
                mobilePane === 'inspector'
                  ? 'bg-[#F06424] text-[#080707]'
                  : 'bg-[#191614] text-[#B8AAA0] border border-[#342A24]'
              }`}
            >
              Inspector &amp; Export
            </button>
          </div>
        </div>
      )}

      {/* Left Region (or Full-Width Gallery for Module 17: Templates, frame 01:17) */}
      <div
        className={`${
          isTemplatesGalleryModule
            ? 'lg:col-span-12 border-b border-[#2A231E] p-4 sm:p-5 flex flex-col gap-3.5'
            : `lg:col-span-5 xl:col-span-5 border-b lg:border-b-0 lg:border-r border-[#2A231E] p-3.5 sm:p-4 flex flex-col gap-3 bg-[#0C0B0A] ${
                mobilePane === 'inspector' ? 'hidden lg:flex' : 'flex'
              }`
        }`}
      >
        {/* For Module 17 (Templates, frame 01:17), search bar appears at the very top */}
        {isTemplatesGalleryModule && (
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-[#83766D] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                ref={searchInputRef}
                type="search"
                value={rawSearchInput}
                onChange={(e) => setRawSearchInput(e.target.value)}
                placeholder={`Search ${combinedItems.length} templates`}
                aria-label={`Search ${moduleDef.label}`}
                className="w-full min-h-[40px] rounded-lg border border-[#2A231E] bg-[#141210] pl-8 pr-9 py-2 text-xs text-[#F3EEE8] placeholder:text-[#83766D]"
              />
              {rawSearchInput && (
                <button
                  type="button"
                  onClick={() => {
                    setRawSearchInput('');
                    setDebouncedQuery('');
                  }}
                  aria-label="Clear search query"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#83766D] hover:text-[#F3EEE8]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Interactive Filter Tabs matching reference pills */}
        <div
          role="tablist"
          aria-label={`${moduleDef.label} category filters`}
          className="flex flex-wrap items-center gap-1.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={selectedCategory === 'all'}
            onClick={() => setSelectedCategory('all')}
            className={`min-h-[34px] px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums flex items-center gap-1.5 ${
              selectedCategory === 'all'
                ? 'bg-[#F06424] text-[#080707] font-semibold'
                : 'bg-[#171412] text-[#B8AAA0] border border-[#2A231E] hover:text-[#F3EEE8]'
            }`}
          >
            <span>
              {moduleDef.id === 'text-animation' ? 'All text animations' : 'All'}
            </span>
            <span className={selectedCategory === 'all' ? 'text-[#080707]/85' : 'text-[#83766D]'}>
              {combinedItems.length}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={selectedCategory === 'favorites'}
            onClick={() => setSelectedCategory('favorites')}
            className={`min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums ${
              selectedCategory === 'favorites'
                ? 'bg-[#F06424] text-[#080707] font-semibold'
                : 'bg-[#171412] text-[#B8AAA0] border border-[#2A231E] hover:text-[#F3EEE8]'
            }`}
          >
            <Star className="w-3 h-3 fill-current" />
            <span>Favorites</span>
            <span
              className={
                selectedCategory === 'favorites' ? 'text-[#080707]/85' : 'text-[#83766D]'
              }
            >
              {moduleFavoritesCount}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={selectedCategory === 'recent'}
            onClick={() => setSelectedCategory('recent')}
            className={`min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums ${
              selectedCategory === 'recent'
                ? 'bg-[#F06424] text-[#080707] font-semibold'
                : 'bg-[#171412] text-[#B8AAA0] border border-[#2A231E] hover:text-[#F3EEE8]'
            }`}
          >
            <Clock className="w-3 h-3" />
            <span>Recent</span>
            <span
              className={
                selectedCategory === 'recent' ? 'text-[#080707]/85' : 'text-[#83766D]'
              }
            >
              {moduleRecentCount}
            </span>
          </button>

          {categories.map((cat) => {
            const actualCount = categoryCounts[cat.id] || 0;
            const isSelected = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => setSelectedCategory(cat.id)}
                className={`min-h-[34px] px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-[#F06424] text-[#080707] font-semibold'
                    : 'bg-[#171412] text-[#B8AAA0] border border-[#2A231E] hover:text-[#F3EEE8]'
                }`}
              >
                <span className="truncate max-w-[160px]">{cat.label}</span>
                <span className={isSelected ? 'text-[#080707]/85' : 'text-[#83766D]'}>
                  {actualCount}
                </span>
              </button>
            );
          })}
        </div>

        {/* Sub-pack / Folder Selector Dropdown matching frames 00:03-00:54 (e.g. Style - 2, Folder Scene 06, MAIN_RENDER) */}
        {!isTemplatesGalleryModule && availablePacksInFilter.length > 1 && (
          <div className="flex items-center gap-2">
            <select
              value={selectedPackFilter}
              onChange={(e) => setSelectedPackFilter(e.target.value)}
              aria-label="Filter by template pack or folder"
              className="w-full min-h-[36px] rounded-lg border border-[#2A231E] bg-[#141210] px-3 py-1.5 text-xs text-[#F3EEE8] font-medium"
            >
              <option value="all">
                All packs in view ({baseFilteredItems.length})
              </option>
              {availablePacksInFilter.map((pk) => (
                <option key={pk.label} value={pk.label}>
                  {pk.label} ({pk.count})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Search & Sort Controls for Modules 1-16 */}
        {!isTemplatesGalleryModule && (
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-[#83766D] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                ref={searchInputRef}
                type="search"
                value={rawSearchInput}
                onChange={(e) => setRawSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && rawSearchInput) {
                    e.preventDefault();
                    setRawSearchInput('');
                    setDebouncedQuery('');
                  }
                }}
                placeholder={`Search ${combinedItems.length} items in ${moduleDef.label}…`}
                aria-label={`Search ${moduleDef.label}`}
                className="w-full min-h-[38px] rounded-lg border border-[#2A231E] bg-[#141210] pl-8 pr-9 py-1.5 text-xs text-[#F3EEE8] placeholder:text-[#83766D]"
              />
              {rawSearchInput && (
                <button
                  type="button"
                  onClick={() => {
                    setRawSearchInput('');
                    setDebouncedQuery('');
                    searchInputRef.current?.focus();
                  }}
                  aria-label="Clear search query"
                  className="min-h-[38px] min-w-[38px] absolute right-0 top-1/2 -translate-y-1/2 inline-flex items-center justify-center text-[#83766D] hover:text-[#F3EEE8]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <select
              value={sortBy}
              onChange={(e) =>
                setSortBy(
                  e.target.value as 'name' | 'newest' | 'favorites' | 'updated' | 'recent'
                )
              }
              aria-label="Sort catalog items"
              className="min-h-[38px] rounded-lg border border-[#2A231E] bg-[#141210] px-2.5 py-1.5 text-xs text-[#B8AAA0]"
            >
              <option value="name">Sort: A–Z</option>
              <option value="favorites">Sort: ★ Fav</option>
              <option value="recent">Sort: Recent</option>
              <option value="updated">Sort: Updated</option>
              <option value="newest">Sort: New</option>
            </select>
          </div>
        )}

        {/* Card Grid: 5-column visual gallery for Module 17 (Templates, frame 01:17) vs 2-column dense selector for Modules 1-16 */}
        {filteredItems.length === 0 ? (
          <div className="rounded-xl border border-[#2A231E] bg-[#11100F] p-8 text-center space-y-2">
            <p className="text-sm font-semibold text-[#F3EEE8]">
              No matching items in {moduleDef.label}
            </p>
            <p className="text-xs text-[#B8AAA0]">
              {debouncedQuery
                ? `No records matched "${debouncedQuery}" in ${
                    selectedCategory === 'all' ? 'any category' : 'the selected filter'
                  }.`
                : selectedCategory === 'favorites'
                ? `You have not starred any favorites in ${moduleDef.label} yet.`
                : 'No records exist in this category filter yet.'}
            </p>
            <button
              type="button"
              onClick={() => {
                setSelectedCategory('all');
                setSelectedPackFilter('all');
                setRawSearchInput('');
                setDebouncedQuery('');
              }}
              className="mt-2 px-3 py-1.5 rounded-lg bg-[#191614] border border-[#342A24] text-xs font-medium text-[#F3EEE8] hover:border-[#83766D]"
            >
              Clear search &amp; filters
            </button>
          </div>
        ) : isTemplatesGalleryModule ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {filteredItems.map((item) => {
              const isSelected = activeItem?.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedItemId(item.id)}
                  className={`group text-left rounded-xl overflow-hidden border transition-all flex flex-col justify-between ${
                    isSelected
                      ? 'border-[#F06424] bg-[#1C1613] shadow-[0_0_0_1px_#F06424]'
                      : 'border-[#2A231E] bg-[#141210] hover:border-[#83766D]'
                  }`}
                >
                  {/* Visual Thumbnail Surface matching frame 01:17 */}
                  <div className="h-28 w-full bg-[#0D0C0B] border-b border-[#241E1A] flex items-center justify-center p-3 relative overflow-hidden">
                    {item.id === 'tpl-click-burst' && (
                      <div className="px-3.5 py-1.5 rounded-lg border border-[#F06424]/60 bg-[#1B1614] text-xs font-bold text-[#F3EEE8] shadow-[0_0_16px_rgba(240,100,36,0.3)]">
                        Click me
                      </div>
                    )}
                    {item.id === 'tpl-notification-stack' && (
                      <div className="space-y-1.5 w-32">
                        <div className="h-3 rounded bg-white/20 w-full" />
                        <div className="h-3 rounded bg-[#F06424]/50 w-4/5" />
                        <div className="h-3 rounded bg-white/15 w-3/5" />
                      </div>
                    )}
                    {item.id === 'tpl-analytics-card' && (
                      <div className="text-left w-32 p-2 rounded bg-[#181513] border border-[#2A231E]">
                        <div className="text-[9px] text-[#83766D] font-mono-tabular">REVENUE</div>
                        <div className="text-sm font-bold text-[#F3EEE8]">$86K</div>
                        <div className="flex items-end gap-1 h-6 mt-1">
                          <span className="w-2 h-3 bg-[#F06424]/50 rounded-xs" />
                          <span className="w-2 h-4 bg-[#F06424]/70 rounded-xs" />
                          <span className="w-2 h-6 bg-[#F06424] rounded-xs" />
                          <span className="w-2 h-5 bg-[#55B98B] rounded-xs" />
                        </div>
                      </div>
                    )}
                    {item.id === 'tpl-line-graph-draw' && (
                      <svg viewBox="0 0 120 48" className="w-28 h-12">
                        <polyline
                          fill="none"
                          stroke="#F06424"
                          strokeWidth="2.5"
                          points="4,40 30,28 55,32 85,14 114,8"
                        />
                        <circle cx="114" cy="8" r="3" fill="#F06424" />
                      </svg>
                    )}
                    {item.id === 'tpl-search-typing' && (
                      <div className="w-36 px-2.5 py-1.5 rounded border border-[#342A24] bg-[#181513] text-[10px] font-mono-tabular text-[#B8AAA0] flex items-center gap-1.5">
                        <Search className="w-3 h-3 text-[#F06424]" />
                        <span>motion design|</span>
                      </div>
                    )}
                    {item.id === 'tpl-chat-conversation' && (
                      <div className="space-y-1.5 w-32 text-[9px]">
                        <div className="px-2 py-1 rounded-lg bg-[#24201D] text-[#B8AAA0] w-4/5">
                          Ready to ship?
                        </div>
                        <div className="px-2 py-1 rounded-lg bg-[#3B82F6] text-white w-4/5 ml-auto">
                          Looks great!
                        </div>
                      </div>
                    )}
                    {item.id === 'tpl-pricing-cards' && (
                      <div className="flex items-center gap-1.5">
                        <div className="w-9 h-12 rounded border border-[#2A231E] bg-[#171412]" />
                        <div className="w-10 h-14 rounded border border-[#F06424] bg-[#241813] flex items-center justify-center text-[9px] font-bold text-[#F06424]">
                          PRO
                        </div>
                        <div className="w-9 h-12 rounded border border-[#2A231E] bg-[#171412]" />
                      </div>
                    )}
                    {item.id === 'tpl-toggle-switches' && (
                      <div className="space-y-1.5">
                        <div className="w-10 h-5 rounded-full bg-[#F06424] p-0.5 flex justify-end">
                          <span className="w-4 h-4 rounded-full bg-white" />
                        </div>
                        <div className="w-10 h-5 rounded-full bg-[#55B98B] p-0.5 flex justify-end">
                          <span className="w-4 h-4 rounded-full bg-white" />
                        </div>
                      </div>
                    )}
                    {item.id === 'tpl-loading-success' && (
                      <div className="w-9 h-9 rounded-full border-2 border-[#55B98B] bg-[#55B98B]/20 flex items-center justify-center text-[#55B98B] font-bold text-sm">
                        ✓
                      </div>
                    )}
                    {item.id === 'tpl-kinetic-title-slam' && (
                      <div className="text-center font-extrabold text-xs tracking-wider">
                        <div className="text-[#F3EEE8]">MAKE IT</div>
                        <div className="text-[#F06424] text-sm">MOVE</div>
                      </div>
                    )}
                    {item.id === 'tpl-night-drive' && (
                      <div className="text-xs font-mono-tabular font-bold tracking-[0.22em] text-[#38BDF8] drop-shadow-[0_0_8px_rgba(56,189,248,0.6)]">
                        NIGHT DRIVE
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <div className="font-semibold text-xs text-[#F3EEE8] truncate">
                      {item.name}
                    </div>
                    <div className="text-[11px] text-[#83766D] mt-0.5 truncate">
                      {item.packLabel}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 overflow-y-auto max-h-[600px] pr-1">
            {filteredItems.map((item) => {
              const isSelected = activeItem?.id === item.id;
              const isFav = favoriteIds.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSelectedItemId(item.id);
                    setMobilePane('inspector');
                  }}
                  className={`group text-left rounded-xl p-3 border transition-all flex flex-col justify-between min-h-[76px] ${
                    isSelected
                      ? 'border-[#F06424] bg-[#1E1612] shadow-[inset_0_0_0_1px_#F06424]'
                      : 'border-[#26201C] bg-[#141210] hover:bg-[#191614] hover:border-[#83766D]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 w-full">
                    {moduleDef.id === 'text-animation' ? (
                      <span className="font-serif font-bold text-base text-[#F06424] leading-none">
                        T
                      </span>
                    ) : moduleDef.id === 'expressions' ? (
                      <span className="font-mono-tabular font-bold text-xs text-[#F06424] leading-none">
                        fx
                      </span>
                    ) : (
                      <span className="text-[11px] font-mono-tabular text-[#F06424] truncate">
                        {item.packLabel}
                      </span>
                    )}
                    {isFav && (
                      <span className="text-[10px] font-mono-tabular text-[#F06424] shrink-0">
                        ★
                      </span>
                    )}
                  </div>
                  <div className="mt-2 font-semibold text-xs sm:text-sm text-[#F3EEE8] truncate w-full">
                    {item.name}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Right Region: Reference Preview & Detail Inspector Panel */}
      <div
        className={`${
          isTemplatesGalleryModule
            ? 'lg:col-span-12 p-4 sm:p-6 bg-[#0B0A09] border-t border-[#2A231E]'
            : `lg:col-span-7 xl:col-span-7 p-4 sm:p-6 bg-[#0B0A09] ${
                mobilePane === 'catalog' ? 'hidden lg:block' : 'block'
              }`
        }`}
      >
        {activeItem ? (
          <div className="space-y-4 max-w-2xl mx-auto">
            {!isTemplatesGalleryModule && (
              <button
                type="button"
                onClick={() => setMobilePane('catalog')}
                className="lg:hidden min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#342A24] bg-[#191614] text-xs font-medium text-[#B8AAA0]"
              >
                <ArrowLeft className="w-3.5 h-3.5 text-[#F06424]" />
                <span>Back to {moduleDef.label} List</span>
              </button>
            )}

            {/* Header: Item Title + Top-Right Action (+ Add to favorites OR New layer / Selected layer toggle for Animated gradients) */}
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-lg sm:text-xl font-bold text-[#F3EEE8] tracking-tight">
                  {activeItem.name}
                </h2>

                {/* Expressions Formula Pill (frame 00:11: value + amp*sin(2*π*f*t)) */}
                {activeItem.metadata.signature ? (
                  <div className="inline-block rounded-md border border-[#F06424]/40 bg-[#241610] px-2.5 py-0.5 font-mono-tabular text-xs text-[#F06424]">
                    {activeItem.metadata.signature}
                  </div>
                ) : activeItem.metadata.width && activeItem.metadata.height ? (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#B8AAA0] font-mono-tabular">
                    <span className="text-[#83766D]">{activeItem.packLabel}</span>
                    <span>
                      {activeItem.metadata.width} × {activeItem.metadata.height}
                    </span>
                    {activeItem.metadata.durationLabel && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{activeItem.metadata.durationLabel}</span>
                      </>
                    )}
                    {activeItem.metadata.fps && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{activeItem.metadata.fps} fps</span>
                      </>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-[#B8AAA0]">{activeItem.summary}</p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {activeItem.previewKind === 'background-gradient-builder' && (
                  <div className="inline-flex rounded-lg border border-[#2A231E] bg-[#141210] p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setBgTargetLayerMode('new')}
                      className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                        bgTargetLayerMode === 'new'
                          ? 'bg-[#2A1810] text-[#F06424] border border-[#F06424]/60'
                          : 'text-[#B8AAA0]'
                      }`}
                    >
                      New layer
                    </button>
                    <button
                      type="button"
                      onClick={() => setBgTargetLayerMode('selected')}
                      className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                        bgTargetLayerMode === 'selected'
                          ? 'bg-[#2A1810] text-[#F06424] border border-[#F06424]/60'
                          : 'text-[#B8AAA0]'
                      }`}
                    >
                      Selected layer
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => onToggleFavorite(activeItem.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    favoriteIds.includes(activeItem.id)
                      ? 'border-[#F06424] bg-[#211B17] text-[#F06424]'
                      : 'border-[#2A231E] bg-[#141210] text-[#B8AAA0] hover:text-[#F3EEE8]'
                  }`}
                >
                  <span>
                    {favoriteIds.includes(activeItem.id)
                      ? '★ Favorited'
                      : '+ Add to favorites'}
                  </span>
                </button>
              </div>
            </div>

            {/* Live Preview Surface */}
            <PreviewRenderer
              item={activeItem}
              comparisonMode={canCompareTemplate ? comparisonMode : 'edits'}
              customValues={customValues}
              reducedMotion={reducedMotion}
              onUpdateCustomValue={(key, val) => {
                setCustomValues((prev) => ({ ...prev, [key]: val }));
                if (canCompareTemplate) setComparisonMode('edits');
              }}
            />

            {/* Template / Your edits segmented toggle matching reference video frames 00:03-01:11 */}
            {canCompareTemplate && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#141210] border border-[#2A231E]">
                    <button
                      type="button"
                      onClick={() => setComparisonMode('template')}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                        comparisonMode === 'template'
                          ? 'bg-[#2A1810] text-[#F06424] border border-[#F06424]/60 font-semibold'
                          : 'text-[#B8AAA0] hover:text-[#F3EEE8]'
                      }`}
                    >
                      Template
                    </button>
                    <button
                      type="button"
                      onClick={() => setComparisonMode('edits')}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                        comparisonMode === 'edits'
                          ? 'bg-[#2A1810] text-[#F06424] border border-[#F06424]/60 font-semibold'
                          : 'text-[#B8AAA0] hover:text-[#F3EEE8]'
                      }`}
                    >
                      Your edits{savedVariants.length > 0 ? ` (${savedVariants.length})` : ''}
                    </button>
                  </div>

                  {savedVariants.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <select
                        value={activeVariantId}
                        onChange={(e) => handleLoadVariant(e.target.value)}
                        aria-label="Load saved template variant"
                        className="min-h-[30px] rounded-lg border border-[#2A231E] bg-[#141210] px-2.5 py-1 text-xs text-[#F3EEE8]"
                      >
                        <option value="">Base Template Defaults</option>
                        {savedVariants.map((v) => (
                          <option key={v.id} value={v.id}>
                            Variant: {v.title}
                          </option>
                        ))}
                      </select>
                      {activeVariantId && (
                        <button
                          type="button"
                          onClick={() => handleDeleteVariant(activeVariantId)}
                          aria-label="Delete selected variant"
                          className="p-1.5 rounded-lg border border-[#2A231E] bg-[#141210] text-[#B8AAA0] hover:text-[#FF6B6B]"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {comparisonMode === 'edits' && (
                  <div className="rounded-xl border border-[#2A231E] bg-[#141210] p-2.5 flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={variantNameInput}
                      onChange={(e) => setVariantNameInput(e.target.value)}
                      placeholder="Name your edit variant…"
                      aria-label="Variant name"
                      className="flex-1 min-w-[160px] rounded-lg border border-[#342A24] bg-[#191614] px-2.5 py-1.5 text-xs text-[#F3EEE8]"
                    />
                    <button
                      type="button"
                      onClick={handleSaveVariant}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F06424] text-[#080707] text-xs font-bold hover:bg-[#FF4B24]"
                    >
                      <BookmarkPlus className="w-3.5 h-3.5" />
                      <span>Save Variant</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleForkTemplate}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#342A24] bg-[#191614] text-xs font-medium text-[#F3EEE8] hover:border-[#F06424]"
                    >
                      <GitFork className="w-3.5 h-3.5 text-[#F06424]" />
                      <span>Fork template</span>
                    </button>
                  </div>
                )}

                <p className="text-xs text-[#83766D]">
                  This template is rendered by After Effects. Change anything below to see your version.
                </p>
              </div>
            )}

            {/* SFX Volume (dB) Slider before Add to comp button (matching frames 00:13-00:14) */}
            {activeItem.moduleId === 'sfx' && (
              <div className="flex items-center justify-between gap-4 pt-1">
                <span className="text-xs text-[#B8AAA0] shrink-0">Volume (dB)</span>
                <input
                  type="range"
                  min={-24}
                  max={12}
                  step={1}
                  value={sfxVolumeDb}
                  onChange={(e) => setSfxVolumeDb(Number(e.target.value))}
                  aria-label="Volume (dB)"
                  className="flex-1 accent-[#F06424]"
                />
                <span className="min-w-[36px] text-center px-2 py-1 rounded bg-[#141210] border border-[#2A231E] font-mono-tabular text-xs text-[#F3EEE8]">
                  {sfxVolumeDb}
                </span>
              </div>
            )}

            {/* Reference Primary Orange CTA Button + Secondary Ghost Button + Exact Helper Note */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => handleHostPrimaryAction(activeItem)}
                className="w-full min-h-[42px] py-2.5 px-4 rounded-lg bg-[#F06424] hover:bg-[#FF4B24] text-[#080707] font-bold text-xs sm:text-sm transition-colors flex items-center justify-center gap-2 shadow-md"
              >
                <span>{activeItem.primaryActionLabel}</span>
              </button>

              {(activeItem.secondaryActionLabel === 'Remove expressions from selection' ||
                activeItem.moduleId === 'text-animation' ||
                activeItem.moduleId === 'expressions') &&
                !canCompareTemplate && (
                  <button
                    type="button"
                    onClick={() =>
                      onNotify(
                        `Cleared expression overrides for "${activeItem.name}" in your active mobile preset configuration.`,
                        'info'
                      )
                    }
                    className="w-full min-h-[38px] py-2 px-4 rounded-lg border border-[#2A231E] bg-[#141210] hover:border-[#83766D] text-xs font-medium text-[#F3EEE8] transition-colors"
                  >
                    Remove expressions from selection
                  </button>
                )}

              <p className="text-xs text-[#83766D] leading-relaxed">
                {activeItem.moduleId === 'text-animation' && !canCompareTemplate
                  ? 'Select text layers, then Apply. It adds a Text Animator you can edit.'
                  : activeItem.moduleId === 'expressions'
                  ? 'Auto-applies to the properties you selected in the timeline; with only layers selected it uses Position.'
                  : activeItem.moduleId === 'easing'
                  ? 'Select keyframes in the timeline, then Apply.'
                  : activeItem.moduleId === 'sfx'
                  ? 'Adds the sound to the active comp at the playhead.'
                  : activeItem.id === 'lg-from-selection'
                  ? 'Wraps the selected layers into a refractive glass precomp above your background, with editable controls on the glass layer.'
                  : activeItem.id === 'car-builder-main'
                  ? 'Builds the carousel in the active comp at the current time: a control null (tilt), a spin null, the cards and a camera.'
                  : canCompareTemplate
                  ? 'Adds a ready-to-edit copy of this template into your active comp at the playhead.'
                  : activeItem.selectionRequirement}
              </p>
            </div>

            {/* SFX Folder Path Box matching frames 00:13-00:14 */}
            {activeItem.moduleId === 'sfx' && (
              <div className="space-y-1.5 pt-2">
                <div className="text-[10px] font-mono-tabular uppercase tracking-wider text-[#83766D]">
                  FOLDER
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 rounded-lg border border-[#2A231E] bg-[#141210] px-3 py-2 text-xs font-mono-tabular text-[#B8AAA0] truncate">
                    Documents/Sowveil Studio/SFX ({activeItem.packLabel})
                  </div>
                  <button
                    type="button"
                    onClick={() => handleHostPrimaryAction(activeItem)}
                    className="px-3 py-2 rounded-lg border border-[#2A231E] bg-[#141210] hover:border-[#83766D] text-xs font-medium text-[#F3EEE8]"
                  >
                    Export WAV
                  </button>
                </div>
              </div>
            )}

            {/* Carousel Builder CARDS & SHAPE sections matching frames 00:31-00:32 */}
            {activeItem.id === 'car-builder-main' && (
              <div className="space-y-4 rounded-xl border border-[#2A231E] bg-[#11100F] p-4">
                <div className="text-[10px] font-mono-tabular uppercase tracking-wider text-[#83766D]">
                  CARDS
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-[#B8AAA0]">Cards</span>
                  <div className="inline-flex rounded-lg border border-[#2A231E] bg-[#141210] p-0.5">
                    {(['Placeholders', 'Selected layers', 'Files'] as const).map((src) => {
                      const activeSrc = String(customValues.cardsSource || 'Placeholders');
                      return (
                        <button
                          key={src}
                          type="button"
                          onClick={() =>
                            setCustomValues((prev) => ({ ...prev, cardsSource: src }))
                          }
                          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                            activeSrc === src
                              ? 'bg-[#2A1810] text-[#F06424] border border-[#F06424]/60'
                              : 'text-[#B8AAA0]'
                          }`}
                        >
                          {src}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4 text-xs">
                  <span className="text-[#B8AAA0] shrink-0">Number of cards</span>
                  <input
                    type="range"
                    min={3}
                    max={16}
                    step={1}
                    value={Number(customValues.numberOfCards ?? 8)}
                    onChange={(e) =>
                      setCustomValues((prev) => ({
                        ...prev,
                        numberOfCards: Number(e.target.value),
                      }))
                    }
                    className="flex-1 accent-[#F06424]"
                  />
                  <span className="min-w-[36px] text-center px-2 py-1 rounded bg-[#141210] border border-[#2A231E] font-mono-tabular text-[#F3EEE8]">
                    {Number(customValues.numberOfCards ?? 8)}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {carouselSwatches.map((hex, idx) => (
                      <span
                        key={`${hex}-${idx}`}
                        style={{ backgroundColor: hex }}
                        className="w-6 h-6 rounded-full border border-white/25 shadow-sm"
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setCarouselSwatches((prev) => [...prev].sort(() => Math.random() - 0.5))
                    }
                    className="px-3 py-1.5 rounded-lg border border-[#2A231E] bg-[#141210] hover:border-[#83766D] text-xs font-medium text-[#F3EEE8]"
                  >
                    Shuffle
                  </button>
                </div>

                <div className="flex items-center justify-between gap-4 text-xs">
                  <span className="text-[#B8AAA0] shrink-0">Card size (% of width)</span>
                  <input
                    type="range"
                    min={6}
                    max={30}
                    step={1}
                    value={Number(customValues.cardSizePct ?? 13)}
                    onChange={(e) =>
                      setCustomValues((prev) => ({
                        ...prev,
                        cardSizePct: Number(e.target.value),
                      }))
                    }
                    className="flex-1 accent-[#F06424]"
                  />
                  <span className="min-w-[36px] text-center px-2 py-1 rounded bg-[#141210] border border-[#2A231E] font-mono-tabular text-[#F3EEE8]">
                    {Number(customValues.cardSizePct ?? 13)}
                  </span>
                </div>

                <div className="pt-2 border-t border-[#2A231E] space-y-2">
                  <div className="text-[10px] font-mono-tabular uppercase tracking-wider text-[#83766D]">
                    SHAPE
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-[#B8AAA0]">Arrange</span>
                    <div className="flex flex-wrap gap-1 justify-end">
                      {(
                        [
                          'Ring',
                          'Cover flow',
                          'Drum',
                          'Spiral',
                          'Sphere',
                          'Tilted orbit',
                        ] as const
                      ).map((arr) => {
                        const isSel =
                          String(customValues.arrangement || 'Tilted orbit') === arr;
                        return (
                          <button
                            key={arr}
                            type="button"
                            onClick={() =>
                              setCustomValues((prev) => ({ ...prev, arrangement: arr }))
                            }
                            className={`px-2.5 py-1 rounded-md text-xs font-medium border ${
                              isSel
                                ? 'bg-[#2A1810] text-[#F06424] border-[#F06424]'
                                : 'bg-[#141210] text-[#B8AAA0] border-[#2A231E]'
                            }`}
                          >
                            {arr}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Animated Gradients Specialty Controls matching frame 00:55 */}
            {activeItem.previewKind === 'background-gradient-builder' && (
              <div className="space-y-3 rounded-xl border border-[#2A231E] bg-[#11100F] p-4 text-xs">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[#B8AAA0] shrink-0">Blend</span>
                  <input
                    type="range"
                    min={20}
                    max={250}
                    step={5}
                    value={Number(customValues.blendAmount ?? 130)}
                    onChange={(e) =>
                      setCustomValues((prev) => ({
                        ...prev,
                        blendAmount: Number(e.target.value),
                      }))
                    }
                    className="flex-1 accent-[#F06424]"
                  />
                  <span className="min-w-[40px] text-center px-2 py-1 rounded bg-[#141210] border border-[#2A231E] font-mono-tabular text-[#F3EEE8]">
                    {Number(customValues.blendAmount ?? 130)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="text-[#B8AAA0]">Your palette</span>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={String(customValues.palettePreset || 'Midnight Ink')}
                      onChange={(e) =>
                        setCustomValues((prev) => ({
                          ...prev,
                          palettePreset: e.target.value,
                        }))
                      }
                      className="rounded-lg border border-[#2A231E] bg-[#141210] px-2.5 py-1 text-xs text-[#F3EEE8]"
                    >
                      <option value="Midnight Ink">Midnight Ink</option>
                      <option value="Solar Flare">Solar Flare</option>
                      <option value="Arctic Glass">Arctic Glass</option>
                      <option value="Emerald Matrix">Emerald Matrix</option>
                    </select>
                    <button
                      type="button"
                      onClick={() =>
                        onNotify(
                          `Saved palette "${String(customValues.palettePreset || 'Midnight Ink')}" to workspace presets.`,
                          'success'
                        )
                      }
                      className="px-2.5 py-1 rounded-lg border border-[#2A231E] bg-[#141210] text-[#F3EEE8]"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setCustomValues((prev) => ({
                          ...prev,
                          palettePreset: 'Midnight Ink',
                          blendAmount: 130,
                        }))
                      }
                      className="px-2.5 py-1 rounded-lg border border-[#2A231E] bg-[#141210] text-[#B8AAA0]"
                    >
                      Del
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Unboxed Tags */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#83766D]">
              <span>Tags:</span>
              {activeItem.tags.map((tag, idx) => (
                <React.Fragment key={tag}>
                  {idx > 0 && <span aria-hidden="true">·</span>}
                  <button
                    type="button"
                    onClick={() => setRawSearchInput(tag)}
                    className="text-[#B8AAA0] hover:text-[#F06424] underline-offset-2 hover:underline"
                  >
                    {tag}
                  </button>
                </React.Fragment>
              ))}
            </div>

            {/* Editable Parameters (PARAMETERS + Reset matching frames 01:12-01:16) */}
            {activeItem.editableParams && activeItem.editableParams.length > 0 && (
              <div className="rounded-xl border border-[#2A231E] bg-[#11100F] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono-tabular text-[#83766D] uppercase">
                    PARAMETERS
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const defaults: Record<string, string | number | boolean> = {};
                      activeItem.editableParams?.forEach((p) => {
                        defaults[p.key] = p.defaultValue;
                      });
                      setCustomValues(defaults);
                      setComparisonMode('template');
                    }}
                    className="px-2.5 py-1 rounded border border-[#2A231E] bg-[#141210] text-xs text-[#B8AAA0] hover:text-[#F3EEE8]"
                  >
                    Reset
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {activeItem.editableParams.map((param) => {
                    const currentVal = customValues[param.key] ?? param.defaultValue;
                    return (
                      <label key={param.key} className="block space-y-1">
                        <span className="text-xs text-[#B8AAA0] flex justify-between">
                          <span>{param.label}</span>
                          {param.type === 'number' && (
                            <span className="font-mono-tabular text-[#F3EEE8]">
                              {String(currentVal)}
                              {param.unit || ''}
                            </span>
                          )}
                        </span>
                        {param.type === 'text' && (
                          <input
                            type="text"
                            value={String(currentVal)}
                            onChange={(e) => {
                              setCustomValues((prev) => ({ ...prev, [param.key]: e.target.value }));
                              if (canCompareTemplate) setComparisonMode('edits');
                            }}
                            className="w-full rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-xs text-[#F3EEE8]"
                          />
                        )}
                        {param.type === 'number' && (
                          <input
                            type="range"
                            min={param.min ?? 0}
                            max={param.max ?? 100}
                            step={param.step ?? 1}
                            value={Number(currentVal)}
                            onChange={(e) => {
                              setCustomValues((prev) => ({
                                ...prev,
                                [param.key]: Number(e.target.value),
                              }));
                              if (canCompareTemplate) setComparisonMode('edits');
                            }}
                            className="w-full accent-[#F06424]"
                          />
                        )}
                        {param.type === 'color' && (
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={String(currentVal)}
                              onChange={(e) => {
                                setCustomValues((prev) => ({
                                  ...prev,
                                  [param.key]: e.target.value,
                                }));
                                if (canCompareTemplate) setComparisonMode('edits');
                              }}
                              className="h-7 w-10 rounded border border-[#342A24] bg-[#191614] cursor-pointer"
                            />
                            <span className="text-xs font-mono-tabular text-[#B8AAA0]">
                              {String(currentVal)}
                            </span>
                          </div>
                        )}
                        {param.type === 'select' && (
                          <select
                            value={String(currentVal)}
                            onChange={(e) => {
                              setCustomValues((prev) => ({ ...prev, [param.key]: e.target.value }));
                              if (canCompareTemplate) setComparisonMode('edits');
                            }}
                            className="w-full rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-xs text-[#F3EEE8]"
                          >
                            {param.options?.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Phase 6: Text Animation Authoring Controls (Font, Unit, Alignment, Alpha Strategy, Entry/Exit) */}
            {activeItem.moduleId === 'text-animation' && (
              <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono-tabular text-[#83766D] uppercase">
                    Typography, Unit &amp; Alpha Compositing
                  </span>
                  <span className="text-[11px] font-mono-tabular text-[#55B98B]">
                    Authorized Font Pack
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <label className="block space-y-1">
                    <span className="text-[#B8AAA0]">Font Family</span>
                    <select
                      value={String(customValues.fontFamily || 'Space Grotesk')}
                      onChange={(e) => {
                        setCustomValues((prev) => ({ ...prev, fontFamily: e.target.value }));
                        if (canCompareTemplate) setComparisonMode('edits');
                      }}
                      className="w-full min-h-[38px] rounded-lg border border-[#342A24] bg-[#191614] px-2.5 py-1.5 text-xs text-[#F3EEE8]"
                    >
                      <option value="Space Grotesk">Space Grotesk (OFL)</option>
                      <option value="Inter">Inter (OFL)</option>
                      <option value="JetBrains Mono">JetBrains Mono (OFL)</option>
                      <option value="System Sans (Roboto / Android Default)">
                        System Sans (Roboto · Native Android)
                      </option>
                    </select>
                  </label>

                  <label className="block space-y-1">
                    <span className="text-[#B8AAA0]">Animation Unit</span>
                    <select
                      value={String(customValues.unitMode || 'word')}
                      onChange={(e) => {
                        setCustomValues((prev) => ({ ...prev, unitMode: e.target.value }));
                        if (canCompareTemplate) setComparisonMode('edits');
                      }}
                      className="w-full min-h-[38px] rounded-lg border border-[#342A24] bg-[#191614] px-2.5 py-1.5 text-xs text-[#F3EEE8]"
                    >
                      <option value="word">By Word</option>
                      <option value="character">By Character</option>
                      <option value="line">By Line</option>
                    </select>
                  </label>

                  <label className="block space-y-1">
                    <span className="text-[#B8AAA0]">Alignment</span>
                    <select
                      value={String(customValues.textAlign || 'center')}
                      onChange={(e) => {
                        setCustomValues((prev) => ({ ...prev, textAlign: e.target.value }));
                        if (canCompareTemplate) setComparisonMode('edits');
                      }}
                      className="w-full min-h-[38px] rounded-lg border border-[#342A24] bg-[#191614] px-2.5 py-1.5 text-xs text-[#F3EEE8]"
                    >
                      <option value="center">Center</option>
                      <option value="left">Left</option>
                      <option value="right">Right</option>
                    </select>
                  </label>

                  <label className="block space-y-1">
                    <span className="text-[#B8AAA0]">Entry / Exit Mode</span>
                    <select
                      value={String(customValues.entryExitMode || 'Entry only')}
                      onChange={(e) => {
                        setCustomValues((prev) => ({ ...prev, entryExitMode: e.target.value }));
                        if (canCompareTemplate) setComparisonMode('edits');
                      }}
                      className="w-full min-h-[38px] rounded-lg border border-[#342A24] bg-[#191614] px-2.5 py-1.5 text-xs text-[#F3EEE8]"
                    >
                      <option value="Entry only">Entry only</option>
                      <option value="Entry + Hold + Exit">Entry + Hold + Exit</option>
                    </select>
                  </label>

                  <label className="block space-y-1">
                    <span className="text-[#B8AAA0]">Background / Alpha Strategy</span>
                    <select
                      value={String(customValues.backgroundMode || 'solid')}
                      onChange={(e) => {
                        setCustomValues((prev) => ({ ...prev, backgroundMode: e.target.value }));
                        if (canCompareTemplate) setComparisonMode('edits');
                      }}
                      className="w-full min-h-[38px] rounded-lg border border-[#342A24] bg-[#191614] px-2.5 py-1.5 text-xs text-[#F3EEE8]"
                    >
                      <option value="solid">Solid Studio Dark (#080707)</option>
                      <option value="transparent">Transparent Alpha Checkerboard</option>
                      <option value="chroma-key-green">Chroma Key Green (#00B140)</option>
                    </select>
                  </label>

                  <label className="block space-y-1">
                    <span className="text-[#B8AAA0]">Text Fill Color</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={String(customValues.fillColor || '#F3EEE8')}
                        onChange={(e) => {
                          setCustomValues((prev) => ({ ...prev, fillColor: e.target.value }));
                          if (canCompareTemplate) setComparisonMode('edits');
                        }}
                        className="h-8 w-11 rounded border border-[#342A24] bg-[#191614] cursor-pointer"
                      />
                      <span className="font-mono-tabular text-[#B8AAA0]">
                        {String(customValues.fillColor || '#F3EEE8')}
                      </span>
                    </div>
                  </label>
                </div>
              </div>
            )}

            {/* Phase 6: Interactive Cubic-Bezier Curve Editor for Easing Module */}
            {activeItem.moduleId === 'easing' && (
              <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono-tabular text-[#83766D] uppercase">
                    Interactive Cubic-Bezier Curve Handles
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const [dx1, dy1, dx2, dy2] = activeItem.metadata.curvePoints || [
                        0.16, 1, 0.3, 1,
                      ];
                      setCustomValues((prev) => ({
                        ...prev,
                        x1: dx1,
                        y1: dy1,
                        x2: dx2,
                        y2: dy2,
                      }));
                    }}
                    className="text-xs text-[#B8AAA0] hover:text-[#F3EEE8]"
                  >
                    Reset curve
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  {(
                    [
                      { key: 'x1', label: 'X1', idx: 0, min: 0, max: 1 },
                      { key: 'y1', label: 'Y1', idx: 1, min: -0.5, max: 1.5 },
                      { key: 'x2', label: 'X2', idx: 2, min: 0, max: 1 },
                      { key: 'y2', label: 'Y2', idx: 3, min: -0.5, max: 1.5 },
                    ] as const
                  ).map((h) => {
                    const fallback =
                      activeItem.metadata.curvePoints?.[h.idx] ??
                      (h.key === 'x1' ? 0.16 : h.key === 'y1' ? 1 : h.key === 'x2' ? 0.3 : 1);
                    const val = Number(customValues[h.key] ?? fallback);
                    return (
                      <label key={h.key} className="block space-y-1">
                        <span className="flex justify-between font-mono-tabular text-[#B8AAA0]">
                          <span>{h.label}</span>
                          <span className="text-[#F3EEE8]">{val.toFixed(2)}</span>
                        </span>
                        <input
                          type="range"
                          min={h.min}
                          max={h.max}
                          step={0.01}
                          value={val}
                          onChange={(e) =>
                            setCustomValues((prev) => ({
                              ...prev,
                              [h.key]: Number(e.target.value),
                            }))
                          }
                          className="w-full accent-[#F06424]"
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Primary Mobile-First Action: Export & Open In Mobile Editor */}
            <div className="space-y-3 rounded-2xl border border-[#F06424]/40 bg-[#14110F] p-4">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-mono-tabular text-[#F06424] flex items-center gap-1.5 font-semibold">
                  <Smartphone className="w-3.5 h-3.5" />
                  <span>MOBILE-FIRST EXPORT &amp; OPEN IN</span>
                </span>
                <span className="font-mono-tabular text-[#55B98B]">
                  No Desktop Required
                </span>
              </div>

              <button
                type="button"
                onClick={() =>
                  setExportModalState({ open: true, initialEditor: 'capcut' })
                }
                className="w-full min-h-[48px] py-3 px-4 rounded-xl bg-[#F06424] hover:bg-[#FF4B24] text-[#080707] font-bold text-sm transition-colors flex items-center justify-center gap-2 whitespace-nowrap shadow-lg"
              >
                <Share2 className="w-4 h-4" />
                <span>Export &amp; Open In Mobile Editor</span>
              </button>

              <button
                type="button"
                onClick={() => setIsProEditorOpen(true)}
                className="w-full min-h-[44px] py-2.5 px-4 rounded-xl border border-[#F06424]/60 bg-[#2A1810] hover:bg-[#361E14] text-xs font-bold text-[#F06424] transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <span>Open in Pro Timeline Editor (Canonical v2.0)</span>
              </button>

              {onSaveProject && (
                <button
                  type="button"
                  onClick={async () => {
                    const canonDoc = createCanonicalProjectFromTemplate({
                      template: activeItem,
                      variant: {
                        id: activeVariantId || `var_${activeItem.id}`,
                        ownerUid: 'user-local',
                        baseTemplateId: activeItem.id,
                        baseTemplateVersion: activeItem.metadata.version,
                        moduleId: activeItem.moduleId,
                        name: `${activeItem.name} (Customized)`,
                        title: `${activeItem.name} (Customized)`,
                        parameterOverrides: customValues,
                        assetSlotBindings,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                      },
                    });
                    const libRecord = canonicalProjectToLibraryRecord(canonDoc);
                    await onSaveProject({
                      ...libRecord,
                      tags: [
                        moduleDef.label,
                        activeItem.packLabel,
                        'Canonical v2.0',
                        'Customized',
                      ],
                    });
                    onNotify(
                      `Saved canonical project "${activeItem.name} (Customized)" to your Project Library (v2.0).`,
                      'success'
                    );
                  }}
                  className="w-full min-h-[42px] py-2 px-4 rounded-xl border border-[#342A24] bg-[#191614] hover:border-[#F06424] text-xs font-semibold text-[#F3EEE8] transition-colors"
                >
                  + Save Customized Preset to Project Library
                </button>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(
                  [
                    { id: 'capcut', label: 'CapCut' },
                    { id: 'alight-motion', label: 'Alight XML' },
                    { id: 'node-video', label: 'Node Video' },
                    { id: 'kinemaster', label: 'KineMaster' },
                  ] as const
                ).map((ed) => (
                  <button
                    key={ed.id}
                    type="button"
                    onClick={() =>
                      setExportModalState({
                        open: true,
                        initialEditor: ed.id,
                      })
                    }
                    className="min-h-[42px] px-2.5 py-2 rounded-xl border border-[#342A24] bg-[#191614] hover:border-[#F06424] text-xs font-medium text-[#F3EEE8] transition-colors truncate"
                  >
                    {ed.label} →
                  </button>
                ))}
              </div>

              {activeItem.secondaryActionLabel && (
                <button
                  type="button"
                  onClick={() => handleSecondaryAction(activeItem)}
                  className="w-full min-h-[42px] py-2 px-4 rounded-xl border border-[#342A24] bg-[#191614] hover:border-[#83766D] text-xs font-medium text-[#F3EEE8] transition-colors whitespace-nowrap"
                >
                  {activeItem.secondaryActionLabel}
                </button>
              )}

              {/* Optional Legacy / Diagnostic Host Bridge Status */}
              <div className="pt-2 border-t border-[#342A24]/70 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#83766D]">
                <span>
                  Optional Desktop Bridge:{' '}
                  {isConnectorPaired ? 'Connected' : 'Connector not paired (Not required on Android)'}
                </span>
                {!isConnectorPaired ? (
                  <button
                    type="button"
                    onClick={() => handleRecordNeedsSetupJob(activeItem)}
                    className="text-[#B8AAA0] hover:text-[#F06424] underline-offset-2 hover:underline whitespace-nowrap"
                  >
                    Log legacy host op in Jobs →
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleHostPrimaryAction(activeItem)}
                    className="text-[#F06424] hover:underline whitespace-nowrap"
                  >
                    {activeItem.primaryActionLabel} (Paired Sim) →
                  </button>
                )}
              </div>
            </div>

            {/* Replaceable Media Slots & Asset Library Integration */}
            <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-3.5 space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono-tabular text-[#83766D] uppercase">
                  MEDIA SLOTS &amp; ASSET LIBRARY
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleForkTemplate}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#342A24] bg-[#191614] text-[11px] font-medium text-[#F3EEE8] hover:border-[#F06424]"
                  >
                    <GitFork className="w-3 h-3 text-[#F06424]" />
                    <span>Fork template</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAssetModalState({ open: true, targetSlot: null })}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#F06424]/50 bg-[#241610] text-[11px] font-semibold text-[#F06424] hover:bg-[#2E1C14]"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>Open Asset Library</span>
                  </button>
                </div>
              </div>

              {activeItem.mediaRequirements &&
                activeItem.mediaRequirements.replaceableSlots.length > 0 && (
                  <div className="space-y-1.5 pt-1 border-t border-[#342A24]/60">
                    {activeItem.mediaRequirements.replaceableSlots.map((slot) => {
                      const boundId = assetSlotBindings[slot.slotId] || slot.boundAssetId;
                      return (
                        <div
                          key={slot.slotId}
                          className="flex items-center justify-between gap-2 rounded-lg border border-[#2A231E] bg-[#141210] px-2.5 py-1.5"
                        >
                          <div className="min-w-0">
                            <div className="font-medium text-[#F3EEE8] truncate">
                              {slot.label}{' '}
                              <span className="text-[10px] font-mono-tabular text-[#83766D]">
                                ({slot.acceptedKinds.join('/')})
                              </span>
                            </div>
                            <div className="text-[11px] font-mono-tabular text-[#B8AAA0] truncate">
                              Bound Asset:{' '}
                              <span className="text-[#55B98B]">
                                {boundId || 'Default starter slot'}
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setAssetModalState({ open: true, targetSlot: slot })
                            }
                            className="px-2.5 py-1 rounded-md border border-[#342A24] bg-[#191614] hover:border-[#F06424] text-[11px] font-medium text-[#F3EEE8] shrink-0"
                          >
                            Swap Asset
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
            </div>

            {/* Real Detail Metadata, Validation State & Capability Inspector */}
            <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-3.5 space-y-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 font-mono-tabular">
                <span className="text-[#83766D]">
                  MARKETPLACE, VALIDATION &amp; GATEWAY STATE
                </span>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] ${
                      activeItem.validationState === 'Validated'
                        ? 'border-[#55B98B]/50 bg-[#12261E] text-[#55B98B]'
                        : activeItem.validationState === 'Needs assets'
                        ? 'border-[#FF6B6B]/50 bg-[#2A1414] text-[#FF6B6B]'
                        : 'border-[#E4B45A]/50 bg-[#282012] text-[#E4B45A]'
                    }`}
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    <span>{activeItem.validationState || 'Validated'}</span>
                  </span>
                  <button
                    type="button"
                    onClick={handleRunValidationJob}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[#342A24] bg-[#191614] hover:border-[#F06424] text-[11px] text-[#F3EEE8]"
                  >
                    <ShieldCheck className="w-3 h-3 text-[#F06424]" />
                    <span>Run Validation Check</span>
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#342A24]/70 font-mono-tabular text-[11px] text-[#B8AAA0]">
                <div>Preview Type: {activeItem.previewKind}</div>
                <div>Mobile Formats: .xml, .zip, .svg, .sowveil.json</div>
                <div>Capability: {activeItem.capabilityType}</div>
                <div>License: {activeItem.licenseType}</div>
                <div>
                  Schema: v{activeItem.templateSchemaVersion || '2.0.0'} · Source v
                  {activeItem.sourceProjectVersion || '2.4.0'}
                </div>
                <div>
                  Versions: {activeItem.versionHistory?.length || 1} · Visibility:{' '}
                  {activeItem.visibility || 'published'}
                </div>
              </div>
              {activeItem.lastValidationRecord && (
                <div className="rounded-lg border border-[#2A231E] bg-[#141210] px-2.5 py-1.5 font-mono-tabular text-[11px] text-[#B8AAA0]">
                  Last Validation Job: <span className="text-[#F3EEE8]">{activeItem.lastValidationRecord.jobId}</span> ·{' '}
                  {activeItem.lastValidationRecord.summary}
                </div>
              )}
              <p className="text-[#B8AAA0] pt-1">{activeItem.statusReason}</p>
            </div>
          </div>
        ) : null}
      </div>

      {exportModalState.open && activeItem && (
        <ExportOpenInModal
          item={activeItem}
          customValues={customValues}
          reducedMotion={reducedMotion}
          initialEditor={exportModalState.initialEditor}
          onClose={() =>
            setExportModalState((prev) => ({ ...prev, open: false }))
          }
          onQueueJob={onQueueJob}
          onSaveProject={onSaveProject}
          onNotify={onNotify}
        />
      )}

      {assetModalState.open && (
        <AssetLibraryModal
          isOpen={assetModalState.open}
          onClose={() => setAssetModalState({ open: false, targetSlot: null })}
          assets={libraryAssets}
          onUpdateAssets={(nextAssets) => {
            setLibraryAssets(nextAssets);
            saveStarterAndUserAssets(nextAssets);
          }}
          activeModuleId={moduleDef.id}
          currentUserUid="local_user"
          selectionSlotLabel={assetModalState.targetSlot?.label || null}
          selectionAllowedKinds={assetModalState.targetSlot?.acceptedKinds}
          onSelectAssetForSlot={
            assetModalState.targetSlot ? handleSelectAssetForSlot : undefined
          }
          onNotify={(tone, title, detail) => onNotify(`${title}: ${detail}`, tone)}
        />
      )}

      {isProEditorOpen && activeItem && (
        <MobileProEditorModal
          isOpen={isProEditorOpen}
          onClose={() => setIsProEditorOpen(false)}
          sourceTemplate={activeItem}
          sourceVariant={
            savedVariants.find((v) => v.id === activeVariantId) || {
              id: `var_${activeItem.id}`,
              ownerUid: 'user-local',
              baseTemplateId: activeItem.id,
              baseTemplateVersion: activeItem.metadata.version,
              moduleId: activeItem.moduleId,
              name: `${activeItem.name} Variant`,
              parameterOverrides: customValues,
              assetSlotBindings,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
          }
          onSaveToProjectLibrary={async (record) => {
            if (onSaveProject) {
              await onSaveProject(record);
            }
          }}
          onNotify={onNotify}
        />
      )}
    </div>
  );
};
