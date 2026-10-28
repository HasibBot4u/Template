# Sowveil Studio — Reference UI & 20-Module Inventory

**Reference Source:** Supplied ~83.87-second Sowveil Studio feature-tour reference video  
**Primary Implementation Files:** `/src/data/modules.ts`, `/src/components/TopHeaderBar.tsx`, `/src/components/ModuleStrip.tsx`, `/src/components/CatalogBrowserWorkspace.tsx`, `/src/components/PreviewRenderer.tsx`, `/src/components/UtilityWorkspaces.tsx`, `/src/index.css`

---

## 1. Visual & Layout Architecture vs. Reference Video

### 1.1 Top Header & Two-Row 20-Module Navigation Strip
- **Header (`TopHeaderBar.tsx`):** Dark studio bar (`--surface-1: #11100F`, border `--border: #342A24`, accent `--accent: #F06424`) displaying the Sowveil Studio identity, workspace status badge, quick navigation links, and user profile/auth controls.
- **Two-Row Module Strip (`ModuleStrip.tsx`):**
  - **Desktop / Tablet (`md:grid-cols-10`):** Renders two exact rows of 10 modules each (`Row 1`: `displayOrder` 1–10; `Row 2`: `displayOrder` 11–20), matching the reference video's two-row top shelf.
  - **Android Phone Portrait (`< 768px`):** Uses horizontal touch-scroll rows with `min-height: 44px` tap targets (`touch-pan-x`) so mobile users can reach all 20 modules without cramped 20-column text truncation.
  - **Count Badges:** In the reference video, four modules explicitly display numeric item pills (`Text Animation: 220`, `Expressions: 12`, `Easing: 26`, `SFX: 60`). In our implementation, `computeActualModuleCounts()` (`src/data/modules.ts`, lines 328–341) computes the real number of published seeded items per module while storing `referenceReportedCount` in metadata so counts are never padded with fake duplicate records.

---

## 2. Complete 20-Module Inventory

| Order | Row | Module ID (`ModuleId`) | Label | Route | Icon (`lucide-react`) | Reference Video Count | Actual Seeded Count | Workspace Mode | Inspector / Specialized Controls |
|---|---|---|---|---|---|---:|---:|---|---|
| 1 | 1 | `text-animation` | Text Animation | `/app/text-animation` | `Type` | 220 | 12 | `catalog` | Headline text, tracking, stagger ms, overshoot, primary/accent colors, font scale, real kinetic text preview |
| 2 | 1 | `expressions` | Expressions | `/app/expressions` | `Code2` | 12 | 6 | `catalog` | Frequency, decay, amplitude sliders, live inertial spring/wiggle math graph + copyable expression code block |
| 3 | 1 | `easing` | Easing | `/app/easing` | `Spline` | 26 | 8 | `catalog` | Cubic-bezier (`x1, y1, x2, y2`) curve visualizer, animated timing dot, SVG curve spec & CSS/JSON copy |
| 4 | 1 | `sfx` | SFX | `/app/sfx` | `Volume2` | 60 | 8 | `catalog` | Pitch semitones, decay, sub-bass boost, reverb mix, real Web Audio API procedural synthesizer playback |
| 5 | 1 | `ready-made` | Ready-made | `/app/ready-made` | `Sparkles` | — | 4 | `catalog` | Multi-layer scene title, subtitle, badge color, speed multiplier, aspect ratio selector (`9:16`, `1:1`, `16:9`) |
| 6 | 1 | `ui-saas` | UI & SaaS | `/app/ui-saas` | `LayoutDashboard` | 104 | 4 | `catalog` | Metric value, delta pill, chart elevation, dark/light glass toggle, interactive SaaS widget preview |
| 7 | 1 | `liquid-glass` | Liquid Glass | `/app/liquid-glass` | `Droplets` | — | 4 | `catalog` | Refraction index, chromatic dispersion, blur radius, specular intensity, caustics tint preview |
| 8 | 1 | `carousel` | Carousel | `/app/carousel` | `GalleryHorizontalEnd` | — | 3 | `catalog` | Slide count, swipe spring stiffness, card gap, active slide indicator, aspect ratio (`4:5`, `9:16`, `1:1`) |
| 9 | 1 | `transitions` | Transitions | `/app/transitions` | `ArrowLeftRight` | — | 4 | `catalog` | Wipe angle, feather softness, chromatic split, duration ms, A/B scene transition preview |
| 10 | 1 | `3d-models` | 3D Models | `/app/3d-models` | `Box` | — | 3 | `catalog` | Orbit speed, yaw/pitch tilt, metallic roughness, rim light color, pseudo-3D interactive turntable preview |
| 11 | 2 | `mockups` | Mockups | `/app/mockups` | `Smartphone` | — | 3 | `catalog` | Device frame finish, screen corner radius, bezel shadow, floating tilt, portrait phone mockup preview |
| 12 | 2 | `logo-reveals` | Logo Reveals | `/app/logo-reveals` | `Award` | — | 3 | `catalog` | Brand name, tagline, particle burst intensity, sweep sheen, glow color |
| 13 | 2 | `backgrounds` | Backgrounds | `/app/backgrounds` | `Wallpaper` | — | 3 | `catalog` | Mesh gradient speed, noise grain opacity, palette stops, warp turbulence |
| 14 | 2 | `overlays-fx` | Overlays & FX | `/app/overlays-fx` | `Layers` | 72 | 3 | `catalog` | Film grain density, halation glow, light leak warmth, scanline frequency |
| 15 | 2 | `maps` | Maps | `/app/maps` | `MapPin` | — | 3 | `catalog` | Origin/destination labels, route arc height, pulse marker color, camera zoom factor |
| 16 | 2 | `saas-effects` | SaaS Effects | `/app/saas-effects` | `Wand2` | — | 3 | `catalog` | Cursor path speed, click ripple scale, spotlight radius, tooltip callout text |
| 17 | 2 | `templates` | Templates | `/app/templates` | `LayoutTemplate` | — | 3 | `catalog` | Full vertical reel/story sequence parameters, hook text, CTA label, color theme |
| 18 | 2 | `auto-captions` | Auto Captions | `/app/auto-captions` | `Captions` | — | Utility | `utility` (`AutoCaptionsWorkspace`) | Transcript/SRT/VTT input, words-per-cue, max chars/line, FPS, timing overlap validator, live cue table, real `.srt`/`.vtt` download & job persistence |
| 19 | 2 | `downloader` | Downloader | `/app/downloader` | `Download` | — | Utility | `utility` (`MediaInspectorWorkspace`) | Authorized media URL / local file inspector, SSRF guard, rights confirmation checkbox, aspect-ratio/codec metadata probe (no DRM/login bypass) |
| 20 | 2 | `project-library` | Project Library | `/app/project-library` | `FolderKanban` | — | Utility | `utility` (`ProjectLibraryWorkspace`) | Saved user projects list, parameter override editor, revision counter, checkpoint creation/rollback, JSON project backup import/export |

