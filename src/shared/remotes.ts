/**
 * The `@` commands other players' clients send to this one, and what may be
 * answered.
 *
 * MegaMUD gave every character a small remote-control vocabulary spoken over
 * the game's own chat channels: `/Soul @health` telepaths a question, and the
 * client on the other end answers `{HP=4434/4434,MA=516/516}` without its
 * player touching the keyboard. Sixty-odd of them are documented in MegaMUD's
 * manual. That manual is **not evidence**: it says what the commands mean and
 * says nothing about the bytes, and this project writes patterns from captures.
 *
 * ## What the captures actually show
 *
 * `captures/` holds 214 sessions of other people's play, and eleven of these
 * commands appear in them — with, between them, exactly **two** reply shapes:
 *
 * ```
 * Sackhunter telepaths:  @health          -> /Sackhunter {HP=600/600}
 * Syntax telepaths: @health               -> Syntax telepaths: {HP=4434/4434,MA=516/516}
 * /ses @do a ooz                          -> Sesub telepaths: {ok}
 * Jek telepaths: {ok}                     (the same, for @do eq crimson feather)
 * Vulcan says (to you) "{ok}"             (the same, on the directed channel)
 * Celyn telepaths: @wait (can't move)
 * Sirkilla says "@kill Gambit"
 * Halifax says "@party stat"
 * Swampfox says "@party go rift"
 * ```
 *
 * So `{HP=…}` and `{ok}` are the whole documented reply vocabulary. Every other
 * command in the manual — `@exp`, `@level`, `@where`, `@wealth`, `@settings`
 * and the rest — has **no captured answer**, and inventing one would put this
 * client's guess on another player's screen in a format their client would then
 * fail to read. Those are listed here as `unread`, with the reason, and are the
 * to-do in `todo-megamud-commands.md`.
 *
 * ## Two things are refused rather than unimplemented
 *
 * `@kill` asks this character to attack a **player**, and `@hangup` asks it to
 * disconnect. Both are refusals the client already makes for itself — auto
 * combat never swings at a person, and an unclean disconnect is how a character
 * dies on this server — and a chat message from somebody else is the last thing
 * that should be able to overrule either. They are answered with a refusal
 * rather than ignored, because a safety feature that silently declines is worse
 * than one never offered.
 *
 * Dependency-free, like everything in `shared/`.
 */

/** Every `@` command MegaMUD's manual names, in the manual's own order. */

export const REMOTE_NAMES = [
  'version',
  'health',
  'exp',
  'level',
  'status',
  'lives',
  'where',
  'path',
  'seen',
  'who',
  'what',
  'wealth',
  'enc',
  'have',
  'home',
  'invite',
  'join',
  'forget',
  'get-all',
  'drop-all',
  'equip-all',
  'deposit-all',
  'do',
  'goto',
  'loop',
  'looponce',
  'roam',
  'stop',
  'rego',
  'attack-last',
  'auto-all',
  'auto-combat',
  'auto-nuke',
  'auto-heal',
  'auto-bless',
  'auto-light',
  'auto-cash',
  'auto-get',
  'auto-sneak',
  'auto-hide',
  'auto-search',
  'settings',
  'reset',
  'divert',
  'hangup',
  'relog',
  'wait',
  'ok',
  'comeback',
  'heal',
  'blind',
  'diseased',
  'held',
  'party',
  'kill',
  'share',
  'panic!',
  /*
   * Not from MegaMUD's manual: mudengine's own peer extension, the one
   * addition to the vocabulary. A character whose blessing (cast by a party
   * member running this client) wears off telepaths `@bless-expired <spell>`
   * back to the caster, who can recast on the event instead of waiting out
   * a fallback clock. Acted on only through the same
   * per-player permission gate as every other actionable remote. One
   * spelling, deliberately — an alias would be a second permission switch
   * for the same command.
   */
  'bless-expired',
  /*
   * Also mudengine's own: the six attributes off the stat sheet, which no
   * MegaMUD remote answers (its manual has none, 2026-09-19). A MegaMUD asked
   * `@stats` answers `{command invalid or not allowed}`.
   */
  'stats',
  /*
   * The extended pair, and the reason there is such a thing as an extended
   * remote at all.
   *
   * MegaMUD's answers are **prose for a person**: `@where` comes back as
   * `{Town Gates (Exits: N,S)}`, which is the room's *name*, and 83.85% of the
   * realm's edges lead to a namesake (`sameRoomAgain`). So a client that is
   * asked to walk to a name is asked to guess, which is why `@goto` and
   * `@comeback` are `unread` here — an ambiguous room is refused rather than
   * guessed, everywhere in this client.
   *
   * Both ends of a conversation between two mudengine clients have the realm
   * database open, and the realm has an unambiguous address for every room:
   * `map/number`. These two carry that instead of the name, which dissolves the
   * ambiguity rather than working around it.
   *
   * **Only sent to a client that said it was this one.** `@version` answers
   * `{mudengine 0.6.5}`, that answer is kept against the player, and `ask`
   * upgrades the question only for somebody it has heard say so. A MegaMUD on
   * the other end answers `{command invalid or not allowed}` (captured
   * 2026-08-29, the `@seen` note below), which is a fact this client reads: the
   * player is recorded as not running it and the plain question goes instead.
   */
  'where-room',
  'comeback-room'
] as const;

