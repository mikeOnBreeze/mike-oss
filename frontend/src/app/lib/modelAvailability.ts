import { MODELS, type ModelOption } from "../components/assistant/ModelToggle";

export type ModelProvider = "claude" | "gemini" | "openrouter";
export type ModelApiKeys = {
    claudeApiKey: string | null;
    geminiApiKey: string | null;
    openrouterApiKey: string | null;
    hasOpenRouterApiKey?: boolean;
};

export function getModelProvider(modelId: string): ModelProvider | null {
    const model = MODELS.find((m) => m.id === modelId);
    if (!model) return null;
    if (model.group === "OpenRouter") return "openrouter";
    return model.group === "Anthropic" ? "claude" : "gemini";
}

export function isModelAvailable(
    modelId: string,
    apiKeys: ModelApiKeys,
): boolean {
    if (apiKeys.hasOpenRouterApiKey || apiKeys.openrouterApiKey?.trim())
        return true;
    const provider = getModelProvider(modelId);
    if (!provider) return false;
    if (provider === "openrouter") {
        return !!apiKeys.openrouterApiKey?.trim();
    }
    if (provider === "claude") return true;
    return !!apiKeys.geminiApiKey?.trim();
}

export function isProviderAvailable(
    provider: ModelProvider,
    apiKeys: ModelApiKeys,
): boolean {
    if (apiKeys.hasOpenRouterApiKey || apiKeys.openrouterApiKey?.trim())
        return true;
    if (provider === "openrouter") {
        return !!apiKeys.openrouterApiKey?.trim();
    }
    if (provider === "claude") return true;
    return !!apiKeys.geminiApiKey?.trim();
}

export function providerLabel(provider: ModelProvider): string {
    if (provider === "openrouter") return "OpenRouter";
    return provider === "claude" ? "Anthropic (Claude)" : "Google (Gemini)";
}

export function providerKeyHelp(provider: ModelProvider): string {
    if (provider === "openrouter") return "an OpenRouter API key";
    return provider === "claude"
        ? "an OpenRouter API key or an Anthropic (Claude) API key"
        : "an OpenRouter API key or a Google (Gemini) API key";
}

export function modelGroupToProvider(
    group: ModelOption["group"],
): ModelProvider {
    if (group === "OpenRouter") return "openrouter";
    return group === "Anthropic" ? "claude" : "gemini";
}
