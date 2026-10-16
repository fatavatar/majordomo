/**
 * The session struct's working state that `Session.ts` does not declare with
 * its neighbours: flags, counters and clocks, each named for what its uses in
 * `megamud.exe` show it to be, its offset in the comment (read 2026-10-16).
 * One whose purpose is only inferred is named `probably…` and says what is
 * unconfirmed; one not understood is `unknown_<offset>`. A field nothing in
 * the port reads is not declared at all.
 */
import { SettingsFields } from './SettingsFields';

export class StateFields extends SettingsFields {
  /** 0x50: never set by the port; MegaMUD's `@home` answers busy while it is. */
  unknown_50 = 0;
  /** 0x68: the line handler ran its run check since the scheduler last ran. */
  lineRunChecked = 0;
  /** 0x2258: a BBS notice runs onto the next line, which is passed over too. */
  noticeContinues = 0;
  /**
   * 0x2378: scheduler passes in a row that sent from the pending list; at 5 the list waits a pass.
   */
  pendingStreak = 0;
  /** 0x8138: the signature of the room the step being taken leads to; 0 none. */
  expectedRoom = 0;
  /** 0x8168: the map number of the last `Location:` line. */
  locationMap = 0;
  /** 0x816c: the room number of the last `Location:` line. */
  locationRoom = 0;
  /** 0x8170: the room signature `locationMap`/`locationRoom` were read in. */
  locationSignature = 0;
  /** 0x8428: the coin carried, in copper. */
  wealth = 0;
  /** 0x842c: the amount to deposit (-1: all over `Cash.MinWealth`). */
  depositAsked = 0;
  /** 0x8430: the cash a purchase or path needs; withdrawn at the bank. */
  cashNeeded = 0;
  /** 0x845c: deposited or withdrew in this bank visit; cleared on leaving the room. */
  bankedHere = 0;
  /**
   * 0x8464: the weight carried (the inventory's `Encumbrance:` figure, tracked between listings).
   */
  weightCarried = 0;
  /**
   * 0x8468: the maximum encumbrance from the last inventory listing; 0 when the inventory is to be
   * listed again.
   */
  weightMax = 0;
  /** 0x846c: the encumbrance level: 0 none, 1 light, 2 medium, 3 heavy. */
  encumbranceLevel = 0;
  /** 0x8470: the one item of unknown weight is weighed on the next listing. */
  weighPending = 0;
  /** 0x8558: a corpse recovery is under way. */
  recoveringCorpse = 0;
  /** 0x8870: the party's cash is to be shared (`@share`, `Party.ShareCash`). */
  shareCashDue = 0;
  /** 0x8874: `@share` has been sent this lap. */
  shareAsked = 0;
  /** 0x8890: a party member asked for `@panic`; answered at the next prompt. */
  panicAsked = 0;
  /**
   * 0x8b64: training for this level is dealt with: alerted, trained, or the trainer cannot be
   * reached.
   */
  trainDealtWith = 0;
  /** 0x8be4: a fight was engaged in this room (typed, or begun by the engine). */
  engagedHere = 0;
  /** 0x8be8: prefer melee (`MegaMud.DefMelee1`/`2`, the toolbar's fighting button, `@melee`). */
  preferMelee = 0;
  /** 0x8bec: every configured weapon has failed against the target. */
  weaponsExhausted = 0;
  /** 0x907c: running by choice (polite attacks, too few monsters), not from danger. */
  runByChoice = 0;
  /** 0x90c8: `track` was sent: following the trail. */
  tracking = 0;
  /** 0x9104: the signature of the room fled to; 0 none. */
  fleeRoom = 0;
  /**
   * 0xa328: auto-combat was turned on for a stop (`Other.AutoAutoCombat`); turned off when moving
   * again.
   */
  autoCombatForWait = 0;
  /** 0xa32c: all Off: automation suspended (the toolbar's All Off). */
  allOff = 0;
  /** 0xa3e0: the last cast was answered (it took, failed or was refused). */
  castAnswered = 0;
  /** 0xa3e4: the last cast took (the plain cast's count, `0x15`). */
  castTook = 0;
  /** 0xa3e8: casts of the pre-multi-attack spell this fight. */
  castsPreMulti = 0;
  /** 0xa3ec: casts of the multi-attack spell this fight. */
  castsMulti = 0;
  /** 0xa3f0: casts of the pre-attack spell this fight. */
  castsPre = 0;
  /** 0xa3f4: casts of the main attack spell this fight. */
  castsMain = 0;
  /** 0xa3f8: casts of the second attack spell this fight. */
  castsAux = 0;
  /** 0xa3fc: casts of the alternate spell (the drain or heal) this fight. */
  castsAlt = 0;
  /** 0xa400: casts of the spell typed by the player this fight. */
  castsUser = 0;
  /** 0xa410: how many alternate casts are allowed. */
  altCastCap = 0;
  /** 0xa448: the attack mode being cast (`State.Cast…`); 0 none. */
  castMode = 0;
  /** 0xa44c: a message of the cast was seen this round. */
  castMessageSeen = 0;
  /** 0xa450: the cast began this round: its first round without a message is not counted. */
  castJustBegun = 0;
  /** 0xa454: the mode's cast count when the round began. */
  castCountBefore = 0;
  /** 0xa458: when the cast watchdog last reported (ms). */
  castWatchdogAt = 0;
  /** 0xa460: the spell being cast takes no target. */
  castUntargeted = 0;
  /** 0xa464: the spell being cast is an area spell. */
  castArea = 0;
  /** 0xa50c: rounds the pre-multi-attack spell went without a message. */
  silentPreMulti = 0;
  /** 0xa510: rounds the multi-attack spell went without a message. */
  silentMulti = 0;
  /** 0xa514: rounds the pre-attack spell went without a message. */
  silentPre = 0;
  /** 0xa518: rounds the main attack spell went without a message. */
  silentMain = 0;
  /** 0xa51c: rounds the second attack spell went without a message. */
  silentAux = 0;
  /** 0xa520: rounds the alternate spell went without a message. */
  silentAlt = 0;
  /** 0xa524: rounds the typed spell went without a message. */
  silentUser = 0;
  /** 0xa57c: damage the multi-attack spells have done this fight. */
  multiDamage = 0;
  /** 0xa580: a multi-attack is under way (its spell is an area spell that needs no target). */
  multiAttacking = 0;
  /** 0xa5f8: equips and removes sent and not yet answered. */
  equipsPending = 0;
  /** 0xa62c: drain casts (the alternate spell, while draining) this fight. */
  drainCasts = 0;
  /** 0xb0fc: the weapon had no effect on the target this fight. */
  weaponNoEffect = 0;
  /** 0xb100: the normal weapon has been seen to work on the target. */
  normalWeaponWorked = 0;
  /** 0xb104: the alternate weapon has been seen to work on the target. */
  altWeaponWorked = 0;
  /** 0xb108: the backstab weapon has been seen to work on the target. */
  backstabWeaponWorked = 0;
  /**
   * 0xd81c: MegaMUD's settings window is open (no profile change then). Never set here: our
   * settings page is not modal.
   */
  settingsWindowOpen = 0;
  /** 0xd8f0: a MUD op's `@home` lookup is under way (`sys stat room` replies are read). */
  homeLookup = 0;
  /** 0xd8f4: the looked-up monster's room may be asked (`sys stat room`). */
  homeAskDue = 0;
  /** 0xd8f8: the index of the monster `@home` asked about; -1 none. */
  homeMonster = 0;
  /**
   * 0xdb18: PROBABLY whether a line went through the dispatch handled; the port never sets it, so
   * the dispatch answers 0.
   */
  probablyLineHandled = 0;
  /** 0xdb20: `MegaMud.StartTask` waiting to be taken up on entering the game; -1 done. */
  startTask = 0;
  /** 0xdb34: the direction of the last move; -1 once a room's exits are read. */
  lastMoveDir = 0;
  /** 0xdb44: laps of the loop completed (-1 before the first). */
  laps = 0;
  /** 0xdb48: bashes tried at this door. */
  bashTries = 0;
  /** 0xdb50: picks tried at this lock. */
  pickTries = 0;
  /** 0xdb58: disarms tried at this trap. */
  disarmTries = 0;
  /** 0xdb60: searches left in this room (`Other.SearchMax`). */
  searchesLeft = 0;
  /** 0xdb68: times sneaking or hiding was refused (`You may not …`) here. */
  stealthRefused = 0;
  /** 0xdb6c: sneak or hide failures in a row. */
  stealthFails = 0;
  /** 0xdb74: moves in the dark that went nowhere, before counting as lost. */
  darkMisses = 0;
  /** 0xdb78: tries to find the way back in the dark. */
  darkTries = 0;
  /** 0xdb88: ten-second silences while logging on. */
  loginQuietTens = 0;
  /** 0xdb8c: each third ten-second silence while logging on; at three the connection is dropped. */
  loginQuietStrikes = 0;
  /** 0xdc98: messages received while away; never counted by the port. */
  afkMessages = 0;
  /** 0xdd0c: attacks refused in a row (the creatures here are forgotten after 2). */
  attacksRefused = 0;
  /** 0xdd10: hits with no effect on the target. */
  noEffectCount = 0;
  /** 0xdd78: targets fought (counted as each is remembered). */
  targetCount = 0;
  /** 0xdd7c: PROBABLY a count of room changes; the port never advances it. */
  probablyRoomChanges = 0;
  /** 0xdd80: `targetCount` when the target was blamed for a no-effect. */
  noEffectTargetCount = 0;
  /** 0xdd84: `probablyRoomChanges` when the target was blamed for a no-effect. */
  noEffectRoomChanges = 0;
  /** 0xddec: the signature of the room the last target was fought in. */
  lastTargetRoom = 0;
  /** 0xddf0: someone protects the target. */
  targetProtected = 0;
  /** 0xdf00: the configured weapons in hand (`WeaponKind` bits). */
  weaponsInHand = 0;
  /** 0xdf04: the configured weapons being tried to test an immunity (`WeaponKind` bits). */
  weaponsProbing = 0;
  /** 0xdf08: the configured weapons suspected of not working on the target (`WeaponKind` bits). */
  weaponsSuspect = 0;
  /** 0xe144: a prompt's HP under `HpLogoff%` was held over once, in case it was misread. */
  lowHpHeld = 0;
  /** 0xe158: hanging up on purpose: the disconnection is expected. */
  hangingUp = 0;
  /** 0xe160: online since the last connect: a disconnection now is unexpected. */
  connectionLive = 0;
  /** 0xe170: the critical-HP response is armed (rearmed on each move). */
  lowHpArmed = 0;
  /** 0xe174: MegaMUD's path recorder is recording. Never set here: the app has no recorder. */
  recording = 0;
  /** 0xe180: capture is on (`@capture`). */
  capturing = 0;
  /** 0xe194: the "no paths defined" message has been shown. */
  noPathShown = 0;
  /**
   * 0xe198: lost with the room unknown (no path, or the dark): found again only in a known room,
   * not by resyncing the path.
   */
  lostNeedsKnownRoom = 0;
  /** 0xe19c: "Trying every direction to escape" has been shown. */
  darkEscapeShown = 0;
  /** 0xe1a0: running from a player (`PvP.PvpAction` flee or delayed hang-up). */
  fleeingPlayer = 0;
  /** 0xe1b8: the backstab's outcome is known (it surprised, or failed). */
  backstabResolved = 0;
  /** 0xe1bc: the backstab surprised the target. */
  backstabSurprised = 0;
  /**
   * 0xe1c0: PROBABLY that the leader is resting: a follower rests to full with it; cleared when the
   * leader attacks.
   */
  probablyLeaderResting = 0;
  /** 0xe1c8: was sneaking before moving with the party; sneaking again after. */
  wasSneaking = 0;
  /** 0xe1d0: hiding was lost (searched out, or failed): hide again. */
  hideAgain = 0;
  /**
   * 0xe1d8: an action that drops the realm's combat was sent (a cast, an equip, an attack typed):
   * the next `*Combat Off*` with enemies here is its echo.
   */
  combatOffExpected = 0;
  /** 0xe1dc: a `You deliver a … to …` line with its damage on the next line. */
  blowContinues = 0;
  /** 0xe1e0: `There is no room to` drop here; cleared on leaving. */
  cannotDropHere = 0;
  /** 0xe1e4: the corpse here was recovered or could not be; not tried again here. */
  corpseTried = 0;
  /** 0xe1e8: the light was removed to see whether the room is dark. */
  lightRemovedToTest = 0;
  /** 0xe1fc: passes the heal step waited for the poison cure (3 at most). */
  poisonCureWaits = 0;
  /** 0xe218: a message with `Attack prevented` is in effect. */
  attackPrevented = 0;
  /** 0xe21c: the path step says not to attack in this room (`StepFlag.DontAttackNext`). */
  dontAttackHere = 0;
  /** 0xe220: the "friends in room, area spells not used" warning has been shown. */
  areaWarned = 0;
  /** 0xe23c: HP is to be rested to full before anything else (critical HP, a teleport). */
  healthFirst = 0;
  /** 0xe24c: the player records changed: kept on the next save. */
  playersChanged = 0;
  /** 0xe254: the monster records changed: kept on the next save. */
  monstersChanged = 0;
  /** 0xe258: the item records changed: kept on the next save. */
  itemsChanged = 0;
  /** 0xe284: the BBS is shutting down: leave the game once HP is full. */
  exitForShutdown = 0;
  /** 0xe288: a timed logoff event: leave the game. */
  exitForLogoff = 0;
  /** 0xe28c: a re-log event: leave the game and log on again. */
  exitForRelog = 0;
  /** 0xe290: the room is to be looked at again (a bare Enter). */
  lookDue = 0;
  /** 0xe294: a re-display of the room was asked for; the next is not sent until it is seen. */
  redisplayDue = 0;
  /** 0xe298: a path's party command was sent; moving waits for the party's listing. */
  partyStepPending = 0;
  /** 0xe29c: `stat` is wanted (-1: even in a fight). */
  statDue = 0;
  /** 0xe2a0: GreaterMUD's `Typing STAT` pager is up: its lines are not read as the stat display. */
  statPagerUp = 0;
  /** 0xe2a4: `who` is wanted (-1: an unknown player was seen, or the last listing timed out). */
  whoDue = 0;
  /** 0xe2a8: `exp` is wanted (-1: even in a fight). */
  expDue = 0;
  /** 0xe2ac: `par` is wanted. */
  parDue = 0;
  /** 0xe2b4: the path step says not to rest in this room (`StepFlag.DontRestHere`). */
  dontRestHere = 0;
  /**
   * 0xe2b8: an attack is due: enemies arrived or a blow landed, so the fight step runs on the next
   * line rather than the next round.
   */
  attackDue = 0;
  /** 0xe2bc: sneaking was asked for, whatever `MegaMud.AutoSneak` says. */
  sneakAsked = 0;
  /** 0xe2c0: stashing at a stash point. */
  stashing = 0;
  /** 0xe2c4: the detour to sell has been taken this lap. */
  sellDetourTaken = 0;
  /** 0xe2c8: the game set-up (`set statline`, `brief`, …) is to be sent. */
  setupDue = 0;
  /** 0xe2cc: `spells` (or `powers`) is wanted. */
  spellsDue = 0;
  /** 0xe2d0: the item weights are reported after the next inventory listing. */
  weightsReportAsked = 0;
  /** 0xe2d4: the game set-up has been sent. */
  setupDone = 0;
  /** 0xe2d8: a creature arrived while walking without fighting it: no sneaking until moving on. */
  arrivedWhileWalking = 0;
  /** 0xe2dc: the door's lock answered while busy: open it on the next move. */
  openDoorNext = 0;
  /** 0xe2e0: `You found a trap` at this exit. */
  trapFound = 0;
  /** 0xe2e4: the trap at this exit was disarmed. */
  trapDisarmed = 0;
  /**
   * 0xe2ec: the party was lost (left behind, `@comeback` asked); cleared when the leader is with it
   * again.
   */
  partyLost = 0;
  /** 0xe2f4: the party's need to rest has been traced (debug only). */
  partyWaitTraced = 0;
  /**
   * 0xe360: a party member was asked for help (`@heal`, `@blind`, …); not asked again until it
   * answers.
   */
  partyAskPending = 0;
  /** 0xe364: the alternate spell being cast is a heal (a drain). */
  altHeal = 0;
  /** 0xe36c: a Go To warning (an item needed, the level) was answered Continue Anyway. */
  goAnywayAccepted = 0;
  /**
   * 0xe398: movement stopped after a fight's end outside the arena; moves refused until Go or Stop.
   */
  movementHalted = 0;
  /** 0xe524: never set by the port; when set, a dropped path keeps the loop loaded. */
  unknown_e524 = 0;
  /** 0xe540: the socket is up (-1), or down (0). */
  socketUp = 0;
  /** 0xe544: the dialler's state: 3 waiting out the redial pause, 4 dialling. */
  dialState = 0;
  /** 0xe57c: never set by the port; when set, the scheduler and the pending list stand still. */
  unknown_e57c = 0;
  /** 0x30dc8: redials since the last good connection. */
  redials = 0;
  /** 0x30de4: the next carrier loss is not redialled (a hang-up on purpose). */
  skipRedialOnce = 0;
  /** 0x30de8: no reconnecting at all (a hang-up for low HP or a player). */
  noRedial = 0;
  /** 0x30e14: sends not to be echoed; the port never sets it. */
  silentSends = 0;
  /** 0x30e18: never set by the port; when set, stashing waits. */
  unknown_30e18 = 0;
  /** 0x31914: the session is open (1), or ended by this side (-1). */
  sessionOpen = 0;
  /** 0x32298: when to redial. */
  redialAt = 0;
  /** 0x322a0: when a command was last sent. */
  lastSentAt = 0;
  /** 0x322b0: when the experience meter's span began. */
  expMeterStart = 0;
  /** 0x322b8: when the experience meter's span last advanced. */
  expMeterEnd = 0;
  /** 0x322c0: an idle clock the AFK check reads; the port sets it only on the first tick. */
  unknown_322c0 = 0;
  /**
   * 0x322d0: PROBABLY when the player last typed (the AFK clock); the port sets it only on the
   * first tick.
   */
  probablyLastTypedAt = 0;
  /** 0x322d8: when the last attack was sent. */
  attackSentAt = 0;
  /**
   * 0x322e0: when this character's HP was last seen over every member's maximum (an attack is then
   * due).
   */
  outHpCheckedAt = 0;
  /** 0x322e8: when this character's last blow or spell landed. */
  lastHitAt = 0;
  /** 0x322f0: when a blow by anyone was last seen (no sneaking within 3 seconds). */
  blowSeenAt = 0;
  /** 0x322f8: when a player attacked: the delayed hang-up counts from it. */
  pvpFleeAt = 0;
  /** 0x32300: when this character hid. */
  hiddenAt = 0;
  /** 0x32310: when `rest` was last sent. */
  restAskedAt = 0;
  /** 0x32318: when a heal was last cast. */
  healCastAt = 0;
  /** 0x32320: when this character last moved. */
  movedAt = 0;
  /** 0x32328: when `par` was last listed (0: due now). */
  parAt = 0;
  /** 0x32330: when the party began waiting (`Party.PartyWaitMax`). */
  partyWaitAt = 0;
  /** 0x32338: when the leader was last asked to wait. */
  waitSentAt = 0;
  /** 0x32340: when the leader was last told `@ok`. */
  okSentAt = 0;
  /** 0x32348: when `i` was last sent. */
  inventoryAskedAt = 0;
  /** 0x32350: when the inventory listing last had a line (ms). */
  inventoryQuietAt = 0;
  /** 0x32358: when the inventory listing began (ms). */
  inventoryStartedAt = 0;
  /** 0x32360: when the `who` listing last had a line (ms). */
  whoQuietAt = 0;
  /** 0x32368: when the `top` listing last had a line (ms). */
  topQuietAt = 0;
  /** 0x32370: when a `who` listing last timed out (ms). */
  whoTimedOutAt = 0;
  /** 0x32378: when `stat` was last sent. */
  statAskedAt = 0;
  /** 0x32380: when the last `Location:` line was read. */
  locationAt = 0;
  /** 0x32388: when a player was last looked at. */
  lookedAtPlayerAt = 0;
  /** 0x32390: when the room was last looked at again. */
  roomLookedAt = 0;
  /** 0x32398: when a party member was last asked for help. */
  partyAskedAt = 0;
  /** 0x323a0: never set by the port: entering the game, the set-up is resent this long after it. */
  unknown_323a0 = 0;
  /** 0x32490: when `*Combat Engaged*` was last seen. */
  combatOnAt = 0;
  /** 0x32498: when `*Combat Off*` was last seen. */
  combatOffAt = 0;
  /** 0x324a0: when this character last joined a member's attack (`Party.AttackLast`). */
  partyAttackJoinedAt = 0;
  /**
   * 0x324a8: members seen on a new target since this character's last attack (bits by member
   * index).
   */
  membersOnNewTargets = 0;
  /** 0x324b0: when a member's attack was last seen (ms). */
  memberAttackAt = 0;
  /** 0x324b8: when this character last joined in late (`Party.AttackLate`, ms). */
  attackLateAt = 0;
  /** 0x324c0: `*Combat Engaged*` and `*Combat Off*` lines seen. */
  combatChanges = 0;
  /** 0x324c4: `combatChanges` when the last attack was sent. */
  combatChangesAtAttack = 0;
  /** 0x324c8: the experience the meter counts from. */
  expBaseline = 0;
  /** 0x324d0: the experience made before the meter's baseline was last reset. */
  expBefore = 0;
  /** 0x32600: PROBABLY that a round of this fight has been fought (-1 at the fight's start). */
  probablyRoundFought = 0;
  /** 0x32604: a blow was struck this round. */
  roundBlowSeen = 0;
  /** 0x32608: the spell waiting to be cast was given a target. */
  waitingSpellTargeted = 0;
  /** 0x3260c: PROBABLY that this round's action has been counted (a blow or a cast). */
  probablyRoundCounted = 0;
  /** 0x32614: damage this character did this round. */
  roundDamage = 0;
  /** 0x32618: damage this character did this fight. */
  fightDamage = 0;
}
