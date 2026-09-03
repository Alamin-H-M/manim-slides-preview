<p align="center">
  <img src="media/icon.png" width="110" alt="Manim Slides Preview logo">
</p>

<h1 align="center">Manim Slides Preview</h1>

<p align="center">
  Live preview for <a href="https://github.com/jeertmans/manim-slides">manim-slides</a> in VS Code.<br>
  <a href="https://youtu.be/4JbEV3PX5xo"><b>50-second demo video</b></a>
</p>

Press the run button once. After that, every `Ctrl+S` re-renders your changes
and refreshes the interactive presentation in a browser tab, a VS Code tab, or
the native presenter window. A PowerPoint copy is kept up to date in the
background. No terminal commands.

The extension is a single 28 KB file with zero runtime dependencies and zero
telemetry. Everything runs locally: the generated presentation bundles
Reveal.js, so it works without internet.

New to LaTeX, Manim, or manim-slides? The free offline course
[Manim Slides Academy](https://github.com/Alamin-H-M/manim-slides-academy)
teaches the whole stack around this workflow.

## Contents

1. [Requirements](#1-requirements)
2. [Install](#2-install)
3. [First presentation](#3-first-presentation)
4. [The workflow](#4-the-workflow)
5. [Coming from plain Manim](#5-coming-from-plain-manim)
6. [What the extension replaces](#6-what-the-extension-replaces)
7. [Presenting](#7-presenting)
8. [How it stays fast](#8-how-it-stays-fast)
9. [Commands](#9-commands)
10. [Settings](#10-settings)
11. [Troubleshooting](#11-troubleshooting)
12. [Building from source](#12-building-from-source)
13. [Credits](#13-credits)

## 1. Requirements

One-time setup per machine:

| Tool | Verify with | Install |
|---|---|---|
| Python 3.9+ | `python --version` | python.org |
| Manim CE ≥ 0.19 | `manim --version` | `pip install manim` |
| manim-slides ≥ 5.1.10 | `manim-slides --version` | `pip install -U "manim-slides[pyside6]"` |
| LaTeX (MiKTeX or TeX Live) | `latex --version` | Only if your scenes use `MathTex` / `Tex` |

FFmpeg is **not** required. Manim CE ≥ 0.19 encodes video through its bundled
PyAV library. The `ffmpegPath` setting exists only for older Manim versions and
plugins that call an ffmpeg binary directly.

## 2. Install

You need one file: `manim-slides-preview-1.7.4.vsix`
(from [Releases](https://github.com/Alamin-H-M/manim-slides-preview/releases)).
No marketplace, no internet.

**Per user.** In VS Code: Extensions panel → `···` menu → *Install from
VSIX…* → select the file. Or from a terminal:

```
code --install-extension manim-slides-preview-1.7.4.vsix
```

**All users on a shared Windows machine.** Run in an admin PowerShell:

```powershell
Get-ChildItem C:\Users -Directory | ForEach-Object {
  $code = "$($_.FullName)\AppData\Local\Programs\Microsoft VS Code\bin\code.cmd"
  if (Test-Path $code) { & $code --install-extension "C:\path\to\manim-slides-preview-1.7.4.vsix" }
}
```

**All users on Linux/macOS:**

```bash
sudo -u <username> code --install-extension manim-slides-preview-1.7.4.vsix
```

Success indicator: a **Manim Slides** item appears in the status bar whenever a
Python file is open.

## 3. First presentation

1. Open a folder in VS Code and create a `.py` file:

```python
from manim import *
from manim_slides import Slide

class Demo(Slide):
    def construct(self):
        title = Text("Manim Slides Preview", font_size=48)
        self.play(Write(title))
        self.next_slide()          # presentation pauses here

        circle = Circle(color=BLUE, radius=1.5).shift(DOWN * 0.5)
        self.play(title.animate.to_edge(UP), Create(circle))
        self.next_slide()

        self.play(FadeOut(circle), Unwrite(title))
```

2. Click the run button (▶) in the editor title bar, or press `Ctrl+Shift+B`.
   If the file has several scenes, a picker appears once and the choice is
   remembered. The Output panel shows every animation's progress live.
3. A browser tab opens with the interactive presentation. Advance with
   `Space` or `→`, go back with `←`, fullscreen with `F`. The pauses are your
   `next_slide()` calls, exactly as your audience will see them.
4. Edit the code and press `Ctrl+S`. Only the changed animations re-render,
   then the tab refreshes itself.

A `Demo.pptx` also appears next to your file and is silently kept up to date
on every save. A larger example ships with the repo: `example/test_deck.py`,
a ~20-slide deck covering every major animation family plus a 3D scene.

## 4. The workflow

1. Click the run button once.
2. Wait for the render. The interactive preview opens.
3. Edit your code, press `Ctrl+S`.
4. Repeat.

Saving while a render is still running is safe in both directions:

- A real code change stops the now-obsolete render and starts the new code
  immediately. Truncated partial files are discarded so the cache never reuses
  a corrupt file. Disable with `restartOnEdit: false`.
- A save with no actual change never interrupts anything. If the file and
  settings are identical to the last successful render, Manim is not invoked
  at all.

## 5. Coming from plain Manim

A slide deck is your existing Manim code plus pauses. The migration is three
edits:

```python
from manim import *
from manim_slides import Slide          # 1. add this import

class Demo(Slide):                      # 2. Scene -> Slide
    def construct(self):
        circle = Circle(color=BLUE)
        self.play(Create(circle))
        self.next_slide()               # 3. pause point for presenting

        square = Square(color=RED)
        self.play(Transform(circle, square))
        self.next_slide()

        self.play(FadeOut(circle))
```

`Slide` is a `Scene` subclass, so every animation, mobject, and helper you
already use works unchanged. Two rules:

- Combining with special scene types: `Slide` goes first —
  `class X(Slide, MovingCameraScene)`. The reverse order with a bare `Scene`,
  `class X(Scene, Slide)`, is a Python MRO error. The extension detects that
  statically and reports the fix before wasting a render.
- Everything between two `next_slide()` calls plays as one slide.

Your plain-Manim files keep working: if the
[Manim Sideview](https://marketplace.visualstudio.com/items?itemName=Rickaym.manim-sideview)
extension is installed, the run button detects files with only `Scene` classes
and hands them to Sideview, including on every `Ctrl+S`. The routing corrects
itself: add a `Slide` import and the next save comes back to this extension.
Disable with `routePlainManim: false`.

## 6. What the extension replaces

The terminal workflow, per edit, for each preview target:

| You want | Terminal only | With this extension |
|---|---|---|
| Browser preview | `manim-slides render deck.py MyScene`, then `manim-slides convert MyScene slides.html --open`, then find and refresh the tab | `Ctrl+S`; the tab refreshes itself |
| Native presenter window | render, then `manim-slides present MyScene`; the window closes on every edit | `Ctrl+S`; the window relaunches with fresh slides |
| Preview inside VS Code | not possible without extra tooling | set `openIn: "vscode"` |
| PowerPoint file | `manim-slides convert --to pptx MyScene deck.pptx`, redone after each change | updated automatically on every save |
| Multiple scenes | retype the scene names in order, every time | picked once, remembered |
| Re-render only changes | remember the right flags | automatic; cache hits are marked in the log |

## 7. Presenting

**Browser tab (default).** Detach the preview tab into its own window, snap it
with `Win+←/→`, or press `F` for fullscreen. Share the tab in any video-call
tool or drag it to the projector. Every `Ctrl+S` refreshes it silently, and
you stay on the slide you were viewing.

**VS Code tab.** Set `openIn` to `vscode` for a preview beside your code.

**Native window.** Run *Manim Slides: Present in Native Window (GUI)*, or set
`openIn` to `gui` to make the window part of the save loop. This is
`manim-slides present`: a resizable, OS-snappable PySide6 window with full
presenter hotkeys. Pass flags with `guiArgs`, for example `["--fullscreen"]`
or `["-S","2"]` for a second monitor.

Any combination works: `browser+gui`, `all`, `none`, and so on.

## 8. How it stays fast

Four layers, all automatic:

1. **Partial-movie cache.** Manim hash-matches every animation; only edited
   ones re-render. Cache files live in `.manim-slides-preview/cache/`, not in
   your project root.
2. **Render daemon.** A persistent background Python process imports Manim
   once and renders every save in-process, removing interpreter startup and
   import cost per save. It frees memory after each request, exits after 10
   idle minutes, restarts on demand, and falls back to a plain subprocess if
   anything goes wrong. A watchdog restarts it if a render produces no output
   for `stallTimeout` seconds, so a stuck render never requires closing
   VS Code.
3. **Convert-skip cache.** If a render produced identical slides, the HTML
   conversion and browser reload are skipped.
4. **Source fingerprint.** A byte-identical save skips Manim entirely. This is
   the only guard that works for updater/ValueTracker animations, which Manim
   cannot hash-cache.

## 9. Commands

Open the palette with `Ctrl+Shift+P`:

| Command | Effect |
|---|---|
| Manim Slides: Render & Preview | Full pipeline; same as the run button / `Ctrl+Shift+B` |
| Manim Slides: Select Scene(s) | Re-pick which classes to render |
| Manim Slides: Open Preview in Browser | Open the presentation in an external tab |
| Manim Slides: Present in Native Window (GUI) | Launch the PySide6 presenter |
| Manim Slides: Export PowerPoint (.pptx) Now | One-off export, even if unchanged |
| Manim Slides: Export Video (.mp4) | Copy the rendered per-scene `.mp4` files into `videos/` next to your file |
| Manim Slides: Show Output Log | Full render/convert logs; first stop for any error |
| Manim Slides: Clear Cache | Wipe all caches for a clean rebuild |
| Manim Slides: Stop Preview Server | Free the port |

## 10. Settings

All keys are prefixed `manimSlidesPreview.`:

| Setting | Default | Meaning |
|---|---|---|
| `command` | `manim-slides` | Executable. Use a full path or `py -m manim_slides` for venvs and PATH issues |
| `quality` | `-ql` | Render quality: `-ql` 480p15, `-qm` 720p30, `-qh` 1080p60, `-qp` 1440p60, `-qk` 4K |
| `renderOnSave` | `true` | Re-render on `Ctrl+S` for files previewed at least once |
| `restartOnEdit` | `true` | A changed save stops an in-flight render and starts the new code |
| `openIn` | `browser` | Preview target: `browser`, `vscode`, `gui`, any `+` combination, `all`, `none` |
| `guiArgs` | `[]` | Extra flags for the native presenter, e.g. `["--fullscreen"]` |
| `pptxExport` | `true` | Keep a `.pptx` next to the scene file, updated in the background |
| `pptxPath` | `""` | Empty = next to the scene file; a folder or full `.pptx` path also works |
| `pptxArgs` | `[]` | Extra flags for `convert --to pptx` |
| `offline` | `true` | Bundle Reveal.js locally; presentations need no internet (requires manim-slides ≥ 5.1.10) |
| `oneFile` | `false` | Single self-contained HTML, for sharing one file |
| `htmlControls` | `true` | On-screen navigation arrows in the HTML |
| `useDaemon` | `true` | Warm render daemon |
| `pythonCommand` | `""` | Interpreter for the daemon; point it at your venv's Python |
| `cache` | `true` | All caching layers; *Clear Cache* wipes them |
| `stallTimeout` | `300` | Seconds of complete silence before a render is treated as stuck |
| `routePlainManim` | `true` | Hand plain-Manim files to Manim Sideview when installed |
| `turboPreview` | `false` | 640×360@15fps drafts, skips reversed videos; preview only |
| `x264Preset` | `veryfast` | Encoder speed preset; quality is CRF-controlled and unchanged |
| `port` | `7801` | Preview server port; auto-increments if busy |
| `ffmpegPath` | `""` | Path to an ffmpeg binary, for older Manim versions and ffmpeg-dependent plugins only |
| `extraRenderArgs`, `extraConvertArgs` | `[]` | Pass-through flags |

## 11. Troubleshooting

| Symptom | Fix |
|---|---|
| Nothing happens, or "failed to start" | `manim-slides` is not on VS Code's PATH. Set `command` to the full path (e.g. `C:\Python313\Scripts\manim-slides.exe`) or `py -m manim_slides` |
| Renders work in a terminal but not here | Virtualenv mismatch. Point `command` at `<venv>/Scripts/manim-slides` (Windows) or `<venv>/bin/manim-slides` |
| `--offline` not recognized | `pip install -U manim-slides` (needs ≥ 5.1.10), or set `offline: false` |
| No Slide classes found | The class must inherit from `manim_slides.Slide` |
| Render looks frozen | Watch the Output panel; the post-render phase shows its own progress line. After `stallTimeout` seconds of true silence the extension restarts the daemon and retries automatically |
| Preview tab closed | Click the status-bar item, or run *Manim Slides: Open Preview in Browser* |
| Port conflict | The server auto-increments from `port`, 20 attempts |
| Anything else | Open `.manim-slides-preview/msp.log`. Every command, its full output, and all errors are recorded there with timestamps. Search the error text verbatim or attach the file to an issue |

Generated files land in `.manim-slides-preview/` at the workspace root; add it
to `.gitignore`. Manim's own `media/` and `slides/` folders behave exactly as
with terminal use. The extension writes no registry entries and makes no
network calls.

## 12. Building from source

```bash
npm install -g @vscode/vsce
cd manim-slides-preview
vsce package        # -> manim-slides-preview-1.7.4.vsix
```

MIT licensed.

## 13. Credits

**Concept, design & testing — [Alamin Maruf](https://github.com/Alamin-H-M).**
He spotted the gap this extension fills, specified every feature, made every
product decision, and battle-tested each build on a real Windows + Manim CE
setup. Nothing shipped without being run against a live manim-slides project
first.

**Code — AI-generated.** The implementation was written by an AI assistant
working under Alamin's direction, iterating on his bug reports and feature
specs. Found a bug? Open an issue — a human reads them.
