/**
 * The bits of MegaMUD's flag words, by name. Each is as `megamud.exe` sets and
 * tests it (`mm.py field <offset>`); a bit whose purpose is only inferred is
 * named `Probably…`, and one not understood `Unknown_<bit>`. Read 2026-10-16.
 */

/** `0xd904` (`lineFlags`): what the reader has seen of the realm's output. */
export const LineFlag = {
  /** A prompt has been seen since the last command, and the output has settled. */
  Prompted: 0x1,
  /**
   * A prompt was cut off the buffer and the line has not settled yet (set by
   * the status-line reader `0x47b070`, traded for `Prompted` when it settles).
   */
  PromptUnsettled: 0x2,
  /** A door's lock answered an open (`is locked`, `is now open`). Nothing reads it. */
  DoorAnswered: 0x4,
  /** An `Also here:` listing was read for this room: keep its creatures (`0x4746dc`). */
  CreaturesListed: 0x8,
  /** A `You notice` listing was read for this room: keep its items. */
  ItemsListed: 0x10,
  /** A line of the fight (a blow, a cast's message) was read. Nothing reads it. */
  FightLineSeen: 0x20,
  /** A `top` listing is being read. */
  TopListing: 0x40,
  /** A `who` listing in its first form (titles) is being read. */
  WhoTitled: 0x80,
  /** A `who` listing in its second form is being read. */
  WhoPlain: 0x100,
  /** A `who` listing has had a row. */
  WhoRowSeen: 0x200,
  /** The inventory listing's items are being read. */
  InventoryItems: 0x400,
  /** The inventory listing's keys are being read. */
  InventoryKeys: 0x800,
  /** The inventory listing's totals are being read. */
  InventoryTotals: 0x1000,
  /** A `par` listing is being read (`0x47ec60`). */
  PartyListing: 0x2000,
  /** A looked-at player's description has had a line. */
  LookDescribed: 0x4000,
  /** A looked-at player's `is equipped with:` list is being read (`0x48a87b`). */
  LookEquipment: 0x8000,
  /** `Obvious exits:` wrapped onto the next line. */
  ExitsContinue: 0x10000,
  /** `Also here:` wrapped onto the next line (rest kept in `0xd910`). */
  AlsoHereContinue: 0x20000,
  /** `You notice` wrapped onto the next line (rest kept in `0xd910`). */
  NoticeContinue: 0x40000,
  /** A player is being looked at, the one `roomSelected` names. */
  Looking: 0x80000,
  /** A purchase's coins (`You bought … for`) wrapped onto the next line (`0x453cc3`). */
  BuyCoinsContinue: 0x100000,
  /** A sale's coins (`You sold … for`) wrapped onto the next line (`0x455ef0`). */
  SellCoinsContinue: 0x200000,
  /** The spellbook listing is being read (`0x4a2d66`). */
  SpellbookListing: 0x400000
} as const;

/** The bits that say a `who` listing is being read. */
export const WHO_LISTING = LineFlag.WhoTitled | LineFlag.WhoPlain | LineFlag.WhoRowSeen;
/** The bits that say the inventory listing is being read. */
export const INVENTORY_LISTING =
  LineFlag.InventoryItems | LineFlag.InventoryKeys | LineFlag.InventoryTotals;
/** Both prompt bits. */
export const PROMPT_SEEN = LineFlag.Prompted | LineFlag.PromptUnsettled;

/**
 * A party member's flags (`+0x28`, `PartyMember.flags28`), as the party
 * listing (`0x47ec60`), the remote commands and the heal and rest steps set
 * and test them.
 */
