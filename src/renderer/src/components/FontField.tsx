import { useEffect, useState } from 'react';

import FormField, { TextField } from './FormField';
import { t } from '../lib/i18n';
import {
  BUNDLED_FONTS,
  chosenFace,
  installedFaces,
  installedFacesOnPress,
  type InstalledFaces
} from '../lib/fontChoices';

/** The select's own value for "type one in", which no family can be. */
const OTHER = '\u0000other';

export interface FontFieldProps {
  label: string;
  name: string;
  hint?: string;
  /** The setting as the draft holds it: a family, or a stack typed under "Other…". */
  value: string;
  onChange: (value: string) => void;
  /** The console takes fixed-pitch faces only; the interface takes any. */
  kind: 'console' | 'interface';
  /** What an empty value means, offered first where empty is allowed. */
  blankLabel?: string;
  inputRef?: React.RefObject<HTMLInputElement>;
}

/**
 * A font setting as a choice (2026-11-01): the faces that come with the client,
 * the ones this machine has, and "Other…" for a stack typed by hand, which
 * opens the box the field used to be. See `fontChoices.ts`.
 */
export default function FontField({
  label,
  name,
  hint,
  value,
  onChange,
  kind,
  blankLabel,
  inputRef
}: FontFieldProps): React.JSX.Element {
  const [faces, setFaces] = useState<InstalledFaces | null>(null);
  useEffect(() => {
    let live = true;
    void installedFaces().then((found) => {
      if (live) setFaces(found);
    });
    return () => {
      live = false;
    };
  }, []);

  const local = faces === null ? [] : kind === 'console' ? faces.monospace : faces.all;
  const chosen = chosenFace(value, [...BUNDLED_FONTS, ...local]);
  // "Other…" is held open once picked, so the box does not vanish while it is
  // still empty or still names a face the lists happen to have.
  const [typing, setTyping] = useState(false);
  const blank = blankLabel !== undefined && value.trim() === '';
  const other = typing || (!blank && chosen === null);
  const selected = blank ? '' : other ? OTHER : chosen!;

  return (
    <>
      <FormField hint={hint} label={label} name={name}>
        {({ describedBy }) => (
          <select
            aria-describedby={describedBy}
            onMouseDown={() => {
              void installedFacesOnPress()?.then(setFaces);
            }}
            onChange={(event) => {
              const next = event.target.value;
              setTyping(next === OTHER);
              if (next !== OTHER) onChange(next);
            }}
            value={selected}
          >
            {blankLabel !== undefined && <option value="">{blankLabel}</option>}
            <optgroup label={t('settings.client.appearance.fontsBundled')}>
              {BUNDLED_FONTS.map((face) => (
                <option key={face} value={face}>
                  {face}
                </option>
              ))}
            </optgroup>
            {local.length > 0 && (
              <optgroup label={t('settings.client.appearance.fontsInstalled')}>
                {local.map((face) => (
                  <option key={face} value={face}>
                    {face}
                  </option>
                ))}
              </optgroup>
            )}
            <option value={OTHER}>{t('settings.client.appearance.fontsOther')}</option>
          </select>
        )}
      </FormField>
      {other && (
        <TextField
          inputRef={inputRef}
          label={t('settings.client.appearance.fontsOtherLabel')}
          name={`${name}-other`}
          onChange={onChange}
          placeholder={t('settings.client.appearance.fontsOtherPlaceholder')}
          spellCheck={false}
          value={value}
          wide
        />
      )}
    </>
  );
}
