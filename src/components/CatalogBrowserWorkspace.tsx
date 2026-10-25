import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CatalogItem,
  CategoryFilter,
  CompanionState,
  JobRecord,
  ModuleDefinition,
  ProjectLibraryItem,
  TargetMobileEditorId,
} from '../types/sowveil';
import {
  computeActualCategoryCounts,
  filterAndSortCatalogItems,
  supportsInteractiveTemplateComparison,
} from '../services/catalogEngine';
import { PreviewRenderer } from './PreviewRenderer';
import { ExportOpenInModal } from './ExportOpenInModal';
import {
  ArrowLeft,
  Search,
  Share2,
  Smartphone,
  Star,
  X,
  Unplug,
  Sliders,
} from 'lucide-react';

interface CatalogBrowserWorkspaceProps {
  moduleDef: ModuleDefinition;
  items: CatalogItem[];
  categories: CategoryFilter[];
  favoriteIds: string[];
  onToggleFavorite: (itemId: string) => Promise<void> | void;
  companion: CompanionState;
  reducedMotion: boolean;
  defaultSortOrder?: 'name' | 'newest' | 'favorites';
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
    (searchParams.get('sort') as 'name' | 'newest' | 'favorites') || defaultSortOrder;
  const initialItem = searchParams.get('item') || items[0]?.id || '';

