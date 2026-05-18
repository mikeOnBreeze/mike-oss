import crypto from "crypto";
import fs from "fs";
import path from "path";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type Row = Record<string, unknown>;

type Store = {
  users: { id: string; email: string; created_at: string; updated_at: string }[];
  tables: Record<string, Row[]>;
};

type LooseData = any[] &
  Record<string, any> & {
    id: any;
    user_id: any;
    project_id: any;
    shared_with: any;
    parent_folder_id: any;
    document_id: any;
    is_system: any;
  };

type QueryResult = {
  data: LooseData;
  error: { message: string } | null;
  count?: number | null;
};

type Filter =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "neq"; column: string; value: unknown }
  | { kind: "is"; column: string; value: unknown }
  | { kind: "in"; column: string; values: unknown[] }
  | { kind: "contains"; column: string; value: unknown }
  | { kind: "not"; column: string; operator: string; value: unknown };

const TABLES = [
  "user_profiles",
  "projects",
  "project_subfolders",
  "documents",
  "document_versions",
  "document_edits",
  "workflows",
  "hidden_workflows",
  "workflow_shares",
  "chats",
  "chat_messages",
  "tabular_reviews",
  "tabular_cells",
  "tabular_review_chats",
  "tabular_review_chat_messages",
];

const DEFAULT_LOCAL_USER_ID = process.env.LOCAL_USER_ID ?? "local-user";
const DEFAULT_LOCAL_USER_EMAIL =
  process.env.LOCAL_USER_EMAIL?.toLowerCase() ?? "local@mike.local";
const DEFAULT_TABULAR_MODEL = "claude-sonnet-4-6";

function dataDir(): string {
  return path.resolve(process.env.LOCAL_DATA_DIR ?? path.join(process.cwd(), "data"));
}

function dbPath(): string {
  return path.join(dataDir(), "local-db.json");
}

function nowIso(): string {
  return new Date().toISOString();
}

function futureResetDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString();
}

function emptyStore(): Store {
  return {
    users: [],
    tables: Object.fromEntries(TABLES.map((t) => [t, []])),
  };
}

function normalizeStore(raw: unknown): Store {
  const next = emptyStore();
  if (!raw || typeof raw !== "object") return next;
  const obj = raw as Partial<Store>;
  if (Array.isArray(obj.users)) next.users = obj.users as Store["users"];
  if (obj.tables && typeof obj.tables === "object") {
    for (const table of TABLES) {
      const rows = (obj.tables as Record<string, unknown>)[table];
      next.tables[table] = Array.isArray(rows) ? (rows as Row[]) : [];
    }
  }
  return next;
}

function loadStore(): Store {
  try {
    const raw = fs.readFileSync(dbPath(), "utf8");
    return normalizeStore(JSON.parse(raw));
  } catch {
    return emptyStore();
  }
}

let store = loadStore();

