import fs from 'node:fs';
import path from 'node:path';

const STYLES = path.resolve('src/renderer/src/styles');

/**
 * The window's stylesheet as the build hands it over: `styles/index.css` with
 * each part it imports from `styles/app/` put in its place, in order
 * (2026-11-02). A test asking whether a rule exists asks the whole sheet, so
 * it does not care which part the rule was written in.
 */
export function windowStylesheet(): string {
  const index = fs.readFileSync(path.join(STYLES, 'index.css'), 'utf8');
  return index.replace(/^@import '([^']+)';$/gm, (_line, file: string) =>
    fs.readFileSync(path.join(STYLES, file), 'utf8')
  );
}
