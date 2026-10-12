/**
 * The functions of megamud.exe the port calls but has not ported yet, each
 * standing in with a neutral answer (0: "did nothing") and counted, so a
 * replayed log says which missing pieces it actually reached. Every call site
 * names the address it stands for; porting it replaces the call.
 */
export const unportedHits = new Map<string, number>();

export function unported(address: string): number {
  unportedHits.set(address, (unportedHits.get(address) ?? 0) + 1);
  return 0;
}
