// C2-004 (02-CAD linha 16, F3.1): a prévia do RPA diz de onde vieram as retenções (o dado fiscal do cadastro do
// profissional vigente hoje ou a regra geral) e mostra o destino do pagamento mascarado (a conta principal). Fonte
// sintética: na sessão de dev/ci o médico 7001 não tem dado fiscal (regra geral); o caso com o dado fiscal simula a
// resposta da prévia (o cálculo pelo dado fiscal é provado no contrato de efeito porta-propria.int.spec.ts do repasse).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';

const SENHA = 'Sintetico#2026';

/** Busca o médico pelo código e confere a opção escolhida (o registro 17001 do médico sintético 7001). */
async function medico(page: Page, testid: string, termo: string): Promise<void> {
  await page.getByTestId(`${testid}-busca`).fill(termo);
  await page.getByTestId(`${testid}-buscar`).click();
  await expect(page.getByTestId(testid)).toContainText('MEDICO SINTETICO');
  await expect(page.getByTestId(testid)).toHaveAttribute('data-valor', '17001');
}

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('@C2-004 RPA pelo dado fiscal do profissional', () => {
  test('a prévia mostra a origem das retenções e o destino do pagamento', async ({ page }) => {
    await entrar(page, 'SINT.REP.ANALISTA');
    // Um ajuste livre do médico 7001 na competência atual.
    await page.goto('/repasse/lancamentos');
    await expect(page.getByTestId('lc-competencia')).not.toHaveValue('');
    await page.getByTestId('lc-novo').click();
    await medico(page, 'lc-prestador', 'sintetico a');
    await page.getByTestId('lc-valor').fill('120');
    await page.getByTestId('lc-justificativa').fill('Ajuste sintético C2-004');
    await page.getByTestId('lc-gravar').click();
    await expect(page.getByTestId('lc-mensagem')).toContainText('Lançamento incluído');
    await page.goto('/repasse/rpa');
    await medico(page, 'rp-prestador', '7001');
    await page.getByTestId('rp-consultar').click();
    await page.getByTestId('rp-livres').locator('input[type="checkbox"]').first().check();
    await page.getByTestId('rp-calcular').click();
    await expect(page.getByTestId('rp-origem-fiscal')).toContainText('regra geral');
    await expect(page.getByTestId('rp-destino')).toContainText('não tem conta principal');

    // Com o dado fiscal vigente (sem ISS) e a conta principal: a origem e o destino mascarado.
    await page.route('**/api/repasse/rpas/previa', async (rota) => {
      const r = await rota.fetch();
      const corpo = await r.json();
      await rota.fulfill({
        response: r,
        json: {
          ...corpo,
          origemFiscal: 'dado-fiscal',
          destinoPagamento: '001 · Banco sintetico · ag. 1234 · conta final 54',
        },
      });
    });
    await page.getByTestId('rp-calcular').click();
    await expect(page.getByTestId('rp-origem-fiscal')).toContainText('dado fiscal do cadastro');
    await expect(page.getByTestId('rp-destino')).toContainText('conta final 54');
    await semViolacaoAxe(page, '/repasse/rpa (dado fiscal)');
  });
});
