# Mike (local-only fork)

A fully local fork of [willchen96/mike](https://github.com/willchen96/mike) — all credit to Will for the original project, which is genuinely awesome.

This fork swaps out the cloud dependencies (Supabase Postgres, Supabase Auth, Cloudflare R2) for local equivalents — a JSON file for state and the local filesystem for document storage. Nothing leaves your machine except calls to the LLM provider you configure.

**Why?** I'm a personal injury lawyer. I sometimes work with contracts, settlement docs, and client materials I'd rather not push to a third-party cloud bucket while I'm just experimenting with a tool. This version lets you kick the tires entirely on your own laptop. If you want the full multi-user / production setup, use Will's upstream repo — it's the right tool for that job.

Licensed AGPL-3.0 (same as upstream).

---

Open-source release containing the Mike frontend and backend.

## Contents

- `frontend/` - Next.js application
- `backend/` - Express API, local persistence, local document storage, and document processing
- `backend/migrations/000_one_shot_schema.sql` - historical Supabase schema kept for reference

## Setup

Install dependencies:

```bash
npm install --prefix backend
npm install --prefix frontend
```

Create local env files from the examples:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Add at least one LLM API key to `backend/.env`.

For Claude models:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

For Gemini models:

```bash
GEMINI_API_KEY=...
```

Start the backend:

```bash
npm run dev --prefix backend
```

Start the frontend:

```bash
npm run dev --prefix frontend
```

Open `http://localhost:3000`.

## Optional: Route Mike Through Hey Jude

Mike can send prompts through [Hey Jude](https://github.com/nickwatson/hey-jude) before they reach Claude or Gemini. Hey Jude runs locally, uses Ollama plus `qwen3.5:4b` by default to pseudonymize sensitive entities, and then forwards the sanitized prompt to the provider.

Start Hey Jude first:

```bash
git clone https://github.com/nickwatson/hey-jude.git
cd hey-jude
ollama pull qwen3.5:4b
cp .env.example .env
docker compose up --build
```

Then enable it in `backend/.env`:

```bash
HEY_JUDE_ENABLED=true
HEY_JUDE_BASE_URL=http://localhost:4005
HEY_JUDE_API_KEY=sk-heyjude-dev
```

Start Mike normally after that. The browser still uses `http://localhost:3000`, and the backend still uses your configured Claude or Gemini model; Hey Jude sits between Mike and the model provider.

Hey Jude reduces what leaves your machine for the LLM provider. Mike still stores your original chat text in the local JSON database listed below.

## Local Data

- JSON database: `backend/data/local-db.json`
- Document bytes: `backend/data/storage/`
- Default local user: `local@mike.local`

No Supabase database, Supabase Auth project, or R2/S3 bucket is required.

## Required Services

- Anthropic API key for Claude models, or a Gemini API key for Gemini models
- LibreOffice for DOC/DOCX to PDF conversion
- Optional Hey Jude gateway if you want local pseudonymization before provider calls

## Checks

```bash
npm run build --prefix backend
npm run build --prefix frontend
npm run lint --prefix frontend
```

## License

AGPL-3.0-only. See `LICENSE`.
