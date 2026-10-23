import { describe, expect, it } from 'vitest';

import { asBbsSettings } from '../bbs';

describe('a realm’s BBS set-up', () => {
  it('keeps the keys the engine reads, in their own spelling, as text', () => {
    expect(
      asBbsSettings({ logoffcmd: 'x', PvpLevel: 40, TelnetAddr: 'h', MenuPrompt: ['no'] })
    ).toEqual({ LogoffCmd: 'x', PvpLevel: '40' });
    expect(asBbsSettings('nonsense')).toEqual({});
  });
});
