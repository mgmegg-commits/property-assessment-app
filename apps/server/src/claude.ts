/**
 * The server's Claude call: the drafting prompt in, structured findings out.
 * Ported from v1 server/claude.js at 03104a2. The API key is read by the SDK
 * from ANTHROPIC_API_KEY, on the server only.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";

/** Where an entry goes: a listed subsection id, or a new subsection's name under a section. */
const Placement = {
  sectionId: z.string(),
  subsectionId: z.string(),
  newSubsectionName: z.string(),
};

/** The drafting answer; the prompt (packages/core drafting/prompt.ts) describes each field. */
export const DraftSchema = z.object({
  issues: z.array(z.object({
    ...Placement,
    title: z.string().describe("Short action title. One issue per distinct problem in a subsection, however many places or photos."),
    description: z.string(),
    location: z.string().describe("Every place he mentioned this problem, separated by semicolons; empty if he didn't say."),
    recommendation: z.string(),
    priority: z.enum(["High", "Medium", "Low"]),
    sourceSegmentIds: z.array(z.string()),
  })),
  subsections: z.array(z.object({
    ...Placement,
    rating: z.enum(["G", "F", "P", "NA"]),
    note: z.string(),
    sourceSegmentIds: z.array(z.string()),
  })),
  sections: z.array(z.object({
    sectionId: z.string(),
    summary: z.string(),
  })),
});

export const SpellingSchema = z.object({
  fixes: z.array(z.object({ k: z.number().int(), find: z.string(), replace: z.string(), why: z.string() })),
});

export class DraftFailed extends Error {}

/** The part of the Anthropic client the server uses (a fake in tests). */
export interface ClaudeClient {
  beta: { messages: { stream(params: unknown): { finalMessage(): Promise<{ stop_reason: string | null; parsed_output?: unknown }> } } };
}

export function createClaudeClient(): ClaudeClient {
  return new Anthropic() as unknown as ClaudeClient;
}

/** Explains API failures in words Cecil can act on (or pass on to you). */
function describeApiError(error: unknown): string | null {
  if (error instanceof Anthropic.AuthenticationError) return "The website's Claude API key is missing or invalid (ANTHROPIC_API_KEY).";
  if (error instanceof Anthropic.PermissionDeniedError) return "The website's Claude API key isn't allowed to use this model.";
  if (error instanceof Anthropic.RateLimitError) return "Claude is busy right now. Try again in a minute.";
  if (error instanceof Anthropic.BadRequestError) return `Claude rejected the request: ${error.message}`;
  if (error instanceof Anthropic.APIConnectionError) return "The website couldn't reach Claude. Try again in a minute.";
  if (error instanceof Anthropic.APIError) return `Claude returned an error (${error.status}). Try again.`;
  return null;
}

/**
 * Asks Claude one question whose answer must match `schema`, and returns it.
 * Server-side fallbacks are on, so a declined request is retried on Anthropic's
 * recommended fallback model instead of failing. The request streams, because a
 * long walk-through can take longer to draft than a plain request may wait.
 */
export async function requestStructured<T extends z.ZodType>({ client, model, prompt, schema, effort }: { client: ClaudeClient; model: string; prompt: string; schema: T; effort: "high" | "medium" }): Promise<z.infer<T>> {
  let response;
  try {
    const stream = client.beta.messages.stream({
      model,
      max_tokens: 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort, format: betaZodOutputFormat(schema) },
      messages: [{ role: "user", content: prompt }],
    });
    response = await stream.finalMessage();
  } catch (error) {
    const message = describeApiError(error);
    if (message) throw new DraftFailed(message);
    throw error;
  }
  if (response.stop_reason === "refusal") throw new DraftFailed("Claude declined this request. Try again, or do it by hand.");
  if (response.stop_reason === "max_tokens") throw new DraftFailed("This was too long for Claude to finish in one pass.");
  if (!response.parsed_output) throw new DraftFailed("Claude's answer couldn't be read. Try again.");
  return response.parsed_output as z.infer<T>;
}

/** Findings for the drafting prompt: { issues, subsections, sections }. */
export const requestDraft = ({ client, model, prompt }: { client: ClaudeClient; model: string; prompt: string }) =>
  requestStructured({ client, model, prompt, schema: DraftSchema, effort: "high" });

/** Proposed spelling fixes: { fixes: [...] }. A routine check, so less effort. */
export const requestSpelling = ({ client, model, prompt }: { client: ClaudeClient; model: string; prompt: string }) =>
  requestStructured({ client, model, prompt, schema: SpellingSchema, effort: "medium" });
