import { openRouterModelFor } from "./models";
import type {
    NormalizedToolCall,
    NormalizedToolResult,
    OpenAIToolSchema,
    StreamCallbacks,
    StreamChatParams,
    StreamChatResult,
    UserApiKeys,
} from "./types";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_TOKENS = 16384;

type OpenRouterToolCall = {
    id: string;
    type: "function";
    function: {
        name: string;
        arguments: string;
    };
};

type OpenRouterMessage =
    | {
          role: "system" | "user" | "assistant";
          content: string | null;
          tool_calls?: OpenRouterToolCall[];
          reasoning?: string;
          reasoning_details?: unknown[];
      }
    | {
          role: "tool";
          tool_call_id: string;
          name?: string;
          content: string;
      };

type StreamToolCallDelta = {
    index?: number;
    id?: string;
    type?: "function";
    function?: {
        name?: string;
        arguments?: string;
    };
};

type StreamChoice = {
    finish_reason?: string | null;
    delta?: {
        content?: string | null;
        reasoning?: string | null;
        reasoning_details?: unknown[];
        tool_calls?: StreamToolCallDelta[];
    };
    error?: { message?: string; code?: string | number };
};

type ChatCompletionResponse = {
    choices?: {
        message?: {
            content?: string | null;
        };
        error?: { message?: string; code?: string | number };
    }[];
    error?: { message?: string; code?: string | number };
};

type OpenRouterStreamChunk = {
    choices?: StreamChoice[];
    error?: { message?: string; code?: string | number };
};

type ToolCallAccumulator = {
    id?: string;
    name?: string;
    arguments: string;
};

export function hasOpenRouterApiKey(apiKeys?: UserApiKeys): boolean {
    return !!(
        apiKeys?.openrouter?.trim() || process.env.OPENROUTER_API_KEY?.trim()
    );
}

function apiKey(override?: string | null): string {
    const key = override?.trim() || process.env.OPENROUTER_API_KEY?.trim();
    if (!key) {
        throw new Error(
            "OpenRouter API key missing. Add OPENROUTER_API_KEY to backend/.env or save an OpenRouter key in account settings.",
        );
    }
    return key;
}

function openRouterHeaders(key: string): Record<string, string> {
    const referer =
        process.env.OPENROUTER_HTTP_REFERER ||
        process.env.FRONTEND_URL ||
        "http://localhost:3000";
    return {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": referer,
        "X-OpenRouter-Title": process.env.OPENROUTER_APP_TITLE || "Mike OSS",
    };
}

function toInitialMessages(params: StreamChatParams): OpenRouterMessage[] {
    const messages: OpenRouterMessage[] = [];
    if (params.systemPrompt.trim()) {
        messages.push({ role: "system", content: params.systemPrompt });
    }
    for (const message of params.messages) {
        messages.push({ role: message.role, content: message.content });
    }
    return messages;
}

async function requestOpenRouter(
    key: string,
    body: Record<string, unknown>,
): Promise<Response> {
    const response = await fetch(OPENROUTER_API_URL, {
        method: "POST",
        headers: openRouterHeaders(key),
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const detail = await response.text();
        throw new Error(
            `OpenRouter API error ${response.status}: ${detail || response.statusText}`,
        );
    }

    return response;
}

function collectSseData(lines: string[]): string | null {
    const dataLines = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart());
    return dataLines.length ? dataLines.join("\n") : null;
}

async function* readSseData(response: Response): AsyncGenerator<string> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("OpenRouter response body is empty.");

    const decoder = new TextDecoder();
    let buffer = "";
    let eventLines: string[] = [];

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\n/);
        buffer = lines.pop() ?? "";

        for (const rawLine of lines) {
            const line = rawLine.endsWith("\r")
                ? rawLine.slice(0, -1)
                : rawLine;
            if (line === "") {
                const data = collectSseData(eventLines);
                eventLines = [];
                if (data) yield data;
            } else {
                eventLines.push(line);
            }
        }
    }

    buffer += decoder.decode();
    if (buffer) eventLines.push(buffer.replace(/\r$/, ""));
    const data = collectSseData(eventLines);
    if (data) yield data;
}

function parseToolInput(raw: string): Record<string, unknown> {
    if (!raw.trim()) return {};
    try {
        const parsed = JSON.parse(raw) as unknown;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : { value: parsed };
    } catch {
        return {};
    }
}

function mergeToolCallDelta(
    calls: ToolCallAccumulator[],
    delta: StreamToolCallDelta,
): void {
    const index = delta.index ?? calls.length;
    const current = calls[index] ?? { arguments: "" };
    if (delta.id) current.id = delta.id;
    if (delta.function?.name) {
        current.name = current.name
            ? current.name === delta.function.name
                ? current.name
                : `${current.name}${delta.function.name}`
            : delta.function.name;
    }
    if (delta.function?.arguments) {
        current.arguments += delta.function.arguments;
    }
    calls[index] = current;
}

function toOpenRouterToolCall(
    call: ToolCallAccumulator,
    index: number,
): OpenRouterToolCall {
    return {
        id: call.id ?? `call_${index}`,
        type: "function",
        function: {
            name: call.name ?? "tool",
            arguments: call.arguments || "{}",
        },
    };
}

function toNormalizedToolCall(
    call: ToolCallAccumulator,
    index: number,
): NormalizedToolCall {
    return {
        id: call.id ?? `call_${index}`,
        name: call.name ?? "tool",
        input: parseToolInput(call.arguments),
    };
}

