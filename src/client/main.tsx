import '@fontsource/ibm-plex-sans/400';
import '@fontsource/ibm-plex-sans/600';
import '@fontsource/ibm-plex-mono/400';
import '@fontsource/big-shoulders-display/800';
import '@fontsource/big-shoulders-display/900';
import '@fontsource/monoton/400';
import '@fontsource/vt323/400';
import '@fontsource/permanent-marker/400';
import '@fontsource/special-elite/400';
import './styles/app.css';
import './styles/pages.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import Booking from './pages/Booking';
import Greeting from './pages/Greeting';
import CallSimulator from './pages/CallSimulator';
import CustomerInvoice from './pages/CustomerInvoice';
import Inbox from './pages/Inbox';
import Landing from './pages/Landing';
import Machine from './pages/Machine';
import NotFound from './pages/NotFound';
import Outbox from './pages/Outbox';
import PriceBook from './pages/PriceBook';
import Schedule from './pages/Schedule';
import VoiceInvoice from './pages/VoiceInvoice';

const router = createBrowserRouter([
  { path: '/', element: <Landing /> },
  {
    path: '/machine',
    element: <Machine />,
    children: [
      { index: true, element: <Inbox /> },
      { path: 'call', element: <CallSimulator /> },
      { path: 'greeting', element: <Greeting /> },
      { path: 'schedule', element: <Schedule /> },
      { path: 'invoice', element: <VoiceInvoice /> },
      { path: 'outbox', element: <Outbox /> },
      { path: 'prices', element: <PriceBook /> },
    ],
  },
  { path: '/book/:token', element: <Booking /> },
  { path: '/i/:id', element: <CustomerInvoice /> },
  { path: '*', element: <NotFound /> },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
