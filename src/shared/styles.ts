export type StyleCategory = '2d' | '3d' | 'realistis'

export interface VisualStyle {
  id: string
  name: string
  category: StyleCategory
  niche: string
  /** Tile colors used for the picker until a real sample image exists. */
  swatch: string
  ink: string
  /** Appended to every image prompt in the project. */
  prompt: string
  /** How characters should look on the character sheet. */
  characterHint: string
  /** Extra rules for the scriptwriter when this style is chosen. */
  scriptHint?: string
  /** Video prompts for manual use are written in the Google Flow layout (one block per scene). */
  flowPrompt?: boolean
}

export const STYLE_CATEGORIES: { id: StyleCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'Semua' },
  { id: '2d', label: '2D' },
  { id: '3d', label: '3D' },
  { id: 'realistis', label: 'Realistis' }
]

const NO_TEXT = 'No text, no letters, no captions, no watermark, no logo.'

const STICKMAN_CINEMA =
  'Flat 2D hand-drawn line-art stick figures, never realistic, never 3D. The head is a slightly squashed hand-drawn oval, not a perfect circle, with a thick ink outline that is thinner on the side facing the light. Eyes, eyebrows and mouth are plain drawn lines or dots with a little asymmetry. BODY RULE: clothing covers the torso only; arms, hands and legs always stay thin black-outline stick lines, with no pants, sleeves over the hands or skirts, and coats or robes stop at the hips; identity comes from the torso outfit, headwear and props. FACE DEPTH: depth on the face comes from shadow only, never 3D modeling: the side toward the light stays clean bright white and the other side gets a soft lavender-blue shadow gradient. LIGHTING: one clear key light from a single side, warm highlights and a thin rim light on the lit edges, soft blue-purple shadows (never harsh black), small sparkle glints on shiny details. BACKGROUND: a cinematic, stylized, hand-painted 3D-cartoon world, not a real place, with simplified painterly textures, clean ink-like outlines on architecture, saturated colors, strong perspective, many small details, a blurred foreground object for shallow depth of field, one dominant color plus one contrasting accent color. Visible atmosphere such as dust, embers, fireflies, rain, light rays or soft bloom. '

