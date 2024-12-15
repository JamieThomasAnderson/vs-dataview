import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';


export function activate(context: vscode.ExtensionContext) {

	console.log('Congratulations, your extension "vs-dataview" is now active!');

	const newTable = vscode.commands.registerCommand('vs-dataview.newTable', async () => {
		vscode.window.showInformationMessage('Creating new table!');

		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showErrorMessage('No Active Editor!');
			return;
		}

		const selection = editor.selection;
		const selectedText = editor.document.getText(selection);

		if (!selectedText.startsWith('```vs-dataview')) {
			vscode.window.showErrorMessage('Selected text is not a valid `vs-dataview` block');
			return;
		}

		const queryText = selectedText.replace(/```vs-dataview/g, '').replace(/```/g, '').trim();
		const queryLines = queryText.split('\n');
		const [tableClause, fromClause, whereClause] = [
			queryLines.find((line) => line.startsWith('table')),
			queryLines.find((line) => line.startsWith('from')),
			queryLines.find((line) => line.startsWith('where')),
		];

		if (!tableClause || !fromClause) {
			vscode.window.showErrorMessage('Invalid query format');
			return;
		}

		const tableFields = tableClause.replace('table', '').split(',').map((field) => field.trim());
		const fromTag = fromClause.replace('from', '').trim().replace('#', '');
		const whereCondition = whereClause?.replace('where', '').trim();

		const markdownFiles = await vscode.workspace.findFiles('**/*.md');
		const results: any[] = [];

		for (const file of markdownFiles) {
			const filePath = file.fsPath;
			const fileName = path.basename(filePath, '.md');
			const content = fs.readFileSync(filePath, 'utf-8');
			const { data } = matter(content);

			if (data.tags && data.tags.includes(fromTag)) {
				if (!whereCondition || evalCondition(data, whereCondition)) {

					const row = [`[[${fileName}]]`, ...tableFields.map((field) => resolveField(data, field))];
					results.push(row);
				}
			}
		}

		const updatedHeaders = ['File', ...tableFields];
		const table = generateMarkdownTable(updatedHeaders, results);

		editor.edit((editBuilder) => {
			editBuilder.replace(selection, table);
		});
	});

	const fromTemplate = vscode.commands.registerCommand('vs-dataview.fromTemplate', async () => {

		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) {
			vscode.window.showErrorMessage('No workspace folder found.');
			return;
		}

		const templateFolderPath = path.join(workspaceFolders[0].uri.fsPath, 'Template');
		if (!fs.existsSync(templateFolderPath)) {
			vscode.window.showErrorMessage(`Template folder not found at ${templateFolderPath}`);
			return;
		}

		const templateFiles = fs.readdirSync(templateFolderPath).filter(file => fs.lstatSync(path.join(templateFolderPath, file)).isFile());


		if (templateFiles.length === 0) {
			vscode.window.showWarningMessage('No template files found in the Template folder.');
			return;
		}

		const selectedFile = await vscode.window.showQuickPick(templateFiles, {
			placeHolder: 'Select a template to insert',
		});

		if (!selectedFile) {
			return; // No file selected
		}

		const selectedFilePath = path.join(templateFolderPath, selectedFile);
		let templateContent = fs.readFileSync(selectedFilePath, 'utf-8');

		templateContent = evaluateTemplate(templateContent);

		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showErrorMessage('No active editor found.');
			return;
		}

		editor.edit(editBuilder => {
			const position = editor.selection.active;
			editBuilder.insert(position, templateContent);
		});
	});

	context.subscriptions.push(newTable);
	context.subscriptions.push(fromTemplate);
}

export function deactivate() { }

function evaluateTemplate(template: string): string {
	return template.replace(/<%([\s\S]*?)%>/g, (_, code: string): string => {
		try {
			const result = new Function('tp', `
                return (${code.trim()});
            `)({
				date: {
					now: (format: string) => {
						const date = new Date();
						const pad = (n: number) => String(n).padStart(2, '0');
					
						const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
						const months = [
							'January', 'February', 'March', 'April', 'May', 'June',
							'July', 'August', 'September', 'October', 'November', 'December'
						];
					
						const getOrdinal = (n: number) => {
							const s = ['th', 'st', 'nd', 'rd'];
							const v = n % 100;
							return n + (s[(v - 20) % 10] || s[v] || s[0]);
						};
					
						return format
							.replace('dddd', days[date.getDay()])
							.replace('MMMM', months[date.getMonth()])
							.replace('Do', getOrdinal(date.getDate()))
							.replace('YYYY', String(date.getFullYear()))
							.replace('MM', pad(date.getMonth() + 1))
							.replace('DD', pad(date.getDate()))
							.replace('HH', pad(date.getHours()))
							.replace('mm', pad(date.getMinutes()))
							.replace('ss', pad(date.getSeconds()));
					},

					today: () => {
						const date = new Date();
						return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
					},
			
					tomorrow: () => {
						const date = new Date();
						date.setDate(date.getDate() + 1);
						return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
					},
			
					yesterday: () => {
						const date = new Date();
						date.setDate(date.getDate() - 1);
						return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
					},
			
					getCurrentWeek: () => {
						const date = new Date();
						const dayOfYear = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24));
						return Math.ceil(dayOfYear / 7);
					}
				},
			});

			return String(result);

		} catch (error: any) {
			console.error(`Error evaluating template code: ${code}`, error);
			return `<Error: ${error.message}>`;
		}
	});
}


function resolveField(data: any, field: string): string {
	if (field.includes('[')) {
		const [key, index] = field.replace(']', '').split('[');
		return data[key]?.[parseInt(index, 10)] || '';
	}

	const value = data[field] || '';

	if (isDate(value)) {
		return formatDate(value);
	}

	return data[field] || '';
}

function isDate(value: any): boolean {
	return !isNaN(Date.parse(value));
}

function formatDate(date: string): string {
	const parsedDate = new Date(date);

	// Format date as "Month DD, YYYY" (e.g., "November 09, 2024")
	const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: '2-digit' };
	return new Intl.DateTimeFormat('en-US', options).format(parsedDate);
}

function evalCondition(data: any, condition: string): boolean {
	try {
		const keys = Object.keys(data);
		const evalStr = condition.replace(/\b(\w+)\b/g, (match) => (keys.includes(match) ? `data.${match}` : match));
		return eval(evalStr);
	} catch {
		return false;
	}
}

function generateMarkdownTable(headers: string[], rows: string[][]): string {
	const headerRow = `| ${headers.join(' | ')} |`;
	const dividerRow = `| ${headers.map(() => '---').join(' | ')} |`;
	const dataRows = rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
	return [headerRow, dividerRow, dataRows].join('\n');
}