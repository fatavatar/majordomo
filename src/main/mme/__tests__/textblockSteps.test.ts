import { describe, expect, it } from 'vitest';

import { readStep } from '../textblockSteps';

describe('a textblock step frmResults prints as written', () => {
  it('leaves out the server filler', () => {
    expect(readStep('levelcheck')).toBe('drop');
    expect(readStep('check class')).toBe('drop');
  });

  it('reads message and text as the words of a block', () => {
    expect(readStep('message 2639')).toEqual({
      icon: 'PAPER',
      parts: ['Message, words of: ', { kind: 'textblock', n: 2639 }]
    });
    expect(readStep('text 9024')).toMatchObject({ parts: ['Text, words of: ', { n: 9024 }] });
  });

  it('reads a guard, with the block whose words refuse it when there is one', () => {
    expect(readStep('minlevel 15')).toEqual({ icon: 'REDARROW', parts: ['Min level: 15'] });
    expect(readStep('minlevel 20 2614')).toEqual({
      icon: 'REDARROW',
      parts: ['Min level: 20', ', else ', { kind: 'textblock', n: 2614 }]
    });
    expect(readStep('goodaligned -51 801')).toMatchObject({
      parts: ['Good: alignment -51 or lower', ', else ', { n: 801 }]
    });
    expect(readStep('nomonsters 1093')).toMatchObject({
      parts: ['No monsters in the room', ', else ', { n: 1093 }]
    });
  });

  it('reads testability as at most, two arguments in', () => {
    expect(readStep('testability 134 8')).toEqual({
      icon: 'ARROW',
      parts: ['Ability, at most 8: ', { kind: 'ability', n: 134 }]
    });
  });

  it('reads a delay in each of its spellings, and an alignment change', () => {
    for (const step of ['adddelay 5', 'delay 5', 'add delay 5']) {
      expect(readStep(step)).toEqual({ icon: 'PAPER', parts: ['Delay: 5 s'] });
    }
    expect(readStep('addevil 30')).toMatchObject({ parts: ['Alignment: +30 (evil)'] });
    expect(readStep('addevil -20')).toMatchObject({ parts: ['Alignment: -20 (good)'] });
  });

  it('keeps MME line for a step it does not know or a shape it does not expect', () => {
    expect(readStep('push altar')).toBeNull();
    expect(readStep('minlevel twenty')).toBeNull();
    expect(readStep('minlevel 20 2614 7')).toBeNull();
    expect(readStep('message hello')).toBeNull();
  });
});