export type RemoteName = (typeof REMOTE_NAMES)[number];

/**
 * The four standing refusals, by id. The sentences themselves are UI copy and
 * live in `locales/ui.en.yaml` under `automation.remotes.refusal.*`; `shared`
 * stays dependency-free, so this file carries only the id and the responder
 * looks the sentence up with its own `t`.
 */
export type RemoteRefusal = 'kill' | 'hangup' | 'relog' | 'panic';

/**
 * What can be said about one command is different for each kind of support, so
 * the kinds carry different fields — a spec that could hold a refusal id on an
 * answered command would be a state nothing should be able to represent.
 *
 * - `answered` / `acted` explain themselves by working.
 * - `refused` names which standing refusal answers it.
 * - `because` on `unread` is documentation carried as data — why no capture
 *   lets this client answer yet — asserted non-empty by `remotes.test.ts` so a
 *   command cannot be shrugged off without a written reason.
 */
export type RemoteSpec =
  | { name: RemoteName; support: 'answered' | 'acted' }
  | { name: RemoteName; support: 'refused'; refusal: RemoteRefusal }
  | { name: RemoteName; support: 'unread'; because: string };

/**
 * The table, and the **only** place support is stated.
 *
 * A closed union with its runtime list beside it, in the shape this codebase
 * keeps them: `REMOTE_NAMES` is the union's source and every name in it
 * has a row here, asserted by `src/shared/__tests__/remotes.test.ts`. A command
 * in one and not the other is a command the parser accepts and the responder
 * has nothing to say about.
 */