export const PartyFlag = {
  /** Its HP and mana are not known: asked `@health` on the next round, or its report was unreadable. */
  HealthUnknown: 0x1,
  /** Hit or healed since the last `par` listing, so its figures are stale: list the party again. */
  ChangedSinceListing: 0x2,
  /** Invited, and not yet in a listing. */
  Invited: 0x4,
  /** Not in the latest listing (or listed as `[Invited]`): not with the party. */
  Unlisted: 0x8,
  /** Missed one listing already; dropped on the next. */
  MissedListing: 0x10,
  /** Asked the party to wait (`@wait`). */
  AskedToWait: 0x20,
  /** Due the minor party heal (`Party.PartyHeal1`). */
  MinorHealDue: 0x40,
  /** Not online (not on the `who` list). */
  Offline: 0x80,
  /** Left behind: asked the leader to come back for it (`@comeback`). */
  LeftBehind: 0x100,
  /** Sent `@join` to join the party. */
  JoinAsked: 0x200,
  /** Poisoned (a `P` after its health in the listing). */
  Poisoned: 0x1000,
  /** Said it is diseased (`@diseased`). */
  Diseased: 0x2000,
  /** Said it is blind (`@blind`). */
  Blind: 0x4000,
  /** Said it cannot move (`@held`). */
  Held: 0x8000,
  /** Due the main party heal (`Party.PartyHeal2`). */
  MainHealDue: 0x10000,
  /** Asked to be healed (`@heal`, `!help`, an `@wait` for HP); cleared once it is above 98%. */
  AskedForHeal: 0x20000
} as const;

/**
 * A creature, player or item in the room (`RoomEntity.flags`, `+0x3c`). The
 * immunities are MegaMUD's own words for them (`0x4269e0`'s report).
 */
export const EntityFlag = {
  /** Seen in the latest listing, so kept when the room's list is redone. */
  Kept: 0x1,
  /** A shadowy figure: a player whose name is hidden. */
  Shadowy: 0x2,
  /** Not yet seen again in the `Also here:` listing being read. */
  NotRelisted: 0x4,
  /** Charmed (`(charmed)` after its name). */
  Charmed: 0x8,
  /** Fought: hostile, whatever its record says. */
  Fought: 0x10,
  /** `PvP.PvpSpell1` has been cast at this player. */
  PvpSpell1Cast: 0x20,
  /** `PvP.PvpSpell2` has been cast at this player. */
  PvpSpell2Cast: 0x40,
  /** Immune to the main drain (`OffHealMaj`). */
  ImmuneMainDrain: 0x80,
  /** Immune to the minor drain (`OffHealMin`). */
  ImmuneMinorDrain: 0x100,
  /** Immune to the normal weapon (`WeapNorm`). */
  ImmuneNormalWeapon: 0x200,
  /** Immune to the alternate weapon (`WeapAlt`). */
  ImmuneAltWeapon: 0x400,
  /** Immune to the pre-attack spell (`CastPre`). */
  ImmunePreCast: 0x800,
  /** Immune to the main attack spell (`CastMain`). */
  ImmuneMainCast: 0x1000,
  /** Immune to the second attack spell (`CastAux`). */
  ImmuneAuxCast: 0x2000,
  /** Immune to the backstab weapon (`WeapBS`). */
  ImmuneBackstabWeapon: 0x4000,
  /** A corpse. */
  Corpse: 0x8000,
  /** A lootbox. */
  Lootbox: 0x10000,
  /** Perhaps immune to the normal weapon: one miss so far (`WeapNormX`). */
  MaybeImmuneNormalWeapon: 0x20000,
  /** Perhaps immune to the alternate weapon (`WeapAltX`). */
  MaybeImmuneAltWeapon: 0x40000,
  /** Perhaps immune to the backstab weapon (`WeapBSX`). */
  MaybeImmuneBackstabWeapon: 0x80000
} as const;

/**
 * An item's record (`Items.md`, `+0x5c`): the Game Item Details dialog's
 * options (`MegaRes.dll` dialog 316, set at `0x457433`…), then MegaMUD's own.
 */
