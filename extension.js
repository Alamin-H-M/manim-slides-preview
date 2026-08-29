// Manim Slides Preview — lightweight, offline, zero-dependency VS Code extension.
// Pipeline: manim-slides render  ->  manim-slides convert (offline HTML)
//           -> built-in live-reload server -> interactive preview (VS Code tab or browser).
"use strict";

const vscode = require("vscode");
const cp = require("child_process");
const crypto = require("crypto");
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let output;            // OutputChannel
let statusBar;         // StatusBarItem
let server = null;     // http.Server
let serverPort = 0;
let sseClients = new Set();
let running = false;   // a pipeline is currently executing
let queued = null;     // file path queued while running
let currentChild = null;
let activeTracker = null;          // per-render progress tracker (render step only)
let logStream = null;              // persistent plain-text log (msp.log)
let logStreamPath = null;
const animTotals = new Map();      // fileKey -> animation count from last render

// Per-file memory: { scenes: [..], previewDir, htmlName, previewed: true }
const fileState = new Map();

// Per-workspace render daemons: rootDir -> { child, ready, busy, buf, resolvers }
const daemons = new Map();

const OUT_DIR_NAME = ".manim-slides-preview";
let EXT_VERSION = "?";
try { EXT_VERSION = require("./package.json").version; } catch (_) {}
const CACHE_DIR_NAME = "cache"; // hidden pycache-style store inside OUT_DIR_NAME

