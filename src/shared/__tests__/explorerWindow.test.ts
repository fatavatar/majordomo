import { describe, expect, it } from 'vitest';

import { EMPTY_CHARACTER, ownAlignment, type CharacterState } from '../character';
import { asExplorerAs, isExplorerFocus, viewedAs } from '../explorer';

/*
 * A link pressed in the main window, handed to the Explorer in a window of
 * its own (2026-10-29), crosses main from a renderer: read there.
 */
describe('what the Explorer is asked to open on', () => {
  it('is a tab of the Explorer and an entry, by number or by key', () => {
    expect(isExplorerFocus({ kind: 'weapons', item: 12 })).toBe(true);
    expect(isExplorerFocus({ kind: 'rooms', item: '1/2340' })).toBe(true);
    expect(isExplorerFocus({ kind: 'tools', item: 0 })).toBe(true);
  });

  it('is nothing else', () => {
    expect(isExplorerFocus(null)).toBe(false);
    expect(isExplorerFocus('weapons')).toBe(false);
    expect(isExplorerFocus({ kind: 'sideways', item: 1 })).toBe(false);
    expect(isExplorerFocus({ kind: 'weapons' })).toBe(false);
    expect(isExplorerFocus({ kind: 'weapons', item: { n: 1 } })).toBe(false);
  });
});

/* The Explorer's top row: who it answers for, where not the character as played (2026-10-29). */
describe('who the Explorer answers for', () => {
  const archer: CharacterState = {
    ...EMPTY_CHARACTER,
    name: 'Archer',
    className: 'Druid',
    race: 'Elf',
    progress: { ...EMPTY_CHARACTER.progress, level: 31 },
    online: [
      {
        name: 'Archer',
        alignment: 'Neutral',
        title: null,
        flags: null,
        gang: null,
        provisional: false
      },
      { name: 'Bowel', alignment: 'Good', title: null, flags: null, gang: null, provisional: false }
    ]
  };

  it('reads what the bridge carries, and nothing changed as the character as played', () => {
    expect(
      asExplorerAs({ className: ' Warrior ', race: '', level: 60, alignment: 'evil' })
    ).toEqual({
      className: 'Warrior',
      race: null,
      level: 60,
      alignment: 'evil'
    });
    expect(asExplorerAs({ level: 0, alignment: 'chaotic' })).toBeNull();
    expect(asExplorerAs({ className: null, race: null, level: null, alignment: null })).toBeNull();
    expect(asExplorerAs('Warrior')).toBeNull();
  });

  it('lays the class, race, level and standing over the character, its stats and the rest its own', () => {
    const as = viewedAs(archer, { className: 'Warrior', race: null, level: 60, alignment: 'evil' });
    expect(as.className).toBe('Warrior');
    expect(as.race).toBe('Elf');
    expect(as.progress.level).toBe(60);
    expect(ownAlignment(as)).toBe('Villain');
    expect(as.online.find((entry) => entry.name === 'Bowel')?.alignment).toBe('Good');
    expect(as.inventory).toBe(archer.inventory);
  });

  it('reads any standing as no row of its own, and nothing as the character as played', () => {
    expect(
      ownAlignment(viewedAs(archer, { className: null, race: null, level: null, alignment: 'any' }))
    ).toBeNull();
    expect(viewedAs(archer, null)).toBe(archer);
  });

  it('gives a character the realm has not named a row to stand in', () => {
    const nameless = { ...archer, name: null, online: [] };
    const as = viewedAs(nameless, { className: null, race: null, level: null, alignment: 'good' });
    expect(ownAlignment(as)).toBe('Good');
  });
});
