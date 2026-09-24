import * as vscode from 'vscode';

/** Puts the cursor on `line` (1-based) and scrolls it into view. */
export function revealLine(editor: vscode.TextEditor, line: number): void {
	const position = new vscode.Position(Math.max(0, Math.min(line - 1, editor.document.lineCount - 1)), 0);
	editor.selection = new vscode.Selection(position, position);
	editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}
