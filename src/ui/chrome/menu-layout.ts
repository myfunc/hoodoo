import { Action } from '../../input/actions';
import { MenuName } from '../../input/bindings';

export const SEP = 'sep' as const;
export type MenuEntry = Action | typeof SEP;

/** Menu layout; labels and shortcuts come from the bindings table. */
export const MENUS: readonly { name: MenuName; items: readonly MenuEntry[] }[] = [
  { name: MenuName.File, items: [Action.New, Action.Open, Action.Save, SEP, Action.LoadDemo, Action.SurpriseScene, SEP, Action.DocumentSetup, Action.ExportImage, Action.ExportMovie, Action.CopyImage, Action.ShareLink] },
  { name: MenuName.Edit, items: [Action.Undo, Action.Redo, SEP, Action.Cut, Action.Copy, Action.Paste, Action.Delete, SEP, Action.Duplicate, Action.Replicate, SEP, Action.SelectAll, Action.SelectNone, SEP, Action.CopyMaterial, Action.PasteMaterial] },
  { name: MenuName.Objects, items: [Action.Attributes, Action.EditMaterial, Action.EditObject, Action.ObjectLibrary, SEP, Action.Group, Action.Ungroup, SEP, Action.Land, Action.Randomize, SEP, Action.HideSelected, Action.ShowAll] },
  { name: MenuName.View, items: [Action.ViewCamera, Action.ViewDirector, Action.ViewTop, Action.ViewFront, Action.ViewSide, Action.QuadView, SEP, Action.FrameSelected, Action.FrameAll, Action.ZoomIn, Action.ZoomOut, Action.ResetCamera, Action.CameraFromView, Action.PickFocus, SEP, Action.ToggleSidePanel, Action.ToggleDepthCue, Action.ToggleGrid, Action.ToggleGizmo, Action.ToggleSnap] },
  { name: MenuName.Render, items: [Action.Render, Action.StopRender, Action.ClearRender, SEP, Action.ToggleLiveRender, SEP, Action.TakeSnapshot, Action.CompareSnapshot, SEP, Action.ExportImage, Action.ExportMovie] },
  { name: MenuName.Help, items: [Action.CommandPalette, Action.Shortcuts, SEP, Action.SourceCode, Action.InstallApp, SEP, Action.About] },
];
