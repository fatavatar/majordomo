import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { holding, partName, pruneLogs, released } from '../logBudget';

let dir = '';

/** A file of `size` bytes, last written `age` seconds ago. */
function file(name: string, size: number, age: number): string {
  const at = path.join(dir, name);
  fs.writeFileSync(at, 'x'.repeat(size));
  const when = Date.now() / 1000 - age;
  fs.utimesSync(at, when, when);
  return at;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mudengine-budget-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/* The logs folder had no limit and had reached 3.6 GB (2026-10-18). */
describe('the logs folder’s budget', () => {
  it('deletes the oldest logs and captures until it is under', () => {
    file('a_skinny.log', 100, 300);
    file('a_skinny.mudcap.jsonl', 100, 200);
    file('b_fatty.log', 100, 100);
    expect(pruneLogs(dir, 150)).toBe(2);
    expect(fs.readdirSync(dir)).toEqual(['b_fatty.log']);
  });

  it('never deletes one a session is writing, nor what is not a log', () => {
    const writing = file('a_skinny.log', 100, 300);
    file('notes.txt', 100, 400);
    file('b_fatty.log', 100, 100);
    holding(writing);
    try {
      expect(pruneLogs(dir, 50)).toBe(1);
      expect(fs.readdirSync(dir).sort()).toEqual(['a_skinny.log', 'notes.txt']);
    } finally {
      released(writing);
    }
  });

  it('leaves a folder under its budget alone', () => {
    file('a_skinny.log', 100, 300);
    expect(pruneLogs(dir, 1000)).toBe(0);
    expect(pruneLogs(path.join(dir, 'missing'), 0)).toBe(0);
  });

  it('names the parts a full file goes on in', () => {
    expect(partName('/l/2026_skinny.log', 2)).toBe('/l/2026_skinny.2.log');
    expect(partName('/l/2026_skinny.mudcap.jsonl', 3)).toBe('/l/2026_skinny.3.mudcap.jsonl');
  });
});
