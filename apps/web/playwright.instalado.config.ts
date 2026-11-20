import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import { ambienteDoNavegador } from './e2e/navegador.js';

const raiz = resolve(import.meta.dirname, '../..');

// Fumaça E2E contra uma instância INSTALADA (M60, etapa 3; ficha, seção 6): sem servidor próprio, contra o endereço
// HTTPS do servidor em E2E_INSTALADO_URL (no ensaio do Ubuntu 24.04 descartável, https://localhost:5461, com o
// certificado autoassinado do ensaio). Rodada por deploy/ubuntu/ensaio/ensaiar.sh fumaca-e2e; nunca contra produção.
export default defineConfig({
  testDir: 'e2e',
  testMatch: 'm60-3-instalado.spec.ts',
  outputDir: 'test-results/instalado',
  reporter: [['list']],
  forbidOnly: true,
  workers: 1,
  use: {
    baseURL: process.env['E2E_INSTALADO_URL'] ?? 'https://localhost:5461',
    // O ensaio usa certificado autoassinado ("certificado próprio do hospital"); a cadeia é conferida pelo
    // implantacao:verificar com o --ca do servidor, não aqui.
    ignoreHTTPSErrors: true,
    channel: 'chrome',
    headless: true,
    trace: 'off',
    timezoneId: 'America/Sao_Paulo',
    launchOptions: { env: ambienteDoNavegador(raiz) },
  },
});
