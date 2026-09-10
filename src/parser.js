import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';

export const SUPPORTED_EXTENSIONS = ['.txt', '.pdf', '.docx'];

export function get_supported_files(directory) {
    const files = [];
    if (!fs.existsSync(directory)) return files;
    
    const items = fs.readdirSync(directory);
    for (const item of items) {
        const ext = path.extname(item).toLowerCase();
        if (SUPPORTED_EXTENSIONS.includes(ext)) {
            files.push(item);
        }
    }
    return files;
}

export async function parse_file(filepath) {
    if (!fs.existsSync(filepath)) {
        throw new Error(`File not found: ${filepath}`);
    }

    const ext = path.extname(filepath).toLowerCase();
    
    try {
        if (ext === '.txt') {
            return fs.readFileSync(filepath, 'utf8');
        } else if (ext === '.pdf') {
            const dataBuffer = fs.readFileSync(filepath);
            // In pdf-parse v2.x, PDFParse is a class export
            const { PDFParse } = await import('pdf-parse');
            const parser = new PDFParse({ data: dataBuffer });
            const result = await parser.getText();
            return result.text;
        } else if (ext === '.docx') {
            const result = await mammoth.extractRawText({ path: filepath });
            return result.value;
        } else {
            throw new Error(`Unsupported file type: ${ext}`);
        }
    } catch (e) {
        throw new Error(`Failed to parse ${filepath}: ${e.message}`);
    }
}
