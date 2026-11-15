import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import PageLoadBoundary from './components/PageLoadBoundary';
import { installClientErrorListeners } from './utils/clientErrors';
import { reportClientError } from './utils/reportClientError';

const removeErrorListeners = installClientErrorListeners(window, reportClientError);
if (import.meta.hot) import.meta.hot.dispose(removeErrorListeners);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PageLoadBoundary><App /></PageLoadBoundary>
  </React.StrictMode>
);