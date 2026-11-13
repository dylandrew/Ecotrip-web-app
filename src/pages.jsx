import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, assetUrl, exchangeGoogleCode } from './api.js';
import { useAuth } from './auth.jsx';
import { mountMotion } from './motion.js';

const money = (value) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(Number(value || 0));
const dateLabel = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00`)) : 'Date not set';
let leafletPromise;
const geocodeCache = new Map();
let geocodeQueue = Promise.resolve();
let lastGeocodeAt = 0;

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;

  const stylesheetId = 'ecotrip-leaflet-styles';
  if (!document.getElementById(stylesheetId)) {
    const stylesheet = document.createElement('link');
    stylesheet.id = stylesheetId;
    stylesheet.rel = 'stylesheet';
    stylesheet.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(stylesheet);
  }

  leafletPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
    script.crossOrigin = '';
    script.onload = () => resolve(window.L);
    script.onerror = () => {
      leafletPromise = null;
      reject(new Error('The route map could not load. Check your internet connection and try again.'));
    };
    document.head.appendChild(script);
  });
  return leafletPromise;
}

function routeLocation(place) {
  const knownLocations = {
    manila: [14.5995, 120.9842],
    baguio: [16.4023, 120.596],
    sagada: [17.085, 120.901],
    'cebu city': [10.3157, 123.8854],
    siargao: [9.85, 126.05],
    'siargao town': [9.85, 126.05],
    'burnham park': [16.4122, 120.5946],
    calamba: [14.2117, 121.1653],
    'tuason point': [9.8, 126.16],
    palawan: [9.8349, 118.7384],
  };
  const name = String(place || '').trim();
  const known = knownLocations[name.toLowerCase()];
  if (known) return Promise.resolve(known);

  const key = name.toLowerCase();
  if (!key) return Promise.resolve(null);
  if (!geocodeCache.has(key)) {
    const lookup = geocodeQueue.then(async () => {
      const delay = Math.max(0, 1000 - (Date.now() - lastGeocodeAt));
      if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
      lastGeocodeAt = Date.now();
      const query = new URLSearchParams({ q: `${name}, Philippines`, format: 'jsonv2', limit: '1', countrycodes: 'ph' });
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${query}`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('Location lookup failed');
      const results = await response.json();
      return results.length ? [Number(results[0].lat), Number(results[0].lon)] : null;
    });
    geocodeQueue = lookup.catch(() => null);
    geocodeCache.set(key, lookup);
  }
  return geocodeCache.get(key);
}

async function routeGeometry(origin, destination, mode) {
  const profile = mode === 'bike' ? 'bike' : mode === 'walk' ? 'foot' : 'driving';
  const coordinates = `${origin[1]},${origin[0]};${destination[1]},${destination[0]}`;
  const response = await fetch(`https://router.project-osrm.org/route/v1/${profile}/${coordinates}?overview=full&geometries=geojson&steps=false`);
  if (!response.ok) return null;
  const data = await response.json();
  return data.routes?.[0]?.geometry?.coordinates?.map(([longitude, latitude]) => [latitude, longitude]) || null;
}

function useResource(path, enabled = true) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    if (!enabled) {
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    setError('');
    api.get(path)
      .then((result) => { if (active) setData(result); })
      .catch((requestError) => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path, enabled, version]);
  return { data, loading, error, reload: () => setVersion((current) => current + 1) };
}

function PageHeading({ eyebrow, title, copy, action }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{copy && <p className="lead">{copy}</p>}</div>{action}</div>;
}

function LoadState({ loading, error, retry, children }) {
  if (loading) return <div className="state-panel" role="status"><span className="spinner" /> Loading EcoTrip data…</div>;
  if (error) return <div className="state-panel state-error" role="alert"><strong>We couldn't load this view.</strong><p>{error}</p>{retry && <button className="button button-small" onClick={retry}>Try again</button>}</div>;
  return children;
}

function EmptyState({ children, action }) {
  return <div className="empty-panel"><span className="empty-mark" aria-hidden="true">+</span><p>{children}</p>{action}</div>;
}

function SiteHeader() {
  const { user, ready, signOut } = useAuth();
  const navigate = useNavigate();
  async function logout() {
    try { await signOut(); } finally { navigate('/'); }
  }
  const links = [
    ['/', 'Home'],
    ['/trips/new', 'Plan a trip'],
    ['/assistant', 'Trip assistant'],
    ['/trips', 'My trips'],
    ['/experiences', 'Traveler experiences'],
    ['/stays', 'Green stays'],
    ['/transport', 'Routes'],
    ['/bookings', 'Bookings'],
    ['/journal', 'Journal'],
    ['/reminders', 'Reminders'],
    ['/dashboard', 'Dashboard'],
    ['/account', 'Account'],
    ['/about', 'About EcoTrip'],
  ];
  if (user?.role === 'admin') links.push(['/admin', 'Admin']);
  return <header className="site-header" id="site-header">
    <nav className="site-nav" aria-label="Main navigation">
      <Link className="brand" to="/" aria-label="EcoTrip home">Eco<span>Trip</span></Link>
      <div className="nav-actions">
        <Link className="nav-cta" to="/trips/new" data-roll>Plan a trip</Link>
        <button id="menu-toggle" className="menu-toggle" type="button" aria-controls="site-menu" aria-expanded="false" aria-label="Open navigation"><span className="menu-label" aria-hidden="true"><span>Menu</span><span>Close</span></span><span className="menu-icon" aria-hidden="true"><i /><i /></span></button>
      </div>
    </nav>
    <div id="site-menu" className="site-menu" aria-hidden="true">
      <div>
        <p className="menu-kicker">Navigate</p>
        <div className="nav-links">{links.map(([href, label], index) => <div className="menu-item" style={{ '--k': index }} key={href}><NavLink to={href} end={href === '/'} data-roll>{label}</NavLink></div>)}</div>
      </div>
      <div className="menu-foot">{!ready ? <span className="nav-note">Checking account…</span> : user ? <><Link className="nav-login" to="/account">{user.name}</Link><button className="nav-login" onClick={logout}>Sign out</button></> : <><Link className="nav-login" to="/login">Sign in</Link><Link className="nav-register" to="/register">Create account</Link></>}<small>Sustainable travel, planned with care.</small></div>
    </div>
  </header>;
}

function SiteFooter() {
  return <footer className="site-footer">
    <div className="footer-cols">
      <div data-reveal><h4><b>1</b>Explore</h4><ul><li><Link to="/trips/new" data-roll>Plan a trip</Link></li><li><Link to="/stays" data-roll>Green stays</Link></li><li><Link to="/transport" data-roll>Routes</Link></li><li><Link to="/assistant" data-roll>Trip assistant</Link></li></ul></div>
      <div data-reveal style={{ '--d': '80ms' }}><h4><b>2</b>Your journey</h4><ul><li><Link to="/trips" data-roll>My trips</Link></li><li><Link to="/experiences" data-roll>Traveler experiences</Link></li><li><Link to="/bookings" data-roll>Bookings</Link></li><li><Link to="/journal" data-roll>Journal</Link></li><li><Link to="/reminders" data-roll>Reminders</Link></li></ul></div>
      <div data-reveal style={{ '--d': '160ms' }}><h4><b>3</b>Account</h4><ul><li><Link to="/dashboard" data-roll>Dashboard</Link></li><li><Link to="/about" data-roll>About EcoTrip</Link></li></ul></div>
    </div>
    <div className="footer-mark" aria-hidden="true" data-footer-mark><span data-split>Eco<em>Trip</em></span></div>
    <div className="footer-base"><span>Planning tools, not live travel guarantees.</span><span>Travel light. Stay well. Keep close.</span></div>
  </footer>;
}

function Shell({ children, wide = false }) {
  const { pathname } = useLocation();
  const { user, ready } = useAuth();
  useEffect(() => mountMotion(), [pathname, user?.id, user?.role, ready]);
  return <><SiteHeader /><main className={wide ? 'site-main site-main-wide' : 'site-main'} key={pathname}>{children}</main><SiteFooter /></>;
}

function ProtectedRoute({ children, admin = false }) {
  const { user, ready } = useAuth();
  if (!ready) return <main className="site-main"><div className="state-panel" role="status"><span className="spinner" /> Restoring your session…</div></main>;
  if (!user) return <Navigate to="/login" replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/403" replace />;
  return children;
}

function Home() {
  return <Shell wide>
    <section className="hero">
      <div className="hero-top">
        <p className="wordmark" aria-hidden="true"><span className="line" data-split>Eco</span><span className="line" data-split>Trip</span></p>
        <div className="hero-lede" data-reveal style={{ '--d': '700ms' }}>
          <p className="eyebrow">A more thoughtful way to travel</p>
          <h1>Plan a trip that leaves less behind.</h1>
          <p className="hero-copy">Find a route that fits your pace, a stay that shares your values, and room for the moments in between.</p>
          <div className="hero-actions"><Link className="button" to="/trips/new" data-magnetic>Start planning</Link><Link className="hero-secondary" to="/stays" data-roll>Explore green stays</Link></div>
        </div>
      </div>
      <div className="hero-media" data-reveal style={{ '--d': '900ms' }}>
        <div className="badge" aria-hidden="true"><svg viewBox="0 0 100 100"><defs><path id="badge-circle" d="M50,50 m-37,0 a37,37 0 1,1 74,0 a37,37 0 1,1 -74,0" /></defs><text><textPath href="#badge-circle" textLength="228" lengthAdjust="spacing">Plan · Stay · Travel light · </textPath></text></svg></div>
        <div className="hero-frame" data-grow><img src="https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?auto=format&fit=crop&w=2200&q=85" alt="A quiet mountain lake at sunrise" width="2200" height="1467" fetchPriority="high" data-parallax="0.09"/><p className="hero-caption"><small>Slow travel</small>Lake &amp; mountain mornings</p><p className="hero-count">03<small>ways to travel lighter</small></p></div>
      </div>
    </section>
    <section className="marquee" aria-hidden="true"><div className="marquee-track"><span>Travel light</span><span>Stay well</span><span>Keep close</span><span>Go slowly</span><span>Travel light</span><span>Stay well</span><span>Keep close</span><span>Go slowly</span></div></section>
    <section className="home-section"><div className="section-heading"><p className="eyebrow" data-reveal>The journey, considered</p><h2 data-reveal>Good trips are made of good choices.</h2><p data-reveal style={{ '--d': '120ms' }}>Thoughtful options for getting there, staying well, and remembering it all.</p></div><div className="feature-grid" data-stagger>
      <Link className="feature-card" to="/transport" data-reveal><div className="feature-media" data-reveal="img"><img src="https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format&fit=crop&w=1200&q=80" alt="Mountain range viewed from a trail"/><span className="feature-index">01 / GET THERE</span></div><h3>Take the scenic route.</h3><p>Explore buses, trains, and bike-friendly ways to reach your next stop.</p><span className="feature-link"><span data-roll>Explore routes</span><i aria-hidden="true">↗</i></span></Link>
      <Link className="feature-card" to="/stays" data-reveal><div className="feature-media" data-reveal="img"><img src="https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1200&q=80" alt="Sunlight through a forest"/><span className="feature-index">02 / STAY WELL</span></div><h3>Stay somewhere with care.</h3><p>Find welcoming places that put a little more thought into their footprint.</p><span className="feature-link"><span data-roll>Browse green stays</span><i aria-hidden="true">↗</i></span></Link>
      <Link className="feature-card" to="/journal" data-reveal><div className="feature-media" data-reveal="img"><img src="https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=1200&q=80" alt="Travel journal and map"/><span className="feature-index">03 / KEEP CLOSE</span></div><h3>Bring the good bits home.</h3><p>Save the small discoveries and stories that make a trip yours.</p><span className="feature-link"><span data-roll>Open your journal</span><i aria-hidden="true">↗</i></span></Link>
    </div></section>
    <section className="statement"><div className="statement-inner"><p className="eyebrow" data-reveal>We believe</p><p className="big-quote" data-words>A journey deserves just as much care as the place you leave behind.</p></div></section>
    <section className="philosophy"><div className="philosophy-head" data-reveal><p className="eyebrow">How we travel</p><h2>Our philosophy</h2></div><ol className="philosophy-list"><li data-reveal="line"><span className="num">1</span><h3>Lighter</h3><p>Lower-carbon routes by bus, train, and bike can make the way there part of the trip.</p></li><li data-reveal="line" style={{ '--d': '100ms' }}><span className="num">2</span><h3>Warmer</h3><p>Eco-rated stays sit alongside standard hotels, so you can choose what fits.</p></li><li data-reveal="line" style={{ '--d': '200ms' }}><span className="num">3</span><h3>Closer</h3><p>A photo journal and gentle reminders keep the small discoveries close.</p></li></ol></section>
    <section className="home-cta" aria-label="Plan your next trip" data-reveal><p>Make space for a <em>different</em> kind of getaway.</p><Link className="button button-light" to="/trips/new" data-magnetic>Plan your trip</Link></section>
  </Shell>;
}

