import crypto from 'crypto';
import dotenv from 'dotenv';
import axios from 'axios';

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

export function clear_extraction_cache() {
    _extraction_cache.clear();
}

export class LLMClient {
    static EXTRACTION_SEED = 42;

    constructor() {
        this.apiKey = process.env.OPENROUTER_API_KEY;
        if (!this.apiKey) {
            throw new Error(
                "OPENROUTER_API_KEY not found. Set it in your .env file or environment variables."
            );
        }
        // Fallback array for free OpenRouter models
        this.models = [
            'google/gemini-2.5-flash:free', 
            'google/gemma-4-31b-it:free', 
            'nex-agi/nex-n2.5-pro:free'
        ];
    }

    /**
     * Internal call with retry-with-backoff for 429 rate limits.
     */
    async _callWithRetry(options, maxRetries = 3) {
        let attempt = 0;
        while (attempt <= maxRetries) {
            try {
                const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', options, {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    }
                });
                return response.data.choices[0]?.message?.content || "";
            } catch (error) {
                const status = error.response?.status || error.status;
                if (status === 429 && attempt < maxRetries) {
                    attempt++;
                    const waitTime = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                    console.warn(`[OpenRouter Rate Limit] 429 received. Retrying in ${Math.round(waitTime)}ms (Attempt ${attempt}/${maxRetries})...`);
                    await new Promise(res => setTimeout(res, waitTime));
                } else {
                    console.error("LLM Error:", error.response?.data || error.message);
                    throw error;
                }
            }
        }
    }

    async _call(prompt, system_instruction = "", temperature = 0.3, deterministic = false) {
        const messages = [];
        if (system_instruction) {
            messages.push({ role: "system", content: system_instruction });
        }
        messages.push({ role: "user", content: prompt });

        const options = {
            models: this.models,
            messages: messages,
            max_tokens: 4096
        };

        if (deterministic) {
            options.temperature = 0;
            options.top_p = 1;
        } else {
            options.temperature = temperature;
        }

        return await this._callWithRetry(options);
    }

    async _call_cached(cache_id, prompt, system_instruction = "") {
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
        let cleaned = response_text.trim();

        // Strip markdown code fences
        if (cleaned.startsWith("```")) {
            const lines = cleaned.split("\n");
            cleaned = lines.slice(1).join("\n");
            if (cleaned.trimEnd().endsWith("```")) {
                cleaned = cleaned.trimEnd().slice(0, -3);
            }
        }
        cleaned = cleaned.trim();

        try {
            return JSON.parse(cleaned);
        } catch (e) {
            // Try extracting object
            const objMatch = cleaned.match(/\{[\s\S]*\}/);
            if (objMatch) {
                try {
                    return JSON.parse(objMatch[0]);
                } catch (e2) {}
            }
            
            // Try extracting array
            const arrMatch = cleaned.match(/\[[\s\S]*\]/);
            if (arrMatch) {
                try {
                    return JSON.parse(arrMatch[0]);
                } catch (e3) {}
            }
        }
        return null;
    }

    // ── Structured extraction calls ──────────────

    async classify(text, filename = "", user_label = "") {
        const system = `You are a document classifier for CareerLens AI. Your task is to classify documents as either a Job Description (JD) or a Resume/CV.

Classification signals for JD: job title being hired for, 'responsibilities', 'requirements', 'qualifications', 'we are looking for', 'the role', 'about the company', 'preferred skills', 'must have'.

Classification signals for Resume: personal name at top, 'experience', 'education', 'skills' section listing the person's own skills, 'projects', 'certifications', 'objective', 'summary' describing the person's career.

IMPORTANT: Do NOT rely on filename. Analyze the content structure and language.
If confidence is low, classify as 'ambiguous'.

Respond with ONLY valid JSON, no markdown formatting, no code blocks.`;

        let user_label_note = "";
        if (user_label) {
            user_label_note = `\n\nThe user has labeled this document as: '${user_label}'. Trust the user's label unless the content STRONGLY contradicts it. If there is a conflict, set 'conflict' to true and explain in reasoning.`;
        }

        const prompt = `Classify the following document.\n\nFilename: ${filename || 'unknown'}\n${user_label_note}\n\n--- DOCUMENT CONTENT ---\n${text.substring(0, 8000)}\n--- END DOCUMENT ---\n\nRespond with ONLY this JSON structure:\n{"doc_type": "job_description" | "resume" | "ambiguous", "confidence": "high" | "medium" | "low", "reasoning": "brief explanation", "conflict": false}`;

        const cid = _cache_key("classify", text.substring(0, 8000), user_label);
        let result = await this._call_cached(cid, prompt, system);

        if (!result || typeof result !== 'object') {
            result = {
                doc_type: "ambiguous",
                confidence: "low",
                reasoning: "Failed to parse LLM classification response.",
                conflict: false
            };
        }

        return {
            doc_type: result.doc_type || "ambiguous",
            confidence: result.confidence || "low",
            reasoning: result.reasoning || "",
            conflict: result.conflict || false
        };
    }

    async detect_domain(text, doc_type) {
        const system = `You are a domain detection expert. Analyze the document content to determine the professional domain, sub-domains, key technologies, and seniority level.

IMPORTANT: Determine the domain from responsibilities, required skills, technologies, education, and project evidence — NOT from job titles alone and NOT from generic overlapping words (teamwork, communication, 'engineer', 'project').

Respond with ONLY valid JSON, no markdown formatting, no code blocks.`;

        const typeStr = doc_type === 'job_description' ? 'job description' : 'resume';
        const prompt = `Analyze this ${typeStr} and determine its professional domain.\n\n--- DOCUMENT CONTENT ---\n${text.substring(0, 8000)}\n--- END DOCUMENT ---\n\nRespond with ONLY this JSON structure:\n{"domain": "primary domain name", "sub_domains": ["sub-domain 1", "sub-domain 2"], "key_technologies": ["tech1", "tech2"], "seniority_level": "entry/junior/mid/senior/lead/not_applicable", "reasoning": "brief explanation"}`;

        const cid = _cache_key("detect_domain", text.substring(0, 8000), doc_type);
        let result = await this._call_cached(cid, prompt, system);

        if (!result || typeof result !== 'object') {
            result = {
                domain: "Unknown",
                sub_domains: [],
                key_technologies: [],
                seniority_level: "not_applicable",
                reasoning: "Failed to parse domain detection response."
            };
        }

        return {
            domain: result.domain || "Unknown",
            sub_domains: result.sub_domains || [],
            key_technologies: result.key_technologies || [],
            seniority_level: result.seniority_level || "not_applicable",
            reasoning: result.reasoning || ""
        };
    }

    async check_domain_compatibility(jd_domain, resume_domain) {
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

        const cid = _cache_key("check_domain_compat", jdStr, resStr);
        let result = await this._call_cached(cid, prompt, system);

        if (!result || typeof result !== 'object') {
            result = {
                compatibility: "partial",
                score_cap: 50,
                reasoning: "Failed to parse compatibility response. Defaulting to partial."
            };
        }

        return {
            compatibility: result.compatibility || "partial",
            score_cap: result.score_cap !== undefined ? result.score_cap : null,
            reasoning: result.reasoning || ""
        };
    }

    async compute_match_score(jd_text, resume_text, domain_match) {
        let domain_context = "";
        if (domain_match.compatibility === "mismatch") {
            domain_context = `\n\nCRITICAL: Domain mismatch detected. ${domain_match.reasoning || ''}\nScore MUST be capped at ${domain_match.score_cap || 10}. This is a fundamental domain mismatch, not a skill gap. Do NOT inflate the score due to generic keyword overlap.`;
        } else if (domain_match.compatibility === "partial") {
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

        const cid = _cache_key("compute_match", jdSlice, resSlice, domainStr);
        let result = await this._call_cached(cid, prompt, system);

        if (!result || typeof result !== 'object') {
            result = {
                overall_score: 0,
                reasoning: "Failed to parse match score response.",
                matched_skills: [],
                missing_critical: [],
                missing_important: [],
                missing_optional: [],
                strengths: []
            };
        }

        // Enforce domain mismatch cap
        if (domain_match.compatibility === "mismatch") {
            const cap = domain_match.score_cap || 10;
            if ((result.overall_score || 0) > cap) {
                result.overall_score = cap;
            }
            result.domain_compatibility = "mismatch";
        }

        return {
            overall_score: result.overall_score || 0,
            domain_compatibility: result.domain_compatibility || domain_match.compatibility || "unknown",
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
            seniority_assessment: result.seniority_assessment || "",
            reasoning: result.reasoning || ""
        };
    }

    // ── Narrative generation calls ───────

    async generate_return_path(score_result, jd_text, resume_text) {
        const system = `You are a career advisor. Based on the match analysis, provide a concise, actionable career direction. Be specific — not generic.\n\nFor domain mismatches: explicitly state that resume editing alone cannot fix this. Real education/experience is required.\nFor partial matches: suggest specific roles or ways to bridge the gap.\nFor good matches: suggest how to strengthen the application for this specific role.`;

        const prompt = `Match analysis:\n${JSON.stringify(score_result, null, 2)}\n\nJD summary (first 2000 chars):\n${jd_text.substring(0, 2000)}\n\nResume summary (first 2000 chars):\n${resume_text.substring(0, 2000)}\n\nProvide a concise, actionable return path (2-4 sentences max).`;

        const res = await this._call(prompt, system, 0.3);
        return res.trim();
    }

    async generate_enlightenment(score_result) {
        const system = `You are an explainable AI analyst. Explain why a resume received a particular match score against a job description. Be concise but thorough.\nCover: what aligns, what doesn't, and whether gaps are minor or fundamental.`;

        const prompt = `Explain this match score:\n${JSON.stringify(score_result, null, 2)}\n\nProvide a concise enlightenment paragraph (3-5 sentences).`;

        const res = await this._call(prompt, system, 0.3);
        return res.trim();
    }

    async generate_action_plan(score_result, jd_text) {
        const system = `You are a career action planner. Based on the match analysis, create a concrete action plan organized as:\n- Immediate actions (this week)\n- Short-term goals (1-3 months)\n- Practical projects to build evidence\n- Application strategy\n\nFor fundamental domain mismatches: explicitly state that resume editing alone cannot fix this — real education/experience is required.\nBe specific and actionable, not generic.`;

        const prompt = `Match analysis:\n${JSON.stringify(score_result, null, 2)}\n\nJD (first 2000 chars):\n${jd_text.substring(0, 2000)}\n\nCreate a numbered, concrete action plan.`;

        const res = await this._call(prompt, system, 0.3);
        return res.trim();
    }

    async suggest_courses(missing_skills, domain_compatibility) {
        if (domain_compatibility === "mismatch") return [];
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
