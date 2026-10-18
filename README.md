# Assets for the Oxygen MCP pull requests

Not code: recordings, references and the proof-of-concept effects shown in
[dev-hydrogen/oxygen](https://github.com/dev-hydrogen/oxygen) and
[dev-hydrogen/oxygen-wintersky](https://github.com/dev-hydrogen/oxygen-wintersky) pull requests from `avtara`.
Every effect here was made by a coding agent through the Oxygen MCP server (`create_effect`, `edit_effect`,
`write_effect`, `check_effect`, `preview_effect`, `open_in_editor`), from the reference next to it.

| Path | What it is |
| --- | --- |
| `media/black-hole-and-galaxy.{gif,mp4}` | The black hole and spiral galaxy open in Oxygen desktop |
| `media/sao-death.{gif,mp4}` | The SAO death effect (holographic Steve shattering) in Oxygen desktop |
| `references/black-hole-reference.png` | The picture the black hole was made from |
| `references/sao-death-reference.gif` | The animation the SAO death effect was made from |
| `poc/particles/*.json` | The three effects (`poc:galaxy`, `poc:black_hole`, `poc:sao_death`) |
| `poc/textures/particle/sao_death.png` | The SAO effect's texture: wireframe grid, triangle shard, glow |
| `poc/previews/*.png` | `preview_effect` output; `spiral-galaxy-before-fix.png` / `spiral-galaxy-after-fix.png` are the unmodified `spiral_galaxy` example, same camera and time, before and after the paused-redraw fix |

To try the effects, copy `poc/` into a resource pack (`particles/` and `textures/`) and open the JSON files in
Oxygen.
