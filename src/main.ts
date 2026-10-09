import { startApp } from './app/bootstrap';
import { showFatal } from './app/fatal';

const root = document.getElementById('app');
if (root) startApp(root).catch((error: unknown) => showFatal(root, error));
