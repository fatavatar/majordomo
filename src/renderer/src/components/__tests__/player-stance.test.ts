// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { PlayerStanceRow } from '../PlayerFlyout';
import type { MegaPlayerMark, PlayerStance } from '@shared/remotes';

/*
 * MegaMUD's relationship on the Player flyout (2026-11-10): Skinny's room
 * spell read as PvP marked him Fatty's enemy, in the engine's memory only,
 * and nothing in the client showed it or could take it back.
 */
function draw(mark: MegaPlayerMark | null, saved?: PlayerStance) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const set: Array<[string, string]> = [];
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() =>
    root.render(
      createElement(PlayerStanceRow, {
        name: 'Skinny',
        character: 'Fatty',
        mark,
        saved,
        onStance: (name: string, stance: string) => set.push([name, stance])
      })
    )
  );
  return { host, set, unmount: () => act(() => root.unmount()) };
}

describe('the Player flyout’s MegaMUD relationship', () => {
  it('shows a mark a blow made, says so, and clears it to unknown', () => {
    const { host, set, unmount } = draw({ name: 'Skinny', stance: 'enemy', attacked: true });
    const select = host.querySelector('select')!;
    expect(select.value).toBe('enemy');
    expect(host.querySelector('.settings-warn')?.textContent).toContain('Skinny attacked Fatty');
    act(() => {
      select.value = 'unknown';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(set).toEqual([['Skinny', 'unknown']]);
    unmount();
  });

  it('reads a chosen stance as chosen, with no warning, and unknown where there is none', () => {
    const chosen = draw({ name: 'Skinny', stance: 'friend', attacked: true }, 'friend');
    expect(chosen.host.querySelector('select')!.value).toBe('friend');
    expect(chosen.host.querySelector('.settings-warn')).toBeNull();
    chosen.unmount();
    const none = draw(null);
    expect(none.host.querySelector('select')!.value).toBe('unknown');
    expect([...none.host.querySelectorAll('option')].map((o) => o.value)).toEqual([
      'unknown',
      'friend',
      'enemy',
      'run',
      'hangup'
    ]);
    none.unmount();
  });
});
