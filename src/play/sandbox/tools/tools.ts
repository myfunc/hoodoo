import { Colour } from './colour';
import { Decal } from './decal';
import { BallSocket, NoCollide, Weld } from './constraints';
import { MaterialTool } from './material';
import { Remover } from './remover';
import { Resize } from './resize';
import { TerrainTool } from './terrain';
import type { Tool } from './tool';

/** The Tool Gun's tools, in the Tools column's order: Constraints, Construction, then Render. */
export const createTools = (): Tool[] => [new Weld(), new BallSocket(), new NoCollide(), new Remover(), new Resize(), new TerrainTool(), new Colour(), new MaterialTool(), new Decal()];