export const VISUAL_STYLES: VisualStyle[] = [
  {
    id: 'stickman-cinema',
    name: 'Stickman sinematik',
    category: '2d',
    niche: 'Sejarah aneh, kerajaan, fakta unik',
    swatch: '#7B6FD6',
    ink: '#1F1D1A',
    prompt: STICKMAN_CINEMA + NO_TEXT,
    characterHint: 'a hand-drawn stick figure with a slightly squashed oval head, thin black stick arms and legs, and an outfit that covers only the torso, plus headwear or props',
    flowPrompt: true,
    scriptHint:
      'Open with a hook in the very first line: a strange or reversed statement. Follow with a quick setup, then one hero with one weird, specific detail (a number or a rule). People doubt or mock the hero; add light humor or a short dialogue; then a twist or reveal; close with a strong final line or a cliffhanger. Short sentences, simple words, concrete numbers. A new visual idea every two or three sentences. Emotional arc: curiosity, then tension, then reversal.'
  },
  {
    id: 'stickman',
    name: 'Stickman berwarna',
    category: '2d',
    niche: 'Sejarah, kisah nyata',
    swatch: '#F2B266',
    ink: '#1F1D1A',
    prompt:
      '2D flat vector illustration frame for a YouTube storytelling video. Colorful, detailed flat background (never plain white). ALL characters are simple STICKMAN figures: thin black line bodies, arms and legs, plain round white heads with minimal cartoon faces (dot eyes, small eyebrows, simple mouth), no realistic anatomy. Each stickman wears only small costume pieces that match their role (hat, crown, sash, headcloth, props) while the stick body stays visible. Clean bold outlines, flat colors with light soft shading, every character in the same consistent stickman style, cinematic composition with depth. ' +
      NO_TEXT,
    characterHint: 'a stickman figure with a round white head and thin black line limbs, wearing role-specific costume pieces'
  },
  {
    id: 'flat',
    name: 'Kartun flat',
    category: '2d',
    niche: 'Sains, fakta, edukasi',
    swatch: '#8CCBE3',
    ink: '#1F1D1A',
    prompt:
      'Flat vector explainer illustration, bold geometric shapes, a limited harmonious color palette, clean lines, friendly cartoon characters with simple features, soft subtle grain texture, clear readable composition. ' +
      NO_TEXT,
    characterHint: 'a friendly flat vector cartoon character with simple geometric features'
  },
  {
    id: 'whiteboard',
    name: 'Whiteboard doodle',
    category: '2d',
    niche: 'Tutorial, bisnis',
    swatch: '#FFFFFF',
    ink: '#1F1D1A',
    prompt:
      'Hand-drawn whiteboard doodle, black marker line art on a clean white board, one accent color used sparingly (red or blue), simple sketchy characters, arrows and small icons, like a whiteboard animation explainer. ' +
      NO_TEXT,
    characterHint: 'a simple hand-drawn marker doodle character'
  },
  {
    id: 'collage',
    name: 'Kolase kertas',
    category: '2d',
    niche: 'Dokumenter, jurnalisme',
    swatch: '#E9D8BA',
    ink: '#1F1D1A',
    prompt:
      'Paper cut-out collage, layered textured paper, vintage photo cutouts, halftone print textures, torn edges, soft shadows between paper layers, editorial documentary style. ' +
      NO_TEXT,
    characterHint: 'a paper cut-out collage figure with textured paper layers'
  },
  {
    id: 'watercolor',
    name: 'Buku cerita cat air',
    category: '2d',
    niche: 'Dongeng anak, religi',
    swatch: '#CFE3B5',
    ink: '#1F1D1A',
    prompt:
      "Children's storybook watercolor illustration, soft washes on textured paper, warm pastel palette, cute expressive characters, whimsical and cozy mood. " +
      NO_TEXT,
    characterHint: 'a cute storybook watercolor character'
  },
  {
    id: 'anime',
    name: 'Anime',
    category: '2d',
    niche: 'Drama, motivasi, fiksi',
    swatch: '#F5C3CD',
    ink: '#1F1D1A',
    prompt:
      'High-quality anime film still, clean cel shading, expressive characters, detailed painted background, cinematic lighting and color. ' +
      NO_TEXT,
    characterHint: 'an anime character with clean cel shading'
  },
  {
    id: 'noir',
    name: 'Komik noir',
    category: '2d',
    niche: 'Horor, true crime',
    swatch: '#2F3240',
    ink: '#FAF7F2',
    prompt:
      'Dark graphic-novel comic panel, heavy black ink shadows, high contrast, muted palette with a single accent color, dramatic angles, halftone texture, suspenseful mood. ' +
      NO_TEXT,
    characterHint: 'a graphic-novel character drawn with heavy ink shadows'
  },
  {
    id: 'pixel',
    name: 'Pixel art',
    category: '2d',
    niche: 'Gaming, nostalgia',
    swatch: '#8FD694',
    ink: '#1F1D1A',
    prompt: 'Detailed 16-bit pixel art scene, crisp pixels, limited retro palette, video game aesthetic, no blur. ' + NO_TEXT,
    characterHint: 'a 16-bit pixel art character sprite'
  },
  {
    id: 'animation3d',
    name: 'Animasi 3D',
    category: '3d',
    niche: 'Fabel, keluarga, anak',
    swatch: '#FFD66B',
    ink: '#1F1D1A',
    prompt:
      '3D animated feature film render, stylized characters with big expressive faces, soft global illumination, subsurface scattering, vibrant colors, cinematic depth of field. ' +
      NO_TEXT,
    characterHint: 'a stylized 3D animated film character with an expressive face'
  },
  {
    id: 'clay',
    name: 'Claymation',
    category: '3d',
    niche: 'Komedi, cerita anak',
    swatch: '#F4A988',
    ink: '#1F1D1A',
    prompt:
      'Claymation stop-motion scene, handcrafted plasticine characters and miniature sets, visible fingerprints and clay texture, soft studio lighting. ' +
      NO_TEXT,
    characterHint: 'a handcrafted plasticine clay character'
  },
  {
    id: 'lowpoly',
    name: 'Low-poly 3D',
    category: '3d',
    niche: 'Teknologi, sains',
    swatch: '#A7C7E7',
    ink: '#1F1D1A',
    prompt:
      'Low-poly 3D render, faceted geometric shapes, flat-shaded polygons, clean pastel colors, soft ambient lighting. ' + NO_TEXT,
    characterHint: 'a low-poly 3D character with faceted shapes'
  },
  {
    id: 'diorama',
    name: 'Diorama miniatur',
    category: '3d',
    niche: 'Sejarah, kota, perang',
    swatch: '#C9D9A6',
    ink: '#1F1D1A',
    prompt:
      'Tilt-shift miniature diorama, tiny detailed 3D figures and buildings, shallow depth of field, soft daylight, toy-like scale. ' +
      NO_TEXT,
    characterHint: 'a tiny detailed miniature figurine'
  },
  {
    id: 'cinematic',
    name: 'Sinematik realistis',
    category: 'realistis',
    niche: 'Misteri, sejarah, drama',
    swatch: '#56607A',
    ink: '#FAF7F2',
    prompt:
      'Photorealistic cinematic film still, dramatic natural lighting, shallow depth of field, anamorphic lens look, rich color grading, subtle 35mm film grain. ' +
      NO_TEXT,
    characterHint: 'a photorealistic person, cinematic lighting'
  },
  {
    id: 'documentary',
    name: 'Foto dokumenter',
    category: 'realistis',
    niche: 'Fakta, berita, alam',
    swatch: '#8A9A7B',
    ink: '#FAF7F2',
    prompt:
      'Realistic documentary photograph, natural light, authentic details, candid composition, high detail, true-to-life colors. ' +
      NO_TEXT,
    characterHint: 'a realistic documentary portrait of a person'
  },
  {
    id: 'archival',
    name: 'Arsip sejarah',
    category: 'realistis',
    niche: 'Sejarah, perang, tokoh',
    swatch: '#B9A488',
    ink: '#1F1D1A',
    prompt:
      'Vintage archival photograph, faded sepia or black and white, film grain, light scratches and dust, historical documentary look. ' +
      NO_TEXT,
    characterHint: 'a person in a vintage archival sepia photograph'
  },
  {
    id: 'epic',
    name: 'Fantasi epik',
    category: 'realistis',
    niche: 'Mitologi, legenda',
    swatch: '#6C5B8E',
    ink: '#FAF7F2',
    prompt:
      'Epic realistic fantasy concept art, highly detailed, volumetric light, grand scale, painterly realism, cinematic composition. ' +
      NO_TEXT,
    characterHint: 'an epic realistic fantasy character, concept art'
  }
]

export function getStyle(id: string): VisualStyle {
  return VISUAL_STYLES.find((s) => s.id === id) ?? VISUAL_STYLES[0]
}
