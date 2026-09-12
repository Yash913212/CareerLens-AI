import { CourseRecommender } from './courses.js';

export class MatchResult {
    constructor(data) {
        // Direct mapping of the massive JSON returned by LLM
        this.analysisId = data.analysisId;
        this.job = data.job || {};
        this.candidate = data.candidate || {};
        this.scores = data.scores || {};
        this.domainAssessment = data.domainAssessment || {};
        this.atsAnalysis = data.atsAnalysis || {};
        this.requiredSkills = data.requiredSkills || {};
        this.experienceAnalysis = data.experienceAnalysis || {};
        this.educationAnalysis = data.educationAnalysis || {};
        this.atsIssues = data.atsIssues || [];
        this.qualificationGaps = data.qualificationGaps || [];
        this.resumeImprovements = data.resumeImprovements || [];
        this.courseRecommendations = data.courseRecommendations || [];
        this.returnPath = data.returnPath || {};
        this.summary = data.summary || {};
        
        // Map legacy overall_score to jobMatchScore for bot compatibility if needed
        this.overall_score = this.scores.jobMatchScore || 0;
    }
}

export class MatchingEngine {
    constructor(llm_client) {
        this.llm = llm_client;
        this.course_recommender = new CourseRecommender(this.llm);
    }

    async analyze_pair(jd_doc, resume_doc) {
        // Run the consolidated massive prompt
        const score_data = await this.llm.run_ats_job_match_analysis(
            jd_doc.text, 
            resume_doc.text,
            jd_doc.filename,
            resume_doc.filename
        );

        const result = new MatchResult(score_data);

        // Live verify courses
        if (result.courseRecommendations && result.courseRecommendations.length > 0) {
            // Map course_recommendations to expected CourseRecommender format
            // CourseRecommender expects { skill, course_name, platform, url, reasoning }
            const mappedRecs = result.courseRecommendations.map(c => ({
                skill: c.skill,
                course_name: c.course_name,
                platform: c.platform,
                url: c.url,
                reasoning: c.reasoning
            }));
            
            // Re-assign mapped recommendations object that has verification flags
            // Using a mock format for course verification since we don't know exactly how it verifies
            // But we can just pass it to course_recommender.get_verified_recommendations
            const fakeLegacyScoreData = { course_recommendations: mappedRecs };
            result.course_recommendations = await this.course_recommender.get_verified_recommendations(fakeLegacyScoreData);
        } else {
            result.course_recommendations = [];
        }

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
