import { describe, expect, it } from 'vitest';

import { ABILITY } from '../abilities';
import {
  abilitySum,
  carriedLights,
  LIGHT_REACH_ABILITY,
  lightPhrase,
  NIGHT_VISION_ABILITY,
  ROOM_LIGHT_ABILITY,
  wornVision
} from '../light';
import { wireItem } from '../entities';

/*
 * The server's own arithmetic (`Room.GetLightLevelDesc`, `Player.ShowRoom`),
 * confirmed on the wire: `rm` prints `Room Illu: <room> (<seen>)`, and every
 * recorded session agrees with the sum below exactly. The four rows in the
 * table are those measurements (2026-09-03).
 */
describe('the light arithmetic', () => {
  it('names the three ability ids the way the realm does, so the two tables cannot drift', () => {
    expect(ABILITY[NIGHT_VISION_ABILITY]?.name).toBe('Illu');
    expect(ABILITY[ROOM_LIGHT_ABILITY]?.name).toBe('RoomIllu');
    expect(ABILITY[LIGHT_REACH_ABILITY]?.name).toBe('IlluTarget');
  });

  it('reads the four phrases off the bands the server uses', () => {
    expect(lightPhrase(-201)).toBe('pitch black');
    expect(lightPhrase(-200)).toBe('very dark');
    expect(lightPhrase(-151)).toBe('very dark');
    expect(lightPhrase(-150)).toBe('barely visible');
    expect(lightPhrase(-100)).toBe('dimly lit');
    expect(lightPhrase(-1)).toBe('dimly lit');
    expect(lightPhrase(0)).toBeNull();
    expect(lightPhrase(200)).toBeNull();
  });

  it('sums a worn item’s night vision and reads the pack’s lights off the realm', () => {
    const mask = {
      ...wireItem('carved ivory mask', { equipped: true }),
      abilities: [[13, 25]] as Array<[number, number]>
    };
    const torch = {
      ...wireItem('torch', { equipped: true, slot: 'Readied', charges: 62 }),
      kind: 'light' as const,
      abilities: [[54, 100]] as Array<[number, number]>
    };
    const spare = {
      ...wireItem('torch'),
      kind: 'light' as const,
      abilities: [[54, 100]] as Array<[number, number]>
    };
    expect(wornVision([mask, torch, spare])).toBe(25);
    expect(carriedLights([mask, torch, spare])).toEqual([
      { name: 'torch', reach: 100, charges: 62, lit: true },
      { name: 'torch', reach: 100, charges: null, lit: false }
    ]);
    expect(
      abilitySum(
        [
          [13, 25],
          [54, 100],
          [13, 5]
        ],
        13
      )
    ).toBe(30);
  });
});
