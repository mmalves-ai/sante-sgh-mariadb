// F3.8 (07-FIN linha 108): os dados fiscais das entradas e a EFD-Contribuições numa tela só. A competência abre com as
// entradas por classificar e o arquivo travado; a classificação padrão preenche os itens pendentes de uma vez e o
// crédito aparece na hora (base x alíquota); a base acima do valor do item trava o botão com o aviso; gravadas as
// duas entradas, a conferência fecha e libera o arquivo; o arquivo gerado recebe o recibo da entrega. Axe em cada
// passo. Fonte SINTÉTICA em memória (nada vai a banco nem à Receita). Classificar e gerar não vêm de opção de menu
// (são dados por perfil): quem gere o financeiro (SINT.FIN.GESTOR) faz os dois.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
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

test.describe('financeiro: escrituração das entradas e EFD-Contribuições @F3.8 @F3.8-10', () => {
  test.setTimeout(180_000);

  test('classifica com o padrão, a regra trava na hora, a conferência libera o arquivo e a entrega guarda o recibo; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    // Uma competência por execução: a fonte em memória guarda o que a execução anterior gravou.
    const mes = String(1 + (Date.now() % 12)).padStart(2, '0');
    const competencia = `${2030 + (Math.floor(Date.now() / 1000) % 60)}-${mes}`;
    await entrar(page, 'SINT.FIN.GESTOR');
    await page.goto('/financeiro/fiscal/entradas');
    await expect(page.getByTestId('tela-fin-entradas')).toBeVisible();
    await page.getByTestId('en-competencia').fill(competencia);
    await page.getByTestId('en-consultar').click();
    await expect(page.getByTestId('ef-painel')).toBeVisible();
    await expect(page.getByTestId('ef-entrada-1001')).toBeVisible();
    await expect(page.getByTestId('ef-situacao-1001')).toContainText('Pendente');
    // 1001: CFOP de saída e os dois CST; 1002: os dois CST em cada um dos dois itens.
    await expect(page.getByTestId('ef-conf-pendencias')).toHaveText('7');
    await expect(page.getByTestId('ef-gerar')).toBeDisabled();
    await semViolacaoAxe(page, '/financeiro/fiscal/entradas (pendente)');

    // Classificação padrão: um clique por entrada preenche os itens pendentes; o crédito aparece na hora.
    await escolher(page.getByTestId('ef-padrao-cfop'), '1556');
    await escolher(page.getByTestId('ef-padrao-natureza'), '02');
    await page.getByTestId('ef-aplicar-1001').click();
    // 1000 x 1,65% = 16,50; 1000 x 7,6% = 76,00.
    await expect(page.getByTestId('ef-credito-1001-1')).toHaveText('16,50 / 76,00');
    // Base acima do valor do item: aviso na hora e botão preso.
    await page.getByTestId('ef-base-pis-1001-1').fill('1000.01');
    await expect(page.getByTestId('ef-aviso-1001')).toContainText('não passa do valor do item');
    await expect(page.getByTestId('ef-salvar-1001')).toBeDisabled();
    await page.getByTestId('ef-base-pis-1001-1').fill('1000');
    await expect(page.getByTestId('ef-salvar-1001')).toBeEnabled();
    await page.getByTestId('ef-salvar-1001').click();
    await expect(page.getByTestId('ef-mensagem')).toContainText('Classificação fiscal gravada');
    await expect(page.getByTestId('ef-situacao-1001')).toContainText('Escriturada');

    // 1002 (serviço tomado): o segundo item não dá crédito (CST 70 zera base, alíquota e natureza).
    await escolher(page.getByTestId('ef-padrao-cfop'), '1933');
    await page.getByTestId('ef-aplicar-1002').click();
    await escolher(page.getByTestId('ef-cst-pis-1002-2'), '70');
    await escolher(page.getByTestId('ef-cst-cofins-1002-2'), '70');
    await expect(page.getByTestId('ef-credito-1002-2')).toHaveText('0,00 / 0,00');
    await page.getByTestId('ef-salvar-1002').click();
    await expect(page.getByTestId('ef-situacao-1002')).toContainText('Escriturada');

    // Conferência fechada: PIS 16,50 + 4,95 = 21,45; COFINS 76,00 + 22,80 = 98,80.
    await expect(page.getByTestId('ef-conf-pendencias')).toHaveText('0');
    await expect(page.getByTestId('ef-conf-pis')).toHaveText('21,45');
    await expect(page.getByTestId('ef-conf-cofins')).toHaveText('98,80');
    await expect(page.getByTestId('ef-conf-estado')).toContainText('pode ser gerado');
    await semViolacaoAxe(page, '/financeiro/fiscal/entradas (conferida)');

    await page.getByTestId('ef-gerar').click();
    await expect(page.getByTestId('ef-mensagem')).toContainText('Arquivo original gerado com 2 documento(s)');
    await expect(page.getByTestId('ef-arquivo-1')).toContainText('Original');
    await expect(page.getByTestId('ef-arquivo-1')).toContainText('Gerado');
    await expect(page.getByTestId('ef-baixar-1')).toBeVisible();
    // Recibo curto: botão preso; com o recibo, a entrega fica registrada.
    await page.getByTestId('ef-recibo-1').fill('123');
    await expect(page.getByTestId('ef-entregar-1')).toBeDisabled();
    await page.getByTestId('ef-recibo-1').fill('REC-SINT-0001');
    await page.getByTestId('ef-entregar-1').click();
    await expect(page.getByTestId('ef-arquivo-1')).toContainText('Entregue');
    await expect(page.getByTestId('ef-arquivo-1')).toContainText('REC-SINT-0001');
    await semViolacaoAxe(page, '/financeiro/fiscal/entradas (entregue)');
    expect(externas).toEqual([]);
  });
});
