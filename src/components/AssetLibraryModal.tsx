import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  FileAudio,
  FileCode2,
  FileImage,
  FileVideo,
  FolderOpen,
  Layers,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import {
  AssetKind,
  AssetMetadataRecord,
  ModuleId,
  TemplateLicenseType,
} from '../types/sowveil';
import {
  sanitizeAndValidateSvgContent,
  sanitizeUserLabelAndMarkdown,
} from '../services/marketplaceEngine';

export interface AssetLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  assets: AssetMetadataRecord[];
  onUpdateAssets: (nextAssets: AssetMetadataRecord[]) => void;
  activeModuleId: ModuleId;
  currentUserUid: string;
  selectionSlotLabel?: string | null;
  selectionAllowedKinds?: AssetKind[];
  onSelectAssetForSlot?: (asset: AssetMetadataRecord) => void;
  onNotify: (tone: 'info' | 'success' | 'warning' | 'error', title: string, detail: string) => void;
}

const ASSET_KIND_OPTIONS: Array<{ id: 'all' | AssetKind; label: string }> = [
  { id: 'all', label: 'All Assets' },
  { id: 'video', label: 'Video' },
  { id: 'image', label: 'Still Images' },
  { id: 'audio', label: 'Audio / SFX' },
  { id: 'font', label: 'Fonts' },
  { id: 'svg', label: 'SVG / Vector' },
  { id: 'model3d', label: '3D Models' },
  { id: 'generated', label: 'Generated' },
];

const LICENSE_OPTIONS: TemplateLicenseType[] = [
  'Unknown',
  'Sowveil Original',
  'Royalty-Free Commercial',
  'CC0 Public Domain',
  'Free',
  'Attribution Required',
  'Editorial Only',
  'Custom License',
];

