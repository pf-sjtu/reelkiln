/**
 * DiagramReel — a bespoke, full-frame animated system-design explainer.
 *
 * Renders the "Queues vs Streams vs Event Bus" educational reel: seven scenes of
 * animated diagrams (a queue with a worker consuming messages, an append-only
 * stream log with per-reader offsets + replay, an event bus fanning one fact out
 * to many services, a decision checklist, and a combined-architecture payoff),
 * each time-anchored to the narrator VO's word timings.
 *
 * SILENT by design — no <Audio>. Render standalone to visuals.mp4, mux the VO
 * on, then run through compose_render for captions. Timings (in seconds) are
 * locked to jobs/edu_queues_streams_bus-20260705/transcript.json.
 */
import React from "react";
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { z } from "zod";

const inter = loadInter("normal", { weights: ["400", "600", "700", "800"], subsets: ["latin"] });
const mono = loadMono("normal", { weights: ["500", "700"], subsets: ["latin"] });
const SANS = inter.fontFamily;
const MONO = mono.fontFamily;

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const C = {
  bg0: "#080B15",
  bg1: "#0E1730",
  ink: "#EEF2FF",
  mut: "#8A97C0",
  dim: "#48557E",
  line: "#232E4E",
  card: "#0F182E",
  cardBd: "#2A365A",
  queue: "#34D399",
  stream: "#FBBF24",
  bus: "#A78BFA",
  danger: "#F87171",
};

// ---------------------------------------------------------------------------
// Timeline — absolute seconds, locked to the transcript. Also the render-side
// truth for scene boundaries; keep in sync with props.durationSeconds.
// ---------------------------------------------------------------------------
const T = {
  hook: { s: 0.0, e: 12.52, crack: 8.9 },
  model: { s: 12.52, e: 17.74, readers: 14.66, routes: 16.56 },
  queue: { s: 17.74, e: 27.28, grab: 20.94, addw: 25.6 },
  stream: { s: 27.28, e: 38.62, replay: 34.44, addr: 37.54 },
  bus: { s: 38.62, e: 55.42, fan: 42.36, cmd: 46.4, fact: 50.0 },
  decision: { s: 55.42, e: 68.84, q: 59.46, st: 63.86, b: 67.56 },
  payoff: { s: 68.84, e: 78.8, all3: 70.72, cta: 76.4 },
};

// ---------------------------------------------------------------------------
// Small motion helpers (pure fns, not hooks)
// ---------------------------------------------------------------------------
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** scene fade envelope */
const env = (f: number, durF: number, inF = 11, outF = 12) =>
  Math.max(
    0,
    Math.min(
      interpolate(f, [0, inF], [0, 1], clamp),
      interpolate(f, [durF - outF, durF], [1, 0], clamp),
    ),
  );

const pop = (
  f: number,
  fps: number,
  delayF = 0,
  cfg = { damping: 15, stiffness: 130, mass: 0.8 },
) => spring({ frame: f - delayF, fps, config: cfg });

