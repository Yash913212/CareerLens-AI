import { CourseRecommender } from './courses.js';

export class MatchResult {
    constructor(data) {
        this.jd_domain = data.jd_domain || {};
        this.resume_domain = data.resume_domain || {};
        this.domain_compatibility = data.domain_compatibility || "unknown";
        this.is_domain_mismatch = this.domain_compatibility === "mismatch";

        this.overall_score = data.overall_score || 0;
        this.required_skills_score = data.required_skills_score || 0;
        this.experience_score = data.experience_score || 0;
        this.domain_alignment_score = data.domain_alignment_score || 0;
        this.seniority_score = data.seniority_score || 0;
        this.education_score = data.education_score || 0;
        this.projects_score = data.projects_score || 0;

        this.matched_skills = data.matched_skills || [];
        this.missing_critical = data.missing_critical || [];
        this.missing_important = data.missing_important || [];
        this.missing_optional = data.missing_optional || [];
        this.strengths = data.strengths || [];
        this.seniority_assessment = data.seniority_assessment || "";
        this.reasoning = data.reasoning || "";

        this.return_path = data.return_path || "";
        this.enlightenment = data.enlightenment || "";
        this.action_plan = data.action_plan || "";
        this.course_recommendations = data.course_recommendations || [];
    }
}

export class MatchingEngine {
    constructor(llm_client) {
        this.llm = llm_client;
        this.course_recommender = new CourseRecommender(this.llm);
    }

    async analyze_pair(jd_doc, resume_doc) {
        if (!jd_doc.domain_info) {
            jd_doc.domain_info = await this.llm.detect_domain(jd_doc.text, jd_doc.doc_type);
        }
        if (!resume_doc.domain_info) {
            resume_doc.domain_info = await this.llm.detect_domain(resume_doc.text, resume_doc.doc_type);
        }

        const domain_match = await this.llm.check_domain_compatibility(jd_doc.domain_info, resume_doc.domain_info);

        const score_data = await this.llm.compute_match_score(jd_doc.text, resume_doc.text, domain_match);

        const is_mismatch = score_data.domain_compatibility === "mismatch";

        // Generate narratives
        const narratives = await Promise.all([
            this.llm.generate_return_path(score_data, jd_doc.text, resume_doc.text),
            this.llm.generate_enlightenment(score_data),
            this.llm.generate_action_plan(score_data, jd_doc.text),
            is_mismatch ? Promise.resolve([]) : this.llm.suggest_courses(
                [...(score_data.missing_critical || []), ...(score_data.missing_important || [])],
                score_data.domain_compatibility
            )
        ]);

        score_data.return_path = narratives[0];
        score_data.enlightenment = narratives[1];
        score_data.action_plan = narratives[2];
        score_data.course_recommendations = narratives[3];

        score_data.jd_domain = jd_doc.domain_info;
        score_data.resume_domain = resume_doc.domain_info;

        const result = new MatchResult(score_data);

        // Live verify courses
        result.course_recommendations = await this.course_recommender.get_verified_recommendations(result);

        // Save result
        jd_doc.analysis_results[resume_doc.id] = result;
        resume_doc.analysis_results[jd_doc.id] = result;

        return result;
    }

    async analyze_all(jd_docs, resume_docs) {
        const jdList = Array.isArray(jd_docs) ? jd_docs : [jd_docs].filter(Boolean);
        const resumeList = Array.isArray(resume_docs) ? resume_docs : [resume_docs].filter(Boolean);

        if (!jdList.length || !resumeList.length) {
            return { comparisons: [], best: null, rankings: [] };
        }

        const comparisons = [];
        for (const jd of jdList) {
            for (const resume of resumeList) {
                const result = await this.analyze_pair(jd, resume);
                comparisons.push({ jd, resume, result });
            }
        }

        comparisons.sort((a, b) => (b.result.overall_score || 0) - (a.result.overall_score || 0));

        const best = comparisons[0] || null;
        const ranking_by_jd = [];
        for (const jd of jdList) {
            const jdMatches = comparisons
                .filter(item => item.jd.id === jd.id)
                .sort((a, b) => (b.result.overall_score || 0) - (a.result.overall_score || 0));
            ranking_by_jd.push({ jd: jd.filename, matches: jdMatches.map(item => ({ resume: item.resume.filename, score: item.result.overall_score, domain_compatibility: item.result.domain_compatibility })) });
        }

        const ranking_by_resume = [];
        for (const resume of resumeList) {
            const resumeMatches = comparisons
                .filter(item => item.resume.id === resume.id)
                .sort((a, b) => (b.result.overall_score || 0) - (a.result.overall_score || 0));
            ranking_by_resume.push({ resume: resume.filename, matches: resumeMatches.map(item => ({ jd: item.jd.filename, score: item.result.overall_score, domain_compatibility: item.result.domain_compatibility })) });
        }

        return { comparisons, best, rankings: { by_jd: ranking_by_jd, by_resume: ranking_by_resume } };
    }
}