export const ItemFlag = {
  /** Added by MegaMUD itself, not edited: it may mark it un-gettable. */
  AutoLearned: 0x1,
  /** Auto-collect. */
  Collect: 0x2,
  /** Auto-buy. */
  Buy: 0x4,
  /** Auto-sell (or stash). */
  Sell: 0x8,
  /** Auto-equip. */
  Equip: 0x10,
  /** Auto-find. */
  Find: 0x20,
  /** Cannot be taken. */
  CannotTake: 0x40,
  /** Can use to backstab. */
  Backstab: 0x200,
  /** Must have minimum. */
  MustHaveMin: 0x400,
  /** Auto-discard. */
  Discard: 0x800,
  /** Auto-open (a container). */
  Open: 0x1000,
  /** Loyal item. */
  Loyal: 0x20000,
  /** Needed for the path being walked. */
  NeededForPath: 0x1000000,
  /** Picked up for the path being walked. */
  PickedUpForPath: 0x2000000,
  /** The shop is out of it for now. */
  OutOfStock: 0x4000000,
  /** A coin. */
  Coin: 0x8000000,
  /** Changed in play: saved (`0x43bfa0`). */
  Changed: 0x40000000,
  /** Deleted: not saved. */
  Deleted: 0x80000000
} as const;

/**
 * A monster's record (`Monsters.md`, `+0x24`): the Monster/NPC Details
 * dialog's options (dialog 324, set at `0x46d793`…), then MegaMUD's own.
 */
export const MonsterFlag = {
  /** Added by MegaMUD itself: one it cannot fight becomes a non-enemy (`0x426940`). */
  AutoLearned: 0x2,
  /** Find first (its name holds a shorter monster's). */
  FindFirst: 0x8,
  /** Attack priority Last. */
  PriorityLast: 0x10,
  /** Attack priority Low. */
  PriorityLow: 0x20,
  /** Attack priority High. */
  PriorityHigh: 0x40,
  /** Attack priority First. */
  PriorityFirst: 0x80,
  /** Don't backstab. */
  DontBackstab: 0x100,
  /** Not hostile. */
  NotHostile: 0x200,
  /** Check if alive. */
  CheckIfAlive: 0x400,
  /** Stop to kill if able. */
  StopToKill: 0x800,
  /** Changed in play: saved (`0x43bfa0`). */
  Changed: 0x40000000,
  /** Deleted: not saved. */
  Deleted: 0x80000000
} as const;

/** The attack priority bits; none of them is Normal. */
export const MONSTER_PRIORITY =
  MonsterFlag.PriorityLast |
  MonsterFlag.PriorityLow |
  MonsterFlag.PriorityHigh |
  MonsterFlag.PriorityFirst;

/** A spell's record (`Spells.md`, `+0x54`): the Spell Details dialog (343, `0x4a435a`…), then MegaMUD's own. */
export const SpellFlag = {
  /** Timed duration: it lasts, so it can be a blessing, and its count is spent on one message. */
  Timed: 0x2,
  /** Evil in combat. */
  EvilInCombat: 0x4,
  /** Not on the Spell Details dialog; set in shipped records (necropotence). Nothing tests it. */
  Unknown_8: 0x8,
  /** Targets: self. */
  Self: 0x10,
  /** Targets: a player. */
  Player: 0x20,
  /** Targets: a monster. */
  Monster: 0x40,
  /** Targets: the area (no target named). */
  Area: 0x80,
  /** In the spellbook (`spells`), as last listed. */
  Known: 0x1000
} as const;

