import crypto from 'crypto';
import dotenv from 'dotenv';
import axios from 'axios';
import Groq from 'groq-sdk';

dotenv.config();

// ── Extraction result cache (session-scoped, in-memory) ─────────────────
const _extraction_cache = new Map();

function _cache_key(method_name, ...args) {
    const hash = crypto.createHash('sha256');
    hash.update(method_name);
    for (const arg of args) {
        if (typeof arg === 'string') {
            hash.update(arg);
        } else {
            hash.update(JSON.stringify(arg, Object.keys(arg).sort()));
        }
    }
    return hash.digest('hex');
}

function normalize_text(text = '') {
    return String(text).toLowerCase().replace(/[^a-z0-9+\s]/g, ' ');
}

function detect_domain_from_text(text) {
    const normalized = normalize_text(text);
    const scores = {
        'software engineering': 0,
        'data science': 0,
        'mechanical engineering': 0,
        'general': 0
    };

    const domain_keywords = {
        'software engineering': [
            'python', 'go', 'javascript', 'node', 'java', 'c++', 'c#', 'sql', 'postgres', 'redis',
            'kubernetes', 'docker', 'aws', 'rest', 'api', 'graphql', 'microservices', 'backend',
            'software', 'full stack', 'flask', 'fastapi', 'django', 'git', 'ci/cd', 'github actions',
            'argocd', 'rabbitmq', 'kafka', 'system design', 'distributed systems'
        ],
        'data science': [
            'data scientist', 'machine learning', 'ml', 'pandas', 'numpy', 'scikit', 'pytorch',
            'tensorflow', 'statistics', 'probability', 'airflow', 'spark', 'sql', 'ab testing',
            'visualization', 'eda', 'model deployment', 'mlflow', 'aws', 'gcp', 'nlp'
        ],
        'mechanical engineering': [
            'solidworks', 'catia', 'fea', 'ansys', 'gdt', 'cad', 'cnc', 'manufacturing', 'mechanical',
            'injection molding', 'dfmea', 'pfmea', '3d printing', 'thermal analysis', 'material science',
            'asme', 'design review', 'product design', 'prototype'
        ]
    };

    for (const [domain, keywords] of Object.entries(domain_keywords)) {
        for (const keyword of keywords) {
            if (normalized.includes(keyword)) {
                scores[domain] += 1;
            }
        }
    }

    const winning_domain = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    if (winning_domain[1] === 0) {
        return { domain: 'general', sub_domains: [], key_technologies: [], seniority_level: 'not_applicable', reasoning: 'No strong domain signals found; defaulted to general.' };
    }

    const domainName = winning_domain[0];
    return {
        domain: domainName,
        sub_domains: [domainName],
        key_technologies: domain_keywords[domainName].slice(0, 5),
        seniority_level: normalized.includes('senior') ? 'senior' : normalized.includes('junior') ? 'junior' : 'mid',
        reasoning: `Identified strong ${domainName} signals in the document.`
    };
}

export function clear_extraction_cache() {
    _extraction_cache.clear();
}

export class LLMClient {
    static EXTRACTION_SEED = 42;

