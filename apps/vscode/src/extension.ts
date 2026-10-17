import * as vscode from 'vscode';
import { OxygenEditorProvider } from './editorProvider';
import { ParticleLanguage } from './language';
import { isParticleDocument, PackIndex } from './pack';
import { PreviewViewProvider } from './previewView';
import { DIFF_SCHEME, diffContentProvider, showSemanticDiff } from './semanticDiff';

export function activate(context: vscode.ExtensionContext): void {
	const pack = new PackIndex(vscode.Uri.joinPath(context.extensionUri, 'dist', 'vanilla'), vscode.Uri.joinPath(context.extensionUri, 'dist', 'examples'));
	const editor = new OxygenEditorProvider(context, pack);
	const preview = new PreviewViewProvider(context, pack);
	const options = { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true };

	const updateContext = () => {
		const doc = vscode.window.activeTextEditor?.document;
		const tab = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
		const custom = tab instanceof vscode.TabInputCustom && tab.uri.path.endsWith('.json');
		void vscode.commands.executeCommand('setContext', 'oxygen.particleFileActive', custom || (!!doc && isParticleDocument(doc)));
	};

	context.subscriptions.push(
		pack,
		preview,
		new ParticleLanguage(pack),
		vscode.window.registerCustomEditorProvider('oxygen.particleEditor', editor, options),
		vscode.window.registerCustomEditorProvider('oxygen.particleEditor.option', editor, options),
		vscode.window.registerWebviewViewProvider('oxygen.preview', preview, { webviewOptions: { retainContextWhenHidden: true } }),
		vscode.window.onDidChangeActiveTextEditor(updateContext),
		vscode.window.tabGroups.onDidChangeTabs(updateContext),
		vscode.commands.registerCommand('oxygen.openInOxygen', async (uri?: vscode.Uri) => {
			const target = uri ?? vscode.window.activeTextEditor?.document.uri;
			if (target) await vscode.commands.executeCommand('vscode.openWith', target, target.path.endsWith('.particle.json') ? 'oxygen.particleEditor' : 'oxygen.particleEditor.option');
		}),
		vscode.commands.registerCommand('oxygen.openAsText', async (uri?: vscode.Uri) => {
			const tab = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
			const target = uri ?? (tab instanceof vscode.TabInputCustom ? tab.uri : undefined);
			if (target) await vscode.commands.executeCommand('vscode.openWith', target, 'default');
		}),
		...(['code', 'editor'] as const).map((name) =>
			vscode.commands.registerCommand(`oxygen.${name}Mode`, async (uri?: vscode.Uri) => {
				const tab = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
				const target = uri ?? (tab instanceof vscode.TabInputCustom ? tab.uri : vscode.window.activeTextEditor?.document.uri);
				if (!target) return;
				// an editor that isn't open yet picks the layout up when its webview is ready
				if (!editor.layout(target, name)) await vscode.commands.executeCommand('oxygen.openInOxygen', target);
			}),
		),
		vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, diffContentProvider),
		vscode.commands.registerCommand('oxygen.semanticDiff', showSemanticDiff),
		vscode.commands.registerCommand('oxygen.openExample', (name?: string) => (typeof name === 'string' ? pack.examples.open(name) : pack.examples.pick())),
		vscode.commands.registerCommand('oxygen.showPreview', async () => {
			const doc = vscode.window.activeTextEditor?.document;
			if (doc && isParticleDocument(doc)) preview.show(doc);
			await vscode.commands.executeCommand('oxygen.preview.focus');
		}),
	);
	updateContext();
}

export function deactivate(): void {}