/** A player's record (`Players.md`, `+0x54`): the Player Details dialog (332, `0x492368`…), then MegaMUD's own. */
export const PlayerFlag = {
  /** Its race and class are not known yet. */
  DetailsUnknown: 0x1,
  /** Its level is a guess. */
  LevelGuessed: 0x2,
  /** Known to be a player (seen on `who`, or its details saved): never taken for a monster. */
  ConfirmedPlayer: 0x4,
  /** Doesn't use MegaMMUD: not asked `@health`. */
  NoMegaMud: 0x8,
  /** Invite to party if seen. */
  InviteIfSeen: 0x10,
  /** Join party if invited. */
  JoinIfInvited: 0x20,
  /** Chase player if seen. */
  ChaseIfSeen: 0x40,
  /** Play alert when player enters. */
  AlertOnEnter: 0x80,
  /**
   * PROBABLY an older "don't heal or bless": the dialog shows Don't Heal and
   * Don't Bless ticked for it and saves neither back to it (`0x4923ed`).
   */
  ProbablyDontHealOrBless: 0x100,
  /** Don't auto-delete this character. */
  KeepAlways: 0x200,
  /** Don't look. */
  DontLook: 0x400,
  /** Don't Heal. */
  DontHeal: 0x800,
  /** Don't Bless. */
  DontBless: 0x1000,
  /** Don't Cure. */
  DontCure: 0x2000,
  /** Attacked this character outside an arena (`0x42b8f0`); the player list says `Attacked!` (`0x49e850`). */
  AttackedUs: 0x4000,
  /** Seen this session (counted once). */
  SeenThisSession: 0x8000,
  /** Looked at, its build read; looked at again after a day. */
  LookedAt: 0x20000,
  /** Listed by `who` this session. Nothing reads it. */
  OnWhoList: 0x10000000
} as const;

/** A player's allowed remote control (`Players.md`, `+0x6c`, `PlayerRec.remote`): the Player Details dialog. */
export const RemoteFlag = {
  QueryVersion: 0x1,
  QueryExperience: 0x2,
  QueryHealth: 0x4,
  /**
   * Not on the Player Details dialog. Granted with `QueryHealth` to party
   * members and the leader followed; nothing in the port tests it.
   */
  Unknown_8: 0x8,
  QueryLocation: 0x10,
  QueryInventory: 0x20,
  RequestInvite: 0x40,
  MovePlayer: 0x100,
  ExecuteCommands: 0x200,
  Hangup: 0x400,
  AlterSettings: 0x800,
  DivertConversations: 0x1000,
  SysopCommands: 0x2000
} as const;

/** Every remote control (the dialog's All). */
export const REMOTE_ALL = 0xffff;

/** A message row's effects (`Messages.md`, `+0x114`): the Game Message Details dialog (322, `0x468b19`…). */
export const MessageEffect = {
  Blinded: 0x1,
  Confused: 0x2,
  Poisoned: 0x4,
  /** Losing HP's (on fire, etc). */
  LosingHp: 0x8,
  MovementPrevented: 0x10,
  AttackPrevented: 0x20,
  Diseased: 0x40,
  HpRegen: 0x80,
  /** Find in conversations (`0x468730`, the early pass of `0x46a920`). */
  InConversations: 0x100,
  ManaRegen: 0x200,
  /** Find anywhere in text. */
  Anywhere: 0x400,
  EndsCombat: 0x1000,
  LastActionFailed: 0x2000,
  /** Use when chasing. */
  WhenChasing: 0x4000,
  /** Disabled (don't use). */
  Disabled: 0x8000
} as const;

/** A message row's own state (`Messages.md`, `+0x116`): MegaMUD's, not the dialog's. */
export const MessageFlag = {
  /** Its effect is on. */
  Active: 0x1,
  /** Rested on. */
  RestedOn: 0x2,
  /** Its start line has fields (`%s`). */
  StartHasFields: 0x4,
  /** Its end line has fields. */
  EndHasFields: 0x8
} as const;

/** One carried item's line (`Carried.flags`, `+0x04`). */
export const CarriedFlag = {
  Equipped: 0x1,
  /** Asked to be equipped (`0x4bc340`, Equip All). */
  EquipAsked: 0x200
} as const;

/** A path step's flags (`PathStep.flags`, `+0x04`): the Path Steps dialog (330, `0x4880ab`…), then MegaMUD's own. */
export const StepFlag = {
  DarkRoom: 0x1,
  RestUpHere: 0x2,
  DontRestHere: 0x4,
  PitchBlack: 0x8,
  StashPoint: 0x10,
  /** Don't attack here (the selected step). */
  DontAttackHere: 0x20,
  /** Don't attack here (the next step; deprecated). */
  DontAttackNext: 0x40,
  ReLearnRoom: 0x80,
  /** Its room's signature is uncertain. */
  RoomUncertain: 0x100,
  DisarmTrap: 0x200,
  PickLock: 0x400,
  /** Resynced to. */
  Resynced: 0x8000
} as const;

