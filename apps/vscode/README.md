# Oxygen for VS Code

An editor for Minecraft Bedrock particle effects whose preview behaves the way the game does, quirks included,
so what you see while you work is what players will see. Oxygen's engine was checked against Minecraft behaviour
by behaviour.

## In the editor

`*.particle.json` files open in Oxygen; other JSON files under a pack's `particles/` folder can be opened with
**Open in Oxygen**. **Open example…** (also in the editor's Examples menu) opens one of the bundled example effects
as a new untitled file: edit it, then save it into your pack.

- An inspector with every component, by category or in evaluation order, and a live 3D preview you can click to
  inspect a particle, step through, and scrub back in time.
- Molang editors with completion, hover docs, signature help, quick fixes, rename (F2), go to where a variable is
  set (F12) and list its uses (Shift+F12).
- The Context panel for everything the effect reads from outside: variables, queries, a pre-effect script, and
  named scenarios.
- Panels for events (a graph of the effect and every effect it spawns), the timeline, curves, textures and
  flipbooks, the order everything runs in, and a Vibrant Visuals preview, including making particles glow.
- VS Code owns the document: undo, redo, saving and outside changes all go through it, and the text keeps its
  formatting and key order.

## In the plain JSON editor

Particle files opened as text get Molang highlighting, completion, hover help, problems explained in terms of what
the game does, and quick fixes. **Show preview** opens a preview in the Explorer that follows the active file,
and **Code mode** shows the file as text with a floating preview.

**Show what changed (semantic diff)** compares two versions of an effect component by component instead of line by
line.

## Settings

| Setting | Default | |
|---|---|---|
| `oxygen.theme` | `vscode` | Follow your VS Code theme (`vscode`) or use Oxygen's own night palette (`oxygen`) |
| `oxygen.diagnostics.enabled` | `true` | Molang and particle problems in particle files opened as text |
| `oxygen.semanticHighlighting.enabled` | `true` | Color Molang inside JSON strings |

## License

GPL-3.0-or-later. Oxygen is a fork of [Snowstorm](https://github.com/JannisX11/snowstorm) by JannisX11.
