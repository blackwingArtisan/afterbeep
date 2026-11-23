# Demo video: beat sheet (2:55)

Dark "graveyard shift" theme throughout, except where noted. No "AI" or "LLM" on screen or in the voice-over. Every number on screen comes from the app or from a cited source in [docs/business.md](../business.md).

## Setup before recording

1. `npm ci && npm run build && npm start` (or the deployed URL).
2. Open `/machine` and press **Reset demo**. The story uses a fresh 555-01xx caller ID each run.
3. Open the landing page in a new private window so the hero cold open plays (it runs once a session).
4. Browser at 1440 x 900, zoom 100%. A second window at 390 x 844 for the phone shots.
5. Turn off notifications. Record at 60 fps; export 1080p.

## Beats

| Time | Beat | Voice-over | Clicks and screen | Caption |
|---|---|---|---|---|
| 0:00-0:06 | **Cold open: why it died** | (Ring, ring, beep. No voice.) | Landing page, fresh session. The hero machine flashes TAPE FULL, then AfterBeep picks up | "Plain voicemail: 69% of callers never leave a word." |
| 0:06-0:16 | **Stakes** | "Morgan's under a sink. A burst water heater is a $377 job, and it just went to the next name on Google. Miss five calls a week and that's about $740 a month." | Hold on the hero: H1 and the $740 line | "AfterBeep. The answering machine is back." |
| 0:16-0:22 | **Twist tease** | "Dryer belt, fifteen." | The hero runs Bill on its own: the slip prints with ON HOLD | "Hears fifteen. Knows you meant fifty." |
| 0:22-0:50 | **The missed call** | "A caller rings. The machine answers, says it's a machine, takes the message, and texts back real open times before she's hung up." | Click **Demo the whole story**. The call places itself; June's cassette fills in, the four fields land, the text appears in the phone with the TEXTED stamp | "Simulated call. Production uses Amazon Connect." |
| 0:50-1:02 | **June books one-handed** | "June taps a time. Booked." | Click **Open the text as June**. On the booking page (phone frame), tap the first slot, then the **Book** button under it | "Booked from the text." |
| 1:02-1:18 | **Spanish caller** | "Same machine, in Spanish." | Open **Call in**, pick "Burst water heater, in Spanish", press **Call the machine**. The text back is in Spanish, the inbox shows an ES chip | "About 1 in 8 US residents speak Spanish at home." |
| 1:18-1:45 | **The money moment** | "Back to Morgan. He says the invoice out loud. Dryer belt, fifteen. The machine checks it against his own carbon copies: his last four invoices say about fifty. The machine reads the words. Code does the math in cents, and refuses a total that's a penny off." | Click **Back to Morgan: bill it by voice**, **Line it up**. The carbon slips fan out with the red "$15?". Click **Use usual $50.00**, then **Approve and send $182.88**. SENT lands. Click **Pay as June**: PAID | "Checked against his last 4 invoices." |
| 1:45-2:00 | **Raise the dead** | "Last week, five people hung up without a word. One press, one text each, never a second." | Click **Back to the machine: raise the dead**, then **Raise the dead**. Ghost cassettes rise, stamped TEXTED. The Kept LCD reads $557 of booked work | "Each texted once. Reply STOP opts out." |
| 2:00-2:30 | **Built with Kiro** | "Built spec-first with Kiro. Three specs, every criterion tied to a test, steering that loads the money rules with the money code, and an agent that blocks float money before it's written." | Kiro IDE: `.kiro/specs/voice-invoicing/requirements.md`, then `money.md` loading on `price-book.ts`, then the money-guard hook on save. Cut to `npm run spec:coverage` passing | "Every criterion named by a test. CI fails if one isn't." |
| 2:30-2:48 | **The business** | "$39 a month, flat. About seven cents a call on AWS. An 80% margin. 362,219 solo contractors." | Architecture diagram from the README, then the costs table | "$39 flat. ~$0.074 a call." |
| 2:48-2:55 | **Close** | "The answering machine is back. This time it books the job and checks the bill." | Ring, beep. The hero machine idles with its VU meter | Repo URL and live link |

## Notes

- Keep the voice-over under 380 words; it is about 330 above.
- If the deployed number is live, replace the 0:22 simulator shot with a phone dialing it on camera, and drop the "Simulated call" caption.
- Light theme reads better on some screens; the machine itself stays dark plastic either way. Use one theme for the whole video.
- Check every on-screen number against the app after **Reset demo**: $740, $377, $182.88, $557, 4 past invoices.
