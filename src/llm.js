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
        this.apiKey = process.env.GEMINI_API_KEY;
        if (!this.apiKey) {
            throw new Error(
                "GEMINI_API_KEY not found. Set it in your .env file or environment variables."
            );
        }
        // Array of Gemini models
        this.models = [
            'gemini-2.5-flash',
            'gemini-2.5-pro',
            'gemma-4-31b-it'
        ];
    }

    /**
     * Internal call with retry-with-backoff for 429 rate limits.
     */

    async _callWithRetry(options, maxRetries = 5) {
        let attempt = 0;
        while (attempt <= maxRetries) {
            try {
                const response = await axios.post('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', options, {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 120000 // 2 minute timeout for large responses
                });
                return response.data.choices[0]?.message?.content || "";
            } catch (error) {
                const status = error.response?.status || error.status;
                const message = error.response?.data?.error?.message || error.message || '';

                if (status === 429 && attempt < maxRetries) {
                    attempt++;
                    // Try to parse the suggested retry time from the error message
                    let waitTime = 40000; // default: wait 40 seconds for free tier
                    try {
                        const errMsg = JSON.stringify(error.response?.data || "");
                        const retryMatch = errMsg.match(/retry in ([\d.]+)s/i);
                        if (retryMatch) {
                            waitTime = Math.ceil(parseFloat(retryMatch[1])) * 1000 + 2000; // add 2s buffer
                        }
                    } catch (_) {}
                    console.warn(`[Gemini API Rate Limit] 429 received. Waiting ${Math.round(waitTime / 1000)}s before retry (Attempt ${attempt}/${maxRetries})...`);
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

        const options = {
            model: this.models[0],
            messages: messages,
            max_tokens: 8192,
            response_format: { type: "json_object" }
        };

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
        } else {
            console.error("====== RAW GEMINI API RESPONSE ======\n", response_text, "\n=====================================");
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


    async run_ats_job_match_analysis(jd_text, resume_text, jd_id, resume_id) {
        const system = `CareerLens AI — ATS + Job Match Intelligence Engine

You are the core analysis engine for CareerLens AI.
Your purpose is to analyze one Job Description against one Resume and produce a strict, evidence-based ATS analysis + real job-fit analysis.
You must be conservative and realistic. Never inflate scores. Never invent resume information. Never assume a missing skill exists. Never confuse ATS optimization with actual candidate suitability.

CORE PRINCIPLE
There are TWO DIFFERENT SCORES.

1. ATS SCORE
The ATS Score measures: "How well is this resume optimized and aligned with this specific Job Description for an Applicant Tracking System?"
It evaluates: JD keyword coverage, Required skill coverage, Job title alignment, Technical terminology, Relevant experience keywords, Education/Certification keywords, Industry/domain terminology, Resume structure, ATS readability, Keyword context.
Do NOT use simple keyword counting. Context matters. Classify keywords as EXACT, SEMANTIC, MISSING, or IRRELEVANT.

ATS SCORE WEIGHTS
- JD Keyword Coverage: 25%
- Required Skill Keyword Coverage: 25%
- Experience / Responsibility Alignment: 15%
- Job Title / Role Alignment: 10%
- Education / Certification Alignment: 5%
- Industry / Domain Terminology: 5%
- Resume Structure & ATS Readability: 10%
- Achievement / Evidence Quality: 5%

2. JOB MATCH SCORE
The Job Match Score measures: "How realistically does this candidate qualify for and fit this specific job?"
It evaluates: Required skills, Demonstrated professional experience, Domain alignment, Seniority, Education, Relevant projects, Certifications, Responsibilities alignment.

JOB MATCH SCORE WEIGHTS
- Required Skills: 35%
- Professional Experience: 25%
- Domain Alignment: 20%
- Seniority: 10%
- Education / Certifications: 5%
- Relevant Projects: 5%

CRITICAL MATCH GATES
- FUNDAMENTAL DOMAIN MISMATCH: If the JD and candidate background are fundamentally different, FINAL JOB MATCH SCORE <= 15 (unless substantial career transition evidence exists).
- EXPERIENCE GATE: Projects and courses cannot be counted as professional experience.
- SENIORITY GATE: Seniority mismatches must materially reduce the score.

SHORTLIST PROBABILITY
Provide a qualitative assessment: VERY HIGH, HIGH, MODERATE, LOW, VERY LOW.

ATS IMPROVEMENT ENGINE
Categorize ATS Fixes:
🔴 CRITICAL: Missing mandatory JD keywords or major structural problems.
🟠 IMPORTANT: Missing preferred keywords or weak evidence.
🟡 OPTIMIZATION: Formatting, wording, measurable achievements, keyword placement.
IMPORTANT: Do NOT tell the candidate to falsely add a skill. Say "Learn and demonstrate it through a project before adding it."

COURSE RECOMMENDATIONS
Recommend courses ONLY for genuine skill gaps. Do NOT use courses to compensate for professional experience requirements. Only suggest well-known courses from major platforms (Coursera, Udemy, etc.) with plausible URLs.

FINAL API RESPONSE
Respond ONLY with valid JSON following this exact schema:
{
  "analysisId": "ANL-XYZ",
  "job": { "id": "JD", "title": "", "domain": "", "seniority": "" },
  "candidate": { "id": "RES", "name": "", "currentTitle": "", "professionalExperienceYears": 0 },
  "scores": { "atsScore": 0, "jobMatchScore": 0, "shortlistOutlook": "", "confidence": "" },
  "domainAssessment": { "status": "ALIGNED|PARTIAL|MISMATCH", "reason": "" },
  "atsAnalysis": { "keywordCoverage": 0, "requiredSkillCoverage": 0, "experienceAlignment": 0, "jobTitleAlignment": 0, "educationCertificationAlignment": 0, "domainTerminologyAlignment": 0, "structureReadability": 0, "evidenceQuality": 0 },
  "requiredSkills": { "matched": [], "partial": [], "missing": [] },
  "experienceAnalysis": { "required": "", "candidate": "", "gap": "", "professionalExperienceMatch": "ALIGNED|PARTIAL|MISMATCH" },
  "educationAnalysis": { "required": [], "candidate": [], "status": "ALIGNED|PARTIAL|MISMATCH" },
  "atsIssues": [ { "priority": "CRITICAL|IMPORTANT|OPTIMIZATION", "requirement": "", "problem": "", "recommendation": "" } ],
  "qualificationGaps": [ { "priority": "CRITICAL|IMPORTANT", "gap": "", "whyItMatters": "", "howToImprove": "" } ],
  "resumeImprovements": [ { "priority": "", "section": "", "recommendation": "" } ],
  "courseRecommendations": [ { "skill": "", "course_name": "", "platform": "", "url": "", "reasoning": "" } ],
  "returnPath": { "decision": "APPLY WITH RESUME IMPROVEMENTS|CAREER TRANSITION REQUIRED|UPSKILLING REQUIRED|... ", "reason": "" },
  "summary": { "topStrengths": [], "topWeaknesses": [], "biggestProblem": "", "biggestImprovement": "" }
}
`;

        const jdSlice = jd_text.substring(0, 8000);
        const resSlice = resume_text.substring(0, 8000);
        const prompt = `Perform an independent ATS + Job Match analysis for the following documents.\n\n--- JOB DESCRIPTION (${jd_id}) ---\n${jdSlice}\n--- END JD ---\n\n--- RESUME (${resume_id}) ---\n${resSlice}\n--- END RESUME ---\n\nRespond with ONLY valid JSON.`;

        const cid = _cache_key("run_ats_job_match_analysis", jdSlice, resSlice);
        let result = await this._call_cached(cid, prompt, system);

        if (!result || typeof result !== 'object') {
            console.error("Raw LLM Output that failed to parse (cached result was null or non-object)");
            throw new Error("Failed to parse ATS + Job Match analysis response.");
        }

        return result;
    }
}
