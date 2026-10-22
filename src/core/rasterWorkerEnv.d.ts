/**
 * Minimal declaration for Vite's inline-worker import. Kept local (instead of
 * referencing `vite/client`) so the published declarations do not require
 * consumers to install Vite's ambient types.
 */
declare module '*?worker&inline' {
  const WorkerFactory: new (options?: { name?: string }) => Worker;
  export default WorkerFactory;
}
