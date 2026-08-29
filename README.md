# Manim Slides Preview

**Live preview for manim-slides in VS Code** — auto render on save, hot-reload in the browser / VS Code tab / native GUI, and automatic PowerPoint (.pptx) export. Press ▶ once — after that every save updates your presentation.

> 🤖 **Open source, AI-generated.** This extension was built by an AI assistant at a user's
> request and published for everyone. Found a bug? Open an issue or PR — contributions welcome.
>
> 📚 **New to LaTeX / Manim / manim-slides?** Learn the whole stack with the free offline
> course **[Manim Slides Academy](https://github.com/Alamin-H-M/manim-slides-academy)** — built around this extension's workflow.


A **lightweight, zero-dependency, fully offline** VS Code extension that gives
`manim-slides` a true one-click workflow (if you know the Manim Sideview
extension: this is that experience, but for interactive presentations):

> Open folder → create `.py` → click ▶ → **interactive** slide preview appears → `Ctrl+S` → preview auto-refreshes.

Unlike a plain video preview, this preview is the real **interactive HTML presentation**
(Reveal.js): it pauses at every `self.next_slide()` and you advance with
**Space / Arrow keys**, exactly like your audience will see it. What you test in the
preview is exactly what you present.

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

## One render, two products 🎞

manim-slides is built **on top of a normal manim render** — so every time you
press ▶, you get BOTH:

1. **A live interactive presentation** (pauses at every `next_slide()`,
   Space/arrow keys) — for teaching live, screen-sharing, or the projector.
2. **A complete .mp4 video per scene** (all animations concatenated, no
   pauses) — ready to edit and upload to YouTube or drop into a course.

The video files are listed in the Output panel after every render, and
`Manim Slides: Export Video (.mp4)` copies them into a `videos/` folder next
to your scene file. Draft quality (`-ql`) while you iterate; set
`manimSlidesPreview.quality` to `-qh` (1080p60), render once, export again —
that's your master file. No second tool, no re-render for a different format.

## Plays nice with Manim Sideview 🔀

The ▶ button auto-detects what kind of file you're in:

- **manim-slides deck** (imports `manim_slides` or has a `Slide` class) → this
  extension renders it: interactive preview, live reload, background .pptx.
- **Plain manim file** (only `Scene` classes) → the run is handed to the
  [Manim Sideview](https://marketplace.visualstudio.com/items?itemName=Rickaym.manim-sideview)
  extension if you have it installed — its video panel is the better tool for
  plain scenes. Ctrl+S keeps re-running Sideview for that file too.

The routing is sticky and self-correcting: add `from manim_slides import Slide`
to a plain file and the very next save brings it back to this extension.
No Sideview installed? Plain files render here as ordinary scenes.
Disable the whole behavior with `manimSlidesPreview.routePlainManim: false`.

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
| Manim CE ≥ 0.19 | `manim --version` | `pip install manim` |
| manim-slides **≥ 5.1.10** | `manim-slides --version` | `pip install -U "manim-slides[pyside6]"` |
| LaTeX (MiKTeX / TeX Live) | `latex --version` | **only if** your scenes use `MathTex` / `Tex` |

> **No FFmpeg needed.** Manim CE ≥ 0.19 encodes video through its bundled PyAV
> library — you do **not** have to install an ffmpeg binary for this extension
> or for rendering. (The `ffmpegPath` setting exists purely for older Manim
> versions and plugins that still call ffmpeg directly.)

> `--offline` HTML export needs manim-slides **5.1.10 or newer**. If you're on an
> older version, either update or turn off `manimSlidesPreview.offline` in settings.

---

## Installing the extension (offline, for all users)

You get a single `manim-slides-preview-1.7.4.vsix` file. No marketplace, no internet needed.

### Option A — per user (simplest)
1. Copy the `.vsix` to the machine.
2. In VS Code: **Extensions panel → `···` menu → Install from VSIX…** → pick the file.
   - Or from a terminal: `code --install-extension manim-slides-preview-1.7.4.vsix`

### Option B — every user on a shared machine (Windows)
Run in an **admin** PowerShell — installs for each existing user profile:

```powershell
Get-ChildItem C:\Users -Directory | ForEach-Object {
  $code = "$($_.FullName)\AppData\Local\Programs\Microsoft VS Code\bin\code.cmd"
  if (Test-Path $code) { & $code --install-extension "C:\path\to\manim-slides-preview-1.7.4.vsix" }
}
```

If VS Code is installed system-wide (`C:\Program Files\Microsoft VS Code`), each user
just runs once: `code --install-extension manim-slides-preview-1.7.4.vsix`.

### Option C — every user on Linux/macOS
```bash
sudo -u <username> code --install-extension manim-slides-preview-1.7.4.vsix
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

   Or grab **`example/test_deck.py`** from this repo — a ~20-slide showcase
   that runs every major Manim animation family (creation, transforms,
   updaters, rate functions, graphs, LaTeX, a looping slide, even a bonus 3D
   scene). It's the deck we stress-test the extension with; if it runs on
   your machine, everything works.

3. Click the **▶ play button** in the editor title bar
   (or `Ctrl+Shift+B`, or Command Palette → *Manim Slides: Render & Preview*).
   - First run: if the file has several `Slide` classes, you pick which one(s) — remembered afterwards.
4. The **interactive preview opens beside your code**. Click inside it, press
   **Space / →** to advance through your `next_slide()` stops, **F** for fullscreen.
5. Edit code → **`Ctrl+S`** → it re-renders, re-converts, and the preview
   **auto-refreshes**. That's the whole loop.

### Presenting from the browser tab
- Status bar → click **“Preview ready :7801”** (or run *Manim Slides: Open Preview in Browser*).
- A Chrome/Edge/Firefox tab opens at `http://127.0.0.1:7801/demo.html`.
- Detach the tab into its own window → snap it with **Win + ← / →**, or press **F** for fullscreen.
- Works with any screen-sharing or projector setup — what you share is the interactive presentation itself.
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
| `Manim Slides: Open Preview in Browser` | Pop the interactive preview into an external browser tab |
| `Manim Slides: Present in Native Window (GUI)` | Launch the PySide6 presenter window |
| `Manim Slides: Export Video (.mp4)` | Copy the complete per-scene videos (same render!) into `videos/` next to your file — for editing / YouTube / course production |
| `Manim Slides: Show Output Log` | Render/convert logs (errors show here) |
| `Manim Slides: Stop Preview Server` | Free the port |

## Settings

| Setting | Default | Notes |
|---|---|---|
| `manimSlidesPreview.command` | `manim-slides` | Use `py -m manim_slides` or a full path if not on PATH / in a venv (used by the subprocess fallback + GUI present) |
| `manimSlidesPreview.useDaemon` | `true` | Persistent render daemon — skips Python startup/imports on every save |
| `manimSlidesPreview.pythonCommand` | `""` | Interpreter for the daemon (`py`, a venv's `python.exe`, …). Empty = `python`/`python3`. Must have manim-slides installed |
| `manimSlidesPreview.cache` | `true` | Partial-movie cache + convert-skip cache. `Manim Slides: Clear Cache` wipes it |
| `manimSlidesPreview.stallTimeout` | `300` | Watchdog (seconds): a render that produces **no output** for this long is treated as stuck — the daemon is restarted and the render automatically retries as a plain subprocess. You never have to close VS Code to un-wedge a render |
| _(automatic)_ | — | **No-op saves are free:** if the scene file and settings are bit-identical to the last successful render, Ctrl+S skips manim entirely (matters on decks with updater/ValueTracker animations, which manim can never hash-cache) |
| `manimSlidesPreview.ffmpegPath` | `""` | Full path to your installed `ffmpeg`. Its folder is prepended to PATH and exported as `FFMPEG_BINARY` for every render/convert/present the extension runs, so the whole toolchain resolves to **your** ffmpeg. Note: Manim CE ≥ 0.19 encodes video through its bundled `pyav` library and never shells out to an ffmpeg binary — this setting matters for older Manim versions, `manim-voiceover`, GIF/PPTX conversion, and plugins that do call `ffmpeg`. |
| `manimSlidesPreview.quality` | `-ql` | 480p15 draft while coding; switch to `-qh` for final checks |
| `manimSlidesPreview.routePlainManim` | `true` | Hand plain-manim files (no manim-slides) to the Manim Sideview extension when installed |
| `manimSlidesPreview.renderOnSave` | `true` | The Ctrl+S magic |
| `manimSlidesPreview.offline` | `true` | Bundles Reveal.js locally — works with zero internet |
| `manimSlidesPreview.oneFile` | `false` | Single self-contained HTML (great for sharing, slower to build) |
| `manimSlidesPreview.openIn` | `browser` | Any combination of the three preview targets: `browser` \| `vscode` \| `gui` (native PySide6 window) \| `browser+vscode` \| `browser+gui` \| `vscode+gui` \| `all` \| `none` |
| `manimSlidesPreview.guiArgs` | `[]` | Extra flags for the native GUI presenter (`manim-slides present`), e.g. `["--fullscreen"]`, `["--hide-mouse"]`, `["-S","2"]` for a second monitor |
| `manimSlidesPreview.pptxExport` | `true` | **On by default:** the first ▶ render creates a `.pptx` next to your scene file, and every changed Ctrl+S silently keeps it up to date — background export through the warm daemon, never delays the preview, skipped when slides are unchanged |
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
- **Every run is recorded to a plain-text log**: `.manim-slides-preview/msp.log`
  (timestamped, includes the full render/convert output). If you hit an unknown
  error, open that file and search the error text online — or paste it into an
  issue. The log rotates at 2 MB so it never grows unbounded.
- **The Output panel opens automatically on every render** — cached animations
  show as instant ⚡ bars, new ones as live 🎬 bars (numbered continuously across
  scenes in multi-scene renders), and each scene's post-render phase
  (concatenating/reversing slide videos) has its own 📼 progress line, so long
  decks never look frozen.
- **Housekeeping is automatic**: stale preview assets are pruned after every
  convert (heavy decks used to leak megabytes per edit session), and the render
  daemon frees its memory after each request and shuts itself down after 10
  minutes idle (it restarts instantly on the next render).
- **Output artifacts** land in `.manim-slides-preview/` at your workspace root —
  add it to `.gitignore`. Manim's own `media/` and `slides/` folders behave as usual.
- Saves during a running render are **queued**, never lost — the latest save re-runs
  after the current pipeline finishes.
- Keep `-ql` while coding; render final high-quality videos with `manim -pqh` as usual —
  this extension doesn't interfere with your standard Manim workflow.

## Building the VSIX yourself (optional)

```bash
npm install -g @vscode/vsce
cd manim-slides-preview
vsce package        # → manim-slides-preview-1.7.4.vsix
```

MIT licensed. No telemetry, no network calls, no runtime dependencies.
