/**
 * Data-viz overlays — animated stat / chart primitives for explainer + "here's
 * the number" shorts. A NEW capability (videoclaw could not render an animated
 * chart before). These slot into the SAME typed-overlay pipeline as Hook/UrlPill:
 * compose_render emits a `dataviz` array (see schema.ts DataVizSchema) and
 * Captioned.tsx renders each in a time-anchored <Sequence>.
 *
 * Design law (from the OpenMontage comparison, P3):
 *  - DATA-DRIVEN via props (value / series), never hard-coded.
 *  - THEMED from the tenant brand pack (colors + font passed in `theme`), NOT a
 *    per-project theme. Default theme = generic L3 taste.
 *  - MOTION IS MANDATORY (the [static-motion] commitment): every primitive
 *    animates on — a count-up, a staggered grow-in — never a dead static chart.
 */
import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { fontFamily as INTER } from "@remotion/google-fonts/Inter";

// ---------------------------------------------------------------------------
// Theme — resolved from the tenant brand pack, with tasteful generic defaults.
// ---------------------------------------------------------------------------
export type DataVizTheme = {
  font_family?: string;   // CSS font family (defaults to Inter)
  color?: string;         // the big number / primary ink
  accent?: string;        // bar fill / highlight
  bg?: string | null;     // card background (null = transparent)
  text_color?: string;    // labels
  radius?: number;        // card corner radius
};

const DEFAULT_THEME: Required<Omit<DataVizTheme, "bg">> & { bg: string | null } = {
  font_family: INTER,
  color: "#14141A",
  accent: "#2DD4BF",
  bg: "#FFFFFF",
  text_color: "#4A4A55",
  radius: 28,
};

const resolveTheme = (t?: DataVizTheme) => ({
  ...DEFAULT_THEME,
  ...(t || {}),
  font_family: t?.font_family || DEFAULT_THEME.font_family,
  bg: t === undefined || t.bg === undefined ? DEFAULT_THEME.bg : t.bg,
});

// ---------------------------------------------------------------------------
// Placement — same vocabulary as CaptionStyle.position.
// ---------------------------------------------------------------------------
export type VizPosition = "top" | "center" | "lower-third" | "bottom";

const positionStyle = (pos: VizPosition = "center"): React.CSSProperties => {
  const map: Record<VizPosition, React.CSSProperties> = {
    top: { justifyContent: "flex-start", paddingTop: 220 },
    center: { justifyContent: "center" },
    "lower-third": { justifyContent: "flex-end", paddingBottom: 520 },
    bottom: { justifyContent: "flex-end", paddingBottom: 140 },
  };
  return { alignItems: "center", paddingLeft: 70, paddingRight: 70, ...map[pos] };
};

const useEnter = (): number => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame, fps, config: { damping: 22, stiffness: 170, mass: 0.9 } });
};

const card = (th: ReturnType<typeof resolveTheme>): React.CSSProperties => ({
  fontFamily: th.font_family,
  background: th.bg ?? "transparent",
  borderRadius: th.radius,
  padding: th.bg ? "48px 56px" : 0,
  boxShadow: th.bg ? "0 18px 60px rgba(0,0,0,0.28)" : "none",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  maxWidth: 900,
});

const fmt = (n: number, decimals = 0, prefix = "", suffix = "") =>
  `${prefix}${n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}${suffix}`;

// ---------------------------------------------------------------------------
// StatCounter — one big number counting up to `value`.
// ---------------------------------------------------------------------------
export type StatProps = {
  value: number;
  label?: string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  position?: VizPosition;
  theme?: DataVizTheme;
};

