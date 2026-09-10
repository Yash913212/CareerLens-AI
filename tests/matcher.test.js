import fs from 'fs';
import path from 'path';
import { LLMClient, clear_extraction_cache } from '../src/llm.js';
import { MatchingEngine } from '../src/matcher.js';
import { Session } from '../src/session.js';
import { parse_file } from '../src/parser.js';
import { format_single_analysis } from '../src/output.js';
import { set_network_enabled, UNVERIFIED_DISCLAIMER } from '../src/courses.js';
import { jest } from '@jest/globals';

const FIXTURES_DIR = path.join(process.cwd(), 'tests', 'fixtures');

function load_fixture(filename) {
    const p = path.join(FIXTURES_DIR, filename);
    return fs.readFileSync(p, 'utf8');
}

// Set longer timeout for LLM calls
jest.setTimeout(60000);

describe('CareerLens AI Matching Engine', () => {
    let llm;
    let engine;
    let session;

    beforeAll(() => {
        llm = new LLMClient();
        engine = new MatchingEngine(llm);
    });

    beforeEach(() => {
        clear_extraction_cache();
        session = new Session();
    });

    test('Output is plain text without emojis or markdown decorations', () => {
        const formatted = format_single_analysis(
            { filename: 'JD.txt' },
            { filename: 'Resume.pdf' },
            {
                overall_score: 94,
                domain_compatibility: 'match',
                enlightenment: 'The resume is a strong fit for the role.',
                required_skills_score: 100,
                experience_score: 85,
                domain_alignment_score: 95,
                seniority_score: 90,
                education_score: 100,
                projects_score: 95,
                return_path: 'Keep building proof and target junior full-stack roles.',
                action_plan: 'Improve the resume and add one end-to-end project.'
            }
        );

        expect(formatted).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
        expect(formatted).not.toMatch(/^#/m);
        expect(formatted).not.toContain('**');
        expect(formatted).not.toContain('|');
    });

    test('Groq provider uses a supported model', () => {
        expect(llm.models[0]).toMatch(/qwen\/qwen3\.8-27b|qwen\/qwen3\.6-27b|openai\/gpt-oss-20b|openai\/gpt-oss-120b|groq\/compound/);
    });

    test('Test 01 - Perfect Match', async () => {
        const jd_text = load_fixture('jd_software_engineer.txt');
        const resume_text = load_fixture('resume_software_strong.txt');

        const jd_doc = session.add_document('jd1', 'jd_software_engineer.txt', jd_text, 'job_description');
        const resume_doc = session.add_document('res1', 'resume_software_strong.txt', resume_text, 'resume');

        const result = await engine.analyze_pair(jd_doc, resume_doc);

        expect(result.domain_compatibility).toBe('match');
        expect(result.overall_score).toBeGreaterThan(80);
    });

    test('Test 15 - Course Verification', async () => {
        set_network_enabled(false); // test network failure fallback
        
        const jd_text = load_fixture('jd_software_engineer.txt');
        const resume_text = load_fixture('resume_software_junior.txt');

        const jd_doc = session.add_document('jd2', 'jd_se.txt', jd_text, 'job_description');
        const resume_doc = session.add_document('res2', 'res_jr.txt', resume_text, 'resume');

        const result = await engine.analyze_pair(jd_doc, resume_doc);

        if (result.course_recommendations.length > 0) {
            const allUnverified = result.course_recommendations.every(c => c.verified === false && c.network_unavailable === true);
            expect(allUnverified).toBe(true);
            const hasDisclaimer = result.course_recommendations.some(c => c.verification_note.includes(UNVERIFIED_DISCLAIMER));
            expect(hasDisclaimer).toBe(true);
        }
        set_network_enabled(true);
    });

    test('Test 21 - Determinism', async () => {
        const jd_text = load_fixture('jd_software_engineer.txt');
        const resume_text = load_fixture('resume_software_strong.txt');

        const jd_doc = session.add_document('jd3', 'jd.txt', jd_text, 'job_description');
        const resume_doc = session.add_document('res3', 'res.txt', resume_text, 'resume');

        const result1 = await engine.analyze_pair(jd_doc, resume_doc);

        // Reset domain info to force cache hit check
        jd_doc.domain_info = null;
        resume_doc.domain_info = null;

        const result2 = await engine.analyze_pair(jd_doc, resume_doc);

        expect(result1.overall_score).toBe(result2.overall_score);
        expect(result1.domain_compatibility).toBe(result2.domain_compatibility);
    });

    test('Test 27 - Rate Limit Handling (Mocked 429)', async () => {
        const mockLlm = new LLMClient();

        jest.spyOn(mockLlm.client.chat.completions, 'create').mockImplementation(() => {
            const err = new Error('Rate limit exceeded');
            err.status = 429;
            throw err;
        });

        const result = await mockLlm._call('Test prompt', 'Test system', 0.1, true);

        expect(typeof result).toBe('string');
        expect(result).toContain('fallback');
        expect(result).toContain('rate limit');
    });

    test('Timeouts fall back to offline mode instead of hanging', async () => {
        const mockLlm = new LLMClient();
        mockLlm.provider = 'groq';
        mockLlm.apiKey = 'fake-key';

        jest.spyOn(mockLlm.client.chat.completions, 'create').mockImplementation(() => new Promise(() => {}));

        const result = await mockLlm._call('Delayed test prompt', 'Test system', 0.1, true, 120);

        expect(typeof result).toBe('string');
        expect(result).toContain('fallback');
        expect(result).toContain('timed out');
    });
});
