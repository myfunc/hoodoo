import { describe, expect, it } from 'vitest';
import { parseSpawnlist } from '../spawnlists';

const LIST = `"TableToKeyValues"
{
	"parentid"		"0"
	"icon"		"icon16/page.png"
	"id"		"1"
	"contents"
	{
		"2" { "type" "model" "model" "models/Props_C17/oildrum001.mdl" "skin" "1" }
		"1" { "type" "header" "text" "Barrels" }
		"3" { "type" "model" "model" "models/props_junk/wood_crate001a.mdl" }
	}
	"name"		"Construction Props"
	"version"		"3"
}`;

describe("Garry's Mod spawnlists", () => {
  it("reads a list's name, place in the tree and contents in order, model paths in lower case", () => {
    const l = parseSpawnlist(LIST);
    expect(l).toMatchObject({ id: 1, parent: 0, name: 'Construction Props', icon: 'icon16/page.png' });
    expect(l?.entries).toEqual([
      { kind: 'header', value: 'Barrels', skin: 0 },
      { kind: 'model', value: 'models/props_c17/oildrum001.mdl', skin: 1 },
      { kind: 'model', value: 'models/props_junk/wood_crate001a.mdl', skin: 0 },
    ]);
  });
});
