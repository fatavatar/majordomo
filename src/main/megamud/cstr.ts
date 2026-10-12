/**
 * The string routines megamud.exe's own code calls, ported so a handler
 * behaves exactly as the decompile reads, edge cases included. Strings are
 * JavaScript strings; where C copies into a fixed buffer, the copy is cut to
 * the buffer's size less its terminator, as the C does.
 */

/** `0x4acbb0`: copy into a buffer of `size` bytes, cutting to `size - 1`. */
export function strlcpy(src: string, size: number): string {
  if (size <= 0) return '';
  return src.length >= size ? src.slice(0, size - 1) : src;
}

/** `strncpy` then a terminator at `n`: the first `n` characters, at most. */
export function strncpyz(src: string, n: number): string {
  return src.slice(0, Math.max(0, n));
}

/**
 * `0x4ad670`: where `needle` first occurs in `hay`, case-sensitive, or -1.
 * An empty `hay` is -1 even for an empty needle, as the C loop never starts.
 */
export function indexOf(hay: string, needle: string): number {
  if (hay.length === 0) return -1;
  return hay.indexOf(needle);
}

/**
 * `0x4ad5a0`: `strstr` from position `from`, as an index into the whole
 * string, or -1. A start past the end is -1.
 */
export function indexFrom(hay: string, from: number, needle: string): number {
  if (from > hay.length) return -1;
  return hay.indexOf(needle, from);
}

/** `0x4adc10`: drop leading and trailing spaces (spaces only, not tabs). */
export function trimSpaces(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text[start] === ' ') start += 1;
  while (end > start && text[end - 1] === ' ') end -= 1;
  return text.slice(start, end);
}

/** `0x4ad3a0`: insert `ins` at `at`, or at the end when `at` is past it. */
export function insertAt(text: string, at: number, ins: string): string {
  const pos = Math.min(at, text.length);
  return text.slice(0, pos) + ins + text.slice(pos);
}

/** `0x4ad140`: drop the first `n` characters (all of them when `n` is past the end). */
export function dropFirst(text: string, n: number): string {
  return n >= text.length ? '' : text.slice(n);
}

/** `0x4aca70`/`strchr`: where `ch` first occurs, or -1. */
export function strchr(text: string, ch: string): number {
  return text.indexOf(ch);
}

/** `_stricmp`: compare without regard to ASCII case; <0, 0, >0. */
export function stricmp(a: string, b: string): number {
  return strnicmp(a, b, Math.max(a.length, b.length) + 1);
}

/** `_strnicmp`: compare at most `n` characters without regard to ASCII case. */
export function strnicmp(a: string, b: string, n: number): number {
  for (let i = 0; i < n; i += 1) {
    const ca = i < a.length ? lower(a.charCodeAt(i)) : 0;
    const cb = i < b.length ? lower(b.charCodeAt(i)) : 0;
    if (ca !== cb) return ca - cb;
    if (ca === 0) return 0;
  }
  return 0;
}

/** `strcmp`: <0, 0, >0. */
export function strcmp(a: string, b: string): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

function lower(code: number): number {
  return code >= 65 && code <= 90 ? code + 32 : code;
}

/** `atoi`/`atol`: leading blanks, a sign, digits; anything else ends it. */
export function atoi(text: string): number {
  const match = /^[ \t\n\v\f\r]*([+-]?\d+)/.exec(text);
  if (!match?.[1]) return 0;
  return Number.parseInt(match[1], 10) | 0;
}

/** C integer division, which truncates toward zero. */
export function idiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

/**
 * `0x4ad340`: where `needle` occurs at or after `from`, without regard to
 * ASCII case, or -1. MegaMUD only searches when `from` is no more than the
 * needle's length (a quirk of its guard), which every caller's 0 satisfies.
 */
export function findNoCase(hay: string, from: number, needle: string): number {
  if (from > needle.length) return -1;
  for (let i = from; i < hay.length; i += 1) {
    if (strnicmp(hay.slice(i), needle, needle.length) === 0) return i;
  }
  return -1;
}

/** `0x4ad6c0`: where `needle` first occurs in `hay`, without regard to case, or -1. */
export function indexOfNoCase(hay: string, needle: string): number {
  if (hay.length === 0) return -1;
  return hay.toLowerCase().indexOf(needle.toLowerCase());
}

/**
 * `0x4ad530`: a number at the front (after spaces, with an optional `-`), and
 * where it ends. No digits read as 0.
 */
export function leadingNumber(text: string): [number, number] {
  let i = 0;
  while (text[i] === ' ') i += 1;
  const negative = text[i] === '-';
  if (negative) i += 1;
  let n = 0;
  while (i < text.length && text[i]! >= '0' && text[i]! <= '9') {
    n = (n * 10 + (text.charCodeAt(i) - 48)) | 0;
    i += 1;
  }
  return [negative ? -n : n, i];
}

/**
 * `0x4acaf0`: `needle` read against `hay` the way MegaMUD matches an
 * abbreviation: they agree, without regard to case, for at least `min`
 * characters, and where they part `hay` ends or has a space (or `needle`
 * ran out first). So `abbrev("sn", "sneak", 2)` and `abbrev("attack x",
 * "att", 1)` hold.
 */
export function abbrev(hay: string, needle: string, min: number): number {
  let matched = 0;
  for (let i = 0; i < needle.length; i += 1) {
    if (i >= hay.length) return matched >= min ? 1 : 0;
    if (hay[i]!.toLowerCase() !== needle[i]!.toLowerCase()) {
      if (matched < min) return 0;
      return hay[matched] === ' ' || hay[matched] === undefined ? 1 : 0;
    }
    matched += 1;
  }
  return matched >= min ? 1 : 0;
}

/**
 * `0x4adb80`: the first word of `text` (up to `sep`, a line end, or `size`
 * characters), trailing blanks dropped, and what follows it, leading spaces
 * dropped.
 */
export function splitWord(text: string, sep: string, size: number): [string, string] {
  let i = 0;
  let word = '';
  while (
    i < text.length &&
    text[i] !== '\n' &&
    text[i] !== '\r' &&
    text[i] !== sep &&
    word.length < size - 1
  ) {
    word += text[i];
    i += 1;
  }
  word = word.replace(/[ \n\r]+$/, '');
  if (text[i] === sep) i += 1;
  while (text[i] === ' ' || text[i] === '\r') i += 1;
  return [word, text.slice(i)];
}

const DIR_SHORT = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'u', 'd'];
const DIR_LONG = [
  'north',
  'south',
  'east',
  'west',
  'northeast',
  'northwest',
  'southeast',
  'southwest',
  'up',
  'down'
];

/** `0x4c0320`: a direction typed short or in full (optionally followed by `[`), 0 north … 9 down; else -1. */
export function typedDirection(word: string): number {
  for (let i = 9; i >= 0; i -= 1) {
    for (const name of [DIR_SHORT[i]!, DIR_LONG[i]!]) {
      if (strnicmp(word, name, name.length) === 0) {
        const after = word[name.length];
        if (after === undefined || after === '[') return i;
      }
    }
  }
  return -1;
}

/** `0x4c0300`: a direction's word (0 north … 9 down), or "(unknown dir)". */
export function directionWord(dir: number): string {
  return dir >= 0 && dir <= 9 ? DIR_LONG[dir]! : '(unknown dir)';
}

/** `0x4c03b0`: a direction's abbreviation (`n` … `d`), or "(unknown dir)". */
export function directionShort(dir: number): string {
  return dir >= 0 && dir <= 9 ? DIR_SHORT[dir]! : '(unknown dir)';
}
