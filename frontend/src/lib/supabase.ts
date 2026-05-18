type LocalUser = {
    id: string;
    email: string;
};

type LocalSession = {
    access_token: string;
    user: LocalUser;
};

type LooseData = unknown[] &
    Record<string, unknown> & {
        display_name: string | null;
        organisation: string | null;
        message_credits_used: number;
        credits_reset_date: string;
        tier: string;
        tabular_model: string;
        claude_api_key: string | null;
        gemini_api_key: string | null;
        openrouter_api_key: string | null;
        openrouter_api_key_present?: boolean;
    };

type LocalResult = {
    data: LooseData | null;
    error: { message: string } | null;
};

const API_BASE =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const LOCAL_USER_ID = process.env.NEXT_PUBLIC_LOCAL_USER_ID ?? "local-user";
const LOCAL_EMAIL_KEY = "mike.localUserEmail";

function defaultEmail(): string {
    return process.env.NEXT_PUBLIC_LOCAL_USER_EMAIL ?? "local@mike.local";
}

function currentEmail(): string {
    if (typeof window === "undefined") return defaultEmail();
    return window.localStorage.getItem(LOCAL_EMAIL_KEY) || defaultEmail();
}

function setCurrentEmail(email: string): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LOCAL_EMAIL_KEY, email.trim().toLowerCase());
}

function makeSession(email = currentEmail()): LocalSession {
    return {
        access_token: `${LOCAL_USER_ID}:${encodeURIComponent(email)}`,
        user: { id: LOCAL_USER_ID, email },
    };
}

async function authHeaders(): Promise<Record<string, string>> {
    const session = makeSession();
    return { Authorization: `Bearer ${session.access_token}` };
}

class LocalProfileQuery implements PromiseLike<LocalResult> {
    private action: "select" | "update" = "select";
    private updates: Record<string, unknown> = {};
    private singleMode = false;

    constructor(private table: string) {}

    select(..._args: unknown[]): this {
        void _args;
        this.action = "select";
        return this;
    }

    update(values: Record<string, unknown>): this {
        this.action = "update";
        this.updates = values;
        return this;
    }

    eq(..._args: unknown[]): this {
        void _args;
        return this;
    }

    single(): this {
        this.singleMode = true;
        return this;
    }

    then<TResult1 = LocalResult, TResult2 = never>(
        onfulfilled?:
            | ((value: LocalResult) => TResult1 | PromiseLike<TResult1>)
            | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
        return this.execute().then(onfulfilled, onrejected);
    }

    catch<TResult = never>(
        onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
    ): Promise<LocalResult | TResult> {
        return this.execute().catch(onrejected);
    }

    private async execute(): Promise<LocalResult> {
        if (this.table !== "user_profiles") {
            return {
                data: null,
                error: { message: `Local frontend DB only supports ${this.table}` },
            };
        }

        const headers = {
            "Content-Type": "application/json",
            ...(await authHeaders()),
        };
        const response =
            this.action === "update"
                ? await fetch(`${API_BASE}/user/profile`, {
                      method: "PATCH",
                      headers,
                      body: JSON.stringify(this.updates),
                  })
                : await fetch(`${API_BASE}/user/profile`, {
                      method: "GET",
                      headers,
                      cache: "no-store",
                  });

        if (!response.ok) {
            return {
                data: null,
                error: { message: (await response.text()) || `HTTP ${response.status}` },
            };
        }

        const data = (await response.json()) as unknown;
        return {
            data: (this.singleMode ? data : [data]) as LooseData,
            error: null,
        };
    }
}

export const supabase = {
    auth: {
        async getSession() {
            return { data: { session: makeSession() }, error: null };
        },
        onAuthStateChange(
            callback: (_event: string, session: LocalSession | null) => void,
        ) {
            const id = window.setTimeout(() => callback("SIGNED_IN", makeSession()), 0);
            return {
                data: {
                    subscription: {
                        unsubscribe: () => window.clearTimeout(id),
                    },
                },
            };
        },
        async signOut() {
            return { error: null };
        },
        async signInWithPassword({
            email,
        }: {
            email: string;
            password: string;
        }) {
            setCurrentEmail(email);
            const session = makeSession(email.trim().toLowerCase());
            return { data: { session, user: session.user }, error: null };
        },
        async signUp({ email }: { email: string; password: string }) {
            setCurrentEmail(email);
            const session = makeSession(email.trim().toLowerCase());
            return { data: { session, user: session.user }, error: null };
        },
    },
    from(table: string) {
        return new LocalProfileQuery(table);
    },
};
