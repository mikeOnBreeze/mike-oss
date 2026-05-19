import { createServerSupabase } from "./supabase";
import {
    resolveModel,
    DEFAULT_TITLE_MODEL,
    DEFAULT_TABULAR_MODEL,
    GEMINI_LOW_MODELS,
    type UserApiKeys,
} from "./llm";

export type UserModelSettings = {
    title_model: string;
    tabular_model: string;
    api_keys: UserApiKeys;
};

const DEFAULT_GEMINI_TITLE_MODEL = GEMINI_LOW_MODELS[0];

// Title generation is a lightweight task, so route it to the cheapest model
// for whichever provider is actually available. Env keys count because local
// dev commonly relies on backend/.env rather than saved per-user keys.
function resolveTitleModel(apiKeys: UserApiKeys): string {
    if (apiKeys.gemini?.trim() || process.env.GEMINI_API_KEY?.trim()) {
        return DEFAULT_GEMINI_TITLE_MODEL;
    }
    if (apiKeys.claude?.trim()) return "claude-haiku-4-5";
    return DEFAULT_TITLE_MODEL;
}

export async function getUserModelSettings(
    userId: string,
    db?: ReturnType<typeof createServerSupabase>,
): Promise<UserModelSettings> {
    const client = db ?? createServerSupabase();
    const { data } = await client
        .from("user_profiles")
        .select("tabular_model, claude_api_key, gemini_api_key")
        .eq("user_id", userId)
        .single();

    const api_keys: UserApiKeys = {
        claude: data?.claude_api_key ?? null,
        gemini: data?.gemini_api_key ?? null,
    };

    return {
        title_model: resolveTitleModel(api_keys),
        tabular_model: resolveModel(data?.tabular_model, DEFAULT_TABULAR_MODEL),
        api_keys,
    };
}

export async function getUserApiKeys(
    userId: string,
    db?: ReturnType<typeof createServerSupabase>,
): Promise<UserApiKeys> {
    const client = db ?? createServerSupabase();
    const { data } = await client
        .from("user_profiles")
        .select("claude_api_key, gemini_api_key")
        .eq("user_id", userId)
        .single();
    return {
        claude: data?.claude_api_key ?? null,
        gemini: data?.gemini_api_key ?? null,
    };
}