// ---------------------------------------------------------------------------
// Background — gradient + dot grid + vignette, very subtle drift
// ---------------------------------------------------------------------------
const Bg: React.FC<{ progress: number }> = ({ progress }) => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 90) * 8;
  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          background: `radial-gradient(120% 80% at 50% ${18 + drift}%, ${C.bg1} 0%, ${C.bg0} 62%)`,
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(${C.line} 1.3px, transparent 1.4px)`,
          backgroundSize: "44px 44px",
          opacity: 0.35,
          maskImage: "radial-gradient(120% 90% at 50% 40%, #000 30%, transparent 78%)",
          WebkitMaskImage: "radial-gradient(120% 90% at 50% 40%, #000 30%, transparent 78%)",
        }}
      />
      <AbsoluteFill
        style={{ boxShadow: "inset 0 0 320px 80px rgba(0,0,0,0.55)" }}
      />
      {/* thin overall progress bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          height: 6,
          width: `${progress * 100}%`,
          background: `linear-gradient(90deg, ${C.queue}, ${C.stream}, ${C.bus})`,
          opacity: 0.9,
        }}
      />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Shared chrome + atoms
// ---------------------------------------------------------------------------
const Kicker: React.FC<{ text: string; color: string; f: number; fps: number }> = ({
  text,
  color,
  f,
  fps,
}) => {
  const p = pop(f, fps, 0);
  return (
    <div
      style={{
        position: "absolute",
        top: 250,
        left: 0,
        right: 0,
        textAlign: "center",
        opacity: p,
        transform: `translateY(${(1 - p) * -18}px)`,
      }}
    >
      <span
        style={{
          fontFamily: MONO,
          fontWeight: 700,
          fontSize: 34,
          letterSpacing: "0.32em",
          color,
          textShadow: `0 0 26px ${color}66`,
        }}
      >
        {text}
      </span>
    </div>
  );
};

const SubTitle: React.FC<{ text: string; f: number; delayF: number; fps: number }> = ({
  text,
  f,
  delayF,
  fps,
}) => {
  const p = pop(f, fps, delayF);
  return (
    <div
      style={{
        position: "absolute",
        top: 312,
        left: 0,
        right: 0,
        textAlign: "center",
        opacity: p,
        transform: `translateY(${(1 - p) * 12}px)`,
      }}
    >
      <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: 72, color: C.ink, letterSpacing: "-0.02em" }}>
        {text}
      </span>
    </div>
  );
};

const Pill: React.FC<{
  label: string;
  color?: string;
  bg?: string;
  x: number;
  y: number;
  w?: number;
  scale?: number;
  opacity?: number;
  mono?: boolean;
  fontSize?: number;
}> = ({ label, color = C.ink, bg = C.card, x, y, w, scale = 1, opacity = 1, mono, fontSize = 30 }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      transform: `translate(-50%,-50%) scale(${scale})`,
      width: w,
      padding: w ? "18px 0" : "16px 26px",
      textAlign: "center",
      borderRadius: 16,
      background: bg,
      border: `2px solid ${color}`,
      color,
      fontFamily: mono ? MONO : SANS,
      fontWeight: 700,
      fontSize,
      letterSpacing: mono ? "0.02em" : "-0.01em",
      opacity,
      boxShadow: `0 0 24px ${color}22`,
      whiteSpace: "nowrap",
    }}
  >
    {label}
  </div>
);

const Tag: React.FC<{ text: string; f: number; delayF: number; fps: number; color?: string }> = ({
  text,
  f,
  delayF,
  fps,
  color = C.mut,
}) => {
  const p = pop(f, fps, delayF);
  return (
    <div
      style={{
        position: "absolute",
        top: 1300,
        left: 0,
        right: 0,
        textAlign: "center",
        opacity: p,
        transform: `translateY(${(1 - p) * 14}px)`,
      }}
    >
      <span
        style={{
          fontFamily: MONO,
          fontWeight: 500,
          fontSize: 33,
          color,
          background: "rgba(10,14,25,0.6)",
          padding: "10px 22px",
          borderRadius: 12,
          border: `1px solid ${C.line}`,
        }}
      >
        {text}
      </span>
    </div>
  );
};

// ===========================================================================
// SCENE 1 — HOOK
// ===========================================================================
const SceneHook: React.FC<{ durF: number }> = ({ durF }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = env(f, durF);
  const crackF = (T.hook.crack - T.hook.s) * fps;
  const cracking = f > crackF;
  const shake = cracking ? Math.sin(f * 1.4) * interpolate(f, [crackF, crackF + 40], [10, 0], clamp) : 0;

  const rows = [
    { name: "QUEUE", color: C.queue },
    { name: "STREAM", color: C.stream },
    { name: "EVENT BUS", color: C.bus },
  ];
  return (
    <AbsoluteFill style={{ opacity: e }}>
      <Kicker text="SYSTEM DESIGN" color={C.mut} f={f} fps={fps} />
      <div style={{ position: "absolute", top: 320, left: 60, right: 60, textAlign: "center" }}>
        <span style={{ fontFamily: SANS, fontWeight: 800, fontSize: 78, color: C.ink, letterSpacing: "-0.025em", lineHeight: 1.05 }}>
          Three tools.
          <br />
          One whiteboard.
        </span>
      </div>

      {/* three near-identical schematic strips */}
      {rows.map((r, i) => {
        const delay = 14 + i * 10;
        const p = pop(f, fps, delay);
        const y = 620 + i * 210;
        const isBad = cracking && i === 2;
        const col = isBad ? C.danger : C.dim;
        return (
          <div
            key={r.name}
            style={{
              position: "absolute",
              top: y,
              left: 120,
              right: 120,
              height: 150,
              opacity: p * (isBad ? 1 : 0.92),
              transform: `translateX(${(1 - p) * 40}px) translateX(${isBad ? shake : 0}px)`,
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                border: `2px solid ${isBad ? C.danger : C.line}`,
                borderRadius: 20,
                background: isBad ? "rgba(248,113,113,0.08)" : "rgba(20,28,50,0.5)",
                display: "flex",
                alignItems: "center",
                gap: 26,
                padding: "0 34px",
              }}
            >
              <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 30, color: r.color, width: 240 }}>
                {r.name}
              </span>
              {/* in -> box -> out schematic */}
              <div style={{ width: 46, height: 46, borderRadius: 10, background: col }} />
              <div style={{ flex: 1, height: 3, background: col }} />
              <div style={{ width: 90, height: 66, borderRadius: 12, border: `3px solid ${col}` }} />
              <div style={{ flex: 1, height: 3, background: col }} />
              <div style={{ width: 46, height: 46, borderRadius: 10, background: col }} />
              {isBad && (
                <span style={{ position: "absolute", right: 30, fontFamily: SANS, fontWeight: 800, fontSize: 60, color: C.danger }}>
                  ✕
                </span>
              )}
            </div>
          </div>
        );
      })}

      {cracking && (
        <div style={{ position: "absolute", top: 1300, left: 0, right: 0, textAlign: "center", opacity: interpolate(f, [crackF, crackF + 18], [0, 1], clamp) }}>
          <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: 40, color: C.danger }}>
            pick wrong → it quietly breaks
          </span>
        </div>
      )}
    </AbsoluteFill>
  );
};

// ===========================================================================
// SCENE 2 — MENTAL MODEL (the thesis)
// ===========================================================================
const ModelLine: React.FC<{
  a: string;
  b: string;
  color: string;
  f: number;
  delayF: number;
  fps: number;
}> = ({ a, b, color, f, delayF, fps }) => {
  const p = pop(f, fps, delayF, { damping: 13, stiffness: 120, mass: 0.7 });
  return (
    <div style={{ opacity: p, transform: `translateY(${(1 - p) * 26}px)`, marginBottom: 46 }}>
      <span style={{ fontFamily: SANS, fontWeight: 800, fontSize: 82, color: C.ink, letterSpacing: "-0.02em" }}>
        {a}{" "}
      </span>
      <span style={{ fontFamily: SANS, fontWeight: 800, fontSize: 82, color, letterSpacing: "-0.02em", textShadow: `0 0 34px ${color}55` }}>
        {b}
      </span>
    </div>
  );
};

const SceneModel: React.FC<{ durF: number }> = ({ durF }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = env(f, durF);
  const rd = (T.model.readers - T.model.s) * fps;
  const rt = (T.model.routes - T.model.s) * fps;
  return (
    <AbsoluteFill style={{ opacity: e, justifyContent: "center", alignItems: "flex-start", paddingLeft: 110, paddingRight: 90, paddingBottom: 220 }}>
      <div>
        <ModelLine a="Queues scale" b="workers." color={C.queue} f={f} delayF={4} fps={fps} />
        <ModelLine a="Streams scale" b="readers." color={C.stream} f={f} delayF={rd} fps={fps} />
        <ModelLine a="Event buses scale" b="routes." color={C.bus} f={f} delayF={rt} fps={fps} />
      </div>
    </AbsoluteFill>
  );
};

// ===========================================================================
// SCENE 3 — QUEUE
// ===========================================================================
const Worker: React.FC<{ x: number; y: number; scale: number; active?: boolean }> = ({ x, y, scale, active }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      transform: `translate(-50%,-50%) scale(${scale})`,
      width: 150,
      height: 150,
      borderRadius: 24,
      background: C.card,
      border: `3px solid ${C.queue}`,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: active ? `0 0 40px ${C.queue}66` : `0 0 18px ${C.queue}22`,
    }}
  >
    <div style={{ width: 48, height: 48, borderRadius: "50%", background: C.queue }} />
    <div style={{ width: 78, height: 34, borderRadius: "40px 40px 0 0", background: C.queue, marginTop: 8 }} />
  </div>
);

const SceneQueue: React.FC<{ durF: number }> = ({ durF }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = env(f, durF);
  const grabF = (T.queue.grab - T.queue.s) * fps; // ~96
  const addF = (T.queue.addw - T.queue.s) * fps; // ~236

  const laneY = 770;
  const laneL = 320;
  const laneR = 1010;
  const N = 7;
  const spacing = 96;
  const frontX = 946;

  // consume schedule: one worker consumes slowly, then 3 workers drain fast.
  const times: number[] = [];
  let tAcc = grabF;
  for (let i = 0; i < N; i++) {
    times.push(tAcc);
    tAcc += tAcc < addF ? 46 : 15;
  }
  const consumedCount = times.filter((tt) => tt <= f).length;
  const workersOn = f > addF;
  const workerYs = [laneY - 220, laneY, laneY + 220];

  return (
    <AbsoluteFill style={{ opacity: e }}>
      <Kicker text="QUEUE" color={C.queue} f={f} fps={fps} />
      <SubTitle text="work waiting to be done" f={f} delayF={6} fps={fps} />

      {/* the lane */}
      <div
        style={{
          position: "absolute",
          left: laneL,
          top: laneY - 62,
          width: laneR - laneL,
          height: 124,
          borderRadius: 62,
          background: "rgba(52,211,153,0.06)",
          border: `2px dashed ${C.queue}55`,
        }}
      />

      {/* worker(s) on the left */}
      <Worker x={200} y={laneY} scale={pop(f, fps, 8)} active={consumedCount > 0 && consumedCount < N} />
      {workersOn && <Worker x={200} y={laneY - 220} scale={pop(f, fps, addF + 4)} active />}
      {workersOn && <Worker x={200} y={laneY + 220} scale={pop(f, fps, addF + 10)} active />}

      {/* tickets */}
      {Array.from({ length: N }).map((_, i) => {
        const consumed = times[i] <= f;
        const slot = i - consumedCount; // 0 = front of remaining queue
        const restX = frontX - Math.max(slot, 0) * spacing;
        const enterP = pop(f, fps, 10 + i * 7);
        let x = restX;
        let opacity = Math.min(enterP, 1);
        let scale = 0.62 + 0.38 * enterP;
        let top = laneY;
        let showCheck = false;
        if (consumed) {
          const cAt = times[i];
          const tt = interpolate(f, [cAt, cAt + 15], [0, 1], clamp);
          const ty = workersOn ? workerYs[i % 3] : laneY;
          x = interpolate(tt, [0, 1], [restX, 205]);
          top = interpolate(tt, [0, 1], [laneY, ty]);
          opacity = 1 - tt;
          scale = 1 - 0.4 * tt;
          showCheck = tt > 0.3 && tt < 0.95;
        } else if (restX < laneL) {
          // waiting ticket overflowing the lane's left edge — fade it
          opacity *= interpolate(restX, [laneL - 70, laneL], [0, 1], clamp);
        }
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top,
              transform: `translate(-50%,-50%) scale(${scale})`,
              width: 100,
              height: 100,
              borderRadius: 18,
              background: C.card,
              border: `3px solid ${C.queue}`,
              opacity,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: MONO,
              fontWeight: 700,
              fontSize: 26,
              color: C.queue,
              boxShadow: `0 0 20px ${C.queue}33`,
            }}
          >
            job
            {showCheck && (
              <span style={{ position: "absolute", top: -34, fontSize: 44, color: C.queue }}>✓</span>
            )}
          </div>
        );
      })}

      <Tag
        text={workersOn ? "add workers → drain the backlog faster" : "one worker grabs it · then it's gone"}
        f={f}
        delayF={workersOn ? addF + 4 : grabF + 6}
        fps={fps}
        color={C.queue}
      />
    </AbsoluteFill>
  );
};

// ===========================================================================
// SCENE 4 — STREAM
// ===========================================================================
const SceneStream: React.FC<{ durF: number }> = ({ durF }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = env(f, durF);
  const replayF = (T.stream.replay - T.stream.s) * fps;
  const addrF = (T.stream.addr - T.stream.s) * fps;

  const cellW = 92;
  const cellGap = 12;
  const x0 = 150;
  const logY = 720;
  const total = 8;
  // cells append over time
  const shown = Math.min(total, Math.floor(interpolate(f, [10, 150], [1, total], clamp)));

  // three readers at different offsets
  const readers = [
    { name: "A", off: 1, color: "#60A5FA" },
    { name: "B", off: 3, color: "#F472B6" },
    { name: "C", off: 6, color: "#34D399" },
  ];
  const cellX = (i: number) => x0 + i * (cellW + cellGap);

  const newReaderP = f > replayF ? pop(f, fps, replayF) : 0;
  // replay cursor sweeps from its offset back to 0
  const dCursor = interpolate(f, [replayF + 6, replayF + 46], [6, 0], clamp);

  return (
    <AbsoluteFill style={{ opacity: e }}>
      <Kicker text="STREAM" color={C.stream} f={f} fps={fps} />
      <SubTitle text="a log of facts you keep" f={f} delayF={6} fps={fps} />

      {/* append-only log cells */}
      {Array.from({ length: total }).map((_, i) => {
        const on = i < shown;
        const p = on ? pop(f, fps, 12 + i * 9) : 0;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: cellX(i),
              top: logY,
              width: cellW,
              height: 118,
              transform: `scale(${p})`,
              transformOrigin: "left center",
              borderRadius: 12,
              background: C.card,
              border: `2px solid ${C.stream}`,
              opacity: p,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              boxShadow: `0 0 16px ${C.stream}22`,
            }}
          >
            <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 34, color: C.stream }}>{i}</span>
            <span style={{ fontFamily: MONO, fontSize: 17, color: C.mut, marginTop: 2 }}>evt</span>
          </div>
        );
      })}
      {/* append arrow */}
      <div style={{ position: "absolute", left: cellX(shown) + 4, top: logY + 40, opacity: interpolate(f, [16, 40], [0, 0.8], clamp) }}>
        <span style={{ fontFamily: SANS, fontSize: 44, color: C.stream }}>＋</span>
      </div>

      {/* existing reader cursors */}
      {readers.map((r, i) => {
        const p = pop(f, fps, 40 + i * 10);
        return (
          <div key={r.name} style={{ position: "absolute", left: cellX(r.off) + cellW / 2, top: logY + 150, transform: `translateX(-50%) scale(${p})`, opacity: p, textAlign: "center" }}>
            <div style={{ width: 0, height: 0, borderLeft: "16px solid transparent", borderRight: "16px solid transparent", borderBottom: `22px solid ${r.color}`, margin: "0 auto" }} />
            <div style={{ marginTop: 8, fontFamily: MONO, fontWeight: 700, fontSize: 30, color: r.color }}>{r.name}</div>
            <div style={{ fontFamily: MONO, fontSize: 20, color: C.mut }}>@{r.off}</div>
          </div>
        );
      })}

      {/* new reader D replays from 0 */}
      {newReaderP > 0 && (
        <div style={{ position: "absolute", left: cellX(dCursor) + cellW / 2, top: logY - 128, transform: "translateX(-50%)", opacity: newReaderP, textAlign: "center" }}>
          <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 30, color: "#FBBF24" }}>D ↺ replay</div>
          <div style={{ width: 0, height: 0, borderLeft: "16px solid transparent", borderRight: "16px solid transparent", borderTop: `22px solid ${C.stream}`, margin: "10px auto 0" }} />
        </div>
      )}

      <Tag
        text={f > addrF ? "add readers, not workers" : "nothing deleted · each reader owns its offset"}
        f={f}
        delayF={f > addrF ? addrF + 2 : 46}
        fps={fps}
        color={C.stream}
      />
    </AbsoluteFill>
  );
};

// ===========================================================================
// SCENE 5 — EVENT BUS
// ===========================================================================
const SceneBus: React.FC<{ durF: number }> = ({ durF }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = env(f, durF);
  const fanF = (T.bus.fan - T.bus.s) * fps;
  const cmdF = (T.bus.cmd - T.bus.s) * fps;
  const factF = (T.bus.fact - T.bus.s) * fps;

  const busY = 700;
  const busL = 150;
  const busR = 930;
  const services = [
    { name: "Email", x: 250 },
    { name: "Inventory", x: 450 },
    { name: "Analytics", x: 650 },
    { name: "Fraud", x: 850 },
  ];
  const svcY = 1010;

  // event enters from top, lands on bus by fanF, then is "routed" (fades)
  const evY = interpolate(f, [8, fanF], [430, busY - 70], clamp);
  const evP = pop(f, fps, 6) * interpolate(f, [fanF, fanF + 12], [1, 0], clamp);
  const contrast = f > cmdF;

  return (
    <AbsoluteFill style={{ opacity: e }}>
      <Kicker text="EVENT BUS" color={C.bus} f={f} fps={fps} />
      <SubTitle text="a router: who hears what" f={f} delayF={6} fps={fps} />

      {/* the incoming event */}
      <Pill label="OrderPlaced" color={C.bus} x={540} y={evY} scale={evP} mono fontSize={30} />

      {/* the bus bar */}
      <div
        style={{
          position: "absolute",
          left: busL,
          top: busY,
          width: busR - busL,
          height: 26,
          borderRadius: 13,
          background: `linear-gradient(90deg, ${C.bus}, #7C6CE0)`,
          boxShadow: `0 0 30px ${C.bus}55`,
          opacity: pop(f, fps, 4),
        }}
      />

      {/* fan-out lines + service nodes */}
      {services.map((s, i) => {
        const lit = interpolate(f, [fanF + i * 3, fanF + 14 + i * 3], [0, 1], clamp);
        const np = pop(f, fps, fanF + i * 3);
        return (
          <React.Fragment key={s.name}>
            <svg style={{ position: "absolute", left: 0, top: 0, width: 1080, height: 1920, pointerEvents: "none" }}>
              <line
                x1={s.x}
                y1={busY + 26}
                x2={s.x}
                y2={svcY - 46}
                stroke={C.bus}
                strokeWidth={4}
                strokeDasharray="10 10"
                strokeDashoffset={-f * 2}
                opacity={lit * 0.9}
              />
            </svg>
            <div
              style={{
                position: "absolute",
                left: s.x,
                top: svcY,
                transform: `translate(-50%,-50%) scale(${np})`,
                width: 190,
                height: 118,
                borderRadius: 18,
                background: C.card,
                border: `2.5px solid ${C.bus}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: MONO,
                fontWeight: 700,
                fontSize: 28,
                color: C.ink,
                opacity: np,
                boxShadow: lit > 0.5 ? `0 0 26px ${C.bus}44` : "none",
              }}
            >
              {s.name}
            </div>
          </React.Fragment>
        );
      })}

      {/* command-vs-fact contrast */}
      {contrast && (
        <div style={{ position: "absolute", top: 1230, left: 90, right: 90 }}>
          <div style={{ opacity: pop(f, fps, cmdF), transform: `translateX(${(1 - pop(f, fps, cmdF)) * -30}px)`, display: "flex", alignItems: "center", gap: 18, marginBottom: 20 }}>
            <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 30, color: C.queue, width: 200 }}>QUEUE</span>
            <span style={{ fontFamily: SANS, fontSize: 34, color: C.ink }}>
              a <b>command</b>: “charge this order”
            </span>
          </div>
          {f > factF && (
            <div style={{ opacity: pop(f, fps, factF), transform: `translateX(${(1 - pop(f, fps, factF)) * -30}px)`, display: "flex", alignItems: "center", gap: 18 }}>
              <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 30, color: C.bus, width: 200 }}>BUS</span>
              <span style={{ fontFamily: SANS, fontSize: 34, color: C.ink }}>
                a <b>fact</b>: “an order was placed”
              </span>
            </div>
          )}
        </div>
      )}
    </AbsoluteFill>
  );
};

// ===========================================================================
// SCENE 6 — DECISION
// ===========================================================================
const QRow: React.FC<{
  q: string;
  ans: string;
  color: string;
  y: number;
  f: number;
  chipF: number;
  fps: number;
}> = ({ q, ans, color, y, f, chipF, fps }) => {
  const qP = pop(f, fps, Math.max(2, chipF - 60));
  const chipP = f > chipF ? pop(f, fps, chipF) : 0;
  return (
    <div style={{ position: "absolute", top: y, left: 90, right: 90, opacity: qP, transform: `translateY(${(1 - qP) * 18}px)` }}>
      <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 44, color: C.ink, marginBottom: 16 }}>{q}</div>
      <div
        style={{
          display: "inline-block",
          opacity: chipP,
          transform: `scale(${0.7 + 0.3 * chipP})`,
          transformOrigin: "left center",
          fontFamily: MONO,
          fontWeight: 700,
          fontSize: 40,
          color,
          padding: "12px 28px",
          borderRadius: 14,
          background: `${color}1A`,
          border: `2px solid ${color}`,
          boxShadow: `0 0 26px ${color}33`,
        }}
      >
        → {ans}
      </div>
    </div>
  );
};

const SceneDecision: React.FC<{ durF: number }> = ({ durF }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = env(f, durF);
  return (
    <AbsoluteFill style={{ opacity: e }}>
      <Kicker text="WHICH ONE?" color={C.mut} f={f} fps={fps} />
      <SubTitle text="three questions" f={f} delayF={6} fps={fps} />
      <QRow q="Clear one backlog faster?" ans="QUEUE" color={C.queue} y={470} f={f} chipF={(T.decision.q - T.decision.s) * fps} fps={fps} />
      <QRow q="Many teams need the same history, with replay?" ans="STREAM" color={C.stream} y={740} f={f} chipF={(T.decision.st - T.decision.s) * fps} fps={fps} />
      <QRow q="One fact reaching many services?" ans="EVENT BUS" color={C.bus} y={1050} f={f} chipF={(T.decision.b - T.decision.s) * fps} fps={fps} />
    </AbsoluteFill>
  );
};

// ===========================================================================
// SCENE 7 — PAYOFF
// ===========================================================================
const ScenePayoff: React.FC<{ durF: number }> = ({ durF }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = env(f, durF);
  const allF = (T.payoff.all3 - T.payoff.s) * fps;
  const busP = pop(f, fps, allF);
  const qP = pop(f, fps, allF + 12);
  const stP = pop(f, fps, allF + 24);
  const ctaP = pop(f, fps, (T.payoff.cta - T.payoff.s) * fps);

  const node = (label: string, color: string, x: number, y: number, p: number, sub: string) => (
    <div style={{ position: "absolute", left: x, top: y, transform: `translate(-50%,-50%) scale(${p})`, opacity: p, textAlign: "center" }}>
      <div style={{ width: 260, padding: "24px 0", borderRadius: 20, background: C.card, border: `3px solid ${color}`, fontFamily: MONO, fontWeight: 700, fontSize: 34, color, boxShadow: `0 0 30px ${color}44` }}>
        {label}
      </div>
      <div style={{ marginTop: 12, fontFamily: SANS, fontSize: 27, color: C.mut }}>{sub}</div>
    </div>
  );

  return (
    <AbsoluteFill style={{ opacity: e }}>
      <SubTitle text="Big systems use all three" f={f} delayF={4} fps={fps} />

      <svg style={{ position: "absolute", left: 0, top: 0, width: 1080, height: 1920, pointerEvents: "none" }}>
        <line x1={540} y1={640} x2={540} y2={860} stroke={C.bus} strokeWidth={5} strokeDasharray="12 10" strokeDashoffset={-f * 2} opacity={qP} />
        <line x1={540} y1={980} x2={540} y2={1180} stroke={C.stream} strokeWidth={5} strokeDasharray="12 10" strokeDashoffset={-f * 2} opacity={stP} />
      </svg>

      {node("EVENT BUS", C.bus, 540, 580, busP, "routes the event")}
      {node("QUEUE", C.queue, 540, 920, qP, "absorbs the work")}
      {node("STREAM", C.stream, 540, 1260, stP, "remembers it forever")}

      {/* end CTA */}
      <div style={{ position: "absolute", top: 1440, left: 90, right: 90, textAlign: "center", opacity: ctaP, transform: `translateY(${(1 - ctaP) * 18}px)` }}>
        <div style={{ display: "inline-block", fontFamily: SANS, fontWeight: 700, fontSize: 38, color: C.ink, padding: "20px 34px", borderRadius: 18, background: "rgba(167,139,250,0.12)", border: `2px solid ${C.bus}` }}>
          Save this for your next system design interview ↑
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ===========================================================================
// Root composition
// ===========================================================================
export const DiagramReelPropsSchema = z.object({
  durationSeconds: z.number().default(78.8),
  width: z.number().default(1080),
  height: z.number().default(1920),
  fps: z.number().default(30),
});
export type DiagramReelProps = z.infer<typeof DiagramReelPropsSchema>;
export const defaultDiagramReelProps: DiagramReelProps = {
  durationSeconds: 78.8,
  width: 1080,
  height: 1920,
  fps: 30,
};

const F = (sec: number, fps: number) => Math.round(sec * fps);

export const DiagramReel: React.FC<DiagramReelProps> = () => {
  const { fps, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();
  const progress = frame / durationInFrames;

  const scene = (s: number, e: number) => ({ from: F(s, fps), durationInFrames: F(e, fps) - F(s, fps) });
  const S = {
    hook: scene(T.hook.s, T.hook.e),
    model: scene(T.model.s, T.model.e),
    queue: scene(T.queue.s, T.queue.e),
    stream: scene(T.stream.s, T.stream.e),
    bus: scene(T.bus.s, T.bus.e),
    decision: scene(T.decision.s, T.decision.e),
    payoff: scene(T.payoff.s, T.payoff.e),
  };

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg0 }}>
      <Bg progress={progress} />
      <Sequence {...S.hook}><SceneHook durF={S.hook.durationInFrames} /></Sequence>
      <Sequence {...S.model}><SceneModel durF={S.model.durationInFrames} /></Sequence>
      <Sequence {...S.queue}><SceneQueue durF={S.queue.durationInFrames} /></Sequence>
      <Sequence {...S.stream}><SceneStream durF={S.stream.durationInFrames} /></Sequence>
      <Sequence {...S.bus}><SceneBus durF={S.bus.durationInFrames} /></Sequence>
      <Sequence {...S.decision}><SceneDecision durF={S.decision.durationInFrames} /></Sequence>
      <Sequence {...S.payoff}><ScenePayoff durF={S.payoff.durationInFrames} /></Sequence>
    </AbsoluteFill>
  );
};