function emitReasoning(
    delta: NonNullable<StreamChoice["delta"]>,
    callbacks: StreamCallbacks,
): boolean {
    let sawReasoning = false;
    if (typeof delta.reasoning === "string" && delta.reasoning) {
        sawReasoning = true;
        callbacks.onReasoningDelta?.(delta.reasoning);
    }

    for (const detail of delta.reasoning_details ?? []) {
        if (!detail || typeof detail !== "object") continue;
        const record = detail as Record<string, unknown>;
        const text =
            typeof record.text === "string"
                ? record.text
                : typeof record.summary === "string"
                  ? record.summary
                  : "";
        if (text) {
            sawReasoning = true;
            callbacks.onReasoningDelta?.(text);
        }
    }
    return sawReasoning;
}

function throwForOpenRouterError(error?: {
    message?: string;
    code?: string | number;
}): void {
    if (!error) return;
    const suffix = error.code ? ` (${error.code})` : "";
    throw new Error(
        `OpenRouter API error${suffix}: ${error.message ?? "Unknown error"}`,
    );
}

function requestBody({
    model,
    messages,
    tools,
    stream,
    maxTokens,
    enableThinking,
}: {
    model: string;
    messages: OpenRouterMessage[];
    tools?: OpenAIToolSchema[];
    stream: boolean;
    maxTokens: number;
    enableThinking?: boolean;
}): Record<string, unknown> {
    return {
        model: openRouterModelFor(model),
        messages,
        stream,
        max_tokens: maxTokens,
        ...(tools?.length ? { tools } : {}),
        ...(enableThinking
            ? {
                  include_reasoning: true,
                  reasoning: { effort: "high" },
              }
            : {}),
    };
}

export async function streamOpenRouter(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    const {
        model,
        tools = [],
        callbacks = {},
        runTools,
        apiKeys,
        enableThinking,
    } = params;
    const key = apiKey(apiKeys?.openrouter);
    const maxIter = params.maxIterations ?? 10;
    const messages = toInitialMessages(params);
    let fullText = "";

    for (let iter = 0; iter < maxIter; iter++) {
        const response = await requestOpenRouter(
            key,
            requestBody({
                model,
                messages,
                tools,
                stream: true,
                maxTokens: MAX_TOKENS,
                enableThinking,
            }),
        );

        let text = "";
        let reasoning = "";
        let sawReasoning = false;
        const reasoningDetails: unknown[] = [];
        const toolCallChunks: ToolCallAccumulator[] = [];

        for await (const data of readSseData(response)) {
            if (data === "[DONE]") break;

            let chunk: OpenRouterStreamChunk;
            try {
                chunk = JSON.parse(data) as OpenRouterStreamChunk;
            } catch {
                continue;
            }
            throwForOpenRouterError(chunk.error);

            for (const choice of chunk.choices ?? []) {
                throwForOpenRouterError(choice.error);
                const delta = choice.delta;
                if (!delta) continue;

                if (typeof delta.content === "string" && delta.content) {
                    text += delta.content;
                    callbacks.onContentDelta?.(delta.content);
                }

                if (emitReasoning(delta, callbacks)) {
                    sawReasoning = true;
                }
                if (typeof delta.reasoning === "string") {
                    reasoning += delta.reasoning;
                }
                if (delta.reasoning_details?.length) {
                    reasoningDetails.push(...delta.reasoning_details);
                }

                for (const toolCall of delta.tool_calls ?? []) {
                    mergeToolCallDelta(toolCallChunks, toolCall);
                }
            }
        }

        if (sawReasoning) callbacks.onReasoningBlockEnd?.();
        fullText += text;

        const normalizedToolCalls = toolCallChunks
            .filter((call) => call.id || call.name || call.arguments)
            .map(toNormalizedToolCall);

        if (!normalizedToolCalls.length || !runTools) break;

        const openRouterToolCalls = toolCallChunks
            .filter((call) => call.id || call.name || call.arguments)
            .map(toOpenRouterToolCall);

        for (const call of normalizedToolCalls) {
            callbacks.onToolCallStart?.(call);
        }

        messages.push({
            role: "assistant",
            content: text || null,
            tool_calls: openRouterToolCalls,
            ...(reasoning ? { reasoning } : {}),
            ...(reasoningDetails.length
                ? { reasoning_details: reasoningDetails }
                : {}),
        });

        const results = await runTools(normalizedToolCalls);
        messages.push(...toToolResultMessages(results, normalizedToolCalls));
    }

    return { fullText };
}

function toToolResultMessages(
    results: NormalizedToolResult[],
    calls: NormalizedToolCall[],
): OpenRouterMessage[] {
    return results.map((result) => {
        const call = calls.find((c) => c.id === result.tool_use_id);
        return {
            role: "tool",
            tool_call_id: result.tool_use_id,
            name: call?.name,
            content: result.content,
        };
    });
}

export async function completeOpenRouterText(params: {
    model: string;
    systemPrompt?: string;
    user: string;
    maxTokens?: number;
    apiKeys?: UserApiKeys;
}): Promise<string> {
    const key = apiKey(params.apiKeys?.openrouter);
    const messages: OpenRouterMessage[] = [];
    if (params.systemPrompt?.trim()) {
        messages.push({ role: "system", content: params.systemPrompt });
    }
    messages.push({ role: "user", content: params.user });

    const response = await requestOpenRouter(
        key,
        requestBody({
            model: params.model,
            messages,
            stream: false,
            maxTokens: params.maxTokens ?? 512,
        }),
    );

    const data = (await response.json()) as ChatCompletionResponse;
    throwForOpenRouterError(data.error);
    const choice = data.choices?.[0];
    throwForOpenRouterError(choice?.error);
    return choice?.message?.content ?? "";
}