    constructor() {
        const groqKey = process.env.GROQ_API_KEY || '';
        const openrouterKey = process.env.OPENROUTER_API_KEY || '';

        this.provider = groqKey ? 'groq' : openrouterKey ? 'openrouter' : 'offline';
        this.apiKey = groqKey || openrouterKey || '';

        if (groqKey) {
            this.models = [
                'qwen/qwen3.8-27b',
                'qwen/qwen3.6-27b',
                'openai/gpt-oss-20b',
                'openai/gpt-oss-120b',
                'groq/compound'
            ];
            this.client = new Groq({ apiKey: groqKey });
        } else {
            this.models = [
                'google/gemini-2.5-flash',
                'google/gemini-2.5-flash-lite',
                'google/gemma-3-27b-it'
            ];
            this.client = {
                chat: {
                    completions: {
                        create: async (payload) => {
                            if (!this.apiKey) {
                                const err = new Error('OPENROUTER_API_KEY not found. Set it in your .env file or environment variables.');
                                err.status = 401;
                                throw err;
                            }
                            const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', payload, {
                                headers: {
                                    Authorization: `Bearer ${this.apiKey}`,
                                    'Content-Type': 'application/json'
                                }
                            });
                            return {
                                choices: [{
                                    message: {
                                        content: response.data.choices[0]?.message?.content || ''
                                    }
                                }]
                            };
                        }
                    }
                }
            };
        }
    }

    _build_timeout_error(context, timeoutMs) {
        const err = new Error(`${context} request timed out after ${timeoutMs}ms`);
        err.status = 504;
        err.response = {
            status: 504,
            data: {
                error: {
                    message: `${context} request timed out after ${timeoutMs}ms`
                }
            }
        };
        return err;
    }

    async _callWithTimeout(requestFn, timeoutMs, context = 'LLM') {
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(this._build_timeout_error(context, timeoutMs)), timeoutMs);
        });

        try {
            return await Promise.race([
                Promise.resolve().then(() => requestFn()),
                timeoutPromise
            ]);
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Internal call with retry-with-backoff for 429 rate limits.
     */
    async _callWithRetry(options, maxRetries = 3, timeoutMs = 30000) {
        let attempt = 0;
        while (attempt <= maxRetries) {
            try {
                if (this.provider === 'groq') {
                    const response = await this._callWithTimeout(() => this.client.chat.completions.create({
                        model: options.model,
                        messages: options.messages,
                        temperature: options.temperature,
                        max_tokens: options.max_tokens,
                        top_p: options.top_p ?? 1,
                    }), timeoutMs, 'Groq');
                    return response.choices[0]?.message?.content || '';
                }

                const response = await this._callWithTimeout(() => this.client.chat.completions.create(options), timeoutMs, 'OpenRouter');
                return response.choices[0]?.message?.content || '';
            } catch (error) {
                const status = error.response?.status || error.status;
                const message = error.response?.data?.error?.message || error.message || '';

                if (status === 429 && attempt < maxRetries) {
                    attempt++;
                    const waitTime = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                    console.warn(`[${this.provider.toUpperCase()} Rate Limit] 429 received. Retrying in ${Math.round(waitTime)}ms (Attempt ${attempt}/${maxRetries})...`);
                    await new Promise(res => setTimeout(res, waitTime));
                } else if (status === 402 || /more credits|credit/i.test(message)) {
                    console.warn(`[${this.provider.toUpperCase()}] Credits exhausted. Falling back to offline deterministic mode.`);
                    throw Object.assign(new Error(`${this.provider} credits exhausted`), { response: { status: 402, data: { error: { message } } }, status: 402 });
                } else if (status === 504 || /timed out|timeout/i.test(message)) {
                    console.warn(`[${this.provider.toUpperCase()}] Request timed out. Falling back to offline deterministic mode.`);
                    throw Object.assign(new Error(`${this.provider} request timed out`), { response: { status: 504, data: { error: { message } } }, status: 504 });
                } else {
                    console.error('LLM Error:', error.response?.data || error.message);
                    throw error;
                }
            }
        }
    }

    async _call(prompt, system_instruction = '', temperature = 0.3, deterministic = false, timeoutMs = 30000) {
        const messages = [];
        if (system_instruction) {
            messages.push({ role: 'system', content: system_instruction });
        }
        messages.push({ role: 'user', content: prompt });

        let lastError = null;

        for (const model of this.models) {
            const options = {
                model,
                messages,
                max_tokens: 4096,
                temperature: deterministic ? 0 : temperature
            };

            if (deterministic) {
                options.top_p = 1;
            }

            try {
                return await this._callWithRetry(options, 3, timeoutMs);
            } catch (error) {
                lastError = error;
                const status = error.response?.status || error.status;
                const message = error.response?.data?.error?.message || error.message || '';

                if (status === 404 && /model.*not found|does not exist|not available|unavailable|access to it/i.test(message)) {
                    console.warn(`[${this.provider.toUpperCase()}] Model ${model} unavailable. Trying next configured model...`);
                    continue;
                }

                if (status === 429 || /rate limit|rate_limit_exceeded|too many requests/i.test(message)) {
                    console.warn(`[${this.provider.toUpperCase()}] Rate limit reached. Falling back to offline deterministic mode.`);
                    return JSON.stringify({ fallback: true, message: 'Offline fallback response generated because the active AI provider rate limit was reached.' });
                }

                if (status === 402 || /more credits|credit/i.test(message)) {
                    console.warn(`[${this.provider.toUpperCase()}] Credits exhausted. Falling back to offline deterministic mode.`);
                    return JSON.stringify({ fallback: true, message: 'Offline fallback response generated because the active AI provider credits are exhausted.' });
                }

                if (status === 504 || /timed out|timeout/i.test(message)) {
                    console.warn(`[${this.provider.toUpperCase()}] Request timed out. Falling back to offline deterministic mode.`);
                    return JSON.stringify({ fallback: true, message: 'Offline fallback response generated because the active AI provider request timed out.' });
                }

                if (!this.apiKey || status === 401 || status === 403) {
                    return JSON.stringify({ fallback: true, message: 'Offline fallback response generated because no valid API key is configured.' });
                }

                throw error;
            }
        }

        if (lastError) {
            const status = lastError.response?.status || lastError.status;
            const message = lastError.response?.data?.error?.message || lastError.message || '';
            if (status === 429 || /rate limit|rate_limit_exceeded|too many requests/i.test(message)) {
                return JSON.stringify({ fallback: true, message: 'Offline fallback response generated because the active AI provider rate limit was reached.' });
            }
            if (status === 402 || /more credits|credit/i.test(message)) {
                return JSON.stringify({ fallback: true, message: 'Offline fallback response generated because the active AI provider credits are exhausted.' });
            }
            if (!this.apiKey || status === 401 || status === 403) {
                return JSON.stringify({ fallback: true, message: 'Offline fallback response generated because no valid API key is configured.' });
            }
            throw lastError;
        }

        return JSON.stringify({ fallback: true, message: 'Offline fallback response generated because no model was available.' });
    }

    async _call_cached(cache_id, prompt, system_instruction = '') {
        if (_extraction_cache.has(cache_id)) {
            return _extraction_cache.get(cache_id);
        }

        const response_text = await this._call(prompt, system_instruction, 0, true);
        const result = this._parse_json_response(response_text);

        if (result !== null) {
            _extraction_cache.set(cache_id, result);
        }

        return result;
    }

    _parse_json_response(response_text) {
        let cleaned = String(response_text || '').trim();

        if (cleaned.startsWith('```')) {
            const lines = cleaned.split('\n');
            cleaned = lines.slice(1).join('\n');
            if (cleaned.trimEnd().endsWith('```')) {
                cleaned = cleaned.trimEnd().slice(0, -3);
            }
        }
        cleaned = cleaned.trim();

        try {
            return JSON.parse(cleaned);
        } catch (e) {
            const objMatch = cleaned.match(/\{[\s\S]*\}/);
            if (objMatch) {
                try {
                    return JSON.parse(objMatch[0]);
                } catch (e2) {}
            }

            const arrMatch = cleaned.match(/\[[\s\S]*\]/);
            if (arrMatch) {
                try {
                    return JSON.parse(arrMatch[0]);
                } catch (e3) {}
            }
        }
        return null;
    }

    _fallback_classify(text, filename = '', user_label = '') {
        const lower = normalize_text(text);
        const jdSignals = ['responsibilities', 'requirements', 'qualifications', 'we are looking for', 'about the role', 'preferred skills', 'must have', 'job description'];
        const resumeSignals = ['experience', 'education', 'skills', 'projects', 'certifications', 'summary', 'objective', 'professional summary'];

        const jdScore = jdSignals.filter(signal => lower.includes(signal)).length;
        const resumeScore = resumeSignals.filter(signal => lower.includes(signal)).length;

        let doc_type = 'ambiguous';
        if (jdScore > resumeScore) doc_type = 'job_description';
        if (resumeScore > jdScore) doc_type = 'resume';
        if (user_label) {
            const label = user_label.toLowerCase();
            if (label.includes('resume') || label.includes('cv')) doc_type = 'resume';
            if (label.includes('job') || label.includes('jd')) doc_type = 'job_description';
        }

        return {
            doc_type,
            confidence: doc_type === 'ambiguous' ? 'low' : 'high',
            reasoning: doc_type === 'ambiguous' ? 'The document contains mixed or insufficient structure to classify confidently.' : `Detected ${doc_type === 'job_description' ? 'job description' : 'resume'} style signals in the content.`,
            conflict: false
        };
    }

    _fallback_detect_domain(text, doc_type) {
        return detect_domain_from_text(text);
    }

    _fallback_check_domain_compatibility(jd_domain, resume_domain) {
        const jd = String(jd_domain?.domain || '').toLowerCase();
        const res = String(resume_domain?.domain || '').toLowerCase();

        const matchSet = ['software engineering', 'data science', 'mechanical engineering'];
        const sameMatch = jd && res && jd === res;
        const inSameGroup = jd && res && (
            (jd.includes('software') && res.includes('software')) ||
            (jd.includes('data') && res.includes('data')) ||
            (jd.includes('mechanical') && res.includes('mechanical'))
        );

        if (sameMatch || inSameGroup) {
            return { compatibility: 'match', score_cap: null, reasoning: 'The JD and resume are in the same technical domain.' };
        }

        if (matchSet.some(item => jd.includes(item) || res.includes(item))) {
            return { compatibility: 'partial', score_cap: 50, reasoning: 'The JD and resume are related but not perfectly aligned in technical domain.' };
        }

        return { compatibility: 'mismatch', score_cap: 10, reasoning: 'The JD and resume come from different domains and cannot be treated as a close fit.' };
    }

    _extract_skill_keywords(text) {
        const normalized = normalize_text(text);
        const terms = [
            'python', 'go', 'javascript', 'java', 'sql', 'postgresql', 'postgres', 'redis', 'kubernetes',
            'docker', 'aws', 'azure', 'gcp', 'rest', 'graphql', 'microservices', 'backend', 'api',
            'pandas', 'numpy', 'scikit', 'pytorch', 'tensorflow', 'spark', 'airflow', 'mlflow',
            'solidworks', 'catia', 'fea', 'ansys', 'gdt', 'cad', 'cnc', 'manufacturing', 'dfmea',
            'pfmea', '3d printing', 'materials science', 'product design', 'prototype'
        ];
        const hit = [];
        for (const term of terms) {
            if (normalized.includes(term)) hit.push(term);
        }
        return hit;
    }

    _fallback_compute_match_score(jd_text, resume_text, domain_match) {
        const jdKeywords = this._extract_skill_keywords(jd_text);
        const resumeKeywords = this._extract_skill_keywords(resume_text);
        const overlap = jdKeywords.filter(keyword => resumeKeywords.some(item => item === keyword || keyword.includes(item) || item.includes(keyword))).length;
        const domainCoverage = jdKeywords.length ? (overlap / jdKeywords.length) * 100 : 0;

        let overall = 28 + Math.min(domainCoverage * 0.8, 52);

        if (domain_match.compatibility === 'mismatch') {
            overall = Math.min(overall, 10);
        } else if (domain_match.compatibility === 'partial') {
            overall = Math.min(Math.max(overall, 35), 60);
        } else {
            overall = Math.min(Math.max(60, overall + 18), 96);
        }

        const critical = [];
        const important = [];
        const optional = [];
        const jdCriticalTerms = ['kubernetes', 'postgres', 'python', 'go', 'api', 'microservices', 'spark', 'pytorch', 'solidworks', 'ansys', 'gdt'];

        for (const term of jdCriticalTerms) {
            if (jd_text.toLowerCase().includes(term) && !resume_text.toLowerCase().includes(term)) {
                critical.push({ skill: term, why_critical: `The JD emphasizes ${term} experience as a core requirement.`, learnable: true });
            }
        }

        const notable_matches = [...new Set(jdKeywords.filter(keyword => resumeKeywords.includes(keyword)))];
        const strengths = notable_matches.length > 0 ? notable_matches.slice(0, 4).map(v => `Strong evidence of ${v} experience`) : ['Relevant domain evidence is present in the resume.'];

        return {
            overall_score: Math.max(0, Math.min(100, Math.round(overall))),
            domain_compatibility: domain_match.compatibility,
            required_skills_score: Math.max(0, Math.min(100, Math.round(20 + domainCoverage * 0.8))),
            experience_score: Math.max(0, Math.min(100, Math.round(22 + domainCoverage * 0.7))),
            domain_alignment_score: Math.max(0, Math.min(100, Math.round(30 + domainCoverage * 0.7))),
            seniority_score: Math.max(0, Math.min(100, Math.round(55 + (resume_text.toLowerCase().includes('senior') ? 15 : 0)))),
            education_score: Math.max(0, Math.min(100, Math.round(60 + (resume_text.toLowerCase().includes('bachelor') || resume_text.toLowerCase().includes('master') ? 25 : 0)))),
            projects_score: Math.max(0, Math.min(100, Math.round(45 + (resume_text.toLowerCase().includes('project') ? 30 : 0)))),
            matched_skills: notable_matches.slice(0, 12),
            missing_critical: critical.slice(0, 3),
            missing_important: important.slice(0, 3),
            missing_optional: optional.slice(0, 3),
            strengths,
            seniority_assessment: 'The profile aligns with the expected seniority level for this role.',
            reasoning: 'Offline evaluation used deterministic keyword overlap and domain heuristics because no external LLM key was configured.'
        };
    }

    _fallback_narrative(kind, score_result) {
        if (kind === 'return_path') {
            if (score_result.domain_compatibility === 'mismatch') {
                return 'This resume is fundamentally misaligned with the JD. Do not try to force-fit keywords. Either target a different role or build real domain experience before applying.';
            }
            if (score_result.overall_score >= 80) {
                return 'Continue toward this role, but strengthen your evidence in the most relevant technologies and keep the resume tightly aligned to the JD.';
            }
            return 'Target a role that matches your current profile more closely, then close the highest-priority skill gaps through projects and focused learning.';
        }
        if (kind === 'enlightenment') {
            return `This estimate reflects the gap between the JD requirements and the resume evidence. The score is lower when the technical domain, seniority, or required tools do not align with the actual role.`;
        }
        if (kind === 'action_plan') {
            return '1. Update your resume to reflect only evidence you actually have. 2. Build one project that demonstrates the missing skill. 3. Learn the top 2 missing tools or technologies. 4. Apply to jobs that match your current level while improving your practical evidence.';
        }
        return 'Offline fallback guidance is active because the live AI provider is unavailable or rate-limited.';
    }

    _fallback_suggest_courses(missing_skills, domain_compatibility) {
        const skillNames = (missing_skills || []).map(item => typeof item === 'object' ? (item.skill || item.name || '') : String(item));
        const cleaned = skillNames.filter(Boolean);

        if (domain_compatibility === 'mismatch' || cleaned.length === 0) {
            return [];
        }

        const suggestions = [
            { skill: cleaned[0] || 'backend engineering', course_name: 'Python for Everybody', platform: 'Coursera', url: 'https://www.coursera.org/specializations/python-for-everybody', reasoning: 'Builds the fundamentals behind the first missing technical skill area.' },
            { skill: cleaned[1] || 'cloud deployment', course_name: 'Docker for Absolute Beginners', platform: 'Udemy', url: 'https://www.udemy.com/course/docker-for-absolute-beginners/', reasoning: 'Helps close practical deployment and environment setup gaps.' },
            { skill: cleaned[2] || 'system design', course_name: 'System Design Fundamentals', platform: 'Udemy', url: 'https://www.udemy.com/course/system-design-fundamentals/', reasoning: 'Improves architecture reasoning and role readiness for mid-level technical roles.' }
        ];

        return suggestions;
    }

    // ── Structured extraction calls ──────────────

    async classify(text, filename = '', user_label = '') {
        if (!this.apiKey) {
            return this._fallback_classify(text, filename, user_label);
        }

        const system = `You are a document classifier for CareerLens AI. Your task is to classify documents as either a Job Description (JD) or a Resume/CV.

Classification signals for JD: job title being hired for, 'responsibilities', 'requirements', 'qualifications', 'we are looking for', 'the role', 'about the company', 'preferred skills', 'must have'.

Classification signals for Resume: personal name at top, 'experience', 'education', 'skills' section listing the person's own skills, 'projects', 'certifications', 'objective', 'summary' describing the person's career.

IMPORTANT: Do NOT rely on filename. Analyze the content structure and language.
If confidence is low, classify as 'ambiguous'.

Respond with ONLY valid JSON, no markdown formatting, no code blocks.`;

        let user_label_note = '';
        if (user_label) {
            user_label_note = `\n\nThe user has labeled this document as: '${user_label}'. Trust the user's label unless the content STRONGLY contradicts it. If there is a conflict, set 'conflict' to true and explain in reasoning.`;
        }

        const prompt = `Classify the following document.\n\nFilename: ${filename || 'unknown'}\n${user_label_note}\n\n--- DOCUMENT CONTENT ---\n${text.substring(0, 8000)}\n--- END DOCUMENT ---\n\nRespond with ONLY this JSON structure:\n{"doc_type": "job_description" | "resume" | "ambiguous", "confidence": "high" | "medium" | "low", "reasoning": "brief explanation", "conflict": false}`;

        const cid = _cache_key('classify', text.substring(0, 8000), user_label);
        let result = await this._call_cached(cid, prompt, system);

        if (!result || typeof result !== 'object') {
            result = {
                doc_type: 'ambiguous',
                confidence: 'low',
                reasoning: 'Failed to parse LLM classification response.',
                conflict: false
            };
        }

        return {
            doc_type: result.doc_type || 'ambiguous',
            confidence: result.confidence || 'low',
            reasoning: result.reasoning || '',
            conflict: result.conflict || false
        };
    }

    async detect_domain(text, doc_type) {
        if (!this.apiKey) {
            return this._fallback_detect_domain(text, doc_type);
        }

        const system = `You are a domain detection expert. Analyze the document content to determine the professional domain, sub-domains, key technologies, and seniority level.

IMPORTANT: Determine the domain from responsibilities, required skills, technologies, education, and project evidence — NOT from job titles alone and NOT from generic overlapping words (teamwork, communication, 'engineer', 'project').

Respond with ONLY valid JSON, no markdown formatting, no code blocks.`;

        const typeStr = doc_type === 'job_description' ? 'job description' : 'resume';
        const prompt = `Analyze this ${typeStr} and determine its professional domain.\n\n--- DOCUMENT CONTENT ---\n${text.substring(0, 8000)}\n--- END DOCUMENT ---\n\nRespond with ONLY this JSON structure:\n{"domain": "primary domain name", "sub_domains": ["sub-domain 1", "sub-domain 2"], "key_technologies": ["tech1", "tech2"], "seniority_level": "entry/junior/mid/senior/lead/not_applicable", "reasoning": "brief explanation"}`;

        const cid = _cache_key('detect_domain', text.substring(0, 8000), doc_type);
        let result = await this._call_cached(cid, prompt, system);

        if (!result || typeof result !== 'object') {
            result = {
                domain: 'Unknown',
                sub_domains: [],
                key_technologies: [],
                seniority_level: 'not_applicable',
                reasoning: 'Failed to parse domain detection response.'
            };
        }

        return {
            domain: result.domain || 'Unknown',
            sub_domains: result.sub_domains || [],
            key_technologies: result.key_technologies || [],
            seniority_level: result.seniority_level || 'not_applicable',
            reasoning: result.reasoning || ''
        };
    }

    async check_domain_compatibility(jd_domain, resume_domain) {
        if (!this.apiKey) {
            return this._fallback_check_domain_compatibility(jd_domain, resume_domain);
        }

        const system = `You are a domain compatibility assessor. Compare the JD domain and resume domain to determine if they are fundamentally compatible.

Rules:
- 'match': Same core field (e.g., both Software Engineering, or Frontend vs Backend)
- 'partial': Related fields with significant overlap (e.g., Data Science and Software Engineering)
- 'mismatch': Fundamentally different fields (e.g., Mechanical Engineering vs Software Engineering, Civil Engineering vs Data Science)

IMPORTANT: Do NOT be fooled by generic overlapping words like 'engineer', 'project management', 'communication'. Focus on the actual technical skills, tools, and domain knowledge required.

For 'mismatch', set score_cap to a value between 5-15.
For 'partial', set score_cap to 40-60.
For 'match', set score_cap to null.

Respond with ONLY valid JSON, no markdown formatting, no code blocks.`;

        const jdStr = JSON.stringify(jd_domain, Object.keys(jd_domain).sort());
        const resStr = JSON.stringify(resume_domain, Object.keys(resume_domain).sort());

        const prompt = `Compare these two domains:\n\nJD Domain: ${jdStr}\n\nResume Domain: ${resStr}\n\nRespond with ONLY this JSON structure:\n{"compatibility": "match" | "partial" | "mismatch", "score_cap": null | integer, "reasoning": "brief explanation"}`;

        const cid = _cache_key('check_domain_compat', jdStr, resStr);
        let result = await this._call_cached(cid, prompt, system);

        if (!result || typeof result !== 'object') {
            result = {
                compatibility: 'partial',
                score_cap: 50,
                reasoning: 'Failed to parse compatibility response. Defaulting to partial.'
            };
        }

        return {
            compatibility: result.compatibility || 'partial',
            score_cap: result.score_cap !== undefined ? result.score_cap : null,
            reasoning: result.reasoning || ''
        };
    }

    async compute_match_score(jd_text, resume_text, domain_match) {
        if (!this.apiKey) {
            return this._fallback_compute_match_score(jd_text, resume_text, domain_match);
        }

        let domain_context = '';
        if (domain_match.compatibility === 'mismatch') {
            domain_context = `\n\nCRITICAL: Domain mismatch detected. ${domain_match.reasoning || ''}\nScore MUST be capped at ${domain_match.score_cap || 10}. This is a fundamental domain mismatch, not a skill gap. Do NOT inflate the score due to generic keyword overlap.`;
        } else if (domain_match.compatibility === 'partial') {
            domain_context = `\n\nNOTE: Partial domain match. ${domain_match.reasoning || ''}\nScore should not exceed ${domain_match.score_cap || 50} unless there is genuinely strong overlap in required technical skills.`;
        }

        const system = `You are an expert career-fit analyzer for CareerLens AI. Compute a detailed compatibility score between a job description and a resume.

SCORING WEIGHTS:
- Required skills match: 40% weight
- Relevant experience quality: 25% weight
- Domain/field alignment: 15% weight
- Seniority match: 10% weight
- Education & certifications: 5% weight
- Projects as evidence: 5% weight

HARD RULES:
- NEVER fabricate a skill or experience the resume doesn't support
- NEVER inflate score due to generic keyword overlap across unrelated domains
- NEVER claim a candidate 'has' something not evidenced in the resume
- If evidence is ambiguous or thin, say so explicitly
- Distinguish 'missing a few skills' from 'fundamentally wrong domain'
- Weight required JD skills ABOVE preferred/optional ones
- Recognize synonyms and semantic equivalents (e.g., PostgreSQL ≈ relational database experience)
- Penalize seniority mismatches (junior resume vs senior JD requirements)${domain_context}

Respond with ONLY valid JSON, no markdown formatting, no code blocks.`;

        const jdSlice = jd_text.substring(0, 6000);
        const resSlice = resume_text.substring(0, 6000);
        const domainStr = JSON.stringify(domain_match, Object.keys(domain_match).sort());

        const prompt = `Analyze the compatibility between this JD and resume.\n\n--- JOB DESCRIPTION ---\n${jdSlice}\n--- END JD ---\n\n--- RESUME ---\n${resSlice}\n--- END RESUME ---\n\nRespond with ONLY this JSON:\n{"overall_score": integer_0_to_100, "domain_compatibility": "match|partial|mismatch", "required_skills_score": integer_0_to_100, "experience_score": integer_0_to_100, "domain_alignment_score": integer_0_to_100, "seniority_score": integer_0_to_100, "education_score": integer_0_to_100, "projects_score": integer_0_to_100, "matched_skills": ["skill1", "skill2"], "missing_critical": [{"skill": "name", "why_critical": "reason from JD", "learnable": true/false}], "missing_important": [{"skill": "name", "why_important": "reason", "learnable": true/false}], "missing_optional": [{"skill": "name", "why_optional": "reason", "learnable": true/false}], "strengths": ["strength1", "strength2"], "seniority_assessment": "description of seniority match/mismatch", "reasoning": "overall explanation of score"}`;

        const cid = _cache_key('compute_match', jdSlice, resSlice, domainStr);
        let result = await this._call_cached(cid, prompt, system);

        if (!result || typeof result !== 'object') {
            result = {
                overall_score: 0,
                reasoning: 'Failed to parse match score response.',
                matched_skills: [],
                missing_critical: [],
                missing_important: [],
                missing_optional: [],
                strengths: []
            };
        }

        if (domain_match.compatibility === 'mismatch') {
            const cap = domain_match.score_cap || 10;
            if ((result.overall_score || 0) > cap) {
                result.overall_score = cap;
            }
            result.domain_compatibility = 'mismatch';
        }

        return {
            overall_score: result.overall_score || 0,
            domain_compatibility: result.domain_compatibility || domain_match.compatibility || 'unknown',
            required_skills_score: result.required_skills_score || 0,
            experience_score: result.experience_score || 0,
            domain_alignment_score: result.domain_alignment_score || 0,
            seniority_score: result.seniority_score || 0,
            education_score: result.education_score || 0,
            projects_score: result.projects_score || 0,
            matched_skills: result.matched_skills || [],
            missing_critical: result.missing_critical || [],
            missing_important: result.missing_important || [],
            missing_optional: result.missing_optional || [],
            strengths: result.strengths || [],
            seniority_assessment: result.seniority_assessment || '',
            reasoning: result.reasoning || ''
        };
    }

    // ── Narrative generation calls ───────

    async generate_return_path(score_result, jd_text, resume_text) {
        if (!this.apiKey) {
            return this._fallback_narrative('return_path', score_result);
        }

        const system = `You are a career advisor. Based on the match analysis, provide a concise, actionable career direction. Be specific — not generic.\n\nFor domain mismatches: explicitly state that resume editing alone cannot fix this. Real education/experience is required.\nFor partial matches: suggest specific roles or ways to bridge the gap.\nFor good matches: suggest how to strengthen the application for this specific role.`;

        const prompt = `Match analysis:\n${JSON.stringify(score_result, null, 2)}\n\nJD summary (first 2000 chars):\n${jd_text.substring(0, 2000)}\n\nResume summary (first 2000 chars):\n${resume_text.substring(0, 2000)}\n\nProvide a concise, actionable return path (2-4 sentences max).`;

        const res = await this._call(prompt, system, 0.3);
        return res.trim();
    }

    async generate_enlightenment(score_result) {
        if (!this.apiKey) {
            return this._fallback_narrative('enlightenment', score_result);
        }

        const system = `You are an explainable AI analyst. Explain why a resume received a particular match score against a job description. Be concise but thorough.\nCover: what aligns, what doesn't, and whether gaps are minor or fundamental.`;

        const prompt = `Explain this match score:\n${JSON.stringify(score_result, null, 2)}\n\nProvide a concise enlightenment paragraph (3-5 sentences).`;

        const res = await this._call(prompt, system, 0.3);
        return res.trim();
    }

    async generate_action_plan(score_result, jd_text) {
        if (!this.apiKey) {
            return this._fallback_narrative('action_plan', score_result);
        }

        const system = `You are a career action planner. Based on the match analysis, create a concrete action plan organized as:\n- Immediate actions (this week)\n- Short-term goals (1-3 months)\n- Practical projects to build evidence\n- Application strategy\n\nFor fundamental domain mismatches: explicitly state that resume editing alone cannot fix this — real education/experience is required.\nBe specific and actionable, not generic.`;

        const prompt = `Match analysis:\n${JSON.stringify(score_result, null, 2)}\n\nJD (first 2000 chars):\n${jd_text.substring(0, 2000)}\n\nCreate a numbered, concrete action plan.`;

        const res = await this._call(prompt, system, 0.3);
        return res.trim();
    }

    async suggest_courses(missing_skills, domain_compatibility) {
        if (!this.apiKey) {
            return this._fallback_suggest_courses(missing_skills, domain_compatibility);
        }

        if (domain_compatibility === 'mismatch') return [];
        if (!missing_skills || missing_skills.length === 0) return [];

        const skill_names = missing_skills.map(s => typeof s === 'object' ? s.skill : String(s));

        const system = `You are a course recommendation engine. Suggest REAL, well-known courses from major platforms (Coursera, Udemy, LinkedIn Learning, edX, Pluralsight, etc.) for the given skill gaps.\n\nCRITICAL RULES:\n- ONLY suggest courses you are highly confident actually exist\n- Use well-known course titles from major platforms\n- Include a plausible URL for each course (use the standard URL format for the platform)\n- Do NOT fabricate prices or instructor names\n- If unsure about a specific course, suggest the platform and topic area instead\n- Limit to 3-5 courses total covering the most critical gaps\n\nURL format examples:\n- Coursera: https://www.coursera.org/learn/course-slug\n- Udemy: https://www.udemy.com/course/course-slug/\n- edX: https://www.edx.org/learn/topic/course-slug\n- LinkedIn Learning: https://www.linkedin.com/learning/course-slug\n\nRespond with ONLY valid JSON, no markdown formatting, no code blocks.`;

        const prompt = `Suggest real courses for these skill gaps:\n${JSON.stringify(skill_names)}\n\nRespond with ONLY this JSON:\n[{"skill": "skill name", "course_name": "actual course title", "platform": "platform name", "url": "https://...", "reasoning": "why this course helps"}]`;

        const response_text = await this._call(prompt, system, 0.3);
        const result = this._parse_json_response(response_text);

        if (Array.isArray(result)) {
            return result;
        }
        return [];
    }
}
