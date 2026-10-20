/**
 * Pre-loaded Google Fonts available to caption rendering and overlays.tsx.
 *
 * Why pre-load instead of dynamic-load: dynamically calling loadFont() at
 * render time creates a delayRender handle race — if the font hasn't resolved
 * by the first frame, the render fails. We instead pre-load a curated set of
 * fonts that cover the typography palettes in
 * agent/skills/typography_palette.md, and resolveFontFamily() picks the right
 * one (or falls back to Inter).
 *
 * To add a new family: import the loadFont, register it in the FONTS map,
 * and document the use case in agent/skills/typography_palette.md.
 *
 * TODO(typography-scale): when this registry grows past ~25 families, switch
 * to lazy palette-based loading — load only the families referenced by the
 * job's design_brief.md §2 (caption + emphasis + numeric). Right now (17
 * families, May 2026) the bundle cost is negligible; revisit when the
 * cost-per-render becomes noticeable OR when a job's first-render warmup
 * (cold font fetch) trips delayRender timeouts.
 */

import { staticFile, delayRender, continueRender } from "remotion";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMontserrat } from "@remotion/google-fonts/Montserrat";
import { loadFont as loadPoppins } from "@remotion/google-fonts/Poppins";
import { loadFont as loadRoboto } from "@remotion/google-fonts/Roboto";
import { loadFont as loadBebas } from "@remotion/google-fonts/BebasNeue";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadOswald } from "@remotion/google-fonts/Oswald";
import { loadFont as loadPlayfair } from "@remotion/google-fonts/PlayfairDisplay";
import { loadFont as loadManrope } from "@remotion/google-fonts/Manrope";
import { loadFont as loadSpaceGrotesk } from "@remotion/google-fonts/SpaceGrotesk";
import { loadFont as loadCormorant } from "@remotion/google-fonts/CormorantGaramond";
import { loadFont as loadEBGaramond } from "@remotion/google-fonts/EBGaramond";
import { loadFont as loadDMSerifDisplay } from "@remotion/google-fonts/DMSerifDisplay";
import { loadFont as loadBodoniModa } from "@remotion/google-fonts/BodoniModa";
import { loadFont as loadCaveat } from "@remotion/google-fonts/Caveat";
import { loadFont as loadKalam } from "@remotion/google-fonts/Kalam";
import { loadFont as loadPatrickHand } from "@remotion/google-fonts/PatrickHand";
import { loadFont as loadPermanentMarker } from "@remotion/google-fonts/PermanentMarker";
import { loadFont as loadDancingScript } from "@remotion/google-fonts/DancingScript";
import { loadFont as loadJetBrainsMono } from "@remotion/google-fonts/JetBrainsMono";

