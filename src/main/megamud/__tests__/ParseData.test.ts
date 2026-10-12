import { describe, expect, it, vi } from 'vitest';

import * as dispatch from '../input/dispatch';
import { applySgr, escapeChar, newTerminal, parseData } from '../input/ParseData';
import { session } from './fixture';

/* `0x479630`, `0x4789d0` and `0x4183a0`, read 2026-10-12. */
describe('the attribute byte (0x4183a0)', () => {
  it('puts the foreground in bits 0-2, bold in bit 3 and the background in bits 4-6', () => {
    expect(applySgr(7, 35)).toBe(5);
    expect(applySgr(applySgr(7, 1), 35)).toBe(13);
    expect(applySgr(7, 41)).toBe(0x17);
    expect(applySgr(13, 0)).toBe(7);
  });
});

describe('the escape parser (0x4789d0)', () => {
  it('applies up to four SGR parameters', () => {
    const { s } = session();
    const t = newTerminal();
    for (const ch of '\x1b[1;32m') escapeChar(t, s, ch.charCodeAt(0));
    expect(t.attr).toBe(10);
    expect(t.escape).toBe(0);
  });

  it('leaves the colour alone on a bare ESC[m', () => {
    const { s } = session();
    const t = newTerminal();
    t.attr = 5;
    for (const ch of '\x1b[m') escapeChar(t, s, ch.charCodeAt(0));
    expect(t.attr).toBe(5);
  });
});

describe('framing lines (0x479630)', () => {
  it('hands each whole line over with the colour each character was drawn in', () => {
    const { s } = session();
    const seen: [string, number[], number][] = [];
    const spy = vi.spyOn(dispatch, 'dispatchLine').mockImplementation((sess, line, complete) => {
      seen.push([line, [...sess.lineAttr], complete]);
      return 0;
    });
    parseData(s, newTerminal(), '\x1b[35mAlso\x1b[0m x\r\n');
    expect(seen[0]).toEqual(['Also x', [5, 5, 5, 5, 7, 7], 1]);
    spy.mockRestore();
  });

  it('takes a backspace off the line', () => {
    const { s } = session();
    const lines: string[] = [];
    const spy = vi.spyOn(dispatch, 'dispatchLine').mockImplementation((_s, line, complete) => {
      if (complete) lines.push(line);
      return 0;
    });
    parseData(s, newTerminal(), 'abx\bc\n');
    expect(lines).toEqual(['abc']);
    spy.mockRestore();
  });

  it('keeps a partial line the dispatcher did not take, and drops one it did', () => {
    const { s } = session();
    const spy = vi.spyOn(dispatch, 'dispatchLine').mockReturnValue(0);
    parseData(s, newTerminal(), '[HP=10]:');
    expect(s.lineText).toBe('[HP=10]:');
    spy.mockReturnValue(1);
    parseData(s, newTerminal(), '');
    expect(s.lineText).toBe('');
    spy.mockRestore();
  });
});
