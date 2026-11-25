import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Side-effect import: starts/stops device polling as the connection comes and goes.
import './services/devicePoller';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
