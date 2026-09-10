# CareerLens AI — Test Log

**Date:** 2026-09-10 12:23:27
**Result:** 11/16 passed

| # | Test | Status | Duration | Details |
|:--|:-----|:------:|:--------:|:--------|
| 1 | Perfect same-domain match → high score | ✅ | 49.3s | Score: 96/100 (≥70 required). Domain: match |
| 2 | Partial match → medium score with meaningful gaps | ✅ | 146.6s | Score: 48/100 (25-75 range). Gaps: 3 critical, 2 important. |
| 3 | Domain mismatch (Mechanical JD + Software resume) → very low score | ✅ | 49.4s | Score: 5/100 (≤20 required). Domain mismatch: True. JD domain: Mechanical Engineering. Resume domain: Software Engineering. |
| 4 | 1 JD + 3 resumes → correct ranking | ✅ | 229.8s | Ranking: [('resume_software_strong.txt', 96), ('resume_software_junior.txt', 32), ('resume_mechanical.txt', 12)] |
| 5 | 1 resume + 3 JDs → correct ranking | ✅ | 189.2s | Ranking: [('jd_software_engineer.txt', 96), ('jd_data_scientist.txt', 40), ('jd_mechanical_engineer.txt', 5)] |
| 6 | 3 JDs + 3 resumes → correct cross-matching | ✅ | 695.1s | 9 pairs computed. Top matches: [('jd_software_engineer', 'resume_software_strong', 96), ('jd_mechanical_engineer', 'resume_mechanical', 94), ('jd_data |
| 7 | Only JD uploaded → bot asks for resume | ✅ | 0.0s | Correctly identified: has JD(s) but no resumes. Summary includes prompt. |
| 8 | Only resume uploaded → bot asks for JD | ✅ | 0.0s | Correctly identified: has resume(s) but no JDs. |
| 9 | Corrupt/unsupported file → clear error, no crash | ✅ | 0.3s | Correctly caught error: 'Error reading 'corrupt_file.pdf': Cannot open PDF file — it may be corrupted or ...' |
| 10 | Very short/minimal resume → low confidence, no hallucinated skills | ✅ | 53.7s | Score: 5/100 (≤25). Matched skills: [] (no technical hallucination). |
| 11 | Keyword trap → low score despite generic word overlap | ✅ | 81.2s | Score: 5/100 (≤20). Domain: mismatch. Correctly not inflated by generic keywords. |
| 12 | Synonym/semantic matching → correctly matched | ❌ | 15.5s | Exception: Error code: 429 - {'error': {'message': 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01kwcj8b75exb9wpcdp26vsrht |
| 13 | Required skills weighted more heavily than preferred | ❌ | 0.1s | Exception: Error code: 429 - {'error': {'message': 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01kwcj8b75exb9wpcdp26vsrht |
| 14 | Seniority mismatch (senior JD + junior resume) → visible penalty | ❌ | 0.1s | Exception: Error code: 429 - {'error': {'message': 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01kwcj8b75exb9wpcdp26vsrht |
| 15 | Course recommendations → verified + unverified fallback paths | ❌ | 0.2s | Exception: Error code: 429 - {'error': {'message': 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01kwcj8b75exb9wpcdp26vsrht |
| 21 | Determinism — same inputs produce identical scores across runs | ❌ | 0.1s | Exception: Error code: 429 - {'error': {'message': 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01kwcj8b75exb9wpcdp26vsrht |

## Failed Tests — Details

### Test 12: Synonym/semantic matching → correctly matched

```
Exception: Error code: 429 - {'error': {'message': 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01kwcj8b75exb9wpcdp26vsrht` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 197467, Requested 4084. Please try again in 11m10.031999999s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing', 'type': 'tokens', 'code': 'rate_limit_exceeded'}}
Traceback (most recent call last):
  File "/Users/tejash/Downloads/Chatbot/tests/test_runner.py", line 112, in _run_single
    passed, details = test_fn()
                      ^^^^^^^^^
  File "/Users/tejash/Downloads/Chatbot/tests/test_runner.py", line 404, in test_12_synonym_match
    result = self.engine.analyze_pair(jd_doc, resume_doc)
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/tejash/Downloads/Chatbot/src/matcher.py", line 74, in analyze_pair
    score_result = self.llm.compute_match_score(
                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/tejash/Downloads/Chatbot/src/llm.py", line 374, in compute_match_score
    result = self._call_cached(cid, prompt, system_instruction=system)
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/tejash/Downloads/Chatbot/src/llm.py", line 102, in _call_cached
    response_text = self._call(prompt, system_instruction=system_instruction, deterministic=True)
                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/tejash/Downloads/Chatbot/src/llm.py", line 88, in _call
    response = self.client.chat.completions.create(**kwargs)
               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Library/Frameworks/Python.framework/Versions/3.12/lib/python3.12/site-packages/groq/resources/chat/completions.py", line 466, in create
    return self._post(
           ^^^^^^^^^^^
  File "/Library/Frameworks/Python.framework/Versions/3.12/lib/python3.12/site-packages/groq/_base_client.py", line 1284, in post
    return cast(ResponseT, self.request(cast_to, opts, stream=stream, stream_cls=stream_cls))
                           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Library/Frameworks/Python.framework/Versions/3.12/lib/python3.12/site-packages/groq/_base_client.py", line 1071, in request
    raise self._make_status_error_from_response(err.response) from None
groq.RateLimitError: Error code: 429 - {'error': {'message': 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01kwcj8b75exb9wpcdp26vsrht` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 197467, Requested 4084. Please try again in 11m10.031999999s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing', 'type': 'tokens', 'code': 'rate_limit_exceeded'}}

```

**Error:** Error code: 429 - {'error': {'message': 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01kwcj8b75exb9wpcdp26vsrht` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 197467, Requested 4084. Please try again in 11m10.031999999s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing', 'type': 'tokens', 'code': 'rate_limit_exceeded'}}

### Test 13: Required skills weighted more heavily than preferred

```
Exception: Error code: 429 - {'error': {'message': 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01kwcj8b75exb9wpcdp26vsrht` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 197467, Requested 4237. Please try again in 12m16.127999999s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing', 'type': 'tokens', 'code': 'rate_limit_exceeded'}}
Traceback (most recent call last):
  File "/Users/tejash/Downloads/Chatbot/tests/test_runner.py", line 112, in _run_single
    passed, details = test_fn()
                      ^^^^^^^^^
  File "/Users/tejash/Downloads/Chatbot/tests/test_runner.py", line 439, in test_13_required_vs_preferred
    result = self.engine.analyze_pair(jd_doc, resume_doc)
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/tejash/Downloads/Chatbot/src/matcher.py", line 79, in analyze_pair
    return_path = self.llm.generate_return_path(
                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/tejash/Downloads/Chatbot/src/llm.py", line 433, in generate_return_path
    return self._call(prompt, system_instruction=system, temperature=0.3).strip()
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/tejash/Downloads/Chatbot/src/llm.py", line 88, in _call
    response = self.client.chat.completions.create(**kwargs)
               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Library/Frameworks/Python.framework/Versions/3.12/lib/python3.12/site-packages/groq/resources/chat/completions.py", line 466, in create
    return self._post(
           ^^^^^^^^^^^
  File "/Library/Frameworks/Python.framework/Versions/3.12/lib/python3.12/site-packages/groq/_base_client.py", line 1284, in post
    return cast(ResponseT, self.request(cast_to, opts, stream=stream, stream_cls=stream_cls))
                           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Library/Frameworks/Python.framework/Versions/3.12/lib/python3.12/site-packages/groq/_base_client.py", line 1071, in request
    raise self._make_status_error_from_response(err.response) from None
groq.RateLimitError: Error code: 429 - {'error': {'message': 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01kwcj8b75exb9wpcdp26vsrht` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 197467, Requested 4237. Please try again in 12m16.127999999s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing', 'type': 'tokens', 'code': 'rate_limit_exceeded'}}

```

**Error:** Error code: 429 - {'error': {'message': 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01kwcj8b75exb9wpcdp26vsrht` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 197467, Requested 4237. Please try again in 12m16.127999999s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing', 'type': 'tokens', 'code': 'rate_limit_exceeded'}}

### Test 14: Seniority mismatch (senior JD + junior resume) → visible penalty

```
Exception: Error code: 429 - {'error': {'message': 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01kwcj8b75exb9wpcdp26vsrht` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 197467, Requested 4274. Please try again in 12m32.112s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing', 'type': 'tokens', 'code': 'rate_limit_exceeded'}}
Traceback (most recent call last):
  File "/Users/tejash/Downloads/Chatbot/tests/test_runner.py", line 112, in _run_single
    passed, details = test_fn()
                      ^^^^^^^^^
  File "/Users/tejash/Downloads/Chatbot/tests/test_runner.py", line 468, in test_14_seniority_mismatch
    result = self.engine.analyze_pair(jd_doc, resume_doc)
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/tejash/Downloads/Chatbot/src/matcher.py", line 79, in analyze_pair
    return_path = self.llm.generate_return_path(
                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/tejash/Downloads/Chatbot/src/llm.py", line 433, in generate_return_path
    return self._call(prompt, system_instruction=system, temperature=0.3).strip()
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/tejash/Downloads/Chatbot/src/llm.py", line 88, in _call
    response = self.client.chat.completions.create(**kwargs)
               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Library/Frameworks/Python.framework/Versions/3.12/lib/python3.12/site-packages/groq/resources/chat/completions.py", line 466, in create
    return self._post(
           ^^^^^^^^^^^
  File "/Library/Frameworks/Python.framework/Versions/3.12/lib/python3.12/site-packages/groq/_base_client.py", line 1284, in post
    return cast(ResponseT, self.request(cast_to, opts, stream=stream, stream_cls=stream_cls))
                           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Library/Frameworks/Python.framework/Versions/3.12/lib/python3.12/site-packages/groq/_base_client.py", line 1071, in request
    raise self._make_status_error_from_response(err.response) from None
groq.RateLimitError: Error code: 429 - {'error': {'message': 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01kwcj8b75exb9wpcdp26vsrht` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 197467, Requested 4274. Please try again in 12m32.112s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing', 'type': 'tokens', 'code': 'rate_limit_exceeded'}}

```

**Error:** Error code: 429 - {'error': {'message': 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01kwcj8b75exb9wpcdp26vsrht` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 197467, Requested 4274. Please try again in 12m32.112s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing', 'type': 'tokens', 'code': 'rate_limit_exceeded'}}

### Test 15: Course recommendations → verified + unverified fallback paths

```
Exception: Error code: 429 - {'error': {'message': 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01kwcj8b75exb9wpcdp26vsrht` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 197466, Requested 4424. Please try again in 13m36.48s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing', 'type': 'tokens', 'code': 'rate_limit_exceeded'}}
Traceback (most recent call last):
  File "/Users/tejash/Downloads/Chatbot/tests/test_runner.py", line 112, in _run_single
    passed, details = test_fn()
                      ^^^^^^^^^
  File "/Users/tejash/Downloads/Chatbot/tests/test_runner.py", line 501, in test_15_course_recommendations
    result = self.engine.analyze_pair(jd_doc, resume_doc)
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/tejash/Downloads/Chatbot/src/matcher.py", line 79, in analyze_pair
    return_path = self.llm.generate_return_path(
                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/tejash/Downloads/Chatbot/src/llm.py", line 433, in generate_return_path
    return self._call(prompt, system_instruction=system, temperature=0.3).strip()
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/tejash/Downloads/Chatbot/src/llm.py", line 88, in _call
    response = self.client.chat.completions.create(**kwargs)
               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Library/Frameworks/Python.framework/Versions/3.12/lib/python3.12/site-packages/groq/resources/chat/completions.py", line 466, in create
    return self._post(
           ^^^^^^^^^^^
  File "/Library/Frameworks/Python.framework/Versions/3.12/lib/python3.12/site-packages/groq/_base_client.py", line 1284, in post
    return cast(ResponseT, self.request(cast_to, opts, stream=stream, stream_cls=stream_cls))
                           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Library/Frameworks/Python.framework/Versions/3.12/lib/python3.12/site-packages/groq/_base_client.py", line 1071, in request
    raise self._make_status_error_from_response(err.response) from None
groq.RateLimitError: Error code: 429 - {'error': {'message': 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01kwcj8b75exb9wpcdp26vsrht` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 197466, Requested 4424. Please try again in 13m36.48s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing', 'type': 'tokens', 'code': 'rate_limit_exceeded'}}

```

**Error:** Error code: 429 - {'error': {'message': 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01kwcj8b75exb9wpcdp26vsrht` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 197466, Requested 4424. Please try again in 13m36.48s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing', 'type': 'tokens', 'code': 'rate_limit_exceeded'}}

### Test 21: Determinism — same inputs produce identical scores across runs

```
Exception: Error code: 429 - {'error': {'message': 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01kwcj8b75exb9wpcdp26vsrht` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 197466, Requested 3408. Please try again in 6m17.568s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing', 'type': 'tokens', 'code': 'rate_limit_exceeded'}}
Traceback (most recent call last):
  File "/Users/tejash/Downloads/Chatbot/tests/test_runner.py", line 112, in _run_single
    passed, details = test_fn()
                      ^^^^^^^^^
  File "/Users/tejash/Downloads/Chatbot/tests/test_runner.py", line 590, in test_21_determinism_check
    result_1 = self.engine.analyze_pair(jd_doc, resume_doc)
               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/tejash/Downloads/Chatbot/src/matcher.py", line 62, in analyze_pair
    jd_domain = self.llm.detect_domain(jd_doc.text, "job_description")
                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/tejash/Downloads/Chatbot/src/llm.py", line 238, in detect_domain
    result = self._call_cached(cid, prompt, system_instruction=system)
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/tejash/Downloads/Chatbot/src/llm.py", line 102, in _call_cached
    response_text = self._call(prompt, system_instruction=system_instruction, deterministic=True)
                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/tejash/Downloads/Chatbot/src/llm.py", line 88, in _call
    response = self.client.chat.completions.create(**kwargs)
               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Library/Frameworks/Python.framework/Versions/3.12/lib/python3.12/site-packages/groq/resources/chat/completions.py", line 466, in create
    return self._post(
           ^^^^^^^^^^^
  File "/Library/Frameworks/Python.framework/Versions/3.12/lib/python3.12/site-packages/groq/_base_client.py", line 1284, in post
    return cast(ResponseT, self.request(cast_to, opts, stream=stream, stream_cls=stream_cls))
                           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Library/Frameworks/Python.framework/Versions/3.12/lib/python3.12/site-packages/groq/_base_client.py", line 1071, in request
    raise self._make_status_error_from_response(err.response) from None
groq.RateLimitError: Error code: 429 - {'error': {'message': 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01kwcj8b75exb9wpcdp26vsrht` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 197466, Requested 3408. Please try again in 6m17.568s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing', 'type': 'tokens', 'code': 'rate_limit_exceeded'}}

```

**Error:** Error code: 429 - {'error': {'message': 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01kwcj8b75exb9wpcdp26vsrht` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 197466, Requested 3408. Please try again in 6m17.568s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing', 'type': 'tokens', 'code': 'rate_limit_exceeded'}}

