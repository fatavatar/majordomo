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
