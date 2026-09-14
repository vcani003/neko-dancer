/**
 * Home — the door. Name, figure, our songs, one public room.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../../../src/index.css';
import '../shared/pages.css';
import { HomePage } from './HomePage.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing');
createRoot(root).render(
  <StrictMode>
    <HomePage />
  </StrictMode>,
);
