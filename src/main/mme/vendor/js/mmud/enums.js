// Display names for the database's coded values.
// Ported from modMMudFunc.bas (GetXEnum / GetAbilityName).

import { engine } from './engine.js';

const pick = (table, n) => (n in table ? table[n] : `Unknown (${n})`);

export const ARMOUR_TYPE = { 0: 'Natural', 1: 'Silk', 2: 'Ninja', 3: 'Leather', 4: 'Leather',
  5: 'Leather', 6: 'Leather', 7: 'Chainmail', 8: 'Scalemail', 9: 'Platemail' };
export const armourType = n => pick(ARMOUR_TYPE, n);

export const WEAPON_TYPE = { 0: '1H Blunt', 1: '2H Blunt', 2: '1H Sharp', 3: '2H Sharp' };
export const weaponType = n => pick(WEAPON_TYPE, n);

export const CLASS_WEAPON_TYPE = { ...WEAPON_TYPE, 4: 'Any 1H', 5: 'Any 2H', 6: 'Any Sharp',
  7: 'Any Blunt', 8: 'Any Weapon', 9: 'Staff' };
export const classWeaponType = n => pick(CLASS_WEAPON_TYPE, n);

export const WORN = { 0: 'Nowhere', 1: 'Everywhere', 2: 'Head', 3: 'Hands', 4: 'Finger', 5: 'Feet',
  6: 'Arms', 7: 'Back', 8: 'Neck', 9: 'Legs', 10: 'Waist', 11: 'Torso', 12: 'Off-Hand', 13: 'Finger',
  14: 'Wrist', 15: 'Ears', 16: 'Worn', 17: 'Wrist', 18: 'Eyes', 19: 'Face' };
export const wornType = n => pick(WORN, n);

export const ITEM_TYPE = { 0: 'Armour', 1: 'Weapon', 2: 'Projectile', 3: 'Sign', 4: 'Food', 5: 'Drink',
  6: 'Light', 7: 'Key', 8: 'Container', 9: 'Scroll', 10: 'Special' };
export const itemType = n => (n in ITEM_TYPE ? ITEM_TYPE[n] : String(n));

export const COST_TYPE = { 0: 'Copper', 1: 'Silver', 2: 'Gold', 3: 'Platinum', 4: 'Runic' };
export const costType = n => pick(COST_TYPE, n);
export const COPPER_PER = { 0: 1, 1: 10, 2: 100, 3: 10000, 4: 1000000 };

export const SPELL_TARGETS = { 0: 'User', 1: 'Self', 2: 'Self or User', 3: 'Divided Area (not self)',
  4: 'Monster', 5: 'Divided Area (incl self)', 6: 'Any', 7: 'Item', 8: 'Monster or User',
  9: 'Divided Attack Area', 10: 'Divided Party Area', 11: 'Full Area', 12: 'Full Attack Area',
  13: 'Full Party Area' };
export const spellTargets = n => pick(SPELL_TARGETS, n);

export const SHOP_TYPE = { 0: 'General', 1: 'Weapons', 2: 'Armour', 3: 'Items', 4: 'Spells',
  5: 'Hospital', 6: 'Tavern', 7: 'Bank', 8: 'Training', 9: 'Inn', 10: 'Specific', 11: 'Gang Shop',
  12: 'Deed Shop' };
export const shopType = n => pick(SHOP_TYPE, n);

export const MON_ATTACK_TYPE = { 0: 'None', 1: 'Normal', 2: 'Spell', 3: 'Rob' };
export const monAttackType = n => pick(MON_ATTACK_TYPE, n);

export const MON_TYPE = { 0: 'Solo', 1: 'Leader', 2: 'Follower', 3: 'Stationary' };
export const monType = n => pick(MON_TYPE, n);

export const MON_ALIGN = { 0: 'Good', 1: 'Evil', 2: 'Chaotic Evil', 3: 'Neutral', 4: 'Lawful Good',
  5: 'Neutral Evil', 6: 'Lawful Evil' };
export const monAlignment = n => pick(MON_ALIGN, n);

export const MAGERY = { 0: 'None', 1: 'Mage', 2: 'Priest', 3: 'Druid', 4: 'Bard', 5: 'Kai' };
export const magery = (n, level) => pick(MAGERY, n) + (n ? '-' + (level || 0) : '');

