# ElevenLabs Auth + Streaming Review

Date: 2026-03-31

## Scope

Reviewed the current Lazy Reader V2 cloud TTS implementation against the official ElevenLabs docs the user linked:

- https://elevenlabs.io/docs/api-reference/authentication
- https://elevenlabs.io/docs/api-reference/introduction
- https://elevenlabs.io/docs/api-reference/streaming

Additional official docs used for follow-up comparison:

- https://elevenlabs.io/docs/api-reference/text-to-speech/stream-with-timestamps
- https://elevenlabs.io/docs/eleven-api/best-practices/latency-optimization
- https://elevenlabs.io/docs/eleven-api/best-practices/security
- https://elevenlabs.io/docs/api-reference/tokens/create

## Current implementation snapshot

The current extension:

- stores the ElevenLabs API key in extension local storage and reads it directly in the browser from [content/storage.js](/Users/diegoescobar/Workshop/lazy-reader/content/storage.js)
- sends the raw `xi-api-key` header directly from the extension in [options.js](/Users/diegoescobar/Workshop/lazy-reader/options.js)
- calls `POST /v1/text-to-speech/:voice_id/with-timestamps` from [content/cloud-tts.js](/Users/diegoescobar/Workshop/lazy-reader/content/cloud-tts.js)
- fetches the full response, decodes base64 audio in [offscreen.js](/Users/diegoescobar/Workshop/lazy-reader/offscreen.js), and polls word timing locally
- falls back to local `chrome.tts` in [background.js](/Users/diegoescobar/Workshop/lazy-reader/background.js)

## What the docs say

### Authentication

From the official authentication docs:

- ElevenLabs API keys are secrets and should not be exposed in client-side code.
- Requests authenticate with `xi-api-key`.
- Single-use tokens exist for certain endpoints and are specifically intended for client-side use without exposing the API key.

Implication for Lazy Reader:

- the current extension architecture conflicts with ElevenLabs guidance because it stores and uses the raw API key directly in browser-side code
- this is acceptable only as a personal prototype, not as a shippable design

### SDK / raw response guidance

From the introduction docs:

- the official SDKs expose raw responses and headers for metadata like character counts and request IDs

Implication for Lazy Reader:

- we currently ignore useful response metadata entirely
- adding request IDs and character counts to logs or debug UI would improve debugging and cost tracking

### Streaming

From the streaming docs and latency best-practices docs:

- there are three main TTS modes:
  - regular response
  - streaming response
  - websocket
- streaming is recommended when the input text is already available up front
- websockets are best when text arrives incrementally in real time
- Flash models are preferred for lower latency
- `stream/with-timestamps` exists and returns streamed JSON chunks containing base64 audio plus alignment/timing data

Implication for Lazy Reader:

- the current `with-timestamps` implementation is functionally aligned with word-highlighting needs
- but it is not latency-optimal because it waits for the full response before playback starts
- `stream/with-timestamps` is the closest official path to keeping timing data while improving time-to-first-audio
- websocket TTS is not the best immediate next step unless we truly need incremental text input

## Confirmed findings from the current debugging session

### 1. The `413` error is almost certainly malformed client input, not an ElevenLabs platform issue

What we observed:

- the extension showed `413` on `GET /v1/voices`
- a separate successful voice-list response dump proves the endpoint can work with a valid key

Why this matters:

- `GET /v1/voices` sends almost no request data besides the `xi-api-key` header
- a `413` here strongly suggests the API key field contained an oversized or malformed value
- likely examples:
  - pasted JSON
  - extra whitespace/newlines
  - non-key text wrapped around the key

Conclusion:

- this was not evidence that ElevenLabs voice listing is broken
- it was evidence that the client-side API key flow is fragile

### 2. Current auth handling conflicts with ElevenLabs’ own client-side guidance

Relevant local behavior:

- `apiKey` is saved to extension storage
- the options page reads it back and sends it directly to ElevenLabs
- the background worker also uses the raw key for synthesis

Conclusion:

- this is the largest architectural gap between the docs and the current implementation
- any future public or shared version should remove direct raw-key usage from the extension

