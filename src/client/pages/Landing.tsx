import { Link } from 'react-router-dom';
import { Brand } from '../components/Brand';
import { Device } from '../components/Device';
import { Payback } from '../components/Payback';
import { AlertIcon, ArrowIcon, CheckIcon, MicIcon, PhoneIcon, ReceiptIcon } from '../components/Icons';
import { ThemeToggle } from '../components/ThemeToggle';
import { useTitle } from '../lib/machine';

const STEPS = [
  {
    n: '001',
    icon: PhoneIcon,
    machine: 'The answering machine',
    title: 'It answers and books',
    body: "You're on a ladder. The call rolls to AfterBeep, which plays your greeting, records the caller, reads the name, number, address, job and urgency, and texts them real open slots in your week.",
  },
  {
    n: '002',
    icon: MicIcon,
    machine: 'The Dictaphone',
    title: 'It bills',
    body: 'Say the invoice out loud in the truck. AfterBeep lines it up and does the math in code, to the cent. Nothing goes out until you approve the exact total.',
  },
  {
    n: '003',
    icon: ReceiptIcon,
    machine: 'The carbon copies',
    title: 'It remembers',
    body: 'Your carbon copies remember what you charge. Say "fifteen" for a belt you always bill at fifty and the invoice stops and asks before the customer ever sees it.',
  },
];

/** The stakes, each with its source. Full table and method in docs/business.md. */
const STAKES = [
  {
    big: '69%',
    line: 'of callers hang up on plain voicemail without leaving a word. AfterBeep\'s greeting promises a text with open times in seconds, so callers have a reason to stay.',
    source: 'Moneypenny call data, 10,000 businesses, 2016',
    href: 'https://moneypenny.com/us/resources/news/small-business-call-report/',
  },
  {
    big: '85%',
    line: 'Up to this share of customers whose calls go unanswered will not call back, in a US benchmark of 1.1 million leads. A text back is the second chance.',
    source: 'CallRail small business benchmark, 2025',
    href: 'https://www.plumbermag.com/online_exclusives/2025/01/callrail-releases-report-analyzing-which-marketing-efforts-best-convert-leads-into-business',
  },
  {
    big: '$206',
    line: 'is what most people pay for a minor appliance repair. Emergency plumbing: $377.',
    source: 'Thumbtack cost guides, 2026',
    href: 'https://www.thumbtack.com/p/appliance-repair-cost',
  },
  {
    big: '362,219',
    line: 'plumbing, HVAC and electrical contractors in the US work with no employees. Nobody else picks up. At $39 a month that is about $170M a year in front-office work.',
    source: 'US Census Nonemployer Statistics 2023',
    href: 'https://www.census.gov/programs-surveys/nonemployer-statistics.html',
  },
];

const FAQ = [
  {
    q: 'Do I need a new phone number?',
    a: 'No. Keep your number and forward unanswered calls to your AfterBeep line. Customers never notice the switch, except that someone finally called them back.',
  },
  {
    q: 'What if it mishears a price?',
    a: 'That is what the carbon copies are for. They remember every price you have billed, so if you say fifteen for a part you always bill at fifty, the invoice stops and asks. And nothing is ever sent until you approve the exact total.',
  },
  {
    q: 'Does the AI do my math?',
    a: 'Never. Speech is turned into line items, then plain code does every multiplication, the sales tax and the total, in whole cents.',
  },
  {
    q: 'Why not iPhone Live Voicemail, Google Voice, Jobber or Smith.ai?',
    a: 'Live Voicemail and Google Voice write the message down for free, but nobody texts the caller back, books them or bills them. Jobber does all of it as a full field-service suite ($29 to $49 a month for one user, plus $29 for its AI receptionist), so you move your whole business into it. The Smith.ai AI receptionist answers live calls, free for 25 calls and then $150 a month for 75. AfterBeep is an honest machine on your own number: it never pretends to be a person, texts every real caller your open slots, and checks every spoken price against your own past invoices. Flat $39 a month.',
  },
  {
    q: 'How do customers pay?',
    a: 'Invoices go out through Stripe, so customers pay by card or bank from a link. Stripe charges its standard processing fee; AfterBeep adds nothing per invoice.',
  },
];

