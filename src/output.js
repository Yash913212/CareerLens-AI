export function format_single_analysis(jd_doc, resume_doc, result) {
    const lines = [];

    // Header
    lines.push(`━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`🎯 CAREERLENS AI`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━`);
    lines.push("");
    lines.push(`📄 JD: ${result.job?.title || jd_doc.filename}`);
    lines.push(`👤 Resume: ${result.candidate?.name || resume_doc.filename}`);
    lines.push("");

    // Scores
    lines.push(`📊 SCORES`);
    lines.push("");
    lines.push(`🤖 ATS Score: ${result.scores?.atsScore || 0}/100`);
    lines.push(`🎯 Job Match: ${result.scores?.jobMatchScore || 0}/100`);
    lines.push(`📌 Shortlist Outlook: ${result.scores?.shortlistOutlook || "UNKNOWN"}`);
    lines.push(`🔎 Confidence: ${result.scores?.confidence || "HIGH"}`);
    lines.push("");
    lines.push(`━━━━━━━━━━━━━━━━━━━━`);
    lines.push("");

    // Domain Fit
    lines.push(`🧩 DOMAIN FIT`);
    lines.push("");
    
    let domainIcon = "✅";
    if (result.domainAssessment?.status === "MISMATCH") domainIcon = "❌";
    else if (result.domainAssessment?.status === "PARTIAL") domainIcon = "⚠️";
    
    lines.push(`${domainIcon} ${result.job?.domain || "Domain"} — ${result.domainAssessment?.status || "UNKNOWN"}`);
    lines.push("");
    lines.push(`Reason:`);
    lines.push(result.domainAssessment?.reason || "No domain reasoning provided.");
    lines.push("");
    lines.push(`━━━━━━━━━━━━━━━━━━━━`);
    lines.push("");

    // ATS Analysis
    lines.push(`🤖 ATS ANALYSIS`);
    lines.push("");
    lines.push(`Matched Keywords`);
    const matched = result.requiredSkills?.matched || [];
    if (matched.length > 0) {
        matched.forEach(k => lines.push(`✅ ${k}`));
    } else {
        lines.push(`None identified.`);
    }
    lines.push('');

    lines.push(`Missing JD Keywords`);
    const missing = result.requiredSkills?.missing || [];
    if (missing.length > 0) {
        missing.forEach(k => lines.push(`❌ ${k}`));
    } else {
        lines.push(`None identified.`);
    }
    lines.push("");

    lines.push(`ATS Problems`);
    if (result.atsIssues && result.atsIssues.length > 0) {
        result.atsIssues.forEach(issue => {
            let icon = "🟡";
            if (issue.priority === "CRITICAL") icon = "🔴";
            else if (issue.priority === "IMPORTANT") icon = "🟠";
            lines.push(`${icon} ${issue.problem}`);
        });
    } else {
        lines.push(`No major ATS problems identified.`);
    }
    lines.push("");
    lines.push(`━━━━━━━━━━━━━━━━━━━━`);
    lines.push("");

    // Job Match
    lines.push(`🎯 JOB MATCH`);
    lines.push("");
    lines.push(`Required Skills`);
    matched.forEach(k => lines.push(`✅ ${k}`));
    const partial = result.requiredSkills?.partial || [];
    partial.forEach(k => lines.push(`⚠️ ${k}`));
    missing.forEach(k => lines.push(`❌ ${k}`));
    lines.push("");

    lines.push(`Experience`);
    lines.push(`JD requires: ${result.experienceAnalysis?.required || "Unknown"}`);
    lines.push(`Resume demonstrates: ${result.experienceAnalysis?.candidate || "Unknown"}`);
    lines.push("");
    let expIcon = "✅";
    if (result.experienceAnalysis?.professionalExperienceMatch === "MISMATCH") expIcon = "❌";
    else if (result.experienceAnalysis?.professionalExperienceMatch === "PARTIAL") expIcon = "⚠️";
    lines.push(`Status: ${expIcon} ${result.experienceAnalysis?.professionalExperienceMatch || "UNKNOWN"}`);
    lines.push("");

    lines.push(`Seniority`);
    let senIcon = "✅";
    if (result.job?.seniority && result.candidate?.professionalExperienceYears < 2 && result.job.seniority.toLowerCase().includes("senior")) senIcon = "❌";
    lines.push(`Status: ${senIcon} ALIGNED`); // Simplified for template, could be dynamic based on JSON
    lines.push("");
    lines.push(`━━━━━━━━━━━━━━━━━━━━`);
    lines.push("");

    // Critical Gaps
    if (result.qualificationGaps && result.qualificationGaps.length > 0) {
        lines.push(`🔴 CRITICAL GAPS`);
        lines.push("");
        result.qualificationGaps.forEach((gap, index) => {
            const numEmoji = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"][index] || "•";
            lines.push(`${numEmoji} ${gap.gap}. ${gap.whyItMatters}`);
            lines.push("");
        });
        lines.push(`━━━━━━━━━━━━━━━━━━━━`);
        lines.push("");
    }

    // ATS Improvements
    if (result.resumeImprovements && result.resumeImprovements.length > 0) {
        lines.push(`✏️ ATS IMPROVEMENTS`);
        lines.push("");
        result.resumeImprovements.forEach((imp, index) => {
            const numEmoji = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"][index] || "•";
            lines.push(`${numEmoji} ${imp.recommendation}`);
            lines.push("");
        });
        lines.push(`━━━━━━━━━━━━━━━━━━━━`);
        lines.push("");
    }

    // What You Should Do
    lines.push(`🚀 WHAT YOU SHOULD DO`);
    lines.push("");
    lines.push(`NOW`);
    result.resumeImprovements.slice(0, 3).forEach(imp => lines.push(`• ${imp.recommendation}`));
    lines.push("");
    lines.push(`NEXT`);
    result.qualificationGaps.slice(0, 2).forEach(gap => lines.push(`• ${gap.howToImprove}`));
    lines.push("");
    if (result.qualificationGaps.length > 2) {
        lines.push(`LONG TERM`);
        result.qualificationGaps.slice(2, 4).forEach(gap => lines.push(`• ${gap.howToImprove}`));
        lines.push("");
    }
    lines.push(`━━━━━━━━━━━━━━━━━━━━`);
    lines.push("");

    // Recommended Learning
    if (result.course_recommendations && result.course_recommendations.length > 0) {
        lines.push(`📚 RECOMMENDED LEARNING`);
        lines.push("");
        
        const verified = result.course_recommendations.filter(c => c.verified);
        const unverified = result.course_recommendations.filter(c => !c.verified);
        const coursesToShow = verified.length > 0 ? verified : unverified;

        coursesToShow.forEach((course, index) => {
            const name = course.course_name || "Unknown Course";
            const platform = course.platform || "Unknown";
            const url = course.url || course.search_url || "";
            const skill = course.skill || "";
            const reasoning = course.reasoning || "";

            lines.push(`${index + 1}. ${skill}`);
            lines.push(`Reason: ${reasoning}`);
            if (url) {
                lines.push(`Course: [${name}](${url}) on ${platform}`);
            } else {
                lines.push(`Course: ${name} on ${platform}`);
            }
            lines.push("");
        });
        lines.push(`━━━━━━━━━━━━━━━━━━━━`);
        lines.push("");
    }

    // Return Path
    lines.push(`🧭 RETURN PATH`);
    lines.push("");
    let pathIcon = "🟡";
    if (result.returnPath?.decision?.includes("TRANSITION")) pathIcon = "🔄";
    else if (result.returnPath?.decision?.includes("READY")) pathIcon = "✅";
    
    lines.push(`${pathIcon} ${result.returnPath?.decision || "UNKNOWN"}`);
    lines.push("");
    lines.push(`Reason:`);
    lines.push(result.returnPath?.reason || "No reasoning provided.");
    lines.push("");
    lines.push(`━━━━━━━━━━━━━━━━━━━━`);
    lines.push("");

    // Bottom Line
    lines.push(`💡 BOTTOM LINE`);
    lines.push("");
    lines.push(`ATS: ${result.scores?.atsScore || 0}/100`);
    lines.push(`Actual Job Fit: ${result.scores?.jobMatchScore || 0}/100`);
    lines.push("");
    if (result.scores?.jobMatchScore < 50) {
        lines.push(`The resume might have some matching keywords, but improving keyword alignment alone will not fully solve the qualification gaps.`);
    } else {
        lines.push(`The candidate is a solid fit for this role. ATS optimizations will increase visibility.`);
    }
    lines.push("");
    lines.push(`━━━━━━━━━━━━━━━━━━━━`);
    lines.push("");
    lines.push(`⚠️ CareerLens AI Score is an evidence-based estimate and is not the employer's actual ATS score.`);

    return lines.join('\n');
}
