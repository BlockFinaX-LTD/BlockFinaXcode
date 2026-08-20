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

## Step 5 — set your server and token

Click the Finax icon. Fill in:

- **BlockFinaX server** — `https://blockfinax.com`
- **Admin token** — the same `ADMIN_TOKEN` you use for the admin console
- **Draft as** — Reply, Connection request, or Direct message
- Leave **Send automatically** unticked to start with

Click **Save**.

## Step 6 — use it

Go to LinkedIn. Scroll your feed, or search something like
`cedi depreciation importers` and open the **Posts** tab.

A small dark bar appears at the bottom right saying how many posts it has read.
When you have scrolled enough, click **Send to Finax**.

It will tell you how many were relevant and how many drafts it made — most posts
in a feed are not about currency, and those are skipped rather than drafted.

## Step 7 — read the drafts

Open your admin console → **Agent** → **Outreach**. Every draft is there with a
link to the original post. Edit anything you want, copy it, and post it yourself.

Nothing is ever posted to LinkedIn by this tool. It writes drafts; you send them.

## If nothing appears

- **No bar at the bottom right** — LinkedIn renamed its CSS classes again.
  Tell Claude and the selectors in `content.js` get updated.
- **"Server or token not set"** — go back to Step 5.
- **"Server said 401"** — the admin token is wrong.
- **"Nothing relevant in 40 posts"** — working as intended. Search for something
  closer to the subject; a general feed rarely mentions currency risk.
