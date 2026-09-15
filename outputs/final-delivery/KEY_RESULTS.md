# Key results

- Acceptance scene: `低多边形天文台`
- Generated project: `outputs/scene-5a21bcff/`
- Final ZIP: `outputs/final-delivery/observatory-project.zip`
- ZIP SHA-256: `247FDDA0980914BE1EADF7643D6E0B5D503254D5849092BADC3A2B2E8393CBB1`
- Pipeline gates: 6/6 PASS
- HTTP check: 200 PASS
- ZIP extraction: PASS
- ZIP-isolated npm install: PASS, 24 packages installed
- ZIP-isolated TypeScript + Vite build: PASS, 10 modules transformed
- Root tests: PASS, 2/2 groups
- Root build: PASS, radio and room HTML entries produced
- Git: `pipeline-mvp-final` is based on current `origin/main`; one README conflict was resolved by retaining both Pipeline and original-case documentation
- Safety backup: `codex/backup-pipeline-mvp-final-20260915`
- Post-integration revalidation: root tests/build and fresh observatory generation all PASS

## Commands actually run

```text
npx tsc --noEmit
npm run generate-scene -- --prompt "生成一个低多边形天文台，入口门可以打开，望远镜可以旋转，操作椅可以在地面拖动，墙灯可以点击开关"
npm install --ignore-scripts --no-audit --no-fund --cache ..\.npm-cache
npm run build
npm test
npm run build
git fetch origin
npm run generate-scene -- --prompt "生成一个低多边形天文台，入口门可以打开，望远镜可以旋转，操作椅可以在地面拖动，墙灯可以点击开关" --output outputs/final-regeneration
```