// GetAbilityName. Abilities MME hides unless forced (message text, flags that
// would clutter every row) return '' when `forceAll` is false.
const ABIL = ['None', 'Damage', 'AC', 'Resist-Cold', 'MaxDamage', 'Resist-Fire', 'Enslave', 'DR',
  'DrainLife', 'Shadow', 'AC Blur', 'AlterEnergyLevel', 'Summon', 'Illu', 'RoomIllu', 'Alterhunger',
  'Alterthirst', 'Damage(-MR)', 'Heal', 'Poison', 'CurePoison', 'ImmuPoison', 'Accuracy',
  'AffectsUndeadOnly', 'ProtEvil', 'ProtGood', 'DetectMagic', 'Stealth', 'Magical', 'Punch', 'Kick',
  'Bash', 'Smash', 'Killblow', 'Dodge', 'JumpKick', 'M.R.', 'Picklocks', 'Tracking', 'Thievery',
  'FindTraps', 'DisarmTraps', 'LearnSp', 'CastsSp', 'Intel', 'Wisdom', 'Strength', 'Health',
  'Agility', 'Charm', 'MageBaneQuest', 'AntiMagic', 'EvilInCombat', 'BlindingLight', 'IlluTarget',
  'AlterLightDuration', 'RechargeItem', 'SeeHidden', 'Crits', 'ClassOk', 'Fear', 'AffectExit',
  'AlterEvilChance', 'AlterExperience', 'AddCP', 'Resist-Stone', 'Resist-Lightning', 'Quickness',
  'Slowness', 'MaxMana', 'Spellcasting', 'Confusion', 'ShockShield', 'DispellMagic', 'HoldPerson',
  'Paralyze', 'Mute', 'Perception', 'Animal', 'MageBind', 'AffectsAnimalsOnly', 'Freedom', 'Cursed',
  'CursedMajor', 'RemoveCurse', 'Shatter', 'Quality', 'Speed', 'MaxHP', 'PunchAcc', 'KickAcc',
  'JumpKAcc', 'PunchDmg', 'KickDmg', 'JumpKDmg', 'Slay', 'Encum%', 'GoodOnly', 'EvilOnly',
  'AlterDRpercent', 'LoyalItem', 'ConfuseMsg', 'RaceStealth', 'ClassStealth', 'DefenseModifier',
  'Accuracy2', 'Accuracy3', 'BlindUser', 'AffectsLivingOnly', 'NonLiving', 'NotGood', 'NotEvil',
  'NeutralOnly', 'NotNeutral', '%Spell', 'DescMsg', 'BSAccu', 'BsMinDmg', 'BsMaxDmg', 'Del@Maint',
  'StartMsg', 'Recharge', 'RemovesSpell', 'HPRegen', 'NegateAbility', 'IceSorcQuest', 'GoodQuest',
  'NeutralQuest', 'EvilQuest', 'DarkDruidQuest', 'BloodChampQuest', 'SheDragonQuest', 'WereratQuest',
  'PhoenixQuest', 'DaoLordQuest', 'MinLevel', 'MaxLevel', 'ShockMsg', 'RoomVisible', 'SpellImmu',
  'TeleportRoom', 'TeleportMap', 'HitMagic', 'ClearItem', 'NonMagicalSpell', 'ManaRgn', 'MonsGuards',
  'Resist-Water', 'TextBlock', 'Remove@Maint', 'HealMana', 'EndCast', 'Rune', 'KillSpell',
  'Visible@Maint', 'DeathText', 'QuestItem', 'ScatterItems', 'ReqToHit', 'KaiBind', 'GiveTempSpell',
  'OpenDoor', 'Lore', 'SpellComponent', 'EndCast%', 'AlterSpDmg', 'AlterSpLength', 'UnEquipItem',
  'EquipItem', 'CannotWearLocation', 'Sleep', 'Invisibility', 'SeeInvisible', 'Scry', 'StealMana',
  'StealHPtoMP', 'StealMPtoHP', 'SpellColours', 'Shadowform', 'FindTrapsValue', 'PickLocksValue',
  'GHouseDeed', 'GHouseTax', 'GHouseItem', 'GShopItem', 'NoAttackIfItemNum', 'PerfectStealth',
  'Meditate'];