---

## 3. All Application Routes & Secondary Pages

| Route Path | Component (`src/App.tsx` / `PublicPages.tsx` / `SecondaryAppPages.tsx`) | Access Level | Functional Status |
|---|---|---|---|
| `/` | `LandingPage` (`PublicPages.tsx`) | Public | Hero showcase, live 20-module interactive preview strip, mobile export overview, CTA into `/app/text-animation` |
| `/pricing` | `PricingPage` (`PublicPages.tsx`) | Public | Transparent Creator / Pro / Studio tier breakdown |
| `/templates` | `PublicTemplatesPage` (`PublicPages.tsx`) | Public | Public searchable gallery linking directly into `/app/:moduleSlug` |
| `/docs` | `DocsPage` (`PublicPages.tsx`) | Public | Mobile Editor Gateway documentation, schema specs, and adapter compatibility guide |
| `/privacy`, `/terms` | `LegalPage` (`PublicPages.tsx`) | Public | Privacy & rights-aware usage terms |
| `/login`, `/signup`, `/reset-password` | `AuthPage` (`PublicPages.tsx`) | Public | Email/password & Google Popup OAuth (`signInWithGooglePopup`) + instant guest workspace continuation |
| `/app/:moduleSlug` | `WorkspaceModuleRoute` (`App.tsx`) | Public / User | Core 20-module studio workspace (`CatalogBrowserWorkspace` for modules 1–17; `UtilityWorkspaces` for 18–20) |
| `/app/account` | `AccountSettingsPage` (`SecondaryAppPages.tsx`) | User | Profile display, UID, role badge, default aspect ratio, reduced-motion preference |
| `/app/billing` | `BillingPage` (`SecondaryAppPages.tsx`) | User | Plan status & quota overview (explicitly marked for external billing provider integration) |
| `/app/exports` | `ExportsHistoryPage` (`SecondaryAppPages.tsx`) | User | History of generated export jobs and artifacts |
| `/app/settings` | `WorkspaceSettingsPage` (`SecondaryAppPages.tsx`) | User | Default target mobile editor (`sowveil-composer`, `alight-motion`, `capcut-mobile`, `vn-editor`, etc.) & preview quality |
| `/app/help` | `HelpSupportPage` (`SecondaryAppPages.tsx`) | Public / User | Mobile troubleshooting, Android Web Share tips, and FAQ |
| `/app/status` | `SystemStatusPage` (`SecondaryAppPages.tsx`) | Public / User | Live `/api/v1/health` probe, Firestore mode status, and adapter readiness |
| `/app/admin` | `AdminConsoleWorkspace` (`AdminConsoleWorkspace.tsx`) | Admin / Editor / Moderator | Role-gated admin console (Catalog CRUD, Modules, Users/Roles, Adapters, Audit Log, Security) |

---

## 4. Reference Fidelity Assessment (Observed Facts vs. Honest Differences)

1. **Module Labels, Order & Count Integrity (Observed Fact):**
   - All 20 modules match the reference video's two-row structure (`Text Animation` through `Project Library`).
   - Known visible reference counts (`220`, `12`, `26`, `60`, `104`, `72`) are recorded in `referenceReportedCount`, while badges display actual seeded counts (`computeActualModuleCounts`) so users are never misled by fake duplicate items.
2. **Color Tokens & Typography (`src/index.css`):**
   - Uses warm carbon dark surfaces (`--app-bg: #080707`, `--surface-1: #11100F`, `--surface-2: #171412`, `--border: #342A24`) with vibrant orange accent (`--accent: #F06424`), `Space Grotesk` display headers, `Plus Jakarta Sans` UI body, and `JetBrains Mono` for expressions/keyframes/timecodes.
3. **Mobile Adaptation vs. Desktop Reference:**
   - The reference video shows a wide desktop/tablet aspect ratio where 10 modules fit across each row and the inspector sits permanently on the right (`w-80`).
   - On Android portrait viewports (`< 768px`), `ModuleStrip.tsx` switches to horizontal touch-scrolling rows and `CatalogBrowserWorkspace.tsx` presents the inspector in a responsive bottom/slide-over sheet so controls remain at least `44px` tall and legible without pinch-zooming.
