# Repository Guidelines

## Project Structure & Module Organization

`src/core/` contains `GlassSurface`, providers, SVG filters, optics, and shared scheduling. `src/components/` pairs `Glass*.tsx` components with CSS; expose public APIs through `src/index.ts`. Material tokens live in `src/tokens.css`.

Interactive examples belong in `playground/demos/`, translations in `playground/i18n/` (five languages), and assets in `playground/public/`. Unit tests sit beside source files. `benchmarks/browser/` contains browser regressions; `benchmarks/fixtures/` and `benchmarks/evidence*` preserve pixel baselines and historical measurements.

## Build, Test, and Development Commands

- `npm ci`: install locked dependencies; the prepare hook builds the library.
- `npm run dev`: start the Vite playground.
- `npm run typecheck`: check strict TypeScript types.
- `npm test`: run Vitest unit tests in Node.
- `npm run test:browser`: run Playwright Chromium regressions.
- `npm run build`: generate ESM, CommonJS, declarations, and CSS in `dist/`.
- `npm run build:playground`: build the playground for production.
- `npm run test:release`: run types, unit tests, browser regressions, and both builds once.

Install Chromium with `npx playwright install chromium`, or set `BENCH_BROWSER_PATH` to an existing executable. Performance experiments are optional; follow `benchmarks/README.md`.

## Coding Style & Naming Conventions

Use TypeScript/TSX, functional React components, two-space indentation, single quotes, and semicolons. Follow surrounding style in compact utilities. Name components PascalCase (`GlassButton.tsx`), hooks `use*`, and helpers camelCase. Reuse existing CSS tokens and component classes. No formatter or linter is configured; avoid unrelated reformatting.

## Testing Guidelines

Name Vitest files `*.test.ts` or `*.test.tsx`; name Playwright files `*.spec.ts`. Add focused regressions for changed behavior, especially transparency, continuous resizing, filter ownership, and cleanup. Reuse `benchmarks/browser/fixtures.ts` for browser setup and teardown. No coverage-percentage threshold is configured. Preserve frozen pixel expectations and archived evidence; collect new experiment results separately.

## Commit & Pull Request Guidelines

Follow existing prefixes: `feat:`, `fix:`, `perf:`, and `chore:`. Use an imperative summary, such as `fix: synchronize glass resizing`, and keep commits focused.

PRs should explain the problem, resulting behavior, relevant issues, and validation results. Include screenshots or recordings for visual and animation changes. Update relevant documentation and `CHANGELOG.md` for public behavior changes.

## Security & Configuration

Keep npm tokens in environment variables or user configuration. Exclude credentials, generated builds, and local benchmark results from commits.
