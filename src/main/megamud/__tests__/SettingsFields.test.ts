import { describe, expect, it } from 'vitest';

import { SETTINGS } from '../../../shared/megamud/schema';
import { defaultSettings, settingsFromIni } from '../../../shared/megamud/settings';
import { applySettings, fieldName } from '../fieldNames';
import { SettingsFields } from '../SettingsFields';

describe('the generated settings fields', () => {
  it('are the schema, at its defaults (rerun scripts/gen-megamud-fields.mjs if not)', () => {
    const fields = new SettingsFields() as unknown as Record<string, unknown>;
    const expected: Record<string, unknown> = {};
    for (const def of SETTINGS) {
      const name = fieldName(def);
      if (name) expected[name] = def.default;
    }
    expect({ ...fields }).toEqual(expected);
  });

  it('take a character settings as the loader fills the struct', () => {
    const fields = new SettingsFields();
    applySettings(
      fields,
      settingsFromIni('[Health]\nHpRest%=55\n[Auto-roam]\nAutoMove=3\n'),
      SETTINGS
    );
    expect(fields.Health_HpRestPct).toBe(55);
    expect(fields.Auto_roam_AutoMove).toBe(3);
    expect(fields.Health_HpFullPct).toBe(99);
  });

  it('name a setting as the decompiled struct does', () => {
    const def = SETTINGS.find((d) => d.section === 'Health' && d.key === 'HpFull%')!;
    expect(fieldName(def)).toBe('Health_HpFullPct');
    const settings = defaultSettings();
    expect(settings.live['Health']?.['HpFull%']).toBe(99);
  });
});
