import axios from 'axios';

const VERIFY_TIMEOUT = 8000;
const MAX_WORKERS = 4;

const REQUEST_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const PLATFORM_SEARCH_URLS = {
    "coursera": "https://www.coursera.org/search?query={}",
    "udemy": "https://www.udemy.com/courses/search/?q={}",
    "edx": "https://www.edx.org/search?q={}",
    "linkedin learning": "https://www.linkedin.com/learning/search?keywords={}",
    "pluralsight": "https://www.pluralsight.com/search?q={}",
};

export const UNVERIFIED_DISCLAIMER = (
    "Course verification is unavailable in this session. " +
    "The following are unverified suggestions and may not be fully accurate."
);

let _network_enabled = true;

export function set_network_enabled(enabled) {
    _network_enabled = enabled;
}

export async function is_network_available() {
    if (!_network_enabled) return false;
    try {
        await axios.head("https://www.google.com", { timeout: 5000, headers: REQUEST_HEADERS });
        return true;
    } catch (e) {
        return false;
    }
}

async function verify_url(url) {
    if (!_network_enabled) {
        return { url, verified: false, error: "Network disabled", network_unavailable: true };
    }
    if (!url || !url.startsWith("http")) {
        return { url, verified: false, error: "Invalid URL format" };
    }

    try {
        const resp = await axios.head(url, { headers: REQUEST_HEADERS, timeout: VERIFY_TIMEOUT, maxRedirects: 5 });
        return {
            url,
            verified: resp.status < 400,
            final_url: resp.request?.res?.responseUrl || url,
            status_code: resp.status,
            error: null
        };
    } catch (e) {
        if (e.response && e.response.status < 400) {
            return {
                url,
                verified: true,
                final_url: e.request?.res?.responseUrl || url,
                status_code: e.response.status,
                error: null
            };
        }
        // Fallback to GET
        try {
            const resp = await axios.get(url, { headers: REQUEST_HEADERS, timeout: VERIFY_TIMEOUT, maxRedirects: 5, responseType: 'stream' });
            resp.data.destroy(); // stop downloading
            return {
                url,
                verified: resp.status < 400,
                final_url: resp.request?.res?.responseUrl || url,
                status_code: resp.status,
                error: null
            };
        } catch (e2) {
            return {
                url,
                verified: false,
                final_url: null,
                status_code: null,
                error: e2.message.substring(0, 100)
            };
        }
    }
}

export async function verify_courses_parallel(courses) {
    if (!courses || courses.length === 0) return [];

    const network_ok = await is_network_available();

    if (!network_ok) {
        return courses.map(course => {
            course.verified = false;
            course.network_unavailable = true;
            course.verification_note = UNVERIFIED_DISCLAIMER;
            course.search_url = _build_search_url(course.platform || "", course.skill || course.course_name || "");
            return course;
        });
    }

    // Process in batches of MAX_WORKERS
    const verified_courses = [];
    
    for (let i = 0; i < courses.length; i += MAX_WORKERS) {
        const batch = courses.slice(i, i + MAX_WORKERS);
        
        const batchPromises = batch.map(async (course) => {
            course.network_unavailable = false;
            const url = course.url || "";
            const platform = (course.platform || "").toLowerCase();
            const skill = course.skill || course.course_name || "";
            
            if (url) {
                const vr = await verify_url(url);
                if (vr.verified) {
                    course.verified = true;
                    course.verification_note = "✅ URL verified — live course page confirmed";
                    if (vr.final_url && vr.final_url !== url) {
                        course.url = vr.final_url;
                    }
                } else {
                    course.verified = false;
                    course.search_url = _build_search_url(platform, skill);
                    course.verification_note = `⚠️ Direct URL could not be verified (${vr.error || 'unknown'}). Search link provided instead.`;
                }
            } else {
                course.verified = false;
                course.search_url = _build_search_url(platform, skill);
                course.url = course.search_url;
                course.verification_note = "ℹ️ No direct URL — search link provided";
            }
            return course;
        });

        const batchResults = await Promise.all(batchPromises);
        verified_courses.push(...batchResults);
    }

    return verified_courses;
}

function _build_search_url(platform, query) {
    const platform_lower = platform.toLowerCase().trim();
    const query_encoded = encodeURIComponent(query);

    for (const [name, url_template] of Object.entries(PLATFORM_SEARCH_URLS)) {
        if (platform_lower.includes(name)) {
            return url_template.replace('{}', query_encoded);
        }
    }
    return `https://www.google.com/search?q=${query_encoded}+${encodeURIComponent(platform)}+course`;
}

export class CourseRecommender {
    constructor(llm_client) {
        this.llm = llm_client;
    }

    async get_verified_recommendations(match_result) {
        if (match_result.is_domain_mismatch) return [];

        let candidates = match_result.course_recommendations;
        if (!candidates || candidates.length === 0) {
            const all_missing = [
                ...(match_result.missing_critical || []),
                ...(match_result.missing_important || [])
            ];
            if (all_missing.length === 0) return [];
            candidates = await this.llm.suggest_courses(all_missing, match_result.domain_compatibility);
        }

        if (!candidates || candidates.length === 0) return [];

        return await verify_courses_parallel(candidates);
    }
}
