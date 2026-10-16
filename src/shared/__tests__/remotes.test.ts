import { describe, expect, it } from 'vitest';

import { judgeRemote, REMOTES, REMOTE_NAMES, parseRemoteReply } from '../remotes';

describe('the `@` command vocabulary', () => {
  /*
   * A closed union with its runtime table beside it, in the shape this codebase
   * keeps them. A name in one and not the other is a command the parser accepts
   * and the responder has nothing to say about.
   */
  it('has a row for every name, and no row for a name it does not have', () => {
    expect(Object.keys(REMOTES).sort()).toEqual([...REMOTE_NAMES].sort());
    for (const name of REMOTE_NAMES) expect(REMOTES[name].name).toBe(name);
  });

  /*
   * Every command that is not round-tripped has to say why, in its own row —
   * an unread one in writing, a refused one by naming which standing refusal
   * answers it (the sentence itself is UI copy in locales/ui.en.yaml, under
   * automation.peers.refusal.<id>, kept alive by i18n-coverage.test.ts).
   */
  it('gives a reason for everything it will not answer', () => {
    for (const spec of Object.values(REMOTES)) {
      if (spec.support === 'unread') expect(spec.because.length, spec.name).toBeGreaterThan(10);
      if (spec.support === 'refused') {
        expect(['kill', 'hangup', 'relog', 'panic'], spec.name).toContain(spec.refusal);
      }
    }
  });
});

describe('reading another client’s reply', () => {
  /* captures/055 and captures/123, exactly as they appear. */
  it('reads both captured shapes', () => {
    expect(parseRemoteReply('{HP=600/600}')).toEqual({
      kind: 'vitals',
      hp: 600,
      hpMax: 600,
      mana: null,
      manaMax: null
    });
    expect(parseRemoteReply('{HP=4434/4434,MA=516/516}')).toEqual({
      kind: 'vitals',
      hp: 4434,
      hpMax: 4434,
      mana: 516,
      manaMax: 516
    });
    expect(parseRemoteReply('{ok}')).toEqual({ kind: 'ok' });
  });

  /* The mana field is optional for the same reason it is in the status line. */
  it('reads a kai class’s spelling of the mana field', () => {
    expect(parseRemoteReply('{HP=62/62,KAI=4/10}')).toEqual({
      kind: 'vitals',
      hp: 62,
      hpMax: 62,
      mana: 4,
      manaMax: 10
    });
  });

  it('reads nothing out of ordinary chat', () => {
    expect(parseRemoteReply('hello')).toBeNull();
    expect(parseRemoteReply('{HP=600}')).toBeNull();
  });
});

describe('the gang grant, once the roster can answer it', () => {
  const gang = { gang: ['health' as const], party: [], players: {} };
  it('allows on a shared gang', () => {
    expect(judgeRemote('spike', 'health', gang, { inGang: true, inParty: false })).toEqual({
      allowed: true,
      because: 'gang'
    });
  });
  it('refuses a different gang without calling it unresolved', () => {
    expect(judgeRemote('spike', 'health', gang, { inGang: false, inParty: false })).toEqual({
      allowed: false,
      because: 'not-granted',
      gangUnresolved: false,
      notInParty: false
    });
  });
});

/*
 * The extended pair. Everything about them exists because a room *name* is
 * ambiguous — 83.85% of this realm's edges lead to a namesake — and the
 * realm's own `map/number` is not.
 */
describe('the extended wording', () => {
  it('reads the three replies only this conversation has', () => {
    expect(parseRemoteReply('{mudengine 0.6.5}')).toEqual({
      kind: 'version',
      client: 'mudengine',
      version: '0.6.5'
    });
    expect(parseRemoteReply('{MegaMMUD 2.1}')).toEqual({
      kind: 'version',
      client: 'MegaMMUD',
      version: '2.1'
    });
    expect(parseRemoteReply('{1/2150 Town Gates}')).toEqual({
      kind: 'room',
      map: 1,
      number: 2150,
      name: 'Town Gates'
    });
    expect(parseRemoteReply('{1/2150}')).toEqual({
      kind: 'room',
      map: 1,
      number: 2150,
      name: null
    });
    expect(parseRemoteReply('{command invalid or not allowed}')).toEqual({ kind: 'refused' });
  });

  /*
   * The shapes the version pattern must not swallow, since it runs over every
   * brace-wrapped thing anybody says. `@where`'s own answers are among them,
   * which is the collision that matters.
   */
  it('does not read another answer in the vocabulary as a version', () => {
    for (const other of [
      '{ok}',
      '{No one}',
      '{Nothing}',
      '{yes: 1}',
      '{Town Gates}',
      '{Town Gates (Exits: N,S)}',
      '{HP=600/600}',
      '{WALK: Town Gates}'
    ]) {
      expect(parseRemoteReply(other)?.kind).not.toBe('version');
    }
  });
});