export const REMOTES: Readonly<Record<RemoteName, RemoteSpec>> = {
  health: {
    name: 'health',
    support: 'answered'
  },
  do: {
    name: 'do',
    support: 'answered'
  },
  join: { name: 'join', support: 'acted' },
  forget: {
    name: 'forget',
    support: 'acted'
  },
  'get-all': {
    name: 'get-all',
    support: 'acted'
  },
  party: {
    name: 'party',
    support: 'acted'
  },
  wait: {
    name: 'wait',
    support: 'acted'
  },
  ok: { name: 'ok', support: 'acted' },

  kill: {
    name: 'kill',
    support: 'refused',
    refusal: 'kill'
  },
  hangup: {
    name: 'hangup',
    support: 'refused',
    refusal: 'hangup'
  },
  relog: {
    name: 'relog',
    support: 'refused',
    refusal: 'relog'
  },
  'panic!': {
    name: 'panic!',
    support: 'refused',
    refusal: 'panic'
  },

  version: { name: 'version', support: 'answered' },
  exp: { name: 'exp', support: 'answered' },
  level: { name: 'level', support: 'answered' },
  status: { name: 'status', support: 'answered' },
  lives: { name: 'lives', support: 'answered' },
  where: { name: 'where', support: 'answered' },
  path: {
    name: 'path',
    support: 'unread',
    because: 'no capture shows the reply format, and a loop here is not a path file'
  },
  seen: {
    name: 'seen',
    support: 'unread',
    because:
      'MegaMUD 2.1 itself answers `{command invalid or not allowed}` (captured 2026-08-29), so ' +
      'there is no reply format to match; the registry knows where somebody was last seen, and ' +
      'what to say about it is a decision'
  },
  who: { name: 'who', support: 'answered' },
  what: { name: 'what', support: 'answered' },
  wealth: { name: 'wealth', support: 'answered' },
  enc: { name: 'enc', support: 'answered' },
  have: { name: 'have', support: 'answered' },
  home: {
    name: 'home',
    support: 'unread',
    because: 'it is an operator command; nothing here can answer it'
  },
  // Both of these read `it waits for the per-player gating this has none of
  // yet` until 2026-08-29. The gate arrived, so the exemption went: an
  // exemption is a claim with a date on it, and neither has anything else
  // left to settle -- each is one command the realm already answers, and
  // neither is answered back because no capture shows a reply for either.
  invite: { name: 'invite', support: 'acted' },
  'drop-all': { name: 'drop-all', support: 'acted' },
  'equip-all': {
    name: 'equip-all',
    support: 'unread',
    because:
      'the slot a listing has never named is not invented here, so "not already equipped" is a ' +
      'question this client cannot answer for every item'
  },
  'deposit-all': {
    name: 'deposit-all',
    support: 'unread',
    because: 'nothing here models a bank, and no capture shows the exchange'
  },
  goto: {
    name: 'goto',
    support: 'unread',
    because:
      'the walk itself is one `WorldGraph.route` away, but an ambiguous room name is refused ' +
      'here rather than guessed, and no capture shows how a refusal is reported back'
  },
  loop: {
    name: 'loop',
    support: 'unread',
    because: 'the same: startable, with no captured way to say the name matched nothing'
  },
  looponce: {
    name: 'looponce',
    support: 'unread',
    because: 'the runner has no one-lap mode, and no capture shows the reply'
  },
  roam: { name: 'roam', support: 'unread', because: 'no such mode' },
  stop: {
    name: 'stop',
    support: 'unread',
    because:
      'stopping a walk is one call, but no capture shows the acknowledgement and `@rego` below ' +
      'has to resume exactly what this stopped'
  },
  rego: {
    name: 'rego',
    support: 'unread',
    because: 'the other half of `@stop`'
  },
  'attack-last': {
    name: 'attack-last',
    support: 'unread',
    because: 'no such setting here'
  },
  'auto-all': {
    name: 'auto-all',
    support: 'unread',
    because: 'the settings do not map one for one, and no capture shows the reply'
  },
  'auto-combat': {
    name: 'auto-combat',
    support: 'unread',
    because: 'the setting exists (`automation.combat`) and no capture shows the reply'
  },
  'auto-nuke': {
    name: 'auto-nuke',
    support: 'unread',
    because: 'no such setting here'
  },
  'auto-heal': {
    name: 'auto-heal',
    support: 'unread',
    because: 'the setting exists (`automation.spells`) and no capture shows the reply'
  },
  'auto-bless': {
    name: 'auto-bless',
    support: 'unread',
    because: 'no such setting here'
  },
  'auto-light': {
    name: 'auto-light',
    support: 'unread',
    because: 'nothing here lights a torch unasked, on purpose'
  },
  'auto-cash': {
    name: 'auto-cash',
    support: 'unread',
    because: 'no such setting here'
  },
  'auto-get': {
    name: 'auto-get',
    support: 'unread',
    because: 'the setting exists (`automation.loot`) and no capture shows the reply'
  },
  'auto-sneak': {
    name: 'auto-sneak',
    support: 'unread',
    because: 'the setting exists (`automation.movement.sneak`) and no capture shows the reply'
  },
  'auto-hide': {
    name: 'auto-hide',
    support: 'unread',
    because: 'no such setting here'
  },
  'auto-search': {
    name: 'auto-search',
    support: 'unread',
    because: 'no such setting here'
  },
  settings: { name: 'settings', support: 'answered' },
  reset: {
    name: 'reset',
    support: 'unread',
    because: 'no capture shows the reply, and what would be reset is not the same set'
  },
  divert: {
    name: 'divert',
    support: 'unread',
    because:
      'nothing here forwards a channel, and what it would forward is a third party’s words — the ' +
      'one command in the table that leaks somebody who is not in the conversation'
  },
  comeback: {
    name: 'comeback',
    support: 'unread',
    because: 'nothing here retraces a walk, and no capture shows the exchange'
  },
  /*
   * Acted and never answered: the heal landing on the sender is the answer.
   * captures/081 has the whole exchange — `Death telepaths: @heal`, then the
   * MegaMUD at this end typing `mend death` — and MegaMUD's own manual says a
   * request is healed "when they are low **or** when they have requested aid".
   * So a request is one party heal whatever the listing's figure says, and
   * the engine decides it against this character's own settings.
   */
  heal: { name: 'heal', support: 'acted' },
  blind: {
    name: 'blind',
    support: 'unread',
    because: 'nothing here models blindness, and no capture shows a cure'
  },
  diseased: {
    name: 'diseased',
    support: 'unread',
    because: 'nothing here models disease, and no capture shows a cure'
  },
  held: {
    name: 'held',
    support: 'unread',
    because: 'nothing here models being held, and no capture shows a release'
  },
  share: {
    name: 'share',
    support: 'unread',
    because: 'nothing here splits money, and no capture shows the exchange'
  },
  // Acted and not answered, like `@join`: the recast the sender sees land on
  // them is the acknowledgement both clients can already read.
  'bless-expired': { name: 'bless-expired', support: 'acted' },
  // Answered in a frame this client chose, since there is no capture to copy.
  stats: { name: 'stats', support: 'answered' },
  /*
   * `@where` with the ambiguity taken out, and `@comeback` made possible by
   * the same fact. See the note beside them in `REMOTE_NAMES`.
   *
   * `comeback-room` is `acted` and **not** granted by anything shipped: it
   * walks this character across the realm on somebody else's word, which is
   * more authority than any other grant in the table carries. `where-room` is
   * `answered` and is granted wherever `where` is, by migration, because they
   * are the same question and the asker picks the wording.
   */
  'where-room': { name: 'where-room', support: 'answered' },
  'comeback-room': { name: 'comeback-room', support: 'acted' }
};

