import { formatDiff, semanticDiff } from '@oxygen/format';
import { parse as parseJsonc } from 'jsonc-parser';
import * as vscode from 'vscode';

const SCHEME = 'oxygen-diff';
const reports = new Map<string, string>();

/** Read-only documents holding semantic diff reports */
export const diffContentProvider: vscode.TextDocumentContentProvider = {
	provideTextDocumentContent: (uri) => reports.get(uri.toString()) ?? '',
};
export { SCHEME as DIFF_SCHEME };

async function headVersion(uri: vscode.Uri): Promise<string | null> {
	const git = vscode.extensions.getExtension<{ getAPI(v: 1): { getRepository(uri: vscode.Uri): { show(ref: string, path: string): Promise<string> } | null } }>('vscode.git');
	if (!git) return null;
	const api = (git.isActive ? git.exports : await git.activate()).getAPI(1);
	const repo = api.getRepository(uri);
	if (!repo) return null;
	try {
		return await repo.show('HEAD', uri.fsPath);
	} catch {
		return null;
	}
}

/**
 * What changed in a particle effect, in Oxygen's terms. In a diff editor it compares the two sides;
 * otherwise the file against its last commit.
 */
export async function showSemanticDiff(): Promise<void> {
	const tab = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
	let beforeText: string | null = null;
	let afterText: string | null = null;
	let titleBefore = 'before';
	let titleAfter = 'after';
	let name = 'effect';
	if (tab instanceof vscode.TabInputTextDiff) {
		beforeText = (await vscode.workspace.openTextDocument(tab.original)).getText();
		afterText = (await vscode.workspace.openTextDocument(tab.modified)).getText();
		titleBefore = 'the left side';
		titleAfter = 'the right side';
		name = tab.modified.path.split('/').pop() ?? name;
	} else {
		const uri = tab instanceof vscode.TabInputCustom || tab instanceof vscode.TabInputText ? tab.uri : vscode.window.activeTextEditor?.document.uri;
		if (!uri) return void vscode.window.showInformationMessage('Open a particle file or a diff first.');
		afterText = (await vscode.workspace.openTextDocument(uri)).getText();
		beforeText = await headVersion(uri);
		if (beforeText === null) return void vscode.window.showInformationMessage("This file isn't in a git repository or has no committed version to compare with.");
		titleBefore = 'the last commit';
		titleAfter = 'the working copy';
		name = uri.path.split('/').pop() ?? name;
	}
	const parse = (t: string) => parseJsonc(t, [], { allowTrailingComma: true });
	const report = formatDiff(semanticDiff(parse(beforeText), parse(afterText)), titleBefore, titleAfter);
	const uri = vscode.Uri.from({ scheme: SCHEME, path: `/${name} (changes).txt`, query: String(Date.now()) });
	reports.set(uri.toString(), report);
	await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: true, viewColumn: vscode.ViewColumn.Beside });
}