function About() {
  return <Shell><PageHeading eyebrow="Why EcoTrip" title="Travel with a lighter footprint." copy="Trip planning, lower-carbon transport, thoughtful stays, and travel memories in one place."/><section className="prose-columns"><p>We believe the way you travel matters as much as the destination. Compare options, plan around your own pace, and keep the details in one calm workspace.</p><p>Our recommendations are planning aids, not live travel or hotel guarantees. Confirm schedules, availability, and final prices directly with providers.</p></section><Link className="button" to="/trips/new">Plan a trip <span aria-hidden="true">↗</span></Link></Shell>;
}

function AuthLayout({ eyebrow, title, copy, children }) {
  return <Shell><section className="auth-page"><div className="auth-intro"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{copy}</p></div>{children}</section></Shell>;
}

function FormError({ children }) {
  return children ? <div className="form-error" role="alert">{children}</div> : null;
}

function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setError(''); setBusy(true);
    const form = new FormData(event.currentTarget);
    try { const user = await signIn({ email: form.get('email'), password: form.get('password') }); navigate(user?.role === 'admin' ? '/admin' : '/dashboard'); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  }
  async function google() {
    setError('');
    try { const data = await api.get('/auth/google/start', { auth: false, retry: false }); window.location.assign(data.authorization_url); }
    catch (requestError) { setError(requestError.message); }
  }
  return <AuthLayout eyebrow="Welcome back" title="Sign in to EcoTrip." copy="Your next thoughtful journey starts here."><div className="auth-form-wrap"><FormError>{error}</FormError><button className="button button-outline button-full" type="button" onClick={google}>Continue with Google</button><div className="form-divider"><span>or use email</span></div><form className="form-stack" onSubmit={submit}><label>Email<input name="email" type="email" autoComplete="email" required /></label><label>Password<input name="password" type="password" autoComplete="current-password" required /></label><div className="form-meta"><Link to="/forgot-password">Forgot password?</Link></div><button className="button button-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'} <span aria-hidden="true">↗</span></button></form><p className="auth-switch">New to EcoTrip? <Link to="/register">Create an account</Link></p></div></AuthLayout>;
}

function Register() {
  const { register } = useAuth(); const navigate = useNavigate();
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function google() {
    setError('');
    try { const data = await api.get('/auth/google/start', { auth: false, retry: false }); window.location.assign(data.authorization_url); }
    catch (requestError) { setError(requestError.message); }
  }
  async function submit(event) {
    event.preventDefault(); setError(''); setBusy(true);
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') || '');
    if (password !== form.get('confirm_password')) { setError('Passwords do not match.'); setBusy(false); return; }
    try { await register({ name: form.get('name'), email: form.get('email'), address: form.get('address'), password }); navigate('/dashboard'); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  }
  return <AuthLayout eyebrow="A good place to begin" title="Create your EcoTrip account." copy="Keep your plans, bookings, and travel notes together."><div className="auth-form-wrap"><FormError>{error}</FormError><button className="button button-outline button-full" type="button" onClick={google}>Continue with Google</button><div className="form-divider"><span>or create an account with email</span></div><form className="form-stack" onSubmit={submit}><label>Name<input name="name" maxLength="100" autoComplete="name" required /></label><label>Email<input name="email" type="email" maxLength="150" autoComplete="email" required /></label><label>Home address<input name="address" maxLength="255" autoComplete="street-address" required /></label><label>Password<input name="password" type="password" minLength="12" maxLength="200" autoComplete="new-password" required /></label><label>Confirm password<input name="confirm_password" type="password" minLength="12" maxLength="200" autoComplete="new-password" required /></label><button className="button button-full" disabled={busy}>{busy ? 'Creating account…' : 'Create account'} <span aria-hidden="true">↗</span></button></form><p className="auth-switch">Already have an account? <Link to="/login">Sign in</Link></p></div></AuthLayout>;
}

function ForgotPassword() {
  const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event) { event.preventDefault(); setBusy(true); setError(''); try { await api.post('/auth/forgot-password', { email: new FormData(event.currentTarget).get('email') }, { auth: false, retry: false }); setMessage('If an account matches that email, a reset link will be sent shortly.'); } catch (requestError) { setError(requestError.message); } finally { setBusy(false); } }
  return <AuthLayout eyebrow="Account access" title="Reset your password." copy="We'll send a short-lived reset link if the account exists."><div className="auth-form-wrap"><FormError>{error}</FormError>{message && <div className="form-success">{message}</div>}<form className="form-stack" onSubmit={submit}><label>Email<input name="email" type="email" autoComplete="email" required /></label><button className="button button-full" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'} <span aria-hidden="true">↗</span></button></form></div></AuthLayout>;
}

function ResetPassword() {
  const [params] = useSearchParams(); const navigate = useNavigate();
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event) { event.preventDefault(); setError(''); setBusy(true); const form = new FormData(event.currentTarget); const password = String(form.get('password') || ''); if (password !== form.get('confirm_password')) { setError('Passwords do not match.'); setBusy(false); return; } try { await api.post('/auth/reset-password', { email: form.get('email'), otp: form.get('otp'), password, confirm_password: form.get('confirm_password') }, { auth: false, retry: false }); setMessage('Password updated. You can sign in now.'); setTimeout(() => navigate('/login'), 900); } catch (requestError) { setError(requestError.message); } finally { setBusy(false); } }
  return <AuthLayout eyebrow="Account access" title="Choose a new password." copy="Reset links expire after a short time."><div className="auth-form-wrap"><FormError>{error}</FormError>{message && <div className="form-success">{message}</div>}<form className="form-stack" onSubmit={submit}><label>Email<input name="email" type="email" defaultValue={params.get('email') || ''} required /></label><label>Reset code<input name="otp" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" defaultValue={params.get('otp') || ''} required /></label><label>New password<input name="password" type="password" minLength="12" autoComplete="new-password" required /></label><label>Confirm new password<input name="confirm_password" type="password" minLength="12" autoComplete="new-password" required /></label><button className="button button-full" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button></form></div></AuthLayout>;
}

function GoogleCallback() {
  const [params] = useSearchParams(); const navigate = useNavigate(); const { establishSession } = useAuth();
  const [error, setError] = useState('');
  useEffect(() => { const code = params.get('code'); if (!code) { setError(params.get('error') || 'The Google sign-in code is missing.'); return; } exchangeGoogleCode(code).then((data) => { establishSession(data); navigate('/dashboard', { replace: true }); }).catch((requestError) => setError(requestError.message)); }, [params, navigate]);
  return <Shell><main className="page-wrap"><p className="eyebrow">Google sign-in</p><h1>{error ? 'Sign-in needs another try.' : 'Completing sign-in…'}</h1>{error ? <><FormError>{error}</FormError><Link to="/login" className="button">Return to sign in</Link></> : <div className="state-panel"><span className="spinner" /> Exchanging your one-time code…</div>}</main></Shell>;
}

function Dashboard() {
  const resource = useResource('/dashboard');
  return <Shell><PageHeading eyebrow="Your travel desk" title="A little room to roam." copy="Your upcoming plans and the details that keep them moving." action={<Link className="button" to="/trips/new">Plan a trip <span aria-hidden="true">↗</span></Link>} /><LoadState {...resource} retry={resource.reload}>{resource.data && <><section className="stat-grid">{Object.entries(resource.data.stats || {}).map(([label, value]) => <div className="stat-card" key={label}><span>{label.replaceAll('_', ' ')}</span><strong>{String(value)}</strong></div>)}</section><section className="section-block"><div className="section-title"><div><p className="eyebrow">Coming up</p><h2>Your next departures</h2></div><Link to="/trips" className="text-link">All trips ↗</Link></div>{resource.data.upcoming?.length ? <div className="data-list">{resource.data.upcoming.map((trip) => <Link className="data-row" to={`/trips/${trip.id}`} key={trip.id}><div><strong>{trip.title}</strong><span>{trip.destination} / {dateLabel(trip.start_date)} – {dateLabel(trip.end_date)}</span></div><span className="tag">{trip.status}</span></Link>)}</div> : <EmptyState action={<Link className="text-link" to="/trips/new">Plan your first trip ↗</Link>}>No upcoming trips yet.</EmptyState>}</section></>}</LoadState></Shell>;
}

function TripList() {
  const resource = useResource('/trips');
  return <Shell><PageHeading eyebrow="Your travel plans" title="Trips, at your pace." copy="Keep dates, budgets, and itinerary details in one place." action={<Link className="button" to="/trips/new">New trip <span aria-hidden="true">↗</span></Link>} /><LoadState {...resource} retry={resource.reload}>{resource.data?.trips?.length ? <div className="trip-cards">{resource.data.trips.map((trip) => <Link className="trip-card" to={`/trips/${trip.id}`} key={trip.id}><div className="trip-card-top"><span className={`status-tag status-${trip.status}`}>{trip.status}</span><span>{trip.travelers} {Number(trip.travelers) === 1 ? 'traveler' : 'travelers'}</span></div><p className="eyebrow">{trip.destination}</p><h2>{trip.title}</h2><p>{dateLabel(trip.start_date)} – {dateLabel(trip.end_date)}</p><div className="trip-card-bottom"><span>Budget</span><strong>{money(trip.budget)}</strong></div></Link>)}</div> : <EmptyState action={<Link className="button" to="/trips/new">Plan a trip <span aria-hidden="true">↗</span></Link>}>No trips yet. Start with a destination and dates.</EmptyState>}</LoadState></Shell>;
}

