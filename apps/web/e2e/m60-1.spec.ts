// E2E @M60.1 (ficha do M60, etapa 1, migração): a etapa só entrega ferramenta da TI (aplicador com --simular,
// --relatorio e --recolher; ensaio da primeira aplicação), sem tela de trabalho (D12). A fumaça confere que o
// aplicativo segue de pé sobre os objetos criados: saúde e versão públicas, login, e a tela de verificação da
// estrutura do banco (a impressão digital que o ensaio compara antes e depois) com o cartão da plataforma.
// Sessão real sobre a fonte sintética de dev e as portas EM MEMÓRIA (contas sintéticas; nada vai à cópia). axe.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Migração: o aplicativo de pé depois da aplicação @M60.1 @fase7', () => {
  test.setTimeout(180_000);

  test('saúde e versão públicas, login e a verificação da estrutura do banco; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    const saude = await page.request.get('/api/saude');
    expect(saude.status()).toBe(200);
    expect((await saude.json()).status).toBe('ok');
    const versao = await page.request.get('/api/versao');
    expect(versao.status()).toBe(200);

    await entrar(page, 'SINT.ONDA5');
    await page.goto('/administracao/coexistencia/schema');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Verificação da estrutura do banco' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Verificar agora' }).click();
    await expect(page.getByRole('button', { name: 'Verificar agora' })).toBeEnabled({ timeout: 90_000 });
    await expect(page.locator('table tbody tr').first()).toBeVisible();
    const cartao = page.getByTestId('cartao-plataforma');
    await expect(cartao.getByTestId('plataforma-versao')).toHaveText('3.0.14');
    await expect(cartao.getByTestId('plataforma-charset-parametro')).toHaveText('CP1252');
    await expect(page.locator('body')).not.toContainText(/SPDATA|legado|sistema atual/i);
    await semViolacaoAxe(page, '/administracao/coexistencia/schema (M60.1)');
    expect(externas).toEqual([]);
  });
});