/**
 * What another client said back.
 *
 * Two shapes, both captured, both wrapped in braces so neither can be confused
 * with somebody talking:
 *
 * - `{HP=600/600}` and `{HP=4434/4434,MA=516/516}` — the answer to `@health`.
 *   The mana half is **optional**, for the same reason it is optional in the
 *   status line and the party roster: a warrior has none, and one sample would
 *   have produced a pattern that silently never matched a caster.
 * - `{ok}` — the acknowledgement `@do` and its like return.
 */
export type RemoteReply =
  | {
      kind: 'vitals';
      hp: number;
      hpMax: number;
      mana: number | null;
      manaMax: number | null;
    }
  | { kind: 'ok' }
  /**
   * `{mudengine 0.6.5}` — the answer to `@version`, in the shape MegaMUD's own
   * (`{MegaMMUD 2.1}`) gave. A client name and a version, nothing else.
   */
  | { kind: 'version'; client: string; version: string }
  /**
   * `{1/2150 Town Gates}` — the answer to `@where-room`: the realm's own
   * address for a room, and its name behind it because a number names nothing.
   * The name is optional; the address is not.
   */
  | { kind: 'room'; map: number; number: number; name: string | null }
  /**
   * `{command invalid or not allowed}` — what MegaMUD 2.1 answers a word it has
   * no entry for (captured 2026-08-29, `captures/215`, answering `@seen`). It
   * is the one reply in the vocabulary that is a statement about the *question*
   * rather than the character, and it is what tells this client that an
   * extended remote reached a client that is not this one.
   */
  | { kind: 'refused' };

const VITALS =
  /^\{\s*(?:HP|H)\s*=\s*(?<hp>\d+)\s*\/\s*(?<hpMax>\d+)(?:\s*,\s*(?:MA|KAI|M|K)\s*=\s*(?<mana>\d+)\s*\/\s*(?<manaMax>\d+))?\s*\}$/i;

/**
 * `{1/2150 Town Gates}`, and `{1/2150}` for a room nothing has named.
 *
 * The address leads, and it leads because it is the half another client parses:
 * a name can hold digits, a slash and a space, and a reader that had to find
 * the address inside it would be guessing again.
 */
