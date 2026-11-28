---
name: cartoon-story-remotion
description: Make a short narrated cartoon episode (about 30-90 s) as an MP4 with Remotion. Covers the story, a character sheet with the OpenAI image API, every scene drawn from that sheet so characters stay consistent, the user's own recorded narration with word timestamps from local Whisper, slow camera moves, cuts on the words, big word-by-word captions, and a contact-sheet check that finds and fixes broken frames. Use when the user asks for a cartoon, animated story, story episode or "kartun" made with Remotion, or invokes /cartoon-story-remotion.
argument-hint: "<story idea, length, style>"
---

# Cartoon story with Remotion

Adapted from a public step-by-step post by Mihail (AI developer). Six steps, each one checked before the next.
Talk to the user in Indonesian ("saya"/"kamu"). Keep code, comments and image prompts in English.

What each service is for: the OpenAI image API draws the pictures (the character sheet and every scene) and
nothing else. The voice is **never** synthesized: the user records the narration themselves. Do not use
ElevenLabs, OpenAI TTS or any other text-to-speech unless the user asks for it.

Load `remotion-best-practices` (and `remotion-markup`, `remotion-render` when you reach those steps) before writing
Remotion code.

## 0. Ask only what is missing

From the user's request, settle: story idea, length (default 50 s), aspect (default 16:9, 1920x1080; 9:16 for
Shorts), art style, narration language. Do not ask for anything you can sensibly default.

## 1. Set up

Make the project **outside** the EverTwo Story repo (scratchpad or a folder the user names), never inside `src/`:

```bash
npx create-video@latest --yes --blank my-video
cd my-video
npx remotion skills add   # skip if the remotion-* skills are already loaded
```

API key (the user's own, see AGENTS.md rule 2): only `OPENAI_API_KEY`, for pictures.

- In a Claude Code cloud session, do not ask for the key in chat or write it to `.env`: call `request_credential`
  for `api.openai.com` and send a dummy value in the code; the proxy injects the real key.
- Locally, read them from `.env` (add `.env` to `.gitignore`). Never print a key, log it, or put it in a file
  you commit.
- Before spending credits, tell the user how many image calls the episode will make (1 sheet + 1 per scene,
  plus any redos).

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

## 4. The voice: the user's own recording, with word timestamps

1. Once the story is approved, give the user a recording script: every narration line in order, numbered, in a
   code block. Ask them to record it **as one take** (one file, all lines in order, a short natural pause between
   lines) and upload it (mp3, wav or m4a). One take keeps the delivery even and leaves no gaps between scenes.
   Tips to pass on: quiet room, phone close to the mouth, read at a calm pace, a retake of a line is fine as long
   as the final file has each line once.
2. Wait for the file. Do not generate a placeholder voice in the meantime.
3. Convert it to `public/voice.wav` (`ffmpeg -i <upload> -ac 1 -ar 48000 public/voice.wav`). Trim long silence
   at the start and end only; never cut inside the narration.
4. Get word timings with local Whisper as the `remotion-captions` skill describes (`transcribe-captions.md`,
   `@remotion/whisper-webgpu`); no API key is needed. If WebGPU is not available on the machine, use whisper.cpp
   (`@remotion/install-whisper-cpp`) with token-level timestamps instead. Set the language to the narration
   language. Save `public/words.json`: `[{ "text": "word", "start": 0.12, "end": 0.48 }]`.
5. Whisper hears words; the script has the right spelling. Align the script's words to Whisper's words in order
   (match on normalized text, tolerate small mishearings, skip extra words such as a repeated retake) and keep
   the **script** text with Whisper's times. If a whole line is missing or read in the wrong order, tell the user
   which line and ask for a new take rather than guessing.
6. Map each scene to its words by counting words through the narration lines in order. A scene starts at its
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
- Narration via `<Audio src={staticFile("voice.wav")} />`. Optional music under it at low volume.

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
