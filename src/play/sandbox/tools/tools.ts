import { Colour } from './colour';
import { MaterialTool } from './material';
import { Remover } from './remover';
import { Resize } from './resize';
import type { Tool } from './tool';

/** The Tool Gun's tools, in the Tools column's order: Construction, then Render. */
export const createTools = (): Tool[] => [new Remover(), new Resize(), new Colour(), new MaterialTool()];
