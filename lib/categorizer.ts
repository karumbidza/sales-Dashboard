// lib/categorizer.ts
// Claude-backed classifier for R&M invoice descriptions.
// Returns one verdict per input id, even when the model omits one.

import type { FewShotMap } from './categorizer-examples';
import { cleanForAI } from './categorizer-input';

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
  'vehicles',
  'labour_wages',
  'cleaning_services',
  'capex_amortization',
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
  classify(items: CategorizerInput[], systemPrompt: string): Promise<ClassifyResponse>;
}

// Static base — the category list.
const BASE_PROMPT = `You categorize R&M (repairs & maintenance) invoice
descriptions for a fuel-station retail business in Zimbabwe. You will
receive a list of descriptions and must assign each to exactly ONE of
these categories.

CATEGORIES:
  pumps_dispensers     — Dispensers, fuel nozzles, hoses, STP, shear/breakaway valves
  compressors_air      — Air compressors, compressor motors, pressure gauges, V-belts
  tanks_lines          — Underground tanks, fuel lines, manholes, ATG, dipsticks, bunding, line testing, oil separators
  generators           — Gensets, generator service & repair
  solar_ups            — Solar panels, inverters, batteries, UPS
  electrical_lighting  — Wiring, sockets, fault clearing, isolators, day-night switches, lights, cabling
  plumbing_water_waste — Leaks, toilets, urinals, sinks, sprinklers, waste disposal, boreholes, drainage
  building_civil       — Paint, roof, doors, windows, tiles, paving, locksets, safes, HVAC, strongroom doors
  canopy_signage       — Canopy structure, signage, illumination, display boards
  landscaping_grounds  — Garden, grass, trees, hedging
  fire_safety          — Extinguishers, fire equipment, spill kits, fire signage
  security_cctv        — CCTV, alarms, fences, gates
  vehicles             — Fleet vehicles by name (Plymouth, Toyota), tyres, vehicle servicing, transport
  labour_wages         — Recurring people-cost lines: caretaker wages, security wages, person names by themselves
  cleaning_services    — Routine cleaning (canopy cleaning, deep forecourt cleaning, shop cleaning) — operational, not repair
  capex_amortization   — Accounting accruals: renovation amortization, capex spread over months, set-up costs
  other                — TRULY no fit. Use sparingly.`;

// Domain terminology unique to Zimbabwean fuel-station maintenance.
// The model does not know these out-of-the-box.
const GLOSSARY = `DOMAIN GLOSSARY (Zimbabwean fuel-station terminology):
  ZVA          — automatic nozzle type → pumps_dispensers
  breakaway    — emergency disconnect on dispenser hose → pumps_dispensers
  swivel       — rotating hose fitting → pumps_dispensers
  grip lock    — anti-theft nozzle clip → pumps_dispensers
  STP / submersible — fuel tank pump → tanks_lines
  ATG          — automatic tank gauge → tanks_lines
  soakway      — drainage pit → plumbing_water_waste
  oil separator — wastewater treatment → tanks_lines
  bunding      — concrete containment around tanks → tanks_lines
  day-night switch — photocell light switch → electrical_lighting
  canopy       — overhead roof at fuel pumps → canopy_signage
  forecourt    — open service area (context only, not a category)
  Plymouth / Toyota / vehicle  — vehicle make or generic vehicle reference → vehicles
  caretaker / gardener wages   — recurring people-cost lines → labour_wages
  person name only             — likely a wage line if no other context → labour_wages
  deep cleaning / canopy clean — operational cleaning, NOT repair → cleaning_services
  amortization / amortisation  — accounting accrual → capex_amortization`;

// Final instructions block — explicit anti-other bias.
const INSTRUCTIONS = `INSTRUCTIONS:
1. Look for keywords matching the glossary or category descriptions above.
2. Pick the BEST match. Only use 'other' if NO category fits — even loosely.
3. Rate confidence:
   - high: description directly names something in the category
   - medium: strong implication from context
   - low: an educated guess; surface for human review

Return strict JSON via the categorize tool. No prose.`;

export function buildSystemPrompt(examples: FewShotMap): string {
  const exampleSections = Object.entries(examples)
    .filter(([, descs]) => descs.length > 0)
    .map(([slug, descs]) => {
      const lines = descs.map(d => `  - "${d}"`).join('\n');
      return `${slug}:\n${lines}`;
    })
    .join('\n\n');

  const examplesBlock = exampleSections
    ? `EXAMPLES OF CORRECT CATEGORIZATION (from past invoices):\n\n${exampleSections}\n\n`
    : '';

  return `${BASE_PROMPT}\n\n${GLOSSARY}\n\n${examplesBlock}${INSTRUCTIONS}`;
}

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
  systemPrompt: string,
): Promise<CategorizerOutput[]> {
  const resp = await client.classify(items, systemPrompt);
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
    async classify(items, systemPrompt) {
      // Send the cleaned description to Claude; keep the original id mapping.
      // If cleanForAI empties a description, fall back to the original.
      const cleanedItems = items.map(it => ({
        id: it.id,
        description: cleanForAI(it.description) || it.description,
      }));

      const resp = await sdk.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4000,
        system: [
          { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
        ],
        tools: [TOOL],
        tool_choice: { type: 'tool', name: 'categorize' },
        messages: [{
          role: 'user',
          content: JSON.stringify(cleanedItems),
        }],
      });
      const block = (resp.content as any[]).find(b => b.type === 'tool_use' && b.name === 'categorize');
      if (!block) throw new Error('Claude did not return the categorize tool call');
      return block.input as ClassifyResponse;
    },
  };
}