// Standard sans workhorses
const interFamily = loadInter("normal", { weights: ["400", "700", "800", "900"], subsets: ["latin"] }).fontFamily;
const montserratFamily = loadMontserrat("normal", { weights: ["400", "700", "800", "900"], subsets: ["latin"] }).fontFamily;
const poppinsFamily = loadPoppins("normal", { weights: ["400", "700", "800", "900"], subsets: ["latin"] }).fontFamily;
const robotoFamily = loadRoboto("normal", { weights: ["400", "700", "900"], subsets: ["latin"] }).fontFamily;
const manropeFamily = loadManrope("normal", { weights: ["400", "600", "700", "800"], subsets: ["latin"] }).fontFamily;
const spaceGroteskFamily = loadSpaceGrotesk("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] }).fontFamily;

// Display / condensed sans for hype + bold headers
const bebasFamily = loadBebas("normal", { weights: ["400"], subsets: ["latin"] }).fontFamily;
const antonFamily = loadAnton("normal", { weights: ["400"], subsets: ["latin"] }).fontFamily;
const oswaldFamily = loadOswald("normal", { weights: ["400", "700"], subsets: ["latin"] }).fontFamily;

// Editorial serifs (Palettes A / E / G)
const playfairFamily = loadPlayfair("normal", { weights: ["400", "700"], subsets: ["latin"] }).fontFamily;
const playfairItalicFamily = loadPlayfair("italic", { weights: ["400", "700"], subsets: ["latin"] }).fontFamily;
const cormorantFamily = loadCormorant("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] }).fontFamily;
const cormorantItalicFamily = loadCormorant("italic", { weights: ["400", "500", "600", "700"], subsets: ["latin"] }).fontFamily;
const ebGaramondFamily = loadEBGaramond("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] }).fontFamily;
const ebGaramondItalicFamily = loadEBGaramond("italic", { weights: ["400", "500", "600", "700"], subsets: ["latin"] }).fontFamily;
const dmSerifFamily = loadDMSerifDisplay("normal", { weights: ["400"], subsets: ["latin"] }).fontFamily;
const dmSerifItalicFamily = loadDMSerifDisplay("italic", { weights: ["400"], subsets: ["latin"] }).fontFamily;
const bodoniFamily = loadBodoniModa("normal", { weights: ["400", "700", "800", "900"], subsets: ["latin"] }).fontFamily;
const bodoniItalicFamily = loadBodoniModa("italic", { weights: ["400", "700", "800", "900"], subsets: ["latin"] }).fontFamily;

// Handwritten — high-touch personal palette (F). Use sparingly per typography_palette.md.
const caveatFamily = loadCaveat("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] }).fontFamily;
const kalamFamily = loadKalam("normal", { weights: ["400", "700"], subsets: ["latin"] }).fontFamily;
const patrickHandFamily = loadPatrickHand("normal", { weights: ["400"], subsets: ["latin"] }).fontFamily;
const permanentMarkerFamily = loadPermanentMarker("normal", { weights: ["400"], subsets: ["latin"] }).fontFamily;
const dancingScriptFamily = loadDancingScript("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] }).fontFamily;

// Monospace — tech / build-in-public register
const jetBrainsMonoFamily = loadJetBrainsMono("normal", { weights: ["400", "500", "700"], subsets: ["latin"] }).fontFamily;

// Custom local PIXEL font — the JosephChinBuilds caption font (public/fonts/DePixelKlein.otf).
// NOT a Google font, so it loads via FontFace rather than @remotion/google-fonts. Guarded for
// SSR (Node bundling has no FontFace/document); the .otf must sit in remotion/public/fonts/.
const dePixelKleinFamily = 'DePixelKlein, "Courier New", monospace';
if (typeof document !== "undefined" && typeof FontFace !== "undefined") {
  const handle = delayRender("Loading DePixelKlein");
  new FontFace("DePixelKlein", `url(${staticFile("fonts/DePixelKlein.otf")})`)
    .load()
    .then((loaded) => { document.fonts.add(loaded); continueRender(handle); })
    .catch(() => continueRender(handle));
}

const FONTS: Record<string, string> = {
  // sans
  inter: interFamily,
  montserrat: montserratFamily,
  poppins: poppinsFamily,
  roboto: robotoFamily,
  manrope: manropeFamily,
  space_grotesk: spaceGroteskFamily,
  "space grotesk": spaceGroteskFamily,

  // display / condensed
  "bebas neue": bebasFamily,
  bebas: bebasFamily,
  anton: antonFamily,
  oswald: oswaldFamily,

  // editorial serifs
  playfair: playfairFamily,
  "playfair display": playfairFamily,
  "playfair italic": playfairItalicFamily,
  "playfair display italic": playfairItalicFamily,
  cormorant: cormorantFamily,
  "cormorant garamond": cormorantFamily,
  "cormorant italic": cormorantItalicFamily,
  "cormorant garamond italic": cormorantItalicFamily,
  "eb garamond": ebGaramondFamily,
  garamond: ebGaramondFamily,
  "eb garamond italic": ebGaramondItalicFamily,
  "garamond italic": ebGaramondItalicFamily,
  "dm serif": dmSerifFamily,
  "dm serif display": dmSerifFamily,
  "dm serif italic": dmSerifItalicFamily,
  bodoni: bodoniFamily,
  "bodoni moda": bodoniFamily,
  "bodoni italic": bodoniItalicFamily,
  "bodoni moda italic": bodoniItalicFamily,

  // handwritten
  caveat: caveatFamily,
  kalam: kalamFamily,
  "patrick hand": patrickHandFamily,
  "permanent marker": permanentMarkerFamily,
  "dancing script": dancingScriptFamily,

  // monospace
  "jetbrains mono": jetBrainsMonoFamily,
  jetbrains: jetBrainsMonoFamily,
  mono: jetBrainsMonoFamily,

  // pixel display — JosephChinBuilds caption font (custom local .otf)
  depixelklein: dePixelKleinFamily,
  "depixel klein": dePixelKleinFamily,
  depixel: dePixelKleinFamily,
};

export const DEFAULT_FONT_FAMILY = interFamily;

/**
 * The default emphasis font used by `CaptionPage.tsx` when a word is marked
 * italic via `italic_word_starts_ms`. Palette A (Editorial Italic) default.
 * Override per-job by setting `caption_style.emphasis_font_family` in
 * `style_directives.json`.
 */
export const EMPHASIS_SERIF_FAMILY = playfairItalicFamily;

export const resolveFontFamily = (requested: string | undefined): string => {
  if (!requested) return DEFAULT_FONT_FAMILY;
  const key = requested.trim().toLowerCase();
  return FONTS[key] ?? DEFAULT_FONT_FAMILY;
};