function TripForm() {
  const { id } = useParams(); const editing = Boolean(id); const navigate = useNavigate();
  const resource = useResource(editing ? `/trips/${id}` : '', editing);
  const [form, setForm] = useState({ title: '', destination: '', start_date: '', end_date: '', budget: '', travelers: 1, status: 'draft' });
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [itinerary, setItinerary] = useState([]); const [aiMessage, setAiMessage] = useState('');
  useEffect(() => { if (resource.data?.trip) setForm({ ...resource.data.trip, budget: String(resource.data.trip.budget), travelers: Number(resource.data.trip.travelers) }); }, [resource.data]);
  function change(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    if (['destination', 'start_date', 'end_date', 'budget', 'travelers'].includes(name)) {
      setItinerary([]);
      setAiMessage('');
    }
  }
  async function generate() {
    setError('');
    setAiMessage('Generating a low-carbon itinerary…');
    setBusy(true);
    try {
      const data = await api.post('/trips/generate-itinerary', {
        destination: form.destination,
        start_date: form.start_date,
        end_date: form.end_date,
        budget: Number(form.budget),
        travelers: Number(form.travelers),
        preferences: form.preferences || '',
      });
      setItinerary(data.items || []);
      setAiMessage(`${data.items?.length || 0} suggested stops. Review them before saving your trip.`);
    } catch (requestError) {
      setError(requestError.message);
      setAiMessage('');
    } finally {
      setBusy(false);
    }
  }
  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const payload = itinerary.length ? { ...form, itinerary_items: itinerary } : form;
    try {
      const data = editing ? await api.put(`/trips/${id}`, payload) : await api.post('/trips', payload);
      const completedNow = editing
        && resource.data?.trip?.status !== 'completed'
        && data.trip.status === 'completed';
      navigate(`/trips/${data.trip.id}`, { state: completedNow ? { promptExperience: true } : null });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }
  if (editing && resource.loading) return <Shell><PageHeading eyebrow="Trip details" title="Loading your trip…"/><LoadState {...resource} retry={resource.reload}>{null}</LoadState></Shell>;
  return <Shell>
    <PageHeading eyebrow={editing ? 'Trip details' : 'Start somewhere'} title={editing ? 'Edit your trip.' : 'Plan a trip.'} copy="Set the essentials first. You can adjust the details as plans take shape." />
    {editing && <LoadState {...resource} retry={resource.reload}>{null}</LoadState>}
    <div className="form-layout">
      <form className="surface form-stack" onSubmit={submit}>
        <FormError>{error}</FormError>
        <label>Trip title<input name="title" maxLength="150" value={form.title} onChange={change} required /></label>
        <label>Destination<input name="destination" maxLength="150" value={form.destination} onChange={change} required /></label>
        <div className="form-grid">
          <label>Start date<input type="date" name="start_date" value={form.start_date} onChange={change} required /></label>
          <label>End date<input type="date" name="end_date" value={form.end_date} onChange={change} required /></label>
        </div>
        <div className="form-grid">
          <label>Budget (PHP)<input type="number" name="budget" min="1" step="0.01" value={form.budget} onChange={change} required /></label>
          <label>Travelers<input type="number" name="travelers" min="1" max="50" value={form.travelers} onChange={change} required /></label>
        </div>
        <label>Status<select name="status" value={form.status} onChange={change}><option value="draft">Draft</option><option value="planned">Planned</option><option value="booked">Booked</option><option value="completed">Completed</option></select></label>
        {form.status === 'completed' && <p className="inline-note">After saving, you can choose whether to share this trip as a reference for other travelers.</p>}
        <div className="form-actions">
          <button className="button" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create trip'} <span aria-hidden="true">↗</span></button>
          <Link className="text-link" to={editing ? `/trips/${id}` : '/trips'}>Cancel</Link>
        </div>
      </form>
      <aside className="side-panel">
        <p className="eyebrow">AI itinerary</p>
        <h2>Ideas for the days between.</h2>
        <p>Generate a draft from your destination, dates, and budget. Adjust each day, time, stop, and estimate before saving. Confirm provider details directly.</p>
        {editing && resource.data?.items?.length > 0 && <p className="inline-note">This trip already has {resource.data.items.length} saved stops. Generate a replacement only if you want to replace them.</p>}
        <label>Travel preferences<textarea name="preferences" value={form.preferences || ''} onChange={change} maxLength="500" rows="3" placeholder="Nature walks, local food, a slower pace…" /></label>
        <button className="button button-outline" type="button" onClick={generate} disabled={busy || !form.destination || !form.start_date || !form.end_date || !form.budget}>{busy ? 'Working…' : 'Generate itinerary'}</button>
        {aiMessage && <p className="inline-note" aria-live="polite">{aiMessage}</p>}
        {itinerary.length > 0 && <div className="itinerary-preview">{itinerary.map((item, index) => <div className="itinerary-line" key={`${item.day}-${index}`}>
          <label>Day<input type="number" min="1" max={Math.max(1, Math.ceil((new Date(`${form.end_date}T00:00:00`) - new Date(`${form.start_date}T00:00:00`)) / 86400000) + 1)} value={item.day} onChange={(event) => setItinerary((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, day: Number(event.target.value) } : entry))} /></label>
          <label>Time<input type="time" value={item.time || ''} required onChange={(event) => setItinerary((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, time: event.target.value } : entry))} /></label>
          <label>Type<select value={item.type} onChange={(event) => setItinerary((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, type: event.target.value } : entry))}><option value="activity">Activity</option><option value="transport">Transport</option><option value="stay">Stay</option></select></label>
          <label>Stop<textarea maxLength="255" rows="2" value={item.description} required onChange={(event) => setItinerary((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, description: event.target.value } : entry))} /></label>
          <label>Estimated cost (PHP)<input type="number" min="0" max="99999999.99" step="0.01" value={item.estimated_cost} onChange={(event) => setItinerary((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, estimated_cost: Number(event.target.value) } : entry))} /></label>
          <label>Estimated CO2 (kg)<input type="number" min="0" max="9999.99" step="0.01" value={item.estimated_co2_kg} onChange={(event) => setItinerary((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, estimated_co2_kg: Number(event.target.value) } : entry))} /></label>
        </div>)}</div>}
      </aside>
    </div>
  </Shell>;
}

function itineraryEditorValues(item) {
  return {
    day: Number(item.day_number),
    time: String(item.start_time || '').slice(0, 5),
    type: item.item_type,
    description: item.description || '',
    estimated_cost: item.est_cost ?? 0,
    estimated_co2_kg: item.est_co2_kg ?? 0,
    completed: Boolean(Number(item.completed)),
    experience_notes: item.experience_notes || '',
    share_experience: Boolean(Number(item.share_experience)),
  };
}

function ItineraryItemEditor({ item, tripId, maxDay, onSaved }) {
  const [form, setForm] = useState(() => itineraryEditorValues(item));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => setForm(itineraryEditorValues(item)), [item]);
  function change(event) {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : ['day', 'estimated_cost', 'estimated_co2_kg'].includes(name) ? Number(value) : value,
      ...(name === 'completed' && !checked ? { share_experience: false } : {}),
      ...(name === 'experience_notes' && !value.trim() ? { share_experience: false } : {}),
    }));
  }
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.put(`/trips/${tripId}/items/${item.id}`, {
        ...form,
        completed: form.completed,
        share_experience: form.share_experience,
      });
      setOpen(false);
      onSaved();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }
  return <article className="itinerary-stop">
    <div className="data-row"><div><strong>{item.description}</strong><span>Day {item.day_number} / {String(item.start_time || '').slice(0, 5) || 'Time not set'} / {item.item_type}{Number(item.completed) ? ' / Completed' : ''}</span></div><div className="row-actions"><span>{money(item.est_cost)}</span><button className="button button-small button-outline" type="button" onClick={() => setOpen((current) => !current)}>{open ? 'Close' : 'Edit stop'}</button></div></div>
    {open && <form className="surface itinerary-editor" onSubmit={save}>
      <FormError>{error}</FormError>
      <div className="form-grid">
        <label>Day<input name="day" type="number" min="1" max={maxDay} value={form.day} onChange={change} required /></label>
        <label>Time<input name="time" type="time" value={form.time} onChange={change} required /></label>
        <label>Type<select name="type" value={form.type} onChange={change}><option value="activity">Activity</option><option value="transport">Transport</option><option value="stay">Stay</option></select></label>
        <label>Estimated cost (PHP)<input name="estimated_cost" type="number" min="0" max="99999999.99" step="0.01" value={form.estimated_cost} onChange={change} required /></label>
      </div>
      <label>Stop<input name="description" maxLength="255" value={form.description} onChange={change} required /></label>
      <label>Estimated CO2 (kg)<input name="estimated_co2_kg" type="number" min="0" max="9999.99" step="0.01" value={form.estimated_co2_kg} onChange={change} required /></label>
      <label className="check-label"><input name="completed" type="checkbox" checked={form.completed} onChange={change} /> I completed this stop</label>
      <label>Experience notes<textarea name="experience_notes" maxLength="2000" rows="3" value={form.experience_notes} onChange={change} placeholder="Share helpful tips for future travelers…" /></label>
      <label className="check-label"><input name="share_experience" type="checkbox" checked={form.share_experience} disabled={!form.completed || !form.experience_notes.trim()} onChange={change} /> Share these notes in traveler experiences (opt-in)</label>
      <div className="form-actions"><button className="button button-small" disabled={busy}>{busy ? 'Saving…' : 'Save stop'}</button></div>
    </form>}
  </article>;
}

function TripExperienceShare({ trip, prompted, onDismiss, onSaved }) {
  const [editing, setEditing] = useState(prompted);
  const [notes, setNotes] = useState(trip.experience_notes || '');
  const [rating, setRating] = useState(String(trip.experience_rating || ''));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setNotes(trip.experience_notes || ''), [trip.experience_notes]);
  useEffect(() => setRating(String(trip.experience_rating || '')), [trip.experience_rating]);
  useEffect(() => {
    if (prompted) setEditing(true);
  }, [prompted]);

  function dismiss() {
    setEditing(false);
    onDismiss();
  }

  async function save(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.put(`/trips/${trip.id}/experience`, {
        share_experience: true,
        experience_notes: notes,
        experience_rating: Number(rating),
      });
      setEditing(false);
      onSaved();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function stopSharing() {
    setError('');
    setBusy(true);
    try {
      await api.put(`/trips/${trip.id}/experience`, {
        share_experience: false,
        experience_notes: notes,
      });
      onSaved();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  const editor = <section className="surface trip-experience-panel" aria-labelledby={`trip-experience-title-${trip.id}`}>
    <p className="eyebrow">{prompted ? 'Trip completed' : 'Traveler reference'}</p>
    <h2 id={`trip-experience-title-${trip.id}`}>Would you like to share this trip?</h2>
    <p>Your notes will appear in Traveler experiences for other users. Your name and account details will not be shown.</p>
    <form className="form-stack" onSubmit={save}>
      <FormError>{error}</FormError>
      <fieldset className="experience-rating-fieldset">
        <legend>Rate this trip <span aria-hidden="true">(required)</span></legend>
        <div className="experience-rating-picker" role="group" aria-label="Rate this trip from 1 to 5 stars">
          {[1, 2, 3, 4, 5].map((value) => <button
            className={Number(rating) >= value ? 'selected' : ''}
            type="button"
            key={value}
            aria-label={`${value} out of 5 stars`}
            aria-pressed={Number(rating) === value}
            onClick={() => setRating(String(value))}
          >★</button>)}
          <span>{rating ? `${rating} out of 5` : 'Select a rating'}</span>
        </div>
      </fieldset>
      <label>What should future travelers know?<textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength="2000" rows="5" required placeholder="Share practical tips, highlights, or advice about this trip…" /></label>
      <div className="form-actions">
        <button className="button" disabled={busy || !notes.trim() || !rating}>{busy ? 'Sharing…' : 'Share as a reference'}</button>
        <button className="button button-outline" type="button" onClick={dismiss} disabled={busy}>Not now</button>
      </div>
    </form>
  </section>;

  return (
    <>
      {editing ? prompted
        ? <div className="experience-dialog-backdrop" role="presentation"><div role="dialog" aria-modal="true" aria-labelledby={`trip-experience-title-${trip.id}`}>{editor}</div></div>
        : editor
        : <section className="surface trip-experience-panel">
          <p className="eyebrow">Traveler reference</p>
          <h2>{Number(trip.share_experience) ? 'Your trip is shared.' : 'Help other travelers.'}</h2>
          <p>{Number(trip.share_experience) ? 'Your reference is visible in Traveler experiences. You can update or remove it at any time.' : 'Share a few first-hand tips so other travelers can plan with confidence.'}</p>
          {Number(trip.share_experience) > 0 && <p className="experience-rating" aria-label={`${trip.experience_rating} out of 5 stars`}>{'★'.repeat(Number(trip.experience_rating) || 0)}{'☆'.repeat(5 - (Number(trip.experience_rating) || 0))} <small>{trip.experience_rating ? `${trip.experience_rating}/5` : 'Not rated'}</small></p>}
          <FormError>{error}</FormError>
          <div className="form-actions">
            <button className="button button-small" type="button" onClick={() => setEditing(true)}>{Number(trip.share_experience) ? 'Edit reference' : 'Share this trip'}</button>
            {Number(trip.share_experience) > 0 && <button className="button button-small button-outline" type="button" onClick={stopSharing} disabled={busy}>{busy ? 'Removing…' : 'Remove reference'}</button>}
          </div>
        </section>}
    </>
  );
}

function TripDetail() {
  const { id } = useParams(); const navigate = useNavigate(); const location = useLocation(); const resource = useResource(`/trips/${id}`); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [promptExperience, setPromptExperience] = useState(false);
  const trip = resource.data?.trip; const items = resource.data?.items || [];
  useEffect(() => {
    if (trip && location.state?.promptExperience) {
      setPromptExperience(!Number(trip.share_experience));
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [trip?.id, trip?.share_experience, location.key, location.pathname, location.state, navigate]);
  async function remove() { if (!window.confirm('Delete this trip and its itinerary? This cannot be undone.')) return; setBusy(true); try { await api.delete(`/trips/${id}`); navigate('/trips'); } catch (requestError) { setError(requestError.message); setBusy(false); } }
  const maxDay = trip ? Math.max(1, Math.floor((new Date(`${trip.end_date}T00:00:00`) - new Date(`${trip.start_date}T00:00:00`)) / 86400000) + 1) : 1;
  return <Shell><LoadState {...resource} retry={resource.reload}>{trip && <><PageHeading eyebrow={trip.destination} title={trip.title} copy={`${dateLabel(trip.start_date)} – ${dateLabel(trip.end_date)}`} action={<Link className="button" to={`/trips/${id}/edit`}>Edit trip</Link>} /><FormError>{error}</FormError><div className="stat-grid"><div className="stat-card"><span>Budget</span><strong>{money(trip.budget)}</strong></div><div className="stat-card"><span>Travelers</span><strong>{trip.travelers}</strong></div><div className="stat-card"><span>Status</span><strong className="stat-word">{trip.status}</strong></div></div>{trip.status === 'completed' && <TripExperienceShare trip={trip} prompted={promptExperience} onDismiss={() => setPromptExperience(false)} onSaved={resource.reload} />}<section className="section-block"><div className="section-title"><div><p className="eyebrow">Your itinerary</p><h2>Days on the ground</h2></div><Link className="text-link" to={`/experiences?location=${encodeURIComponent(trip.destination)}`}>Traveler experiences near {trip.destination} ↗</Link></div>{items.length ? <div className="data-list">{items.map((item) => <ItineraryItemEditor item={item} tripId={id} maxDay={maxDay} onSaved={resource.reload} key={item.id} />)}</div> : <EmptyState action={<Link className="text-link" to={`/trips/${id}/edit`}>Add trip details ↗</Link>}>No saved itinerary items yet.</EmptyState>}</section><button className="button button-danger" onClick={remove} disabled={busy}>{busy ? 'Deleting…' : 'Delete trip'}</button></>}</LoadState></Shell>;
}

function ExperienceCard({ experience }) {
  const [expanded, setExpanded] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyForm, setCopyForm] = useState(null);
  const [copyError, setCopyError] = useState('');
  const [copyBusy, setCopyBusy] = useState(false);
  const navigate = useNavigate();
  const isTrip = experience.reference_type === 'trip';
  const detailsId = `experience-details-${experience.reference_type || 'stop'}-${experience.id}`;

  function startCopy() {
    const duration = Math.max(1, Math.round((new Date(`${experience.end_date}T00:00:00Z`) - new Date(`${experience.start_date}T00:00:00Z`)) / 86400000) + 1);
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + 30);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + duration - 1);
    setCopyForm({
      title: `Copy of ${experience.description}`.slice(0, 150),
      start_date: start.toISOString().slice(0, 10),
      end_date: end.toISOString().slice(0, 10),
      budget: '',
      travelers: '1',
    });
    setCopyError('');
    setCopying(true);
  }

  async function copyTrip(event) {
    event.preventDefault();
    setCopyBusy(true);
    setCopyError('');
    try {
      const data = await api.post(`/experiences/${experience.id}/copy`, {
        ...copyForm,
        budget: Number(copyForm.budget),
        travelers: Number(copyForm.travelers),
      });
      navigate(`/trips/${data.trip.id}`);
    } catch (requestError) {
      setCopyError(requestError.message);
    } finally {
      setCopyBusy(false);
    }
  }

  return <article className={`surface experience-card${isTrip ? ' experience-card-trip' : ''}`}>
    <p className="eyebrow">{experience.location}{isTrip ? ' · Full trip reference' : ` · Day ${experience.day_number}`}</p>
    <div className="experience-card-heading">
      <h2>{experience.description}</h2>
      {isTrip && <p className="experience-rating" aria-label={experience.experience_rating ? `${experience.experience_rating} out of 5 stars` : 'Not rated'}>{experience.experience_rating ? <>{'★'.repeat(Number(experience.experience_rating))}{'☆'.repeat(5 - Number(experience.experience_rating))} <small>{experience.experience_rating}/5</small></> : <small>Not rated</small>}</p>}
    </div>
    {!isTrip ? <>
      <p>{experience.experience_notes}</p>
      <small>{experience.item_type} · {String(experience.start_time || '').slice(0, 5) || 'Time not set'}</small>
    </> : <>
      <p className="experience-dates">{dateLabel(experience.start_date)} – {dateLabel(experience.end_date)}</p>
      <button className="button button-small button-outline experience-expand-button" type="button" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded((current) => !current)}>
        {expanded ? 'Hide trip details' : `View trip details${experience.places?.length ? ` · ${experience.places.length} places` : ''}`}
      </button>
      {expanded && <div id={detailsId} className="experience-details">
        <h3>Places visited</h3>
        {experience.places?.length ? <ol className="experience-places">{experience.places.map((place, index) => <li key={`${place.day_number}-${place.start_time}-${index}`}><span>Day {place.day_number}</span><strong>{place.description}</strong><small>{place.item_type} · {String(place.start_time || '').slice(0, 5) || 'Time not set'}</small></li>)}</ol> : <p>No itinerary places were added to this trip.</p>}
        <h3>Traveler's notes</h3>
        <p>{experience.experience_notes}</p>
      </div>}
      {!copying ? <button className="button button-small experience-copy-button" type="button" onClick={startCopy}>Use as trip template</button> : <form className="experience-copy-form" onSubmit={copyTrip}>
        <p className="inline-note">This creates a private draft with editable itinerary stops. Choose your dates and budget; it will not be shared publicly.</p>
        <FormError>{copyError}</FormError>
        <label>Trip title<input value={copyForm.title} maxLength="150" onChange={(event) => setCopyForm((current) => ({ ...current, title: event.target.value }))} required /></label>
        <div className="form-grid">
          <label>Start date<input type="date" value={copyForm.start_date} onChange={(event) => setCopyForm((current) => ({ ...current, start_date: event.target.value }))} required /></label>
          <label>End date<input type="date" value={copyForm.end_date} onChange={(event) => setCopyForm((current) => ({ ...current, end_date: event.target.value }))} required /></label>
          <label>Budget (PHP)<input type="number" min="1" step="0.01" value={copyForm.budget} onChange={(event) => setCopyForm((current) => ({ ...current, budget: event.target.value }))} required /></label>
          <label>Travelers<input type="number" min="1" max="50" value={copyForm.travelers} onChange={(event) => setCopyForm((current) => ({ ...current, travelers: event.target.value }))} required /></label>
        </div>
        <div className="form-actions"><button className="button button-small" disabled={copyBusy}>{copyBusy ? 'Creating draft…' : 'Create editable draft'}</button><button className="button button-small button-outline" type="button" onClick={() => setCopying(false)} disabled={copyBusy}>Cancel</button></div>
      </form>}
      <small>Completed trip · shared by its traveler</small>
    </>}
  </article>;
}

