import { describe, expect, it } from 'vitest';

import { BUNDLED_FONTS, chosenFace, familiesOf } from '../fontChoices';

/* 2026-11-01: the font settings offer faces rather than a box to type a name in. */
describe('a font setting read against the offer', () => {
  it('reads a stack as its families, unquoted', () => {
    expect(familiesOf(`'IBM Plex Mono', "Fira Code" , monospace`)).toEqual([
      'IBM Plex Mono',
      'Fira Code',
      'monospace'
    ]);
    expect(familiesOf('  ')).toEqual([]);
  });

  it('finds the one family it names among those offered, whatever its case', () => {
    expect(chosenFace('ibm plex mono', BUNDLED_FONTS)).toBe('IBM Plex Mono');
    expect(chosenFace('LucidaProgrammer Nerd Font Mono', BUNDLED_FONTS)).toBe(
      'LucidaProgrammer Nerd Font Mono'
    );
  });

  it('leaves a stack, or a face nobody offers, to "Other…"', () => {
    expect(chosenFace('IBM Plex Mono, Consolas', BUNDLED_FONTS)).toBeNull();
    expect(chosenFace('Comic Mono', BUNDLED_FONTS)).toBeNull();
    expect(chosenFace('', BUNDLED_FONTS)).toBeNull();
  });

  it('ships IBM Plex Mono', () => {
    expect(BUNDLED_FONTS).toContain('IBM Plex Mono');
  });
});
