# ElevenLabs Integration Analysis

Date: 2026-03-31

## Purpose

Capture the current debugging findings, compare the current Lazy Reader implementation against the official ElevenLabs API docs, and document the recommended next implementation stages before more code changes.

Official references reviewed:

- https://elevenlabs.io/docs/api-reference/authentication
- https://elevenlabs.io/docs/api-reference/introduction
- https://elevenlabs.io/docs/api-reference/streaming
- https://elevenlabs.io/docs/api-reference/streaming-with-timestamps

## Current State

The extension currently:

- stores the ElevenLabs API key in browser extension storage
- loads voices directly from the options page
- calls ElevenLabs text-to-speech directly from the extension
- uses the `/with-timestamps` flow and waits for full audio plus alignment before playback
- plays returned audio in an offscreen document and drives word highlighting from mapped timestamps

Relevant files:

- `options.js`
- `content/cloud-tts.js`
- `background.js`
- `offscreen.js`

## What We Found

### 1. The 413 issue is almost certainly malformed user input, not a broken voices endpoint

The extension sends the API key exactly as typed in the options page via the `xi-api-key` header.

That means:

- a valid raw `sk_...` key should work
- a pasted JSON blob, extra text, whitespace, or an oversized string will be sent as-is
- a `413` on `GET /v1/voices` strongly suggests the header value was too large, not a normal auth failure

The debug evidence supports that:

- the user-provided `voices` response proves the endpoint can return valid data
- the options page was masking the field, so it was easy to paste the wrong content without noticing
- the request path is simple enough that a `413` is much more consistent with an oversized header than with normal permission failure

### 2. The current architecture conflicts with ElevenLabs' client-side key guidance

The official authentication docs recommend keeping API keys on the backend and not exposing them in frontend/client code.

Our current implementation does the opposite:

- `options.js` fetches `GET /v1/voices` directly from the extension
- `content/cloud-tts.js` calls `POST /v1/text-to-speech/{voice_id}/with-timestamps` directly from the extension
- the raw key is persisted in `chrome.storage.local`

This is workable for an internal/personal prototype, but it is the wrong architecture if this extension will be shared, published, or used across machines/accounts.

### 3. The current `/with-timestamps` design is valid, but it trades simplicity for startup latency

The official streaming docs describe lower-latency streaming options, including timestamp-aware streaming variants.

Current behavior:

- fetch full audio response
- fetch full character timing data
- decode the complete audio blob
- start playback only after the full request completes

Strengths:

- simpler synchronization between audio and highlighting
- simpler fallback behavior
- deterministic word timing for the current highlighter
- easier to test than incremental streaming

Weaknesses:

- slower time-to-first-audio
- higher memory overhead due to full base64 response
- no progressive playback while audio is still arriving

### 4. Streaming is promising, but it is not the highest-priority next change

Streaming could improve:

- startup latency
- perceived responsiveness
- long-segment playback behavior

But it also introduces non-trivial complexity:

- incremental audio buffering in the offscreen document
- synchronization between streamed audio chunks and timestamp events
- recovery logic for interrupted streams
- more difficult pause/resume/seek behavior
- more difficult mid-stream speed coordination

Given the current state, the security model is the bigger problem than the transport model.

## Changes Already Made During Debugging

The options page has already been hardened to reduce repeated malformed requests:

- added explicit `Load Voices`
- added client-side API key validation
- reject obviously malformed or oversized values before sending
- added a specific `413` error message
- fixed a stale options-page load path bug introduced during the earlier refactor

These changes reduce confusion, but they do not solve the underlying client-side secret exposure problem.

## Recommended Next Steps

### Stage 1: Stabilize the current prototype

Goal: keep the current direct-to-ElevenLabs prototype usable while reducing user error.

Recommended work:

- add a `Clear Cloud Settings` action to wipe `apiKey` and `cloudVoiceId`
- add a small debug panel in options showing:
  - selected provider
  - selected voice ID
  - whether the current key passes local validation
- stop auto-loading voices on page open unless the user explicitly clicks `Load Voices`
- add tests for persisted invalid values and reset flows

### Stage 2: Remove the raw ElevenLabs key from the browser

Goal: align with the official auth guidance.

Recommended architecture:

- create a small backend or edge function that stores the ElevenLabs API key server-side
- proxy these operations through the backend:
  - list voices
  - create speech with timestamps
- have the extension authenticate only to our backend, not directly to ElevenLabs

Questions to answer during implementation:

- can the relevant client-side use cases rely on ElevenLabs single-use tokens, or do we still need a proxy for `voices` and `/with-timestamps`
- what auth model should the extension use to talk to our backend
- do we need per-user quotas or usage tracking

### Stage 3: Decide whether streaming is worth the complexity

Do this only after Stage 2.

Recommended evaluation:

- measure time-to-first-audio with current `/with-timestamps`
- compare it to a streaming proof of concept
- determine whether highlighting quality remains acceptable with streamed timestamps

Only move forward if the measured latency improvement is meaningful enough to justify:

- more complex buffering
- more complex playback control
- more complicated tests

### Stage 4: If streaming is adopted, keep word highlighting as the primary constraint

Any streaming redesign should preserve these requirements:

- accurate per-word highlight advancement
- graceful fallback to local voices
- mid-playback speed changes
- predictable pause/resume behavior

If streaming cannot preserve word highlighting cleanly, keep `/with-timestamps` and optimize around it instead.

## Proposed Implementation Order

1. Finish prototype hardening in the options/settings flow
2. Introduce a backend proxy and remove raw ElevenLabs keys from the extension
3. Add integration tests around backend-mediated voice listing and synthesis
4. Benchmark current `/with-timestamps` startup latency
5. Prototype streaming only if the latency gap is material

## Bottom Line

The immediate production-risk issue is not streaming. It is that the extension stores and sends a privileged ElevenLabs API key directly from browser code, which conflicts with the official authentication guidance.

The right next implementation step is to move ElevenLabs access behind a backend or tokenized server-controlled layer. Streaming should be evaluated after that, not before.
