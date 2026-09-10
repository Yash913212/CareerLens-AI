import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { LLMClient, clear_extraction_cache } from './llm.js';
import { MatchingEngine } from './matcher.js';
import { Session } from './session.js';
import { parse_file, SUPPORTED_EXTENSIONS } from './parser.js';
import { format_single_analysis } from './output.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Set up 5MB limit and disk storage for multer
const upload = multer({ 
    dest: 'uploads/',
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

const llm = new LLMClient();
const engine = new MatchingEngine(llm);

app.use(express.json());

app.post('/api/analyze', upload.fields([{ name: 'jd', maxCount: 1 }, { name: 'resume', maxCount: 1 }]), async (req, res) => {
    try {
        const jdFile = req.files['jd']?.[0];
        const resumeFile = req.files['resume']?.[0];

        if (!jdFile || !resumeFile) {
            return res.status(400).json({ error: 'Both jd and resume files are required.' });
        }

        // Check extensions
        const jdExt = path.extname(jdFile.originalname).toLowerCase();
        const resumeExt = path.extname(resumeFile.originalname).toLowerCase();

        if (!SUPPORTED_EXTENSIONS.includes(jdExt) || !SUPPORTED_EXTENSIONS.includes(resumeExt)) {
            return res.status(400).json({ error: `Unsupported file type. Supported types: ${SUPPORTED_EXTENSIONS.join(', ')}` });
        }

        // Rename uploaded files so parser can determine type by extension
        const jdPath = `${jdFile.path}${jdExt}`;
        const resumePath = `${resumeFile.path}${resumeExt}`;
        fs.renameSync(jdFile.path, jdPath);
        fs.renameSync(resumeFile.path, resumePath);

        let jdText, resumeText;
        try {
            jdText = await parse_file(jdPath);
            resumeText = await parse_file(resumePath);
        } finally {
            // Clean up files
            if (fs.existsSync(jdPath)) fs.unlinkSync(jdPath);
            if (fs.existsSync(resumePath)) fs.unlinkSync(resumePath);
        }

        const session = new Session();
        const jdDoc = session.add_document('jd-1', jdFile.originalname, jdText, 'job_description');
        const resumeDoc = session.add_document('resume-1', resumeFile.originalname, resumeText, 'resume');

        const result = await engine.analyze_pair(jdDoc, resumeDoc);
        const markdownOutput = format_single_analysis(jdDoc, resumeDoc, result);

        res.json({
            success: true,
            score: result.overall_score,
            markdown: markdownOutput
        });

    } catch (err) {
        console.error("Analysis Error:", err);
        // Check for Groq Rate Limit exhaustion (429)
        if (err.status === 429 || (err.message && err.message.includes('429'))) {
            return res.status(503).json({
                error: 'I\'m handling a lot of requests right now. Please try /analyze again in a minute.'
            });
        }
        res.status(500).json({ error: err.message || 'Internal Server Error' });
    }
});

app.post('/api/clear-cache', (req, res) => {
    clear_extraction_cache();
    res.json({ success: true, message: 'Extraction cache cleared.' });
});

// Error handler for multer size limits
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                error: 'File too large.\n\nPlease upload a document under 5MB.'
            });
        }
    }
    next(err);
});

import { startBot } from './bot.js';

export const server = app.listen(port, () => {
    console.log(`CareerLens AI Express API listening on port ${port}`);
    startBot();
});

export default app;