// Python daemon: imports manim/manim-slides ONCE, then executes render/convert
// requests in-process — every save skips interpreter startup + imports
// (the dominant fixed cost per iteration, especially on Windows).
const DAEMON_SCRIPT = `import sys, json, time, os
t0 = time.time()
try:
    from manim_slides.__main__ import cli
except Exception as e:
    print(json.dumps({"msp": "fatal", "err": str(e)[:300]}), flush=True)
    sys.exit(3)

# In-process manim renderer: 'manim-slides render' is just an alias that spawns
# 'python -m manim render' as a SUBPROCESS (interpreter + imports every time).
# Calling manim's click command directly keeps rendering in this warm process,
# which benefits every quality level.
try:
    from manim.cli.render.commands import render as _manim_render
except Exception:
    _manim_render = None

# Low-level encoder tuning: Manim 0.21 encodes partial videos through PyAV's
# libx264 with no preset (defaults to 'medium'). We wrap add_stream so a faster
# preset can be injected per-request. Class-level patch is safe: verified that
# av.container.OutputContainer dispatches through the class dict.
_PRESET = {"value": None}
try:
    import av
    _orig_add_stream = av.container.OutputContainer.add_stream
    def _patched_add_stream(self, codec_name=None, rate=None, options=None, **kw):
        p = _PRESET["value"]
        if p and codec_name == "libx264":
            options = dict(options or {})
            options.setdefault("preset", p)
        return _orig_add_stream(self, codec_name, rate=rate, options=options, **kw)
    av.container.OutputContainer.add_stream = _patched_add_stream
except Exception:
    pass

try:
    from manim_slides.slide.base import BaseSlide
    # Windows: multiprocessing uses spawn -> each pool worker re-imports its
    # modules (seconds each) and can stall inside a piped daemon. One process
    # is safer and, for preview-sized videos, just as fast.
    BaseSlide.num_processes = 1 if os.name == "nt" else max(1, (os.cpu_count() or 2) - 1)
except Exception:
    BaseSlide = None

# Stall visibility: while a request runs, dump all thread stacks to stderr
# every 5 minutes -> if anything ever wedges, the log shows exactly where.
try:
    import faulthandler
except Exception:
    faulthandler = None

# Dedupe log lines: the 'manim-slides' logger has its own RichHandler AND
# propagates to the root logger, which manim also equips with a RichHandler
# during render -> every 'Generated N slides' line printed twice.
try:
    import logging
    logging.getLogger("manim-slides").propagate = False
except Exception:
    pass

IDLE_EXIT_SECS = float(os.environ.get("MSP_DAEMON_IDLE_EXIT", "600"))

print(json.dumps({"msp": "ready", "import_secs": round(time.time() - t0, 2)}), flush=True)

# Idle watchdog: a warm daemon holds manim imported (~165 MB idle RSS). When
# the user walks away we exit quietly; the extension restarts us on demand
# (costing only the one-time import). Implemented via a reader thread +
# main-thread queue so stdin EOF also shuts us down promptly.
import threading, queue as _q
_requests = _q.Queue()
def _reader():
    for line in sys.stdin:
        _requests.put(line)
    _requests.put(None)  # EOF
threading.Thread(target=_reader, daemon=True).start()

def run(args, in_process_render):
    try:
        if in_process_render and _manim_render is not None and args and args[0] == "render":
            _manim_render.main(args[1:], standalone_mode=False)
        else:
            cli(args, standalone_mode=False)
        return 0
    except SystemExit as e:
        code = e.code
        return int(code) if isinstance(code, int) else (0 if code is None else 1)
    except Exception:
        import traceback
        sys.stderr.write(traceback.format_exc())
        return 1

while True:
    try:
        line = _requests.get(timeout=IDLE_EXIT_SECS)
    except _q.Empty:
        # idle too long -> free the memory; extension will respawn us
        print(json.dumps({"msp": "idle_exit"}), flush=True)
        break
    if line is None:
        break  # stdin closed
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
    except Exception:
        continue
    if BaseSlide is not None:
        BaseSlide.skip_reversing = bool(req.get("skip_reversing", False))
    _PRESET["value"] = req.get("x264_preset") or None
    t = time.time()
    if faulthandler:
        try: faulthandler.dump_traceback_later(300, repeat=True, exit=False)
        except Exception: pass
    rc = run(req.get("args", []), bool(req.get("in_process", True)))
    if faulthandler:
        try: faulthandler.cancel_dump_traceback_later()
        except Exception: pass
    print(json.dumps({"msp": "done", "id": req.get("id"), "rc": rc,
                      "secs": round(time.time() - t, 2)}), flush=True)
    # Lightweight: return freed pages to the OS between requests. Renders
    # allocate hundreds of MB of frame buffers; without malloc_trim glibc
    # keeps them in the heap and the idle daemon squats on ~250 MB RSS.
    try:
        import gc
        gc.collect()
        if sys.platform.startswith("linux"):
            import ctypes
            ctypes.CDLL("libc.so.6").malloc_trim(0)
    except Exception:
        pass
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function cfg() {
  return vscode.workspace.getConfiguration("manimSlidesPreview");
}

function openLogStream(previewDir) {
  const p = path.join(previewDir, "msp.log");
  if (logStreamPath === p && logStream) return;
  try { if (logStream) logStream.end(); } catch (_) {}
  try {
    // rotate at ~2 MB so the log never grows unbounded
    try { if (fs.existsSync(p) && fs.statSync(p).size > 2 * 1024 * 1024) fs.renameSync(p, p + ".1"); } catch (_) {}
    logStream = fs.createWriteStream(p, { flags: "a" });
    logStreamPath = p;
    logStream.write(`\n===== session ${new Date().toISOString()} · extension v${EXT_VERSION} · ${process.platform} =====\n`);
  } catch (_) { logStream = null; logStreamPath = null; }
}

function fileLog(text) {
  if (!logStream) return;
  try { logStream.write(text); } catch (_) {}
}

function log(msg) {
  // never glue a log line onto a live progress bar / 📼 line still growing
  if (activeTracker) {
    if (activeTracker.openLine) activeTracker.closeOpenLine();
    if (activeTracker.postOpen) activeTracker.closePostLine();
  }
  output.appendLine(msg);
  fileLog(`[${new Date().toISOString().slice(11, 19)}] ${msg}\n`);
}

function setStatus(text, tooltip, spinning) {
  statusBar.text = (spinning ? "$(sync~spin) " : "$(rocket) ") + text;
  statusBar.tooltip = tooltip || "Manim Slides Preview";
  statusBar.show();
}

/** Split a command string into argv, respecting quotes. */
function splitCmd(str) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(str))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/**
 * Cache key for the convert step: hash of the *normalized* slide configs
 * (slides/<Scene>.json re-serialized, so cosmetic whitespace differences
 * between runs don't bust the cache) + the convert-relevant settings.
 * If this key is unchanged after a render, every animation was served from
 * Manim's cache and the existing HTML is still valid -> convert can be skipped.
 */
function convertCacheKey(fileDir, scenes, conf) {
  const h = crypto.createHash("md5");
  for (const scene of scenes) {
    const jsonPath = path.join(fileDir, "slides", `${scene}.json`);
    try {
      h.update(JSON.stringify(JSON.parse(fs.readFileSync(jsonPath, "utf8"))));
    } catch (_) {
      return null; // missing/unparsable config -> never skip
    }
  }
  h.update(JSON.stringify([
    conf.get("offline"), conf.get("oneFile"), conf.get("htmlControls"),
    conf.get("extraConvertArgs") || [],
  ]));
  return h.digest("hex");
}

/** Fingerprint of everything that determines render output: the scene file,
 *  every sibling .py it could import, and the render-relevant settings.
 *  If this is unchanged since the last successful render, running manim again
 *  is pure waste — worse than waste on decks with updater/ValueTracker
 *  animations, which manim can NEVER cache (hashing is disabled for
 *  time-dependent updaters), so they'd re-render + re-convert + reload the
 *  browser on every single no-op save. */
function sourceKey(filePath, scenes, conf) {
  try {
    const h = crypto.createHash("md5");
    h.update(fs.readFileSync(filePath));
    const dir = path.dirname(filePath);
    for (const f of fs.readdirSync(dir).sort()) {
      if (f.endsWith(".py") && f !== path.basename(filePath)) {
        const p = path.join(dir, f);
        try { const st = fs.statSync(p); h.update(f + ":" + st.size + ":" + st.mtimeMs); } catch (_) {}
      }
    }
    h.update(JSON.stringify([
      scenes, conf.get("quality"), !!conf.get("turboPreview"),
      conf.get("x264Preset") || "", conf.get("extraRenderArgs") || [],
    ]));
    return h.digest("hex");
  } catch (_) { return null; }
}

/** Delete files in <html>_assets that the freshly written HTML no longer
 *  references. manim-slides names assets by content hash and never cleans up,
 *  so heavy decks leak megabytes per edit session without this. */
function pruneStaleAssets(htmlPath) {
  try {
    const assetsDir = htmlPath.replace(/\.html?$/i, "") + "_assets";
    if (!fs.existsSync(assetsDir)) return;
    const html = fs.readFileSync(htmlPath, "utf8");
    let removed = 0, freed = 0;
    for (const f of fs.readdirSync(assetsDir)) {
      if (!html.includes(f)) {
        const p = path.join(assetsDir, f);
        try { freed += fs.statSync(p).size; fs.rmSync(p, { force: true }); removed++; } catch (_) {}
      }
    }
    if (removed) log(`[convert] pruned ${removed} stale asset file${removed === 1 ? "" : "s"} (${(freed / 1048576).toFixed(1)} MB freed)`);
  } catch (_) { /* best-effort housekeeping — never fail the pipeline */ }
}

/** Detect Slide subclasses in a python source (fast regex, no AST needed). */
function detectScenes(source) {
  const slideClasses = [];
  const sceneClasses = [];
  const re = /^class\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:/gm;
  let m;
  while ((m = re.exec(source))) {
    const name = m[1];
    const bases = m[2];
    if (/\bSlide\b|Slide\s*(,|$)/.test(bases) || /Slide/.test(bases)) {
      slideClasses.push(name);
    } else if (/Scene/.test(bases)) {
      sceneClasses.push(name);
    }
  }
  return { slideClasses, sceneClasses };
}

/**
 * Build the environment for spawned render/convert processes.
 * If `ffmpegPath` is configured, its directory is put FIRST on PATH so that
 * anything invoking `ffmpeg` (manim < 0.19, manim-voiceover, GIF/pptx
 * conversion, plugins) resolves to the user's installed binary. FFMPEG_BINARY
 * is also exported for tools (moviepy-style) that honor it directly.
 */
function buildEnv() {
  const env = { ...process.env };
  const ff = (cfg().get("ffmpegPath") || "").trim();
  if (ff) {
    const dir = path.dirname(ff);
    env.PATH = dir + path.delimiter + (env.PATH || "");
    env.FFMPEG_BINARY = ff;
  }
  return env;
}

// ---------------------------------------------------------------------------
// Render progress tracker — parses Manim's log stream and prints one clean
// line per animation (⚡ cache hit / 🎬 newly rendered) plus a summary bar,
// and mirrors live counts in the status bar.
// ---------------------------------------------------------------------------
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/**
 * Route raw process output: while a render tracker is active, it consumes the
 * stream and prints clean per-animation lines; otherwise raw pass-through.
 * Manim's noisy tqdm carriage-return spam is filtered out in tracker mode.
 */
let lastChildOutput = 0; // watchdog: last time any child produced output

function routeOutput(text) {
  lastChildOutput = Date.now();
  fileLog(text.replace(ANSI_RE, "").replace(/\r(?!\n)/g, "\n"));
  if (activeTracker) activeTracker.feed(text);
  else output.append(text);
}

class RenderTracker {
  constructor(fileKey, expectedTotal) {
    this.fileKey = fileKey;
    this.expectedTotal = expectedTotal || 0; // from previous run, 0 = unknown
    this.anims = new Map(); // index -> { state: 'cached'|'rendering'|'rendered', name }
    this.carry = "";
    this.lastPct = new Map();
    this.raw = ""; // full raw output, dumped if the render fails
    this.postLabel = null; // post-processing phase label (concat/reverse)
    this.postOpen = false; // a 📼 line is currently unterminated
    this.postPct = 0;
    // Multi-scene renders: manim restarts animation numbering at 0 for each
    // scene. Offset raw indices so per-animation tracking never collides.
    this.idxOffset = 0;
    this.lastRawIdx = -1;
    this.sceneBreak = false; // set when a scene finished; next anim 0 = new scene
    this.BAR_W = 24;      // width of each per-animation live bar
    this.openLine = null; // { idx, blocks } — a 🎬 bar currently growing in place
    // Perceived-performance tweening: tqdm reports arrive in jumps; a 100 ms
    // ticker grows the bar smoothly toward the latest target instead.
    this.tween = setInterval(() => this.tick(), 100);
  }

  /**
   * Fast-start easing (x^0.75): fills early blocks quicker than late ones.
   * Progress bars that accelerate at the start are perceived as faster and
   * more trustworthy than linear ones (classic progress-bar UX research).
   */
  easedBlocks(pct) {
    return Math.min(this.BAR_W, Math.floor(Math.pow(pct / 100, 0.75) * this.BAR_W));
  }

  /** Ticker: smoothly advance the open bar toward its eased target. */
  tick() {
    if (!this.openLine) return;
    const pct = this.lastPct.get(this.openLine.idx) || 0;
    const target = this.easedBlocks(pct);
    if (target > this.openLine.blocks) {
      // grow at most 2 blocks per tick -> fluid animation, never a jump
      const step = Math.min(2, target - this.openLine.blocks);
      output.append("█".repeat(step));
      this.openLine.blocks += step;
    }
  }

  counts() {
    let cached = 0, rendered = 0;
    for (const a of this.anims.values()) {
      if (a.state === "cached") cached++;
      else if (a.state === "rendered" || a.state === "rendering") rendered++;
    }
    return { cached, rendered, done: cached + rendered };
  }

  status() {
    const { cached, done } = this.counts();
    const total = Math.max(this.expectedTotal, done);
    const idx = this.openLine ? this.openLine.idx : -1;
    const pct = idx >= 0 ? (this.lastPct.get(idx) || 0) : null;
    let txt = `Rendering ${done}${total ? "/" + total : ""}`;
    if (cached) txt += ` (⚡${cached} cached)`;
    if (pct !== null && pct < 100) txt += ` · anim ${idx} ${pct}%`;
    return txt;
  }

  /** Terminate an unfinished 📼 post-processing line. */
  closePostLine() {
    if (!this.postOpen) return;
    output.append(this.postPct >= 100 ? "done\n" : "\n");
    this.postOpen = false;
  }

  /** Finish the in-place growing bar of the currently rendering animation. */
  closeOpenLine() {
    if (!this.openLine) return;
    const { idx, blocks } = this.openLine;
    const a = this.anims.get(idx);
    const nm = a && a.name ? a.name.slice(0, 55) : "";
    output.append("█".repeat(this.BAR_W - blocks) + `] 100%  ${nm}\n`);
    if (a) a.state = "rendered";
    this.openLine = null;
  }

  /** Cache hit: print one full instant bar. */
  printCached(idx, name) {
    this.closeOpenLine();
    this.closePostLine();
    const nm = (name || "").slice(0, 55);
    output.append(
      `  ⚡ anim ${String(idx).padStart(2)} [${"█".repeat(this.BAR_W)}] cached${nm ? "  " + nm : ""}\n`
    );
  }

  /** Map a per-scene animation index to a global one (scenes restart at 0). */
  globalIdx(raw) {
    // A new scene begins when the previous one logged "Rendered X" OR the raw
    // index went backwards (defensive: works even if that log line changes).
    if (this.sceneBreak || raw < this.lastRawIdx) {
      this.idxOffset += this.lastRawIdx + 1;
      this.sceneBreak = false;
      this.lastRawIdx = -1;
    }
    if (raw > this.lastRawIdx) this.lastRawIdx = raw;
    return this.idxOffset + raw;
  }

  feed(text) {
    if (this.raw.length < 400000) this.raw += text; // cap ~400 KB
    this.carry += text.replace(ANSI_RE, "");
    // split on both \n and \r (tqdm emits \r refreshes)
    const parts = this.carry.split(/[\r\n]/);
    this.carry = parts.pop() || "";
    for (const line of parts) {
      // cache hit: "Animation 3 : Using cached"
      let m = /Animation\s+(\d+)\s*:\s*Using cached/.exec(line);
      if (m) {
        const idx = this.globalIdx(+m[1]);
        if (!this.anims.has(idx) || this.anims.get(idx).state !== "cached") {
          this.anims.set(idx, { state: "cached", name: (this.anims.get(idx) || {}).name || "" });
          this.printCached(idx, this.anims.get(idx).name);
          setStatus(this.status(), "Rendering…", true);
        }
        continue;
      }
      // tqdm frame progress: "Animation 2: Transform(Circle):  45%|"
      m = /Animation\s+(\d+):\s*(.*?):\s+(\d+)%\|/.exec(line);
      if (m) {
        const idx = this.globalIdx(+m[1]), name = m[2].trim(), pct = +m[3];
        const existing = this.anims.get(idx);
        // Manim emits a zero-work tqdm line even for cached animations — ignore it
        if (existing && existing.state === "cached") { existing.name = existing.name || name; continue; }

        // a new animation started -> close the previous growing bar
        if (this.openLine && this.openLine.idx !== idx) this.closeOpenLine();

        if (!this.anims.has(idx)) this.anims.set(idx, { state: "rendering", name });
        else this.anims.get(idx).name = name || this.anims.get(idx).name;

        // start this animation's live bar (instant-start illusion: first block
        // appears immediately so the bar never looks stalled at zero)
        if (!this.openLine) {
          this.closePostLine();
          output.append(`  🎬 anim ${String(idx).padStart(2)} [█`);
          this.openLine = { idx, blocks: 1 };
        }
        this.lastPct.set(idx, pct);
        if (pct >= 100) this.closeOpenLine();
        else this.tick(); // eased growth; ticker keeps it moving between reports
        setStatus(this.status(), "Rendering…", true);
        continue;
      }
      // scene finished writing -> close out any in-flight bar + mark the
      // boundary so the next scene's Animation 0 gets a fresh index block
      if (/(Combining to Movie file|File ready at|Rendered \w+)/.test(line)) {
        this.closeOpenLine();
        if (/Rendered \w+/.test(line)) { this.sceneBreak = true; this.closePostLine(); this.postLabel = null; }
      }
      // post-render phase (manim-slides): concatenating + reversing videos.
      // Previously swallowed -> looked like a hang on big decks. One line per
      // scene + live percent now, in the output channel and the status bar.
      m = /(Concatenating animations[^:]*|Reversing[^:]*):\s+(\d+)%\|/.exec(line);
      if (m) {
        this.closeOpenLine();
        const label = m[1].replace(/\s+/g, " ").trim();
        const pct = +m[2];
        if (this.postLabel !== label) {
          this.closePostLine(); // previous scene's 📼 line: terminate before starting a new one
          this.postLabel = label;
          this.postPct = 0;
          output.append(`  📼 ${label} … `);
          this.postOpen = true;
        }
        if (pct >= 100 && this.postOpen) { output.append("done\n"); this.postOpen = false; }
        this.postPct = pct;
        setStatus(`Post-processing ${pct}%`, label, true);
        continue;
      }
      // daemon stall dump (faulthandler) -> make it loud in the output log
      if (/Timeout \(0:0?5:00\)/.test(line)) {
        output.append("\n⚠ render appears stalled — thread stacks dumped to the log (msp.log)\n");
      }
    }
  }

  finish() {
    clearInterval(this.tween);
    this.closeOpenLine();
    this.closePostLine();
    const { cached, rendered, done } = this.counts();
    if (done > 0) {
      animTotals.set(this.fileKey, done);
      const w = 30;
      const cBlocks = Math.round((cached / done) * w);
      log(`  ⎣ total [${"▓".repeat(cBlocks)}${"█".repeat(w - cBlocks)}] ${done} animations · ⚡ ${cached} from cache (▓) · 🎬 ${rendered} newly rendered (█)`);
    }
    return { cached, rendered, done };
  }
}

/** Resolve the python interpreter used for the render daemon. */
function pythonCmd() {
  const explicit = (cfg().get("pythonCommand") || "").trim();
  if (explicit) return splitCmd(explicit);
  return process.platform === "win32" ? ["python"] : ["python3"];
}

/** Get or start the persistent render daemon for a directory. */
function ensureDaemon(workDir) {
  let d = daemons.get(workDir);
  if (d && !d.dead) return d;

  const py = pythonCmd();
  d = { child: null, dead: false, readyPromise: null, pending: new Map(), nextId: 1, buf: "" };
  daemons.set(workDir, d);

  log(`\n[daemon] starting: ${py.join(" ")} (cwd: ${workDir})`);
  const child = cp.spawn(py[0], [...py.slice(1), "-u", "-c", DAEMON_SCRIPT], {
    cwd: workDir,
    env: buildEnv(),
    shell: false,
  });
  d.child = child;

  d.readyPromise = new Promise((resolveReady) => {
    let settled = false;
    const settle = (ok) => { if (!settled) { settled = true; resolveReady(ok); } };

    child.stdout.on("data", (chunk) => {
      d.buf += chunk.toString();
      let nl;
      while ((nl = d.buf.indexOf("\n")) >= 0) {
        const line = d.buf.slice(0, nl); d.buf = d.buf.slice(nl + 1);
        let msg = null;
        try { msg = JSON.parse(line); } catch (_) { routeOutput(line + "\n"); continue; }
        if (!msg || !msg.msp) { routeOutput(line + "\n"); continue; }
        if (msg.msp === "ready") { log(`[daemon] ready (imports: ${msg.import_secs}s)`); settle(true); }
        else if (msg.msp === "idle_exit") { log("[daemon] idle for a while — shut down to free memory (restarts on next render)"); d.dead = true; daemons.delete(workDir); }
        else if (msg.msp === "fatal") { log(`[daemon] failed to import manim-slides: ${msg.err}`); settle(false); }
        else if (msg.msp === "done") {
          const p = d.pending.get(msg.id);
          if (p) { d.pending.delete(msg.id); p.resolve({ rc: msg.rc, secs: msg.secs }); }
        }
      }
    });
    child.stderr.on("data", (c) => routeOutput(c.toString()));
    child.on("error", (e) => { log(`[daemon] spawn error: ${e.message}`); d.dead = true; settle(false); });
    child.on("close", (code) => {
      d.dead = true;
      for (const p of d.pending.values()) p.resolve({ rc: -1 });
      d.pending.clear();
      if (code !== 0 && code !== null) log(`[daemon] exited with code ${code}`);
      settle(false);
    });
  });
  return d;
}

/** Run one CLI request through the daemon. Resolves exit code, or null if
 *  the daemon is unusable OR the request stalled (watchdog) — null always
 *  means "retry via subprocess", so a wedged daemon can never hang the UI. */
async function daemonRun(workDir, args, label, extra) {
  const d = ensureDaemon(workDir);
  const ok = await d.readyPromise;
  if (!ok || d.dead) return null; // caller falls back to subprocess
  log(`\n[${label}] (daemon) manim-slides ${args.join(" ")}`);
  const id = d.nextId++;
  const reqStart = Date.now();
  lastChildOutput = reqStart;
  // Silence watchdog: a real render always logs SOMETHING (tqdm, cache hits,
  // encoder lines). If the daemon goes fully silent for stallSecs, it is
  // wedged (e.g. a multiprocessing pool that never comes back on Windows):
  // kill it -> the close handler resolves this request -> subprocess retry.
  const stallSecs = Math.max(60, Number(cfg().get("stallTimeout")) || 300);
  let watchdogFired = false;
  const wd = setInterval(() => {
    const silent = (Date.now() - lastChildOutput) / 1000;
    if (silent >= stallSecs) {
      watchdogFired = true;
      log(`\n[${label}] ⚠ no output for ${Math.round(silent)}s — daemon looks stuck, restarting it and retrying without the daemon`);
      killDaemon(workDir); // close handler resolves every pending request
    }
  }, 10000);
  const result = await new Promise((resolve) => {
    d.pending.set(id, { resolve });
    try { d.child.stdin.write(JSON.stringify({ id, args, ...(extra || {}) }) + "\n"); }
    catch (e) { d.pending.delete(id); resolve({ rc: -1 }); }
  });
  clearInterval(wd);
  if (watchdogFired || (result.rc === -1 && d.dead)) return null; // -> subprocess retry
  log(`[${label}] exited with code ${result.rc}${result.secs != null ? ` (${result.secs}s)` : ""}`);
  return result.rc;
}

// ---------------------------------------------------------------------------
// Background PowerPoint (.pptx) export
// ---------------------------------------------------------------------------
// Fired AFTER the preview targets are refreshed, and never awaited by the
// pipeline: the preview is always as fast as before. Runs through the warm
// daemon (imports already paid), is skipped when the slide configuration is
// unchanged, coalesces bursts (a save during an export queues exactly one
// follow-up), and writes to a temp file renamed into place so PowerPoint
// never opens a half-written file.

/** Resolve the output .pptx path from settings (absolute, folder, or empty). */
function resolvePptxPath(conf, filePath) {
  const base = path.basename(filePath, ".py") + ".pptx";
  let p = String(conf.get("pptxPath") || "").trim();
  if (!p) return path.join(path.dirname(filePath), base);
  if (!path.isAbsolute(p)) p = path.join(path.dirname(filePath), p);
  return p.toLowerCase().endsWith(".pptx") ? p : path.join(p, base);
}

function exportPptx(filePath, fileDir, scenes, conf, st, force) {
  const dest = resolvePptxPath(conf, filePath);
  const key = (st.guiKey || "") + "|" + JSON.stringify([conf.get("pptxArgs") || [], dest, scenes]);
  if (!force && st.pptxKey === key && fs.existsSync(dest)) {
    log("[pptx] skipped — slides unchanged, " + path.basename(dest) + " already up to date");
    return;
  }
  if (st.pptxBusy) { st.pptxQueued = { filePath, fileDir, scenes, conf }; return; }
  st.pptxBusy = true;

  (async () => {
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const tmp = path.join(path.dirname(dest), `.${path.basename(dest)}.tmp`);
      const args = ["convert", "--to", "pptx", ...(conf.get("pptxArgs") || []), ...scenes, tmp];
      const t0 = Date.now();
      let rc;
      if (conf.get("useDaemon") !== false) {
        rc = await daemonRun(fileDir, args, "pptx");
      }
      if (rc == null || rc === undefined) {
        rc = await run([...splitCmd(conf.get("command") || "manim-slides"), ...args], fileDir, "pptx");
      }
      if (rc === 0 && fs.existsSync(tmp)) {
        const isFirst = !fs.existsSync(dest);
        fs.renameSync(tmp, dest); // atomic: never a half-written .pptx
        st.pptxKey = key;
        const kb = Math.round(fs.statSync(dest).size / 1024);
        log(`[pptx] ${dest} ready (${kb} KB, ${((Date.now() - t0) / 1000).toFixed(1)}s, background)`);
        if (isFirst && !st.pptxToldOnce) {
          // One-time discoverability toast; every later save updates silently.
          st.pptxToldOnce = true;
          if (typeof vscode.window.setStatusBarMessage === "function")
            vscode.window.setStatusBarMessage(
              `$(file-media) PowerPoint created: ${path.basename(dest)} — kept in sync on every save`, 8000);
        }
      } else {
        try { fs.rmSync(tmp, { force: true }); } catch (_) {}
        log("[pptx] export failed — see log above (preview was not affected)");
      }
    } catch (e) {
      log(`[pptx] export error: ${e.message}`);
    } finally {
      st.pptxBusy = false;
      const q = st.pptxQueued;
      st.pptxQueued = null;
      if (q) exportPptx(q.filePath, q.fileDir, q.scenes, q.conf, st, false);
    }
  })();
}

/** Kill one workspace's daemon (used after a failed render: manim's CLI can
 *  leave polluted global state in-process, so we always restart clean).
 *  Pending requests are resolved IMMEDIATELY (rc:-1) — never wait for the
 *  process to actually die: a truly wedged process can ignore SIGTERM, so we
 *  escalate to SIGKILL after 2s in the background. */
function killDaemon(workDir) {
  const d = daemons.get(workDir);
  daemons.delete(workDir);
  if (!d) return;
  d.dead = true;
  for (const p of d.pending.values()) p.resolve({ rc: -1 });
  d.pending.clear();
  const child = d.child;
  if (!child) return;
  try { child.stdin.end(); } catch (_) {}
  try { child.kill(); } catch (_) {}
  const killer = setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} }, 2000);
  child.once("close", () => clearTimeout(killer));
}

function stopDaemons() {
  for (const d of daemons.values()) {
    if (!d.dead && d.child) { try { d.child.stdin.end(); d.child.kill(); } catch (_) {} }
  }
  daemons.clear();
}

/** Quote an argument for the Windows shell (cmd.exe) so paths with spaces survive. */
function winQuote(arg) {
  if (arg === "") return '""';
  if (!/[\s"&^|<>()%!]/.test(arg)) return arg;
  return '"' + arg.replace(/"/g, '""') + '"';
}

/** Run a child process, streaming output to the channel. Resolves exit code. */
function run(argv, cwdDir, label) {
  return new Promise((resolve) => {
    log(`\n[${label}] ${argv.join(" ")}`);
    const isWin = process.platform === "win32";
    // On Windows we must go through the shell to resolve .exe/.cmd via PATHEXT,
    // but then WE are responsible for quoting: build one properly quoted string.
    const child = isWin
      ? cp.spawn(argv.map(winQuote).join(" "), {
          cwd: cwdDir,
          shell: true,
          env: buildEnv(),
        })
      : cp.spawn(argv[0], argv.slice(1), {
          cwd: cwdDir,
          env: buildEnv(),
        });
    currentChild = child;
    child.stdout.on("data", (d) => routeOutput(d.toString()));
    child.stderr.on("data", (d) => routeOutput(d.toString()));
    child.on("error", (e) => {
      log(`[${label}] failed to start: ${e.message}`);
      resolve(-1);
    });
    child.on("close", (code) => {
      currentChild = null;
      log(`[${label}] exited with code ${code}`);
      resolve(code ?? -1);
    });
  });
}

// ---------------------------------------------------------------------------
// Native Python GUI presenter (manim-slides present, PySide6)
// ---------------------------------------------------------------------------
// One managed GUI process per source file. 'manim-slides present' loads the
// slide videos at startup and has no reload mechanism, so on re-render the old
// window is killed and a fresh one is spawned with the new slides (the HTML
// targets, by contrast, are refreshed in place).
const guiProcs = new Map(); // filePath -> { child, killed }

function killGui(filePath) {
  const g = guiProcs.get(filePath);
  if (!g || g.killed || !g.child || g.child.exitCode !== null) return;
  g.killed = true;
  try {
    if (process.platform === "win32") {
      // shell:true wraps the real process in cmd.exe — kill the whole tree.
      cp.spawn("taskkill", ["/pid", String(g.child.pid), "/T", "/F"], { shell: false });
    } else {
      g.child.kill();
    }
  } catch (_) {}
}

function stopAllGuis() {
  for (const fp of guiProcs.keys()) killGui(fp);
  guiProcs.clear();
}

function launchGui(filePath, fileDir, scenes, conf) {
  killGui(filePath);
  const argv = [
    ...splitCmd(conf.get("command") || "manim-slides"),
    "present",
    ...(conf.get("guiArgs") || []),
    ...scenes,
  ];
  log(`\n[gui] ${argv.join(" ")}`);
  const isWin = process.platform === "win32";
  const child = isWin
    ? cp.spawn(argv.map(winQuote).join(" "), { cwd: fileDir, shell: true, env: buildEnv() })
    : cp.spawn(argv[0], argv.slice(1), { cwd: fileDir, env: buildEnv() });
  const g = { child, killed: false };
  guiProcs.set(filePath, g);

  let errBuf = "";
  const started = Date.now();
  child.stdout.on("data", (d) => { errBuf += d.toString(); });
  child.stderr.on("data", (d) => { errBuf += d.toString(); });
  child.on("error", (e) => log(`[gui] failed to start: ${e.message}`));
  child.on("close", (code) => {
    if (g.killed) return; // we relaunched or shut down — expected
    if (code && Date.now() - started < 15000) {
      // Crashed right after launch — almost always a missing Qt binding.
      log(`[gui] exited with code ${code}:\n${errBuf.trim()}`);
      const missingQt = /PySide6|Qt|qtpy|no Qt bindings/i.test(errBuf);
      vscode.window.showErrorMessage(
        missingQt
          ? "The native GUI needs Qt: run 'pip install manim-slides[pyside6]' and save again."
          : "manim-slides present exited unexpectedly — see the 'Manim Slides Preview' output for details.",
        "Show log"
      ).then((pick) => { if (pick) output.show(true); });
    } else {
      log(`[gui] window closed (code ${code ?? 0})`);
    }
  });
}

// ---------------------------------------------------------------------------
// Live-reload server (tiny, dependency-free)
// ---------------------------------------------------------------------------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
};

// Live reload + slide-position cache: before refreshing, the current Reveal.js
// state (slide index, fragment) is stashed in sessionStorage and restored after
// reload — so iterating on slide 7 keeps you on slide 7, like Manim Sideview
// keeps its playhead.
const RELOAD_SNIPPET = `\n<script>/* manim-slides-preview live reload + position cache */\n(function(){try{\nvar KEY='msp-state-'+location.pathname;\nvar saved=sessionStorage.getItem(KEY);\nif(saved){sessionStorage.removeItem(KEY);var st=JSON.parse(saved);\n  var n=0,t=setInterval(function(){n++;\n    if(window.Reveal&&Reveal.isReady&&Reveal.isReady()){clearInterval(t);try{Reveal.setState(st);}catch(_){}}\n    else if(n>100){clearInterval(t);}\n  },50);}\nvar es=new EventSource('/__events');\nes.onmessage=function(e){\n  if(e.data==='reload'){\n    try{if(window.Reveal&&Reveal.getState)sessionStorage.setItem(KEY,JSON.stringify(Reveal.getState()));}catch(_){}\n    location.reload();\n  }\n};\n}catch(_){}})();\n</script>\n`;

function serveDirs() {
  // Serve union of every registered preview dir; first match wins.
  const dirs = new Set();
  for (const st of fileState.values()) if (st.previewDir) dirs.add(st.previewDir);
  return [...dirs];
}

function startServer(preferredPort) {
  return new Promise((resolve) => {
    if (server) return resolve(serverPort);
    server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);

      if (urlPath === "/__events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write("retry: 500\n\n");
        sseClients.add(res);
        req.on("close", () => sseClients.delete(res));
        return;
      }

      // Path traversal guard + lookup across registered dirs
      const rel = path.normalize(urlPath).replace(/^([/\\])+/, "");
      if (rel.includes("..")) { res.writeHead(403); return res.end(); }

      let filePath = null;
      for (const dir of serveDirs()) {
        const candidate = path.join(dir, rel);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          filePath = candidate;
          break;
        }
      }
      if (!filePath) { res.writeHead(404); return res.end("Not found"); }

      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME[ext] || "application/octet-stream";

      if (ext === ".html") {
        // Inject live-reload script (read fully; html files are small)
        let html = fs.readFileSync(filePath, "utf8");
        html = html.includes("</body>")
          ? html.replace("</body>", RELOAD_SNIPPET + "</body>")
          : html + RELOAD_SNIPPET;
        res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-cache" });
        return res.end(html);
      }

      // Stream everything else, honoring Range for video scrubbing.
      const stat = fs.statSync(filePath);
      const range = req.headers.range;
      if (range && ext === ".mp4") {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        let start = m && m[1] ? parseInt(m[1], 10) : 0;
        let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
        if (start >= stat.size) { res.writeHead(416); return res.end(); }
        res.writeHead(206, {
          "Content-Type": mime,
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": end - start + 1,
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Type": mime,
          "Content-Length": stat.size,
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-cache",
        });
        fs.createReadStream(filePath).pipe(res);
      }
    });

    const tryListen = (port, attempts) => {
      server.once("error", (err) => {
        if (err.code === "EADDRINUSE" && attempts > 0) tryListen(port + 1, attempts - 1);
        else { log(`Server error: ${err.message}`); server = null; resolve(0); }
      });
      server.listen(port, "127.0.0.1", () => {
        serverPort = port;
        log(`Preview server listening on http://127.0.0.1:${port}`);
        resolve(port);
      });
    };
    tryListen(preferredPort, 20);
  });
}

