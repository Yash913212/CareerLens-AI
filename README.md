# CareerLens AI Matcher Bot

CareerLens AI is an intelligent Telegram Bot that analyzes a candidate's Resume against a specific Job Description (JD). It provides a deterministic compatibility score, explains skill gaps, recommends actionable return paths, and suggests real courses for missing skills.

The project is built on Node.js and uses OpenRouter's AI models for deep semantic analysis and document classification.

## Features

- **Multi-Format Support:** Easily extract text from `.pdf`, `.docx`, and `.txt` files.
- **Paste Support:** Users can also simply copy and paste JDs or Resumes directly into the chat.
- **Smart Classification:** Automatically detects whether an uploaded document or pasted text is a Resume or a Job Description.
- **Deep Compatibility Analysis:**
  - Overall Compatibility Score (0-100)
  - Broken down by Required Skills, Experience, Domain Alignment, Seniority, Education, and Projects.
  - Identifies critical, important, and optional missing skills.
- **Actionable Advice:** Generates actionable career plans and suggests real courses (from Coursera, Udemy, etc.) to bridge skill gaps.
- **Graceful Error Handling:** Automatically handles and informs the user about LLM rate limits and large file restrictions.

## Tech Stack

- **Runtime:** Node.js (ES Modules)
- **Server:** Express.js (handles multipart/form-data)
- **Telegram Bot API:** Telegraf
- **AI Integration:** OpenRouter (via direct Axios HTTP calls)
- **Parsing:** `pdf-parse` (v2.x) for PDFs, `mammoth` for DOCX

## Installation & Setup

1. **Clone the repository and install dependencies:**
   ```bash
   npm install
   ```

2. **Configure Environment Variables:**
   Create a `.env` file in the root directory (you can copy `.env.example`) and add your API keys:
   ```env
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
   OPENROUTER_API_KEY=your_openrouter_api_key_here
   ```

3. **Start the Bot:**
   ```bash
   npm start
   # OR
   npm run dev
   ```

The bot and Express server will spin up on port 3000. You can interact with it immediately on Telegram.

## How to Use

1. Open your configured Bot on Telegram and send `/start`.
2. Upload a **Resume** (PDF, DOCX, TXT) or paste its text.
3. Upload a **Job Description** (PDF, DOCX, TXT) or paste its text.
4. The bot will automatically trigger the analysis engine once both documents are loaded in your session.

## Testing

The project uses Jest for unit tests.
To run the test suite:
```bash
npm test
```
