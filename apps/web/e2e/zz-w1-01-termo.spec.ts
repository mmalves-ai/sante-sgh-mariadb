// E2E @W1-01 (revisão, achado 6): termo de uso. ESTE ARQUIVO RODA POR ÚLTIMO de propósito (nome "zz-", workers: 1):
// publicar uma versão nova do termo exige o novo aceite de TODAS as contas sintéticas no próximo login, e os E2E de
// outros arquivos não esperam o diálogo do termo. Publica duas versões pela tela (incluir e alterar: a anterior fica
// inativa e consultável), entra de novo e o termo novo é exigido antes de tudo; o aceite libera e a versão anterior
// continua consultável. Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS).
import { expect, type Page, test } from '@playwright/test';

const SENHA = 'Sintetico#2026';
const marca = Date.now().toString(36).slice(-5).toUpperCase();

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
  const entendi = page.getByTestId('aviso-entendi');
  await entendi.waitFor({ state: 'visible', timeout: 4_000 }).catch(() => undefined);
  if (await entendi.isVisible()) {
    await entendi.click();
    await expect(entendi).toHaveCount(0);
  }
}

test.describe('W1-01: termo de uso @W1-01', () => {
  test('publicar versão nova (incluir/alterar); a anterior fica inativa e consultável; novo aceite exigido no próximo login', async ({
    page,
  }) => {
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/termo');
    const linhas = page.getByTestId('termo-versoes').locator('tbody tr');
    await expect(page.getByTestId('termo-publicar')).toBeVisible();
    const antes = await linhas.count();
    const textos = [`Termo de uso do teste ${marca}.`, `Termo de uso do teste ${marca}, revisto.`];
    for (const texto of textos) {
      await page.getByTestId('termo-publicar').click();
      await page.getByTestId('termo-novo-texto').fill(texto);
      await page.getByTestId('termo-motivo').locator('input').fill('nova redação do termo de uso');
      await page.getByTestId('termo-senha').fill(SENHA);
      await page.getByTestId('termo-confirmar').click();
      await expect(page.getByTestId('termo-aviso')).toBeVisible({ timeout: 15_000 });
    }
    await expect(linhas).toHaveCount(antes + 2, { timeout: 15_000 });

    // Próximo login: o termo novo vem antes de tudo; aceitar libera.
    await entrar(page, 'SINT.GESTOR').catch(() => undefined);
    const dialogo = page.getByTestId('dialogo-termo');
    await expect(dialogo).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('texto-termo')).toContainText(textos[1] ?? '');
    await page.getByTestId('aceitar-termo').click();
    await expect(dialogo).toHaveCount(0);

    // A versão anterior (a 1ª publicada aqui) continua consultável, com o texto dela.
    await page.goto('/administracao/acesso/termo');
    await expect(linhas).toHaveCount(antes + 2, { timeout: 15_000 });
    const ids = await linhas.evaluateAll((trs) =>
      trs.map((tr) => (tr.getAttribute('data-testid') ?? '').replace('termo-versao-', '')),
    );
    let achou = false;
    for (const id of ids) {
      await page.getByTestId(`termo-ver-${id}`).click();
      const t = await page.getByTestId('termo-texto').textContent({ timeout: 15_000 });
      if (t?.includes(textos[0] ?? '') && !t.includes('revisto')) {
        achou = true;
        break;
      }
    }
    expect(achou).toBe(true);
  });
});
