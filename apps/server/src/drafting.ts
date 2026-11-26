/**
 * Drafting jobs. v1's page saves the report and its transcript, then asks for
 * a draft; the server builds the prompt (packages/core), asks Claude, checks
 * the answer, and hands the draft back: findings, subsection ratings and notes,
 * and section summaries. v1's page then places the photos and applies it.
 * Ported from v1 server/drafting.js at 03104a2, with jobs in PostgreSQL.
 *
 * Jobs run in the background because a draft can take a minute or two; the
 * page polls GET /api/jobs/:id.
 */
import { buildDraftPrompt, buildSpellingPrompt, phraseLibrary, readDraft, recentExamples } from "@crb/core";
import type { Config } from "./config.js";
import { DraftFailed, createClaudeClient, requestDraft, requestSpelling, type ClaudeClient } from "./claude.js";
import { newId, type Json, type Storage } from "./storage.js";

type Log = { error: (...args: unknown[]) => void };

export class DraftingService {
  private claude: ClaudeClient | null;

  constructor(private readonly storage: Storage, claude: ClaudeClient | null, private readonly config: Pick<Config, "draftModel" | "trainingExamples" | "claudeConfigured">, private readonly log: Log) {
    this.claude = claude;
  }

  /** Created on first use, so the website starts even before a key is set. */
  claudeClient(): ClaudeClient {
    if (this.claude) return this.claude;
    if (!this.config.claudeConfigured) throw new DraftFailed("Drafting isn't set up on the website yet (ANTHROPIC_API_KEY). The transcript and photos are saved; draft again once it's set.");
    this.claude = createClaudeClient();
    return this.claude;
  }

  /** Spelling fixes for the report's texts, from the same prompt the claude.ai page uses. */
  checkSpelling(texts: string[]) {
    return requestSpelling({ client: this.claudeClient(), model: this.config.draftModel, prompt: buildSpellingPrompt(texts) });
  }

  getJob(id: string): Promise<Json | null> {
    return this.storage.getJob(id);
  }

  /** A restart leaves running jobs unfinished; say so instead of spinning forever. */
  async failInterruptedJobs(): Promise<void> {
    for (const job of await this.storage.runningJobs()) {
      await this.storage.saveJob({ ...job, status: "failed", error: "The website restarted while drafting. Try again." });
    }
  }

  async start(assessmentId: string): Promise<Json> {
    const job = { id: newId(), assessmentId, status: "running", createdAt: Date.now() };
    await this.storage.saveJob(job);
    this.run(job).catch((e) => this.log.error("Drafting job crashed", e));
    return job;
  }

  private async run(job: Json): Promise<void> {
    try {
      const assessment = await this.storage.getAssessment(job.assessmentId);
      const transcript = await this.storage.getDoc("transcripts", job.assessmentId);
      if (!assessment || !transcript) throw new DraftFailed("Save the report and its walk-through before drafting.");
      if (assessment.status === "issued") throw new DraftFailed("This report has been issued. Start a revision before drafting again.");
      const examples = recentExamples(await this.storage.listDocs("training"), { limit: this.config.trainingExamples, excludeAssessmentId: assessment.id });
      const phrases = phraseLibrary(await this.storage.getSettings());
      const answer = await requestDraft({ client: this.claudeClient(), model: this.config.draftModel, prompt: buildDraftPrompt(assessment, transcript.segments, examples, phrases) });
      Object.assign(job, { status: "done", draft: readDraft(answer, transcript.segments), examplesUsed: examples.length, finishedAt: Date.now() });
    } catch (error) {
      const expected = error instanceof DraftFailed;
      if (!expected) this.log.error("Drafting failed", error);
      Object.assign(job, { status: "failed", error: expected ? (error as Error).message : "Drafting failed on the website. Try again.", finishedAt: Date.now() });
    }
    await this.storage.saveJob(job);
  }
}
