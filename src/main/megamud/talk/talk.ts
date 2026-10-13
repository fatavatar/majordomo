/**
 * `0x4b2ff0`: what is said around this character, read 2026-10-12. The
 * BBS's chat and notices; gossip, auctions, broadcasts (each with its alert,
 * and diverted to a player with `@divert` and the `Talk.Divert…` options);
 * gangpaths, telepaths, pages and what is said in the room (each first
 * offered to the remote commands, `0x4ae4a0`, with the password masked);
 * and this character's own speech: its attack commands and spells said by
 * mistake (the room is looked at again), its own pre/post commands, party
 * commands and `@divert` (cancelled). The conversation window itself
 * (`0x4adcd0`) is the app's.
 */
import { stepBack } from '../move/moves';
import { findEntity } from '../room/entities';
import { queue } from '../script/send';
import { forgetAwaited, setState } from '../script/state';
import type { Session } from '../Session';
import { remoteCommand } from './remote';

/** The social verbs that mark an emote (the table at `0x564610`). */
const EMOTES = [
  'bearhug',
  'bleed',
  'blink',
  'blush',
  'bow',
  'burp',
  'caress',
  'cheer',
  'chuckle',
  'chuckling',
  'clap',
  'comfort',
  'cough',
  'cuff',
  'curtsies',
  'curtsy',
  'dance',
  'embrace',
  'frown',
  'gasp',
  'giggle',
  'glare',
  'glaring',
  'greet',
  'grin',
  'groan',
  'growl',
  'grumble',
  'handshake',
  'highfive',
  'hug',
  'hum',
  'jump',
  'kiss',
  'laugh',
  'leap',
  'moan',
  'nod',
  'nudge',
  'pinch',
  'pout',
  'shake',
  'shrug',
  'sigh',
  'slap',
  'smack',
  'smile',
  'smirk',
  'smooch',
  'sneeze',
  'snicker',
  'sniff',
  'sob',
  'spit',
  'squeeze',
  'tease',
  'wave',
  'whimper',
  'whistle',
  'wink',
  'yawn'
];

/** `0x4aca90`: `word` starts `full`, for at least `min` characters (and no further than `word`). */
function abbreviates(word: string, full: string, min: number): boolean {
  let n = 0;
  while (n < full.length && n < word.length && word[n] === full[n]) n += 1;
  if (n < full.length && n < word.length) return false;
  return n >= min;
}

/** `0x4ae210`: pass the line on to the player talk is diverted to. */
function divert(s: Session, line: string): number {
  if (s.inGame === 0 || s.divertTo === '') return 0;
  if (line.includes('{==>') || line.includes('{##>')) return 0;
  queue(s, `/${s.divertTo} {==> ${line}}\r`);
  return 1;
}

/** Offer a line to the remote commands, with the password masked meanwhile. */
function offered(s: Session, line: string, kind: number): number {
  const password = s.BBS_Password;
  s.BBS_Password = '********';
  try {
    return remoteCommand(s, line, kind);
  } finally {
    s.BBS_Password = password;
  }
}

/** `0x4ae370`: an emote, or a move to cast or attack, in the room's colours. */
function emote(s: Session, line: string): number {
  const colour = s.line.attr[0];
  if (colour !== 2 && colour !== 3) return 0;
  if (line.startsWith('Obvious exits')) return 0;
  if (line.includes('moves to cast') || line.includes('moves to attack')) return 0;
  return EMOTES.some((verb) => line.includes(` ${verb}`)) ? 1 : 0;
}

/** The lines this character's own pre/post commands are made of. */
function ownCommand(s: Session, said: string): boolean {
  const prefix = s.s_7d21 !== '' ? s.s_7d21 : '.';
  for (const set of [
    s.Combat_PreBsCmd,
    s.Combat_PostBsCmd,
    s.Health_PreRestCmd,
    s.Health_PostRestCmd,
    s.Health_PreMedCmd,
    s.Health_PostMedCmd
  ]) {
    for (let part of set.split(/\^[Mm]/)) {
      part = part.slice(0, 0xff);
      if (part === '') continue;
      if (part.startsWith(prefix)) part = part.slice(prefix.length);
      if (part !== '' && part.toLowerCase() === said.toLowerCase()) return true;
    }
  }
  return false;
}

/** The fight's own speech: the room looked at again. */
function attackSaid(s: Session): number {
  s.f_e290 = 1;
  forgetAwaited(s, s.state);
  setState(s, 0);
  return 0;
}

