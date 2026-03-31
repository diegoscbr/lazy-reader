# ElevenLabs Auth And Streaming Analysis

Date: 2026-03-31

## Scope

This note compares the current Lazy Reader ElevenLabs integration against the official ElevenLabs docs the user linked:

- Authentication: https://elevenlabs.io/docs/api-reference/authentication
- API introduction: https://elevenlabs.io/docs/api-reference/introduction
- Streaming: https://elevenlabs.io/docs/api-reference/streaming

It also considers closely related official docs surfaced during review:

- Single-use tokens: https://elevenlabs.io/docs/api-reference/tokens/create
- TTS streaming with timestamps: https://elevenlabs.io/docs/api-reference/streaming-with-timestamps
- TTS websocket input: https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input
- TTS capability overview: https://elevenlabs.io/docs/overview/capabilities/text-to-speech

## Current Implementation

The current extension uses direct client-side ElevenLabs calls:

- The options page loads voices by sending `xi-api-key` from the extension page in [options.js](/Users/diegoescobar/Workshop/lazy-reader/options.js).
- Cloud TTS generation happens client-side in [cloud-tts.js](/Users/diegoescobar/Workshop/lazy-reader/content/cloud-tts.js), calling `POST /v1/text-to-speech/:voice_id/with-timestamps`.
- The background worker forwards returned base64 audio plus alignment to the offscreen document in [background.js](/Users/diegoescobar/Workshop/lazy-reader/background.js).
- The offscreen document plays the audio and emits per-word timing events in [offscreen.js](/Users/diegoescobar/Workshop/lazy-reader/offscreen.js).

This is a practical architecture for V2 because it gives us complete segment audio plus timing in one request and keeps playback logic inside the extension.

## What The Docs Say

### Authentication

The authentication docs say the ElevenLabs API key is a secret and should not be exposed in client-side code such as browsers or apps. They also document single-use tokens for some frontend-facing flows.

Implication for Lazy Reader:

- Our current extension architecture conflicts with the official guidance because the raw API key is entered, stored, and sent from a browser extension page.
- The current model is acceptable only as a temporary personal-tool shortcut, not as a production-safe architecture.

### API Introduction

The introduction docs confirm that ElevenLabs supports both HTTP and WebSocket usage, and that the official SDKs can expose raw response headers such as character-count and request IDs.

Implication for Lazy Reader:

- We have room to add cost/request observability later.
- We do not need the official SDK inside the extension to ship the current feature set, but a server-side proxy could benefit from it.

### Streaming

The streaming docs split into three relevant modes:

1. `POST /v1/text-to-speech/:voice_id/stream`
Returns streamed audio bytes over HTTP chunked transfer encoding.

2. `POST /v1/text-to-speech/:voice_id/stream/with-timestamps`
Returns streamed JSON chunks containing base64 audio plus timing data.

3. `wss://api.elevenlabs.io/v1/text-to-speech/:voice_id/stream-input`
WebSocket flow designed for partial text input and low-latency generation, with alignment data in responses.

The TTS overview also highlights that Flash v2.5 is the low-latency model, while higher-quality models trade speed for richer output.

## Main Findings

### 1. The biggest current gap is authentication, not playback

The docs are clear that raw API keys should not live in client-side code. Our extension currently does exactly that.

This is the primary architectural issue to fix next.

### 2. The current `/with-timestamps` flow is still the simplest fit for V2

For Lazy Reader today, the current model has real advantages:

- Single request per segment returns both audio and alignment.
- Offscreen playback is already built around one decoded buffer at a time.
- Word highlighting uses complete alignment data without incremental buffering complexity.
- Mid-segment speed changes already work in the offscreen player.

This means the current non-streaming V2 approach is coherent and defensible for a first cloud release.

### 3. Streaming is not an automatic upgrade for this extension

Streaming would improve first-audio latency, but it also increases implementation complexity:

- We would need incremental audio buffering and playback instead of one decoded buffer.
- We would need chunk-level timing reconciliation instead of one finalized alignment object.
- We would need queue management for partial audio, partial timestamps, pause/resume state, and segment transitions.
- Error recovery becomes harder because failures can occur mid-stream rather than before playback starts.

For long-form page reading where we already segment content, lower startup latency is useful but not yet worth the architectural jump unless it becomes a product priority.

### 4. If we do adopt streaming later, websocket plus server-issued token is the right direction

If the goal becomes lower latency or live incremental reading, the most coherent future design is:

- server-side ElevenLabs credential handling
- short-lived frontend auth via single-use token
- websocket TTS streaming to the extension offscreen document

That direction aligns with the auth docs much better than sending a raw API key from the extension.

## Recommended Next Steps

### Stage 1: Fix the auth model

Recommended change:

- Move ElevenLabs requests behind a minimal backend or proxy.
- Keep the raw ElevenLabs API key only on the server.
- Remove long-term raw key storage from the extension.

Target result:

- The extension never sends `xi-api-key` directly from a browser page.
- Voice listing and TTS generation happen via a trusted server boundary.

### Stage 2: Keep the current generation mode, but proxy it

Recommended change:

- Preserve the existing `/with-timestamps` segment-generation architecture first.
- Proxy `GET /voices` and `POST /text-to-speech/:voice_id/with-timestamps` through the backend.

Why this should come before streaming:

- Lowest migration risk.
- Reuses almost all current extension playback and highlighting logic.
- Solves the biggest docs mismatch immediately.

### Stage 3: Add observability

Recommended change:

- Capture response metadata such as request IDs and character usage on the server side.
- Log failures with endpoint, status, and request ID.

Why:

- Easier debugging for cases like the recent `401` and `413`.
- Better visibility into usage and cost.

### Stage 4: Evaluate streaming only after auth is fixed

Streaming becomes worth doing if one of these becomes true:

- startup latency is a meaningful UX problem
- we want live or partial-text generation
- we want more conversational or interactive reading behavior

If we reach that point, prefer this order:

1. Prototype `stream/with-timestamps` on the server side.
2. Validate chunk timing stability and browser playback behavior in the offscreen document.
3. Only then consider websocket `stream-input` plus single-use token for a lower-latency production path.

## Specific Repo Follow-Ups

### High priority

- Replace client-side raw key use in [options.js](/Users/diegoescobar/Workshop/lazy-reader/options.js) and [content/cloud-tts.js](/Users/diegoescobar/Workshop/lazy-reader/content/cloud-tts.js).
- Update [background.js](/Users/diegoescobar/Workshop/lazy-reader/background.js) so it talks to a trusted service instead of directly to ElevenLabs.

### Medium priority

- Decide whether the extension should store only a backend-issued session token instead of any ElevenLabs credential.
- Define a server contract for:
  - list voices
  - synthesize segment with timestamps
  - optional request metadata for debugging/cost tracking

### Low priority

- Investigate streaming once auth is serverized and V2 is stable.
- Test whether `stream/with-timestamps` meaningfully improves perceived latency for page reading.

## Bottom Line

The official docs do not suggest that our next step should be “switch to streaming immediately.”

They do strongly suggest that our next step should be “stop exposing the raw API key client-side.”

So the recommended sequence is:

1. Serverize ElevenLabs authentication and requests.
2. Keep the current `/with-timestamps` playback pipeline during that migration.
3. Revisit streaming only after the auth model is fixed and we can justify the extra complexity.
