/**
 * The area a whole-area map is showing, and the way to the levels above and
 * below it — one pair for every map drawn an area at a time (the Map card and
 * the loop builder, 2026-10-26), so the two say and step levels alike.
 */
import { keepFocus } from '../lib/focus';
import { t } from '../lib/i18n';
import { levelBeside, levelNumber, type AreaMap } from '@shared/map';

/** The header chip: `Obsidian Fortress · 2/5`, the area alone where it has one level. */
export function AreaBadge({ shown }: { shown: AreaMap | null }) {
  if (shown === null) return null;
  return (
    <span
      className="chip off"
      title={t('cards.map.badgeAreaTooltip', {
        areaName: shown.area.name,
        roomCount: shown.cells.length,
        areaRooms: shown.area.rooms
      })}
    >
      {shown.levels.length > 1
        ? t('cards.map.badgeAreaLevel', {
            areaName: shown.area.name,
            level: levelNumber(shown),
            levels: shown.levels.length
          })
        : shown.area.name}
    </span>
  );
}

/**
 * ▲ and ▼: the level above or below, centred where the eye is (`onLevel`
 * with the room drawn at the centre and the level). Off at either end.
 */
export function LevelKeys({
  shown,
  onLevel
}: {
  shown: AreaMap | null;
  onLevel: (room: string, level: number) => void;
}) {
  const centre = shown?.centre ?? null;
  const key = (by: -1 | 1, label: string, glyph: string) => {
    const level = levelBeside(shown, by);
    return (
      <button
        aria-label={label}
        className="quiet builder-key"
        disabled={level === null || centre === null}
        onClick={() => {
          if (level !== null && centre !== null) onLevel(centre, level);
        }}
        onMouseDown={keepFocus}
        title={label}
        type="button"
      >
        {glyph}
      </button>
    );
  };
  return (
    <>
      {key(-1, t('cards.map.levelUp'), '▲')}
      {key(1, t('cards.map.levelDown'), '▼')}
    </>
  );
}
