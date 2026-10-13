/**
 * A character's MegaMUD settings: the `.ini` MegaMUD keeps per character,
 * read as `megamud.exe` reads it and written as it writes it.
 *
 * The reading follows the loader (`0x449aa0`, read 2026-10-12):
 *
 * - **Numbers** go through `0x4475d0`: `GetPrivateProfileStringA` into 30
 *   bytes, then `atol`. So `12abc` reads 12, text reads 0, and a missing key
 *   keeps the value already there (the default).
 * - **Text** goes through `0x4476f0` into a buffer of the key's `size`, so it
 *   is cut to `size - 1` characters.
 * - **Sections and keys** match without regard to case, and a value loses its
 *   surrounding blanks and one pair of surrounding quotes, as
 *   `GetPrivateProfileStringA` does.
 * - **Profiles.** `Health`, `Combat` and `Spells` are also kept in up to four
 *   numbered copies, `Health.P1` to `Health.P4` (`0x4496c0`, `0x449630`,
 *   `0x44dc20`). A copy is there when its section is. Copy 1 is always on;
 *   the others carry `Enabled` (default 1). Keys missing from a copy read as 0
 *   or empty (`0x44e350` passes no defaults). The plain section is the live
 *   one: after the copies are read, the live values are copied *into* the
 *   active copy (`0x447d80` → `0x44e150`), and when there is no copy 1 the
 *   live values become it. The active copy is `Profiles.ActiveProfile` when
 *   that is 1 to 4 and present, else 1 (`0x447290`).
 * - A few keys are clamped or fall back to an older name: see `LOADER_RULES`.
 *
 * Sections and keys the schema does not know are kept as they were read, so
 * a file written back loses nothing MegaMUD put in it.
 */
import { SETTINGS, type SettingDef } from './schema';

export type SettingValue = number | string;
export type SectionValues = Record<string, SettingValue>;

export const PROFILED_SECTIONS = ['Health', 'Combat', 'Spells'] as const;
export type ProfiledSection = (typeof PROFILED_SECTIONS)[number];

/** One stored copy of a profiled section. */
export interface ProfileSlot {
  enabled: boolean;
  values: SectionValues;
}

export interface MegaSettings {
  /** The live sections, every schema key filled in. */
  live: Record<string, SectionValues>;
  /** Copies 1 to 4 of each profiled section; `null` where there is none. */
  profiles: Record<ProfiledSection, (ProfileSlot | null)[]>;
  /** Raw sections and keys outside the schema, in file order. */
  extra: IniSection[];
}

/** One section of an INI file, its entries in file order. */
export interface IniSection {
  name: string;
  entries: [string, string][];
}

const BY_SECTION = new Map<string, SettingDef[]>();
for (const def of SETTINGS) {
  const list = BY_SECTION.get(def.section) ?? [];
  list.push(def);
  BY_SECTION.set(def.section, list);
}

/** The schema's keys for one section, in the loader's order. */
export function sectionDefs(section: string): readonly SettingDef[] {
  return BY_SECTION.get(section) ?? [];
}

/** Every section the schema knows, in the loader's order. */
export function sections(): string[] {
  return [...BY_SECTION.keys()];
}

/** The definition of one key, if the schema knows it. */
export function settingDef(section: string, key: string): SettingDef | undefined {
  const lower = key.toLowerCase();
  return BY_SECTION.get(section)?.find((def) => def.key.toLowerCase() === lower);
}

/** Splits INI text into sections. Lines before the first section are dropped, as Windows does. */
export function parseIni(text: string): IniSection[] {
  const out: IniSection[] = [];
  let current: IniSection | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith(';')) continue;
    if (line.startsWith('[')) {
      const end = line.indexOf(']');
      current = { name: line.slice(1, end < 0 ? undefined : end).trim(), entries: [] };
      out.push(current);
      continue;
    }
    if (current === null) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    current.entries.push([line.slice(0, eq).trim(), unquote(line.slice(eq + 1).trim())]);
  }
  return out;
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    if ((first === '"' || first === "'") && value[value.length - 1] === first) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/** `atol`: leading blanks, a sign, then digits; anything else ends the number. */
export function atol(text: string): number {
  const match = /^\s*([+-]?\d+)/.exec(text);
  if (!match?.[1]) return 0;
  const value = Number.parseInt(match[1], 10);
  // A 32-bit `long` wraps; MegaMUD's `atol` saturates, which no real setting reaches.
  return Math.max(-0x80000000, Math.min(0x7fffffff, value));
}

