# Writing Molang

Every Molang field in Oxygen is a small code editor that knows Bedrock's particle Molang. The same help is
available in VS Code's text editor when the Oxygen extension is installed.

## While you type

- **Completion** (Ctrl+Space, or just start typing) offers queries, maths functions, your effect's variables
  and curves, with a short explanation of each.
- **Hover** over a name to see what it is, what it returns and, while a particle is being inspected, its
  current value.
- **Snippets** for common patterns. Type the name and pick it from the list:
  - `index`: give each particle its own number (a counter), the usual way to lay particles out;
  - `latch`: pick a new random value only when something changes;
  - `statemachine`: a timer with a random cooldown;
  - `loop`: a loop with a body;
  - `overflow`: hide particles past a count.

## Problems and quick fixes

Problems are underlined and listed in the Problems panel, explained in terms of what the game will do, for
example "this reads `v.size` before anything sets it, so the whole expression reads 0".

Many problems come with a quick fix. Hover the underline and click the fix (in VS Code, press Ctrl+.):

- a misspelled query or maths function: change it to the closest real one;
- a value field that never returns anything: add `return` to the last statement;
- a variable that might not be set yet: read it as `v.name ?? 0` instead;
- a chained `? :` or mixed `&&` and `||` that the game groups differently from what you'd expect: add brackets
  that spell out the game's grouping.

## Refactors

These change your effect without changing what it does.

| Do this | How |
| --- | --- |
| Rename a variable everywhere | Put the cursor on it and press F2 |
| Go to where a variable is set | F12, or Ctrl+click it |
| List everywhere a variable is used | Shift+F12 (the list opens in the Expression panel) |
| Compute a repeated piece once | In the Expression panel, select the piece, name the new variable and press Extract |
| Move statements to another phase | In the Expression panel, select whole statements (ending in `;`), pick where they go and press Move |
| Tidy the layout of an expression | Shift+Alt+F (saved back on one line, as the game expects) |
| Add a note | Ctrl+/ comments the line |

**Extract** is most useful for vectors. When X, Y and Z repeat the same calculation, Extract computes it once in
X (which runs first) and replaces the repeats in X, Y and Z with the new variable.

**Move** is for statements in the wrong phase, for example a calculation in *Every update* that is only needed
when drawing. After a move, check the Problems panel: the moved statements may now read something that isn't
set yet in their new phase.

**Comments** aren't part of Molang, so Oxygen keeps them in the file's `oxygen` block, which the game ignores.
Your particle file stays valid.

## Vectors: X, Y and Z

When a vector's three fields share most of their text, the shared parts are shown dimmed so the differences
stand out. While you edit a field, it shows at full strength.

## Seeing values

- **Value lenses:** while you inspect a particle (click it in the viewport), every name in an expression shows
  the value it had for that particle on the last frame.
- **The value graph:** select a field that changes over time and a small graph of its real values appears under
  it. The Graph panel shows a larger one.
- **The order things run in:** the Expression panel's *Whole effect, in order* view lists every expression in
  the order the game runs them, with what each sets and what reads it later.

The full list of keyboard shortcuts is under Help › Keyboard shortcuts (or press `?`).
