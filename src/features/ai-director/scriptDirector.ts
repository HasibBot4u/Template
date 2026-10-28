import {
  AiEditProposal,
  DirectorBrief,
  ScenePlanItem,
  ScriptCoverageReport,
  ScriptSourceDocument,
  ScriptUnit,
} from './types';

/**
 * Splits raw script text into immutable, numbered Script Units with word/time estimates.
 */
export function parseScriptIntoUnits(rawText: string): ScriptUnit[] {
  if (!rawText || typeof rawText !== 'string') return [];

  // Split into sentences / paragraphs preserving structure
  const rawSegments = rawText
    .split(/\n\s*\n|(?<=[.!?])\s+(?=[A-Z0-9"'])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return rawSegments.map((seg, idx) => {
    const isHeading =
      seg.startsWith('#') ||
      seg.toUpperCase() === seg ||
      seg.startsWith('SCENE') ||
      seg.startsWith('INT.') ||
      seg.startsWith('EXT.');
    const isDirection = seg.startsWith('[') || seg.startsWith('(');
    const isDialogue = seg.includes(':') && !isHeading;

    const words = seg.split(/\s+/).filter(Boolean).length;
    // Estimated duration: ~2.5 words/second for natural narration
    const estimatedDurationSec = Math.max(1.2, Math.round((words / 2.5) * 10) / 10);

    return {
      unitId: `unit_${idx + 1}_${Math.random().toString(36).slice(2, 6)}`,
      index: idx + 1,
      text: seg,
      characterCount: seg.length,
      estimatedDurationSec,
      kind: isHeading ? 'heading' : isDirection ? 'direction' : isDialogue ? 'dialogue' : 'narration',
      status: 'uncovered',
    };
  });
}

/**
 * Evaluates coverage of the script source document against planned scenes and user-approved cuts.
 * Guarantees that zero script text is silently skipped.
 */
export function generateCoverageReport(
  scriptDoc: ScriptSourceDocument,
  scenes: ScenePlanItem[],
  approvedCutUnitIds: Set<string> = new Set()
): ScriptCoverageReport {
  const coveredIds = new Set<string>();
  for (const scene of scenes) {
    for (const uid of scene.scriptUnitIds) {
      coveredIds.add(uid);
    }
  }

  let coveredCount = 0;
  let cutCount = 0;
  let uncoveredCount = 0;
  const uncoveredUnitIds: string[] = [];

  for (const unit of scriptDoc.units) {
    if (coveredIds.has(unit.unitId)) {
      coveredCount++;
    } else if (approvedCutUnitIds.has(unit.unitId)) {
      cutCount++;
    } else {
      uncoveredCount++;
      uncoveredUnitIds.push(unit.unitId);
    }
  }

  const total = scriptDoc.units.length;
  const accounted = coveredCount + cutCount;
  const percentCovered = total > 0 ? Math.round((accounted / total) * 100) : 100;
  const isReadyForProduction = uncoveredCount === 0;

  const summaryNote = isReadyForProduction
    ? `100% Script Coverage Achieved (${coveredCount} units assigned to ${scenes.length} scenes, ${cutCount} explicitly approved cuts).`
    : `Incomplete script coverage: ${uncoveredCount} script units are unassigned. AI Director must assign or request explicit cut approval before final rendering.`;

  return {
    scriptId: scriptDoc.id,
    totalUnits: total,
    coveredUnits: coveredCount,
    cutUnits: cutCount,
    uncoveredUnits: uncoveredCount,
    percentCovered,
    uncoveredUnitIds,
    isReadyForProduction,
    summaryNote,
  };
}

/**
 * Builds a structured AI Edit Proposal with human-in-the-loop approval gating.
 */
export function createDirectorProposal(params: {
  projectId: string;
  brief: DirectorBrief;
  scriptDoc: ScriptSourceDocument;
  planVersion?: number;
}): AiEditProposal {
  const { projectId, brief, scriptDoc, planVersion = 1 } = params;
  const units = scriptDoc.units;

  // Group script units into scenes
  const scenes: ScenePlanItem[] = [];
  let currentStartSec = 0;
  const unitsPerScene = Math.max(1, Math.min(3, Math.ceil(units.length / 5)));

  for (let i = 0; i < units.length; i += unitsPerScene) {
    const chunk = units.slice(i, i + unitsPerScene);
    const sceneIdx = Math.floor(i / unitsPerScene) + 1;
    const sceneDuration = chunk.reduce((sum, u) => sum + u.estimatedDurationSec, 0);

    const title = chunk[0].text.slice(0, 48).replace(/[#*]/g, '').trim() || `Scene ${sceneIdx}`;
    const narrationText = chunk.map((u) => u.text).join(' ');

    // Match motion module based on scene index and keywords
    const isIntro = sceneIdx === 1;
    const isOutro = i + unitsPerScene >= units.length;

    scenes.push({
      sceneId: `scene_${sceneIdx}`,
      sceneNumber: sceneIdx,
      scriptUnitIds: chunk.map((u) => u.unitId),
      title,
      narrationText,
      visualPrompt: `High quality motion graphic scene illustrating: "${title}". Palette: Obsidian dark with signal ember accent. Aspect ratio: ${brief.aspectRatio}.`,
      shotFraming: isIntro ? 'isometric-mockup' : isOutro ? 'close-up' : 'graphic-burst',
      cameraMotion: isIntro ? 'zoom-in' : 'static',
      motionTemplateMatch: {
        moduleId: isIntro ? 'text-animation' : isOutro ? 'logo-reveals' : 'overlays-fx',
        rationale: isIntro
          ? 'Kinetic title sequence matches hook narration'
          : isOutro
          ? 'Call to action and branding lockup'
          : 'Procedural motion element accents pacing',
        compatibility: 'Verified native preview + Universal ZIP bundle',
      },
      soundDesignPrompt: isIntro ? 'Modern tech riser sweep into subtle hit' : 'Clean UI pop accent',
      durationSec: sceneDuration,
      startSec: currentStartSec,
    });

    currentStartSec += sceneDuration;
  }

  return {
    id: `prop_${Date.now()}`,
    projectId,
    planVersion,
    status: 'pending-approval',
    summary: `AI Director proposed ${scenes.length} scenes for "${scriptDoc.title}" (${brief.tone} tone, ${brief.aspectRatio}, total duration ~${Math.round(currentStartSec)}s).`,
    scenes,
    generatedCommandCount: scenes.length * 3,
    tokenUsageEstimate: 850 + scenes.length * 120,
    estimatedCostUsd: 0.0024 + scenes.length * 0.0008,
    createdAt: new Date().toISOString(),
  };
}
