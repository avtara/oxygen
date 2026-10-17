// Runs inside the VS Code extension host
const vscode = require('vscode');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, what, ms = 15000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		const v = await fn();
		if (v) return v;
		await sleep(200);
	}
	throw new Error(`timed out waiting for ${what}`);
}

exports.run = async function run() {
	const results = [];
	const check = (ok, what) => {
		results.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
		if (!ok) results.failed = true;
	};
	const root = vscode.workspace.workspaceFolders[0].uri;
	const flawed = vscode.Uri.joinPath(root, 'RP/particles/flawed.json');
	const sparks = vscode.Uri.joinPath(root, 'RP/particles/sparks.particle.json');

	const ext = vscode.extensions.getExtension('hydrogen.oxygen-particle-editor');
	try {
		await ext.activate();
		check(ext.isActive, 'the extension activates');
	} catch (e) {
		console.log('activation failed:', e && e.stack);
		throw e;
	}

	// lite mode: particle JSON as text gets Oxygen's diagnostics, completion and hover
	const doc = await vscode.workspace.openTextDocument(flawed);
	await vscode.window.showTextDocument(doc);
	const diags = await waitFor(() => {
		const d = vscode.languages.getDiagnostics(flawed).filter((x) => x.source === 'Oxygen');
		return d.length ? d : null;
	}, 'diagnostics');
	check(diags.some((d) => /ignores this whole field/.test(d.message)), `a broken expression says what the game does with it (${diags.map((d) => d.message).join(' | ')})`);
	check(diags.some((d) => /Nothing sets v\.count/.test(d.message)), 'reading a never-set variable is reported');
	const neverSet = diags.find((d) => /Nothing sets v\.count/.test(d.message));
	check(neverSet && doc.getText(neverSet.range) === 'v.count', 'the diagnostic covers exactly the variable in the string');

	const actions = await vscode.commands.executeCommand('vscode.executeCodeActionProvider', flawed, neverSet.range);
	const guard = actions.find((a) => /\?\? 0/.test(a.title));
	check(!!guard, `a quick fix guards the unset variable (${actions.map((a) => a.title).join(' | ')})`);
	if (guard) {
		await vscode.workspace.applyEdit(guard.edit);
		check(doc.getText().includes('(v.count ?? 0)'), 'applying it rewrites only the variable inside the Molang string');
		await vscode.commands.executeCommand('undo');
	}

	const text = doc.getText();
	const at = doc.positionAt(text.indexOf('v.particle_age') + 2);
	const list = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', flawed, at);
	check(list.items.some((i) => (typeof i.label === 'string' ? i.label : i.label.label) === 'particle_age'), 'completion offers built-in variables inside Molang strings');
	const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', flawed, at);
	const hoverText = hovers.flatMap((h) => h.contents.map((c) => (typeof c === 'string' ? c : c.value))).join(' ').replace(/[\\]/g, '');
	check(hoverText.includes('Seconds since this particle'), `hover documents variables (${hoverText.slice(0, 160)})`);

	// the custom editor opens *.particle.json
	await vscode.commands.executeCommand('vscode.openWith', sparks, 'oxygen.particleEditor');
	const tab = await waitFor(() => {
		const t = vscode.window.tabGroups.activeTabGroup.activeTab;
		return t && t.input instanceof vscode.TabInputCustom ? t : null;
	}, 'custom editor tab');
	check(tab.input.viewType === 'oxygen.particleEditor', 'Oxygen opens as the editor for .particle.json');

	// an example opens as a new untitled document in Oxygen
	await vscode.commands.executeCommand('oxygen.openExample', 'finale_launcher');
	const exampleTab = await waitFor(() => {
		const t = vscode.window.tabGroups.activeTabGroup.activeTab;
		return t && t.input instanceof vscode.TabInputCustom && t.input.uri.scheme === 'untitled' ? t : null;
	}, 'example tab');
	const exampleDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === exampleTab.input.uri.toString());
	check(exampleTab.input.viewType === 'oxygen.particleEditor' && /oxygen:finale_launcher/.test(exampleDoc?.getText() ?? ''), `Open example opens it in Oxygen as an untitled document (${exampleTab.input.uri.toString()})`);

	// semantic diff between the two sides of a diff editor
	await vscode.commands.executeCommand('vscode.diff', flawed, sparks, 'flawed ↔ sparks');
	await waitFor(() => vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputTextDiff, 'diff editor');
	await vscode.commands.executeCommand('oxygen.semanticDiff');
	const report = await waitFor(() => vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'oxygen-diff'), 'semantic diff report');
	check(/^Changes from the left side to the right side/.test(report.getText()), `the semantic diff reports what changed (${report.getText().split('\n').slice(0, 3).join(' | ')})`);

	console.log(results.join('\n'));
	if (results.failed) throw new Error('some checks failed');
};
