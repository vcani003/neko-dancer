/**
 * Create — paste a URL, set timing, draft or publish. One page.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../../../src/index.css';
import '../shared/pages.css';
import { CreatePage } from './CreatePage.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing');
createRoot(root).render(
  <StrictMode>
    <CreatePage />
  </StrictMode>,
);
