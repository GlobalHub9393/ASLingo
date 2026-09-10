// Load the camera-geometry compatibility layer first, then leave the existing
// ASLingo neural/live-learning application completely unchanged.
await import('./camera-geometry-fix.js');
await import('./neural-alphabet.js');
