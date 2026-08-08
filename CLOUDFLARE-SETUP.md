# 🔒 Protecting the dashboard with Cloudflare Access (free)

Goal: your team opens one link, signs in with their **work email**, and sees the dashboard.
Nobody else can reach it — and the underlying data never sits on the public internet.

**Cost:** free for up to 50 users. **Setup time:** ~15 minutes, once.

---

## How it works

```
Teammate  →  dashboard.<your-domain>  →  Cloudflare Access  →  Cloudflare Pages
                                          (email login)         (your files)
```

Cloudflare checks identity *before* serving anything. An unauthorized visitor never
receives `index.html` or `data.js` — they just get a login screen.

Your GitHub repo stays **private** the whole time.

---

## Before you start

You need a **domain name** (~$10/year, e.g. Namecheap or Cloudflare Registrar).

Cloudflare Access can't protect a bare `*.pages.dev` URL — that's the one real
prerequisite. If you'd rather not buy a domain, skip to
[Option B](#option-b-no-domain) at the bottom.

---

## Step 1 — Cloudflare account + domain

1. Sign up at **dash.cloudflare.com**
2. **Add a site** → enter your domain → **Free** plan
3. Cloudflare shows two nameservers. Copy them.
4. At your registrar, replace the nameservers with Cloudflare's.
   *(Propagation takes anywhere from minutes to a few hours.)*

---

## Step 2 — Deploy the dashboard to Cloudflare Pages

1. In Cloudflare: **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git**
2. Authorize GitHub, pick **Call-Eod-Stats-Dashboard**
3. Build settings — leave everything empty:

   | Field | Value |
   |---|---|
   | Framework preset | **None** |
   | Build command | *(blank)* |
   | Build output directory | `/` |

   The dashboard is plain HTML/JS — there is nothing to build.
4. **Save and Deploy** → you get `call-eod-stats-dashboard.pages.dev`

> ✅ Every `git push` now redeploys automatically. `publish.bat` keeps working exactly as-is.

---

## Step 3 — Put it on your domain

1. In your Pages project → **Custom domains** → **Set up a custom domain**
2. Enter e.g. `dashboard.yourdomain.com` → **Activate**

Cloudflare adds the DNS record for you.

---

## Step 4 — Turn on Access (the actual protection)

1. **Zero Trust** (left sidebar) → complete the one-time team-name setup, choose **Free**
2. **Access** → **Applications** → **Add an application** → **Self-hosted**
3. Fill in:

   | Field | Value |
   |---|---|
   | Application name | `Call EOD Dashboard` |
   | Session duration | `24 hours` (or `1 week`) |
   | Subdomain | `dashboard` |
   | Domain | `yourdomain.com` |

4. **Next** → add a policy:

   | Field | Value |
   |---|---|
   | Policy name | `Team` |
   | Action | **Allow** |
   | Include | **Emails** → list each teammate's email |

   > Prefer **Emails ending in** `@yourcompany.com` to admit the whole company.

5. **Next** → **Add application**

---

## Step 5 — Test it

1. Open the link in a **private/incognito window**
2. You should see a Cloudflare login page
3. Enter an allowed email → Cloudflare sends a **one-time code**
4. Enter the code → dashboard loads

If incognito shows the dashboard *without* asking for a code, the Access policy
isn't attached to the right hostname — recheck Step 4's subdomain/domain fields.

---

## Daily use

Nothing changes for you:

```
Double-click publish.bat
```

Sheets sync → git push → Cloudflare redeploys in ~30 seconds. Your team refreshes.

**Managing people**

- **Add someone:** Zero Trust → Access → Applications → your app → Policies → add their email
- **Remove someone:** delete their email from the policy — they're locked out immediately,
  no password to rotate for everyone else

---

## Option B — no domain

If you'd rather not buy a domain, use **Netlify** with **Password protection**
(Pro, $19/mo): drag the folder in, set one shared site password, share link + password.

Cheaper middle ground: **GitHub Pro** (~$4/mo) keeps the repo private and lets you
invite teammates as collaborators — they'd open the dashboard from the repo rather
than a public link.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Login page never appears | Access policy hostname doesn't match the custom domain |
| "This site can't be reached" | Nameservers haven't propagated — wait, then retry |
| Dashboard loads but data is stale | Hard-refresh `Ctrl+F5`; confirm the last push succeeded |
| Teammate gets "Access denied" | Their email isn't in the policy (watch for typos/aliases) |
| Pages build fails | Build command must be **empty**, output directory `/` |