function find(ini: IniSection[], section: string): IniSection | undefined {
  const lower = section.toLowerCase();
  return ini.find((s) => s.name.toLowerCase() === lower);
}

function lookup(section: IniSection | undefined, key: string): string | undefined {
  if (!section) return undefined;
  const lower = key.toLowerCase();
  for (const [k, v] of section.entries) if (k.toLowerCase() === lower) return v;
  return undefined;
}

function read(def: SettingDef, raw: string | undefined, fallback: SettingValue): SettingValue {
  if (raw === undefined) return fallback;
  switch (def.kind) {
    case 'str':
      return def.size ? raw.slice(0, def.size - 1) : raw;
    case 'rect':
      return raw;
    case 'int64': {
      const match = /^\s*([+-]?\d+)/.exec(raw);
      return match?.[1] ? Number(match[1]) : 0;
    }
    default:
      // `0x4475d0` reads into 30 bytes, so only the first 29 characters count.
      return atol(raw.slice(0, 29));
  }
}

/** Every schema key at its default. */
export function defaultSettings(): MegaSettings {
  const live: Record<string, SectionValues> = {};
  for (const [section, defs] of BY_SECTION) {
    const values: SectionValues = {};
    for (const def of defs) values[def.key] = def.default;
    live[section] = values;
  }
  const profiles = {} as MegaSettings['profiles'];
  for (const section of PROFILED_SECTIONS) {
    profiles[section] = [{ enabled: true, values: profileCopy(live, section) }, null, null, null];
  }
  return { live, profiles, extra: [] };
}

/** The profiled keys of a live section, copied (`0x44e150`). */
function profileCopy(live: Record<string, SectionValues>, section: ProfiledSection): SectionValues {
  const values: SectionValues = {};
  for (const def of sectionDefs(section)) {
    if (def.profiled) values[def.key] = live[section]?.[def.key] ?? def.default;
  }
  return values;
}

/**
 * Clamps and fallbacks the loader applies to particular keys. Each takes the
 * value read (or the default) and the raw file, and returns what is kept.
 */
const LOADER_RULES: Record<string, (value: SettingValue, ini: IniSection[]) => SettingValue> = {
  // `Profiles.ActiveProfile` defaults to the older `Combat.ActiveProfile`, and
  // anything outside 1–4 is 1.
  'Profiles.ActiveProfile': (value, ini) => {
    const raw =
      lookup(find(ini, 'Profiles'), 'ActiveProfile') ??
      lookup(find(ini, 'Combat'), 'ActiveProfile');
    const active = raw === undefined ? 1 : atol(raw);
    return active < 1 || active > 4 ? 1 : active;
  },
  // Below 1 is 0, above 99 is 100.
  'Health.HpHeal%': (value) => clampBelow(value as number, 1, 0, 99, 100),
  // `PartyHeal1` defaults to the older `PartyHeal`.
  'Party.PartyHeal1': (value, ini) => {
    const party = find(ini, 'Party');
    return (lookup(party, 'PartyHeal1') ?? lookup(party, 'PartyHeal') ?? '').slice(0, 19);
  },
  'Display.AnsiRows': (value) => clampBelow(value as number, 0x1a, 0x19, 199, 200),
  'Display.AnsiCols': (value) => clampBelow(value as number, 0x51, 0x50, 0x83, 0x84),
  'Talk.MaxLines': (value) => clampBelow(value as number, 0x33, 0x32, 4999, 5000),
  'Other.ScrollMem': (value) => clampBelow(value as number, 0x3e9, 1000, 4999999, 5000000)
};

/** `if (v < low) v = lowTo; else if (high < v) v = highTo;`, as the loader writes it. */
function clampBelow(
  value: number,
  low: number,
  lowTo: number,
  high: number,
  highTo: number
): number {
  if (value < low) return lowTo;
  if (high < value) return highTo;
  return value;
}