function computeBrowserSideHexHash(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `sha256_${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

export const AssetLibraryModal: React.FC<AssetLibraryModalProps> = ({
  isOpen,
  onClose,
  assets,
  onUpdateAssets,
  activeModuleId,
  currentUserUid,
  selectionSlotLabel,
  selectionAllowedKinds,
  onSelectAssetForSlot,
  onNotify,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | AssetKind>('all');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(
    assets[0]?.id || null
  );
  const [showRegisterForm, setShowRegisterForm] = useState(false);

  // Registration form state — note that licenseType defaults to 'Unknown', NEVER 'Free'
  const [newTitle, setNewTitle] = useState('');
  const [newKind, setNewKind] = useState<AssetKind>('svg');
  const [newLicenseType, setNewLicenseType] = useState<TemplateLicenseType>('Unknown');
  const [newLicenseNote, setNewLicenseNote] = useState('');
  const [newAttribution, setNewAttribution] = useState('');
  const [newProvenance, setNewProvenance] = useState('User Uploaded / Registered');
  const [newTagsInput, setNewTagsInput] = useState('vector, motion, custom');
  const [newDimensions, setNewDimensions] = useState('1920×1080');
  const [newDurationSec, setNewDurationSec] = useState('3.0');
  const [newAudioFormat, setNewAudioFormat] = useState('');
  const [newSvgMarkup, setNewSvgMarkup] = useState(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="20" fill="#18181f"/><circle cx="60" cy="60" r="34" fill="#ff7a18"/></svg>'
  );

  // Replace asset form state
  const [replaceNote, setReplaceNote] = useState('');
  const [replaceSvgMarkup, setReplaceSvgMarkup] = useState('');
  const [missingReport, setMissingReport] = useState<
    Array<{ assetId: string; title: string; reason: string }>
  >([]);

  const filteredAssets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return assets.filter((a) => {
      if (
        selectionAllowedKinds &&
        selectionAllowedKinds.length > 0 &&
        !selectionAllowedKinds.includes(a.assetKind)
      ) {
        return false;
      }
      if (kindFilter !== 'all' && a.assetKind !== kindFilter) return false;
      if (q) {
        const provText =
          typeof a.provenance === 'string'
            ? a.provenance
            : a.provenance?.originType || '';
        return (
          a.title.toLowerCase().includes(q) ||
          a.licenseType.toLowerCase().includes(q) ||
          provText.toLowerCase().includes(q) ||
          (a.tags || []).some((t) => t.toLowerCase().includes(q)) ||
          (a.labels || []).some((l) => l.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [assets, kindFilter, searchQuery, selectionAllowedKinds]);

  const selectedAsset = useMemo(
    () =>
      filteredAssets.find((a) => a.id === selectedAssetId) ||
      filteredAssets[0] ||
      null,
    [filteredAssets, selectedAssetId]
  );

  if (!isOpen) return null;

  const handleRegisterAsset = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = sanitizeUserLabelAndMarkdown(newTitle, 160);
    if (!cleanTitle) {
      onNotify('warning', 'Title required', 'Enter a descriptive asset title.');
      return;
    }

    let previewDataUri: string | undefined;
    let checksum = computeBrowserSideHexHash(
      `${currentUserUid}:${cleanTitle}:${newKind}:${newDimensions}:${newDurationSec}`
    );

    if (newKind === 'svg' || newSvgMarkup.trim()) {
      const svgValidation = sanitizeAndValidateSvgContent(newSvgMarkup);
      if (!svgValidation.valid) {
        onNotify(
          'error',
          'Unsafe SVG Rejected',
          svgValidation.error || 'SVG failed security sanitization.'
        );
        return;
      }
      previewDataUri = `data:image/svg+xml;utf8,${encodeURIComponent(
        svgValidation.sanitizedSvg
      )}`;
      checksum = svgValidation.sha256;
    }

    // Privacy-preserving SHA-256 deduplication within caller scope
    const existingDup = assets.find(
      (a) =>
        a.ownerUid === currentUserUid &&
        a.checksumSha256 === checksum &&
        a.status !== 'archived'
    );
    if (existingDup) {
      setSelectedAssetId(existingDup.id);
      setShowRegisterForm(false);
      onNotify(
        'info',
        'Checksum Deduplicated',
        `Matched existing asset "${existingDup.title}" (${checksum.slice(0, 12)}) in your library.`
      );
      return;
    }

    const now = new Date().toISOString();
    const mimeByKind: Record<string, string> = {
      video: 'video/mp4',
      image: 'image/png',
      audio: 'audio/wav',
      font: 'font/woff2',
      svg: 'image/svg+xml',
      model3d: 'model/gltf-binary',
      generated: 'application/json',
    };
    const parsedTags = newTagsInput
      .split(',')
      .map((t) => sanitizeUserLabelAndMarkdown(t, 40))
      .filter(Boolean);

    const created: AssetMetadataRecord = {
      id: `asset_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: cleanTitle,
      labels: [activeModuleId, newKind],
      tags: parsedTags,
      moduleId: activeModuleId,
      catalogItemId: null,
      assetKind: newKind,
      ownerUid: currentUserUid,
      visibility: 'private',
      licenseType: newLicenseType, // Preserves 'Unknown' unless explicitly changed
      licenseNote: sanitizeUserLabelAndMarkdown(
        newLicenseNote ||
          (newLicenseType === 'Unknown'
            ? 'Rights/license not declared — private workspace use only'
            : `${newLicenseType} declaration`),
        400
      ),
      sourceNote: sanitizeUserLabelAndMarkdown(newProvenance, 400),
      provenance: sanitizeUserLabelAndMarkdown(newProvenance, 240),
      attribution: sanitizeUserLabelAndMarkdown(newAttribution, 240),
      storageProvider: previewDataUri ? 'inline-svg' : 'none-configured',
      storageObjectKey: null,
      mimeType: mimeByKind[newKind] || 'application/octet-stream',
      sizeBytes: previewDataUri ? previewDataUri.length : 24576,
      dimensions: newDimensions.trim() || undefined,
      durationSec: Number.isFinite(Number(newDurationSec))
        ? Number(newDurationSec)
        : undefined,
      audioFormat: newAudioFormat.trim() || undefined,
      checksumSha256: checksum,
      previewDataUri,
      versions: [
        {
          version: '1.0.0',
          checksumSha256: checksum,
          sizeBytes: previewDataUri ? previewDataUri.length : 24576,
          mimeType: mimeByKind[newKind] || 'application/octet-stream',
          updatedAt: now,
          updatedByUid: currentUserUid,
          note: 'Initial asset registration',
        },
      ],
      missingAssetDetected: false,
      usedByTemplateIds: [],
      usedByVariantIds: [],
      status: previewDataUri ? 'stored' : 'metadata-only',
      createdAt: now,
      updatedAt: now,
    };

    const next = [created, ...assets];
    onUpdateAssets(next);
    setSelectedAssetId(created.id);
    setShowRegisterForm(false);
    setNewTitle('');
    onNotify(
      'success',
      'Asset Registered',
      `Added "${created.title}" (${created.assetKind.toUpperCase()} · License: ${created.licenseType}).`
    );
  };

  const handleReplaceSelectedAsset = () => {
    if (!selectedAsset) return;
    const note = sanitizeUserLabelAndMarkdown(
      replaceNote || 'Updated asset version',
      200
    );
    let nextPreview = selectedAsset.previewDataUri;
    let nextHash = computeBrowserSideHexHash(
      `${selectedAsset.id}:${Date.now()}:${note}`
    );

    if (replaceSvgMarkup.trim()) {
      const svgCheck = sanitizeAndValidateSvgContent(replaceSvgMarkup);
      if (!svgCheck.valid) {
        onNotify(
          'error',
          'Unsafe SVG Rejected',
          svgCheck.error || 'Replacement SVG failed security sanitization.'
        );
        return;
      }
      nextPreview = `data:image/svg+xml;utf8,${encodeURIComponent(
        svgCheck.sanitizedSvg
      )}`;
      nextHash = svgCheck.sha256;
    }

    const now = new Date().toISOString();
    const prevVersions = selectedAsset.versions || [];
    const nextVersionLabel = `1.${prevVersions.length}.0`;

    const updated: AssetMetadataRecord = {
      ...selectedAsset,
      checksumSha256: nextHash,
      previewDataUri: nextPreview,
      missingAssetDetected: false,
      status: nextPreview ? 'stored' : 'metadata-only',
      versions: [
        ...prevVersions,
        {
          version: nextVersionLabel,
          checksumSha256: nextHash,
          sizeBytes: selectedAsset.sizeBytes ?? 24576,
          mimeType: selectedAsset.mimeType,
          updatedAt: now,
          updatedByUid: currentUserUid,
          note,
        },
      ],
      updatedAt: now,
    };

    onUpdateAssets(assets.map((a) => (a.id === updated.id ? updated : a)));
    setReplaceNote('');
    setReplaceSvgMarkup('');
    onNotify(
      'success',
      `Replaced Asset (v${nextVersionLabel})`,
      `Recorded version ${nextVersionLabel} with checksum ${nextHash.slice(0, 12)}.`
    );
  };

  const handleDetectMissingAssets = () => {
    const found = assets
      .filter((a) => a.status === 'missing-binary' || a.missingAssetDetected)
      .map((a) => ({
        assetId: a.id,
        title: a.title,
        reason: 'Flagged as missing-binary or unlinked local source.',
      }));
    setMissingReport(found);
    onNotify(
      found.length > 0 ? 'warning' : 'success',
      'Missing-Asset Scan Complete',
      found.length > 0
        ? `Detected ${found.length} missing asset(s) requiring replacement.`
        : 'All registered assets passed integrity and reference checks.'
    );
  };

  const handleRemoveUnusedAssets = () => {
    const removable = assets.filter(
      (a) =>
        a.ownerUid === currentUserUid &&
        (!a.usedByTemplateIds || a.usedByTemplateIds.length === 0) &&
        (!a.usedByVariantIds || a.usedByVariantIds.length === 0) &&
        !a.catalogItemId
    );
    if (removable.length === 0) {
      onNotify(
        'info',
        'No Unused Assets',
        'All user-owned assets are currently referenced by templates or variants.'
      );
      return;
    }
    const removableIds = new Set(removable.map((r) => r.id));
    const remaining = assets.filter((a) => !removableIds.has(a.id));
    onUpdateAssets(remaining);
    onNotify(
      'success',
      'Removed Unused Assets',
      `Cleaned up ${removable.length} unreferenced user asset(s).`
    );
  };

  const renderKindIcon = (kind: AssetKind) => {
    switch (kind) {
      case 'video':
        return <FileVideo className="w-3.5 h-3.5 text-[#ff7a18]" />;
      case 'image':
        return <FileImage className="w-3.5 h-3.5 text-emerald-400" />;
      case 'audio':
        return <FileAudio className="w-3.5 h-3.5 text-amber-400" />;
      case 'font':
        return <Type className="w-3.5 h-3.5 text-sky-400" />;
      case 'svg':
        return <FileCode2 className="w-3.5 h-3.5 text-purple-400" />;
      case 'model3d':
        return <Layers className="w-3.5 h-3.5 text-pink-400" />;
      case 'generated':
        return <Sparkles className="w-3.5 h-3.5 text-[#ff9a3c]" />;
      default:
        return <FolderOpen className="w-3.5 h-3.5 text-zinc-400" />;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label="Sowveil Asset Library"
    >
      <div className="w-full max-w-5xl max-h-[90vh] flex flex-col rounded-xl border border-white/15 bg-[#121216] text-zinc-100 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#16161c]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#ff7a18]/15 border border-[#ff7a18]/40 flex items-center justify-center text-[#ff7a18]">
              <FolderOpen className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-[13px] font-semibold text-white flex items-center gap-2">
                Asset Library &amp; Provenance Registry
                {selectionSlotLabel && (
                  <span className="px-2 py-0.5 rounded bg-[#ff7a18]/20 border border-[#ff7a18]/50 text-[#ff9a3c] text-[10px]">
                    Selecting replacement for: {selectionSlotLabel}
                  </span>
                )}
              </h2>
              <p className="text-[10.5px] text-zinc-400">
                Video, Still Images, Audio, Fonts, Sanitized SVG/Vector, 3D Models &amp; Generated Assets · SHA-256 Deduplicated
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleDetectMissingAssets}
              className="px-2.5 py-1 rounded-md border border-white/10 bg-[#1c1c23] hover:bg-[#25252e] text-[10.5px] text-zinc-200 flex items-center gap-1"
              title="Scan templates and variants for missing or unlinked assets"
            >
              <AlertTriangle className="w-3 h-3 text-amber-400" />
              Detect Missing
            </button>
            <button
              type="button"
              onClick={handleRemoveUnusedAssets}
              className="px-2.5 py-1 rounded-md border border-white/10 bg-[#1c1c23] hover:bg-[#25252e] text-[10.5px] text-zinc-200 flex items-center gap-1"
              title="Remove unreferenced user-owned assets"
            >
              <Trash2 className="w-3 h-3 text-zinc-400" />
              Remove Unused
            </button>
            <button
              type="button"
              onClick={() => setShowRegisterForm((v) => !v)}
              className="px-2.5 py-1 rounded-md bg-[#ff7a18] hover:bg-[#ff8c33] text-black font-semibold text-[10.5px] flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              {showRegisterForm ? 'Close Form' : 'Register Asset'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/10"
              aria-label="Close Asset Library"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Missing-asset banner if any */}
        {missingReport.length > 0 && (
          <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 flex items-center justify-between text-[11px] text-amber-200">
            <span>
              Missing-asset detector found {missingReport.length} asset(s):{' '}
              {missingReport.map((m) => m.title).join(', ')}
            </span>
            <button
              type="button"
              onClick={() => setMissingReport([])}
              className="text-[10px] underline text-amber-300"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Register New Asset Drawer */}
        {showRegisterForm && (
          <form
            onSubmit={handleRegisterAsset}
            className="p-4 border-b border-white/10 bg-[#181820] grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px]"
          >
            <div>
              <label className="block text-zinc-400 mb-1">Asset Title *</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Kinetic Neon Badge Vector"
                className="w-full px-2.5 py-1.5 rounded bg-[#101014] border border-white/10 text-white"
                required
              />
            </div>
            <div>
              <label className="block text-zinc-400 mb-1">Asset Type</label>
              <select
                value={newKind}
                onChange={(e) => setNewKind(e.target.value as AssetKind)}
                className="w-full px-2.5 py-1.5 rounded bg-[#101014] border border-white/10 text-white"
              >
                <option value="svg">SVG / Vector (Sanitized)</option>
                <option value="video">Video Clip</option>
                <option value="image">Still Image</option>
                <option value="audio">Audio / SFX</option>
                <option value="font">Typography Font</option>
                <option value="model3d">3D Model (GLB/OBJ)</option>
                <option value="generated">AI Generated Asset</option>
              </select>
            </div>
            <div>
              <label className="block text-zinc-400 mb-1">
                License / Rights (Defaults to Unknown, never Free)
              </label>
              <select
                value={newLicenseType}
                onChange={(e) => setNewLicenseType(e.target.value as TemplateLicenseType)}
                className="w-full px-2.5 py-1.5 rounded bg-[#101014] border border-white/10 text-white"
              >
                {LICENSE_OPTIONS.map((lic) => (
                  <option key={lic} value={lic}>
                    {lic}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-zinc-400 mb-1">Dimensions / Resolution</label>
              <input
                type="text"
                value={newDimensions}
                onChange={(e) => setNewDimensions(e.target.value)}
                placeholder="1920×1080"
                className="w-full px-2.5 py-1.5 rounded bg-[#101014] border border-white/10 text-white"
              />
            </div>
            <div>
              <label className="block text-zinc-400 mb-1">Duration (sec) / Audio Format</label>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  step="0.1"
                  value={newDurationSec}
                  onChange={(e) => setNewDurationSec(e.target.value)}
                  className="w-20 px-2 py-1.5 rounded bg-[#101014] border border-white/10 text-white"
                />
                <input
                  type="text"
                  value={newAudioFormat}
                  onChange={(e) => setNewAudioFormat(e.target.value)}
                  placeholder="WAV 48kHz / N/A"
                  className="flex-1 px-2 py-1.5 rounded bg-[#101014] border border-white/10 text-white"
                />
              </div>
            </div>
            <div>
              <label className="block text-zinc-400 mb-1">Provenance &amp; Attribution</label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={newProvenance}
                  onChange={(e) => setNewProvenance(e.target.value)}
                  placeholder="Provenance"
                  className="w-1/2 px-2 py-1.5 rounded bg-[#101014] border border-white/10 text-white"
                />
                <input
                  type="text"
                  value={newAttribution}
                  onChange={(e) => setNewAttribution(e.target.value)}
                  placeholder="Creator Attribution"
                  className="w-1/2 px-2 py-1.5 rounded bg-[#101014] border border-white/10 text-white"
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-zinc-400 mb-1">
                {newKind === 'svg'
                  ? 'SVG Markup (Validated & Sanitized against <script>, foreignObject & event handlers)'
                  : 'Tags & License Note'}
              </label>
              {newKind === 'svg' ? (
                <textarea
                  value={newSvgMarkup}
                  onChange={(e) => setNewSvgMarkup(e.target.value)}
                  rows={2}
                  className="w-full px-2.5 py-1.5 rounded bg-[#101014] border border-white/10 text-zinc-200 font-mono text-[10px]"
                />
              ) : (
                <input
                  type="text"
                  value={newTagsInput}
                  onChange={(e) => setNewTagsInput(e.target.value)}
                  placeholder="comma, separated, tags"
                  className="w-full px-2.5 py-1.5 rounded bg-[#101014] border border-white/10 text-white"
                />
              )}
            </div>

            <div className="flex items-end justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowRegisterForm(false)}
                className="px-3 py-1.5 rounded border border-white/10 text-zinc-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3.5 py-1.5 rounded bg-[#ff7a18] text-black font-semibold"
              >
                Validate &amp; Save Asset
              </button>
            </div>
          </form>
        )}

        {/* Filter Bar */}
        <div className="px-4 py-2.5 border-b border-white/10 flex flex-wrap items-center justify-between gap-2 bg-[#14141a]">
          <div className="flex flex-wrap items-center gap-1">
            {ASSET_KIND_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setKindFilter(opt.id)}
                className={`px-2.5 py-1 rounded text-[10.5px] transition-colors ${
                  kindFilter === opt.id
                    ? 'bg-[#ff7a18] text-black font-semibold'
                    : 'bg-[#1d1d24] text-zinc-300 hover:bg-[#272730]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="relative w-56">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search assets, tags, license..."
              className="w-full pl-8 pr-3 py-1 rounded bg-[#0e0e12] border border-white/10 text-[11px] text-white"
            />
          </div>
        </div>

        {/* Main Split Body */}
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12 overflow-hidden">
          {/* Left Asset List */}
          <div className="md:col-span-7 overflow-y-auto p-3 space-y-1.5 border-r border-white/10">
            {filteredAssets.length === 0 ? (
              <div className="p-8 text-center text-zinc-500 text-[11.5px]">
                No assets match the current filter. Click &ldquo;Register Asset&rdquo; to add one.
              </div>
            ) : (
              filteredAssets.map((asset) => {
                const isSelected = selectedAsset?.id === asset.id;
                return (
                  <div
                    key={asset.id}
                    onClick={() => setSelectedAssetId(asset.id)}
                    className={`p-2.5 rounded-lg border cursor-pointer transition-colors flex items-center justify-between gap-3 ${
                      isSelected
                        ? 'border-[#ff7a18] bg-[#1e1a18]'
                        : 'border-white/10 bg-[#17171d] hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded bg-[#101014] border border-white/10 flex items-center justify-center shrink-0 overflow-hidden">
                        {asset.previewDataUri ? (
                          <img
                            src={asset.previewDataUri}
                            alt={asset.title}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          renderKindIcon(asset.assetKind)
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[11.5px] font-medium text-white truncate">
                          {asset.title}
                        </div>
                        <div className="text-[10px] text-zinc-400 flex items-center gap-2">
                          <span className="uppercase text-zinc-300">{asset.assetKind}</span>
                          <span>·</span>
                          <span>
                            {typeof asset.dimensions === 'string'
                              ? asset.dimensions
                              : asset.dimensions
                              ? `${asset.dimensions.width}×${asset.dimensions.height}`
                              : 'Vector/Meta'}
                          </span>
                          <span>·</span>
                          <span
                            className={
                              asset.licenseType === 'Unknown'
                                ? 'text-amber-400'
                                : 'text-emerald-400'
                            }
                          >
                            {asset.licenseType}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="px-1.5 py-0.5 rounded bg-white/5 text-[9.5px] text-zinc-400">
                        v{asset.versions?.[asset.versions.length - 1]?.version || '1.0.0'}
                      </span>
                      {onSelectAssetForSlot && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectAssetForSlot(asset);
                            onClose();
                          }}
                          className="px-2 py-1 rounded bg-[#ff7a18] text-black font-semibold text-[10px] flex items-center gap-1"
                        >
                          <Check className="w-3 h-3" />
                          Use in Slot
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Right Inspector & Versioning */}
          <div className="md:col-span-5 overflow-y-auto p-3.5 bg-[#15151b] space-y-3 text-[11px]">
            {selectedAsset ? (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-[13px] font-semibold text-white">
                      {selectedAsset.title}
                    </h3>
                    <p className="text-[10px] text-zinc-400">
                      ID: {selectedAsset.id} · Owner: {selectedAsset.ownerUid}
                    </p>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-[#ff7a18]/15 border border-[#ff7a18]/40 text-[#ff9a3c] text-[10px]">
                    {selectedAsset.status}
                  </span>
                </div>

                {selectedAsset.previewDataUri && (
                  <div className="h-28 rounded-lg border border-white/10 bg-[#0d0d11] flex items-center justify-center p-2">
                    <img
                      src={selectedAsset.previewDataUri}
                      alt={selectedAsset.title}
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-[#101014] border border-white/10 text-[10.5px]">
                  <div>
                    <span className="text-zinc-500 block">License / Rights</span>
                    <span
                      className={
                        selectedAsset.licenseType === 'Unknown'
                          ? 'text-amber-400 font-medium'
                          : 'text-emerald-400 font-medium'
                      }
                    >
                      {selectedAsset.licenseType}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">Provenance</span>
                    <span className="text-zinc-200">
                      {typeof selectedAsset.provenance === 'string'
                        ? selectedAsset.provenance
                        : selectedAsset.provenance?.originType || selectedAsset.sourceNote}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">Attribution</span>
                    <span className="text-zinc-200">
                      {typeof selectedAsset.attribution === 'string'
                        ? selectedAsset.attribution
                        : selectedAsset.attribution?.authorName || 'Not specified'}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">SHA-256 Checksum</span>
                    <span className="text-zinc-300 font-mono text-[9.5px] flex items-center gap-1">
                      {(selectedAsset.checksumSha256 || 'sha256_none').slice(0, 16)}…
                      <Copy className="w-2.5 h-2.5 text-zinc-500" />
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">Dimensions / Duration</span>
                    <span className="text-zinc-200">
                      {typeof selectedAsset.dimensions === 'string'
                        ? selectedAsset.dimensions
                        : selectedAsset.dimensions
                        ? `${selectedAsset.dimensions.width}×${selectedAsset.dimensions.height}`
                        : 'N/A'}{' '}
                      · {selectedAsset.durationSec ? `${selectedAsset.durationSec}s` : 'Static'}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">Used By</span>
                    <span className="text-zinc-200">
                      {(selectedAsset.usedByTemplateIds || []).length} template(s),{' '}
                      {(selectedAsset.usedByVariantIds || []).length} variant(s)
                    </span>
                  </div>
                </div>

                {/* Replace Asset / Add Version */}
                <div className="p-2.5 rounded-lg bg-[#101014] border border-white/10 space-y-2">
                  <div className="text-[10.5px] font-semibold text-zinc-200 flex items-center gap-1.5">
                    <RefreshCw className="w-3 h-3 text-[#ff7a18]" />
                    Replace Asset &amp; Record New Version
                  </div>
                  <input
                    type="text"
                    value={replaceNote}
                    onChange={(e) => setReplaceNote(e.target.value)}
                    placeholder="Version note (e.g. Updated color profile)"
                    className="w-full px-2 py-1 rounded bg-[#181820] border border-white/10 text-[10.5px] text-white"
                  />
                  {selectedAsset.assetKind === 'svg' && (
                    <textarea
                      value={replaceSvgMarkup}
                      onChange={(e) => setReplaceSvgMarkup(e.target.value)}
                      placeholder="Optional replacement <svg>...</svg> markup"
                      rows={2}
                      className="w-full px-2 py-1 rounded bg-[#181820] border border-white/10 text-[10px] font-mono text-zinc-200"
                    />
                  )}
                  <button
                    type="button"
                    onClick={handleReplaceSelectedAsset}
                    className="w-full py-1 rounded bg-[#24242e] hover:bg-[#2f2f3c] border border-white/10 text-zinc-100 font-medium text-[10.5px]"
                  >
                    Replace &amp; Append Version
                  </button>
                </div>

                {/* Version History */}
                <div className="p-2.5 rounded-lg bg-[#101014] border border-white/10 space-y-1.5">
                  <div className="text-[10.5px] font-semibold text-zinc-200 flex items-center gap-1.5">
                    <ShieldCheck className="w-3 h-3 text-emerald-400" />
                    Version History ({(selectedAsset.versions || []).length})
                  </div>
                  <div className="max-h-28 overflow-y-auto space-y-1">
                    {(selectedAsset.versions || []).map((v) => (
                      <div
                        key={`${v.version}_${v.updatedAt}`}
                        className="text-[10px] text-zinc-400 flex items-center justify-between border-b border-white/5 pb-1"
                      >
                        <span className="text-zinc-200 font-medium">v{v.version}</span>
                        <span className="truncate max-w-[150px]">{v.note}</span>
                        <span className="font-mono text-[9px]">
                          {v.checksumSha256.slice(0, 8)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="text-zinc-500 text-center py-8">
                Select an asset on the left to inspect its provenance, checksum, and version history.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
