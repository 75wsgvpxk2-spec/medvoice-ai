import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';
import './styles/app.css';
// After the application's own sheet: the room re-skins the same components,
// and a rule that loses to the shell it is replacing is not a re-skin.
import './styles/command-room.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