const ROOM_ADDRESS = /^\{\s*(?<map>\d+)\s*\/\s*(?<number>\d+)\s*(?<name>[^}]*?)\s*\}$/;
/**
 * `{mudengine 0.6.5}`. Two words: a client name, and a version beginning with a
 * digit.
 *
 * Deliberately tight, because this runs over every brace-wrapped thing anybody
 * says. `{No one}`, `{Nothing}`, `{ok}` and `{yes: 1}` are all refused by it,
 * and so is every `@where` answer, which is either a bare room name or carries
 * `(Exits: …)`. A room genuinely called `Level 3` would fit — which is the
 * other reason the caller reads this only for a `@version` it asked.
 */
const VERSION = /^\{\s*(?<client>[A-Za-z][\w.+-]*)\s+(?<version>\d[\w.+-]*)\s*\}$/;
/** MegaMUD 2.1's answer to a word it has no entry for. Captured, verbatim. */
const REFUSED = /^\{\s*command invalid or not allowed\s*\}$/i;

export function parseRemoteReply(message: string): RemoteReply | null {
  const text = message.trim();
  if (/^\{\s*ok\s*\}$/i.test(text)) return { kind: 'ok' };
  if (REFUSED.test(text)) return { kind: 'refused' };
  const room = ROOM_ADDRESS.exec(text);
  if (room?.groups) {
    const name = room.groups['name'] ?? '';
    return {
      kind: 'room',
      map: Number(room.groups['map']),
      number: Number(room.groups['number']),
      name: name.length === 0 ? null : name
    };
  }
  const version = VERSION.exec(text);
  if (version?.groups) {
    return {
      kind: 'version',
      client: version.groups['client']!,
      version: version.groups['version']!
    };
  }
  const match = VITALS.exec(text);
  if (!match?.groups) return null;
  const mana = match.groups['mana'];
  const manaMax = match.groups['manaMax'];
  return {
    kind: 'vitals',
    hp: Number(match.groups['hp']),
    hpMax: Number(match.groups['hpMax']),
    mana: mana === undefined ? null : Number(mana),
    manaMax: manaMax === undefined ? null : Number(manaMax)
  };
}

/**
 * The standing decision about one remote for one player, as a form states it.
 *
 * `allow` and `deny` are what somebody clicked. `unset` is the absence of a
 * decision and is not a third thing anybody configures — it is what every pair
 * starts as, and what falls through to the gang list.
 *
 * **The one place the union is spelled.** The flyout's three buttons, the IPC
 * payload, the editor that writes it and the handler that validates it all read
 * `RemoteStance` from here — the alternative was the same three string literals
 * written out in five files, each type-checking on its own while the
 * hand-rolled validator in main silently refused a fourth.
 */
export const REMOTE_STANCES = ['allow', 'deny', 'unset'] as const;

export type RemoteStance = (typeof REMOTE_STANCES)[number];

/** Whether a value off the wire or out of a form is a remote this client knows. */
export function isRemoteName(value: unknown): value is RemoteName {
  return typeof value === 'string' && (REMOTE_NAMES as readonly string[]).includes(value);
}

