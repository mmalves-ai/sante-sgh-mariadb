// C2-007 (07-FIN linha 108): o lado das receitas da EFD-Contribuições e a guarda do arquivo entregue. A competência mostra
// a receita das notas de serviço e a contribuição apurada pelo regime escolhido (a fonte sintética não emite nota: a
// receita sai zerada e o crédito fica como saldo); entregue o arquivo, uma correção da escrituração deixa o entregue
// fora da conferência, mas ele continua baixável pela guarda, com o mesmo nome. Axe em cada passo. Fonte SINTÉTICA em
// memória (nada vai a banco nem à Receita); quem gere o financeiro (SINT.FIN.GESTOR) classifica, gera e entrega.
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

test.describe('financeiro: receitas da EFD-Contribuições e arquivo entregue guardado @C2-007', () => {
  test.setTimeout(180_000);

  test('receita e contribuição por regime; o entregue continua baixável depois da correção; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    // Uma competência por execução: a fonte em memória guarda o que a execução anterior gravou.
    const mes = String(1 + ((Date.now() + 5) % 12)).padStart(2, '0');
    const competencia = `${2100 + (Math.floor(Date.now() / 1000) % 60)}-${mes}`;
    await entrar(page, 'SINT.FIN.GESTOR');
    await page.goto('/financeiro/fiscal/entradas');
    // Primeira abertura da tela no servidor de desenvolvimento: a compilação sob demanda passa dos 5 s.
    await expect(page.getByTestId('tela-fin-entradas')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('en-competencia').fill(competencia);
    await page.getByTestId('en-consultar').click();
    await expect(page.getByTestId('ef-painel')).toBeVisible();

    // A receita da competência: nenhuma nota autorizada na fonte sintética; contribuição zerada.
    await expect(page.getByTestId('ef-receitas')).toBeVisible();
    await expect(page.getByTestId('ef-receitas-notas')).toHaveText('0');
    await expect(page.getByTestId('ef-recolher-PIS')).toHaveText('0,00');
    await expect(page.getByTestId('ef-receitas-tabela')).toContainText('Não cumulativo');
    await escolher(page.getByTestId('ef-regime'), 'misto');
    // No misto, a receita hospitalar fica no cumulativo.
    await expect(page.getByTestId('ef-receitas-tabela')).toContainText('Cumulativo');
    await escolher(page.getByTestId('ef-regime'), 'nao_cumulativo');
    await semViolacaoAxe(page, '/financeiro/fiscal/entradas (receitas)');

    // Classifica as duas entradas pelo padrão e gera o arquivo.
    await escolher(page.getByTestId('ef-padrao-cfop'), '1556');
    await escolher(page.getByTestId('ef-padrao-natureza'), '02');
    await page.getByTestId('ef-aplicar-1001').click();
    await page.getByTestId('ef-salvar-1001').click();
    await expect(page.getByTestId('ef-situacao-1001')).toContainText('Escriturada');
    await escolher(page.getByTestId('ef-padrao-cfop'), '1933');
    await page.getByTestId('ef-aplicar-1002').click();
    await page.getByTestId('ef-salvar-1002').click();
    await expect(page.getByTestId('ef-situacao-1002')).toContainText('Escriturada');
    await expect(page.getByTestId('ef-conf-estado')).toContainText('pode ser gerado');
    // Sem receita, o crédito não desconta nada e fica todo como saldo.
    await expect(page.getByTestId('ef-receita-PIS')).toContainText('0,00');
    await page.getByTestId('ef-gerar').click();
    await expect(page.getByTestId('ef-arquivo-1')).toContainText('Gerado');
    await page.getByTestId('ef-recibo-1').fill('REC-SINT-C2007');
    await page.getByTestId('ef-entregar-1').click();
    await expect(page.getByTestId('ef-arquivo-1')).toContainText('Entregue');

    // Correção depois da entrega: a base do PIS do item 1 de 1001 cai para 900.
    await page.getByTestId('ef-base-pis-1001-1').fill('900');
    await page.getByTestId('ef-salvar-1001').click();
    await expect(page.getByTestId('ef-mensagem')).toContainText('Classificação');
    // O entregue já não confere com a escrituração de hoje, mas o texto guardado continua baixável.
    await expect(page.getByTestId('ef-baixar-1')).toHaveText('Baixar o arquivo guardado');
    const download = page.waitForEvent('download');
    await page.getByTestId('ef-baixar-1').click();
    expect((await download).suggestedFilename()).toBe(`efd-contribuicoes-${competencia}-01.txt`);
    await semViolacaoAxe(page, '/financeiro/fiscal/entradas (entregue guardado)');
    expect(externas).toEqual([]);
  });
});
