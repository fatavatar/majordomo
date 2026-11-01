/**
 * The faces a font setting offers (2026-11-01).
 *
 * The console and interface fonts were a box to type a family name into, which
 * asks somebody to know the exact name of a face they have never seen spelled
 * out. The offer is two lists instead: the faces that come with the client,
 * which every machine has, and the ones this machine has installed. Typing a
 * stack by hand is still there, as "Other…", for whatever neither list holds.
 *
 * Installed faces are read with the Local Font Access API where the browser
 * has it (Electron, and Chromium on a secure page), and otherwise by measuring:
 * a family the browser cannot find falls through to the generic face behind
 * it, so text set in `'X', monospace` measures exactly as `monospace` does. The
 * console takes only fixed-pitch faces, by the same measure `measurePitch`
 * makes of the stack it is given.
 */

import { CP437_FALLBACK_FONT, MONOSPACE_FALLBACKS } from '@shared/config';

/** What the client ships (`styles/fonts.css`), fixed-pitch every one. */
export const BUNDLED_FONTS: readonly string[] = [
  'LucidaProgrammer Nerd Font Mono',
  'IBM Plex Mono',
  'JetBrains Mono',
  CP437_FALLBACK_FONT,
  'Web437 IBM VGA 9x16',
  'Web437 IBM EGA 8x14'
];

/**
 * Faces worth looking for where the machine cannot be asked for its list:
 * the usual fixed-pitch faces of each platform and the popular coding faces,
 * then the usual text faces for the interface.
 */
const KNOWN_MONOSPACE: readonly string[] = [
  ...MONOSPACE_FALLBACKS,
  'Cascadia Mono',
  'Cascadia Code',
  'SF Mono',
  'Andale Mono',
  'Ubuntu Mono',
  'Noto Sans Mono',
  'Droid Sans Mono',
  'Fira Code',
  'Fira Mono',
  'Source Code Pro',
  'Hack',
  'Inconsolata',
  'Roboto Mono',
  'Iosevka',
  'Victor Mono',
  'Geist Mono',
  'Anonymous Pro',
  'PT Mono',
  'Space Mono',
  'Courier Prime',
  'Lucida Sans Typewriter',
  'Terminus'
];

const KNOWN_TEXT: readonly string[] = [
  'Segoe UI',
  'Calibri',
  'Arial',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Georgia',
  'Helvetica Neue',
  'Helvetica',
  'SF Pro Text',
  'Inter',
  'Roboto',
  'Open Sans',
  'Lato',
  'Noto Sans',
  'Ubuntu',
  'Cantarell',
  'DejaVu Sans',
  'Liberation Sans',
  'Source Sans 3',
  'IBM Plex Sans'
];

/** The families a stack names, unquoted, in order. */
export function familiesOf(stack: string): string[] {
  return stack
    .split(',')
    .map((family) => family.trim().replace(/^(['"])(.*)\1$/, '$2'))
    .filter((family) => family.length > 0);
}

/**
 * Which entry of the offer a setting's value is: the one family it names when
 * that family is offered, or null where it is a stack, or a face the offer does
 * not have, which "Other…" shows as typed.
 */
export function chosenFace(value: string, offered: readonly string[]): string | null {
  const families = familiesOf(value);
  if (families.length !== 1) return null;
  const wanted = families[0]!.toLowerCase();
  return offered.find((face) => face.toLowerCase() === wanted) ?? null;
}

let canvas: HTMLCanvasElement | null = null;

function context(): CanvasRenderingContext2D | null {
  canvas ??= document.createElement('canvas');
  return canvas.getContext('2d');
}

const SAMPLE = 'mmmmmmmmmmlli1WW@#';

function quoted(family: string): string {
  return `'${family.replace(/'/g, "\\'")}'`;
}

/** Whether the browser can find a face, by whether it changes what text measures. */
function installed(ctx: CanvasRenderingContext2D, family: string): boolean {
  return (['monospace', 'serif', 'sans-serif'] as const).some((generic) => {
    ctx.font = `32px ${generic}`;
    const bare = ctx.measureText(SAMPLE).width;
    ctx.font = `32px ${quoted(family)}, ${generic}`;
    return ctx.measureText(SAMPLE).width !== bare;
  });
}

/** Whether a face sets every probe at one advance, as a console cell needs. */
function fixedPitch(ctx: CanvasRenderingContext2D, family: string): boolean {
  ctx.font = `32px ${quoted(family)}, monospace`;
  const widths = ['i', 'W', 'M', '.', 'l'].map((probe) => ctx.measureText(probe).width);
  return widths.every((width) => Math.abs(width - widths[0]!) < 0.01);
}

interface LocalFontData {
  family: string;
}

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<LocalFontData[]>;
  }
}

/**
 * Every family the machine will list, or null where it will not be asked.
 *
 * A browser that has not been given the permission answers with an empty list
 * rather than a refusal, so empty is read as "not asked" too: no machine that
 * runs this has no fonts at all.
 */
async function listedFamilies(): Promise<string[] | null> {
  if (typeof window.queryLocalFonts !== 'function') return null;
  try {
    const fonts = await window.queryLocalFonts();
    return fonts.length === 0 ? null : [...new Set(fonts.map((font) => font.family))];
  } catch {
    // Refused, or not on a secure page: measuring is the answer then.
    return null;
  }
}

export interface InstalledFaces {
  /** Fixed-pitch faces, for the console. */
  monospace: string[];
  /** Every face, for the interface. */
  all: string[];
}

let found: Promise<InstalledFaces> | null = null;
/** Whether the list came from the machine itself rather than from measuring. */
let listedByMachine = false;
let askedOnPress = false;

async function look(): Promise<InstalledFaces> {
  const ctx = context();
  if (ctx === null) return { monospace: [], all: [] };
  const bundled = new Set(BUNDLED_FONTS.map((face) => face.toLowerCase()));
  const listed = await listedFamilies();
  listedByMachine = listed !== null;
  const candidates = (listed ?? [...KNOWN_MONOSPACE, ...KNOWN_TEXT]).filter(
    (family) => !bundled.has(family.toLowerCase())
  );
  const present =
    listed === null ? candidates.filter((family) => installed(ctx, family)) : candidates;
  const all = [...new Set(present)].sort((a, b) => a.localeCompare(b));
  return { all, monospace: all.filter((family) => fixedPitch(ctx, family)) };
}

/**
 * The faces this machine has, the client's own left out, sorted by name. Asked
 * once a page: a font installed while the client runs is the rare case, and
 * measuring every family again on each open of the settings is not free.
 */
export function installedFaces(): Promise<InstalledFaces> {
  found ??= look();
  return found;
}

/**
 * Asked again from a press on the menu, once, where the first answer was only
 * measured: a browser asks for the permission to list fonts only from a press,
 * and a machine's own list holds every face rather than the known few.
 */
export function installedFacesOnPress(): Promise<InstalledFaces> | null {
  if (listedByMachine || askedOnPress || typeof window.queryLocalFonts !== 'function') return null;
  askedOnPress = true;
  found = look();
  return found;
}
