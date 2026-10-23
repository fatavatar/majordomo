/**
 * What MegaMUD's BBS set-up (`<DataDir>\BBS\<name>\BBS.INI`, read by
 * `0x41bcf0`, 2026-10-13) tells the engine about a realm: its menu prompt, the
 * log-off and relog commands, the speech and broadcast prefixes, the BBS's
 * own talk lines and its limits. The file's section is the BBS's own name.
 *
 * Kept on the realm (`server.yaml`'s `bbs:`), as every other fact about a
 * place is: no MegaMUD file is read for it. The address, port and log-on
 * prompts `BBS.INI` also holds are the realm's host, port and menu script
 * already; `RunicName` is its `coins: runic`.
 */
/** The keys the engine reads, with MegaMUD's loader's default for each. */
export const BBS_KEYS = [
  { key: 'MenuPrompt', fallback: '[MAJORMUD]:' },
  { key: 'LogoffCmd', fallback: '' },
  { key: 'RelogCmd', fallback: ';relog' },
  { key: 'AnsiCmd', fallback: '=a' },
  { key: 'SpeechPrefix', fallback: '.' },
  { key: 'BroadcastPrefix', fallback: "'" },
  { key: 'LogonMsg', fallback: 'logs ON' },
  { key: 'LogoffMsg', fallback: 'logs OFF' },
  { key: 'ShutDownMsg', fallback: 'Please finish up and log off' },
  { key: 'BroadcastMsg', fallback: 'Broadcast' },
  { key: 'Global1Msg', fallback: '--Unused--' },
  { key: 'Global1Two', fallback: '0' },
  { key: 'Global2Msg', fallback: '--Unused--' },
  { key: 'Global2Two', fallback: '0' },
  { key: 'Global3Msg', fallback: '--Unused--' },
  { key: 'Global3Two', fallback: '0' },
  { key: 'MaxInputSize', fallback: '127' },
  { key: 'PvpLevel', fallback: '99' },
  { key: 'MaxHrsPerDay', fallback: '24' }
] as const;

export type BbsKey = (typeof BBS_KEYS)[number]['key'];

/** A realm's BBS set-up as written: only the keys it states. */
export type BbsSettings = Readonly<Partial<Record<BbsKey, string>>>;

function bbsKey(name: string): BbsKey | null {
  const lower = name.toLowerCase();
  return BBS_KEYS.find((entry) => entry.key.toLowerCase() === lower)?.key ?? null;
}

/** `bbs:` as written, keeping only the keys the engine reads, each as text. */
export function asBbsSettings(value: unknown): BbsSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: Partial<Record<BbsKey, string>> = {};
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    const key = bbsKey(name);
    if (key === null) continue;
    if (typeof raw === 'string') out[key] = raw;
    else if (typeof raw === 'number' && Number.isFinite(raw)) out[key] = String(raw);
  }
  return out;
}
