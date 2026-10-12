/** Path data for the few vector marks the interface draws itself. */
export const GLYPH_BOX = '0 0 24 24';
export const GLYPH = {
  check: ['M4 12.5l5 5L20 6.5'],
  cross: ['M6 6l12 12M18 6L6 18'],
  triangleDown: ['M6 9h12l-6 7z'],
  triangleRight: ['M9 6v12l7-6z'],
  arrowDown: ['M12 4v13M6 12l6 6 6-6'],
  eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  lock: ['M7 11V8a5 5 0 0 1 10 0v3', 'M5 11h14v10H5z'],
  dice: ['M4 4h16v16H4z', 'M8.5 8.5h.01M15.5 15.5h.01M15.5 8.5h.01M8.5 15.5h.01M12 12h.01'],
  undo: ['M9 7L4 12l5 5', 'M4 12h11a5 5 0 0 1 0 10h-2'],
  redo: ['M15 7l5 5-5 5', 'M20 12H9a5 5 0 0 0 0 10h2'],
  plus: ['M12 5v14M5 12h14'],
  minus: ['M5 12h14'],
  // Timeline transport (Bryce 3D animation controls).
  toStart: ['M5 5v14', 'M19 5L8 12l11 7z'],
  toEnd: ['M19 5v14', 'M5 5l11 7-11 7z'],
  stepBack: ['M17 5L8 12l9 7z', 'M6 6v12'],
  stepForward: ['M7 5l9 7-9 7z', 'M18 6v12'],
  play: ['M7 4l13 8-13 8z'],
  pause: ['M6 5h4v14H6z', 'M14 5h4v14h-4z'],
  loop: ['M4 12a6 6 0 0 1 6-6h8', 'M15 3l3 3-3 3', 'M20 12a6 6 0 0 1-6 6H6', 'M9 21l-3-3 3-3'],
  keyAdd: ['M9 4l6 6-6 6-6-6z', 'M18 14v8M14 18h8'],
  keyRemove: ['M9 4l6 6-6 6-6-6z', 'M14 18h8'],
  camera: ['M3 8h11v9H3z', 'M14 11l6-3v9l-6-3', 'M6 8V6h5v2'],
  sun: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2'],
  cube: ['M12 3l8 4.5v9L12 21l-8-4.5v-9z', 'M4 7.5l8 4.5 8-4.5M12 12v9'],
  clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7v5l3 2'],
  /** The animation switch: a strip of film. */
  film: ['M5 3h14v18H5z', 'M9 3v18M15 3v18', 'M5 7.5h4M5 12h4M5 16.5h4M15 7.5h4M15 12h4M15 16.5h4'],
  // Display palette and history marks.
  quad: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
  live: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M12 1v2M4.5 3.5l1.4 1.4M19.5 3.5l-1.4 1.4'],
  grid: ['M3 8h18M3 16h18M8 3v18M16 3v18'],
  depthCue: ['M3 6h18', 'M6 11h12', 'M9 16h6', 'M11 20h2'],
  handles: ['M6 18V5', 'M6 18h13', 'M6 18l-3.5 3.5', 'M3.5 7.5L6 5l2.5 2.5', 'M16.5 15.5L19 18l-2.5 2.5'],
  snap: ['M6 4v7a6 6 0 0 0 12 0V4', 'M6 4h3v7a3 3 0 0 0 6 0V4h3', 'M6 8h3M15 8h3'],
  /** Render View: a framed picture, a hill and the sun, as the final render shows. */
  picture: ['M3 5h18v14H3z', 'M3 16l5-5 4 4 3-3 6 6', 'M16 9h.01'],
  /** Render Options: two sliders. */
  sliders: ['M4 7h16M4 17h16', 'M9 4v6M15 14v6'],
  frame: ['M4 9V4h5', 'M15 4h5v5', 'M20 15v5h-5', 'M9 20H4v-5', 'M9 9h6v6H9z'],
  panel: ['M3 4h18v16H3z', 'M15 4v16', 'M17 8h2M17 11h2M17 14h2'],
  /** Four corners pushed outward: the scene window fills the workspace. */
  maximize: ['M4 9V4h5', 'M15 4h5v5', 'M20 15v5h-5', 'M9 20H4v-5', 'M4 4l6 6', 'M20 4l-6 6', 'M20 20l-6-6', 'M4 20l6-6'],
  move: ['M12 3v18M3 12h18', 'M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3'],
  rotate: ['M20 12a8 8 0 1 1-2.3-5.6', 'M20 4v4h-4'],
  resize: ['M4 20L20 4', 'M13 4h7v7', 'M11 20H4v-7'],
  ball: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M7 9a5 4 0 0 1 4-3'],
  key: ['M12 4l8 8-8 8-8-8z'],
  open: ['M3 6h6l2 2h10v11H3z'],
  group: ['M4 4h9v9H4z', 'M11 11h9v9h-9z'],
  dot: ['M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  // Boolean modes of Bryce 2: neutral, positive (adds), negative (cuts), intersect.
  neutral: ['M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z'],
  positive: ['M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M12 9v6M9 12h6'],
  negative: ['M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M9 12h6'],
  intersect: ['M9 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12z', 'M15 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12z'],
  /** Play (preview): a figure striding. */
  walk: ['M13.5 2.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z', 'M12.5 8l-2 6.5', 'M7.5 11.5l4.5-3.5 2.5 3.5 3 0.5', 'M10.5 14.5l3 3-0.5 4', 'M10.5 14.5l-2.5 3.5-3.5 1'],
} as const;