function saveStore(): void {
  fs.mkdirSync(dataDir(), { recursive: true });
  const target = dbPath();
  const tmp = `${target}.${process.pid}.${Date.now()}.${Math.random()
    .toString(16)
    .slice(2)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, target);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function tableRows(table: string): Row[] {
  if (!store.tables[table]) store.tables[table] = [];
  return store.tables[table];
}

function cleanInput(input: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function defaultsFor(table: string, input: Row): Row {
  const now = nowIso();
  const id = (input.id as string | undefined) ?? crypto.randomUUID();

  switch (table) {
    case "user_profiles":
      return {
        id,
        user_id: input.user_id,
        display_name: null,
        organisation: null,
        tier: "Free",
        message_credits_used: 0,
        credits_reset_date: futureResetDate(),
        tabular_model: DEFAULT_TABULAR_MODEL,
        claude_api_key: null,
        gemini_api_key: null,
        openrouter_api_key: null,
        created_at: now,
        updated_at: now,
      };
    case "projects":
      return {
        id,
        user_id: input.user_id,
        name: input.name,
        cm_number: null,
        visibility: "private",
        shared_with: [],
        created_at: now,
        updated_at: now,
      };
    case "project_subfolders":
      return {
        id,
        project_id: input.project_id,
        user_id: input.user_id,
        name: input.name,
        parent_folder_id: null,
        created_at: now,
        updated_at: now,
      };
    case "documents":
      return {
        id,
        project_id: null,
        user_id: input.user_id,
        filename: input.filename,
        file_type: null,
        size_bytes: 0,
        page_count: null,
        structure_tree: null,
        status: "pending",
        folder_id: null,
        current_version_id: null,
        created_at: now,
        updated_at: now,
      };
    case "document_versions":
      return {
        id,
        document_id: input.document_id,
        storage_path: input.storage_path,
        pdf_storage_path: null,
        source: "upload",
        version_number: null,
        display_name: null,
        created_at: now,
      };
    case "document_edits":
      return {
        id,
        document_id: input.document_id,
        chat_message_id: null,
        version_id: input.version_id,
        change_id: input.change_id,
        del_w_id: null,
        ins_w_id: null,
        deleted_text: "",
        inserted_text: "",
        context_before: null,
        context_after: null,
        status: "pending",
        created_at: now,
        resolved_at: null,
      };
    case "workflows":
      return {
        id,
        user_id: null,
        title: input.title,
        type: input.type,
        prompt_md: null,
        columns_config: null,
        practice: null,
        is_system: false,
        created_at: now,
      };
    case "hidden_workflows":
      return {
        id,
        user_id: input.user_id,
        workflow_id: input.workflow_id,
        created_at: now,
      };
    case "workflow_shares":
      return {
        id,
        workflow_id: input.workflow_id,
        shared_by_user_id: input.shared_by_user_id,
        shared_with_email: input.shared_with_email,
        allow_edit: false,
        created_at: now,
      };
    case "chats":
      return {
        id,
        project_id: null,
        user_id: input.user_id,
        title: null,
        created_at: now,
      };
    case "chat_messages":
      return {
        id,
        chat_id: input.chat_id,
        role: input.role,
        content: null,
        files: null,
        workflow: null,
        annotations: null,
        created_at: now,
      };
    case "tabular_reviews":
      return {
        id,
        project_id: null,
        user_id: input.user_id,
        title: null,
        columns_config: null,
        workflow_id: null,
        practice: null,
        shared_with: [],
        created_at: now,
        updated_at: now,
      };
    case "tabular_cells":
      return {
        id,
        review_id: input.review_id,
        document_id: input.document_id,
        column_index: input.column_index,
        content: null,
        citations: null,
        status: "pending",
        created_at: now,
      };
    case "tabular_review_chats":
      return {
        id,
        review_id: input.review_id,
        user_id: input.user_id,
        title: null,
        created_at: now,
        updated_at: now,
      };
    case "tabular_review_chat_messages":
      return {
        id,
        chat_id: input.chat_id,
        role: input.role,
        content: null,
        annotations: null,
        created_at: now,
      };
    default:
      return { id, created_at: now };
  }
}

function buildRow(table: string, input: Row): Row {
  const cleaned = cleanInput(input);
  return { ...defaultsFor(table, cleaned), ...cleaned };
}

function parseNeedle(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [value];
    }
  }
  return [value];
}

function normalizeComparable(value: unknown): unknown {
  if (value === undefined) return null;
  return value;
}

function matchesFilter(row: Row, filter: Filter): boolean {
  const current = normalizeComparable(row[filter.column]);
  switch (filter.kind) {
    case "eq":
      return current === normalizeComparable(filter.value);
    case "neq":
      return current !== normalizeComparable(filter.value);
    case "is":
      return filter.value === null
        ? current === null
        : current === normalizeComparable(filter.value);
    case "in":
      return filter.values.map(normalizeComparable).includes(current);
    case "contains": {
      const haystack = Array.isArray(current)
        ? current
        : typeof current === "string"
          ? parseNeedle(current)
          : [];
      const needles = parseNeedle(filter.value);
      return needles.every((needle) => haystack.includes(needle));
    }
    case "not":
      if (filter.operator === "is" && filter.value === null) {
        return current !== null;
      }
      return true;
  }
}

function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === "(") depth++;
    if (c === ")") depth = Math.max(0, depth - 1);
    if (c === "," && depth === 0) {
      parts.push(input.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(input.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseValue(raw: string): unknown {
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function parseOrFilter(filter: string): Filter[] {
  return splitTopLevel(filter).flatMap<Filter>((term) => {
    const match = term.match(/^([^.]+)\.(eq|neq|is|in)\.(.*)$/);
    if (!match) return [];
    const [, column, op, raw] = match;
    if (op === "in") {
      const inside = raw.startsWith("(") && raw.endsWith(")")
        ? raw.slice(1, -1)
        : raw;
      return [{ kind: "in", column, values: splitTopLevel(inside).map(parseValue) }];
    }
    return [{ kind: op as "eq" | "neq" | "is", column, value: parseValue(raw) }];
  });
}

function projectRows(rows: Row[], selectColumns: string | null): Row[] {
  if (!selectColumns || selectColumns.trim() === "*") return clone(rows);
  const columns = splitTopLevel(selectColumns).map((c) => c.trim()).filter(Boolean);
  return rows.map((row) => {
    const out: Row = {};
    for (const column of columns) out[column] = row[column];
    return out;
  });
}

function findConflictRow(rows: Row[], input: Row, columns: string[]): Row | undefined {
  return rows.find((row) =>
    columns.every((column) => row[column] === input[column]),
  );
}

function cascadeDelete(table: string, removed: Row[]): void {
  const ids = removed.map((r) => r.id).filter((id): id is string => typeof id === "string");
  if (ids.length === 0) return;

  const removeBy = (childTable: string, column: string, values: string[]) => {
    const rows = tableRows(childTable);
    const gone = rows.filter((row) => values.includes(row[column] as string));
    store.tables[childTable] = rows.filter((row) => !values.includes(row[column] as string));
    if (gone.length) cascadeDelete(childTable, gone);
  };

  switch (table) {
    case "projects":
      removeBy("documents", "project_id", ids);
      removeBy("project_subfolders", "project_id", ids);
      removeBy("chats", "project_id", ids);
      removeBy("tabular_reviews", "project_id", ids);
      break;
    case "project_subfolders":
      removeBy("project_subfolders", "parent_folder_id", ids);
      for (const doc of tableRows("documents")) {
        if (ids.includes(doc.folder_id as string)) doc.folder_id = null;
      }
      break;
    case "documents":
      removeBy("document_versions", "document_id", ids);
      removeBy("document_edits", "document_id", ids);
      removeBy("tabular_cells", "document_id", ids);
      break;
    case "chats":
      removeBy("chat_messages", "chat_id", ids);
      break;
    case "chat_messages":
      for (const edit of tableRows("document_edits")) {
        if (ids.includes(edit.chat_message_id as string)) edit.chat_message_id = null;
      }
      break;
    case "tabular_reviews":
      removeBy("tabular_cells", "review_id", ids);
      removeBy("tabular_review_chats", "review_id", ids);
      break;
    case "tabular_review_chats":
      removeBy("tabular_review_chat_messages", "chat_id", ids);
      break;
    case "workflows":
      removeBy("workflow_shares", "workflow_id", ids);
      removeBy("hidden_workflows", "workflow_id", ids);
      break;
  }
}

class LocalQuery implements PromiseLike<QueryResult> {
  private operation: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private selectColumns: string | null = null;
  private countMode: "exact" | null = null;
  private head = false;
  private filters: Filter[] = [];
  private orFilters: Filter[] = [];
  private orderBy: { column: string; ascending: boolean; nullsFirst: boolean }[] = [];
  private maxRows: number | null = null;
  private singleMode: "single" | "maybeSingle" | null = null;
  private payload: Row | Row[] | null = null;
  private upsertOptions: { onConflict?: string; ignoreDuplicates?: boolean } = {};

  constructor(private table: string) {}

  select(columns = "*", options?: { count?: "exact"; head?: boolean }): this {
    this.operation = this.operation === "insert" || this.operation === "update" || this.operation === "upsert"
      ? this.operation
      : "select";
    this.selectColumns = columns;
    this.countMode = options?.count ?? null;
    this.head = !!options?.head;
    return this;
  }

  insert(payload: Row | Row[]): this {
    this.operation = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: Row): this {
    this.operation = "update";
    this.payload = payload;
    return this;
  }

  upsert(payload: Row | Row[], options?: { onConflict?: string; ignoreDuplicates?: boolean }): this {
    this.operation = "upsert";
    this.payload = payload;
    this.upsertOptions = options ?? {};
    return this;
  }

  delete(): this {
    this.operation = "delete";
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  neq(column: string, value: unknown): this {
    this.filters.push({ kind: "neq", column, value });
    return this;
  }

  is(column: string, value: unknown): this {
    this.filters.push({ kind: "is", column, value });
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push({ kind: "in", column, values });
    return this;
  }

  contains(column: string, value: unknown): this {
    this.filters.push({ kind: "contains", column, value });
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    this.filters.push({ kind: "not", column, operator, value });
    return this;
  }

  or(filter: string): this {
    this.orFilters.push(...parseOrFilter(filter));
    return this;
  }

  order(
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean },
  ): this {
    this.orderBy.push({
      column,
      ascending: options?.ascending ?? true,
      nullsFirst: options?.nullsFirst ?? true,
    });
    return this;
  }

  limit(count: number): this {
    this.maxRows = count;
    return this;
  }

  single(): this {
    this.singleMode = "single";
    return this;
  }

  maybeSingle(): this {
    this.singleMode = "maybeSingle";
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<QueryResult | TResult> {
    return this.execute().catch(onrejected);
  }

  private rowMatches(row: Row): boolean {
    if (!this.filters.every((filter) => matchesFilter(row, filter))) return false;
    if (this.orFilters.length === 0) return true;
    return this.orFilters.some((filter) => matchesFilter(row, filter));
  }

  private filteredRows(): Row[] {
    let rows = tableRows(this.table).filter((row) => this.rowMatches(row));
    for (const order of [...this.orderBy].reverse()) {
      rows = rows.slice().sort((a, b) => {
        const av = a[order.column] as string | number | null | undefined;
        const bv = b[order.column] as string | number | null | undefined;
        const aNull = av === null || av === undefined;
        const bNull = bv === null || bv === undefined;
        if (aNull || bNull) {
          if (aNull && bNull) return 0;
          const nullFirst = order.nullsFirst ? -1 : 1;
          return aNull ? nullFirst : -nullFirst;
        }
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return order.ascending ? cmp : -cmp;
      });
    }
    if (this.maxRows != null) rows = rows.slice(0, this.maxRows);
    return rows;
  }

  private format(rows: Row[], totalCount?: number): QueryResult {
    const count = this.countMode === "exact" ? (totalCount ?? rows.length) : null;
    if (this.head) return { data: null as any, error: null, count };

    const projected = projectRows(rows, this.selectColumns);
    if (this.singleMode === "maybeSingle") {
      if (projected.length > 1) {
        return { data: null as any, error: { message: "Expected zero or one row" }, count };
      }
      return { data: ((projected[0] as LooseData | undefined) ?? null) as any, error: null, count };
    }
    if (this.singleMode === "single") {
      if (projected.length !== 1) {
        return { data: null as any, error: { message: "Expected exactly one row" }, count };
      }
      return { data: projected[0] as LooseData, error: null, count };
    }
    return { data: projected as LooseData, error: null, count };
  }

  private async execute(): Promise<QueryResult> {
    try {
      const rows = tableRows(this.table);
      let affected: Row[] = [];
      let totalCount: number | undefined;

      if (this.operation === "select") {
        const allMatches = rows.filter((row) => this.rowMatches(row));
        totalCount = allMatches.length;
        affected = this.filteredRows();
      } else if (this.operation === "insert") {
        const inputs = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
        affected = inputs.map((input) => buildRow(this.table, input));
        rows.push(...affected);
        saveStore();
      } else if (this.operation === "upsert") {
        const inputs = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
        const conflictColumns = (this.upsertOptions.onConflict ?? "id")
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean);
        for (const input of inputs) {
          const cleaned = cleanInput(input);
          const existing = findConflictRow(rows, cleaned, conflictColumns);
          if (existing) {
            if (!this.upsertOptions.ignoreDuplicates) {
              Object.assign(existing, cleaned);
              if ("updated_at" in existing && !("updated_at" in cleaned)) {
                existing.updated_at = nowIso();
              }
            }
            affected.push(existing);
          } else {
            const row = buildRow(this.table, cleaned);
            rows.push(row);
            affected.push(row);
          }
        }
        saveStore();
      } else if (this.operation === "update") {
        const cleaned = cleanInput((this.payload ?? {}) as Row);
        affected = rows.filter((row) => this.rowMatches(row));
        for (const row of affected) Object.assign(row, cleaned);
        if (affected.length) saveStore();
      } else if (this.operation === "delete") {
        affected = rows.filter((row) => this.rowMatches(row));
        store.tables[this.table] = rows.filter((row) => !this.rowMatches(row));
        cascadeDelete(this.table, affected);
        if (affected.length) saveStore();
      }

      return this.format(affected, totalCount);
    } catch (error) {
      return {
        data: null as any,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}

function decodeTokenEmail(token: string): string {
  if (!token.startsWith(`${DEFAULT_LOCAL_USER_ID}:`)) return DEFAULT_LOCAL_USER_EMAIL;
  const encoded = token.slice(DEFAULT_LOCAL_USER_ID.length + 1);
  try {
    return decodeURIComponent(encoded).trim().toLowerCase() || DEFAULT_LOCAL_USER_EMAIL;
  } catch {
    return DEFAULT_LOCAL_USER_EMAIL;
  }
}

export function getLocalUserFromToken(token: string): { id: string; email: string } {
  return {
    id: DEFAULT_LOCAL_USER_ID,
    email: decodeTokenEmail(token),
  };
}

export function ensureLocalUser(id = DEFAULT_LOCAL_USER_ID, email = DEFAULT_LOCAL_USER_EMAIL): void {
  const cleanEmail = email.trim().toLowerCase() || DEFAULT_LOCAL_USER_EMAIL;
  const now = nowIso();
  const existingUser = store.users.find((u) => u.id === id);
  if (existingUser) {
    existingUser.email = cleanEmail;
    existingUser.updated_at = now;
  } else {
    store.users.push({ id, email: cleanEmail, created_at: now, updated_at: now });
  }

  const profiles = tableRows("user_profiles");
  const existingProfile = profiles.find((p) => p.user_id === id);
  if (!existingProfile) {
    profiles.push(buildRow("user_profiles", { user_id: id }));
  }
  saveStore();
}

ensureLocalUser();

export function createServerSupabase() {
  return {
    from(table: string) {
      return new LocalQuery(table);
    },
    auth: {
      async getUser(token: string) {
        const user = getLocalUserFromToken(token);
        ensureLocalUser(user.id, user.email);
        return { data: { user }, error: null as { message: string } | null };
      },
      admin: {
        async listUsers(_options?: { perPage?: number }) {
          return {
            data: { users: clone(store.users) },
            error: null as { message: string } | null,
          };
        },
        async deleteUser(userId: string) {
          const removeUserRows = (table: string) => {
            const rows = tableRows(table);
            const removed = rows.filter((row) => row.user_id === userId);
            store.tables[table] = rows.filter((row) => row.user_id !== userId);
            if (removed.length) cascadeDelete(table, removed);
          };
          store.users = store.users.filter((u) => u.id !== userId);
          for (const table of TABLES) removeUserRows(table);
          saveStore();
          ensureLocalUser();
          return { data: {}, error: null as { message: string } | null };
        },
      },
    },
  };
}

export async function getUserIdFromRequest(req: Request): Promise<string> {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    throw new Response("Missing or invalid Authorization header", { status: 401 });
  }
  const token = auth.slice(7).trim();
  const user = getLocalUserFromToken(token);
  ensureLocalUser(user.id, user.email);
  return user.id;
}

export type LocalSupabaseClient = ReturnType<typeof createServerSupabase>;
