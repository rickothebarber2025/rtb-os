import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { AuthProfileProvider } from './contexts/AuthProfileContext.jsx';
import './styles/global.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProfileProvider>
      <App />
    </AuthProfileProvider>
  </React.StrictMode>,
);
