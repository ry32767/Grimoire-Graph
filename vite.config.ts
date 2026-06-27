/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages 公開時のベースパス（リポジトリ名）。
// ローカル開発・テストでは '/' でも問題ないが、本番ビルドのために固定する。
export default defineConfig({
  base: '/Grimoire-Graph/',
  plugins: [react()],
  build: {
    // mathjs（式パーサ）は大きめ。チャンク分離済みのため警告閾値を上げる。
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // mathjs は大きいので別チャンクに分離（キャッシュ効率向上）
        manualChunks: {
          mathjs: ['mathjs'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  test: {
    // ゲームロジックは純粋関数。DOM 不要なので node 環境でテストする。
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
