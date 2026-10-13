/**
 * The panels of the right column: Attributes, the scene list, Snapshots and History.
 * They live on the right only; the rail on the right edge (ui/chrome/side-rail.ts)
 * shows or hides each, and the column keeps what was on (`EditorState.sidePanes`, io/prefs.ts).
 */
export enum SidePane {
  Attributes = 'attributes',
  Scene = 'scene',
  Snapshots = 'snapshots',
  History = 'history',
}

export type SidePanes = Readonly<Record<SidePane, boolean>>;

/** Top to bottom, as the column stacks them. */
export const SIDE_PANES: readonly SidePane[] = [SidePane.Attributes, SidePane.Scene, SidePane.Snapshots, SidePane.History];

export const ALL_PANES: SidePanes = { [SidePane.Attributes]: true, [SidePane.Scene]: true, [SidePane.Snapshots]: true, [SidePane.History]: true };

/** Stored or exported panes: a pane missing or malformed stays on. */
export function sidePanesFrom(raw: unknown): SidePanes {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(SIDE_PANES.map((p) => [p, typeof r[p] === 'boolean' ? r[p] : ALL_PANES[p]])) as Record<SidePane, boolean>;
}

export const withPane = (panes: SidePanes, pane: SidePane, on: boolean): SidePanes => ({ ...panes, [pane]: on });

export const anyPane = (panes: SidePanes): boolean => SIDE_PANES.some((p) => panes[p]);

/** The pane that takes the room left over: the scene list, else the snapshots; with neither the stone shows below. */
export function growingPane(panes: SidePanes): SidePane | null {
  if (panes[SidePane.Scene]) return SidePane.Scene;
  return panes[SidePane.Snapshots] ? SidePane.Snapshots : null;
}
