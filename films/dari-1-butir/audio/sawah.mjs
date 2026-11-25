// "Sawah Pagi": a 12-bar bed in D major pentatonic for harp, guitar and pad, written for Dari 1 butir.
// Original score for the take-one code music engine (engine adapted from anidoodle, Apache-2.0).
import { line } from "/home/user/evertwo-story/.claude/skills/take-one/scripts/music/plan.mjs";
const BPB = 4;
const L = (t, s, role, v = 0.7, extra = {}) => line(t, s, { role, v, bpb: BPB, ...extra });
const CH = ["D", "A", "Bm", "G", "D", "A", "Bm", "G", "G", "A", "D", "D"];
const MEL = [
  "r:2 F#4:.5 A4:.5 D5:1", "E5:1.5 D5:.5 B4:1 A4:1", "B4:1 D5:1 F#5:1.5 E5:.5", "D5:2 B4:1 A4:1",
  "A4:.5 D5:.5 F#5:1 A5:1.5 F#5:.5", "E5:1 C#5:1 E5:1 A5:1", "F#5:1.5 D5:.5 B4:1 D5:1", "E5:2 D5:1 B4:1",
  "B4:1 D5:1 G5:1.5 F#5:.5", "E5:1 F#5:1 A5:2", "F#5:1.5 E5:.5 D5:2", "D5:4",
];
const ARP = { D: "D3:.5 A3:.5 D4:.5 F#4:.5 A3:.5 D4:.5 F#4:.5 D4:.5", A: "A2:.5 E3:.5 A3:.5 C#4:.5 E3:.5 A3:.5 C#4:.5 A3:.5",
  Bm: "B2:.5 F#3:.5 B3:.5 D4:.5 F#3:.5 B3:.5 D4:.5 B3:.5", G: "G2:.5 D3:.5 G3:.5 B3:.5 D3:.5 G3:.5 B3:.5 G3:.5" };
const PAD = { D: "[D3 A3 F#4]", A: "[E3 A3 C#4]", Bm: "[F#3 B3 D4]", G: "[D3 G3 B3]" };
const ROOT = { D: "D2", A: "A1", Bm: "B1", G: "G1" };
export default () => {
  const mel = MEL.flatMap((s, b) => L(b * 4, s, "melody", b === 9 ? 0.85 : 0.68));
  const arp = CH.flatMap((c, b) => (b === 11 ? L(b * 4, "[D3 A3 D4 F#4]:4", "accomp", 0.5, { roll: 0.04 }) : L(b * 4, ARP[c], "accomp", 0.5)));
  const pad = CH.flatMap((c, b) => L(b * 4, `${PAD[c]}:4`, "inner", 0.5, { roll: 0.03 }));
  const bass = CH.flatMap((c, b) => L(b * 4, `${ROOT[c]}:4`, "bass", 0.62));
  const harmony = CH.map((name, b) => ({ t: b * 4, name }));
  return {
    title: "Sawah Pagi", seed: 5151, tail: 2.2, harmony,
    plan: { style: "folk", tempo: 100, meter: "4/4", phraseBars: 4,
      sections: [
        { id: "a", bars: 6, mood: "calm", key: "D", mode: "major", melody: ["hook"], dyn: [0.45, 0.6] },
        { id: "b", bars: 6, mood: "joy", key: "D", mode: "major", melody: ["hook"], dyn: [0.55, 0.85], ending: "tail" } ] },
    parts: [
      { id: "harp", inst: "harp", role: "melody", notes: mel, gainDb: 1, send: 0.35 },
      { id: "gtr", inst: "guitar", role: "accomp", notes: arp, gainDb: -3, send: 0.25 },
      { id: "pad", inst: "warmPad", role: "inner", notes: pad, gainDb: -9, opts: { cut: 1800, attack: 0.8, release: 1.5, spread: 0.6 }, send: 0.4 },
      { id: "sub", inst: "sub", role: "bass", notes: bass, gainDb: -8, opts: { cut: 150 } },
    ] };
};
