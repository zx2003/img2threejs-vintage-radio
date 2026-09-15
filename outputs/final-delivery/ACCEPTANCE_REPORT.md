# Three.js Scene Factory — Final Acceptance Report

Date: 2026-09-15 (Asia/Shanghai)

## Conclusion

The repository satisfies the functional MVP definition of a reusable Pipeline rather than a single hard-coded scene case. It accepts natural-language or JSON input, produces a unified Scene Spec, generates a self-contained Vite + TypeScript + Three.js project, validates and builds it, then packages it as ZIP only after hard checks pass.

The original radio (`/`) and interactive room (`/room.html`) remain present and compile successfully. They are registered under `examples/` as reference cases and are not used as generation branches.

This acceptance does not claim high-fidelity semantic 3D synthesis. Unknown objects are represented by parameterized primitive combinations; in this test the telescope remains a basic generic procedural object.

## Acceptance input

```text
生成一个低多边形天文台，入口门可以打开，望远镜可以旋转，操作椅可以在地面拖动，墙灯可以点击开关
```

Executed command:

```bash
npm run generate-scene -- --prompt "生成一个低多边形天文台，入口门可以打开，望远镜可以旋转，操作椅可以在地面拖动，墙灯可以点击开关"
```

No `天文台`, `observatory`, `望远镜`, or `telescope` branch exists in `src/`, `templates/`, `component-library/`, or `tests/`. The run used the existing prompt adapter, component aliases, generic-object fallback, Scene Spec, primitive generator, and shared interaction runtime.

## Pipeline flow

1. Read natural-language input.
2. Match reusable component recipes and create generic fallback objects for unknown nouns.
3. Normalize the result into Scene Spec 1.0.
4. Validate names, geometry, materials, transforms, lights, IDs, and interaction parameters.
5. Generate a complete Vite + TypeScript + Three.js project from templates.
6. Check required files, local/unsafe asset paths, unique IDs, and required runtime behavior.
7. Run `npm install` in the generated project.
8. Run TypeScript checking and Vite production build.
9. Write `validation-report.json` and package source files as ZIP.

## Generated interaction mapping

| Requested object | Generated ID | Representation | Interaction |
| --- | --- | --- | --- |
| 入口门 | `glass-door-1` | Component-library door | `hinge`, `hover` |
| 操作椅 | `chair-2` | Component-library chair | `drag`, `hover` |
| 望远镜 | `generic-object-3` | Generic primitive composition | `rotate`, `hover` |
| 墙灯 | `generic-object-4` | Generic light-like composition | `toggle`, `hover` |

The `rotate` behavior was added as a scene-independent interaction type. Generic toggle objects now receive visible emissive feedback, and light-like unknown objects receive a real point light. These changes apply to any future scene and contain no observatory-specific condition.

## Actual results

### Generated-project Pipeline gates

| Check | Result | Evidence |
| --- | --- | --- |
| Scene Spec validation | PASS | Valid Scene Spec; 9 non-blocking static-object warnings |
| Required files | PASS | 10 required files found |
| Asset paths | PASS | No unsafe or machine-local paths |
| Basic quality | PASS | 13 unique object nodes; interaction and animation runtime present |
| Generated-project `npm install` | PASS | Dependencies installed successfully |
| TypeScript + Vite build | PASS | 10 modules transformed in independent ZIP build |
| Development server | PASS | HTTP 200, `/src/main.ts` entry confirmed at 2026-09-15 16:51:50 +08:00 |
| ZIP creation | PASS | ZIP created after all Pipeline gates passed |

### ZIP independence test

The ZIP was extracted to:

```text
D:\桌面\img2threejs-test\outputs\zip-verification-scene-5a21bcff-final
```

Commands executed from that new directory:

```bash
npm install --ignore-scripts --no-audit --no-fund --cache ..\.npm-cache
npm run build
```

Results:

