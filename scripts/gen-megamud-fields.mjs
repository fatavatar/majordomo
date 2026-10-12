/**
 * Write `src/main/megamud/SettingsFields.ts`: one field per MegaMUD setting,
 * named as the decompiled session struct names it (`Health.HpFull%` is
 * `Health_HpFullPct`), so a function ported from the decompile reads its
 * settings by the same names (docs/megamud/engine-port.md, 2026-10-12).
 *
 *   node --import ./scripts/lib/register.mjs scripts/gen-megamud-fields.mjs
 *
 * The file is checked against the schema by `SettingsFields.test.ts`, so a
 * schema change without a rerun fails the tests rather than drifting.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { SETTINGS } = await import('../src/shared/megamud/schema.ts');
const { fieldName, renderSettingsFields } = await import('../src/main/megamud/fieldNames.ts');

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'src/main/megamud/SettingsFields.ts');
fs.writeFileSync(out, renderSettingsFields(SETTINGS));
console.log(
  `wrote ${path.relative(root, out)}: ${SETTINGS.filter((d) => fieldName(d)).length} fields`
);
