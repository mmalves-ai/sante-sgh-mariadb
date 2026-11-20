import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const DIST = resolve(import.meta.dirname, '../../../packages/ui/dist/catalogo');
const ORIGEM = 'http://catalogo.sgh.invalid';
const TIPOS: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};
const HISTORIAS = [
  'estado-risco',
  'estado-leito',
  'alerta',
  'botao',
  'texto',
  'data',
  'hora',
  'colisao',
  'tabela',
  'paciente-nao-avaliadas',
  'paciente-alergias',
  'paciente-nega',
  'passos',
  'marca',
  'opcoes',
  'selecao',
  'icones',
];

test.describe('catálogo visual @M07-visual', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/*', async (rota) => {
      const url = new URL(rota.request().url());
      if (url.origin !== ORIGEM) return rota.abort(); // nada sai da máquina
      const caminho = resolve(DIST, `.${url.pathname === '/' ? '/index.html' : url.pathname}`);
      if (!caminho.startsWith(DIST)) return rota.abort();
      await rota.fulfill({
        body: readFileSync(caminho),
        contentType: TIPOS[extname(caminho)] ?? 'application/octet-stream',
      });
    });
  });

  for (const tema of ['claro', 'escuro'] as const) {
    for (const h of HISTORIAS) {
      test(`${h} (${tema})`, async ({ page }) => {
        await page.goto(`${ORIGEM}/index.html?tema=${tema}&historia=${h}`);
        const secao = page.locator(`[data-historia="${h}"]`);
        await expect(secao).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        await expect(secao).toHaveScreenshot(`${h}-${tema}.png`);
      });
    }
  }
});