/** Reads a character's INI text the way MegaMUD's loader does. */
export function settingsFromIni(text: string): MegaSettings {
  const ini = parseIni(text);
  const settings = defaultSettings();
  for (const [section, defs] of BY_SECTION) {
    const found = find(ini, section);
    const values = settings.live[section]!;
    for (const def of defs) {
      values[def.key] = read(def, lookup(found, def.key), def.default);
      const rule = LOADER_RULES[`${section}.${def.key}`];
      if (rule) values[def.key] = rule(values[def.key]!, ini);
    }
  }
  // `HangupWhenAfk`, when set, clears `HangupNotAfk` (an older pair of names).
  if (atol(lookup(find(ini, 'Other'), 'HangupWhenAfk') ?? '0') !== 0) {
    settings.live['Other']!['HangupNotAfk'] = 0;
  }
  const active = settings.live['Profiles']?.['ActiveProfile'] as number;
  for (const section of PROFILED_SECTIONS) {
    const slots: (ProfileSlot | null)[] = [];
    for (let n = 1; n <= 4; n += 1) {
      const found = find(ini, `${section}.P${n}`);
      if (!found || found.entries.length === 0) {
        slots.push(null);
        continue;
      }
      const values: SectionValues = {};
      for (const def of sectionDefs(section)) {
        if (def.profiled)
          values[def.key] = read(def, lookup(found, def.key), def.kind === 'str' ? '' : 0);
      }
      const enabled = n === 1 ? true : atol(lookup(found, 'Enabled') ?? '1') !== 0;
      slots.push({ enabled, values });
    }
    if (!slots[0]) slots[0] = { enabled: true, values: profileCopy(settings.live, section) };
    const index = active >= 1 && active <= 4 && slots[active - 1] ? active - 1 : 0;
    slots[index] = { enabled: slots[index]!.enabled, values: profileCopy(settings.live, section) };
    settings.profiles[section] = slots;
  }
  const known = new Set(sections().map((s) => s.toLowerCase()));
  for (const section of PROFILED_SECTIONS) {
    for (let n = 1; n <= 4; n += 1) known.add(`${section}.p${n}`.toLowerCase());
  }
  for (const section of ini) {
    if (!known.has(section.name.toLowerCase())) {
      settings.extra.push(section);
      continue;
    }
    const unknown = section.entries.filter(
      ([key]) =>
        !settingDef(section.name.replace(/\.P\d$/i, ''), key) && key.toLowerCase() !== 'enabled'
    );
    if (unknown.length > 0) settings.extra.push({ name: section.name, entries: unknown });
  }
  return settings;
}

/** Older names the loader still reads but MegaMUD no longer writes. */
const LEGACY_KEYS = new Set(['Combat.ActiveProfile', 'Party.PartyHeal']);

function format(value: SettingValue): string {
  return typeof value === 'number' ? String(Math.trunc(value)) : value;
}

/** Writes settings back as MegaMUD's INI text, CRLF line ends, schema order. */
export function settingsToIni(settings: MegaSettings): string {
  const lines: string[] = [];
  const extras = new Map(settings.extra.map((s) => [s.name.toLowerCase(), s]));
  const emitExtra = (name: string): void => {
    const extra = extras.get(name.toLowerCase());
    if (!extra) return;
    for (const [key, value] of extra.entries) lines.push(`${key}=${value}`);
    extras.delete(name.toLowerCase());
  };
  for (const [section, defs] of BY_SECTION) {
    lines.push(`[${section}]`);
    const values = settings.live[section] ?? {};
    for (const def of defs) {
      if (!LEGACY_KEYS.has(`${section}.${def.key}`)) {
        lines.push(`${def.key}=${format(values[def.key] ?? def.default)}`);
      }
    }
    emitExtra(section);
    if ((PROFILED_SECTIONS as readonly string[]).includes(section)) {
      settings.profiles[section as ProfiledSection].forEach((slot, i) => {
        if (!slot) return;
        const name = `${section}.P${i + 1}`;
        lines.push(`[${name}]`);
        lines.push(`Enabled=${slot.enabled ? 1 : 0}`);
        for (const def of defs) {
          if (def.profiled) lines.push(`${def.key}=${format(slot.values[def.key] ?? def.default)}`);
        }
        emitExtra(name);
      });
    }
  }
  for (const extra of extras.values()) {
    lines.push(`[${extra.name}]`);
    for (const [key, value] of extra.entries) lines.push(`${key}=${value}`);
  }
  return lines.join('\r\n') + '\r\n';
}

