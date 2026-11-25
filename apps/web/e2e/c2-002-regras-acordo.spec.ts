// E2E @C2-002 (F3.7, 06-FAT linha 1): as regras do acordo com a fonte pagadora na tela do contrato. Quem edita o
// contrato abre a aba das tabelas do convênio sintético, escolhe o tipo de regra no combo, vê a validação na hora (o
// percentual fora da faixa aparece no campo e nada é gravado), inclui um teto da conta que só alerta, vê a regra na
// lista como vigente e encerra a vigência numa data futura (nunca antes de hoje; nada se apaga). Fonte sintética;
// axe na seção.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Regras do acordo com a fonte pagadora @C2-002 @fase3', () => {
  test('validação na hora, incluir teto da conta e encerrar a vigência; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.FATURAMENTO');
    await page.goto('/cadastros/convenios');
    await page.getByTestId('convenios-busca').fill('operadora alfa');
    await page.getByTestId('abrir-convenio-305').click();
    await expect(page.getByRole('heading', { level: 1, name: /Contrato do convênio 305/ })).toBeVisible();
    await page.getByTestId('aba-tabelas').click();
    const secao = page.getByTestId('regras-acordo');
    await expect(secao.getByRole('heading', { name: 'Regras do acordo' })).toBeVisible();
    await expect(secao).not.toContainText(/SPDATA|legado|sistema atual/i);

    // Validação na hora: percentual acima de 999 aparece no campo e o pedido não sai.
    let gravacoes = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/regras-acordo\//.test(new URL(r.url()).pathname)) gravacoes++;
    });
    await page.getByTestId('regra-campo-percentual').fill('1000');
    await page.getByTestId('regra-campo-percentual').blur();
    await expect(page.getByTestId('regra-erro-percentual')).toContainText('0 a 999');
    await page.getByTestId('regra-incluir').click();
    expect(gravacoes).toBe(0);

    // Teto da conta que só alerta: não pede item, grupo nem acordo.
    await escolher(page.getByTestId('regras-tipo'), { rotulo: 'Teto de cobrança' });
    await escolher(page.getByTestId('regra-abrangencia'), { rotulo: 'Conta inteira' });
    await escolher(page.getByTestId('regra-acao'), { rotulo: 'Alertar' });
    await page.getByTestId('regra-campo-valorTeto').fill('0');
    await page.getByTestId('regra-campo-valorTeto').blur();
    await expect(page.getByTestId('regra-erro-valorTeto')).toBeVisible();
    await page.getByTestId('regra-campo-valorTeto').fill('25000');
    await expect(page.getByTestId('regra-erro-valorTeto')).toHaveCount(0);
    await semViolacaoAxe(page, 'contrato: regras do acordo');
    await page.getByTestId('regra-incluir').click();
    await expect(page.getByTestId('regras-mensagem')).toContainText('Regra incluída');
    const linha = page.getByTestId('regras-lista').locator('tbody tr', { hasText: 'R$ 25000.00' }).first();
    await expect(linha).toContainText('Conta inteira');
    await expect(linha).toContainText('vigente');

    // Encerrar numa data futura: o fim muda, a regra continua na lista (nada se apaga).
    await linha.locator('input[type="date"]').fill('2099-12-31');
    await linha.getByRole('button', { name: 'Encerrar' }).click();
    await expect(page.getByTestId('regras-mensagem')).toContainText('Vigência encerrada');
    await expect(
      page.getByTestId('regras-lista').locator('tbody tr', { hasText: 'R$ 25000.00' }).first(),
    ).toContainText('2099-12-31');
    expect(externas).toEqual([]);
  });
});
