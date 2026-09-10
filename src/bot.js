import { Telegraf, session } from 'telegraf';
import { message } from 'telegraf/filters';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { LLMClient, clear_extraction_cache } from './llm.js';
import { MatchingEngine } from './matcher.js';
import { Session } from './session.js';
import { parse_file, SUPPORTED_EXTENSIONS } from './parser.js';
import { format_single_analysis } from './output.js';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error("❌ TELEGRAM_BOT_TOKEN not found in environment.");
    process.exit(1);
}

const bot = new Telegraf(token);
const llm = new LLMClient();
const engine = new MatchingEngine(llm);

// Store sessions by chat_id in memory
const userSessions = new Map();

function getSession(chatId) {
    if (!userSessions.has(chatId)) {
        userSessions.set(chatId, new Session());
    }
    return userSessions.get(chatId);
}

// 5MB Limit
const MAX_FILE_SIZE = 5 * 1024 * 1024;

bot.start((ctx) => {
    ctx.reply(
        "👋 Welcome to CareerLens AI!\n\n" +
        "I can analyze your resume against a job description to give you an honest compatibility score, explain the gaps, and suggest courses.\n\n" +
        "To start, simply upload a Resume and a Job Description (.pdf, .docx, or .txt). Use /help for more info."
    );
});

bot.help((ctx) => {
    ctx.reply(
        "📋 **Commands**\n" +
        "/analyze - Run analysis on the currently uploaded JD and Resume.\n" +
        "/clear - Clear your uploaded documents and reset your session.\n" +
        "/start - Show welcome message.\n\n" +
        "**How to use:**\n" +
        "Just upload two documents. I will automatically classify them and run the analysis once both a JD and Resume are provided."
    , { parse_mode: 'Markdown' });
});

bot.command('clear', (ctx) => {
    const session = getSession(ctx.chat.id);
    session.clear();
    // Do not clear the global extraction cache for all users, only this user's state
    ctx.reply("🗑️ Your session and uploaded documents have been cleared.");
});

bot.command('analyze', async (ctx) => {
    const session = getSession(ctx.chat.id);
    const docs = Array.from(session.documents.values());
    
    const jd = docs.find(d => d.doc_type === 'job_description');
    const resume = docs.find(d => d.doc_type === 'resume');

    if (!jd || !resume) {
        return ctx.reply("⚠️ I need both a Job Description and a Resume to run the analysis. Please upload the missing document.");
    }

    await runAnalysis(ctx, session, jd, resume);
});

bot.on(message('document'), async (ctx) => {
    const doc = ctx.message.document;
    
    // Explicit file size limit check before downloading
    if (doc.file_size > MAX_FILE_SIZE) {
        return ctx.reply("❌ File too large.\n\nPlease upload a document under 5MB.");
    }

    const ext = path.extname(doc.file_name || "").toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
        return ctx.reply(`❌ Unsupported file type. Supported types: ${SUPPORTED_EXTENSIONS.join(', ')}`);
    }

    const progressMsg = await ctx.reply(`⏳ Downloading and reading ${doc.file_name}...`);

    try {
        const fileLink = await ctx.telegram.getFileLink(doc.file_id);
        const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
        
        // Write temporarily to disk for parser
        const tempPath = path.join(process.cwd(), 'uploads', `temp_${ctx.chat.id}_${Date.now()}${ext}`);
        if (!fs.existsSync(path.join(process.cwd(), 'uploads'))) {
            fs.mkdirSync(path.join(process.cwd(), 'uploads'));
        }
        fs.writeFileSync(tempPath, Buffer.from(response.data));

        // Parse file
        const text = await parse_file(tempPath);
        fs.unlinkSync(tempPath); // cleanup

        if (!text || text.trim().length === 0) {
            return ctx.telegram.editMessageText(ctx.chat.id, progressMsg.message_id, null, "⚠️ Could not extract text from this document.");
        }

        await ctx.telegram.editMessageText(ctx.chat.id, progressMsg.message_id, null, `⏳ Classifying ${doc.file_name}...`);

        // Classify
        const classification = await llm.classify(text, doc.file_name);
        if (classification.doc_type === 'ambiguous') {
            return ctx.telegram.editMessageText(ctx.chat.id, progressMsg.message_id, null, `❓ I couldn't determine if ${doc.file_name} is a Resume or a JD.\n\nPlease ensure it contains clear keywords.`);
        }

        const session = getSession(ctx.chat.id);
        
        // Remove existing document of the same type to allow replacing
        for (const [id, existingDoc] of session.documents.entries()) {
            if (existingDoc.doc_type === classification.doc_type) {
                session.documents.delete(id);
            }
        }

        const newDoc = session.add_document(doc.file_id, doc.file_name, text, classification.doc_type);

        const typeName = classification.doc_type === 'job_description' ? 'Job Description' : 'Resume';
        await ctx.telegram.editMessageText(ctx.chat.id, progressMsg.message_id, null, `✅ Successfully loaded ${doc.file_name} as a ${typeName}.`);

        // Auto-trigger analysis if both are present
        const docs = Array.from(session.documents.values());
        const jd = docs.find(d => d.doc_type === 'job_description');
        const resume = docs.find(d => d.doc_type === 'resume');

        if (jd && resume) {
            await runAnalysis(ctx, session, jd, resume);
        } else {
            const missingType = jd ? "Resume" : "Job Description";
            await ctx.reply(`👉 Now, please upload a **${missingType}** (or paste the text directly here) to begin the compatibility analysis!`, { parse_mode: 'Markdown' });
        }

    } catch (err) {
        console.error(err);
        handleRateLimitError(ctx, err, progressMsg.message_id);
    }
});

