export function format_single_analysis(jd_doc, resume_doc, result) {
    const lines = [];

    const skillLabel = result.domain_compatibility === 'mismatch'
        ? 'Weak fit'
        : result.domain_compatibility === 'partial'
            ? 'Partial fit'
            : 'Strong fit';

    lines.push('Resume vs JD Analysis');
    lines.push(`ATS Score: ${result.overall_score}/100`);
    lines.push(`Skill Match: ${skillLabel}`);
    lines.push(`Return Path: ${result.return_path || 'No clear path provided.'}`);
    lines.push('');

    lines.push('Enlightenment:');
    lines.push(result.enlightenment || 'No explanation provided.');
    lines.push('');

    lines.push('What the resume does well:');
    const strengths = Array.isArray(result.strengths) && result.strengths.length > 0
        ? result.strengths.slice(0, 4)
        : ['Relevant experience and domain signal are present.'];
    lines.push(...strengths.map(item => `- ${item}`));
    lines.push('');

    lines.push('What is missing:');
    const missing = [
        ...(Array.isArray(result.missing_critical) ? result.missing_critical : []).map(item => `${typeof item === 'object' ? item.skill : item} - Critical`),
        ...(Array.isArray(result.missing_important) ? result.missing_important : []).map(item => `${typeof item === 'object' ? item.skill : item} - Important`),
        ...(Array.isArray(result.missing_optional) ? result.missing_optional : []).map(item => `${typeof item === 'object' ? item.skill : item} - Optional`)
    ];
    if (missing.length > 0) {
        lines.push(...missing.slice(0, 8));
    } else {
        lines.push('No major gaps identified.');
    }
    lines.push('');

    lines.push('What you have to do:');
    const actionText = result.action_plan || 'No action plan provided.';
    lines.push(actionText);
    lines.push('');

    lines.push('Recommended courses:');
    if (Array.isArray(result.course_recommendations) && result.course_recommendations.length > 0) {
        for (const course of result.course_recommendations.slice(0, 4)) {
            const name = course.course_name || 'Course';
            const platform = course.platform || 'Platform';
            const reason = course.reasoning ? ` - ${course.reasoning}` : '';
            lines.push(`- ${name} (${platform})${reason}`);
        }
    } else {
        lines.push('No course recommendations for this profile at the moment.');
    }
    lines.push('');

    lines.push('Score breakdown:');
    lines.push(`Required Skills: ${result.required_skills_score}/100`);
    lines.push(`Experience: ${result.experience_score}/100`);
    lines.push(`Domain Alignment: ${result.domain_alignment_score}/100`);
    lines.push(`Seniority: ${result.seniority_score}/100`);
    lines.push(`Education & Certs: ${result.education_score}/100`);
    lines.push(`Projects: ${result.projects_score}/100`);
    lines.push('');
    lines.push('This is an AI-estimated compatibility score, not an actual employer ATS score.');

    return lines.join('\n');
}

export function format_multi_analysis(jd_docs, resume_docs, rankedResults) {
    const lines = [];
    lines.push('CareerLens AI Multi-Match Analysis');
    lines.push(`JD count: ${jd_docs.length}; Resume count: ${resume_docs.length}`);
    lines.push('');

    if (rankedResults && rankedResults.length > 0) {
        const top = rankedResults[0];
        lines.push(`Best match: ${top.resume.filename} for ${top.jd.filename} - ${top.result.overall_score}/100`);
        lines.push(`Best return path: ${top.result.return_path || 'Strong fit for this role.'}`);
        lines.push('');
    }

    for (const item of rankedResults.slice(0, 5)) {
        lines.push(`${item.resume.filename} vs ${item.jd.filename}: ${item.result.overall_score}/100`);
    }

    return lines.join('\n');
}
