/**
 * Provider factory. Selection order:
 *   LLM_PROVIDER env var ("anthropic" | "openai_compatible" | "mock") →
 *   otherwise "anthropic" when ANTHROPIC_API_KEY is set → otherwise "mock".
 * Secrets are read from environment variables only (section 7).
 */
import { createAnthropicProvider } from "./anthropic";
import { createMockProvider } from "./mock";
import { createOpenAiCompatibleProvider } from "./openaiCompat";
import type { EmbeddingProvider, LLMProvider } from "./types";

export type { LLMProvider, LlmRequest, LlmResponse, LlmMessage, LlmContentBlock, LlmToolDefinition, EmbeddingProvider } from "./types";

export function selectedProviderName(): "anthropic" | "openai_compatible" | "mock" {
  const forced = process.env.LLM_PROVIDER;
  if (forced === "anthropic" || forced === "openai_compatible" || forced === "mock") return forced;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "mock";
}

export async function getLlmProvider(): Promise<LLMProvider> {
  const name = selectedProviderName();
  if (name === "anthropic") return await createAnthropicProvider(process.env.ANTHROPIC_API_KEY);
  if (name === "openai_compatible") {
    const baseUrl = process.env.OPENAI_COMPAT_BASE_URL;
    const apiKey = process.env.OPENAI_COMPAT_API_KEY;
    if (!baseUrl || !apiKey) throw new Error("NOT_CONFIGURED: OPENAI_COMPAT_BASE_URL / OPENAI_COMPAT_API_KEY");
    return createOpenAiCompatibleProvider({ baseUrl, apiKey });
  }
  return createMockProvider();
}

export const EMBEDDING_DIMENSIONS = 1024;

/**
 * Deterministic hashed bag-of-words embedding (1024 dims). Good enough to make
 * retrieval work offline; replaced by Voyage AI when VOYAGE_API_KEY is set.
 */
export function createMockEmbeddingProvider(): EmbeddingProvider {
  return {
    name: "mock-hash-1024",
    dimensions: EMBEDDING_DIMENSIONS,
    async embed(texts) {
      return texts.map((text) => {
        const vec = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
        const tokens = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
        for (const token of tokens) {
          let h = 2166136261;
          for (let i = 0; i < token.length; i++) {
            h ^= token.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
          }
          vec[h % EMBEDDING_DIMENSIONS] += 1;
          // Character trigram signal helps Arabic morphology a little.
          for (let i = 0; i + 3 <= token.length; i++) {
            let g = 5381;
            for (let j = i; j < i + 3; j++) g = (g * 33) ^ token.charCodeAt(j);
            vec[(g >>> 0) % EMBEDDING_DIMENSIONS] += 0.5;
          }
        }
        const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
        return vec.map((x) => x / norm);
      });
    },
  };
}

export function createVoyageEmbeddingProvider(apiKey: string, model = "voyage-3"): EmbeddingProvider {
  return {
    name: model,
    dimensions: EMBEDDING_DIMENSIONS,
    async embed(texts, signal) {
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ input: texts, model, input_type: "document" }),
        signal: signal ?? AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`VOYAGE_HTTP_${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { data: { embedding: number[] }[] };
      return json.data.map((d) => d.embedding);
    },
  };
}

export function getEmbeddingProvider(): EmbeddingProvider {
  const key = process.env.VOYAGE_API_KEY;
  if (key && process.env.EMBEDDING_PROVIDER !== "mock") return createVoyageEmbeddingProvider(key);
  return createMockEmbeddingProvider();
}