bot.on(message('text'), async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return;

    if (text.trim().length < 50) {
        return ctx.reply("Please provide a longer text or upload a document (.pdf, .docx, .txt).");
    }

    const progressMsg = await ctx.reply("⏳ Classifying pasted text...");

    try {
        const classification = await llm.classify(text, "pasted_text.txt");
        if (classification.doc_type === 'ambiguous') {
            return ctx.telegram.editMessageText(ctx.chat.id, progressMsg.message_id, null, `❓ I couldn't determine if the pasted text is a Resume or a JD.\n\nPlease ensure it contains clear keywords.`);
        }

        const session = getSession(ctx.chat.id);
        
        for (const [id, existingDoc] of session.documents.entries()) {
            if (existingDoc.doc_type === classification.doc_type) {
                session.documents.delete(id);
            }
        }

        const newDoc = session.add_document(null, "Pasted Text", text, classification.doc_type);

        const typeName = classification.doc_type === 'job_description' ? 'Job Description' : 'Resume';
        await ctx.telegram.editMessageText(ctx.chat.id, progressMsg.message_id, null, `✅ Successfully loaded pasted text as a ${typeName}.`);

        const docs = Array.from(session.documents.values());
        const jd = docs.find(d => d.doc_type === 'job_description');
        const resume = docs.find(d => d.doc_type === 'resume');

        if (jd && resume) {
            await runAnalysis(ctx, session, jd, resume);
        } else {
            const missingType = jd ? "Resume" : "Job Description";
            await ctx.reply(`👉 Now, please upload a ${missingType} (or paste the text directly here) to begin the compatibility analysis!`);
        }

    } catch (err) {
        console.error(err);
        handleRateLimitError(ctx, err, progressMsg.message_id);
    }
});

async function runAnalysis(ctx, session, jd, resume) {
    const progressMsg = await ctx.reply("⚙️ Running AI Match Analysis. This will take a moment...");
    try {
        const result = await engine.analyze_pair(jd, resume);
        let markdownOutput = format_single_analysis(jd, resume, result);
        
        // Telegram MarkdownV2 requires heavy escaping.
        // It's safer to use normal Markdown or just send as HTML if formatting breaks.
        // The output formatter produces standard markdown. We will send it as plain text if it's too complex, 
        // but let's try standard Markdown first, falling back to plain if it errors.
        
        // Telegram has a 4096 character limit per message. Split if necessary.
        const chunks = splitTextByLength(markdownOutput, 4000);
        
        await ctx.telegram.deleteMessage(ctx.chat.id, progressMsg.message_id).catch(() => {});
        
        for (const chunk of chunks) {
            // Telegraf uses Markdown by default if specified, but format_single_analysis uses standard Markdown which is mostly compatible.
            // We won't strictly enforce parse_mode if it fails.
            try {
                await ctx.reply(chunk, { parse_mode: 'Markdown' });
            } catch (e) {
                // Fallback without parse_mode if formatting fails (e.g. unclosed tags)
                await ctx.reply(chunk);
            }
        }

    } catch (err) {
        console.error("Analysis Error:", err);
        handleRateLimitError(ctx, err, progressMsg.message_id);
    }
}

function handleRateLimitError(ctx, err, messageIdToEdit = null) {
    const isRateLimit = err.status === 429 || (err.message && err.message.includes('429'));
    const msg = isRateLimit 
        ? "⏳ I'm handling a lot of requests right now. Please try again in a minute."
        : "❌ An error occurred while processing your request.";
        
    if (messageIdToEdit) {
        ctx.telegram.editMessageText(ctx.chat.id, messageIdToEdit, null, msg).catch(() => ctx.reply(msg));
    } else {
        ctx.reply(msg);
    }
}

function splitTextByLength(text, maxLength) {
    const chunks = [];
    let current = text;
    while (current.length > maxLength) {
        let splitAt = current.lastIndexOf('\n', maxLength);
        if (splitAt === -1) splitAt = maxLength;
        chunks.push(current.substring(0, splitAt));
        current = current.substring(splitAt).trim();
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
}

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

export function startBot() {
    bot.launch();
    console.log("🤖 Telegram Bot is running...");
}
