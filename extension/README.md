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

# Sending a comment

Finax carries the drafted comment to LinkedIn's comment box. You press Post.

## Why it works this way

LinkedIn does not let any application post a comment on someone else's post.
Their permission table suggests otherwise, but the endpoint itself is enforced
at `partnerApiSocialAction` and returns 403 ACCESS_DENIED unless your app is in
their partner programme, which takes an application and is rarely granted to a
small company. This is a wall, not a setting.

So the extension fills the box and you click Post. The submission stays a real
click on LinkedIn's own button. Nothing is automated, nothing drives your
session, and the typing is what gets removed.

Worth saying: even if the API route were open, a person between a draft and
something published in their own name is a good arrangement rather than a
compromise.

## How to use it

**Step 1.** Make sure the extension is installed and your token is set. See the
steps above.

**Step 2.** In the admin console, go to **Agent**, then **Outreach**.

**Step 3.** Find a draft you want to send. Read it. Edit it if you want.

**Step 4.** Click **Open and fill in**. The post opens in a new tab.

**Step 5.** Click into LinkedIn's comment box on that post. Finax fills in the
comment and a small bar says so at the bottom right.

**Step 6.** Read it once more, then press LinkedIn's **Post** button.

## What it will not do

- It never presses Post. That is always you.
- It only fills a box on a post you queued. Landing on any other post fills
  nothing.
- It never overwrites text you have already typed.
- Once filled, the draft leaves the queue. It is marked as placed rather than
  sent, because whether you pressed Post is not something this can know, and
  recording a send it did not witness would put a false entry in the one place
  you look to check.

## If the box does not fill

- **Nothing happens** — click directly into the comment box first. LinkedIn only
  creates the editor when you click it.
- **Wrong post** — the queue matches on the post id in the URL. If you navigated
  somewhere else, go back to the post you queued.
- **Still nothing** — LinkedIn renamed its editor classes again. Tell Claude and
  the selectors in `compose.js` get updated.

## About the LinkedIn app connection

If you set up `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`, that connection
still works and is still worth keeping, but not for comments. The permission it
grants, `w_member_social`, covers publishing **your own** posts. If you ever want
Finax to draft and publish original posts to your feed, that route is open and
already authorised. Ask and it can be wired up.

---

# Leads

Every account Finax sees ends up in **Agent → Outreach → Leads**, two ways:

- someone posted something worth answering, or
- you opened their profile with the extension running

## Sorting

Press **Sort the new ones**. Finax works out what each account is and writes one
or two sentences on how BlockFinaX relates to them specifically.

- **Buyers** carry the currency exposure themselves. The actual customers.
- **Amplifiers** write about it. They will never buy cover, and they are often
  the most valuable accounts on the list, because one good comment on their post
  is read by hundreds of people who would. Do not dismiss them for not being
  customers.
- **Partners** are banks, brokers and associations that could distribute.
- **Peers** are building something adjacent. Worth knowing, not worth selling to.
- **Observers** are interested without being exposed.

## Verifying

The sorting is a guess from a headline and a couple of posts, and it guesses
confidently either way. Press **Verify** on the ones you agree with. That is
what turns a guess into a lead, and it records that you were the one who looked.

Nothing marks itself verified. Finax cannot set it.

## Reading profiles

With the extension installed, opening anyone's LinkedIn profile records them.
It reads only the page you are already looking at, the same as everything else
in the extension. It does not open profiles, does not follow links, and does
nothing on any page that is not a profile.

Existing rows only gain missing fields. A headline captured next to a real post
says more about what someone cares about than the one on their profile, so it is
never overwritten.
