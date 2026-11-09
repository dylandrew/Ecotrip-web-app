import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth.jsx';
import App from './App.jsx';
import './styles.css';

function formatCurrency(value) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 2,
  }).format(amount);
}

async function readApiJson(response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(response.redirected
      ? 'Your sign-in session expired. Please sign in again.'
      : 'The trip service returned an invalid response. Refresh the page and try again.');
  }
  return response.json();
}

function TripList() {
  const mountPoint = document.getElementById('trips-react-app');
  const apiRoot = mountPoint?.dataset.apiRoot || '/api/trips';
  const tokenUrl = mountPoint?.dataset.tokenUrl || '/api/session-token';

  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function loadTrips() {
      try {
        setLoading(true);
        const tokenResponse = await fetch(tokenUrl, {
          credentials: 'same-origin',
        });

        if (!tokenResponse.ok) {
          throw new Error('Please sign in to manage your trips.');
        }

        const tokenData = await readApiJson(tokenResponse);
        if (!tokenData.access_token) {
          throw new Error(tokenData.error || 'Please sign in to manage your trips.');
        }
        const response = await fetch(apiRoot, {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
            Accept: 'application/json',
          },
          credentials: 'same-origin',
        });

        if (!response.ok) {
          const result = await readApiJson(response).catch(() => ({}));
          throw new Error(result.message || 'Unable to load trips right now.');
        }

        const result = await readApiJson(response);
        if (!active) return;
        setTrips(Array.isArray(result.trips) ? result.trips : []);
        setError('');
      } catch (loadError) {
        if (!active) return;
        setTrips([]);
        setError(loadError.message || 'Unable to load trips right now.');
      } finally {
        if (active) setLoading(false);
      }
    }

    loadTrips();
    return () => {
      active = false;
    };
  }, [apiRoot, tokenUrl]);

  const summary = useMemo(() => {
    const total = trips.reduce((sum, trip) => sum + Number(trip.budget || 0), 0);
    return {
      totalTrips: trips.length,
      totalBudget: formatCurrency(total),
    };
  }, [trips]);

  return (
    <section className="eco-trip-panel" aria-live="polite">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Trip overview</p>
          <h2>Recent eco plans</h2>
        </div>
        <div className="summary-pill">
          <strong>{summary.totalTrips}</strong>
          <span>trips</span>
        </div>
      </div>

      {loading ? (
        <div className="state-box">Loading your trip list…</div>
      ) : error ? (
        <div className="state-box error">{error}</div>
      ) : (
        <>
          <div className="summary-row">
            <span>Total budget</span>
            <strong>{summary.totalBudget}</strong>
          </div>

          <ul className="trip-list">
            {trips.length === 0 ? (
              <li className="empty-state">No trips yet. Plan your first eco-friendly itinerary.</li>
            ) : (
              trips.map((trip) => (
                <li key={trip.id} className="trip-item">
                  <div>
                    <h3>{trip.title}</h3>
                    <p>
                      {trip.destination} • {trip.start_date} → {trip.end_date}
                    </p>
                  </div>
                  <div className="trip-meta">
                    <span className={`status-badge status-${trip.status || 'draft'}`}>{trip.status || 'draft'}</span>
                    <strong>{formatCurrency(trip.budget)}</strong>
                  </div>
                </li>
              ))
            )}
          </ul>
        </>
      )}
    </section>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