- `npm install`: PASS — 24 packages installed.
- TypeScript check: PASS.
- Vite production build: PASS — 10 modules transformed.
- Output created under `dist/`.
- Non-blocking warning: generated JavaScript chunk is about 516 KB after minification.

### Root repository regression checks

Commands executed:

```bash
npm test
npm run build
```

Results:

- Test group “Scene Spec and prompt adapter”: PASS.
- Test group “Project pipeline and ZIP packager”: PASS.
- Root TypeScript check: PASS.
- Root Vite build: PASS — 25 modules transformed.
- Original `dist/index.html` radio entry produced.
- Original `dist/room.html` room entry produced.
- Non-blocking warning: shared Three.js/RoundedBoxGeometry chunk is about 542 KB.

## Output files

- `observatory-project.zip` — final self-contained generated project.
- `scene-spec.json` — exact specification used for generation.
- `pipeline-validation-report.json` — machine-readable Pipeline gate results.
- `complete-validation-report.json` — complete machine-readable acceptance results, including ZIP isolation, HTTP, regression, and Git checks.
- `KEY_RESULTS.md` — concise command and result summary.
- `observatory-scene.png` — actual browser render of the generated initial scene.
- `observatory-interactions.png` — actual browser render after opening the door and toggling the wall light.
- `command-and-zip.png` — presentation summary of commands, gates, output path, and hash.

ZIP SHA-256:

```text
247FDDA0980914BE1EADF7643D6E0B5D503254D5849092BADC3A2B2E8393CBB1
```

ZIP size: 76,725 bytes.

## How to run the delivered ZIP

```bash
unzip observatory-project.zip
cd <extracted-directory>
npm install
npm run dev
```

Open the local address printed by Vite. Use the mouse to orbit and zoom. Click the door to open/close it, click the telescope to rotate it in 45-degree increments, drag the chair on the floor, click the wall light to toggle it, and use “重置场景” to restore initial state.

## Implemented capabilities

- Natural-language prompt and JSON request input.
- Unified typed Scene Spec and JSON Schema.
- Recursive primitive-object composition.
- Declarative component library plus unknown-object fallback.
- Perspective camera and ambient/directional/point lights.
- Materials, position, rotation, scale, children, shadows, and named object nodes.
- Hinge, rotate, drag, toggle, hover-highlight, reset, and OrbitControls.
- Required-file, asset-path, type, build, and basic-quality gates.
- Self-contained ZIP packaging without `node_modules` or machine-local paths.

## Known limitations

- Natural-language parsing is deterministic rules, not a general language model. Complex relationships should use a full JSON Scene Spec.
- Unknown objects are functional primitive approximations; the telescope is not visually detailed.
- Automatic layout is basic and has no collision solver, navigation mesh, or semantic composition planner.
- Quality checks prove structural and build correctness, not artistic similarity or production visual quality.
- Generated bundles currently include most of Three.js in one chunk and exceed Vite’s 500 KB advisory threshold.
- The Windows Computer Use screenshot helper failed to initialize with `failed to write kernel assets ... os error 3`; browser screenshots were instead captured from the actual local page using the installed Edge headless runtime.

## Git integration and final revalidation

The final branch `pipeline-mvp-final` was created directly from the fetched `origin/main` tip (`0177176`) and then received the reviewed Pipeline MVP commit. This incorporates the remote radio and room history without rewriting it.

- Recovery branch: `codex/backup-pipeline-mvp-final-20260915`.
- Final branch: `pipeline-mvp-final`.
- One conflict occurred in `README.md`; the Pipeline documentation and the remote radio/room instructions were combined.
- No force push, hard reset, clean, or checkout-based discard was used.
- A Windows npm environment conflict was fixed generically by isolating generated-project cache/offline variables; no observatory-specific branch was added.
- After integration, `npm test`, the root build, and a fresh observatory generation all passed.
- The final commit and GitHub URL are reported in the accompanying handoff because a commit cannot reliably contain its own final ID.
