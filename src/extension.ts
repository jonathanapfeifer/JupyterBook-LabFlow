import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

function getTodayDate(): string {
	const today = new Date();
	const year = today.getFullYear();
	const month = String(today.getMonth() + 1).padStart(2, '0'); // Months are 0-based
	const day = String(today.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}
function formatNotebookPageFilename(date: string, project: string, title: string): string {
	return `${date}-[${project.replace(/\s+/g, '-').toLowerCase()}]-${title.replace(/\s+/g, '-').toLowerCase()}.ipynb`;
}
function toTitleCase(title: string): string {
	const lowercaseWords = ["a", "an", "the", "and", "but", "or", "for", "nor", "on", "at", "to", "from", "by", "in", "of", "with"];
	return title
		.split(' ')
		.map((word, index, words) => {
			if (word && (index === 0 || index === words.length - 1 || !lowercaseWords.includes(word.toLowerCase()))) {
				return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
			} else {
				return word.toLowerCase();
			}
		})
		.join(' ');
}

function createNotebookContent(title: string, date: string, project: string): string {
	const content = {
		cells: [
			{
				cell_type: 'markdown',
				metadata: {},
				source: [
					`# ${date}: ${title}`,
					`${date}  `,
					`Project: ${project}  `,
					`Jonathan Pfeifer  `
				]
			},
			{
				cell_type: 'markdown',
				metadata: {},
				source: [
					`## Purpose`,
					``
				]
			}
		],
		metadata: {
			kernelspec: {
				display_name: "whoi-notebook",
				language: "python",
				name: "python3"
			},
			language_info: {
				codemirror_mode: {
					name: "ipython",
					version: 3
				},
				file_extension: ".py",
				mimetype: "text/x-python",
				name: "python",
				nbconvert_exporter: "python",
				pygments_lexer: "ipython3",
				version: "3.11.0"
			}
		},
		nbformat: 4,
		nbformat_minor: 2
	};
	return JSON.stringify(content, null, 2);
}

export function activate(context: vscode.ExtensionContext) {
	const outputChannel = vscode.window.createOutputChannel('My JBook');

	// Register the importLocal command
	context.subscriptions.push(vscode.commands.registerCommand('extension.importLocal', async () => {
		try {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) {
				vscode.window.showErrorMessage('Please open a workspace folder before importing photos.');
				return;
			}
			const workspaceRoot = workspaceFolders[0].uri.fsPath;
			const rawPhotoFolder = path.join(workspaceRoot, 'images', 'raw');

			// Retrieve the last used folder or default to '../images/incoming'
			const lastUsedFolder = context.globalState.get<vscode.Uri>('lastUsedFolder') || vscode.Uri.file(path.join(workspaceRoot, 'images', 'incoming'));

			// 1. Prompt the user to select files
			const fileUris = await vscode.window.showOpenDialog({
				canSelectMany: true,
				filters: {
					images: ['png', 'jpg', 'jpeg', 'gif']
				},
				defaultUri: lastUsedFolder // Set the initial folder to the last used or incoming folder
			});

			if (!fileUris) {
				outputChannel.appendLine('Photo selection was cancelled by the user.');
				return;
			}

			// Store the last used folder for next time
			context.globalState.update('lastUsedFolder', vscode.Uri.file(path.dirname(fileUris[0].fsPath)));

			// Retrieve the last entered date or use today's date as default
			const lastEnteredDate = context.globalState.get<string>('lastEnteredDate') || getTodayDate();

			const date = await vscode.window.showInputBox({
				prompt: 'Enter the date for the image(s):',
				value: lastEnteredDate
			});

			const imageName = await vscode.window.showInputBox({ prompt: 'Enter a name for the image(s):' });
			const caption = await vscode.window.showInputBox({ prompt: 'Enter a caption for the image(s) (optional):' });

			if (!date || !imageName) {
				outputChannel.appendLine('Date or image name input was cancelled by the user.');
				return;
			}

			// Store the entered date for future use
			context.globalState.update('lastEnteredDate', date);

			// Ensure raw photo folder exists
			if (!fs.existsSync(rawPhotoFolder)) {
				fs.mkdirSync(rawPhotoFolder, { recursive: true });
			}

			// 3. Save the photos to the designated folder
			for (const fileUri of fileUris) {
				const ext = path.extname(fileUri.fsPath);
				// Convert the image name to lowercase and replace spaces with hyphens
				const formattedImageName = imageName.trim().toLowerCase().replace(/\s+/g, '-');
				const formattedFilename = `${date}-${formattedImageName}${ext}`;
				const destPath = path.join(rawPhotoFolder, formattedFilename);

				if (fs.existsSync(destPath)) {
					const overwrite = await vscode.window.showWarningMessage(`File ${formattedFilename} already exists. Overwrite?`, 'Yes', 'No');
					if (overwrite !== 'Yes') {
						outputChannel.appendLine(`Skipped importing ${formattedFilename} due to existing file.`);
						continue;
					}
				}

				fs.copyFileSync(fileUri.fsPath, destPath);
				outputChannel.appendLine(`Imported ${formattedFilename} successfully.`);
			}

			// 4. Insert the MyST markdown figure block into the Jupyter notebook
			const editor = vscode.window.activeTextEditor;
			if (editor) {
				const markdown = fileUris.map(fileUri => {
					const ext = path.extname(fileUri.fsPath);
					const formattedFilename = `${date}-${imageName}${ext}`;
					const relativePathForMyST = `../images/jb/${formattedFilename}`;
					return `\`\`\`{figure} ${relativePathForMyST}\n:name: ${date}-figure-${imageName}\n${caption || ''}\n\`\`\``;
				}).join('\n\n');

				editor.insertSnippet(new vscode.SnippetString(markdown));
			}

			vscode.window.showInformationMessage('Photos imported successfully!');
		} catch (error) {
			const errorMessage = (error instanceof Error) ? error.message : 'An unknown error occurred.';
			outputChannel.appendLine(`Error: ${errorMessage}`);
			vscode.window.showErrorMessage('An error occurred during photo import. Check the output for details.');
		}
	}));



	// Register the newNotebookPage command
	context.subscriptions.push(vscode.commands.registerCommand('extension.newNotebookPage', async () => {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			vscode.window.showErrorMessage('Please open a workspace folder before creating a new notebook page.');
			return;
		}

		const date = getTodayDate();
		const project = await vscode.window.showInputBox({ prompt: 'Enter the project name:' });
		const title = await vscode.window.showInputBox({ prompt: 'Enter the title for the new notebook page:' });

		if (!project || !title) {
			vscode.window.showErrorMessage('Project name or title was not provided.');
			return;
		}

		const workspaceRoot = workspaceFolders[0].uri.fsPath;
		const notebookPagesFolder = path.join(workspaceRoot, 'notebook-pages');
		if (!fs.existsSync(notebookPagesFolder)) {
			fs.mkdirSync(notebookPagesFolder, { recursive: true });
		}

		const titleCapitalized = toTitleCase(title); // Capitalize title for display in notebook
		const filename = formatNotebookPageFilename(date, project, title.toLowerCase()); // Keep filename lowercase
		const filePath = path.join(notebookPagesFolder, filename);
		const content = createNotebookContent(titleCapitalized, date, project); // Use capitalized title here

		fs.writeFileSync(filePath, content, 'utf8');
		vscode.window.showInformationMessage(`New notebook page ${filename} created successfully.`);

		// Open the newly created .ipynb file in the editor
		const notebookUri = vscode.Uri.file(filePath);
		vscode.workspace.openTextDocument(notebookUri).then(doc => {
			vscode.window.showTextDocument(doc);
		});
	}));


	context.subscriptions.push(outputChannel);
}

export function deactivate() { }
