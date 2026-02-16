import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import WorldRoot from './WorldRoot';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <WorldRoot />
  </React.StrictMode>
);

reportWebVitals();
