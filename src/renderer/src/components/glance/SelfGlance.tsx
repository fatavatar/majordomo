import { KitAside, KitFigure, KitLevel, KitLine, KitPairs, KitTiles, compact } from '../kit';
import type { CharacterState } from '@shared/character';
import { CAN_SEE_FROM, lightPhrase } from '@shared/light';
import { t } from '../../lib/i18n';

/** Where `value` stands in `span`, or null where either is unknown. */
function share(value: number | null, span: [number, number] | undefined): number | null {
  if (value === null || span === undefined || span[1] <= span[0]) return null;
  return (value - span[0]) / (span[1] - span[0]);
}

/**
 * The sheet as `glance` lays it out (2026-10-25). Who the character is, in
 * one line of words and badges; the six attributes as tiles, each filled to
 * where it stands in the race's range, so the strong and the weak read before
 * a digit does; the skills two to a line, with no bar, since a skill has no
 * ceiling to stand against; the skills trained to nothing folded into one
 * quiet line; and sight said as one sentence.
 */
export default function SelfGlance({ character }: { character: CharacterState }) {
  const { progress, sight, room, attributeSpans: spans } = character;
  const attribute = (
    key: string,
    label: string,
    value: number | null,
    span: [number, number] | undefined
  ) => ({
    key,
    label,
    value: value === null ? '—' : value.toLocaleString(),
    share: share(value, span),
    ...(span === undefined
      ? {}
      : { title: t('cards.self.statRange', { low: span[0], high: span[1] }) })
  });

  const skills: Array<{ key: string; label: string; value: number | null }> = [
    { key: 'perception', label: t('cards.self.labels.perception'), value: progress.perception },
    { key: 'stealth', label: t('cards.self.labels.stealth'), value: progress.stealthSkill },
    { key: 'thievery', label: t('cards.self.labels.thievery'), value: progress.thievery },
    { key: 'traps', label: t('cards.self.labels.traps'), value: progress.traps },
    { key: 'picklocks', label: t('cards.self.labels.picklocks'), value: progress.picklocks },
    { key: 'tracking', label: t('cards.self.labels.tracking'), value: progress.tracking },
    { key: 'martial', label: t('cards.self.labels.martialArts'), value: progress.martialArts },
    { key: 'magicRes', label: t('cards.self.labels.magicRes'), value: progress.magicRes },
    { key: 'spell', label: t('cards.self.labels.spellcasting'), value: progress.spellcasting }
  ];
  const trained = skills.filter((skill) => skill.value !== 0);
  const untrained = skills.filter((skill) => skill.value === 0).map((skill) => skill.label);

  const level = room.map === null ? null : (room.lightLevel ?? null);
  const seen = sight === null || level === null ? null : level + sight.total;
  const darkestUnlit = sight === null ? null : CAN_SEE_FROM - sight.vision;
  const darkestLit = sight === null || sight.lit === null ? null : CAN_SEE_FROM - sight.total;

  return (
    <>
      <KitLine>
        <KitFigure unit={character.race ?? undefined} value={character.className ?? '—'} />
        <KitLevel level={progress.level} />
        <KitFigure
          title={t('cards.self.labels.lives')}
          value={`♥${progress.lives ?? '—'}${progress.cp === null ? '' : ` ${progress.cp}cp`}`}
        />
      </KitLine>
      <KitTiles
        cells={[
          attribute('str', t('cards.self.short.strength'), progress.strength, spans?.strength),
          attribute('int', t('cards.self.short.intellect'), progress.intellect, spans?.intellect),
          attribute('wil', t('cards.self.short.willpower'), progress.willpower, spans?.willpower),
          attribute('agi', t('cards.self.short.agility'), progress.agility, spans?.agility),
          attribute('hea', t('cards.self.short.health'), progress.health, spans?.health),
          attribute('cha', t('cards.self.short.charm'), progress.charm, spans?.charm)
        ]}
      />
      <KitPairs
        cells={[
          {
            key: 'armour',
            label: t('cards.self.labels.armourShort'),
            value: `${progress.armourClass ?? '—'}${progress.damageResist !== null ? ` / ${progress.damageResist}` : ''}`
          },
          ...trained.map((skill) => ({
            key: skill.key,
            label: skill.label,
            title: skill.label,
            value: skill.value === null ? '—' : skill.value.toLocaleString()
          })),
          {
            key: 'vision',
            label: t('cards.self.labels.nightVision'),
            value: sight === null ? '—' : sight.vision
          }
        ]}
      />
      <KitAside>
        {progress.exp !== null && (
          <>
            <b title={progress.exp.toLocaleString()}>{compact(progress.exp)}</b>{' '}
            {t('cards.self.glance.exp')}
            {' · '}
          </>
        )}
        {untrained.length > 0 && (
          <>
            {t('cards.self.glance.untrained', { skills: untrained.join(', ') })}
            {' · '}
          </>
        )}
        {sight?.lit
          ? t('cards.self.sight.litFormat', { item: sight.lit, reach: sight.reach })
          : t('cards.self.sight.nothingLit')}
        {darkestUnlit !== null && (
          <>
            {' · '}
            {t('cards.self.glance.seesTo', {
              depth:
                darkestLit === null
                  ? String(darkestUnlit)
                  : t('cards.self.sight.downToFormat', { unlit: darkestUnlit, lit: darkestLit })
            })}
          </>
        )}
        {seen !== null && (
          <>
            {' · '}
            {t('cards.self.sight.hereFormat', {
              level: level ?? 0,
              seen,
              reading: lightPhrase(seen) ?? t('cards.self.sight.readable')
            })}
          </>
        )}
      </KitAside>
    </>
  );
}
