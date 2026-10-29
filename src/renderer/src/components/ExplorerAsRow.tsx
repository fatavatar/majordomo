/**
 * The Explorer's top row (2026-10-29): who it answers for, as MME's global
 * fields have it along the top of its window (`cmbGlobalClass`,
 * `cmbGlobalRace`, `txtGlobalLevel`, `cmbGlobalAlignment`).
 *
 * Each field shows the character as played until it is changed, and then
 * what it was changed to, marked: the realm read for another class or a
 * higher level. Sync puts every field back and asks the realm for the stat
 * sheet and pack again (`Invoke.explorerSync`). In the Explorer's own window
 * a chooser leads the row, so one window serves every character.
 */
import { useEffect, useState } from 'react';

import {
  DEFAULT_EXPLORER_OPTIONS,
  EXPLORER_ALIGNMENTS,
  type ExplorerAlignment,
  type ExplorerAs,
  type ExplorerKind,
  type ExplorerList,
  type ExplorerOptions
} from '@shared/explorer';
import type { SessionId } from '@shared/ipc';
import { keepFocus } from '../lib/focus';
import { t } from '../lib/i18n';
import { Field } from './ExplorerFields';

/** A character the chooser offers. */
export interface ExplorerCharacter {
  id: SessionId;
  name: string;
}

export interface ExplorerAsRowProps {
  session: SessionId;
  /** Who it answers for where not as played; each field null is the character's own. */
  as: ExplorerAs | null;
  /** The character as played. */
  own: ExplorerAs;
  setAs(as: ExplorerAs | null): void;
  sync(): void;
  /** The realm's classes and races, from the Explorer's own lists. */
  list(kind: ExplorerKind, options: ExplorerOptions): Promise<ExplorerList>;
  /** The chooser's characters, in the Explorer's own window; absent over the console. */
  characters?: readonly ExplorerCharacter[];
  onCharacter?: (id: SessionId) => void;
}

const NOBODY: ExplorerAs = { className: null, race: null, level: null, alignment: null };

const ALIGNMENT_LABEL: Record<ExplorerAlignment, () => string> = {
  any: () => t('explorer.as.alignments.any'),
  good: () => t('explorer.as.alignments.good'),
  neutral: () => t('explorer.as.alignments.neutral'),
  evil: () => t('explorer.as.alignments.evil')
};

export function ExplorerAsRow({
  session,
  as,
  own,
  setAs,
  sync,
  list,
  characters,
  onCharacter
}: ExplorerAsRowProps) {
  // The realm's classes and races, by name, which do not change under a character.
  const [names, setNames] = useState<{ classes: string[]; races: string[] }>({
    classes: [],
    races: []
  });
  useEffect(() => {
    let live = true;
    const names = (kind: ExplorerKind): Promise<string[]> =>
      list(kind, DEFAULT_EXPLORER_OPTIONS).then((found) =>
        found.rows.map((row) => row.name).sort((a, b) => a.localeCompare(b))
      );
    void Promise.all([names('classes'), names('races')]).then(([classes, races]) => {
      if (live) setNames({ classes, races });
    });
    return () => {
      live = false;
    };
  }, [list, session]);

  /** One field changed: back to null where it is the character's own again. */
  const change = <K extends keyof ExplorerAs>(key: K, value: ExplorerAs[K]): void => {
    const next = { ...(as ?? NOBODY), [key]: value === own[key] ? null : value };
    setAs(Object.values(next).every((field) => field === null) ? null : next);
  };
  const shown = <K extends keyof ExplorerAs>(key: K): ExplorerAs[K] => as?.[key] ?? own[key];
  const changed = (key: keyof ExplorerAs): 'true' | undefined =>
    as !== null && as[key] !== null ? 'true' : undefined;

  // The level as typed, put to the Explorer when it is left or Enter is pressed.
  const level = shown('level');
  const [typed, setTyped] = useState(level === null ? '' : String(level));
  useEffect(() => setTyped(level === null ? '' : String(level)), [level]);
  const commitLevel = (): void => {
    const n = Number.parseInt(typed, 10);
    if (Number.isInteger(n) && n > 0) change('level', Math.min(n, 9999));
    else setTyped(level === null ? '' : String(level));
  };

  /** A dropdown of the realm's names, the one shown first where the realm has no such name. */
  const named = (key: 'className' | 'race', all: readonly string[]) => {
    const value = shown(key) ?? '';
    const options = value === '' || all.includes(value) ? all : [value, ...all];
    return (
      <select
        data-as={changed(key)}
        onChange={(event) => change(key, event.target.value === '' ? null : event.target.value)}
        value={value}
      >
        {value === '' && <option value="">{t('explorer.as.unknown')}</option>}
        {options.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    );
  };

  return (
    <div className="ex-as" data-as={as === null ? undefined : 'true'}>
      {characters !== undefined && onCharacter !== undefined && (
        <Field label={t('explorer.as.character')}>
          <select onChange={(event) => onCharacter(event.target.value)} value={session}>
            {characters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label={t('explorer.as.className')}>{named('className', names.classes)}</Field>
      <Field label={t('explorer.as.race')}>{named('race', names.races)}</Field>
      <Field label={t('explorer.as.level')}>
        <input
          data-as={changed('level')}
          inputMode="numeric"
          onBlur={commitLevel}
          onChange={(event) => setTyped(event.target.value.replace(/\D/g, ''))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitLevel();
          }}
          style={{ width: '4.5em' }}
          value={typed}
        />
      </Field>
      <Field label={t('explorer.as.alignment')}>
        <select
          data-as={changed('alignment')}
          onChange={(event) =>
            change('alignment', EXPLORER_ALIGNMENTS.find((a) => a === event.target.value) ?? null)
          }
          value={shown('alignment') ?? 'any'}
        >
          {EXPLORER_ALIGNMENTS.map((a) => (
            <option key={a} value={a}>
              {ALIGNMENT_LABEL[a]()}
            </option>
          ))}
        </select>
      </Field>
      <span className="ex-as-note">
        {as === null ? t('explorer.as.asPlayed') : t('explorer.as.viewing')}
      </span>
      <button
        className="ex-btn"
        onClick={sync}
        onMouseDown={keepFocus}
        title={t('explorer.as.syncTitle')}
        type="button"
      >
        {t('explorer.as.sync')}
      </button>
    </div>
  );
}
