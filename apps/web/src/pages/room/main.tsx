/**
 * Public / Staging room. Same stage, different chart source.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../../../src/index.css';
import '../../play/ui/play.css';
import '../shared/pages.css';
import { RoomPage } from './RoomPage.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing');
createRoot(root).render(
  <StrictMode>
    <RoomPage />
  </StrictMode>,
);