export const StatCounter: React.FC<StatProps> = (p) => {
  const th = resolveTheme(p.theme);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Count-up over ~0.9s with an ease-out, then settle.
  const t = spring({ frame, fps, config: { damping: 200, stiffness: 60, mass: 1 } });
  const shown = interpolate(t, [0, 1], [0, p.value]);
  const pop = interpolate(useEnter(), [0, 1], [0.9, 1]);
  // Auto-fit: keep the number inside the card (~780px usable) so long values
  // ($2,400,000) don't bleed past the edges. Cap at the hero size for short ones.
  const finalStr = fmt(p.value, p.decimals ?? 0, p.prefix ?? "", p.suffix ?? "");
  const fontSize = Math.min(176, Math.floor(780 / (Math.max(3, finalStr.length) * 0.62)));
  return (
    <AbsoluteFill style={positionStyle(p.position)}>
      <div style={{ ...card(th), transform: `scale(${pop})` }}>
        <div
          style={{
            fontWeight: 900,
            fontSize,
            lineHeight: 1,
            letterSpacing: "-0.03em",
            color: th.color,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {fmt(shown, p.decimals ?? 0, p.prefix ?? "", p.suffix ?? "")}
        </div>
        {p.label ? (
          <div
            style={{
              marginTop: 18,
              fontWeight: 600,
              fontSize: 42,
              color: th.text_color,
              textAlign: "center",
            }}
          >
            {p.label}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Shared bar row (used by BarChart + ComparisonBar).
// ---------------------------------------------------------------------------
type Datum = { label: string; value: number; color?: string };

const BarRow: React.FC<{
  d: Datum;
  maxValue: number;
  index: number;
  th: ReturnType<typeof resolveTheme>;
  suffix?: string;
  decimals?: number;
}> = ({ d, maxValue, index, th, suffix, decimals }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Staggered grow-in: each bar starts 4 frames after the previous.
  const grow = spring({
    frame: frame - index * 4,
    fps,
    config: { damping: 20, stiffness: 140, mass: 0.8 },
  });
  const widthPct = interpolate(grow, [0, 1], [0, (d.value / maxValue) * 100]);
  return (
    <div style={{ width: "100%", marginBottom: 26 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 38,
          fontWeight: 700,
          color: th.text_color,
          marginBottom: 10,
        }}
      >
        <span>{d.label}</span>
        <span style={{ color: th.color, fontVariantNumeric: "tabular-nums" }}>
          {fmt(interpolate(grow, [0, 1], [0, d.value]), decimals ?? 0, "", suffix ?? "")}
        </span>
      </div>
      <div style={{ height: 46, borderRadius: 999, background: "rgba(0,0,0,0.08)" }}>
        <div
          style={{
            width: `${widthPct}%`,
            height: "100%",
            borderRadius: 999,
            background: d.color || th.accent,
          }}
        />
      </div>
    </div>
  );
};

export type BarProps = {
  series: Datum[];
  suffix?: string;
  decimals?: number;
  position?: VizPosition;
  theme?: DataVizTheme;
};

export const BarChart: React.FC<BarProps> = (p) => {
  const th = resolveTheme(p.theme);
  const pop = interpolate(useEnter(), [0, 1], [0.94, 1]);
  const maxValue = Math.max(...p.series.map((d) => d.value), 1);
  return (
    <AbsoluteFill style={positionStyle(p.position)}>
      <div style={{ ...card(th), width: 900, transform: `scale(${pop})` }}>
        {p.series.map((d, i) => (
          <BarRow
            key={d.label + i}
            d={d}
            index={i}
            maxValue={maxValue}
            th={th}
            suffix={p.suffix}
            decimals={p.decimals}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};

// ComparisonBar — exactly two bars (A vs B). Distinct default colors.
export const ComparisonBar: React.FC<BarProps> = (p) => {
  const th = resolveTheme(p.theme);
  const two = p.series.slice(0, 2).map((d, i) => ({
    ...d,
    color: d.color || (i === 0 ? "#94A3B8" : th.accent),
  }));
  return <BarChart {...p} series={two} theme={p.theme} />;
};

// ---------------------------------------------------------------------------
// Dispatcher — kind → component. Consumed by Captioned.tsx.
// ---------------------------------------------------------------------------
export type DataVizItem = {
  kind: "stat" | "bar" | "compare";
  start: number;
  end: number;
  position?: VizPosition;
  theme?: DataVizTheme;
  // stat
  value?: number;
  label?: string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  // bar / compare
  series?: Datum[];
};

export const DataViz: React.FC<{ item: DataVizItem }> = ({ item }) => {
  if (item.kind === "stat") {
    return (
      <StatCounter
        value={item.value ?? 0}
        label={item.label}
        prefix={item.prefix}
        suffix={item.suffix}
        decimals={item.decimals}
        position={item.position}
        theme={item.theme}
      />
    );
  }
  const barProps: BarProps = {
    series: item.series ?? [],
    suffix: item.suffix,
    decimals: item.decimals,
    position: item.position,
    theme: item.theme,
  };
  return item.kind === "compare" ? <ComparisonBar {...barProps} /> : <BarChart {...barProps} />;
};
