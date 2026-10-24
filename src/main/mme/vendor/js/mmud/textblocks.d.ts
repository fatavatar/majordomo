/** `mmud/textblocks.js`: a room's script. Ours, beside mudtool's copy. */
/** A line of `commandTree` / `executionTree`: frmResults' tree nodes. */
export interface TbTreeNode {
  /** mudtool's marked-up text (`details.segments`). */
  text: string;
  icon: string;
  ref: { kind: string; n: number | string } | null;
  bold: boolean;
  kids: TbTreeNode[];
}

/** frmResults.CreateCommandTree: what a textblock does. */
export function commandTree(
  n: number,
  options?: { mode?: 'plain' | 'room' | 'greet'; hideTB?: boolean; defaultMap?: number }
): TbTreeNode;

/** frmResults' other tree: what runs a textblock. */
export function executionTree(n: number, options?: { hideTB?: boolean }): TbTreeNode;

/** The commands a room's or an NPC's block answers. */
export function textblockCMDS(n: number, maxLength?: number): string;

/** The rooms a room command (`Rooms.CMD`) moves you to, and the command. */
export function roomTeleports(
  textblock: number,
  map: number
): Array<{ command: string; map: number; room: number }>;