/** A number setting; 0 for a key the schema does not know. */
export function num(settings: MegaSettings, section: string, key: string): number {
  const value = settings.live[section]?.[key];
  return typeof value === 'number' ? value : 0;
}

/** A text setting; empty for a key the schema does not know. */
export function text(settings: MegaSettings, section: string, key: string): string {
  const value = settings.live[section]?.[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Switches to another profile copy: the live values are stored into the
 * active copy, the chosen copy becomes live, and `ActiveProfile` names it.
 * A copy that is not there is made from the live values.
 */
export function switchProfile(settings: MegaSettings, to: number): MegaSettings {
  if (to < 1 || to > 4) return settings;
  const next: MegaSettings = structuredClone(settings);
  const from = num(next, 'Profiles', 'ActiveProfile');
  for (const section of PROFILED_SECTIONS) {
    const slots = next.profiles[section];
    const index = from >= 1 && from <= 4 && slots[from - 1] ? from - 1 : 0;
    slots[index] = {
      enabled: slots[index]?.enabled ?? true,
      values: profileCopy(next.live, section)
    };
    const chosen = slots[to - 1] ?? { enabled: true, values: profileCopy(next.live, section) };
    slots[to - 1] = chosen;
    Object.assign(next.live[section]!, chosen.values);
  }
  next.live['Profiles']!['ActiveProfile'] = to;
  return next;
}

/** A value for one key from an untrusted draft: its own type, text cut to the loader's buffer and kept to one line. */
function draftValue(def: SettingDef, raw: unknown): SettingValue {
  if (def.kind === 'str') {
    if (typeof raw !== 'string') return def.default;
    return raw.replace(/[\r\n\0]/g, '').slice(0, (def.size ?? 257) - 1);
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return def.default;
  return Math.trunc(raw);
}

/**
 * Settings from a draft the window sent, over `base` (the file as it is):
 * every schema key taken at its own type, anything else ignored, and the
 * sections outside the schema kept from `base` alone. Null for a draft that
 * is not settings at all. Read back through the loader, so its clamps apply.
 */
export function settingsFromDraft(raw: unknown, base: MegaSettings): MegaSettings | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const draft = raw as { live?: unknown; profiles?: unknown };
  if (typeof draft.live !== 'object' || draft.live === null) return null;
  const live = draft.live as Record<string, Record<string, unknown> | undefined>;
  const next: MegaSettings = structuredClone(base);
  for (const [section, defs] of BY_SECTION) {
    const from = live[section];
    if (typeof from !== 'object' || from === null) continue;
    for (const def of defs) {
      if (def.key in from) next.live[section]![def.key] = draftValue(def, from[def.key]);
    }
  }
  const profiles = (draft.profiles ?? {}) as Record<string, unknown>;
  for (const section of PROFILED_SECTIONS) {
    const slots = profiles[section];
    if (!Array.isArray(slots)) continue;
    next.profiles[section] = [0, 1, 2, 3].map((i) => {
      const slot = slots[i] as { enabled?: unknown; values?: unknown } | null | undefined;
      if (typeof slot !== 'object' || slot === null)
        return i === 0 ? next.profiles[section][0]! : null;
      const values: SectionValues = {};
      const given = (
        typeof slot.values === 'object' && slot.values !== null ? slot.values : {}
      ) as Record<string, unknown>;
      for (const def of sectionDefs(section)) {
        if (def.profiled) values[def.key] = draftValue(def, given[def.key]);
      }
      return { enabled: i === 0 || slot.enabled !== false, values };
    });
  }
  return settingsFromIni(settingsToIni(next));
}