function notifyReload() {
  for (const client of sseClients) {
    try { client.write("data: reload\n\n"); } catch (_) { /* ignore */ }
  }
}

function stopServer() {
  if (server) {
    for (const c of sseClients) { try { c.end(); } catch (_) {} }
    sseClients.clear();
    server.close();
    server = null;
    serverPort = 0;
    log("Preview server stopped.");
  }
}

// ---------------------------------------------------------------------------
// Pipeline: render -> convert -> (serve + open/refresh)
// ---------------------------------------------------------------------------
async function pickScenes(filePath, forcePick) {
  const source = fs.readFileSync(filePath, "utf8");
  const { slideClasses, sceneClasses } = detectScenes(source);
  const all = slideClasses.length ? slideClasses : sceneClasses;

  if (!all.length) {
    vscode.window.showErrorMessage(
      "Manim Slides Preview: no Slide/Scene classes found in this file. " +
      "Make sure your class inherits from manim_slides.Slide."
    );
    return null;
  }
  if (!slideClasses.length) {
    vscode.window.showWarningMessage(
      "No Slide subclasses found — falling back to Scene classes. " +
      "Interactive pauses need 'from manim_slides import Slide'."
    );
  }

  const saved = fileState.get(filePath);
  if (!forcePick) {
    if (saved && saved.scenes && saved.scenes.every((s) => all.includes(s))) {
      return saved.scenes;
    }
    if (all.length === 1) return [all[0]];
  }

  const picks = await vscode.window.showQuickPick(
    all.map((name) => ({
      label: name,
      picked: saved ? saved.scenes.includes(name) : all.length === 1,
    })),
    { canPickMany: true, title: "Select scene(s) to render & preview" }
  );
  if (!picks || !picks.length) return null;
  return picks.map((p) => p.label);
}

