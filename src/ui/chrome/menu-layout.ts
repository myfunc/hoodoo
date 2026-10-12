import { Action } from '../../input/actions';
import { MenuName } from '../../input/bindings';

export const SEP = 'sep' as const;
export type MenuEntry = Action | typeof SEP;

/** Menu layout; labels and shortcuts come from the bindings table. The App menu opens from the Hoodoo title. */
export const MENUS: readonly { name: MenuName; items: readonly MenuEntry[] }[] = [
  { name: MenuName.App, items: [Action.About, SEP, Action.Settings, Action.PreviewFeatures, SEP, Action.StartWindow, Action.InstallApp] },
  { name: MenuName.File, items: [Action.StartWindow, Action.New, Action.Open, Action.Save, SEP, Action.CloudOpen, Action.CloudSave, Action.CloudPublish, Action.CloudGallery, Action.CloudAccount, SEP, Action.LoadDemo, Action.SurpriseScene, SEP, Action.DocumentSetup, Action.ExportImage, Action.ExportMovie, Action.CopyImage, Action.ShareLink] },
  { name: MenuName.Edit, items: [Action.Undo, Action.Redo, SEP, Action.Cut, Action.Copy, Action.Paste, Action.Delete, SEP, Action.Duplicate, Action.Replicate, SEP, Action.SelectAll, Action.SelectNone, SEP, Action.CopyMaterial, Action.PasteMaterial] },
  { name: MenuName.Objects, items: [Action.Attributes, Action.EditMaterial, Action.EditObject, Action.ObjectLibrary, SEP, Action.ChooseMaterial, Action.PrevMaterial, Action.NextMaterial, SEP, Action.Group, Action.Ungroup, Action.NewGroup, SEP, Action.MoveSelection, Action.RotateSelection, Action.SizeSelection, SEP, Action.Land, Action.Randomize, SEP, Action.HideSelected, Action.ShowAll] },
  { name: MenuName.View, items: [Action.ViewCamera, Action.ViewDirector, Action.ViewTop, Action.ViewFront, Action.ViewSide, Action.QuadView, SEP, Action.Play, SEP, Action.FrameSelected, Action.FrameAll, Action.ZoomIn, Action.ZoomOut, Action.ResetCamera, Action.CameraFromView, Action.PickFocus, SEP, Action.ToggleLeftPanel, Action.ToggleSidePanel, Action.MaximizeView, Action.ToggleDepthCue, Action.ToggleGrid, Action.ToggleGizmo, Action.ToggleSnap, SEP, Action.ScrollAuto, Action.ScrollWheel, Action.ScrollTrackpad, SEP, Action.Settings, Action.PreviewFeatures] },
  { name: MenuName.Render, items: [Action.Render, Action.StopRender, Action.ClearRender, SEP, Action.ToggleLiveRender, Action.ToggleRenderView, Action.RenderOptions, SEP, Action.TakeSnapshot, Action.CompareSnapshot, SEP, Action.ExportImage, Action.ExportMovie] },
  { name: MenuName.Animation, items: [Action.ToggleAnimation, SEP, Action.PlayPause, Action.FirstFrame, Action.LastFrame, SEP, Action.PrevFrame, Action.NextFrame, Action.PrevKey, Action.NextKey, SEP, Action.AddKey, Action.RemoveKey, Action.KeyCamera, Action.ClearAnimation, SEP, Action.SelectAllKeys, Action.DeleteKeys, SEP, Action.ClosePathLoop, Action.OpenPath, SEP, Action.ToggleLoop, Action.ToggleMotionPaths, Action.AnimationSetup] },
  // Portals and trigger zones have a menu and a window of their own (Owner TO581: not in Objects). Play shows in View too.
  { name: MenuName.Play, items: [Action.Play, SEP, Action.PortalsTriggers, SEP, Action.CreatePortals, Action.LinkPortals, SEP, Action.CreateTriggerZone] },
  { name: MenuName.Help, items: [Action.TutorialBook, SEP, Action.CommandPalette, Action.Shortcuts, SEP, Action.SourceCode, Action.InstallApp, SEP, Action.About] },
];
