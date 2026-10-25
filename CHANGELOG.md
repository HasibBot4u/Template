# Changelog

## [0.2.0] — Phase 2: Catalog, Search, Favorites and Project Library
### Added
- **Shared Catalog Engine (`src/services/catalogEngine.ts`)**: Pure functions for multi-field search (`name`, `tags`, `pack`, `category`, `description`), category filtering, sorting, operational count calculation, and `supportsInteractiveTemplateComparison` verification.
- **Expanded Original Catalog (`src/data/catalogSeeds.ts`)**: 74 published catalog items across all 17 catalog modules (including all 12 Expressions, 8 Easing presets, 9 SaaS Effects, 11 Templates, 13 Text Animations, and starter presets for every remaining module) plus 10 Project Library items.
- **Repository Isolation (`src/repositories/workspaceRepository.ts`)**: `IWorkspaceRepository` interface and `LocalPreviewWorkspaceRepository` with `localStorage` persistence, memory fallback, idempotent favorite add/remove, optimistic rollback support, Project Library CRUD, and Job Queue management.
- **Debounced & Keyboard-Accessible Search (`src/components/CatalogBrowserWorkspace.tsx`)**: 180ms debounced search, `/` to focus, `Escape` to clear, clear button, URL query preservation (`?cat=...&q=...&sort=...&item=...`), and helpful no-results state.
- **Project Library Full CRUD (`src/components/UtilityWorkspaces.tsx`)**: Search, sort, `Active`/`Archived`/`All` filter tabs, `+ Save project` modal, inline metadata editor, archive/restore toggle, two-step delete confirmation, and strict separation of `metadata-only` vs `uploaded-blob` records without invented composition counts or file sizes.
- **Job State Machine (`src/services/jobStateMachine.ts`)**: Formal state transitions (`queued`, `claimed`, `running`, `succeeded`, `failed`, `cancelled`, `needs-setup`, `expired`), idempotency key deduplication, and `Connector not paired` guards disabling host actions when disconnected.
- **Unit Test Suite (`src/tests/phase2.test.ts`)**: 7 automated unit tests run via `npm test` (`tsx --test`).

## [0.1.0] — Phase 1: Discovery, Architecture, Design System & App Shell
### Added
- Full architecture & specification documentation suite in `/docs`.
- Dark studio design system (`#0B0B0D` canvas, `#131418` cards, `#181A20` elevated surfaces) and responsive app shell (`TopBar`, `Sidebar`, `/`, `/app`, `/app/:moduleId`, `/architecture`, `/docs`).