/**
 * Which remotes one player may use, and on what grounds.
 *
 * ## Why the grounds are gone
 *
 * There were three of them until 2026-08-29 — `named`, `party`, `gang` — and a
 * ground was a reason somebody was allowed **everything**. That is the shape
 * this replaced, and the reason is that the two questions people actually ask
 * are per command:
 *
 * - *"my gang may ask where I am; nobody may run a command on me"* was
 *   inexpressible. `gang` granted `@do` along with `@where`.
 * - *"everybody in the gang except Rend"* was inexpressible too, because a
 *   ground had no per-person exception and a block was all-or-nothing.
 *
 * So permission is now stated **per remote, per player**, with two lists behind
 * it — one for the gang, one for the party.
 *
 * ## The party is a list, and it was never a ground
 *
 * `PARTY` was a *ground* until 2026-08-29 and was dropped, because a ground
 * allowed somebody **everything** and a party is a group anybody can invite
 * anybody into: it was a permission anybody could grant themselves by sending
 * an invitation. It comes back (2026-09-02) as a **list**, which is a different
 * object and answers that objection rather than ignoring it:
 *
 * - It grants named commands and never all of them, and the shipped default is
 *   **three**: `@health` and `@bless-expired`, both facts about this character's
 *   own body that the party listing already states more coarsely, and neither
 *   of which does anything to it; and `@heal`, one party heal on request —
 *   nothing while `spells.healParty` is off, and one cast per heal cooldown
 *   above the mana floor while it is on. Four more were on that list and came off on
 *   review — `RemotesConfig.party` has each one's reason, and the short
 *   version is that `@where` and `@status` say *where to find me* and `@wait`
 *   stops the character's lap with no deadline.
 * - It is gated on having **joined**, not on having been invited. An offer
 *   nobody accepted is not membership, which is half the hole the ground had.
 *   The other half is open and is written down rather than glossed: on this
 *   realm following somebody is how a party is joined, and whether the server
 *   honours an uninvited `follow` has never been asked of the wire
 *   (`npm run probe:party`). That is why the default is two facts about this
 *   character's own body and one heal bounded by the heal's own limits,
 *   rather than a membership test anybody can pass.
 * - `deny` on a player still beats it, so *"the party, except Rend"* is
 *   expressible where it was not on a ground.
 *
 * Anybody widening it past that is doing so by name, on a screen that says
 * whose typing it lets move this character.
 *
 * ## Three places a grant can come from, and one that outranks them all
 *
 * For one sender and one remote, in this order:
 *
 * 1. **`deny` on that player** — refused, whatever else says otherwise. This is
 *    what makes "the gang, except Rend" expressible, and it is checked first
 *    and unconditionally for the same reason the old block list was: a
 *    permission somebody else can hand out must not be able to lift it.
 * 2. **`allow` on that player** — allowed, whether or not they are in the gang.
 * 3. **the gang list**, if the asker is in this character's gang.
 * 4. **the party list**, if the asker has joined this character's party.
 *
 * The gang is read before the party only so a verdict names the standing
 * relationship rather than the transient one; both grant, and neither can
 * lift a `deny`.
 *
 * Anything else is refused. **Everything is off until somebody says otherwise**
 * — an absent player is an empty grant, and an empty list grants nothing —
 * which is the only honest default for a channel whose whole risk is who is on
 * the other end.
 *
 * ## The gang list is one list, and it is about *this character's* gang
 *
 * Not a map keyed by gang name. A character is in one gang at a time and the
 * card that edits this shows that gang, so a second key would be a distinction
 * the surface cannot make. The consequence is stated rather than hidden: a
 * character that **leaves Valor and joins Doom hands Doom the same list**, so
 * the Gang card names the gang the list currently applies to on every draw, and
 * every notice about one says the gang out loud.
 *
 * A member who leaves loses the grant the moment the roster says so, because
 * nothing is copied onto them: membership is evaluated per command from
 * `RemoteEvidence`, so "they are no longer in the gang" and "they no longer
 * have the gang's remotes" are the same fact rather than two that can drift.
 *
 * ## What says who is in a gang
 *
 * **A gangpath does not establish that its sender is in this gang**, which is
 * the tempting shortcut and is wrong twice over:
 *
 * - This character's *own* outgoing gangpath comes back as a third-person line
 *   naming itself — `bg crit` -> `Kaverin gangpaths: crit`, captures/068 — so
 *   the channel does not even establish that the speaker is somebody else.
 * - An admin ghosting a gangpath produces a line the pattern's own non-capturing
 *   prefix makes byte-identical to a real one downstream (`patterns.ts`, and
 *   docs/greatermud/communication.md for the prefix; not observed on the wire).
 *
 * There is also **no gang roster command**: `Broadgang` (`bg`, `gb`) is the only
 * gang verb in the server's own command table, confirmed against
 * docs/greatermud/commands.md and `src/shared/commands.ts`.
 *
 * What there *is*, and what is read (2026-08-28): a `who` row names a gang
 * behind its title — `Squire  of EyeExploredDora`, behind a double space —
 * and a `look <player>` answers `[ Nester TheDupe ] (Old Guard)`; 13 corpus
 * files across 15 gangs, and the two agree where both appear. Both land on
 * the realm roster (`Adventurer.gang`), and **this character's own row is on
 * that roster too**, which is what makes a comparison possible without a
 * self-`look`. `remoteVerdict` compares the two rows.
 *
 * The gang list therefore grants only when both rows have named the same gang,
 * and evaluates to *unresolved* while either is unknown — never to a grant. The
 * project's standing rule applied to a permission: **unknown is never the
 * reassuring answer**, and here the reassuring answer is the one that lets a
 * stranger through. A refusal says the ground was unresolved so somebody who
 * configured the gang list is told what would settle it.
 *
 * What one player may and may not ask for.
 *
 * Two lists rather than a map from remote to stance, because that is the shape
 * a person reads in their own options file: *"Soul may ask these, and may never
 * ask those"*. `unset` is simply absence from both, which is why it needs no
 * spelling on disk — and a name in both lists is resolved by `deny` winning,
 * the same precedence the old block list had.
 */
