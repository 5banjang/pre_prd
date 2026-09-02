import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * `base`는 배포 경로다. GitHub Pages는 저장소 이름 아래(`/pre_prd/`)에 올라간다.
 *
 * `isPreview`를 함께 보는 이유: `vite preview`는 command가 'serve'라서 이것이 없으면
 * **개발용 base('/')로 dist를 띄운다.** 그러면 빌드된 index.html이 `/pre_prd/assets/…`를
 * 찾다가 SPA 폴백 HTML을 받아 스크립트가 죽고 화면이 백지가 된다.
 * 실측(2026-09-03)에서 이 상태로 백지를 확인했다 — 빌드 자체는 멀쩡했다.
 */
export default defineConfig(({ command, isPreview }) => ({
  plugins: [react()],
  server: { port: 5173 },
  base: command === 'build' || isPreview ? '/pre_prd/' : '/',
}));
