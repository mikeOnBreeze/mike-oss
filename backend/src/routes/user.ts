import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createServerSupabase } from "../lib/supabase";

export const userRouter = Router();

const PROFILE_UPDATE_FIELDS = new Set([
  "display_name",
  "organisation",
  "message_credits_used",
  "credits_reset_date",
  "tabular_model",
  "claude_api_key",
  "gemini_api_key",
  "openrouter_api_key",
  "updated_at",
]);

function withApiKeyStatus(profile: Record<string, unknown> | null) {
  if (!profile) return profile;
  return {
    ...profile,
    openrouter_api_key_present: !!(
      process.env.OPENROUTER_API_KEY?.trim() ||
      (typeof profile.openrouter_api_key === "string" &&
        profile.openrouter_api_key.trim())
    ),
  };
}

// POST /user/profile
userRouter.post("/profile", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const db = createServerSupabase();
  const { error } = await db
    .from("user_profiles")
    .upsert(
      { user_id: userId },
      { onConflict: "user_id", ignoreDuplicates: true },
    );
  if (error) return void res.status(500).json({ detail: error.message });
  res.json({ ok: true });
});

// GET /user/profile
userRouter.get("/profile", requireAuth, async (_req, res) => {
  const userId = res.locals.userId as string;
  const db = createServerSupabase();
  await db
    .from("user_profiles")
    .upsert(
      { user_id: userId },
      { onConflict: "user_id", ignoreDuplicates: true },
    );
  const { data, error } = await db
    .from("user_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (error) return void res.status(500).json({ detail: error.message });
  res.json(withApiKeyStatus(data));
});

// PATCH /user/profile
userRouter.patch("/profile", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(req.body ?? {})) {
    if (PROFILE_UPDATE_FIELDS.has(key)) updates[key] = value;
  }
  updates.updated_at = new Date().toISOString();

  const db = createServerSupabase();
  await db
    .from("user_profiles")
    .upsert(
      { user_id: userId },
      { onConflict: "user_id", ignoreDuplicates: true },
    );
  const { data, error } = await db
    .from("user_profiles")
    .update(updates)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) return void res.status(500).json({ detail: error.message });
  res.json(withApiKeyStatus(data));
});

// DELETE /user/account
userRouter.delete("/account", requireAuth, async (_req, res) => {
  const userId = res.locals.userId as string;
  const db = createServerSupabase();
  const { error } = await db.auth.admin.deleteUser(userId);
  if (error) return void res.status(500).json({ detail: error.message });
  res.status(204).send();
});
