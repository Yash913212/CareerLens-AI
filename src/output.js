export function format_single_analysis(jd_doc, resume_doc, result) {
    const lines = [];
    
    // Header
    lines.push(`# CareerLens AI Analysis`);
    lines.push(`**JD**: ${jd_doc.filename} | **Resume**: ${resume_doc.filename}`);
    lines.push(`---`);
    lines.push("");

    // 1. Overall Match & Domain Check
    lines.push(`## 1. Overall Match: ${result.overall_score}/100`);
    if (result.domain_compatibility === "mismatch") {
        lines.push(`> 🛑 **CRITICAL DOMAIN MISMATCH**`);
        lines.push(`> The candidate's background (${result.resume_domain?.domain || "Unknown"}) is fundamentally incompatible with the required domain (${result.jd_domain?.domain || "Unknown"}).`);
    } else if (result.domain_compatibility === "partial") {
        lines.push(`> ⚠️ **PARTIAL DOMAIN MATCH**`);
        lines.push(`> The candidate's background is related but not a perfect match for the required domain.`);
    } else {
        lines.push(`> ✅ **DOMAIN ALIGNED**`);
    }
    lines.push("");

    // 2. The Enlightenment (Why)
    lines.push(`## 2. The Enlightenment (Why this score?)`);
    lines.push(result.enlightenment || "No explanation provided.");
    lines.push("");

    // 3. Score Breakdown
    lines.push(`## 3. Score Breakdown`);
    lines.push(`| Category | Score |`);
    lines.push(`| :--- | :--- |`);
    lines.push(`| Required Skills | ${result.required_skills_score}/100 |`);
    lines.push(`| Experience | ${result.experience_score}/100 |`);
    lines.push(`| Domain Alignment | ${result.domain_alignment_score}/100 |`);
    lines.push(`| Seniority | ${result.seniority_score}/100 |`);
    lines.push(`| Education & Certs | ${result.education_score}/100 |`);
    lines.push(`| Projects | ${result.projects_score}/100 |`);
    lines.push("");

    // 4. Return Path (Direction)
    lines.push(`## 4. Return Path`);
    lines.push(result.return_path || "No direction provided.");
    lines.push("");

    // 5. Action Plan
    lines.push(`## 5. Action Plan`);
    lines.push(result.action_plan || "No specific action plan generated.");
    lines.push("");

    // 6. Recommended Courses
    if (result.course_recommendations && result.course_recommendations.length > 0 && result.domain_compatibility !== "mismatch") {
        lines.push(`## 📚 Recommended Courses`);
        lines.push("");

        const any_network_unavailable = result.course_recommendations.some(c => c.network_unavailable);
        if (any_network_unavailable) {
            lines.push(`> ⚠️ Course verification is unavailable in this session. The following are unverified suggestions and may not be fully accurate.`);
            lines.push("");
        }

        const verified = result.course_recommendations.filter(c => c.verified);
        const unverified = result.course_recommendations.filter(c => !c.verified);

        if (verified.length > 0) {
            lines.push(`### ✅ Verified`);
            for (const course of verified) {
                const name = course.course_name || "Unknown Course";
                const platform = course.platform || "Unknown";
                const url = course.url || "";
                const skill = course.skill || "";
                const reasoning = course.reasoning || "";

                if (url) {
                    lines.push(`- **[${name}](${url})** on ${platform}`);
                } else {
                    lines.push(`- **${name}** on ${platform}`);
                }
                if (skill) lines.push(`  - Addresses: ${skill}`);
                if (reasoning) lines.push(`  - ${reasoning}`);
            }
            lines.push("");
        }

        if (unverified.length > 0) {
            lines.push(`### ⚠️ Suggested (URL not verified — search links provided)`);
            for (const course of unverified) {
                const name = course.course_name || "Unknown Course";
                const platform = course.platform || "Unknown";
                const search_url = course.search_url || course.url || "";
                const skill = course.skill || "";

                if (search_url) {
                    lines.push(`- **${name}** on ${platform} — [Search →](${search_url})`);
                } else {
                    lines.push(`- **${name}** on ${platform}`);
                }
                if (skill) lines.push(`  - Addresses: ${skill}`);
            }
            lines.push("");
        }
    }

    lines.push(`---\n*Note: This is an AI-estimated compatibility score, not an actual employer ATS score.*`);
    return lines.join('\n');
}
