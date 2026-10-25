# After Effects Desktop Companion (`docs/AE_COMPANION.md`)

## 1. Purpose & Architecture
Because a browser application cannot directly manipulate an editor's local Adobe After Effects timeline or inspect active compositions, Sowveil Studio separates host execution into two companion packages (generated in Phase 5):
- `packages/desktop-connector/` — Local Node.js companion agent that pairs via a short-lived one-time token, polls queued jobs over outbound HTTPS, and writes validated command payloads to a scoped local queue.
- `packages/ae-panel/` — ExtendScript / ScriptUI bridge panel for Adobe After Effects (23.x / 24.x / 25.x) with `Auto-run commands` defaulting to **OFF**.

## 2. Allowlisted Host Operations
1. `getHostStatus`
2. `getProjectSummary`
3. `getActiveCompSummary`
4. `listSelectedLayers`
5. `applyTextAnimation`
6. `applyExpressionPreset`
7. `applyEasingPreset`
8. `importAndAddAudio`
9. `insertTemplateComp`
10. `openTemplateAsComp`
11. `buildCarousel`
12. `addGlassPanel`
13. `applySaaSEffect`
14. `importAllowedFootage`
15. `queueRender`
16. `getOperationResult`

## 3. Error Codes
- `NO_ACTIVE_PROJECT`
- `NO_ACTIVE_COMP`
- `INCOMPATIBLE_SELECTION`
- `ASSET_NOT_FOUND`
- `HOST_PERMISSION_REQUIRED`
