# IMP-1116 / IMP-710 — admitted HTML JSON parser budget

Status: local repair and controlled output qualification complete; exact incident replay and approved publication/DEV update pending.

## Diagnosis

Current DEV App Service `be-dev-html-pdf` in `be-dev-rosurce-group` uses immutable GHCR image digest768cba78477955782504f93493bdf39b130214caf929695ccdbeb2122cbb785c, registry tag `imp1116-b37acfd-local-20261002`. Exact image source has koa-body8.0.1 and no jsonLimit. An isolated loopback probe inside that exact image proves1048576bytes reaches validation400,1048577bytes returns413, and2834931bytes returns413 without launching Chromium. This identifies a parser rejection before conversion, not a capacity diagnosis for the separate historical300-photo workload.

## Repair

Set the internal JSON parser's finite budget to104857600bytes, matching the existing BusinessExplorer web.config request-filter ceiling. This does not alter the public BE ingress limit or certify maximum-size rendering. An optional smaller EXPORT_HTML_JSON_MAX_BYTES is a strict positive integer; malformed, disabled/unbounded and above-ceiling values fail startup. Protected resources report the effective budget. Authentication, concurrency/queue admission, rendering deadlines and browser/context cleanup remain intact. No increased plan/tier, converter timeout or new renderer.

## Controlled proof

27 converter tests PASS and lint PASS. Tests include exact-boundary acceptance, known-length and chunked overflow rejection before rendering, and authentication before parsing. A synthetic valid PNG1254x1254/1425162bytes,1900238-character data URI,891303bytes of CSS and2832781bytes of HTML make an exact2834931-byte size witness. It is a synthetic profile witness, not the sender's retained request.

The same body returns413 on the exact deployed image with no Chromium launch; candidate source mounted over the same immutable image returns200/application/pdf in3687ms. The two PDF pages independently retain searchable markers, Letter-landscape792x612pt, correct associated synthetic image and1/2,2/2 counters; both page renders were visually inspected. Browser pages return to the single initial page, active0/queued0, then the owned browser/container are closed. All failed/intermediate receipts are retained privately with the final proof.

## Closure gap

The source ticket references `airy-populated-actual-pdf-request.json` only through an unavailable sender-local path; its exact bytes were requested. Preserve the distinction between the synthetic unchanged-size RED/GREEN and the actual Memo replay. Container publication and exact DEV image replacement require applicable authority after a concrete candidate is reviewable. No container, environment configuration, capacity or Azure pipeline mutation has been performed. Existing paper-priority and300-photo acceptance boundaries remain separate.
