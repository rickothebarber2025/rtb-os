// Public, no-login, no-network support page -- this is what Apple's App
// Store Connect "Support URL" (https://rtbheadquaters.com/support) points
// to, and what any RTB OS user reaches if they need help. It renders
// entirely from static content (no Supabase calls, no auth check) so it can
// never spin, error, or depend on anything else being up.
const FAQS = [
  {
    question: 'I can\'t sign in to RTB OS.',
    answer:
      'Make sure you\'re using the email address an admin invited you with. If you forgot your password, use "Magic link" on the sign-in screen to get a one-time sign-in link emailed to you instead.',
  },
  {
    question: 'My account says "access pending" or I can\'t see the pages I expect.',
    answer:
      'An admin needs to grant your account access to specific modules. Contact your manager or the owner (details below) and ask them to update your access in RTB OS under Access.',
  },
  {
    question: 'The app looks stuck on a loading screen.',
    answer:
      'Close the app fully and reopen it. If that doesn\'t help, check your internet connection -- RTB OS needs a live connection to load your data. Still stuck? Reach out below and include your device type and iOS version.',
  },
  {
    question: 'I found a bug or something looks wrong.',
    answer: 'Email or call using the details below with a short description (and a screenshot if you can) and we\'ll take a look.',
  },
];

export default function SupportPage() {
  return (
    <main
      style={{
        alignItems: 'center',
        background: '#0b0c10',
        color: '#f5f1e6',
        display: 'flex',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '32px 16px',
      }}
    >
      <div style={{ maxWidth: 640, width: '100%' }}>
        <header style={{ marginBottom: 32, textAlign: 'center' }}>
          <img
            alt="RTB OS"
            src="/assets/rtb-combined-logo.png"
            style={{ height: 64, marginBottom: 16, objectFit: 'contain' }}
          />
          <h1 style={{ fontSize: 28, margin: '0 0 8px' }}>RTB OS Support</h1>
          <p style={{ color: '#c9c2ab', margin: 0 }}>
            The staff operations app for RTB Lounge &amp; RTB Beauty Lounge
          </p>
        </header>

        <section
          style={{
            background: '#15171d',
            border: '1px solid #2a2d36',
            borderRadius: 12,
            marginBottom: 24,
            padding: 24,
          }}
        >
          <h2 style={{ fontSize: 18, margin: '0 0 12px' }}>Contact us</h2>
          <p style={{ lineHeight: 1.6, margin: '0 0 8px' }}>
            Email: <a href="mailto:rickothebarber@gmail.com" style={{ color: '#d6a84f' }}>rickothebarber@gmail.com</a>
          </p>
          <p style={{ lineHeight: 1.6, margin: '0 0 8px' }}>
            Phone: <a href="tel:+16138797236" style={{ color: '#d6a84f' }}>(613) 879-7236</a>
          </p>
          <p style={{ color: '#c9c2ab', lineHeight: 1.6, margin: 0 }}>
            306 Cumberland St, Ottawa, ON K1N 7H9
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 18, margin: '0 0 12px' }}>Common questions</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {FAQS.map((item) => (
              <article
                key={item.question}
                style={{ background: '#15171d', border: '1px solid #2a2d36', borderRadius: 12, padding: 20 }}
              >
                <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>{item.question}</h3>
                <p style={{ color: '#c9c2ab', lineHeight: 1.6, margin: 0 }}>{item.answer}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