function Experiences() {
  const [params, setParams] = useSearchParams();
  const location = params.get('location') || '';
  const [search, setSearch] = useState(location);
  const path = `/experiences${location ? `?location=${encodeURIComponent(location)}` : ''}`;
  const resource = useResource(path);
  function submit(event) {
    event.preventDefault();
    const next = new URLSearchParams();
    if (search.trim()) next.set('location', search.trim());
    setParams(next);
  }
  return <Shell><PageHeading eyebrow="Shared by travelers" title="Experiences, from the ground." copy="Find first-hand trip references and notes about completed itinerary stops, shared by travelers who opted in." />
    <form className="surface compact-form experience-search" onSubmit={submit}><label>Location or stop<input value={search} onChange={(event) => setSearch(event.target.value)} maxLength="100" placeholder="Search a destination or activity" /></label><button className="button">Search experiences</button></form>
    <LoadState {...resource} retry={resource.reload}>{resource.data?.experiences?.length ? <div className="experience-grid">{resource.data.experiences.map((experience) => <ExperienceCard experience={experience} key={`${experience.reference_type || 'stop'}-${experience.id}`} />)}</div> : <EmptyState>{location ? `No shared completed experiences found for “${location}”.` : 'No travelers have shared completed experiences yet.'}</EmptyState>}</LoadState>
  </Shell>;
}

function Stays() {
  const [params, setParams] = useSearchParams();
  const destination = params.get('destination') || '';
  const stayType = params.get('type') || 'all';
  const [search, setSearch] = useState(destination);
  const query = new URLSearchParams();
  if (destination) query.set('destination', destination);
  if (stayType !== 'all') query.set('type', stayType);
  const queryString = query.toString();
  const endpoint = `/stays${queryString ? `?${queryString}` : ''}`;
  const resource = useResource(endpoint);
  const { user } = useAuth();
  const stays = resource.data?.stays || [];
  const nearby = resource.data?.nearby_hotels || [];
  useEffect(() => { setSearch(destination); }, [destination]);

  function searchSubmit(event) {
    event.preventDefault();
    const nextParams = {};
    if (search.trim()) nextParams.destination = search.trim();
    if (stayType !== 'all') nextParams.type = stayType;
    setParams(nextParams);
  }

  function changeStayType(event) {
    const nextType = event.target.value;
    const nextParams = {};
    if (destination) nextParams.destination = destination;
    if (nextType !== 'all') nextParams.type = nextType;
    setParams(nextParams);
  }

  return (
    <Shell>
      <PageHeading eyebrow="Stay well" title="Places to stay." copy="Search EcoTrip listings, including standard non-eco-rated hotels, alongside nearby mapped accommodations. Confirm availability and prices with providers." />
      <form className="search-bar" onSubmit={searchSubmit}>
        <label className="visually-hidden" htmlFor="stay-destination">Destination</label>
        <input id="stay-destination" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search a destination" />
        <label className="visually-hidden" htmlFor="stay-type">Stay type</label>
        <select id="stay-type" value={stayType} onChange={changeStayType}>
          <option value="all">All stays</option>
          <option value="green">Eco-rated</option>
          <option value="standard">Standard, not eco-rated</option>
        </select>
        <button className="button" type="submit">Search <span aria-hidden="true">↗</span></button>
      </form>
      <LoadState {...resource} retry={resource.reload}>
        <section className="section-block">
          <div className="section-title"><div><p className="eyebrow">EcoTrip directory</p><h2>Listed stays</h2></div></div>
          {stays.length ? <div className="stay-grid">{stays.map((stay) => <Link className="stay-card" to={`/stays/${stay.id}`} key={stay.id}><span className="stay-rating">{Number(stay.eco_rating) > 0 ? `Eco-rated ${stay.eco_rating}/5` : 'Standard, not eco-rated'}</span><h3>{stay.name}</h3><p>{stay.location}</p><strong>{money(stay.price_per_night)} <small>/ night</small></strong></Link>)}</div> : <EmptyState>No {stayType === 'green' ? 'eco-rated' : stayType === 'standard' ? 'standard' : ''} stays match this destination in the EcoTrip directory.</EmptyState>}
        </section>
        {destination && <section className="section-block">
          <div className="section-title"><div><p className="eyebrow">OpenStreetMap</p><h2>Nearby accommodations</h2></div></div>
          <p className="inline-note">Mapped places are not live vacancy listings or eco certifications. Contact each provider to confirm availability, rates, and details.</p>
          {resource.data?.hotel_search_error && <div className="inline-note">{resource.data.hotel_search_error}</div>}
          {nearby.length ? <div className="nearby-grid">{nearby.map((hotel, index) => <NearbyCard key={`${hotel.name}-${index}`} hotel={hotel} user={user} />)}</div> : <EmptyState>{resource.data?.hotel_search_error ? 'Nearby accommodation search is temporarily unavailable.' : 'No nearby accommodations were mapped for this destination. Try a nearby city or a more specific destination.'}</EmptyState>}
        </section>}
      </LoadState>
    </Shell>
  );
}

function NearbyCard({ hotel, user }) {
  const [trips, setTrips] = useState([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (user) api.get('/trips').then((data) => setTrips(data.trips || [])).catch((requestError) => setError(requestError.message)); }, [user]);
  async function payDirectly(event) { event.preventDefault(); setError(''); setBusy(true); const form = new FormData(event.currentTarget); try { const data = await api.post('/stays/nearby/checkout', { trip_id: Number(form.get('trip_id')), reservation_name: hotel.name, reservation_address: hotel.address || hotel.location || hotel.name }); if (typeof data.checkout_url !== 'string' || !data.checkout_url.startsWith('https://')) throw new Error('PayMongo did not return a valid checkout link. Please try again.'); window.location.assign(data.checkout_url); } catch (requestError) { setError(requestError.message); setBusy(false); } }
  return <article className="nearby-card"><p className="eyebrow">Mapped · {hotel.kind || 'Accommodation'} · Eco status unverified</p><h3>{hotel.name}</h3><p>{hotel.address || hotel.location || 'Address not listed'}</p><p className="inline-note">Pay the configured reservation deposit through PayMongo. Confirm availability and the full rate directly with the property.</p>{user ? trips.length ? <form className="compact-form" onSubmit={payDirectly}><label>Trip<select name="trip_id" required defaultValue=""><option value="" disabled>Select a trip</option>{trips.map((trip) => <option value={trip.id} key={trip.id}>{trip.title} / {trip.start_date}</option>)}</select></label><button className="button button-small" disabled={busy}>{busy ? 'Opening PayMongo…' : 'Pay deposit with PayMongo'}</button></form> : <p className="inline-note">Plan an overnight trip before paying the reservation deposit.</p> : <Link className="text-link" to="/login">Sign in to pay with PayMongo ↗</Link>}<FormError>{error}</FormError></article>;
}

