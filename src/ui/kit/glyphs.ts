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
} as const;