export interface RemoteGrant {
  allow: RemoteName[];
  deny: RemoteName[];
}

/** An empty grant: the state every name starts in, and the one nothing is allowed by. */
export const NO_GRANT: RemoteGrant = { allow: [], deny: [] };

/**
 * One named player's entry: the `allow`/`deny` grant, plus **Auto Invite when
 * seen**, MegaMUD's per-player *Invite To Party If Seen* (the Players dialog).
 * It answers no request, so it is not a `RemoteName` and sits beside the two
 * lists rather than in them.
 */
export interface PlayerGrant extends RemoteGrant {
  /**
   * Written only when on: anything but `true` reads as off, so a file carries
   * only what somebody turned on, and a grant written before this existed is
   * unchanged.
   */
  autoInviteWhenSeen?: boolean;
}

/**
 * A command of the player's own that other players may ask this character
 * for (2026-10-15): `@heal` answered with `mend {source}`, say, for a
 * healer that is not in the asker's party. MegaMUD has none; its Messages
 * rows can answer a telepath, but they are the realm's, every character on
 * it answers, and anybody may ask.
 *
 * Answered after MegaMUD's own remote commands, so a word of theirs keeps its
 * meaning, and only to who is named here: the party, the gang, named players,
 * or anyone, each chosen.
 */
export interface BotCommand {
  /** What is asked, as said: `@heal`. Matched whole, case aside. */
  word: string;
  /** What to send, in MegaMUD's macros: `{source}` is the asker, `^M` Enter, `~` a pause. */
  send: string;
  /** What to answer the asker with, the same way; empty for nothing. */
  reply: string;
  /** Anybody who has joined this character's party. */
  party: boolean;
  /** Anybody in this character's gang. */
  gang: boolean;
  /** Anybody at all, chosen in so many words. */
  anyone: boolean;
  /** These players, by name. */
  players: string[];
}

/** One bot command off a file or the wire, or null; nothing coerced but the case of names. */
export function asBotCommand(value: unknown): BotCommand | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const word = text(raw['word']).split(/\s+/)[0] ?? '';
  const send = text(raw['send']);
  if (word === '' || send === '') return null;
  const players = Array.isArray(raw['players'])
    ? [
        ...new Set(
          raw['players']
            .filter((p): p is string => typeof p === 'string')
            .map((p) => p.trim().toLowerCase())
            .filter((p) => p !== '')
        )
      ]
    : [];
  return {
    word: word.startsWith('@') ? word : `@${word}`,
    send,
    reply: text(raw['reply']),
    party: raw['party'] === true,
    gang: raw['gang'] === true,
    anyone: raw['anyone'] === true,
    players
  };
}

/** A list of bot commands, the unreadable rows dropped. */
export function asBotCommands(value: unknown): BotCommand[] {
  if (!Array.isArray(value)) return [];
  return value.map(asBotCommand).filter((c): c is BotCommand => c !== null);
}

/**
 * How access is configured, mirrored from `RemotesConfig` so this module stays
 * dependency-free and the decision can be tested against a literal.
 */
export interface RemoteAccess {
  /** Remotes anybody in this character's gang may use. */
  gang: readonly RemoteName[];
  /** Remotes anybody who has **joined this character's party** may use. */
  party: readonly RemoteName[];
  /** Per player, keyed by the **lower-cased** name, like `PlayerRegistry`. */
  players: Readonly<Record<string, PlayerGrant>>;
}

/**
 * What is known about the asker at the moment they asked.
 *
 * Passed in rather than looked up so the decision below is pure: the same
 * inputs give the same verdict, which is what makes it testable without a
 * session, a socket or a tracker.
 *
 * `inGang` is `null` rather than `false` for the reason the whole codebase
 * distinguishes null from zero — an unknown membership is *absence*, and a
 * `false` here is the client claiming to know somebody is not in its gang.
 * The evidence is `false` only when both this character's row
 * and the asker's were written in full by a listing and name different gangs
 * (or none); anything less said is `null`.
 */