  const [selectedCategory, setSelectedCategory] = useState<string>(initialCat);
  const [rawSearchInput, setRawSearchInput] = useState<string>(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState<string>(initialQuery);
  const [sortBy, setSortBy] = useState<'name' | 'newest' | 'favorites'>(initialSort);
  const [selectedItemId, setSelectedItemId] = useState<string>(initialItem);
  const [comparisonMode, setComparisonMode] = useState<'template' | 'edits'>('template');
  const [customValues, setCustomValues] = useState<Record<string, string | number | boolean>>({});
  const [mobilePane, setMobilePane] = useState<'catalog' | 'inspector'>('catalog');
  const [exportModalState, setExportModalState] = useState<{
    open: boolean;
    initialEditor: TargetMobileEditorId;
  }>({ open: false, initialEditor: 'capcut' });

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
    if (!preserveSearchOnModuleSwitch) {
      setRawSearchInput('');
      setDebouncedQuery('');
    }
    setSelectedItemId(items[0]?.id || '');
    setComparisonMode('template');
  }, [moduleDef.id]);

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
    () => items.filter((i) => favoriteIds.includes(i.id)).length,
    [items, favoriteIds]
  );

  const categoryCounts = useMemo(() => computeActualCategoryCounts(items), [items]);

  const filteredItems = useMemo(
    () =>
      filterAndSortCatalogItems(items, {
        moduleId: moduleDef.id,
        categoryId: selectedCategory,
        searchQuery: debouncedQuery,
        sortBy,
        favoriteIds,
        categories,
      }),
    [items, moduleDef.id, selectedCategory, debouncedQuery, sortBy, favoriteIds, categories]
  );

  const activeItem = useMemo(
    () => filteredItems.find((i) => i.id === selectedItemId) || filteredItems[0] || null,
    [filteredItems, selectedItemId]
  );

  useEffect(() => {
    if (!activeItem) return;
    const defaults: Record<string, string | number | boolean> = {};
    activeItem.editableParams?.forEach((p) => {
      defaults[p.key] = p.defaultValue;
    });
    setCustomValues(defaults);
    setComparisonMode('template');
  }, [activeItem?.id]);

  const isConnectorPaired = companion.status === 'Connected';

  const handleHostPrimaryAction = (item: CatalogItem) => {
    // Browser-native actions (such as available vector SVG inspection) work without companion
    if (!moduleDef.requiresDesktop && item.status === 'Available') {
      onNotify(`Executed "${item.primaryActionLabel}" for "${item.name}".`, 'success');
      return;
    }

    if (!isConnectorPaired) {
      onNotify(
        `Connector not paired: Host operation "${item.supportedOperations[0] || item.primaryActionLabel}" is disabled until the After Effects Desktop Companion is paired.`,
        'warning'
      );
      return;
    }

    onQueueJob({
      type: 'ae-operation',
      title: `${item.primaryActionLabel}: ${item.name}`,
      moduleId: item.moduleId,
      itemId: item.id,
      operation: item.supportedOperations[0] || 'insertTemplateComp',
      status: 'queued',
      deviceId: companion.pairedDeviceName || 'local-paired-workstation',
      redactedMessage: `Queued ${item.supportedOperations[0]} for "${item.name}" in comp "${companion.aeActiveComp || 'Active Comp'}"`,
    });
    onNotify(`Queued "${item.name}" (${item.primaryActionLabel}) for After Effects.`, 'success');
  };

  const handleRecordNeedsSetupJob = (item: CatalogItem) => {
    onQueueJob({
      type: 'ae-operation',
      title: `${item.primaryActionLabel}: ${item.name}`,
      moduleId: item.moduleId,
      itemId: item.id,
      operation: item.supportedOperations[0] || 'insertTemplateComp',
      status: 'needs-setup',
      deviceId: null,
      errorCode: 'CONNECTOR_NOT_PAIRED',
      redactedMessage: `Connector not paired: "${item.name}" (${item.supportedOperations[0] || 'host op'}) logged in Job History as needs-setup.`,
    });
    onNotify(
      `Recorded "${item.name}" in Job History with status "needs-setup" (Connector not paired).`,
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
      `Host action "${item.secondaryActionLabel}" requires a paired After Effects Desktop Companion and active timeline selection.`,
      'warning'
    );
  };

  const canCompareTemplate = activeItem
    ? supportsInteractiveTemplateComparison(activeItem)
    : false;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[calc(100vh-145px)]">
      {/* Mobile View Switcher (Android Portrait Ergonomics) */}
      <div className="lg:hidden border-b border-[#342A24] bg-[#11100F] px-4 py-2 flex items-center justify-between gap-2">
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

      {/* Left Region: Category Filters, Debounced Search & Card Grid */}
      <div
        className={`lg:col-span-6 xl:col-span-6 border-b lg:border-b-0 lg:border-r border-[#342A24] p-4 sm:p-5 flex flex-col gap-4 ${
          mobilePane === 'inspector' ? 'hidden lg:flex' : 'flex'
        }`}
      >
        {/* Module Header & Real Operational Count */}
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="text-base font-bold text-[#F3EEE8] tracking-tight">
              {moduleDef.label}
            </h1>
            <p className="text-xs text-[#B8AAA0] mt-0.5">{moduleDef.description}</p>
          </div>
          <div className="text-xs font-mono-tabular text-[#B8AAA0] shrink-0">
            <span>Available records: {items.length}</span>
            <span aria-hidden="true"> · </span>
            <span>Showing: {filteredItems.length}</span>
          </div>
        </div>

        {/* Interactive Filter Tabs (Functional Buttons with real stored record counts) */}
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
            className={`min-h-[44px] px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums flex items-center ${
              selectedCategory === 'all'
                ? 'bg-[#F06424] text-[#080707] font-semibold'
                : 'bg-[#191614] text-[#B8AAA0] border border-[#342A24] hover:text-[#F3EEE8]'
            }`}
          >
            All {items.length}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={selectedCategory === 'favorites'}
            onClick={() => setSelectedCategory('favorites')}
            className={`min-h-[44px] inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums ${
              selectedCategory === 'favorites'
                ? 'bg-[#F06424] text-[#080707] font-semibold'
                : 'bg-[#191614] text-[#B8AAA0] border border-[#342A24] hover:text-[#F3EEE8]'
            }`}
          >
            <Star className="w-3.5 h-3.5" />
            <span>Favorites {moduleFavoritesCount}</span>
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
                className={`min-h-[44px] px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums flex items-center ${
                  isSelected
                    ? 'bg-[#F06424] text-[#080707] font-semibold'
                    : 'bg-[#191614] text-[#B8AAA0] border border-[#342A24] hover:text-[#F3EEE8]'
                }`}
              >
                {cat.label} {actualCount}
              </button>
            );
          })}
        </div>

        {/* Debounced Search & Sort Controls */}
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
              placeholder={`Search ${items.length} items by name, tag, pack, or description (press / to focus)…`}
              aria-label={`Search ${moduleDef.label}`}
              className="w-full min-h-[44px] rounded-lg border border-[#342A24] bg-[#11100F] pl-8 pr-11 py-2 text-xs text-[#F3EEE8] placeholder:text-[#83766D]"
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
                className="min-h-[44px] min-w-[44px] absolute right-0 top-1/2 -translate-y-1/2 inline-flex items-center justify-center text-[#83766D] hover:text-[#F3EEE8]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'name' | 'newest' | 'favorites')}
            aria-label="Sort catalog items"
            className="min-h-[44px] rounded-lg border border-[#342A24] bg-[#11100F] px-3 py-2 text-xs text-[#B8AAA0]"
          >
            <option value="name">Sort: Name (A–Z)</option>
            <option value="favorites">Sort: Favorites first</option>
            <option value="newest">Sort: Newest</option>
          </select>
        </div>

        {/* Card Grid matching reference dense 2-column selector */}
        {filteredItems.length === 0 ? (
          <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-8 text-center space-y-2">
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
                setRawSearchInput('');
                setDebouncedQuery('');
              }}
              className="mt-2 px-3 py-1.5 rounded-lg bg-[#191614] border border-[#342A24] text-xs font-medium text-[#F3EEE8] hover:border-[#83766D]"
            >
              Clear search & filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 overflow-y-auto max-h-[560px] pr-1">
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
                  className={`group text-left rounded-xl p-3.5 border transition-colors flex flex-col justify-between min-h-[82px] ${
                    isSelected
                      ? 'border-[#F06424] bg-[#211B17] shadow-[inset_0_0_0_1px_#F06424]'
                      : 'border-[#342A24] bg-[#11100F] hover:bg-[#191614] hover:border-[#83766D]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 w-full">
                    <span className="text-xs font-mono-tabular text-[#F06424] truncate">
                      {item.packLabel}
                    </span>
                    <span className="text-[11px] font-mono-tabular text-[#83766D] shrink-0">
                      {isFav ? '★ Fav' : item.assetKind}
                    </span>
                  </div>
                  <div className="mt-1.5 font-semibold text-sm text-[#F3EEE8] truncate w-full">
                    {item.name}
                  </div>
                  <div className="mt-1 text-[11px] text-[#83766D] truncate w-full">
                    {item.summary}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Right Region: Real Detail Panel */}
      <div
        className={`lg:col-span-6 xl:col-span-6 p-4 sm:p-6 bg-[#0B0A09] ${
          mobilePane === 'catalog' ? 'hidden lg:block' : 'block'
        }`}
      >
        {activeItem ? (
          <div className="space-y-5 max-w-xl mx-auto">
            <button
              type="button"
              onClick={() => setMobilePane('catalog')}
              className="lg:hidden min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#342A24] bg-[#191614] text-xs font-medium text-[#B8AAA0]"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-[#F06424]" />
              <span>Back to {moduleDef.label} List</span>
            </button>
            {/* Title, Pack, Metadata & Idempotent Favorite Toggle */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-[#F3EEE8] tracking-tight">
                  {activeItem.name}
                </h2>
                {/* Unboxed metadata with typographic separators */}
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#B8AAA0] font-mono-tabular">
                  <span className="text-[#F06424]">{activeItem.packLabel}</span>
                  <span aria-hidden="true">·</span>
                  <span>{activeItem.assetKind}</span>
                  {activeItem.metadata.width && activeItem.metadata.height && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        {activeItem.metadata.width} × {activeItem.metadata.height}
                      </span>
                    </>
                  )}
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
              </div>

              <button
                type="button"
                onClick={() => onToggleFavorite(activeItem.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  favoriteIds.includes(activeItem.id)
                    ? 'border-[#F06424] bg-[#211B17] text-[#F06424]'
                    : 'border-[#342A24] bg-[#191614] text-[#B8AAA0] hover:text-[#F3EEE8]'
                }`}
              >
                <Star
                  className={`w-3.5 h-3.5 ${
                    favoriteIds.includes(activeItem.id) ? 'fill-[#F06424]' : ''
                  }`}
                />
                <span>
                  {favoriteIds.includes(activeItem.id) ? 'Remove from favorites' : 'Add to favorites'}
                </span>
              </button>
            </div>

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

            {activeItem.metadata.signature && (
              <div className="rounded-lg border border-[#342A24] bg-[#11100F] px-3 py-2 font-mono-tabular text-xs text-[#FFC08C]">
                {activeItem.metadata.signature}
              </div>
            )}

            <p className="text-xs sm:text-sm text-[#B8AAA0] leading-relaxed">
              {activeItem.description || activeItem.summary}
            </p>

            {/* Live Preview Surface */}
            <PreviewRenderer
              item={activeItem}
              comparisonMode={canCompareTemplate ? comparisonMode : 'edits'}
              customValues={customValues}
              reducedMotion={reducedMotion}
            />

            {/* Template / Your edits segmented toggle ONLY appears if actual editable fields update the preview */}
            {canCompareTemplate && (
              <div className="space-y-1.5">
                <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#191614] border border-[#342A24]">
                  <button
                    type="button"
                    onClick={() => setComparisonMode('template')}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                      comparisonMode === 'template'
                        ? 'bg-[#F06424] text-[#080707] font-semibold'
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
                        ? 'bg-[#F06424] text-[#080707] font-semibold'
                        : 'text-[#B8AAA0] hover:text-[#F3EEE8]'
                    }`}
                  >
                    Your edits
                  </button>
                </div>
                <p className="text-xs text-[#83766D]">
                  This template has configurable preview fields below. Switch between “Template” and “Your edits” to compare your customized version.
                </p>
              </div>
            )}

            {/* Editable Parameters */}
            {activeItem.editableParams && activeItem.editableParams.length > 0 && (
              <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono-tabular text-[#83766D] uppercase">
                    Configurable Parameters
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
                    className="text-xs text-[#B8AAA0] hover:text-[#F3EEE8]"
                  >
                    Reset defaults
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

              {onSaveProject && (
                <button
                  type="button"
                  onClick={async () => {
                    const spec = JSON.stringify(
                      {
                        schemaVersion: '2.0.0',
                        format: 'sowveil-mobile-project',
                        exportedAt: new Date().toISOString(),
                        targetEditor: 'capcut',
                        composition: {
                          id: activeItem.id,
                          title: activeItem.name,
                          moduleId: activeItem.moduleId,
                          categoryId: activeItem.categoryId,
                          packLabel: activeItem.packLabel,
                          aspectRatio: '9:16',
                          width: activeItem.metadata.width || 1080,
                          height: activeItem.metadata.height || 1920,
                          fps: activeItem.metadata.fps || 60,
                          durationSec: activeItem.metadata.durationSec || 3,
                          previewKind: activeItem.previewKind,
                        },
                        parameters: customValues,
                      },
                      null,
                      2
                    );
                    await onSaveProject({
                      title: `${activeItem.name} (Customized)`,
                      description: `Saved editable mobile preset from ${moduleDef.label} (${activeItem.packLabel}).`,
                      compCount: 1,
                      projectFileStatus: 'sowveil-native',
                      fileSizeBytes: spec.length,
                      fileSizeLabel: `${(spec.length / 1024).toFixed(1)} KB (.sowveil.json)`,
                      resolution: '1080 × 1920',
                      fps: activeItem.metadata.fps || 60,
                      targetEditor: 'capcut',
                      aspectRatio: '9:16',
                      sowveilSpecJson: spec,
                      hasExternalFootageWarning: false,
                      archived: false,
                      tags: [moduleDef.label, activeItem.packLabel, 'Customized'],
                    });
                    onNotify(
                      `Saved customized "${activeItem.name}" to your Project Library (.sowveil.json).`,
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

            {/* Real Detail Metadata & Capability Inspector */}
            <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-3.5 space-y-2 text-xs">
              <div className="flex items-center justify-between font-mono-tabular">
                <span className="text-[#83766D]">MOBILE ENGINE &amp; GATEWAY STATE</span>
                <span className="text-[#55B98B]">
                  Mobile Export Ready · {activeItem.status}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#342A24]/70 font-mono-tabular text-[11px] text-[#B8AAA0]">
                <div>Preview Type: {activeItem.previewKind}</div>
                <div>Mobile Formats: .xml, .zip, .svg, .sowveil.json</div>
                <div>Capability: {activeItem.capabilityType}</div>
                <div>Origin: {activeItem.licenseType}</div>
              </div>
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
    </div>
  );
};