/** A room's record (`Rooms.md`, `+0x48`): the Room Details dialog (339, `0x499129`…). */
export const RoomFlag = {
  Shop: 0x2,
  Bank: 0x4,
  Trainer: 0x8,
  StopBeforeEntering: 0x10,
  /** Avoid this room (if possible). */
  Avoid: 0x20,
  HideInGotoList: 0x40,
  /** Always in common rooms popup. */
  CommonRoom: 0x80
} as const;

/** `0x43fd90`'s answer (`RouteFound.flags`); 0 is found. */
export const RouteFlag = {
  NoWay: 0x1,
  LevelTooLow: 0x2,
  LevelTooHigh: 0x4,
  ShortOfGold: 0x8,
  ItemNeeded: 0x10,
  Cancelled: 0x20
} as const;

/** When an ability monitor checks (`AbilityMonitor.when`, `+0xc4`): the Ability Monitor dialog (406). */
export const MonitorWhen = {
  Every: 0x1,
  BeforeResting: 0x2,
  AfterResting: 0x4,
  AfterCombatRound: 0x8,
  PathStart: 0x10,
  BeforeMeditating: 0x20,
  AfterMeditating: 0x40,
  SpellCast: 0x80,
  GameMessage: 0x100
} as const;

/** The configured weapons, as `0x4262a0` tells a weapon's kinds apart (a weapon may be more than one). */
export const WeaponKind = {
  /** `Combat.NrmWeapon`. */
  Normal: 0x1,
  /** `Combat.AltWeapon`. */
  Alt: 0x2,
  /** `Combat.BsWeapon`. */
  Backstab: 0x4
} as const;

/** Each weapon kind, in MegaMUD's order, with the letter its traces use. */
export const WEAPON_KINDS = [
  [WeaponKind.Normal, 'N'],
  [WeaponKind.Alt, 'A'],
  [WeaponKind.Backstab, 'B']
] as const;

/** An ability monitor's state (`AbilityMonitor.state`, `+0xd8`). */
export const MonitorState = {
  Idle: 0,
  /** Being checked: its ability asked for, the answer awaited. */
  Checking: 1,
  /** Suspended: its ability never answers (three asks unanswered, or `Ability … not found`). */
  Suspended: 2
} as const;

/** What a room entry is (`RoomEntity.type`, `+0x00`, as `0x471a10` sorts them). */
export const EntityType = {
  NotKnown: 0,
  Player: 1,
  Monster: 2,
  Item: 3
} as const;

/**
 * What a creature or player is to this character: a monster's relationship
 * (`MonsterRec.relationship`), a player's kind and a room entry's kind, in
 * MegaMUD's own words (its table at `0x562410`).
 */
export const Stance = {
  Unknown: 0,
  Friend: 2,
  Avoid: 3,
  Enemy: 4,
  Flee: 5,
  Hangup: 6,
  /** Not in MegaMUD's table, and nothing in the port sets it: a player of this kind is sent no remote replies. */
  Unknown_7: 7
} as const;

/** How dark the room is (`Session.darkness`, `0xdca4`). */
export const Darkness = {
  Lit: 0,
  Dim: 1,
  Dark: 2,
  /** Pitch black, by the path step's mark (`StepFlag.PitchBlack`). */
  PitchBlack: 3
} as const;

/** One of the room's exits (`Session.roomExits`, `0x813c`). */
export const Exit = {
  None: 0,
  /** A plain exit. */
  Open: 1,
  ClosedDoor: 2,
  OpenDoor: 3,
  /**
   * PROBABLY a hidden exit: one found by searching (`You found an exit`), or
   * listed with words before its direction. Left out of the room's signature.
   */
  ProbablyHidden: 4,
  /** A door unlocked (picked, or found not locked): opened on the next move. */
  Unlocked: 5
} as const;
