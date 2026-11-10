import { describe, expect, it } from 'vitest';

import { realmFileName } from '../web/uploads';

/* A realm database sent up from a tab (2026-11-10): the name it is kept under. */
describe('an uploaded realm file’s name', () => {
  it('keeps a realm’s name and extension, and nothing that walks or hides', () => {
    expect(realmFileName('mudrev.mdb')).toBe('mudrev.mdb');
    expect(realmFileName('C:\\Users\\me\\MudRev World.MDB')).toBe('MudRev World.mdb');
    expect(realmFileName('../../etc/passwd')).toBeNull();
    expect(realmFileName('../realm.zip')).toBe('realm.zip');
    expect(realmFileName('.hidden.mdb')).toBe('hidden.mdb');
    expect(realmFileName('a;rm -rf.sqlite')).toBe('a_rm -rf.sqlite');
    expect(realmFileName('.mdb')).toBeNull();
    expect(realmFileName('notes.txt')).toBeNull();
  });
});
