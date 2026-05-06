# RSS Ingestion Notes

updated_at: 2026-05-06

## Linked article fetching

`collect-rss` fetches linked article pages with Node `fetch`, not with a full
browser session. Some sites return bot-protection or verification HTML even
when the HTTP response is `200 text/html`.

Known example:
- Micron investor relations article pages can return an Akamai page containing
  "Powered and protected by" and `/_sec/akamai-logo.svg` instead of the press
  release body.

Do not treat those pages as successful article extraction. If linked article
content looks like Akamai, Cloudflare, access-denied, browser verification, or
other interstitial content, keep the RSS feed summary instead of replacing it.

Browser-based tools such as Obsidian Web Clipper may still succeed because they
run with browser cookies and JavaScript challenge handling. That does not imply
that `collect-rss` can retrieve the same body through plain server-side fetch.

## Regression coverage

Behavior changes in RSS linked-content extraction should include:
- Unit coverage for deterministic HTML/interstitial detection.
- E2E coverage for `run --targets collect-rss` or equivalent orchestration when
  the final vault `Raw Content` is affected.

The important invariant is that protection-page chrome must not be persisted as
article body content.
