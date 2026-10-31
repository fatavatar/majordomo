import { createContext, useContext, useRef, type ReactNode } from 'react';

/** Whether the part of a screen this is drawn in is shown (`Kept`); true outside any. */
export const KeptShown = createContext(true);

/**
 * A part of a screen put away rather than taken down (2026-10-30): mounted the
 * first time it is shown, then kept, with whatever it holds, and not drawn
 * again until it is shown again, so it keeps its place and does not ask main
 * again for a character that moved on while it was away. What it was last
 * drawn with is drawn again unchanged, which React passes over; only what
 * reads `KeptShown`, such as a key handler of the whole window, hears that it
 * was put away. The Explorer's tabs swapped for one another, where each was
 * taken down and every list, search and calculator started again from nothing.
 */
export function Kept({ shown, children }: { shown: boolean; children: ReactNode }) {
  const within = useContext(KeptShown);
  const last = useRef<ReactNode>(null);
  if (shown) last.current = children;
  return (
    <KeptShown.Provider value={within && shown}>
      <div className="kept" hidden={!shown}>
        {last.current}
      </div>
    </KeptShown.Provider>
  );
}
