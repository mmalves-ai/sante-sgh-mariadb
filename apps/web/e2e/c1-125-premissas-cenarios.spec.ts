// E2E @C1-125 (ficha 07-FIN linha 129: orçamento empresarial com premissas e cenários): quem monta o orçamento abre
// Financeiro > Orçamento empresarial → aba Cenários: a tendência incoerente com o ajuste é apontada na hora → cadastra
// o cenário otimista (+5%) → cria a versão vazia do ano → aba Premissas e cenário: inflação sem percentual apontada na
// hora, reajuste acima de 20% pede justificativa → inclui a premissa → aplica o cenário e vê a projeção com a conta →
// retira a premissa (fica no histórico). Axe sem violação séria em cada estado. Sessão real sobre a fonte sintética de
// dev; o orçamento em MEMÓRIA (nada vai à cópia); nenhum dado de pessoa.
import { expect, type Page, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const campo = (page: Page, id: string) => page.getByTestId(id).locator('input, textarea').first();

test.describe('orçamento empresarial: premissas e cenários @C1-125', () => {
  test.setTimeout(300_000);
  test.use({ actionTimeout: 30_000 });

  test('cenário validado na hora → versão → premissas → cenário aplicado com a projeção → retirada; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ORCAMENTO');
    await (await itemDoMenu(page, 'Orçamento empresarial')).click();
    await expect(page).toHaveURL(/\/financeiro\/orcamento/);

    // Cenários: a regra do domínio aponta a incoerência antes de gravar.
    await page.getByTestId('orc-aba-cenarios').click();
    await expect(page.getByTestId('orc-cenarios')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('orc-cen-BASE')).toBeVisible();
    const form = page.getByTestId('orc-cen-form');
    await campo(page, 'orc-cen-codigo').fill('otimista-e2e');
    await campo(page, 'orc-cen-descricao').fill('Otimista do E2E');
    await escolher(form.getByTestId('orc-cen-tendencia'), { rotulo: /Otimista/ });
    await page.getByTestId('orc-cen-ajuste').fill('-5');
    await expect(page.getByTestId('orc-cen-ajuste-erro')).toContainText('não combina com a tendência');
    await page.getByTestId('orc-cen-ajuste').fill('5');
    await expect(page.getByTestId('orc-cen-ajuste-erro')).toHaveCount(0);
    await semViolacaoAxe(page, '/financeiro/orcamento (cenários)');
    await page.getByTestId('orc-cen-gravar').click();
    await expect(page.getByTestId('orc-cen-mensagem')).toContainText('Cenário cadastrado', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('orc-cen-OTIMISTA-E2E')).toContainText('5,00%');

    // Versão vazia do ano.
    await page.getByTestId('orc-aba-versoes').click();
    await page.getByTestId('orc-nova').click();
    const nova = page.getByTestId('orc-form-nova');
    await campo(page, 'orc-nova-descricao').fill('Orçamento com premissas (E2E C1-125)');
    await nova.getByTestId('orc-nova-criar').click();
    await expect(page.getByTestId('orc-versao')).toBeVisible({ timeout: 30_000 });

    // Premissas: validação na hora pelo tipo e pela faixa.
    await page.getByTestId('orc-aba-premissas').click();
    await expect(page.getByTestId('orc-premissas')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('orc-prem-nenhuma')).toBeVisible();
    const fp = page.getByTestId('orc-prem-form');
    await campo(page, 'orc-prem-descricao').fill('IPCA projetado');
    await fp.getByTestId('orc-prem-gravar').click();
    await expect(page.getByTestId('orc-prem-percentual-erro')).toContainText('percentual');
    await escolher(fp.getByTestId('orc-prem-tipo'), { rotulo: 'Reajuste de tabela de preços' });
    await page.getByTestId('orc-prem-percentual').fill('25');
    await expect(page.getByTestId('orc-prem-justificativa-erro')).toContainText('acima de 20%');
    await escolher(fp.getByTestId('orc-prem-tipo'), { rotulo: 'Inflação' });
    await page.getByTestId('orc-prem-percentual').fill('4,5');
    await expect(page.getByTestId('orc-prem-justificativa-erro')).toHaveCount(0);
    await semViolacaoAxe(page, '/financeiro/orcamento (premissa nova)');
    await fp.getByTestId('orc-prem-gravar').click();
    await expect(page.getByTestId('orc-prem-mensagem')).toContainText('Premissa incluída', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('orc-prem-1')).toContainText('4,50%');

    // Cenário da versão com a projeção e a conta impressa.
    await escolher(page.getByTestId('orc-prem-cenario'), { rotulo: /OTIMISTA-E2E/ });
    await page.getByTestId('orc-prem-aplicar-cenario').click();
    await expect(page.getByTestId('orc-prem-mensagem')).toContainText('Cenário da versão gravado', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('orc-prem-projecao')).toBeVisible();
    await expect(page.getByTestId('orc-prem-resultado-projetado')).toContainText('R$');
    await expect(page.getByTestId('orc-prem-conta')).toContainText('+5.00%');
    await semViolacaoAxe(page, '/financeiro/orcamento (cenário aplicado)');

    // Retirada lógica.
    await page.getByTestId('orc-prem-retirar-1').click();
    await expect(page.getByTestId('orc-prem-mensagem')).toContainText('Premissa retirada', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('orc-prem-nenhuma')).toBeVisible();

    expect(externas).toEqual([]);
  });
});
