import * as vscode from 'vscode';
import { parentInputsFor, spawnsOf, type EffectSpawns } from '@oxygen/effect';

interface Example {
	/** file name without `.particle.json` */
	name: string;
	identifier: string;
	text: string;
}

/**
 * The example effects bundled with the extension (dist/examples). An example opens as a new untitled document
 * named after it, so it can be edited and saved into a pack. What an example spawns is another example.
 */
export class Examples {
	private list: Promise<Example[]> | null = null;

	constructor(private dir: vscode.Uri) {}

	all(): Promise<Example[]> {
		this.list ??= (async () => {
			const out: Example[] = [];
			try {
				for (const [file, type] of await vscode.workspace.fs.readDirectory(this.dir)) {
					if (type !== vscode.FileType.File || !file.endsWith('.particle.json')) continue;
					const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.dir, file)));
					const identifier = /"identifier"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? '';
					out.push({ name: file.replace('.particle.json', ''), identifier, text });
				}
			} catch {
				// no bundled examples (a development build without them)
			}
			return out.sort((a, b) => a.name.localeCompare(b.name));
		})();
		return this.list;
	}

	async byName(name: string): Promise<Example | null> {
		return (await this.all()).find((e) => e.name === name) ?? null;
	}

	async byIdentifier(identifier: string): Promise<Example | null> {
		return (await this.all()).find((e) => e.identifier === identifier) ?? null;
	}

	/** Variables the examples set in their pre-effects for an effect they spawn */
	async parentInputs(identifier: string): Promise<Record<string, string>> {
		const spawns: EffectSpawns[] = [];
		for (const e of await this.all()) {
			try {
				const s = spawnsOf(JSON.parse(e.text));
				if (s) spawns.push(s);
			} catch {
				// not JSON: skip
			}
		}
		return parentInputsFor(spawns, identifier);
	}

	/** Open an example as a new untitled document in Oxygen (reusing it if it's already open) */
	async open(name: string): Promise<boolean> {
		const example = await this.byName(name);
		if (!example) return false;
		const uri = vscode.Uri.from({ scheme: 'untitled', path: `${name}.particle.json` });
		const doc = await vscode.workspace.openTextDocument(uri);
		if (!doc.getText()) {
			const edit = new vscode.WorkspaceEdit();
			edit.insert(uri, new vscode.Position(0, 0), example.text);
			await vscode.workspace.applyEdit(edit);
		}
		await vscode.commands.executeCommand('vscode.openWith', uri, 'oxygen.particleEditor');
		return true;
	}

	/** Pick an example from a list and open it */
	async pick(): Promise<void> {
		const items = (await this.all()).map((e) => ({ label: e.name.replace(/_/g, ' '), description: e.identifier, name: e.name }));
		if (!items.length) {
			void vscode.window.showWarningMessage('This build of Oxygen has no examples.');
			return;
		}
		const chosen = await vscode.window.showQuickPick(items, { placeHolder: 'Open an example effect', matchOnDescription: true });
		if (chosen) await this.open(chosen.name);
	}
}