function StayDetail() {
  const { id } = useParams(); const { user } = useAuth(); const resource = useResource(`/stays/${id}`); const tripsResource = useResource('/trips', Boolean(user)); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [selectedTripId, setSelectedTripId] = useState('');
  const stay = resource.data?.stay;
  const selectedTrip = tripsResource.data?.trips?.find((trip) => String(trip.id) === selectedTripId);
  const nights = selectedTrip
    ? Math.round((Date.parse(`${selectedTrip.end_date}T00:00:00Z`) - Date.parse(`${selectedTrip.start_date}T00:00:00Z`)) / 86400000)
    : 0;
  const estimatedTotal = stay && nights > 0 ? Number(stay.price_per_night) * nights : null;
  async function checkout(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await api.post(`/stays/${id}/checkout`, { trip_id: Number(selectedTripId) });
      if (typeof data.checkout_url !== 'string' || !data.checkout_url.startsWith('https://')) {
        throw new Error('PayMongo did not return a valid checkout link. Please try again.');
      }
      window.location.assign(data.checkout_url);
    } catch (requestError) {
      setError(requestError.message);
      setBusy(false);
    }
  }
  return <Shell><LoadState {...resource} retry={resource.reload}>{stay && <><PageHeading eyebrow={stay.location} title={stay.name} copy={stay.description} /><div className="stay-detail"><section className="surface"><span className="stay-rating">{Number(stay.eco_rating) > 0 ? `Eco-rated ${stay.eco_rating}/5` : 'Standard stay'}</span><p className="price-large">{money(stay.price_per_night)} <small>/ night</small></p>{stay.certification && <p className="inline-note">{stay.certification}</p>}<p>Choose your trip to calculate the stay total. Secure checkout is handled by PayMongo.</p></section><aside className="side-panel"><p className="eyebrow">Book this stay</p><h2>Choose an overnight trip.</h2>{user ? <LoadState {...tripsResource} retry={tripsResource.reload}>{tripsResource.data?.trips?.length ? <form className="form-stack" onSubmit={checkout}><label>Trip<select name="trip_id" required value={selectedTripId} onChange={(event) => setSelectedTripId(event.target.value)}><option value="" disabled>Select a trip</option>{tripsResource.data.trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.title} / {trip.start_date} – {trip.end_date}</option>)}</select></label>{estimatedTotal !== null ? <p className="inline-note">Estimated total: {money(estimatedTotal)} for {nights} {nights === 1 ? 'night' : 'nights'}. Pay with GCash, Maya, QR Ph, or card at PayMongo checkout.</p> : selectedTrip && <p className="inline-note">Choose a trip with at least one night to book this stay.</p>}<FormError>{error}</FormError><button className="button" disabled={busy || !selectedTripId || nights < 1}>{busy ? 'Opening PayMongo…' : 'Continue to PayMongo'} <span aria-hidden="true">↗</span></button></form> : <EmptyState action={<Link to="/trips/new" className="text-link">Plan an overnight trip ↗</Link>}>Create an upcoming overnight trip first.</EmptyState>}</LoadState> : <Link to="/login" className="button">Sign in to book <span aria-hidden="true">↗</span></Link>}</aside></div></>}</LoadState></Shell>;
}

function TransportMap({ options, selectedDestination, userAddress, selectedIndex, onSelect }) {
  const mapElement = useRef(null);
  const mapRef = useRef(null);
  const routeLayers = useRef([]);
  const onSelectRef = useRef(onSelect);
  const [mapError, setMapError] = useState('');
  onSelectRef.current = onSelect;

  useEffect(() => {
    let active = true;
    setMapError('');

    loadLeaflet().then(async (L) => {
      if (!active || !mapElement.current) return;
      const map = L.map(mapElement.current, { scrollWheelZoom: false });
      mapRef.current = map;
      const layer = L.featureGroup().addTo(map);
      const plotted = [];
      const colors = ['#bd5f43', '#347654', '#367b93', '#bd8a36', '#6f6a9a', '#638248', '#9b5367'];
      const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
      })[character]);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      }).addTo(map);

      try {
        for (const [index, route] of options.entries()) {
          let origin;
          let destination;
          try {
            [origin, destination] = await Promise.all([
              routeLocation(route.origin),
              routeLocation(route.destination),
            ]);
          } catch {
            continue;
          }
          if (!active) return;
          if (!origin || !destination) continue;

          let geometry = null;
          try {
            geometry = await routeGeometry(origin, destination, route.mode);
          } catch {
            geometry = null;
          }
          if (!active) return;

          const color = colors[index % colors.length];
          const line = L.polyline(geometry || [origin, destination], {
            color,
            weight: 5,
            opacity: 0.85,
          }).addTo(layer);
          const googleModes = {
            bus: 'transit', train: 'transit', ferry: 'transit',
            bike: 'bicycling', walk: 'walking', carpool: 'driving',
          };
          const googleUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(route.origin)}&destination=${encodeURIComponent(route.destination)}&travelmode=${googleModes[route.mode] || 'transit'}`;
          line.bindPopup(`<strong>${escapeHtml(route.origin)} &rarr; ${escapeHtml(route.destination)}</strong><br>${escapeHtml(route.mode)} &middot; ${Number(route.distance_km || 0).toFixed(1)} km &middot; Est. ${escapeHtml(route.estimated_duration || 'unavailable')}<br><a href="${googleUrl}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a>`);
          line.on('click', () => onSelectRef.current(index));
          L.circleMarker(origin, { radius: 7, color, fillColor: '#fff', fillOpacity: 1, weight: 2 })
            .bindTooltip(escapeHtml(route.origin)).addTo(layer);
          L.circleMarker(destination, { radius: 8, color, fillColor: color, fillOpacity: 1, weight: 2 })
            .bindTooltip(escapeHtml(route.destination)).addTo(layer);
          routeLayers.current[index] = { line, color };
          plotted.push(origin, destination);
        }

        if (selectedDestination) {
          try {
            const destination = await routeLocation(selectedDestination);
            if (active && destination) {
              L.circleMarker(destination, {
                radius: 10, color: '#347654', fillColor: '#bd5f43', fillOpacity: 0.9, weight: 3,
              }).bindTooltip(`Planned destination: ${escapeHtml(selectedDestination)}`).addTo(layer);
              plotted.push(destination);

              if (userAddress) {
                try {
                  const origin = await routeLocation(userAddress);
                  if (active && origin) {
                    const homeGeometry = await routeGeometry(origin, destination, 'carpool').catch(() => null);
                    if (active) {
                      L.polyline(homeGeometry || [origin, destination], {
                        color: '#25301f', weight: 4, opacity: 0.8, dashArray: '8 10',
                      }).bindPopup(`<strong>Home to trip destination</strong><br>${escapeHtml(userAddress)} &rarr; ${escapeHtml(selectedDestination)}`)
                        .addTo(layer);
                      L.circleMarker(origin, {
                        radius: 9, color: '#25301f', fillColor: '#f3ede2', fillOpacity: 1, weight: 3,
                      }).bindTooltip('Your home address').addTo(layer);
                      plotted.push(origin);
                    }
                  }
                } catch {
                  if (active) setMapError('Your home address could not be located; the trip destination is still shown.');
                }
              }
            }
          } catch {
            if (active) setMapError('The selected trip destination could not be located.');
          }
        }

        if (!active) return;
        if (plotted.length) map.fitBounds(L.latLngBounds(plotted).pad(0.12));
        else map.setView([12.8, 122], 5);
        window.requestAnimationFrame(() => { if (active) map.invalidateSize(false); });
      } catch {
        if (active) setMapError('Route locations could not be loaded. The map is still available for browsing.');
        map.setView([12.8, 122], 5);
      }
    }).catch((error) => {
      if (active) setMapError(error.message);
    });

    return () => {
      active = false;
      routeLayers.current = [];
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [options, selectedDestination, userAddress]);

  useEffect(() => {
    routeLayers.current.forEach((route, index) => {
      if (!route) return;
      const selected = index === selectedIndex;
      route.line.setStyle({ weight: selected ? 7 : 4, opacity: selected ? 1 : 0.65 });
      if (selected && mapRef.current) {
        mapRef.current.fitBounds(route.line.getBounds(), { padding: [36, 36], maxZoom: 9 });
      }
    });
  }, [selectedIndex]);

  return (
    <section className="route-map-panel" aria-label="Map and route options">
      <div className="section-title">
        <div><p className="eyebrow">OpenStreetMap</p><h2>Route map</h2></div>
      </div>
      <div ref={mapElement} className="route-map" role="region" aria-label="Map of low-carbon routes" />
      <p className="map-note">Route lines are approximate; check current directions and schedules with providers. Map data © OpenStreetMap contributors.</p>
      {mapError && <p className="inline-note" role="status">{mapError}</p>}
    </section>
  );
}

