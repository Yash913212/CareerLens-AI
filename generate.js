import fs from 'fs';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const inputFile = process.argv[2] || 'tests/fixtures/jd_software_engineer.txt';
const inputContent = fs.readFileSync(inputFile, 'utf-8');

const prompt = `Please summarize the following job description:\n\n${inputContent}`;

async function generateWithGroq() {
    console.log("=== Generating with Groq (openai/gpt-oss-20b) ===");
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: 'openai/gpt-oss-20b',
            messages: [{ role: 'user', content: prompt }]
        }, {
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(response.data.choices[0].message.content);
    } catch (e) {
        console.error("Groq Error:", e.response?.data || e.message);
    }
}

async function generateWithOpenRouter() {
    console.log("\n=== Generating with OpenRouter (google/gemini-2.5-flash) ===");
    try {
        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: 'google/gemini-2.5-flash',
            max_tokens: 1000,
            messages: [{ role: 'user', content: prompt }]
        }, {
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(response.data.choices[0].message.content);
    } catch (e) {
        console.error("OpenRouter Error:", e.response?.data || e.message);
    }
}

async function main() {
    await generateWithGroq();
    await generateWithOpenRouter();
}

main();
