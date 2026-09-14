/**
 * The play page. Separate from the prototype `src/main.tsx` on purpose —
 * relocating that App is a different change.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PlayApp } from './PlayApp.tsx';
import '../../../../../src/index.css';
import './play.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing');
createRoot(root).render(
  <StrictMode>
    <PlayApp />
  </StrictMode>,
);