const HIDDEN_ABIL = new Set([101, 115, 120, 137, 144, 155]);

const GREATER_ABIL = { 15: 'GypsyFortune', 16: 'Rinaldo', 50: 'Quest1', 188: 'Unique Pool',
  189: 'Witchy Badges', 190: 'No Stock', 200: 'Mandos Quest', 201: 'Volums Quest',
  202: 'CartographerQuest', 203: 'LoremasterQuest', 204: 'GuildmasterQuest', 205: 'DarkbaneQuest',
  206: 'GrizzledRanger', 207: 'AmazonHuntress', 208: 'Conquest1', 209: 'Conquest2', 210: 'TarlChain',
  211: 'MerchantCaptain', 212: 'TrendelQuest', 213: 'LucaProdigio', 214: 'EtherealWatcher',
  215: 'KatoQuest', 216: 'GoodCheck', 217: 'NeutralCheck', 218: 'EvilCheck', 220: 'NagaQuest',
  221: 'DreadWraith', 222: 'CourtesanQuest', 1001: 'GrantThievery', 1002: 'GrantTraps',
  1003: 'GrantPicklocks', 1004: 'GrantTracking', 1100: 'AntiMagicNotOK', 1101: 'MeetsReqToHit',
  1102: 'UseSpell', 1103: 'ShadowRest', 1104: 'AlterSpellHeal', 1105: 'AlterSpells',
  1106: 'AlterSpellBuffs', 1107: 'NoAutoLearn' };

export function abilityName(n, forceAll = false) {
  if (HIDDEN_ABIL.has(n) && !forceAll) return '';
  if (engine.greater) {
    if (n in GREATER_ABIL) return GREATER_ABIL[n];
    if ((n >= 191 && n <= 199) || n === 219 || (n >= 223 && n <= 400)) return forceAll ? 'QuestFlag' + n : '';
  }
  if (n >= 0 && n < ABIL.length) return ABIL[n];
  return forceAll ? `Abil${n}` : '';
}

// Well-known ability numbers, for readable code.
export const A = Object.freeze({
  Damage: 1, AC: 2, ResistCold: 3, MaxDamage: 4, ResistFire: 5, DR: 7, DrainLife: 8, Shadow: 9,
  ACBlur: 10, Illu: 13, DamageMR: 17, Heal: 18, Poison: 19, Accuracy: 22, ProtEvil: 24, ProtGood: 25,
  Stealth: 27, Magical: 28, Punch: 29, Kick: 30, Bash: 31, Smash: 32, Killblow: 33, Dodge: 34,
  JumpKick: 35, MR: 36, Picklocks: 37, Tracking: 38, Thievery: 39, FindTraps: 40, DisarmTraps: 41,
  LearnSp: 42, CastsSp: 43, Int: 44, Wis: 45, Str: 46, Hea: 47, Agl: 48, Chm: 49, AntiMagic: 51,
  EvilInCombat: 52, SeeHidden: 57, Crits: 58, ClassOk: 59, Fear: 60, ResistStone: 65,
  ResistLightning: 66, Quickness: 67, Slowness: 68, MaxMana: 69, Spellcasting: 70, Confusion: 71,
  ShockShield: 72, Perception: 77, Animal: 78, Speed: 87, MaxHP: 88, PunchAcc: 89, KickAcc: 90,
  JumpKAcc: 91, PunchDmg: 92, KickDmg: 93, JumpKDmg: 94, Slay: 95, EncumPct: 96, GoodOnly: 97,
  EvilOnly: 98, LoyalItem: 100, NonLiving: 109, NotGood: 110, NotEvil: 111, NeutralOnly: 112,
  NotNeutral: 113, BSAccu: 116, BSMinDmg: 117, BSMaxDmg: 118, HPRegen: 123, NegateAbility: 124,
  MinLevel: 135, MaxLevel: 136, SpellImmu: 139, TeleportRoom: 140, TeleportMap: 141, HitMagic: 142,
  NonMagicalSpell: 144, ManaRgn: 145, ResistWater: 147, TextBlock: 148, QuestItem: 156,
  ReqToHit: 158, CannotWearLocation: 169, NoAttackIfItemNum: 185, PerfectStealth: 186, Meditate: 187,
});
