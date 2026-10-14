import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { MovementBook } from '../MovementBook';

/* What each character was walking, outliving the server (2026-10-14). */
describe('the movement book', () => {
  const dirs: string[] = [];
  const fileIn = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-'));
    dirs.push(dir);
    return path.join(dir, 'movement.json');
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps a loop and a route per character, across a restart, and lets them go', () => {
    const file = fileIn();
    const book = new MovementBook({ file });
    book.set('skinny', { loop: 'Ring' });
    book.set('healbot', { to: '1/2', run: true });
    const again = new MovementBook({ file });
    expect(again.get('skinny')).toEqual({ loop: 'Ring' });
    expect(again.get('healbot')).toEqual({ to: '1/2', run: true });
    again.set('skinny', null);
    expect(new MovementBook({ file }).get('skinny')).toBeNull();
  });

  it('says so of a file it cannot read, and writes nothing over it', () => {
    const file = fileIn();
    fs.writeFileSync(file, '{ not json');
    const said: string[] = [];
    const book = new MovementBook({ file, notify: (message) => said.push(message) });
    book.set('skinny', { loop: 'Ring' });
    expect(said).toHaveLength(1);
    expect(fs.readFileSync(file, 'utf8')).toBe('{ not json');
  });
});
