# Manim Slides Preview

> 🤖 **Open source, AI-generated.** This extension was built by an AI assistant at a user's
> request and published for everyone. Found a bug? Open an issue or PR — contributions welcome.
>
> 📚 **New to LaTeX / Manim / manim-slides?** Learn the whole stack with the free offline
> course **[Manim Slides Academy](https://github.com/Alamin-H-M/manim-slides-academy)** — built around this extension's workflow.


A **lightweight, zero-dependency, fully offline** VS Code extension that gives
`manim-slides` the same one-click workflow you already use with Manim Sideview:

> Open folder → create `.py` → click ▶ → **interactive** slide preview appears → `Ctrl+S` → preview auto-refreshes.

Unlike a plain video preview, this preview is the real **interactive HTML presentation**
(Reveal.js): it pauses at every `self.next_slide()` and you advance with
**Space / Arrow keys**, exactly like your live sessions. Perfect for testing before
sharing a browser tab on Google Meet / OBS.

---

## What it does on every run

```
   Click ▶  (or Ctrl+S after the first run)
      │
      ├─ 1. manim-slides render file.py YourScene  (-ql by default)
      ├─ 2. manim-slides convert --to html --offline  → .manim-slides-preview/file.html
      └─ 3. Built-in live-reload server (127.0.0.1)
               │
               ├─ Opens interactive preview beside your code (Simple Browser)
               └─ Any external browser tab auto-refreshes on every save
```

Everything runs **locally** — the generated HTML bundles Reveal.js
(`--offline` flag), so presentations work with no internet at all.

## Speed architecture (v1.2)

Four layers make each Ctrl+S iteration as fast as possible:

1. **Partial-movie cache** — Manim hash-matches every animation; only the ones
   you actually edited are re-rendered. All partials are stored in a hidden
   pycache-style folder: `.manim-slides-preview/cache/media/` (your project
   root stays clean — no stray `media/` folder).
2. **Render daemon** — a persistent background Python process imports
   manim/manim-slides **once** and renders every save in-process, eliminating
   interpreter startup + import cost on every save (~1s on Linux, typically
   2–4s on Windows). Auto-restarts if it dies; falls back to a normal
   subprocess transparently.
3. **Convert-skip cache** — if a render produced identical slides (all cache
   hits), the HTML conversion and the browser reload are skipped entirely.
4. **Slide-position restore** — when the browser does reload, you stay on the
   slide you were viewing (Reveal.js state stashed in `sessionStorage`).

---

## Requirements (one-time, per machine)

| Tool | Check with | Install |
|---|---|---|
| Python 3.9+ | `python --version` | python.org |
| Manim CE | `manim --version` | `pip install manim` |
| manim-slides **≥ 5.1.10** | `manim-slides --version` | `pip install -U "manim-slides[pyside6]"` |
| FFmpeg + LaTeX (TeX Live) | — | already in your stack |

> `--offline` HTML export needs manim-slides **5.1.10 or newer**. If you're on an
> older version, either update or turn off `manimSlidesPreview.offline` in settings.

---

## Installing the extension (offline, for all users)

You get a single `manim-slides-preview-1.0.0.vsix` file. No marketplace, no internet needed.

### Option A — per user (simplest)
1. Copy the `.vsix` to the machine.
2. In VS Code: **Extensions panel → `···` menu → Install from VSIX…** → pick the file.
   - Or from a terminal: `code --install-extension manim-slides-preview-1.0.0.vsix`

### Option B — every user on a shared machine (Windows)
Run in an **admin** PowerShell — installs for each existing user profile:

```powershell
Get-ChildItem C:\Users -Directory | ForEach-Object {
  $code = "$($_.FullName)\AppData\Local\Programs\Microsoft VS Code\bin\code.cmd"
  if (Test-Path $code) { & $code --install-extension "C:\path\to\manim-slides-preview-1.0.0.vsix" }
}
```

If VS Code is installed system-wide (`C:\Program Files\Microsoft VS Code`), each user
just runs once: `code --install-extension manim-slides-preview-1.0.0.vsix`.

### Option C — every user on Linux/macOS
```bash
sudo -u <username> code --install-extension manim-slides-preview-1.0.0.vsix
```

---

## Your workflow (matches the PDF exactly)

1. **Right-click folder → Open with Code.**
2. Create `demo.py`:

   ```python
   from manim import *
   from manim_slides import Slide

   class Demo(Slide):
       def construct(self):
           circle = Circle(color=BLUE)
           self.play(Create(circle))
           self.next_slide()          # ← pause point

           square = Square(color=RED)
           self.play(Transform(circle, square))
           self.next_slide()

           self.play(FadeOut(circle))
   ```

3. Click the **▶ play button** in the editor title bar
   (or `Ctrl+Shift+B`, or Command Palette → *Manim Slides: Render & Preview*).
   - First run: if the file has several `Slide` classes, you pick which one(s) — remembered afterwards.
4. The **interactive preview opens beside your code**. Click inside it, press
   **Space / →** to advance through your `next_slide()` stops, **F** for fullscreen.
5. Edit code → **`Ctrl+S`** → it re-renders, re-converts, and the preview
   **auto-refreshes**. That's the whole loop.

### For Google Meet live sessions
- Status bar → click **“Preview ready :7801”** (or run *Manim Slides: Open Preview in Browser*).
- A Chrome/Edge/Firefox tab opens at `http://127.0.0.1:7801/demo.html`.
- Detach the tab into its own window → snap it with **Win + ← / →**.
- In Meet: **Share → A Tab** (Meet optimizes tab sharing up to 60 fps).
- Every `Ctrl+S` in VS Code silently refreshes that browser tab too.

### For the native PySide6 window
Run *Manim Slides: Present in Native Window (GUI)* — launches
`manim-slides present` in a resizable, OS-snappable window with full presenter hotkeys.

---

## Commands

| Command | What it does |
|---|---|
| `Manim Slides: Render & Preview` | Full pipeline (▶ button / `Ctrl+Shift+B`) |
| `Manim Slides: Select Scene(s)` | Re-pick which classes to render |
| `Manim Slides: Open Preview in Browser` | Pop the interactive preview into an external browser (for Meet/OBS) |
| `Manim Slides: Present in Native Window (GUI)` | Launch the PySide6 presenter window |
| `Manim Slides: Show Output Log` | Render/convert logs (errors show here) |
| `Manim Slides: Stop Preview Server` | Free the port |

## Settings

| Setting | Default | Notes |
|---|---|---|
| `manimSlidesPreview.command` | `manim-slides` | Use `py -m manim_slides` or a full path if not on PATH / in a venv (used by the subprocess fallback + GUI present) |
| `manimSlidesPreview.useDaemon` | `true` | Persistent render daemon — skips Python startup/imports on every save |
| `manimSlidesPreview.pythonCommand` | `""` | Interpreter for the daemon (`py`, a venv's `python.exe`, …). Empty = `python`/`python3`. Must have manim-slides installed |
| `manimSlidesPreview.cache` | `true` | Partial-movie cache + convert-skip cache. `Manim Slides: Clear Cache` wipes it |
| `manimSlidesPreview.ffmpegPath` | `""` | Full path to your installed `ffmpeg`. Its folder is prepended to PATH and exported as `FFMPEG_BINARY` for every render/convert/present the extension runs, so the whole toolchain resolves to **your** ffmpeg. Note: Manim CE ≥ 0.19 encodes video through its bundled `pyav` library and never shells out to an ffmpeg binary — this setting matters for older Manim versions, `manim-voiceover`, GIF/PPTX conversion, and plugins that do call `ffmpeg`. |
| `manimSlidesPreview.quality` | `-ql` | 480p15 draft while coding; switch to `-qh` for final checks |
| `manimSlidesPreview.renderOnSave` | `true` | The Ctrl+S magic |
| `manimSlidesPreview.offline` | `true` | Bundles Reveal.js locally — works with zero internet |
| `manimSlidesPreview.oneFile` | `false` | Single self-contained HTML (great for sharing, slower to build) |
| `manimSlidesPreview.openIn` | `browser` | Any combination of the three preview targets: `browser` \| `vscode` \| `gui` (native PySide6 window) \| `browser+vscode` \| `browser+gui` \| `vscode+gui` \| `all` \| `none` |
| `manimSlidesPreview.guiArgs` | `[]` | Extra flags for the native GUI presenter (`manim-slides present`), e.g. `["--fullscreen"]`, `["--hide-mouse"]`, `["-S","2"]` for a second monitor |
| `manimSlidesPreview.pptxExport` | `false` | Auto-export a PowerPoint (`.pptx`) after every changed preview — runs in the background through the warm daemon, never delays the preview, skipped when slides are unchanged |
| `manimSlidesPreview.pptxPath` | `""` | Output location: empty = next to the scene file; a folder puts `<file>.pptx` inside it; a `.pptx` path is used as-is (relative paths resolve against the scene file's folder) |
| `manimSlidesPreview.pptxArgs` | `[]` | Extra flags for `manim-slides convert --to pptx`, e.g. `["-cwidth=1920","-cheight=1080"]` |
| `manimSlidesPreview.port` | `7801` | Auto-increments if busy |
| `manimSlidesPreview.extraRenderArgs` / `extraConvertArgs` | `[]` | Power-user pass-through |

## Tips & troubleshooting

- **Nothing renders / "failed to start"** → `manim-slides` isn't on VS Code's PATH.
  Set `manimSlidesPreview.command` to the full path
  (e.g. `C:\Python313\Scripts\manim-slides.exe`) or `py -m manim_slides`.
- **Using a venv?** Select its interpreter with the Python extension, then set
  `manimSlidesPreview.command` to `<venv>/Scripts/manim-slides` (Windows) or
  `<venv>/bin/manim-slides`.
- **`--offline` not recognized** → `pip install -U manim-slides`, or set
  `manimSlidesPreview.offline` to `false` (then the HTML pulls Reveal.js from a CDN).
- **Output artifacts** land in `.manim-slides-preview/` at your workspace root —
  add it to `.gitignore`. Manim's own `media/` and `slides/` folders behave as usual.
- Saves during a running render are **queued**, never lost — the latest save re-runs
  after the current pipeline finishes.
- Keep `-ql` while coding; render final YouTube masters with `manim -pqh` as usual —
  this extension doesn't interfere with your standard Manim workflow.

## Building the VSIX yourself (optional)

```bash
npm install -g @vscode/vsce
cd manim-slides-preview
vsce package        # → manim-slides-preview-1.0.0.vsix
```

MIT licensed. No telemetry, no network calls, no runtime dependencies.
