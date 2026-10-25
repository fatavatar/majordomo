import { describe, expect, it } from 'vitest';

import { comboFor } from '../NameCombo';

const MOBS = ['giant rat', 'gigantic black ooze', 'kobold thief', 'wererat shaman'];

describe('a name picker', () => {
  it('suggests by prefix first, then anywhere in the name', () => {
    expect(comboFor(MOBS, 'rat').suggestions).toEqual(['giant rat', 'wererat shaman']);
    expect(comboFor(MOBS, 'gi').suggestions).toEqual(['giant rat', 'gigantic black ooze']);
  });

  it('replaces the whole value with a choice', () => {
    expect(comboFor(MOBS, 'gi').choose('giant rat')).toBe('giant rat');
  });
});

/* The avoid list: names, comma-separated, completed one at a time. */
describe('a list of names in one field', () => {
  it('suggests for the name after the last comma', () => {
    expect(comboFor(MOBS, 'giant rat, kob', ',').suggestions).toEqual(['kobold thief']);
  });

  it('does not offer a name already written', () => {
    expect(comboFor(MOBS, 'giant rat, g', ',').suggestions).toEqual(['gigantic black ooze']);
  });

  it('puts a choice in place of the name being typed and keeps the rest', () => {
    expect(comboFor(MOBS, 'giant rat, kob', ',').choose('kobold thief')).toBe(
      'giant rat, kobold thief'
    );
    expect(comboFor(MOBS, 'kob', ',').choose('kobold thief')).toBe('kobold thief');
  });
});

/* A spell box: it takes the short command, and the spell's name is beside it. */
describe('a box that takes a short form', () => {
  const SHORTS = ['bles', 'mend', 'mihe'];
  const NAMES = new Map([
    ['bles', 'bless'],
    ['mend', 'minor healing'],
    ['mihe', 'major healing']
  ]);

  it('finds a short form by its name, after any by the short form itself', () => {
    expect(comboFor(SHORTS, 'mi', undefined, NAMES).suggestions).toEqual(['mihe', 'mend']);
    expect(comboFor(SHORTS, 'heal', undefined, NAMES).suggestions).toEqual(['mend', 'mihe']);
  });

  it('puts the short form in the box', () => {
    expect(comboFor(SHORTS, 'minor', undefined, NAMES).choose('mend')).toBe('mend');
  });
});