### 3. Streaming is worth evaluating, but not before fixing auth architecture

Why:

- moving from `with-timestamps` to `stream/with-timestamps` could reduce startup latency
- but it does not solve the bigger issue of exposing a long-lived secret in the client
- if we switch transport before fixing auth, we improve latency but keep the biggest risk

## Alignment vs conflict summary

### Aligned

- using official REST endpoints rather than scraping or relying on undocumented behavior
- using timing/alignment data to drive highlighting
- using offscreen audio playback for cloud audio in an MV3 extension
- falling back to local TTS when cloud synthesis fails

### Conflicts / gaps

- raw ElevenLabs API key is exposed to client-side extension code
- no backend or token-minting layer exists
- no environment isolation or service-account strategy exists
- no use of response headers for tracing or spend observability
- current cloud path waits for full response completion before playback
- current model selection is fixed in code instead of being chosen based on latency/quality goals

## Recommended next steps

### Stage 1: Finish hardening the current prototype

Goal:

- make the current direct-key prototype less error-prone while we continue development

Actions:

- keep the input validation and 401/413 diagnostics already added to the options page
- add a visible note in the options UI that the field expects only the raw `sk_...` key
- add a one-click `Clear stored key` action in the options UI
- log or surface request IDs and character counts for synthesis requests when available

### Stage 2: Move auth out of the extension

Goal:

- align with ElevenLabs guidance not to expose raw API keys client-side

Recommended design:

- create a small backend service that owns the ElevenLabs secret
- use a service account dedicated to this environment if available
- keep endpoint restrictions and credit limits scoped as tightly as possible

Backend responsibilities:

- fetch voices on behalf of the client
- synthesize speech on behalf of the client
- rate limit usage
- monitor and log request IDs / spend

### Stage 3: Decide the transport strategy

Option A: keep up-front text, improve latency

- replace `/with-timestamps` with `/stream/with-timestamps`
- update offscreen playback to consume streamed JSON/audio chunks
- map timing incrementally instead of after the full body resolves

Why this is likely the best next transport step:

- Lazy Reader already has the full paragraph/segment text before requesting audio
- docs recommend streaming when input text is known up front
- we still retain alignment data for karaoke-style highlighting

Option B: websocket TTS

- use websocket TTS only if we need truly incremental text generation or lower-latency conversational generation
- if we go this route, investigate `tts_websocket` single-use tokens from the token docs

Why this is probably not the first change:

- more moving parts
- more session/state complexity
- less benefit for the current “full segment already parsed” workflow

### Stage 4: Reduce latency with model selection

Goal:

- make latency/quality a user-visible choice instead of a hard-coded implementation detail

Actions:

- stop hard-coding `eleven_v3` as the only model
- evaluate `eleven_flash_v2_5` as the default low-latency option
- preserve a higher-quality model option for users who prefer voice quality over responsiveness

### Stage 5: Add observability and debugging hooks

Actions:

- capture `request-id` for all synthesis requests where available
- capture `x-character-count` or equivalent usage headers when available
- optionally expose a lightweight debug panel or console toggle in the options page
- record response status and region headers when debugging latency

## Implementation recommendation

Recommended order:

1. Build a tiny backend/proxy and remove raw key usage from the extension.
2. Re-test current `with-timestamps` flow through that backend.
3. Upgrade to `stream/with-timestamps` if latency still feels too high.
4. Only consider websocket TTS after auth is fixed and streaming-with-timestamps is evaluated.

## Open questions

- Which exact ElevenLabs endpoints can be safely fronted by single-use tokens versus requiring a backend proxy?
- Whether `stream/with-timestamps` semantics are stable enough for the exact word-highlighting behavior we want in the extension.
- Whether we want voice/model selection to be per-user setting, per-session setting, or fully automatic based on latency mode.

## Bottom line

The current implementation is a workable prototype, but it conflicts with ElevenLabs’ explicit guidance because it exposes a long-lived API key in client-side extension code. The best next architectural move is not “switch to websocket first”; it is “move auth server-side first, then evaluate `stream/with-timestamps` as the likely latency improvement path.”
