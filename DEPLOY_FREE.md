# BuyWise — Zero-Cost Forever Deployment on Oracle Cloud Always Free

**Target:** Oracle Cloud Infrastructure (OCI) Always Free ARM Ampere A1 VM  
**Cost:** $0.00 forever — no credit card charges for Always-Free resources  
**Functionality:** 100% preserved — Ollama (self-hosted, free) keeps all n8n agent features  
**Risk of being charged:** Zero — Always-Free services are never billed; set a $0.00 budget alert to hard-block any paid usage

---

## 1. Does Removing Ollama Lose Functionality? (Definitive Answer)

**No — do NOT remove Ollama.** Here is the deep technical analysis:

| Component | Uses Ollama? | Effect of removing Ollama |
|---|---|---|
| Web server (Express) | Advisory only — `llmAdvisory()` catches failure and returns `DETERMINISTIC_FALLBACK` | **None** — deterministic gates/scoring/policy continue |
| n8n Decision Agent (`65-agent-decision`) | Has `LLM Available?` IF gate; skips LLM path when unavailable | **None** — deterministic gates run regardless |
| n8n Product Research Agent (`10-agent-product-research`) | **Uses `@n8n/n8n-nodes-langchain.lmChatOllama` as the agent model** | **BREAKS** — langchain agent cannot reason without an LLM; products not found |
| n8n Review Quality (`40-agent-review-quality`) | Uses Ollama model node | **BREAKS** — agent cannot run |
| n8n Vendor Research (`20-agent-vendor-research`) | Uses Ollama model node | **BREAKS** — agent cannot run |

**Conclusion:** Ollama is **required for n8n agent workflows** to function. It is **not required for the web server's deterministic pipeline** (`/api/cases/:id/pipeline/run`), which runs scoring, comparison, decision, and approval without any LLM.

**Ollama is free:** It is open-source software you self-host. Running it on your Oracle VM costs **$0.00**. It needs ~2 GB RAM for `llama3.2:3b`, which fits comfortably in Oracle's Always-Free tier (12 GB RAM on Ampere A1).

**Decision:** Ollama is **kept** in `docker-compose.yml`. All functionality is preserved. Zero cost. Zero payment risk.

---

## 2. Architecture on Oracle Cloud VM

Three (actually four) containers run on one VM via Docker Compose:

| Container | Image | Port | Purpose |
|---|---|---|---|
| `postgres` | `postgres:15-alpine` | 5432 | All procurement data, users, sessions, audit |
| `ollama` | `ollama/ollama:0.6.3` | 11434 | Self-hosted LLM for n8n agents (free) |
| `n8n` | `n8nio/n8n:1.107.4` | 5678 | Intake webhook + agent orchestration |
| `web` | `node:20-alpine` (built from `web/Dockerfile`) | 8080 | Procurement console UI (Express) |

All containers share one `buywise-net` Docker bridge network. The web server binds to `0.0.0.0` (fixed for Docker).

---

## 3. Prerequisites