export default function Landing() {
  useTitle('');
  return (
    <div className="landing">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-nav wrap">
        <Brand />
        <nav className="site-links" aria-label="Site">
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="row">
          <ThemeToggle />
          <Link className="btn btn-primary btn-small" to="/machine">
            Try the machine
          </Link>
        </div>
      </header>

      <main id="main" tabIndex={-1}>
      <section className="hero wrap">
        <div className="hero-copy">
          <p className="eyebrow">Kiroween 2026 · The 1980s front office, back from the dead</p>
          <h1>
            You were under a sink. <span className="hl">AfterBeep</span> got the job.
          </h1>
          <p className="hero-sub">The machine that hears fifteen and knows you meant fifty.</p>
          <p className="hero-lede">
            An answering machine, a Dictaphone and a stack of carbon copies, rebuilt for one-person trades. AfterBeep answers the calls
            you miss, texts the caller a booking link, and turns your spoken invoice into a checked, approved bill.
          </p>
          <div className="row">
            <Link className="btn btn-primary" to="/machine/call?story=1">
              Demo the whole story <ArrowIcon />
            </Link>
            <Link className="btn" to="/machine">
              Open the machine
            </Link>
            <a className="btn" href="#pricing">
              $39/month, flat
            </a>
          </div>
          <p className="faint hero-fine">For plumbers, roofers, HVAC and appliance repair. One number, unlimited messages, no per-invoice fees.</p>
        </div>
        <Device />
      </section>

      <section className="wrap stakes" aria-labelledby="stakes-title" data-testid="stakes">
        <p className="eyebrow" id="stakes-title">
          What a missed call costs
        </p>
        <div className="stakes-grid">
          {STAKES.map(({ big, line, source, href }) => (
            <figure key={big} className="stake">
              <span className="stake-big">{big}</span>
              <figcaption>
                {line}{' '}
                <a className="stake-source" href={href} target="_blank" rel="noreferrer">
                  {source}
                </a>
              </figcaption>
            </figure>
          ))}
        </div>
        <p className="stakes-payback">
          Up to 85% of the callers you miss never try again, so the minutes after the beep decide the job. Move the two numbers we cannot
          cite and see what a text back is worth to you.
        </p>
        <Payback />
      </section>

      <section className="why wrap" aria-label="Why now">
        <p>
          <span className="eyebrow">Why now</span>
          Your phone already writes voicemail down for free, and reading a message with AWS now costs well under a cent. The transcript
          stopped being the hard part. What a one-truck shop still lacks is what happens after the beep: the text back, the booking and
          the bill.
        </p>
      </section>

      <section id="how" className="wrap section">
        <p className="eyebrow">How it haunts your back office</p>
        <h2>Three machines you thought were dead</h2>
        <div className="steps-grid">
          {STEPS.map(({ n, icon: Icon, machine, title, body }) => (
            <article key={n} className="panel panel-pad step-card">
              <div className="spread">
                <span className="lcd">{n}</span>
                <Icon width={26} height={26} />
              </div>
              <p className="step-machine">{machine}</p>
              <h3>{title}</h3>
              <p className="muted">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="wrap section grid-2 demo-row">
        <div className="stack">
          <p className="eyebrow">Part one: missed calls</p>
          <h2>A voicemail becomes a booked job</h2>
          <p className="muted">
            Every message is read for the five things you would scribble on a napkin. Emergencies get flagged red and a promise that you
            will call back. Everyone else picks a time and lands on your schedule while you work.
          </p>
          <Link className="btn" to="/machine/call">
            Leave it a message <ArrowIcon />
          </Link>
        </div>
        <div className="panel panel-pad stack">
          <p className="transcript-demo">
            "Hi, this is <mark className="m-name">Priya Natarajan</mark>. My <mark className="m-job">water heater just burst</mark> and{' '}
            <mark className="m-urgent">there's water all over the basement</mark>. I'm at <mark className="m-addr">88 Hollow Pine Road</mark>. Call me at{' '}
            <mark className="m-num">614-555-0134</mark>."
          </p>
          <div className="phone demo-phone">
            <div className="phone-screen">
              <div className="phone-to">Text to (614) 555-0134</div>
              <div className="bubble">
                Hi Priya, it's Morgan at Hollow Creek Plumbing &amp; Appliance. Got your message about your water heater. I'll call you back the
                minute I'm off this job. Grab the earliest visit here: afterbeep.example.com/book/...
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="wrap section grid-2 demo-row">
        <div className="panel panel-pad stack order-2">
          <div className="spoken">
            <MicIcon width={22} height={22} />
            <span>"Dryer belt fifteen, taxed. One hour labor at eighty-five. Trip charge."</span>
          </div>
          <div className="hold-card">
            <div className="row">
              <span className="chip chip-hold">
                <AlertIcon width={12} height={12} /> Check price
              </span>
              <strong>Dryer belt</strong>
            </div>
            <p>You said $15.00, but you usually charge $50.00 (4 past invoices).</p>
            <div className="row">
              <span className="btn btn-small">Keep $15.00</span>
              <span className="btn btn-small btn-primary">Use usual $50.00</span>
            </div>
          </div>
          <div className="approve-demo">Approve and send $182.88</div>
        </div>
        <div className="stack">
          <p className="eyebrow">Part two: voice invoices</p>
          <h2>Say the invoice. Code does the math.</h2>
          <p className="muted">
            Your carbon copies are built from your own invoices, not a catalog. A slip of the tongue gets caught before the customer sees it,
            "twelve fifty" means $1,250 for a water heater and $12.50 for a cartridge, and the total you approve is the total that goes out.
          </p>
          <Link className="btn" to="/machine/invoice">
            Say one <ArrowIcon />
          </Link>
        </div>
      </section>

      <section id="pricing" className="wrap section pricing">
        <p className="eyebrow">Pricing</p>
        <h2>One plan. One price. No ghosts in the bill.</h2>
        <div className="price-card panel">
          <div className="price-top">
            <div>
              <h3>The Machine</h3>
              <p className="muted">Everything a one-truck business needs to never miss a job.</p>
            </div>
            <div className="price">
              <span className="price-num">$39</span>
              <span className="muted">/month</span>
            </div>
          </div>
          <ul className="ticks">
            <li>
              <CheckIcon /> A local phone number, or forward your own
            </li>
            <li>
              <CheckIcon /> Unlimited voicemails, transcripts and text-backs
            </li>
            <li>
              <CheckIcon /> Booking page with your real hours and open slots
            </li>
            <li>
              <CheckIcon /> Unlimited voice invoices with price-book checks
            </li>
            <li>
              <CheckIcon /> Card and bank payments through Stripe, no AfterBeep fee per invoice
            </li>
          </ul>
          <div className="row">
            <Link className="btn btn-primary" to="/machine">
              Start the 14-day free trial
            </Link>
            <span className="faint">No card to try. Cancel by text.</span>
          </div>
        </div>
      </section>

      <section id="faq" className="wrap section faq">
        <p className="eyebrow">Questions from the crawlspace</p>
        <h2>FAQ</h2>
        <div className="faq-list">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="panel">
              <summary>{q}</summary>
              <p className="muted">{a}</p>
            </details>
          ))}
        </div>
      </section>

      </main>

      <footer className="site-foot wrap">
        <Brand />
        <p className="faint">The answering machine is back. This time it books the job and checks the bill. &copy; 2026 Stubborn Otter Software.</p>
      </footer>
    </div>
  );
}
