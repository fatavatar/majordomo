import { describe, expect, it } from 'vitest';

import { ADDED_ROWS, OWN_IDS_FROM, tabAsDrawn } from '../layout';
import { settingDef } from '../settings';
import { SETTINGS_TABS } from '../settingsTabs';

const tab = (title: string) => SETTINGS_TABS.find((t) => t.title === title)!;
const at = (
  title: string,
  pick: (c: { text: string; id: number; bind?: { key: string } }) => boolean
) => tabAsDrawn(tab(title)).controls.find(pick)!;

describe('the tabs as this client draws them', () => {
  it('leave a tab with no rows of its own as MegaMUD lays it out', () => {
    expect(tabAsDrawn(tab('Health'))).toBe(tab('Health'));
  });

  it('put the opening attack under the normal attack, and the opening weapon under the backstab weapon', () => {
    const y = (key: string) => at('Combat', (c) => c.bind?.key === key).y;
    expect(y('AttackCmd')).toBe(14);
    expect(y('OpenCmd')).toBe(28);
    expect(y('BsWeapon')).toBe(42);
    expect(y('OpenWeapon')).toBe(56);
    expect(y('NrmWeapon')).toBe(70);
    expect(y('AltWeapon')).toBe(84);
    expect(y('Shield')).toBe(98);
    expect(y('PreBsCmd')).toBe(117);
  });

  it('grow the frames and lists the rows fall in, and move what is below them', () => {
    const frame = (text: string) => at('Combat', (c) => c.text === text);
    expect(frame('Weapon Combat')).toMatchObject({ y: 3, h: 133 });
    expect(frame('Options')).toMatchObject({ y: 3, h: 133 });
    expect(frame('Spell Combat')).toMatchObject({ y: 145, h: 89 });
    expect(at('Combat', (c) => c.id === 5008)).toMatchObject({ y: 13, h: 90 });
    expect(tabAsDrawn(tab('Combat')).h).toBe(tab('Combat').h + 28);
  });

  it('go through the page in the order they are drawn down it', () => {
    const ids = tabAsDrawn(tab('Combat')).controls.map((c) => c.id);
    expect(ids.indexOf(9002)).toBe(ids.indexOf(1023) + 2);
    expect(ids.indexOf(9004)).toBeGreaterThan(ids.indexOf(5101));
    expect(ids.indexOf(9004)).toBeLessThan(ids.indexOf(1317));
  });

  it('give their own controls ids no template uses, bound to settings the schema knows', () => {
    for (const [title, rows] of Object.entries(ADDED_ROWS)) {
      const theirs = new Set(tab(title).controls.map((c) => c.id));
      for (const c of rows.flatMap((row) => row.controls)) {
        expect(c.id).toBeGreaterThanOrEqual(OWN_IDS_FROM);
        expect(theirs.has(c.id)).toBe(false);
        if (c.bind) expect(settingDef(c.bind.section, c.bind.key)).toBeDefined();
      }
    }
  });
});

describe('a lifted column', () => {
  it('closes the gap the console’s own settings leave on Other', () => {
    const y = (key: string) => at('Other', (c) => c.bind?.key === key).y;
    expect(y('RunRooms')).toBe(71);
    expect(y('DelPlayers')).toBe(85);
    expect(y('EntryCmd')).toBe(108);
    expect(y('ExitCmd')).toBe(122);
    expect(at('Other', (c) => c.text === 'Miscellaneous')).toMatchObject({ y: 3, h: 140 });
    expect(at('Other', (c) => c.id === 1965)).toMatchObject({ y: 14, h: 215 });
  });
});
