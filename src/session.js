import crypto from 'crypto';
import { LLMClient } from './llm.js';

export class Document {
    constructor(id, filename, text, doc_type) {
        this.id = id;
        this.filename = filename;
        this.text = text;
        this.doc_type = doc_type;
        this.domain_info = null;
        this.analysis_results = {};
    }
}

export class Session {
    constructor() {
        this.documents = new Map();
    }

    add_document(id, filename, text, doc_type) {
        const doc_id = id || crypto.randomUUID();
        const doc = new Document(doc_id, filename, text, doc_type);
        this.documents.set(doc_id, doc);
        return doc;
    }

    get_document(id) {
        return this.documents.get(id);
    }

    clear() {
        this.documents.clear();
    }
}