function Transport() {
  const [params, setParams] = useSearchParams();
  const tripId = params.get('trip_id') || '';
  const resource = useResource(`/transport${tripId ? `?trip_id=${encodeURIComponent(tripId)}` : ''}`);
  const options = resource.data?.options || [];
  const trips = resource.data?.trips || [];
  const selectedTrip = resource.data?.selected_trip;
  const plannedTravel = resource.data?.planned_travel || [];
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const googleModes = { bus: 'transit', train: 'transit', ferry: 'transit', bike: 'bicycling', walk: 'walking', carpool: 'driving' };

  function chooseTrip(event) {
    const nextTripId = event.target.value;
    setParams(nextTripId ? { trip_id: nextTripId } : {});
    setSelectedIndex(-1);
  }

  return (
    <Shell>
      <PageHeading eyebrow="Get there" title="Take the scenic route." copy="Compare lower-carbon routes, see approximate routes on the map, and open current directions with a provider." />
      <form className="search-bar route-trip-filter" onSubmit={(event) => event.preventDefault()}>
        <label htmlFor="route-trip">Show routes for a trip</label>
        <select id="route-trip" value={selectedTrip?.id || ''} onChange={chooseTrip}>
          <option value="">All route options</option>
          {trips.map((trip) => <option value={trip.id} key={trip.id}>{trip.title} · {trip.destination}</option>)}
        </select>
      </form>
      <LoadState {...resource} retry={resource.reload}>
        {selectedTrip && <section className="planned-travel-panel">
          <div className="section-title"><div><p className="eyebrow">Your trip</p><h2>Planned travel · {selectedTrip.title}</h2></div><Link className="text-link" to={`/trips/${selectedTrip.id}`}>View itinerary ↗</Link></div>
          {plannedTravel.length ? <div className="data-list">{plannedTravel.map((item, index) => <div className="data-row" key={item.id || index}><div><strong>{item.description}</strong><span>Day {item.day_number} · {item.start_time || 'Time TBD'}</span></div><span>{money(item.est_cost)}</span></div>)}</div> : <EmptyState>No transport stops are saved in this trip’s itinerary yet.</EmptyState>}
        </section>}
        <TransportMap
          options={options}
          selectedDestination={selectedTrip?.destination || ''}
          userAddress={resource.data?.user_address || ''}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
        />
        <section className="section-block">
          <div className="section-title"><div><p className="eyebrow">{selectedTrip ? 'For this destination' : 'Lower-impact options'}</p><h2>{selectedTrip ? `Routes near ${selectedTrip.destination}` : 'Route options'}</h2></div></div>
          {options.length ? <div className="route-grid">{options.map((route, index) => {
            const googleUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(route.origin)}&destination=${encodeURIComponent(route.destination)}&travelmode=${googleModes[route.mode] || 'transit'}`;
            return <article className={`route-card${selectedIndex === index ? ' is-selected' : ''}`} key={route.id}>
              <button className="route-select" type="button" onClick={() => setSelectedIndex(index)} aria-pressed={selectedIndex === index}>
                <span className="route-mode">{route.mode}</span>
                <h3>{route.origin} <span aria-hidden="true">→</span> {route.destination}</h3>
                <div className="route-metrics"><span>{Number(route.distance_km).toLocaleString()} km</span><span>Est. {route.estimated_duration}</span><span>{Number(route.co2_kg_per_person).toFixed(1)} kg CO2 / person</span><strong>{money(route.cost)}</strong></div>
              </button>
              <a className="text-link" href={googleUrl} target="_blank" rel="noopener noreferrer">Open directions in Google Maps ↗</a>
            </article>;
          })}</div> : <EmptyState>{selectedTrip ? 'No catalog routes match this trip destination yet. Its planned travel is shown above.' : 'No transport options are currently listed.'}</EmptyState>}
        </section>
      </LoadState>
    </Shell>
  );
}

function Bookings() {
  const resource = useResource('/bookings'); const tripsResource = useResource('/trips'); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function checkout(event) { event.preventDefault(); setError(''); setBusy(true); const form = new FormData(event.currentTarget); try { const data = await api.post('/bookings/checkout', { trip_id: Number(form.get('trip_id')), category: form.get('category'), description: form.get('description'), amount: Number(form.get('amount')) }); window.location.assign(data.checkout_url); } catch (requestError) { setError(requestError.message); setBusy(false); } }
  return <Shell><PageHeading eyebrow="Payments & offsets" title="Bookings." copy="Review reservations and pay for trip expenses securely through PayMongo."/><section className="surface booking-create"><div><p className="eyebrow">Trip payments</p><h2>Pay for more than stays.</h2><p>Start checkout for transport, activities, other trip expenses, or a carbon offset. Hotel reservations continue through Green Stays.</p></div><LoadState {...tripsResource} retry={tripsResource.reload}>{tripsResource.data?.trips?.length ? <form className="compact-form" onSubmit={checkout}><label>Trip<select name="trip_id" required defaultValue=""><option value="" disabled>Select a trip</option>{tripsResource.data.trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.title}</option>)}</select></label><label>Payment type<select name="category" defaultValue="transport" required><option value="transport">Transport</option><option value="activity">Activity / tour</option><option value="other">Other trip expense</option><option value="carbon_offset">Carbon offset</option></select></label><label>Description<input name="description" maxLength="150" placeholder="e.g. ferry tickets" required /></label><label>Amount (PHP)<input name="amount" type="number" min="1" max="1000000" step="0.01" defaultValue="250" required /></label><button className="button" disabled={busy}>{busy ? 'Opening checkout…' : 'Continue to PayMongo'} <span aria-hidden="true">↗</span></button></form> : <EmptyState action={<Link className="text-link" to="/trips/new">Plan a trip first ↗</Link>}>Add a trip before creating a payment.</EmptyState>}</LoadState><FormError>{error}</FormError></section><section className="section-block"><div className="section-title"><div><p className="eyebrow">Your records</p><h2>Recent bookings &amp; payments</h2></div></div><LoadState {...resource} retry={resource.reload}>{resource.data?.bookings?.length ? <div className="data-list">{resource.data.bookings.map((booking) => <div className="data-row" key={booking.id}><div><strong>{booking.stay_name || booking.reservation_name || `Trip #${booking.trip_id}`}</strong><span>{booking.trip_title || 'Trip'} / {booking.payment_category?.replaceAll('_', ' ') || 'payment'} / {dateLabel(booking.created_at?.slice(0, 10))} / {booking.paymongo_ref || 'No payment reference'}</span></div><div className="row-actions"><span className={`status-tag status-${booking.payment_status}`}>{booking.payment_status}</span>{booking.payment_status === 'paid' && <Link className="text-link" to={`/bookings/${booking.id}/receipt`}>Receipt ↗</Link>}{booking.payment_status === 'pending' && <VerifyButton id={booking.id} onVerified={resource.reload} />}</div></div>)}</div> : <EmptyState>No bookings yet.</EmptyState>}</LoadState></section></Shell>;
}

function VerifyButton({ id, onVerified }) { const [error, setError] = useState(''); const [busy, setBusy] = useState(false); async function verify() { setBusy(true); setError(''); try { await api.post(`/bookings/${id}/verify`); onVerified(); } catch (requestError) { setError(requestError.message); } finally { setBusy(false); } } return <span><button className="button button-small button-outline" onClick={verify} disabled={busy}>{busy ? 'Checking…' : 'Check payment'}</button>{error && <span className="small-error">{error}</span>}</span>; }

function Receipt() {
  const { id } = useParams(); const resource = useResource(`/bookings/${id}/receipt`); const receipt = resource.data?.receipt;
  return <Shell><LoadState {...resource} retry={resource.reload}>{receipt && <><PageHeading eyebrow="Payment confirmed" title="Your receipt." copy={`Payment #${receipt.id} / ${receipt.trip_title || 'EcoTrip reservation'}`} action={<button className="button button-outline" onClick={() => window.print()}>Print receipt</button>} /><section className="receipt surface"><div><span>Paid to EcoTrip</span><strong>{money(receipt.amount)}</strong></div><dl><dt>Trip</dt><dd>{receipt.trip_title}</dd><dt>Destination</dt><dd>{receipt.destination}</dd><dt>Payment for</dt><dd>{receipt.stay_name || receipt.reservation_name || receipt.payment_category?.replaceAll('_', ' ') || 'Trip expense'}</dd><dt>Payment reference</dt><dd>{receipt.paymongo_ref}</dd><dt>Status</dt><dd>{receipt.payment_status}</dd><dt>Created</dt><dd>{dateLabel(receipt.created_at?.slice(0, 10))}</dd></dl></section></>}</LoadState></Shell>;
}

function PaymentReturn({ cancelled = false }) {
  const [params] = useSearchParams(); const navigate = useNavigate(); const [state, setState] = useState({ loading: true, error: '', result: null });
  const { ready } = useAuth();
  useEffect(() => { if (!ready) return; let active = true; const id = params.get('booking_id'); if (!id) { setState({ loading: false, error: 'The booking reference is missing.', result: null }); return () => { active = false; }; } api.post(`/bookings/${encodeURIComponent(id)}/verify`).then((result) => { if (active) setState({ loading: false, error: '', result }); }).catch((error) => { if (active) setState({ loading: false, error: error.message, result: null }); }); return () => { active = false; }; }, [params, ready]);
  return <Shell><main className="page-wrap"><p className="eyebrow">PayMongo return</p><h1>{state.loading ? 'Checking your payment…' : state.result?.verified ? 'Payment confirmed.' : cancelled ? 'Checkout cancelled.' : 'Payment is still processing.'}</h1>{state.loading ? <div className="state-panel"><span className="spinner" /> Verifying with the payment provider…</div> : <><FormError>{state.error}</FormError><p className="lead">{state.result?.verified ? 'Your booking is up to date.' : 'No payment is assumed from this return. You can check again from Bookings.'}</p><button className="button" onClick={() => navigate('/bookings')}>View bookings <span aria-hidden="true">↗</span></button></>}</main></Shell>;
}

function Journal() {
  const resource = useResource('/journal');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [updatingCaption, setUpdatingCaption] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraMessage, setCameraMessage] = useState('Or choose an image from your device.');
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const videoRef = useRef(null);
  const photoInputRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!cameraOpen || !videoRef.current || !cameraStreamRef.current) return;
    const video = videoRef.current;
    function handlePreviewError() {
      if (!mountedRef.current) return;
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
      video.srcObject = null;
      setCameraOpen(false);
      setCameraMessage('Camera preview could not start. Choose an image from your device instead.');
    }
    try {
      video.srcObject = cameraStreamRef.current;
      video.play().catch(handlePreviewError);
    } catch {
      handlePreviewError();
    }
  }, [cameraOpen]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    };
  }, []);

  function closeCamera() {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
  }

  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraMessage('Live camera is unavailable here. Use the photo picker below; on mobile it can open your camera.');
      return;
    }

    setCameraBusy(true);
    setCameraMessage('Requesting camera access…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' } },
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      cameraStreamRef.current = stream;
      setCameraOpen(true);
      setCameraMessage('Camera is on. Capture a photo when ready.');
    } catch (cameraError) {
      const denied = cameraError.name === 'NotAllowedError' || cameraError.name === 'PermissionDeniedError';
      setCameraMessage(denied
        ? 'Camera permission was denied. Allow camera access in your browser settings, or choose an image from your device.'
        : 'Could not open the camera. Choose an image from your device instead.');
    } finally {
      if (mountedRef.current) setCameraBusy(false);
    }
  }

  function capturePhoto() {
    const video = videoRef.current;
    if (!video?.videoWidth || !video?.videoHeight) {
      setCameraMessage('Wait for the camera preview, then try again.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      setCameraMessage('The camera photo could not be captured. Choose an image from your device instead.');
      return;
    }
    context.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) {
        setCameraMessage('The camera photo could not be captured. Please try again.');
        return;
      }
      try {
        const file = new File([blob], `ecotrip-${Date.now()}.jpg`, { type: 'image/jpeg' });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        if (!photoInputRef.current) {
          setCameraMessage('The photo could not be attached. Please capture it again.');
          return;
        }
        photoInputRef.current.files = transfer.files;
        setSelectedPhoto(file);
        setCameraMessage('Photo captured. Add a caption or upload it to your journal.');
        closeCamera();
      } catch {
        setCameraMessage('The photo could not be attached. Choose an image from your device instead.');
      }
    }, 'image/jpeg', 0.9);
  }

  function choosePhoto(event) {
    const file = event.target.files?.[0] || null;
    setSelectedPhoto(file);
    if (file) setCameraMessage('Photo selected. Add a caption or upload it to your journal.');
  }

  async function upload(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    closeCamera();
    const formElement = event.currentTarget;
    try {
      await api.post('/journal/upload', new FormData(formElement));
      formElement.reset();
      setSelectedPhoto(null);
      setCameraMessage('Or choose an image from your device.');
      resource.reload();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }
  async function updateCaption(event, id) {
    event.preventDefault();
    setError('');
    setUpdatingCaption(true);
    const form = new FormData(event.currentTarget);
    try {
      await api.put(`/journal/${id}`, { caption: form.get('caption') });
      resource.reload();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setUpdatingCaption(false);
    }
  }
  async function remove(id) { if (!window.confirm('Delete this journal photo?')) return; try { await api.delete(`/journal/${id}`); resource.reload(); } catch (requestError) { setError(requestError.message); } }
  return <Shell>
    <PageHeading eyebrow="Keep close" title="Your travel journal." copy="Capture a moment with your camera or choose a photo from your device." />
    <section className="surface upload-panel">
      <p className="eyebrow">Add a memory</p>
      <FormError>{error}</FormError>
      <LoadState {...resource} retry={resource.reload}>
        {resource.data?.trips?.length ? <form className="form-grid journal-form" onSubmit={upload}>
          <label>Trip<select name="trip_id" required defaultValue=""><option value="" disabled>Select a trip</option>{resource.data.trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.title}</option>)}</select></label>
          <div className="journal-photo-field">
            <label htmlFor="journal-photo">Photo</label>
            <div className="journal-camera-controls">
              {!cameraOpen && <button className="button button-outline" type="button" onClick={openCamera} disabled={busy || cameraBusy}>{cameraBusy ? 'Opening camera…' : 'Open camera'}</button>}
              <span className="inline-note" aria-live="polite">{cameraMessage}</span>
            </div>
            {cameraOpen && <div className="journal-camera-panel">
              <video ref={videoRef} autoPlay muted playsInline aria-label="Live camera preview" />
              <div className="journal-camera-actions">
                <button className="button button-small" type="button" onClick={capturePhoto} disabled={busy}>Capture photo</button>
                <button className="button button-small button-outline" type="button" onClick={() => { closeCamera(); setCameraMessage('Camera closed. You can reopen it or choose a photo.'); }}>Close camera</button>
              </div>
            </div>}
            <input ref={photoInputRef} id="journal-photo" type="file" name="photo" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={choosePhoto} required disabled={busy} />
            {selectedPhoto && <span className="journal-photo-name">{selectedPhoto.name} · {(selectedPhoto.size / (1024 * 1024)).toFixed(1)} MB</span>}
          </div>
          <label className="journal-caption">Caption<textarea name="caption" maxLength="255" rows="2" placeholder="A moment worth remembering" /></label>
          <button className="button" disabled={busy}>{busy ? 'Uploading…' : 'Upload photo'} <span aria-hidden="true">↗</span></button>
        </form> : <EmptyState action={<Link className="text-link" to="/trips/new">Create a trip first ↗</Link>}>Your journal entries are attached to a trip.</EmptyState>}
      </LoadState>
    </section>
    <LoadState {...resource} retry={resource.reload}>
      {resource.data?.entries?.length ? <div className="journal-grid">{resource.data.entries.map((entry) => <article className="journal-card" key={entry.id}><img src={assetUrl(entry.photo_path)} alt={entry.caption || 'Travel journal photo'} loading="lazy" /><div><small>{entry.trip_title || 'EcoTrip'} / {dateLabel(entry.taken_at?.slice(0, 10))}</small><form className="journal-caption-form" onSubmit={(event) => updateCaption(event, entry.id)}><label className="visually-hidden" htmlFor={`journal-caption-${entry.id}`}>Caption</label><input id={`journal-caption-${entry.id}`} name="caption" type="text" maxLength="255" defaultValue={entry.caption || ''} placeholder="A moment from the trip" /><button className="text-button" type="submit" disabled={updatingCaption}>{updatingCaption ? 'Saving…' : 'Save caption'}</button><button className="text-button danger-text" type="button" onClick={() => remove(entry.id)}>Delete photo</button></form></div></article>)}</div> : <EmptyState>No journal photos yet.</EmptyState>}
    </LoadState>
  </Shell>;
}