/** This character's own speech. */
function ownSpeech(s: Session, line: string): number {
  s.hidden = 0;
  s.sneaking = 0;
  if (s.inGame === 0) return 0;
  const attack = `You say "${s.Combat_AttackCmd} `;
  const at = line.indexOf(attack);
  if (at !== -1) {
    const rest = line.slice(at + attack.length);
    const word = rest.slice(0, Math.min(rest.search(/[ "]|$/), 0xff));
    if (word !== '' && findEntity(s, word, 1)) return attackSaid(s);
  }
  const spells: [string, number][] = [
    [s.Combat_PreMultAttack, 9],
    [s.Combat_MultAttack, 10],
    [s.Combat_PreAttack, 0xb],
    [s.Combat_AttackSpl2, 0xc],
    [s.Combat_AttackSpl, 0xd],
    [s.altSpell, 0xe],
    [s.userSpell, 0xf]
  ];
  for (const [spell, state] of spells) {
    if (spell !== '' && s.state === state && line.includes(`You say "${spell} `))
      return attackSaid(s);
  }
  if (line.includes('You say "bs ')) return attackSaid(s);
  if (line.includes('You say "bash ') && s.roaming !== 0 && s.state === 0x17 && s.moveDir !== -1) {
    s.f_db34 = s.moveDir;
    s.f_e2dc = 0;
    forgetAwaited(s, 0x17);
    setState(s, 0);
    return 1;
  }
  if (line.includes('You say "bas ')) {
    s.f_e2dc = 1;
    forgetAwaited(s, s.state);
    setState(s, 0);
    return 1;
  }
  if (s.state === 0x2e) {
    const open = line.indexOf('You say "');
    if (open !== -1) {
      const said = line
        .slice(open + 9)
        .split('"')[0]!
        .slice(0, 0xff);
      if (said !== '' && ownCommand(s, said)) return 1;
    }
  }
  const party = [
    'You say "@heal"',
    'You say "!help',
    'You say "@wait',
    'You say "!wait',
    'You say "@ok',
    'You say "!ok',
    'You say "@share',
    'You say "@blind',
    'You say "@held',
    'You say "@diseased'
  ];
  if (party.some((p) => line.includes(p))) return 1;
  if (s.Party_PartyWaitCmd !== '' && line.includes(`You say "${s.Party_PartyWaitCmd}"`)) return 1;
  if (s.Party_PartyResumeCmd !== '' && line.includes(`You say "${s.Party_PartyResumeCmd}"`))
    return 1;
  if (line.includes('You say "@party ')) return 1;
  if (!line.includes('@divert')) {
    if (s.f_e174 !== 0) stepBack(s);
    setState(s, s.state);
    return 1;
  }
  if (s.divertTo !== '') {
    queue(s, `/${s.divertTo} {@divert cancelled by ${s.Player_Name}}\r`);
    s.divertTo = '';
    return 1;
  }
  s.host.show('[No @divert was active]');
  return 1;
}

export function talkLine(s: Session, line: string): number {
  const [first] = line.split(' ');
  if (
    abbreviates(first!, 'gossip', 3) ||
    abbreviates(first!, 'auction', 3) ||
    abbreviates(first!, 'gb', 2) ||
    abbreviates(first!, '/page', 2)
  ) {
    return 1;
  }
  const bbs = s.bbsTalk;
  if (bbs.chat.some((c) => c !== '' && line.includes(c))) return 1;
  if (bbs.broadcast !== '' && line.includes(bbs.broadcast)) {
    if (s.inGame === 0) return 0;
    if (s.Talk_DivertBroad !== 0) divert(s, line);
    s.host.alert?.('broadcast');
    return 1;
  }
  const notice = bbs.notices.find((n) => n.text !== '' && line.includes(n.text));
  if (notice) {
    if (notice.more !== 0) s.f_2258 = 1;
    return 1;
  }
  if (s.f_2258 !== 0) {
    s.f_2258 = 0;
    return 1;
  }
  if (line.includes('An Internet E-mail message from')) return 1;
  if (line.includes(' gossips:') || line.includes(' auctions:')) {
    if (s.inGame === 0) return 0;
    if (s.Talk_DivertGossip !== 0) divert(s, line);
    s.host.alert?.(line.includes(' gossips:') ? 'gossip' : 'auction');
    return 1;
  }
  if (line.includes(' gangpaths:')) {
    if (s.inGame === 0) return 0;
    if (offered(s, line, 8) !== 0) return 1;
    if (s.Talk_DivertGang !== 0) divert(s, line);
    s.host.alert?.('gangpath');
    return 1;
  }
  if (line.includes('The gods tell you:')) {
    if (s.inGame === 0) return 0;
    if (s.Talk_DivertTele !== 0) divert(s, line);
    if (line.includes('{==>') || line.includes('{##>')) return 1;
    s.host.alert?.('telepath');
    return 1;
  }
  if (line.includes(' telepaths:')) {
    if (s.inGame === 0 || s.line.attr[0] !== 2) return 0;
    if (offered(s, line, 0x10) !== 0) return 1;
    if (s.Talk_DivertTele !== 0) divert(s, line);
    if (line.includes('{==>') || line.includes('{##>')) return 1;
    s.host.alert?.('telepath');
    return 1;
  }
  if (line.includes(' is paging you')) {
    if (s.line.attr[0] === 7) return 0;
    if (offered(s, line, 0x20) !== 0) return 1;
    if (s.Talk_DivertTele !== 0) divert(s, line);
    s.host.alert?.('page');
    return 1;
  }
  if (
    line.includes(' says "') ||
    line.includes(' says (to ') ||
    line.includes(' yells "') ||
    line.includes(' yells from ') ||
    line.includes('(Yelling)')
  ) {
    if (s.inGame === 0 || s.line.attr[0] !== 2) return 0;
    if (['says "a ', 'says "attack ', 'says "bs ', 'says "bash '].some((p) => line.includes(p))) {
      return 1;
    }
    if (offered(s, line, 1) === 0) {
      s.host.alert?.('say');
      if (s.Talk_DivertLocal !== 0) divert(s, line);
    }
    return 1;
  }
  if (line.includes('You say "') || line.includes('You yell "')) return ownSpeech(s, line);
  return emote(s, line);
}