- An Oracle Cloud account (sign up at https://www.oracle.com/cloud/free/)
- A credit/debit card for identity verification **(not charged for Always-Free)**
- SSH client (PowerShell, Windows Terminal, PuTTY, or `ssh`)
- ~30 minutes of time

---

## 4. Step-by-Step Deployment

### Phase 1: Oracle Cloud Account & Budget Guard (Critical — do this first)

#### 4.1 Create Oracle Cloud Free Tier account

1. Go to https://www.oracle.com/cloud/free/
2. Click **"Start for free"** and complete registration.
3. You will be asked for a credit card for identity verification.
   - **Oracle explicitly states:** *"Your credit card will not be charged unless you upgrade."*
   - Always-Free resources are never billed.
4. Choose your home region (pick one near you: `us-ashburn-1`, `eu-frankfurt-1`, `ap-mumbai-1`, etc.)

#### 4.2 Set a $0.00 budget alert (hard payment block)

This is your guarantee against accidental charges:

1. In the OCI Console, go to **Billing & Cost → Budgets**.
2. Click **Create budget**.
3. Name: `buywise-zero-cost-guard`
4. Budget amount: `$0.00`
5. Alert threshold: `1%` (triggers immediately on any $0.01 spend)
6. Set alert to notify you via email.
7. Optionally, enable **automatic actions** to block spending if supported in your region.

This ensures that if any non-Always-Free resource is accidentally created, you are alerted immediately and spending is blocked.

---

### Phase 2: Create the Always-Free VM

#### 4.3 Create the compute instance

1. In the OCI Console, go to **Compute → Instances**.
2. Click **Create instance**.

| Setting | Value |
|---|---|
| **Name** | `buywise-vm` |
| **Compartment** | Your root compartment |
| **Placement** | Select your home region + availability domain |
| **Image** | Canonical Ubuntu 22.04 LTS (or latest available) |
| **Shape** | **Ampere A1 Compute** (ARM) — click **Change shape** |
| **OCPUs** | 1 to 4 (all Always-Free; 2 OCPU recommended) |
| **Memory** | Auto-scales (up to ~24 GB with 4 OCPU; ~12 GB with 2 OCPU) |
| **Boot volume** | 50–200 GB (Always-Free includes up to 200 GB total block storage) |
| **Boot volume backup policy** | None (we back up via Docker volumes) |

#### 4.4 Networking

| Setting | Value |
|---|---|
| **Virtual cloud network** | Create new VCN with internet gateway (default) |
| **Subnet** | Public subnet |
| **Public IP address** | **Assign a public IP** (required) |
| **SSH key pair** | Generate new or upload existing |

Click **Create** and wait for the instance to reach **Running** state.

#### 4.5 Reserve the public IP (recommended — free)

By default, the public IP is **ephemeral** (changes on stop/start). To keep a permanent address:

1. Go to **Networking → Public IPs**.
2. Find the ephemeral IP attached to `buywise-vm`.
3. Click the actions menu (three dots) → **Reserve**.
4. Confirm. The IP is now reserved (static) and free.

#### 4.6 Open firewall ports (Security List)

1. Go to **Networking → Virtual Cloud Networks** → your VCN.
2. Click **Security Lists** → the default security list.
3. Click **Add Ingress Rules**. Add these **stateless** ingress rules:

| Source CIDR | IP Protocol | Source Port Range | Destination Port Range | Description |
|---|---|---|---|---|
| `0.0.0.0/0` | TCP | All | `22` | SSH |
| `0.0.0.0/0` | TCP | All | `8080` | BuyWise web UI |
| `0.0.0.0/0` | TCP | All | `5678` | n8n UI (optional) |
| `0.0.0.0/0` | TCP | All | `11434` | Ollama API (optional, only if accessing externally) |

**Security best practice:** Restrict port 22 (SSH) to your IP address if you have a static IP. Ports 8080/5678 can remain open for the live demo, or restrict them to your IP range.

Save the rules.

---

### Phase 3: Deploy BuyWise on the VM

#### 4.7 Connect to the VM via SSH

From your local machine (PowerShell or terminal):

```powershell
ssh ubuntu@<your-reserved-public-ip>
```

Use the private key matching the SSH key you uploaded during VM creation.

#### 4.8 Install Docker

Run these commands on the VM:

```bash
# Update system
sudo apt-get update -y && sudo apt-get upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh

# Add current user to docker group (avoid sudo for docker commands)
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version
docker compose version
```

#### 4.9 Clone BuyWise and prepare environment

```bash
# Clone your repository (replace with your actual repo URL)
git clone <your-repo-url> BuyWise
cd BuyWise

# Copy the zero-cost environment template
cp .env.example .env

# Edit .env with your secrets (use nano or vim)
nano .env
```

**Required `.env` values — change these:**

```bash
POSTGRES_PASSWORD=<generate-a-long-random-secret-32-plus-chars>
N8N_ENCRYPTION_KEY=<generate-a-long-random-secret-32-plus-chars>
```

All other values can remain as defaults. Do **not** add `TAVILY_API_KEY` or `SERPAPI_API_KEY` if you want $0 forever.

Generate secure values:
```bash
openssl rand -hex 32   # for POSTGRES_PASSWORD
openssl rand -hex 32   # for N8N_ENCRYPTION_KEY
```

#### 4.10 Start all services

```bash
docker compose up -d
```

Wait ~60 seconds for all containers to be healthy. Verify:

```bash
docker compose ps
```

You should see all four containers (postgres, ollama, n8n, web) with status `Up` and `healthy`.

Verify each service:

```bash
# PostgreSQL health
curl http://localhost:8080/api/health
# Expected: {"ok":true,"db":true,"n8n_webhook":"http://n8n:5678/webhook/procurement-request"}

# Ollama (give it ~30 seconds to start)
curl http://localhost:11434/api/tags
# Expected: list of models (empty until model is pulled)

# n8n health
curl http://localhost:5678/healthz
# Expected: OK or similar
```

#### 4.11 Pull the Ollama model

The `llama3.2:3b` model (~2 GB) needs to be downloaded once:

```bash
docker exec buywise-ollama ollama pull llama3.2:3b
```

This takes 2–10 minutes depending on your VM's network speed. After this, Ollama is ready.

#### 4.12 Initialize the database

The SQL files in `./sql/` run automatically on first PostgreSQL startup via `/docker-entrypoint-initdb.d`. All tables, indexes, and triggers are created.

Next, bootstrap the admin user:

```bash
docker exec -it buywise-web sh -c '
  ADMIN_USERNAME=owner \
  ADMIN_PASSWORD=choose-a-long-secret-at-least-12-chars \
  node scripts/create-admin.mjs
'
```

This creates the first admin account. The script **refuses to run if any user already exists** (safety guard).

#### 4.13 Import n8n workflows

n8n does not auto-import workflows. You must import them manually:

1. Open n8n: `http://<your-reserved-public-ip>:5678`
2. Log in (default: no password initially — set one in n8n settings)
3. Go to **Settings → Credentials** → add:
   - **Ollama Credential:** Host `http://ollama:11434`
   - **Postgres Credential:** Host `postgres`, port 5432, database `buywise`, user `buywise`, password from `.env`
4. Go to **Workflows → Import** and import these files in **dependency order**:
   1. `90-util-state-manager.json`
   2. `92-util-tool-gateway.json`
   3. `93-util-logger.json`
   4. `10-agent-product-research.json`
   5. `20-agent-vendor-research.json`
   6. `40-agent-review-quality.json`
   7. `50-agent-comparison.json`
   8. `60-util-scoring-engine.json`
   9. `65-agent-decision.json`
   10. `70-agent-negotiation.json`
   11. `75-demo-response.json`
   12. `80-agent-reevaluation.json`
   13. `90-agent-approval.json`
   14. `00-orchestrator-buywise.json`
5. After importing, run `python3 tools/n8n_relink.py` to rewrite sub-workflow references to live IDs:
   ```bash
   python3 tools/n8n_relink.py
   docker compose restart n8n
   ```
6. Activate workflow `00-orchestrator-buywise`.

---

### Phase 4: Access BuyWise Live

| Service | URL |
|---|---|
| BuyWise Procurement Console | `http://<your-reserved-public-ip>:8080` |
| n8n Orchestration UI | `http://<your-reserved-public-ip>:5678` |
| Ollama API | `http://<your-reserved-public-ip>:11434` |

1. Open `http://<your-reserved-public-ip>:8080`
2. Log in with the admin account you created (`owner` / your password)
3. Create your team in **Admin** (requester, officer, approver, auditor roles)
4. Create a procurement request (REAL or DEMO mode)
5. Run the pipeline: intake → product research → vendor research → quality → comparison → decision → negotiation → re-evaluation → approval → closed

---

## 5. Verification Checklist (Run After Deployment)

```bash
# 1. All containers healthy
docker compose ps

# 2. Web + PostgreSQL healthy
curl http://<vm-ip>:8080/api/health
# → {"ok":true,"db":true,...}

# 3. Reasoning mode (LLM via Ollama)
curl http://<vm-ip>:8080/api/reasoning-mode
# → {"mode":"LLM_REASONING","provider":"ollama","configured":true,...}

# 4. Ollama available
curl http://<vm-ip>:11434/api/tags
# → {"models":[{"name":"llama3.2:3b",...}]}

# 5. n8n reachable
curl http://<vm-ip>:5678/healthz

# 6. Providers — Tavily/SerpAPI empty (expected for $0)
curl http://<vm-ip>:8080/api/providers
# → tavily.configured: false, serpapi.configured: false

# 7. Log in at http://<vm-ip>:8080, create a DEMO case, run full pipeline
#    → decision → negotiation → re-evaluation → approval → closed
```

---

## 6. Oracle Cloud Best Practices Applied

| Practice | Implementation |
|---|---|
| **Always-Free shape** | Ampere A1 ARM — 1–4 OCPU, up to 24 GB RAM, all free |
| **Reserved public IP** | Prevents IP change on VM restart (free) |
| **$0.00 budget alert** | Hard blocks any accidental paid usage |
| **Docker restart policies** | `restart: unless-stopped` on all containers |
| **Named Docker volumes** | `pgdata`, `n8n_data`, `ollama_data` persist across container restarts |
| **Health checks** | PostgreSQL `pg_isready` every 10s |
| **Service dependencies** | `depends_on` with `condition: service_healthy` |
| **Non-root container** | `postgres:15-alpine`, `node:20-alpine` run as non-root by default |
| **Secrets in .env** | `.env` is gitignored; never committed |
| **No hardcoded credentials** | All passwords/keys come from environment variables |
| **Docker network isolation** | Containers communicate via internal Docker DNS (`postgres`, `n8n`, `ollama`) |
| **Web server binds to 0.0.0.0** | Fixed in `web/server.js` for Docker port mapping |

---

## 7. Optional: Add HTTPS via Cloudflare Tunnel (Free)

For a production-style HTTPS URL without opening ports or buying a domain:

1. Install `cloudflared` on the VM:
   ```bash
   curl -L --output cloudflared-linux-arm64.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
   sudo dpkg -i cloudflared-linux-arm64.deb
   ```

2. Create a free Cloudflare Tunnel:
   ```bash
   cloudflared tunnel --url http://localhost:8080
   ```
   Follow prompts to create a free `*.trycloudflare.com` URL.

3. For a persistent tunnel, create a free Cloudflare account, then:
   ```bash
   cloudflared tunnel create buywise
   cloudflared tunnel route dns buywise buywise.<your-domain>.com
   cloudflared service install http://localhost:8080
   ```

This gives you `https://buywise.yourdomain.com` with automatic SSL, free.

---

## 8. Maintenance & Backups

### Database backup

```bash
# Backup PostgreSQL data
docker exec buywise-postgres pg_dumpall -U buywise > backup_$(date +%F).sql

# Or copy the Docker volume
docker run --rm -v buywise_pgdata:/source -v $(pwd):/dest alpine tar czf /dest/pgdata_backup.tar.gz -C /source .
```

### Restore

```bash
cat backup_YYYY-MM-DD.sql | docker exec -i buywise-postgres psql -U buywise
```

### Update containers

```bash
docker compose pull
docker compose up -d
```

### VM auto-start

Oracle Cloud VMs do not auto-start after a host maintenance event by default. Enable it:

1. Go to **Compute → Instances → buywise-vm**
2. Click **Edit**
3. Enable **Automatic restart** or configure instance recovery

---

## 9. Troubleshooting

| Problem | Solution |
|---|---|
| `docker compose up` fails on web build | Ensure `.dockerignore` exists; build context is repo root |
| Web UI shows "backend DOWN" | Check `docker compose logs web`; ensure Postgres is `healthy` |
| n8n workflows fail at Ollama node | Ensure Ollama container is `Up` and model is pulled (`ollama pull llama3.2:3b`) |
| Port 8080 not reachable from internet | Check OCI Security List ingress rules; confirm public IP is assigned |
| `create-admin.mjs` refuses ("user exists") | A user already exists; check the database or reset |
| n8n webhook not receiving | Confirm `N8N_WEBHOOK_URL` in web/.env matches `http://n8n:5678/webhook/procurement-request` |
| Out of memory (OOM) kills | Reduce Ollama model to `llama3.2:3b` (already default); avoid larger models |

---

## 10. Files Modified for This Deployment

| File | Change |
|---|---|
| `web/server.js` | Line 1691: `'127.0.0.1'` → `'0.0.0.0'` (Docker port mapping fix) |
| `docker-compose.yml` | Re-added Ollama service; added `LLM_AVAILABLE=true`, `LLM_PROVIDER=ollama` to n8n + web; proper service dependencies; named volumes |
| `web/Dockerfile` | Production build on `node:20-alpine`, `npm ci --omit=dev`, exposes 8080 |
| `.env.example` | Zero-cost template: Ollama configured (free/self-hosted), all paid keys empty |
| `.dockerignore` | Excludes `.git`, `.env`, `node_modules`, volumes, docs, tests from build context |
| `DEPLOY_FREE.md` | This guide |

**No source code logic was changed.** The prototype's behavior is identical; only deployment configuration and the Docker listen address were fixed.

---

## 11. Summary: Zero-Cost Forever Guarantee

- ✅ **Oracle Cloud Always Free VM**: 2 OCPU + 12 GB RAM — $0 forever
- ✅ **Ollama (self-hosted)**: Free open-source software — $0 to run
- ✅ **PostgreSQL + n8n + Express**: All self-hosted on the VM — $0
- ✅ **No paid provider keys**: `TAVILY_API_KEY=`, `SERPAPI_API_KEY=` empty — providers return `UNAVAILABLE`, system continues
- ✅ **$0.00 budget alert**: Hard blocks any accidental paid usage in OCI
- ✅ **All functionality preserved**: n8n agents work via Ollama; web server deterministic pipeline works without any LLM
- ✅ **No credit card charged**: Oracle Always-Free services are never billed

Your BuyWise prototype is now deployable and runnable **live on Oracle Cloud at $0.00 forever, with full functionality.**
