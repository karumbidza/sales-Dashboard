// lib/categorizer.ts
// Claude-backed classifier for R&M invoice descriptions.
// Returns one verdict per input id, even when the model omits one.

export const CATEGORY_SLUGS = [
  'pumps_dispensers',
  'compressors_air',
  'tanks_lines',
  'generators',
  'solar_ups',
  'electrical_lighting',
  'plumbing_water_waste',
  'building_civil',
  'canopy_signage',
  'landscaping_grounds',
  'fire_safety',
  'security_cctv',
  'other',
] as const;
export type CategorySlug = typeof CATEGORY_SLUGS[number];
export type Confidence = 'high' | 'medium' | 'low';

const ALLOWED = new Set<string>(CATEGORY_SLUGS);

export interface CategorizerInput  { id: number; description: string; }
export interface CategorizerOutput { id: number; slug: CategorySlug; confidence: Confidence; needs_review: boolean; }

export interface ClassifyResponse {
  results: { id: number; category: string; confidence: string }[];
}

export interface CategorizerClient {
  classify(items: CategorizerInput[]): Promise<ClassifyResponse>;
}

const SYSTEM_PROMPT = `You categorize R&M (repairs & maintenance) invoice descriptions for a
fuel-station retail business in Zimbabwe. You will receive a list of
descriptions and must assign each to exactly ONE of these categories:

  pumps_dispensers       — Dispensers, fuel nozzles, hoses, STP, shear/breakaway valves
  compressors_air        — Air compressors, compressor motors, pressure gauges, V-belts
  tanks_lines            — Underground tanks, fuel lines, manholes, ATG, dipsticks, bunding, line testing
  generators             — Gensets, generator service & repair
  solar_ups              — Solar panels, inverters, batteries, UPS
  electrical_lighting    — Wiring, sockets, fault clearing, isolators, canopy/forecourt/flood/LED/fluorescent lights
  plumbing_water_waste   — Leaks, toilets, urinals, sinks, sprinklers, liquid-waste disposal, boreholes
  building_civil         — Paint, roof, doors, windows, tiles, paving, potholes, locksets, safes, HVAC
  canopy_signage         — Canopy structure, signage, illumination, display boards
  landscaping_grounds    — Garden, grass, trees, hedging
  fire_safety            — Extinguishers, fire equipment
  security_cctv          — CCTV, alarms, fences, gates
  other                  — Use ONLY if no category above plausibly fits.

Also rate your confidence: "high" | "medium" | "low".
- high   = description directly names something in the category
- medium = strong implication from context
- low    = guess; surface for human review

Return strict JSON via the provided tool. No prose.`;

const TOOL = {
  name: 'categorize',
  description: 'Return one category + confidence per input id.',
  input_schema: {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id:         { type: 'integer' },
            category:   { type: 'string', enum: [...CATEGORY_SLUGS] },
            confidence: { type: 'string', enum: ['high','medium','low'] },
          },
          required: ['id','category','confidence'],
        },
      },
    },
    required: ['results'],
  },
} as const;

export const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

export async function categorizeBatch(
  client: CategorizerClient,
  items: CategorizerInput[],
): Promise<CategorizerOutput[]> {
  const resp = await client.classify(items);
  const byId = new Map<number, { category: string; confidence: string }>();
  for (const r of resp.results ?? []) byId.set(r.id, r);

  const out: CategorizerOutput[] = [];
  for (const item of items) {
    const r = byId.get(item.id);
    const validConfidence = (c: string): Confidence =>
      c === 'high' || c === 'medium' || c === 'low' ? c : 'low';

    if (!r || !ALLOWED.has(r.category)) {
      out.push({ id: item.id, slug: 'other', confidence: 'low', needs_review: true });
      continue;
    }
    const conf = validConfidence(r.confidence);
    out.push({
      id: item.id,
      slug: r.category as CategorySlug,
      confidence: conf,
      needs_review: conf === 'low',
    });
  }
  return out;
}

// Real Claude client — used in production; not exercised by unit tests.
export function createClaudeClient(apiKey: string): CategorizerClient {
  // Lazy-import the SDK so tests don't need it loaded.
  const Anthropic = require('@anthropic-ai/sdk').default;
  const sdk = new Anthropic({ apiKey });

  return {
    async classify(items) {
      const resp = await sdk.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4000,
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        tools: [TOOL],
        tool_choice: { type: 'tool', name: 'categorize' },
        messages: [{
          role: 'user',
          content: JSON.stringify(items),
        }],
      });
      const block = (resp.content as any[]).find(b => b.type === 'tool_use' && b.name === 'categorize');
      if (!block) throw new Error('Claude did not return the categorize tool call');
      return block.input as ClassifyResponse;
    },
  };
}
