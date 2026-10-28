# Sowveil Studio — AI Video Director Roadmap & Specification

## 1. Executive Summary

The **AI Video Director Subsystem** transforms raw scripts, voiceover text, or creative briefs into structured, multi-track video compositions without taking control away from the user. Rather than generating opaque black-box video renders, it acts as an intelligent assistant that produces reversible timeline commands, tracks script coverage with mathematical certainty, and outputs industry-standard mobile editor packages.

---

## 2. Architectural Principles

1. **Provider-Agnostic Gateway**:
   - Native support for **Google Gemini** (`google-gemini`), **OpenAI Chat Completions** (`openai-chat-completions`), **OpenAI Responses** (`openai-responses`), **Anthropic Messages** (`anthropic-messages`), and custom private OpenAI/Anthropic-compatible proxies (`custom-openai-compatible`, `custom-anthropic-compatible`).
   - Zero vendor lock-in. All provider calls adapt to a common interface (`IAiProviderAdapter`).

2. **Strict Security Vault & SSRF Defense**:
   - `validateProviderEndpointSsrf()` blocks all attempts to point custom provider endpoints to loopback addresses (`127.0.0.1`, `localhost`, `::1`), link-local IPs, cloud metadata endpoints (`169.254.169.254`), and RFC 1918 private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
   - API keys are never returned in plaintext to logs or shared across users. All diagnostic keys are masked (`maskApiKey`) showing only the prefix and last 4 characters.
   - Client keychain storage mode allows users to keep keys solely in `localStorage`/IndexedDB, or opt into server session caching.

3. **Script Intake & 100% Coverage Tracker**:
   - Scripts are segmented into deterministic units (`ScriptUnit`) with unique IDs, word counts, sentence boundaries, and reading pace duration estimates.
   - The **Coverage Tracker** inspects all timeline clips and guarantees zero dropped text lines unless explicitly marked as an approved cut by the user.

4. **Canonical Sowveil Timeline Schema v3.0**:
   - Schema version: `v3.0.0-timeline`.
   - Reversible command API (`AddTrack`, `RemoveTrack`, `AddClip`, `TrimClip`, `MoveClip`, `SetTransform`, `AddKeyframe`, `AddCaption`, `UpdateCaption`, `RemoveCaption`).
   - Every mutation creates an undo snapshot, allowing instant rollback without data loss.

5. **Human-in-the-Loop Proposal Gating**:
   - AI Director proposals (`AiEditProposal`) start in `draft-proposal` state.
   - Scene breakdowns (`ScenePlanItem`) and recommended motion modules from the 20 Sowveil modules must be explicitly reviewed and accepted by the creator before applying to the active project timeline.

---

## 3. Timeline Command Specification

```typescript
type TimelineCommand =
  | { type: 'AddTrack'; track: TimelineTrack }
  | { type: 'RemoveTrack'; trackId: string }
  | { type: 'AddClip'; trackId: string; clip: TimelineClip }
  | { type: 'TrimClip'; clipId: string; newStartTimeSec: number; newDurationSec: number }
  | { type: 'MoveClip'; clipId: string; targetTrackId: string; newStartTimeSec: number }
  | { type: 'SetTransform'; clipId: string; transform: Partial<ClipTransform> }
  | { type: 'AddKeyframe'; clipId: string; property: 'x' | 'y' | 'scale' | 'opacity' | 'rotation'; keyframe: ClipKeyframe }
  | { type: 'AddCaption'; caption: TimelineCaption }
  | { type: 'UpdateCaption'; captionId: string; patch: Partial<TimelineCaption> }
  | { type: 'RemoveCaption'; captionId: string };
```

---

## 4. API Endpoints

- `GET /api/v1/ai/providers`: Discovers available provider protocols and capabilities.
- `POST /api/v1/ai/providers/test`: Validates endpoint connectivity and SSRF boundaries.
- `POST /api/v1/ai/script/coverage`: Parses raw script text and generates coverage audit reports.
- `POST /api/v1/ai/timeline/propose`: Generates scene plans and reversible timeline commands from script input.

---

## 5. Mobile Editor Bridge

All AI Director timeline compositions can be exported immediately to:
- **Alight Motion**: Native XML scene with keyframes, shape layers, and vector typography.
- **CapCut**: Structured media handoff with timed audio, video plates, and subtitles.
- **Node Video**: High-depth visual asset bundles with JSON transform specifications.
- **Universal ZIP**: Cross-editor standard bundle with SRT captions, WAV stems, and PNG plates.