export interface RemoteEvidence {
  /** In this character's gang, or `null` while nothing has said. See the note above. */
  inGang: boolean | null;
  /**
   * On this character's party listing, having **joined** it.
   *
   * Two states rather than three, and the asymmetry with `inGang` is the
   * point: a gang is learned from a `who` row that may never have been read,
   * so *nobody has said* is a real state there. The party roster is this
   * client's own maintained listing — `party` establishes it and the server's
   * own `joins`/`leaves` sentences keep it true — so a name that is not on it
   * is a name that is not in the party, which is a fact rather than a gap.
   *
   * An outstanding invitation is **not** membership: `invited` is an offer
   * nobody has accepted, and treating it as a grant would let anybody hand
   * themselves this character's party remotes by typing `invite`.
   */
  inParty: boolean;
}

/**
 * What the access rules said, and why.
 *
 * The *why* is not decoration. A refusal that says only "no" leaves somebody
 * unable to tell a deny from an unconfigured client from a gang that could not
 * be evaluated, and those need three different actions from them. Every branch
 * below therefore names its ground, and the refusal says it out loud.
 */
export type RemoteVerdict =
  | { allowed: true; because: 'player' | 'gang' | 'party' }
  | { allowed: false; because: 'denied' }
  | {
      allowed: false;
      because: 'not-granted';
      /**
       * True when the gang list carries this remote and nothing has yet said
       * whether the asker shares this character's gang — so the refusal can
       * name what would settle it instead of reading as "you are a stranger".
       */
      gangUnresolved: boolean;
      /**
       * True when the party list carries this remote and the asker is not on
       * the party listing — so the refusal says *you are not in my party*
       * rather than *you are a stranger*, which are two different things to
       * somebody who was in it a minute ago.
       */
      notInParty: boolean;
    };

/** The grant a name is filed under, or an empty one. Case-insensitive, like the registry. */
export function grantFor(access: RemoteAccess, from: string): PlayerGrant {
  return access.players[from.trim().toLowerCase()] ?? NO_GRANT;
}

/** Names are compared case-insensitively: the server is inconsistent about case. */
function has(list: readonly RemoteName[], name: RemoteName): boolean {
  return list.includes(name);
}

/**
 * May this player use this remote?
 *
 * Pure, and the single place the question is answered; its callers do not
 * re-derive any part of it, so the flyout showing somebody as allowed
 * and the engine answering them cannot disagree.
 *
 * The order is load-bearing and is asserted by the tests: deny beats
 * everything, then the player's own allow, then the gang. **There is no ground
 * meaning "everybody"**, and the absence is deliberate: it is not a reason, it
 * is the absence of a gate.
 */
export function judgeRemote(
  from: string,
  name: RemoteName,
  access: RemoteAccess,
  evidence: RemoteEvidence
): RemoteVerdict {
  const grant = grantFor(access, from);

  // First and unconditionally. A deny is about one person, by name, on purpose.
  if (has(grant.deny, name)) return { allowed: false, because: 'denied' };
  if (has(grant.allow, name)) return { allowed: true, because: 'player' };

  const fromGang = has(access.gang, name);
  if (fromGang && evidence.inGang === true) return { allowed: true, because: 'gang' };

  const fromParty = has(access.party, name);
  if (fromParty && evidence.inParty) return { allowed: true, because: 'party' };

  return {
    allowed: false,
    because: 'not-granted',
    gangUnresolved: fromGang && evidence.inGang === null,
    notInParty: fromParty && !evidence.inParty
  };
}

/**
 * Whether this client could ever answer a remote, whatever the permissions say.
 *
 * `refused` and `unread` never round-trip — the first is a standing refusal
 * this client makes on its own account and the second has no captured reply
 * format — so granting one buys nothing. The settings surfaces show all
 * {@link REMOTE_NAMES} and make only these toggleable, and "allow all" means
 * all of these: a permission that cannot take effect is one somebody sets and
 * waits to see work.
 */
export function isActionable(name: RemoteName): boolean {
  const support = REMOTES[name].support;
  return support === 'answered' || support === 'acted';
}

/** Every remote a grant may usefully carry, in the vocabulary's own order. */
export const ACTIONABLE_REMOTES: readonly RemoteName[] = REMOTE_NAMES.filter(isActionable);
