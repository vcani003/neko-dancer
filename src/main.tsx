import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './ui/ErrorBoundary.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/*
      The outermost floor. A render error below this shows a notice instead of
      unmounting the tree and leaving a white page, which is all anyone playing
      on another machine would otherwise be able to tell you about it.
    */}
    <ErrorBoundary area="game">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