function Reminders() {
  const resource = useResource('/reminders');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyReminderId, setBusyReminderId] = useState(null);
  const [editingId, setEditingId] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await api.post('/reminders', {
        trip_id: Number(form.get('trip_id')),
        message: form.get('message'),
        send_at: form.get('send_at'),
      });
      formElement.reset();
      resource.reload();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function update(event, item) {
    event.preventDefault();
    setError('');
    setBusyReminderId(item.id);
    const form = new FormData(event.currentTarget);
    try {
      await api.put(`/reminders/${item.id}`, {
        trip_id: item.trip_id,
        message: form.get('message'),
        send_at: form.get('send_at'),
      });
      setEditingId(null);
      resource.reload();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyReminderId(null);
    }
  }

  async function remove(item) {
    if (!window.confirm('Delete this pending reminder?')) return;
    setError('');
    setBusyReminderId(item.id);
    try {
      await api.delete(`/reminders/${item.id}`);
      resource.reload();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyReminderId(null);
    }
  }

  return <Shell><PageHeading eyebrow="Gentle prompts" title="Trip reminders." copy="Set a note for the days leading up to your trip."/><LoadState {...resource} retry={resource.reload}>{resource.data && <><section className="surface upload-panel"><FormError>{error}</FormError>{resource.data.trips?.length ? <form className="form-grid reminder-form" onSubmit={submit}><label>Trip<select name="trip_id" required defaultValue=""><option value="" disabled>Select a trip</option>{resource.data.trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.title}</option>)}</select></label><label>Send at<input type="datetime-local" name="send_at" required /></label><label className="reminder-message">Message<input name="message" type="text" maxLength="255" placeholder="What should we remind you about?" autoComplete="off" required /></label><button className="button" disabled={busy}>{busy ? 'Saving…' : 'Add reminder'} <span aria-hidden="true">↗</span></button></form> : <EmptyState action={<Link to="/trips/new" className="text-link">Plan a trip first ↗</Link>}>Reminders need a trip.</EmptyState>}</section>{resource.data.reminders?.length ? <div className="data-list">{resource.data.reminders.map((item) => <div className="data-row reminder-row" key={item.id}>{editingId === item.id && item.status === 'pending' ? <form className="reminder-edit-form" onSubmit={(event) => update(event, item)}><label>Message<input name="message" type="text" maxLength="255" defaultValue={item.message} required /></label><label>Send at<input name="send_at" type="datetime-local" defaultValue={String(item.send_at).replace(' ', 'T').slice(0, 16)} required /></label><div className="row-actions"><button className="text-button" type="submit" disabled={busyReminderId === item.id}>{busyReminderId === item.id ? 'Saving…' : 'Save'}</button><button className="text-button" type="button" onClick={() => setEditingId(null)}>Cancel</button></div></form> : <><div><strong>{item.message}</strong><span>{item.trip_title} / {new Date(item.send_at).toLocaleString()}</span></div><div className="row-actions"><span className={`status-tag status-${item.status}`}>{item.status}</span>{item.status === 'pending' && <><button className="text-button" type="button" onClick={() => setEditingId(item.id)}>Edit</button><button className="text-button danger-text" type="button" disabled={busyReminderId === item.id} onClick={() => remove(item)}>{busyReminderId === item.id ? 'Deleting…' : 'Delete'}</button></>}</div></>}</div>)}</div> : <EmptyState>No reminders scheduled.</EmptyState>}</>}</LoadState></Shell>;
}

function AssistantMessageText({ text }) {
  const blocks = [];
  let paragraph = [];
  let list = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ type: 'list', items: list });
    list = [];
  };

  String(text).split(/\r?\n/).forEach((line) => {
    const bullet = line.match(/^\s*[*-]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
    } else if (!line.trim()) {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  });
  flushParagraph();
  flushList();

  function renderInline(value, keyPrefix) {
    return value.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*)/g).map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={`${keyPrefix}-${index}`}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('*') && part.endsWith('*')) {
        return <em key={`${keyPrefix}-${index}`}>{part.slice(1, -1)}</em>;
      }
      return part;
    });
  }

  return blocks.map((block, index) => block.type === 'list'
    ? <ul key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item, `${index}-${itemIndex}`)}</li>)}</ul>
    : <p key={index}>{renderInline(block.text, String(index))}</p>);
}

function Assistant() {
  const [messages, setMessages] = useState([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event) { event.preventDefault(); const form = new FormData(event.currentTarget); const text = String(form.get('message') || '').trim(); if (!text) return; const history = messages.map((message) => ({ role: message.role === 'user' ? 'user' : 'model', text: message.text })); setMessages((current) => [...current, { role: 'user', text }]); event.currentTarget.reset(); setError(''); setBusy(true); try { const data = await api.post('/assistant/message', { message: text, history }); setMessages((current) => [...current, { role: 'assistant', text: data.reply }]); } catch (requestError) { setError(requestError.message); } finally { setBusy(false); } }
  return <Shell><PageHeading eyebrow="A thoughtful co-planner" title="Ask the trip assistant." copy="Get practical ideas for routes, budgets, and lower-impact choices."/><section className="assistant-window"><div className="assistant-messages" aria-live="polite">{messages.length ? messages.map((message, index) => <div className={`assistant-message ${message.role === 'user' ? 'assistant-user' : 'assistant-reply'}`} key={index}>{message.role === 'assistant' ? <AssistantMessageText text={message.text} /> : <p>{message.text}</p>}</div>) : <div className="assistant-welcome"><span className="eyebrow">EcoTrip assistant</span><p>Where are you thinking of going?</p></div>}{busy && <div className="assistant-message assistant-reply"><p>Thinking through a few options…</p></div>}</div><FormError>{error}</FormError><form className="assistant-form" onSubmit={submit}><label className="visually-hidden" htmlFor="assistant-message">Message</label><textarea id="assistant-message" name="message" maxLength="1500" rows="2" placeholder="Ask about a destination or route…" required /><button className="button" disabled={busy}>Send <span aria-hidden="true">↗</span></button></form><p className="assistant-disclaimer">Confirm transport schedules, fares, and bookings directly with providers.</p></section></Shell>;
}

function Account() {
  const { user, setUser, signOut } = useAuth(); const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function updateAddress(event) { event.preventDefault(); setBusy(true); setError(''); setMessage(''); try { const data = await api.put('/auth/address', { address: new FormData(event.currentTarget).get('address') }); setUser((current) => ({ ...current, address: data.address })); setMessage('Address updated.'); } catch (requestError) { setError(requestError.message); } finally { setBusy(false); } }
  async function changePassword(event) { event.preventDefault(); setBusy(true); setError(''); setMessage(''); const form = new FormData(event.currentTarget); try { await api.post('/auth/change-password', { current_password: form.get('current_password'), new_password: form.get('new_password'), confirm_password: form.get('confirm_password') }); event.currentTarget.reset(); setMessage('Password changed.'); } catch (requestError) { setError(requestError.message); } finally { setBusy(false); } }
  async function download() { setError(''); setBusy(true); try { const data = await api.get('/account/export'); const { downloadAccountPdf } = await import('./account-export.js'); downloadAccountPdf(data.export); } catch (requestError) { setError(requestError.message); } finally { setBusy(false); } }
  async function deleteAccount() { if (!window.confirm('Delete your account and personal data? This cannot be undone.')) return; setBusy(true); setError(''); const password = window.prompt('Enter your current password to confirm account deletion:'); if (password === null) { setBusy(false); return; } try { await api.post('/account/delete', { current_password: password }); await signOut(); window.location.assign('/'); } catch (requestError) { setError(requestError.message); setBusy(false); } }
  return <Shell><PageHeading eyebrow="Your account" title="Account settings." copy="Keep your profile current and manage your EcoTrip data."/><div className="account-grid"><section className="surface"><p className="eyebrow">Profile</p><h2>{user?.name}</h2><p className="inline-note">{user?.email}</p><FormError>{error}</FormError>{message && <div className="form-success">{message}</div>}<form className="form-stack" onSubmit={updateAddress}><label>Home address<input name="address" maxLength="255" defaultValue={user?.address || ''} required /></label><button className="button button-outline" disabled={busy}>Save address</button></form></section><section className="surface"><p className="eyebrow">Security</p><h2>Change password</h2><form className="form-stack" onSubmit={changePassword}><label>Current password<input name="current_password" type="password" autoComplete="current-password" required /></label><label>New password<input name="new_password" type="password" minLength="12" autoComplete="new-password" required /></label><label>Confirm new password<input name="confirm_password" type="password" minLength="12" autoComplete="new-password" required /></label><button className="button" disabled={busy}>Update password</button></form></section><section className="surface account-data"><p className="eyebrow">Your data</p><h2>Take your records with you.</h2><p>Download a PDF export of your profile, trips, and bookings.</p><div className="form-actions"><button className="button button-outline" onClick={download} disabled={busy}>{busy ? 'Preparing PDF…' : 'Download PDF'}</button><button className="button button-danger" onClick={deleteAccount} disabled={busy}>Delete account</button></div></section></div></Shell>;
}

const adminTabs = [['overview', 'Overview'], ['users', 'Users'], ['trips', 'Trips'], ['experiences', 'Experiences'], ['stays', 'Stays'], ['routes', 'Routes'], ['bookings', 'Bookings'], ['reminders', 'Reminders'], ['photos', 'Photos']];

function Admin() {
  const [tab, setTab] = useState('overview');
  const endpoint = tab === 'overview' ? '/admin' : `/admin/${tab}`;
  const resource = useResource(endpoint);
  return <Shell><PageHeading eyebrow="Operations" title="Administration." copy="Manage EcoTrip accounts, listings, routes, and booking records."/><div className="admin-tabs" role="tablist" aria-label="Admin sections">{adminTabs.map(([key, label]) => <button key={key} className={tab === key ? 'is-active' : ''} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>)}</div><LoadState {...resource} retry={resource.reload}>{resource.data && <AdminContent tab={tab} data={resource.data} reload={resource.reload} />}</LoadState></Shell>;
}

function AdminContent({ tab, data, reload }) {
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [editingStay, setEditingStay] = useState(null);
  const [editingRoute, setEditingRoute] = useState(null);
  async function act(key, action) {
    setBusyKey(key);
    setError('');
    try { await action(); reload(); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusyKey(''); }
  }
  if (tab === 'overview') return <><FormError>{error}</FormError><div className="stat-grid">{Object.entries(data.overview || {}).map(([key, value]) => <div className="stat-card" key={key}><span>{key.replaceAll('_', ' ')}</span><strong>{String(value)}</strong></div>)}</div><div className="admin-overview-grid">{[['Users', data.users], ['Trips', data.trips], ['Stays', data.stays], ['Routes', data.routes], ['Bookings', data.bookings], ['Reminders', data.reminders], ['Photos', data.photos]].map(([label, rows]) => <div className="surface" key={label}><span className="eyebrow">{label}</span><strong className="overview-count">{rows?.length ?? 0}</strong></div>)}</div></>;
  if (tab === 'users') return <><FormError>{error}</FormError><section className="surface admin-create"><p className="eyebrow">Add a user</p><form className="admin-form" onSubmit={(event) => { event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); act('create', async () => { await api.post('/admin/users', { name: form.get('name'), email: form.get('email'), password: form.get('password'), role: form.get('role') }); formElement.reset(); }); }}><input name="name" placeholder="Name" maxLength="100" required/><input name="email" type="email" placeholder="Email" required/><input name="password" type="password" placeholder="Temporary password" minLength="12" required/><select name="role"><option value="traveler">Traveler</option><option value="admin">Admin</option></select><button className="button button-small" disabled={busyKey === 'create'}>Create user</button></form></section><DataTable columns={['Name', 'Email', 'Role', 'Change role']} rows={data.users || []} render={(user) => <><strong>{user.name}</strong><span>{user.email}</span><span className="status-tag">{user.role}</span><select defaultValue={user.role} onChange={(event) => act(`role-${user.id}`, () => api.patch(`/admin/users/${user.id}/role`, { role: event.target.value }))}><option value="traveler">Traveler</option><option value="admin">Admin</option></select></>} /></>;
  if (tab === 'trips') return <><FormError>{error}</FormError><DataTable columns={['Trip', 'Traveler', 'Dates', 'Status', 'Actions']} rows={data.trips || []} render={(trip) => <><div><strong>{trip.title}</strong><span>{trip.destination}</span></div><span>{trip.traveler_name || trip.user_name || `User ${trip.user_id}`}</span><span>{trip.start_date} – {trip.end_date}</span><select defaultValue={trip.status} onChange={(event) => act(`trip-${trip.id}`, () => api.patch(`/admin/trips/${trip.id}`, { status: event.target.value }))}><option value="draft">Draft</option><option value="planned">Planned</option><option value="booked">Booked</option><option value="completed">Completed</option></select><button className="text-button danger-text" disabled={busyKey === `delete-${trip.id}`} onClick={() => window.confirm('Delete this trip?') && act(`delete-${trip.id}`, () => api.delete(`/admin/trips/${trip.id}`))}>Delete</button></>} /></>;
  if (tab === 'experiences') return <><FormError>{error}</FormError><p className="inline-note">Admins can review completed trips and stops, edit their shared notes, publish or hide them, or remove the public content. Removing an experience keeps the traveler’s trip and itinerary intact.</p><DataTable columns={['Type', 'Experience', 'Traveler', 'Rating', 'Visibility', 'Actions']} rows={data.experiences || []} rowComponent={AdminExperienceRow} rowProps={{ act, busyKey }} /></>;
  if (tab === 'stays') return <><FormError>{error}</FormError><AdminStayForm key={editingStay?.id || 'new-stay'} act={act} selected={editingStay} onCancel={() => setEditingStay(null)} /><DataTable columns={['Stay', 'Location', 'Rating', 'Nightly rate', 'Actions']} rows={data.stays || []} render={(stay) => <><div><strong>{stay.name}</strong><span>{stay.certification || 'No certification listed'}</span></div><span>{stay.location}</span><span>{stay.eco_rating}/5</span><span>{money(stay.price_per_night)}</span><span className="admin-row-actions"><button className="text-button" onClick={() => setEditingStay(stay)}>Edit</button><button className="text-button danger-text" onClick={() => window.confirm('Delete this stay?') && act(`stay-${stay.id}`, () => api.delete(`/admin/stays/${stay.id}`))}>Delete</button></span></>} /></>;
  if (tab === 'routes') return <><FormError>{error}</FormError><AdminRouteForm key={editingRoute?.id || 'new-route'} act={act} selected={editingRoute} onCancel={() => setEditingRoute(null)} /><DataTable columns={['Mode', 'Route', 'Distance', 'CO2 / person', 'Cost', 'Actions']} rows={data.routes || []} render={(route) => <><span className="route-mode">{route.mode}</span><strong>{route.origin} → {route.destination}</strong><span>{route.distance_km} km</span><span>{route.co2_kg_per_person} kg</span><span>{money(route.cost)}</span><span className="admin-row-actions"><button className="text-button" onClick={() => setEditingRoute(route)}>Edit</button><button className="text-button danger-text" onClick={() => window.confirm('Delete this route?') && act(`route-${route.id}`, () => api.delete(`/admin/routes/${route.id}`))}>Delete</button></span></>} /></>;
  if (tab === 'bookings') return <><FormError>{error}</FormError><DataTable columns={['Booking', 'Traveler', 'Amount', 'Status', 'Action']} rows={data.bookings || []} render={(booking) => <><div><strong>#{booking.id} / {booking.stay_name || 'Carbon offset'}</strong><span>{booking.trip_title} / {booking.paymongo_ref || 'No reference'}</span></div><span>{booking.traveler_name}</span><span>{money(booking.amount)}</span><span className="status-tag">{booking.payment_status}</span>{booking.payment_status === 'pending' ? <button className="button button-small button-outline" disabled={busyKey === `booking-${booking.id}`} onClick={() => act(`booking-${booking.id}`, () => api.post(`/admin/bookings/${booking.id}/reconcile`))}>Reconcile</button> : <span>Not pending</span>}</>} /></>;
  if (tab === 'reminders') return <DataTable columns={['Reminder', 'Trip', 'Traveler', 'Send at', 'Status']} rows={data.reminders || []} render={(reminder) => <><strong>{reminder.message}</strong><span>{reminder.trip_title || `Trip ${reminder.trip_id}`}</span><span>{reminder.traveler_name}</span><span>{reminder.send_at}</span><span className="status-tag">{reminder.status}</span></>} />;
  return <div className="admin-photo-grid">{data.photos?.length ? data.photos.map((photo) => <article className="journal-card" key={photo.id}><img src={assetUrl(photo.photo_path)} alt={photo.caption || 'Journal photo'} loading="lazy"/><div><strong>{photo.traveler_name}</strong><p>{photo.caption}</p><small>{photo.trip_title}</small></div></article>) : <EmptyState>No journal photos.</EmptyState>}</div>;
}

function DataTable({ columns, rows, render, rowComponent: RowComponent, rowProps = {} }) {
  if (!rows.length) return <EmptyState>No records in this section.</EmptyState>;
  return <div className="table-scroll"><table className="admin-table"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row) => {
    const key = `${row.record_type || ''}-${row.id}`;
    if (RowComponent) return <tr key={key}><RowComponent experience={row} {...rowProps} /></tr>;
    const rendered = render(row);
    const children = rendered?.props?.children;
    const cells = Array.isArray(children) ? children : [children];
    return <tr key={key}>{cells.map((cell, index) => <td key={`${row.id}-${index}`}>{cell}</td>)}</tr>;
  })}</tbody></table></div>;
}

