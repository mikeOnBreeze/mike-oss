import { streamClaude, completeClaudeText } from "./claude";
import { streamGemini, completeGeminiText } from "./gemini";
import {
    streamOpenRouter,
    completeOpenRouterText,
    hasOpenRouterApiKey,
} from "./openrouter";
import { providerForModel } from "./models";
import type { StreamChatParams, StreamChatResult, UserApiKeys } from "./types";

export * from "./types";
export * from "./models";

export async function streamChatWithTools(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    if (hasOpenRouterApiKey(params.apiKeys)) return streamOpenRouter(params);
    const provider = providerForModel(params.model);
    if (provider === "claude") return streamClaude(params);
    if (provider === "openrouter") return streamOpenRouter(params);
    return streamGemini(params);
}

export async function completeText(params: {
    model: string;
    systemPrompt?: string;
    user: string;
    maxTokens?: number;
    apiKeys?: UserApiKeys;
}): Promise<string> {
    if (hasOpenRouterApiKey(params.apiKeys))
        return completeOpenRouterText(params);
    const provider = providerForModel(params.model);
    if (provider === "claude") return completeClaudeText(params);
    if (provider === "openrouter") return completeOpenRouterText(params);
    return completeGeminiText(params);
}
