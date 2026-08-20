# Finax for LinkedIn

Reads the LinkedIn page you are looking at, picks out the posts about currency
risk, and sends them to the outreach waiting room in your admin console so Finax
can draft a reply for each one.

It only reads what is already on your screen. It does not log in, does not
scroll for you, and does not open anybody's profile. You scroll LinkedIn the way
you normally would; it reads what loads.

## Before you start

This runs against LinkedIn's User Agreement (section 8.2 prohibits automated
collection). The realistic risk is a restriction on **your** LinkedIn account,
not a legal one. Reading a page you already loaded is the quietest possible
version of this, but it is not zero. You know that; it is your account.

## Step 1 — open the extensions page

Open Chrome. In the address bar type `chrome://extensions` and press Enter.

## Step 2 — turn on Developer mode

Top right of that page there is a switch labelled **Developer mode**. Click it so
it turns blue.

## Step 3 — load the extension

Click **Load unpacked** (top left). A file picker opens. Navigate to this folder:

    /Users/anthony/MYWORK/BlockFinaXcode/extension

Select the `extension` folder itself — not a file inside it — and click **Select**.

"Finax for LinkedIn" now appears in the list.

## Step 4 — pin it

Click the puzzle-piece icon in Chrome's toolbar (top right), find "Finax for
LinkedIn", and click the pin next to it. Its icon now sits in your toolbar.

## Step 5 — create the extension's token

The admin console issues 8-hour sessions, which would mean re-pasting a token
into the extension twice a day. So the extension uses its own long-lived token
instead.

In Railway → your service → **Variables** → **New Variable**:

- Name: `OUTREACH_INGEST_TOKEN`
- Value: any long random string (40+ characters)

Keep a copy — you need it in the next step. This token can only add drafts to
your waiting room. It cannot read your book, approve anything, or reach any
other admin endpoint, which is why it is safe to keep in a browser extension.

## Step 6 — set your server and token

Click the Finax icon. Fill in:

- **BlockFinaX server** — `https://blockfinax.com`
- **Admin token** — the value you set as `OUTREACH_INGEST_TOKEN` in Railway
  (see below). Not your admin console login — that one expires every 8 hours.
- **Draft as** — Reply, Connection request, or Direct message
- Leave **Send automatically** unticked to start with

Click **Save**.

## Step 7 — use it

Go to LinkedIn. Scroll your feed, or search something like
`cedi depreciation importers` and open the **Posts** tab.

A small dark bar appears at the bottom right saying how many posts it has read.
When you have scrolled enough, click **Send to Finax**.

It will tell you how many were relevant and how many drafts it made — most posts
in a feed are not about currency, and those are skipped rather than drafted.

## Step 8 — read the drafts

Open your admin console → **Agent** → **Outreach**. Every draft is there with a
link to the original post. Edit anything you want, copy it, and post it yourself.

Nothing is ever posted to LinkedIn by this tool. It writes drafts; you send them.

## If nothing appears

- **No bar at the bottom right** — LinkedIn renamed its CSS classes again.
  Tell Claude and the selectors in `content.js` get updated.
- **"Server or token not set"** — go back to Step 6.
- **"Server said 401"** — the token does not match `OUTREACH_INGEST_TOKEN`
  in Railway, or that variable was never set.
- **"Nothing relevant in 40 posts"** — working as intended. Search for something
  closer to the subject; a general feed rarely mentions currency risk.

---

# Giving Finax send power

Finax can post comments to LinkedIn for you, through LinkedIn's own API. This is
separate from the extension and does not use it.

It is worth being clear about why this route and not the extension. The
extension reads. Posting is the line LinkedIn actually enforces, and automating
a browser to type into a comment box is the pattern they ban for. Going through
their API means you grant permission on LinkedIn's own consent screen, they can
see and rate limit every call, and if they ever object they revoke the token
rather than your account.

## Step 1 — create a LinkedIn app

Go to https://www.linkedin.com/developers/apps and click **Create app**.

- **App name**: BlockFinaX
- **LinkedIn Page**: your BlockFinaX company page (you need one; create it first
  if you have not)
- **App logo**: any image
- Tick the legal agreement, then **Create app**

## Step 2 — verify the app

On the app's **Settings** tab there is a **Verify** button. Click it, copy the
link it gives you, and open that link yourself. It confirms you control the
company page. This takes about a minute.

## Step 3 — request the products

Go to the **Products** tab and request:

- **Sign In with LinkedIn using OpenID Connect**
- **Share on LinkedIn**

Both are self-serve and usually approve within a few minutes. "Share on
LinkedIn" is the one that carries `w_member_social`, the permission that lets
Finax comment as you.

## Step 4 — set the redirect URL

Go to the **Auth** tab. Under **OAuth 2.0 settings**, find **Authorized redirect
URLs for your app** and add **both** of these:

    https://blockfinax.com/api/outreach/linkedin/callback
    https://www.blockfinax.com/api/outreach/linkedin/callback

Click **Update**.

LinkedIn matches these character for character. A missing `www`, an extra slash
on the end, or `http` instead of `https` all fail with the same unhelpful
message: *"The redirect_uri does not match the registered value"*. It does not
tell you what it expected or what it received, which is why both forms are
listed here.

If it still fails, open the console strip and click **Connection failing?**. It
shows the exact URL this server sends, with a copy button, so you can paste it
into LinkedIn rather than retype it.

## Step 5 — copy the keys into Railway

Still on the **Auth** tab, copy the **Client ID** and **Client Secret**.

In Railway, go to your service, then **Variables**, and add:

- `LINKEDIN_CLIENT_ID` — the Client ID
- `LINKEDIN_CLIENT_SECRET` — the Client Secret

Railway redeploys itself.

## Step 6 — connect the account

Open your admin console, go to **Agent**, then **Outreach**. At the top there is
a strip that now says "Connect LinkedIn". Click it. LinkedIn asks whether you
allow BlockFinaX to post on your behalf. Say yes.

The strip changes to "Finax can post as Anthony Kumako".

## Step 7 — post a comment

Each waiting draft now has a **Post to LinkedIn** button. Read the draft, edit
it if you want, then click it. It asks you to confirm, then publishes.

Once posted the draft is marked **posted by Finax** and cannot be posted twice.

## What it will not do

- It never posts on its own. Every comment is one button press by you.
- It never posts in bulk. One draft, one click.
- Connection notes and direct messages have no API route, so those still have to
  be sent by hand. The button does not appear on them.
- The token lasts about two months. When it expires the strip says so and you
  click Connect again.
