import { Link } from 'react-router-dom';
import { Brand } from '../components/Brand';
import { Device } from '../components/Device';
import { AlertIcon, ArrowIcon, CheckIcon, MicIcon, PhoneIcon, ReceiptIcon } from '../components/Icons';
import { ThemeToggle } from '../components/ThemeToggle';
import { useTitle } from '../lib/machine';

const STEPS = [
  {
    n: '001',
    icon: PhoneIcon,
    title: 'It answers',
    body: "You're on a ladder. The call rolls to AfterBeep, which plays your greeting, records the caller, and writes down every word.",
  },
  {
    n: '002',
    icon: CheckIcon,
    title: 'It books',
    body: 'Name, callback number, address, the job and how urgent it is, pulled out for you. The caller gets a text with real open slots in your week.',
  },
  {
    n: '003',
    icon: ReceiptIcon,
    title: 'It bills',
    body: 'Say the invoice out loud in the truck. AfterBeep checks every price against your own past invoices and sends only the total you approve.',
  },
];

const FAQ = [
  {
    q: 'Do I need a new phone number?',
    a: 'No. Keep your number and forward unanswered calls to your AfterBeep line. Customers never notice the switch, except that someone finally called them back.',
  },
  {
    q: 'What if it mishears a price?',
    a: 'That is the point of the price book. If you say fifteen for a part you always bill at fifty, the invoice stops and asks. And nothing is ever sent until you approve the exact total.',
  },
  {
    q: 'Does the AI do my math?',
    a: 'Never. Speech is turned into line items, then plain code does every multiplication, the sales tax and the total, in whole cents.',
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
          <p className="eyebrow">The answering machine, back from the dead</p>
          <h1>
            You were under a sink. <span className="hl">AfterBeep</span> got the job.
          </h1>
          <p className="hero-lede">
            The back office for one-person trades. AfterBeep answers the calls you miss, texts the caller a booking link, and turns
            your spoken invoice into a checked, approved bill.
          </p>
          <div className="row">
            <Link className="btn btn-primary" to="/machine">
              Hear it work <ArrowIcon />
            </Link>
            <a className="btn" href="#pricing">
              $39/month, flat
            </a>
          </div>
          <p className="faint hero-fine">For plumbers, roofers, HVAC and appliance repair. One number, unlimited messages, no per-invoice fees.</p>
        </div>
        <Device />
      </section>

      <section className="why wrap" aria-label="Why now">
        <p>
          <span className="eyebrow">Why now</span>
          Speech-to-text and language models got accurate enough to understand a rushed voicemail, and cheap enough to run on
          every call. So a one-person shop can finally have a front desk without hiring one.
        </p>
      </section>

      <section id="how" className="wrap section">
        <p className="eyebrow">How it haunts your back office</p>
        <h2>Three jobs you stop doing at 9 pm</h2>
        <div className="steps-grid">
          {STEPS.map(({ n, icon: Icon, title, body }) => (
            <article key={n} className="panel panel-pad step-card">
              <div className="spread">
                <span className="lcd">{n}</span>
                <Icon width={26} height={26} />
              </div>
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
            Your price book is built from your own invoices, not a catalog. A slip of the tongue gets caught before the customer sees it,
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
        <p className="faint">&copy; 2026 Stubborn Otter Software. Leave a message after the beep.</p>
      </footer>
    </div>
  );
}