async function pipeline(filePath, opts = {}) {
  if (running) {
    if (queued !== filePath) log("[queue] render already in progress — this save will run right after it");
    queued = filePath;
    return;
  }
  running = true;

  try {
    const conf = cfg();

    // Validate configured ffmpeg once per run so a typo'd path fails loudly.
    const ffPath = (conf.get("ffmpegPath") || "").trim();
    if (ffPath && !fs.existsSync(ffPath)) {
      vscode.window.showErrorMessage(
        `Manim Slides Preview: ffmpegPath does not exist: ${ffPath} — ` +
        "fix it in Settings (manimSlidesPreview.ffmpegPath) or clear it to use PATH."
      );
      return;
    }

    const scenes = await pickScenes(filePath, !!opts.forcePick);
    if (!scenes) return;

    const fileDir = path.dirname(filePath);
    const wsFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
    const rootDir = wsFolder ? wsFolder.uri.fsPath : fileDir;
    const previewDir = path.join(rootDir, OUT_DIR_NAME);
    fs.mkdirSync(previewDir, { recursive: true });
    openLogStream(previewDir); // everything below is also recorded in msp.log

    const base = path.basename(filePath, ".py");
    const htmlName = `${base}.html`;
    const htmlPath = path.join(previewDir, htmlName);

    // Hidden pycache-style store: partial movie files, Text/Tex caches and all
    // intermediate media live here instead of cluttering the project root.
    const cacheMediaDir = path.join(previewDir, CACHE_DIR_NAME, "media");
    fs.mkdirSync(cacheMediaDir, { recursive: true });

    const msCmd = splitCmd(conf.get("command") || "manim-slides");
    const useDaemon = conf.get("useDaemon") !== false;

    // Runner: persistent daemon when available (skips interpreter+import cost
    // on every save), transparent fallback to a normal subprocess.
    const exec = async (args, label, extra) => {
      if (useDaemon) {
        const rc = await daemonRun(fileDir, args, label, extra);
        if (rc !== null) return rc;
        log(`[${label}] daemon unavailable — falling back to subprocess`);
      }
      return run([...msCmd, ...args], fileDir, label);
    };

    // ---- 1) RENDER --------------------------------------------------------
    // Manim's built-in partial-movie cache is active by default: unchanged
    // animations are hash-matched and reused, so only edited animations are
    // re-rendered (same mechanism Manim Sideview benefits from).
    const useCache = conf.get("cache") !== false;
    // Turbo preview: lower res/fps + skip reversed-video generation.
    // Final quality is untouched — flip the setting (or use -qh) when needed.
    const turbo = conf.get("turboPreview") === true;
    // Source-level skip: if the scene file (and its .py siblings) plus every
    // render-relevant setting are bit-identical to the last SUCCESSFUL render,
    // don't invoke manim at all. This is the only reliable no-op-save guard:
    // manim cannot cache updater/ValueTracker animations (time-dependent
    // hashing is disabled), so without this a no-op Ctrl+S on a heavy deck
    // still re-renders those animations every time (measured: 34 s).
    const prevSt = fileState.get(filePath) || {};
    const srcKey = useCache ? sourceKey(filePath, scenes, conf) : null;
    const slidesExist = () => scenes.every((sc) => fs.existsSync(path.join(fileDir, "slides", `${sc}.json`)));
    const skipRender = !!(srcKey && prevSt.srcKey === srcKey && slidesExist());
    if (!skipRender) {
      setStatus(`Rendering ${scenes.join(", ")}…`, filePath, true);
      // Always show progress in the Output panel (not just the status bar):
      // preserveFocus=true keeps the cursor in the editor.
      output.show(true);
    }
    log(`\n▶ ${path.basename(filePath)} — scenes: ${scenes.join(", ")}${skipRender ? " — no changes since last render (render skipped)" : ""}`);
    let rc = 0, cacheStats;
    if (skipRender) {
      // Source-level skip: manim is not invoked at all. This is the only
      // reliable no-op-save guard — manim cannot hash-cache updater/
      // ValueTracker animations, so without this a no-op Ctrl+S on a heavy
      // deck still re-renders them every time (measured: 34 s of pure waste).
      setStatus("Up to date ✓", "Source unchanged since last render", false);
    } else {
    const renderArgs = [
      "render", filePath, ...scenes,
      conf.get("quality") || "-ql",
      "--media_dir", cacheMediaDir, // partial caches live in .manim-slides-preview/cache/
      ...(turbo ? ["-r", "640,360", "--fps", "15"] : []),
      ...(useCache ? [] : ["--disable_caching"]),
      ...(conf.get("extraRenderArgs") || []),
    ];
    // Progress tracker: one clean line per animation (⚡ cached / 🎬 rendered)
    const fileKey = `${filePath}::${scenes.join(",")}`;
    activeTracker = new RenderTracker(fileKey, animTotals.get(fileKey));
    // Independent success check: manim's in-process CLI can misreport rc after
    // an earlier failure, so we verify the slide configs were actually (re)written.
    const renderStart = Date.now();
    const slidesFresh = () => scenes.every((s) => {
      try {
        const st = fs.statSync(path.join(fileDir, "slides", `${s}.json`));
        return st.mtimeMs >= renderStart - 2000;
      } catch (_) { return false; }
    });

    try {
      rc = await exec(renderArgs, "render", {
        skip_reversing: turbo,
        x264_preset: turbo ? "ultrafast" : (conf.get("x264Preset") || null),
      });
      if (rc === 0 && useDaemon && !slidesFresh()) {
        // False success from a polluted daemon: restart it and re-run clean.
        log("[render] output missing/stale despite rc=0 — restarting daemon and retrying");
        killDaemon(fileDir);
        rc = await exec(renderArgs, "render", {
          skip_reversing: turbo,
          x264_preset: turbo ? "ultrafast" : (conf.get("x264Preset") || null),
        });
        if (rc === 0 && !slidesFresh()) rc = 1;
      }
      if (rc !== 0 && useDaemon) killDaemon(fileDir); // never reuse a failed interpreter
    } finally {
      cacheStats = activeTracker.finish();
      const failedRaw = activeTracker.raw;
      activeTracker = null;
      if (rc !== 0 && failedRaw) {
        log("\n──── full render output (failed) ────");
        output.append(failedRaw.replace(ANSI_RE, ""));
        log("─────────────────────────────────────");
      }
    }
    } // end if (!skipRender)
    if (rc !== 0) {
      setStatus("Render failed", "Click to open log");
      statusBar.command = "manimSlidesPreview.showOutput";
      output.show(true);
      const lp = logStreamPath ? ` Full log saved to ${logStreamPath}` : "";
      vscode.window.showErrorMessage(
        "manim-slides render failed — see the 'Manim Slides Preview' output log." + lp
      );
      return;
    }

    // ---- 2) CONVERT to interactive HTML (skipped when nothing changed) ----
    const prevState = fileState.get(filePath) || {};
    const cacheKey = useCache ? convertCacheKey(fileDir, scenes, conf) : null;
    const canSkipConvert =
      cacheKey && prevState.convertKey === cacheKey && fs.existsSync(htmlPath);

    const openIn = String(conf.get("openIn") || "browser");
    const wants = (t) => openIn === "all" || openIn.split("+").includes(t);
    // GUI-only mode: the HTML convert + server stage is pure overhead, so it
    // is skipped entirely. The HTML is built lazily if the user later invokes
    // 'Open in Browser' (see the forceHtml path) — no capability is lost.
    const htmlWanted = openIn !== "gui" || !!opts.forceHtml;
    // Did the slide configuration actually change? (independent of the HTML
    // cache, so the GUI relaunch decision works even when convert is skipped)
    const slidesChanged = !(cacheKey && prevState.guiKey === cacheKey);

    if (!htmlWanted) {
      log("\n[convert] skipped — GUI-only preview (openIn: \"gui\")");
    } else if (canSkipConvert) {
      log("\n[convert] skipped — slide configuration unchanged (cache hit)");
    } else {
      setStatus("Converting to HTML…", filePath, true);
      const convertArgs = ["convert", "--to", "html"];
      if (conf.get("offline")) convertArgs.push("--offline");
      if (conf.get("oneFile")) convertArgs.push("--one-file");
      if (conf.get("htmlControls")) convertArgs.push("-ccontrols=true");
      convertArgs.push(...(conf.get("extraConvertArgs") || []), ...scenes, htmlPath);

      const cc = await exec(convertArgs, "convert");
      if (cc === 0) pruneStaleAssets(htmlPath);
      if (cc !== 0) {
        setStatus("Convert failed", "Click to open log");
        output.show(true);
        vscode.window.showErrorMessage(
          "manim-slides convert failed — if '--offline' is unsupported, update manim-slides " +
          "(pip install -U manim-slides) or disable manimSlidesPreview.offline."
        );
        return;
      }
    }

    // ---- 3) SERVE + OPEN / REFRESH ----------------------------------------
    const st = fileState.get(filePath) || {};
    st.scenes = scenes;
    st.previewDir = previewDir;
    st.htmlName = htmlName;
    st.fileDir = fileDir;
    st.srcKey = srcKey; // render stage succeeded for exactly this source state
    const freshKey = cacheKey || convertCacheKey(fileDir, scenes, conf);
    if (htmlWanted) st.convertKey = freshKey;
    st.guiKey = freshKey;
    fileState.set(filePath, st);

    let url = null;
    if (htmlWanted) {
      const port = await startServer(conf.get("port") || 7801);
      if (!port) return;
      url = `http://127.0.0.1:${port}/${encodeURIComponent(htmlName)}`;

      if (opts.forceHtml) {
        // Explicit 'Open in Browser' from GUI-only mode: always open a tab.
        st.previewed = true;
        vscode.env.openExternal(vscode.Uri.parse(url));
      } else if (!st.previewed) {
        st.previewed = true;
        if (wants("vscode")) {
          try {
            await vscode.commands.executeCommand("simpleBrowser.api.open", vscode.Uri.parse(url), {
              viewColumn: vscode.ViewColumn.Beside,
              preserveFocus: true,
            });
          } catch (_) {
            await vscode.commands.executeCommand("simpleBrowser.show", url);
          }
        }
        if (wants("browser")) {
          vscode.env.openExternal(vscode.Uri.parse(url));
        }
      } else if (canSkipConvert) {
        log("[reload] skipped — output identical, browser left untouched");
      } else {
        notifyReload();
      }
    }

    // Native Python GUI window (PySide6): launch on first run, relaunch with
    // fresh slides after a real change (an unchanged save leaves it running).
    if (wants("gui") && (!st.guiLaunched || slidesChanged)) {
      launchGui(filePath, fileDir, scenes, conf);
      st.guiLaunched = true;
    }

    // Background .pptx export — fire-and-forget AFTER every preview target is
    // already live, so the edit→preview loop pays zero extra latency.
    if (conf.get("pptxExport")) {
      exportPptx(filePath, fileDir, scenes, conf, st, false);
    }

    if (url) {
      setStatus(`Preview ready :${serverPort}`, `${url}\nClick to open in browser`);
      statusBar.command = "manimSlidesPreview.openInBrowser";
      log(`\nInteractive preview: ${url}`);
    } else {
      setStatus("GUI preview ready", "Presenting in the native GUI window\nClick to open in browser too");
      statusBar.command = "manimSlidesPreview.openInBrowser";
      log("\nPresenting in native GUI window (manim-slides present)");
    }
  } finally {
    running = false;
    if (queued) {
      const next = queued;
      queued = null;
      pipeline(next);
    }
  }
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------
function activate(context) {
  output = vscode.window.createOutputChannel("Manim Slides Preview");
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 5);
  statusBar.command = "manimSlidesPreview.renderAndPreview";
  setStatus("Manim Slides", "Render & preview the current file");

  const activePyFile = () => {
    const ed = vscode.window.activeTextEditor;
    if (!ed || ed.document.languageId !== "python") {
      vscode.window.showWarningMessage("Open a Python file containing your Slide scene first.");
      return null;
    }
    return ed.document;
  };

  context.subscriptions.push(
    output,
    statusBar,

    vscode.commands.registerCommand("manimSlidesPreview.renderAndPreview", async () => {
      const doc = activePyFile();
      if (!doc) return;
      if (doc.isDirty) await doc.save();
      return pipeline(doc.uri.fsPath);
    }),

    vscode.commands.registerCommand("manimSlidesPreview.selectScene", async () => {
      const doc = activePyFile();
      if (!doc) return;
      if (doc.isDirty) await doc.save();
      return pipeline(doc.uri.fsPath, { forcePick: true });
    }),

    vscode.commands.registerCommand("manimSlidesPreview.openInBrowser", () => {
      for (const [file, st] of fileState) {
        if (st.previewed && serverPort) {
          const url = `http://127.0.0.1:${serverPort}/${encodeURIComponent(st.htmlName)}`;
          vscode.env.openExternal(vscode.Uri.parse(url));
          return;
        }
        if (st.scenes) {
          // GUI-only mode never built the HTML — build + serve it on demand.
          pipeline(file, { forceHtml: true });
          return;
        }
      }
      vscode.window.showInformationMessage("Nothing previewed yet — run 'Manim Slides: Render & Preview' first.");
    }),

    vscode.commands.registerCommand("manimSlidesPreview.presentGui", async () => {
      const doc = activePyFile();
      if (!doc) return;
      const scenes = await pickScenes(doc.uri.fsPath, false);
      if (!scenes) return;
      launchGui(doc.uri.fsPath, path.dirname(doc.uri.fsPath), scenes, cfg());
      const st = fileState.get(doc.uri.fsPath);
      if (st) st.guiLaunched = true;
    }),

    vscode.commands.registerCommand("manimSlidesPreview.exportPptx", async () => {
      const doc = activePyFile();
      if (!doc) return;
      const filePath = doc.uri.fsPath;
      const st = fileState.get(filePath);
      const scenes = (st && st.scenes) || (await pickScenes(filePath, false));
      if (!scenes) return;
      const fileDir = path.dirname(filePath);
      if (!fs.existsSync(path.join(fileDir, "slides", `${scenes[0]}.json`))) {
        vscode.window.showWarningMessage("No rendered slides yet — run 'Manim Slides: Render & Preview' first.");
        return;
      }
      exportPptx(filePath, fileDir, scenes, cfg(), st || {}, true); // force even if unchanged
    }),

    vscode.commands.registerCommand("manimSlidesPreview.clearCache", async () => {
      const doc = activePyFile();
      if (!doc) return;
      const fileDir = path.dirname(doc.uri.fsPath);
      const wsFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
      const rootDir = wsFolder ? wsFolder.uri.fsPath : fileDir;
      const targets = [
        path.join(rootDir, OUT_DIR_NAME, CACHE_DIR_NAME), // hidden partial-movie/Tex cache
        path.join(fileDir, "media", "videos"),   // legacy location (pre-1.2 renders)
        path.join(fileDir, "slides"),            // slide configs + concatenated files
      ];
      let removed = 0;
      for (const t of targets) {
        if (fs.existsSync(t)) {
          try { fs.rmSync(t, { recursive: true, force: true }); removed++; }
          catch (e) { log(`clearCache: could not remove ${t}: ${e.message}`); }
        }
      }
      for (const st of fileState.values()) { delete st.convertKey; delete st.srcKey; } // bust all skip caches
      log(`clearCache: removed ${removed} cache director${removed === 1 ? "y" : "ies"}.`);
      vscode.window.showInformationMessage(
        `Manim Slides: cache cleared (${removed} folder${removed === 1 ? "" : "s"}). ` +
        "Next run will fully re-render."
      );
    }),

    vscode.commands.registerCommand("manimSlidesPreview.showOutput", () => output.show(true)),
    vscode.commands.registerCommand("manimSlidesPreview.stopServer", () => {
      stopServer();
      setStatus("Manim Slides", "Render & preview the current file");
      statusBar.command = "manimSlidesPreview.renderAndPreview";
    }),

    // Ctrl+S -> full auto pipeline (only for files previewed at least once)
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (!cfg().get("renderOnSave")) return;
      if (doc.languageId !== "python") return;
      if (fileState.has(doc.uri.fsPath)) pipeline(doc.uri.fsPath, { fromSave: true });
    })
  );
}

function deactivate() {
  try { if (logStream) { logStream.end(); logStream = null; } } catch (_) {}
  stopServer();
  stopDaemons();
  stopAllGuis();
  if (currentChild) { try { currentChild.kill(); } catch (_) {} }
}

module.exports = { activate, deactivate };
// test-harness hook (not part of the public API): lets the scripted VS Code
// harness await pipeline completion instead of racing it.
module.exports._busy = () => running || !!queued;
