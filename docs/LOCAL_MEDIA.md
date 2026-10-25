# Local Media Utilities (`docs/LOCAL_MEDIA.md`)

## 1. Auto Captions (`Python` + `Whisper` + `FFmpeg`)
- Runs locally on the paired workstation via the Desktop Companion.
- Checks for installed `python`, `whisper` model weights (`Turbo`, `Large-v3`, `Base.en`), and `ffmpeg`.
- Never fabricates transcripts in the browser or silently uploads private timeline footage to the cloud.

## 2. Depth Reveal (`Python` + `Depth Anything V2`)
- Located under Module 16 (`SaaS Effects` → `Depth Reveal 1`, `Depth Reveal 2`, `Depth Reveal 3`).
- First use requires explicit user confirmation before downloading the Python runtime and Depth Anything V2 weights (~335 MB).
- Marked as `Needs setup` (`Needs local model integration`) until local installation is verified.

## 3. Policy-Safe Media Downloader (`yt-dlp` + `FFmpeg`)
- Requires explicit rights/permission acknowledgement from the user before queueing.
- Enforces HTTPS-only schemes and blocks private/loopback/metadata IP ranges (SSRF protection).
- Does not bypass DRM, login walls, or paywalls.
