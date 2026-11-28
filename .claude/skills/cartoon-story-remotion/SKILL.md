---
name: cartoon-story-remotion
description: Make a short narrated cartoon episode (about 30-90 s) as an MP4 with Remotion. Covers the story, a character sheet with the OpenAI image API, every scene drawn from that sheet so characters stay consistent, ElevenLabs narration with word timestamps, slow camera moves, cuts on the words, big word-by-word captions, and a contact-sheet check that finds and fixes broken frames. Use when the user asks for a cartoon, animated story, story episode or "kartun" made with Remotion, or invokes /cartoon-story-remotion.
argument-hint: "<story idea, length, style>"
---

# Cartoon story with Remotion

Adapted from a public step-by-step post by Mihail (AI developer). Six steps, each one checked before the next.
Talk to the user in Indonesian ("saya"/"kamu"). Keep code, comments and prompts to the image/voice APIs in English.

Load `remotion-best-practices` (and `remotion-markup`, `remotion-render` when you reach those steps) before writing
Remotion code.

## 0. Ask only what is missing

From the user's request, settle: story idea, length (default 50 s), aspect (default 16:9, 1920x1080; 9:16 for
Shorts), art style, narrator language and voice. Do not ask for anything you can sensibly default.

## 1. Set up

Make the project **outside** the EverTwo Story repo (scratchpad or a folder the user names), never inside `src/`:

```bash
npx create-video@latest --yes --blank my-video
cd my-video
npx remotion skills add   # skip if the remotion-* skills are already loaded
```

API keys (the user's own, see AGENTS.md rule 2): `OPENAI_API_KEY` for pictures, `ELEVENLABS_API_KEY` for voice.

- In a Claude Code cloud session, do not ask for keys in chat or write them to `.env`: call `request_credential`
  for `api.openai.com` and `api.elevenlabs.io` (ElevenLabs reads header `xi-api-key`), and send a dummy value in
  the code; the proxy injects the real key.
- Locally, read them from `.env` (add `.env` to `.gitignore`). Never print a key, log it, or put it in a file
  you commit.
- Before spending credits, tell the user roughly how many image and TTS calls the episode will make.

## 2. The story

Write `story.json`: one line of narration per scene, plus what the picture shows. End on a cliffhanger when it
is an episode in a series.

```json
{
  "title": "...",
  "style": "one sentence art style, reused in every image prompt",
  "characters": [{ "id": "keeper", "look": "fixed visual description: age, build, hair, clothes, colours" }],
  "scenes": [
    { "id": "s01", "narration": "One spoken sentence.", "picture": "what the frame shows, who is in it, where, light" }
  ]
}
```

Rules: about 2.5 spoken words per second, so 50 s is about 120-130 words and 10-14 scenes. One idea per scene.
`picture` describes a still frame (no motion verbs, no text in the image). Show the user the story and wait for
"ok" before generating anything paid.

## 3. The trick: one character sheet, every scene drawn from it

1. Generate `public/sheet.png`: every character from `characters`, full body, front and side, on a plain
   background, in `style`. Use the current GPT image model via the image generations endpoint and save the
   base64 result. Look at the sheet yourself; regenerate if a character is wrong.
2. Generate each scene `public/scenes/<id>.png` with the **image edits endpoint, passing the sheet as the
   reference image** and a prompt of: `style` + the scene `picture` + "Keep every character exactly as on the
   reference sheet. No text, no captions, no borders." Size matches the aspect (landscape or portrait).
3. That reference image is what keeps characters the same from shot to shot. Never generate a scene from text
   only.

Write these as a small Node script (`scripts/images.mjs`) that skips images that already exist, so a rerun only
fills gaps and a single scene can be redone by deleting its file.

## 4. The voice, with word timestamps

Voice the **whole story as one recording** (all narration lines joined with a space), not one file per scene:
the delivery stays even and there are no gaps between scenes.

- `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps` with `text` and `model_id`
  (a multilingual model for Indonesian).
- Save `audio_base64` to `public/voice.mp3`.
- The response's `alignment` is per character (`characters`, `character_start_times_seconds`,
  `character_end_times_seconds`). Group characters into words on whitespace and save `public/words.json`:
  `[{ "text": "word", "start": 0.12, "end": 0.48 }]`.
- Map each scene to its words by counting words through the narration lines in order. A scene starts at its
  first word's `start`; the first scene starts at 0, the last scene ends at the audio's end plus about 0.6 s.

## 5. Animate in Remotion

One composition, `durationInFrames` derived from `words.json` (use `calculateMetadata`), 30 fps.

- **Cut on the words:** each scene is a `<Sequence>` from its first word's frame to the next scene's first word.
- **Slow camera move on every picture:** scale about 1.0 to 1.12 with a small pan over the scene, driven by
  `interpolate` on the frame with `extrapolateRight: "clamp"`. Vary direction from scene to scene (zoom in,
  zoom out, pan left, pan right) so it does not feel like a loop. No camera move should reveal the image edge.
- **Big captions word by word:** show the current word (or 1-3 word chunk) large, bold, centred in the lower
  third, with a dark outline or shadow so it reads on any picture; switch exactly at each word's `start`. Keep
  captions inside the safe area (about 10% margin, more on 9:16).
- Narration via `<Audio src={staticFile("voice.mp3")} />`. Optional music under it at low volume.

## 6. Check your own frames, fix, render again

1. Render the MP4: `npx remotion render <CompositionId> out/episode.mp4`.
2. Make a contact sheet: grab one frame from the middle of every scene, plus frames right after each cut, and
   tile them into one image, for example:
   `ffmpeg -i out/episode.mp4 -vf "fps=1,scale=480:-1,tile=6x4" -frames:v 1 out/contact.png`.
3. Look at the contact sheet and check for: a character who does not match the sheet; text or garbage letters
   inside a picture; a picture edge or black bar showing during a camera move; a caption that is cut off, overlaps
   a face, or is out of sync with the voice; a scene that does not match its narration; a wrong frame at a cut.
4. Also check with ffprobe that video and audio durations match within about 0.1 s.
5. Fix each problem at its source (regenerate one scene, change one timing, adjust caption layout), render again,
   and repeat until the contact sheet is clean. Tell the user what you found and fixed.

Deliver the MP4 (and the contact sheet) to the user with `SendUserFile`.

## Relation to EverTwo Story

The app in this repo already does this pipeline in production (character sheets and per-clip images in
`src/main/generation.ts`, one-take narration cut per scene in `src/main/narration.ts`, word timing with Whisper,
camera motion and captions in `src/shared/`). This skill is for standalone Remotion episodes; it does not change
the app. If the user wants a step from here added to the app, follow AGENTS.md instead.
