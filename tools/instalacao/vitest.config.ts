import { defineConfig } from 'vitest/config';

// Projeto "instalacao" (M60, etapa 2): o pacote de instalação no Ubuntu Server 24.04 (catálogo das variáveis e o
// modelo comentado do arquivo de ambiente, a conferência do arquivo do servidor, os arquivos gerados de systemd,
// nginx, cliente do banco e logrotate, e o manifesto do artefato de release).
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: { name: 'instalacao', include: ['src/**/*.spec.ts'], environment: 'node', env: { TZ: 'UTC' } },
});