function AdminExperienceRow({ experience, act, busyKey }) {
  const [notes, setNotes] = useState(experience.experience_notes || '');
  const [rating, setRating] = useState(experience.experience_rating ? String(experience.experience_rating) : '');
  const [shared, setShared] = useState(Boolean(Number(experience.share_experience)));
  const type = experience.record_type === 'trip' ? 'trips' : 'stops';
  const endpoint = `/admin/experiences/${type}/${experience.id}`;
  const key = `experience-${type}-${experience.id}`;

  useEffect(() => {
    setNotes(experience.experience_notes || '');
    setRating(experience.experience_rating ? String(experience.experience_rating) : '');
    setShared(Boolean(Number(experience.share_experience)));
  }, [experience.experience_notes, experience.experience_rating, experience.share_experience]);

  return <>
    <td><span className="status-tag">{experience.record_type === 'trip' ? 'Full trip' : `Stop · day ${experience.day_number}`}</span></td>
    <td><div><strong>{experience.reference_title}</strong><span>{experience.destination}{experience.record_type === 'stop' ? ` · ${experience.trip_title}` : ''}</span></div><textarea className="admin-experience-notes" aria-label="Experience notes" maxLength="2000" rows="3" value={notes} onChange={(event) => setNotes(event.target.value)} /></td>
    <td><div><strong>{experience.traveler_name}</strong><span>{experience.traveler_email}</span></div></td>
    <td>{experience.record_type === 'trip' ? <select aria-label="Experience rating" value={rating} onChange={(event) => setRating(event.target.value)}><option value="">No rating</option><option value="1">1 star</option><option value="2">2 stars</option><option value="3">3 stars</option><option value="4">4 stars</option><option value="5">5 stars</option></select> : <span>—</span>}</td>
    <td><label className="check-label"><input type="checkbox" checked={shared} onChange={(event) => setShared(event.target.checked)} /> Public</label></td>
    <td><span className="admin-row-actions"><button className="button button-small button-outline" disabled={busyKey === key} onClick={() => act(key, () => api.patch(endpoint, { experience_notes: notes, experience_rating: rating ? Number(rating) : null, share_experience: shared }))}>Save</button><button className="text-button danger-text" disabled={busyKey === `${key}-remove`} onClick={() => window.confirm('Remove this experience from public view and clear its shared notes? The traveler’s trip or stop will remain.') && act(`${key}-remove`, () => api.delete(endpoint))}>Remove</button></span></td>
  </>;
}

function AdminStayForm({ act, selected, onCancel }) {
  return <section className="surface admin-create"><p className="eyebrow">{selected ? 'Edit stay' : 'Add a stay'}</p><form className="admin-form" onSubmit={(event) => { event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); act(`stay-save-${selected?.id || 'new'}`, async () => { await api.post('/admin/stays', { id: selected?.id, name: form.get('name'), location: form.get('location'), eco_rating: Number(form.get('eco_rating')), price_per_night: Number(form.get('price_per_night')), certification: form.get('certification'), description: form.get('description') }); if (selected) onCancel(); else formElement.reset(); }); }}><input name="name" placeholder="Name" maxLength="150" defaultValue={selected?.name || ''} required/><input name="location" placeholder="Location" maxLength="150" defaultValue={selected?.location || ''} required/><input name="eco_rating" type="number" min="0" max="5" placeholder="Eco rating" defaultValue={selected?.eco_rating ?? ''} required/><input name="price_per_night" type="number" min="0.01" step="0.01" placeholder="PHP / night" defaultValue={selected?.price_per_night ?? ''} required/><input name="certification" placeholder="Certification" maxLength="100" defaultValue={selected?.certification || ''}/><input name="description" placeholder="Description" defaultValue={selected?.description || ''}/><button className="button button-small">{selected ? 'Save stay' : 'Add stay'}</button>{selected && <button className="button button-small button-outline" type="button" onClick={onCancel}>Cancel edit</button>}</form></section>;
}

function AdminRouteForm({ act, selected, onCancel }) {
  return <section className="surface admin-create"><p className="eyebrow">{selected ? 'Edit route' : 'Add a route'}</p><form className="admin-form" onSubmit={(event) => { event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); act(`route-save-${selected?.id || 'new'}`, async () => { await api.post('/admin/routes', { id: selected?.id, mode: form.get('mode'), origin: form.get('origin'), destination: form.get('destination'), distance_km: Number(form.get('distance_km')), co2_kg_per_person: Number(form.get('co2_kg_per_person')), cost: Number(form.get('cost')) }); if (selected) onCancel(); else formElement.reset(); }); }}><select name="mode" defaultValue={selected?.mode || 'bus'}><option>bus</option><option>train</option><option>bike</option><option>walk</option><option>ferry</option><option>carpool</option></select><input name="origin" placeholder="Origin" maxLength="150" defaultValue={selected?.origin || ''} required/><input name="destination" placeholder="Destination" maxLength="150" defaultValue={selected?.destination || ''} required/><input name="distance_km" type="number" min="0" step="0.1" placeholder="Distance km" defaultValue={selected?.distance_km ?? ''} required/><input name="co2_kg_per_person" type="number" min="0" step="0.1" placeholder="CO2 kg/person" defaultValue={selected?.co2_kg_per_person ?? ''} required/><input name="cost" type="number" min="0" step="0.01" placeholder="Cost PHP" defaultValue={selected?.cost ?? ''} required/><button className="button button-small">{selected ? 'Save route' : 'Add route'}</button>{selected && <button className="button button-small button-outline" type="button" onClick={onCancel}>Cancel edit</button>}</form></section>;
}

function Forbidden() { return <Shell><PageHeading eyebrow="403 / Forbidden" title="This area is for EcoTrip administrators."/><Link className="button" to="/dashboard">Return to dashboard <span aria-hidden="true">↗</span></Link></Shell>; }
function NotFound() { return <Shell><PageHeading eyebrow="404 / Not found" title="We couldn't find that page."/><Link className="button" to="/">Back to EcoTrip <span aria-hidden="true">↗</span></Link></Shell>; }

export default function EcoTripPages() {
  return <Routes>
    <Route path="/" element={<Home />} /><Route path="/about" element={<About />} />
    <Route path="/login" element={<Login />} /><Route path="/register" element={<Register />} /><Route path="/forgot-password" element={<ForgotPassword />} /><Route path="/reset-password" element={<ResetPassword />} />
    <Route path="/auth/google/callback" element={<GoogleCallback />} /><Route path="/payment/success" element={<PaymentReturn />} /><Route path="/payment/cancelled" element={<PaymentReturn cancelled />} />
    <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
    <Route path="/trips" element={<ProtectedRoute><TripList /></ProtectedRoute>} /><Route path="/trips/new" element={<ProtectedRoute><TripForm /></ProtectedRoute>} /><Route path="/trips/:id/edit" element={<ProtectedRoute><TripForm /></ProtectedRoute>} /><Route path="/trips/:id" element={<ProtectedRoute><TripDetail /></ProtectedRoute>} />
    <Route path="/experiences" element={<ProtectedRoute><Experiences /></ProtectedRoute>} />
    <Route path="/stays" element={<Stays />} /><Route path="/stays/:id" element={<StayDetail />} /><Route path="/transport" element={<Transport />} />
    <Route path="/bookings" element={<ProtectedRoute><Bookings /></ProtectedRoute>} /><Route path="/bookings/:id/receipt" element={<ProtectedRoute><Receipt /></ProtectedRoute>} />
    <Route path="/journal" element={<ProtectedRoute><Journal /></ProtectedRoute>} /><Route path="/reminders" element={<ProtectedRoute><Reminders /></ProtectedRoute>} /><Route path="/assistant" element={<ProtectedRoute><Assistant /></ProtectedRoute>} /><Route path="/account" element={<ProtectedRoute><Account /></ProtectedRoute>} />
    <Route path="/admin/*" element={<ProtectedRoute admin><Admin /></ProtectedRoute>} /><Route path="/403" element={<Forbidden />} /><Route path="*" element={<NotFound />} />
  </Routes>;
}