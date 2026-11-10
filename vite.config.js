import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // 상대 경로로 빌드해서 GitHub Pages(저장소 이름 하위 경로)와 Firebase Hosting 어디에 올려도 동작하게 한다.
  base: "./",
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Firebase는 자주 안 바뀌니 따로 묶어서 재배포 때도 캐시가 유지되게 한다.
        manualChunks: { firebase: ["firebase/app", "firebase/auth", "firebase/firestore"] },
      },
    },
  },
});
