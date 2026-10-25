import React, { useState } from 'react';
import { SOWVEIL_MODULES } from '../data/modules';
import { ModuleDefinition, ModuleId } from '../types/sowveil';
import {
  Type,
  Code2,
  Spline,
  Volume2,
  LayoutGrid,
  AppWindow,
  Layers,
  GalleryHorizontalEnd,
  ArrowLeftRight,
  Box,
  Smartphone,
  Sparkles,
  Grid,
  Tv,
  MapPin,
  MousePointerClick,
  LayoutTemplate,
  Captions,
  Download,
  FolderKanban,
  SlidersHorizontal,
  X,
} from 'lucide-react';

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  Type,
  Code2,
  Spline,
  Volume2,
  LayoutGrid,
  AppWindow,
  Layers,
  GalleryHorizontalEnd,
  ArrowLeftRight,
  Box,
  Smartphone,
  Sparkles,
  Grid,
  Tv,
  MapPin,
  MousePointerClick,
  LayoutTemplate,
  Captions,
  Download,
  FolderKanban,
};

interface ModuleStripProps {
  activeModuleId: ModuleId;
  onSelectModule: (moduleId: ModuleId) => void;
  itemCountsByModule: Record<string, number>;
}

export const ModuleStrip: React.FC<ModuleStripProps> = ({
  activeModuleId,
  onSelectModule,
  itemCountsByModule,
}) => {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const row1 = SOWVEIL_MODULES.slice(0, 10);
  const row2 = SOWVEIL_MODULES.slice(10, 20);
  const activeMod =
    SOWVEIL_MODULES.find((m) => m.id === activeModuleId) || SOWVEIL_MODULES[0];

  const renderDesktopButton = (mod: ModuleDefinition) => {
    const IconComp = ICON_MAP[mod.icon] || LayoutGrid;
    const isActive = mod.id === activeModuleId;
    const actualCount = itemCountsByModule[mod.id];

    return (
      <button
        key={mod.id}
        type="button"
        onClick={() => onSelectModule(mod.id)}
        aria-pressed={isActive}
        className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 border ${
          isActive
            ? 'bg-[#F06424] text-[#080707] border-[#F06424] font-semibold'
            : 'bg-[#191614] text-[#B8AAA0] border-[#342A24] hover:text-[#F3EEE8] hover:border-[#83766D]'
        }`}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <IconComp className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{mod.label}</span>
        </span>
        {actualCount !== undefined && (
          <span
            className={`font-mono-tabular text-[11px] ${
              isActive ? 'text-[#080707]/80' : 'text-[#83766D]'
            }`}
          >
            {actualCount}
          </span>
        )}
      </button>
    );
  };

  return (
    <>
      <nav
        aria-label="Sowveil 20-Module Selector"
        className="w-full border-b border-[#342A24] bg-[#11100F] px-3 sm:px-4 py-2 sm:py-2.5"
      >
        {/* Mobile Portrait Strip (< lg): Horizontal touch carousel + All 20 Modules Sheet Trigger */}
        <div className="flex lg:hidden items-center gap-2">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open all 20 modules sheet"
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#F06424]/70 bg-[#211B17] text-xs font-semibold text-[#F3EEE8] whitespace-nowrap shrink-0"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-[#F06424]" />
            <span>20 Modules</span>
          </button>

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            {SOWVEIL_MODULES.map((mod) => {
              const IconComp = ICON_MAP[mod.icon] || LayoutGrid;
              const isActive = mod.id === activeModuleId;
              const actualCount = itemCountsByModule[mod.id];
              return (
                <button
                  key={mod.id}
                  type="button"
                  onClick={() => onSelectModule(mod.id)}
                  aria-pressed={isActive}
                  className={`min-h-[44px] inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors whitespace-nowrap shrink-0 border ${
                    isActive
                      ? 'bg-[#F06424] text-[#080707] border-[#F06424] font-bold'
                      : 'bg-[#191614] text-[#B8AAA0] border-[#342A24]'
                  }`}
                >
                  <IconComp className="w-3.5 h-3.5 shrink-0" />
                  <span>{mod.label}</span>
                  {actualCount !== undefined && (
                    <span
                      className={`font-mono-tabular text-[10px] ${
                        isActive ? 'text-[#080707]/80' : 'text-[#83766D]'
                      }`}
                    >
                      {actualCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Desktop Two-Row 20-Module Workbench Strip (lg+) */}
        <div className="hidden lg:flex flex-col gap-1.5">
          <div className="grid grid-cols-10 gap-1.5">
            {row1.map(renderDesktopButton)}
          </div>
          <div className="grid grid-cols-10 gap-1.5">
            {row2.map(renderDesktopButton)}
          </div>
        </div>
      </nav>

      {/* Mobile Bottom Sheet Drawer for All 20 Modules */}
      {drawerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="All 20 Motion Modules"
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end justify-center lg:hidden"
        >
          <div className="w-full max-h-[85dvh] rounded-t-3xl border-t border-[#342A24] bg-[#11100F] text-[#F3EEE8] flex flex-col overflow-hidden overscroll-contain">
            <div className="w-10 h-1.5 bg-[#342A24] rounded-full mx-auto mt-2.5" />
            <div className="px-4 py-3 border-b border-[#342A24] flex items-center justify-between">
              <div>
                <div className="text-[11px] font-mono-tabular text-[#F06424]">
                  ACTIVE: {activeMod.label.toUpperCase()}
                </div>
                <h2 className="text-sm font-bold text-[#F3EEE8]">
                  Switch Motion Module (20 Available)
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close modules drawer"
                className="min-h-[44px] min-w-[44px] rounded-xl border border-[#342A24] bg-[#191614] inline-flex items-center justify-center text-[#B8AAA0]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {SOWVEIL_MODULES.map((mod) => {
                const IconComp = ICON_MAP[mod.icon] || LayoutGrid;
                const isActive = mod.id === activeModuleId;
                const actualCount = itemCountsByModule[mod.id];
                return (
                  <button
                    key={mod.id}
                    type="button"
                    onClick={() => {
                      onSelectModule(mod.id);
                      setDrawerOpen(false);
                    }}
                    className={`min-h-[58px] rounded-2xl border p-3 text-left flex flex-col justify-between transition-colors ${
                      isActive
                        ? 'border-[#F06424] bg-[#211B17] text-[#F3EEE8]'
                        : 'border-[#342A24] bg-[#191614] text-[#B8AAA0]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <IconComp className="w-4 h-4 text-[#F06424] shrink-0" />
                      {actualCount !== undefined && (
                        <span className="text-[11px] font-mono-tabular text-[#83766D]">
                          {actualCount}
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 text-xs font-semibold text-[#F3EEE8] truncate">
                      {mod.label}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
