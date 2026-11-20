// E2E @W0-07 (programa CRUD completo, mercado M2): os indicadores do PA completos. A tela de indicadores do período
// mostra o retorno ao PA em 72 horas e a taxa de internação via PA com numerador, denominador e taxa (e as parcelas
// pelo desfecho e pelo encaminhamento), e exporta o CSV. axe sem violação séria. Sessão real sobre a fonte sintética e
// as portas em MEMÓRIA (dados SINTÉTICOS; nada vai à cópia; nenhuma mensagem a paciente).
import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('@W0-07 indicadores do PA completos', () => {
  test('retorno em 72 h e internação via PA com numerador e denominador; CSV exportado; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ATENDIMENTO');
    await page.goto('/recepcao/atendimento/indicadores');
    const tabela = page.getByTestId('ind-atd-qualidade-pa');
    await expect(tabela).toBeVisible();
    for (const nome of [
      'Retorno ao PA em 72 horas',
      'Taxa de internação via PA',
      'Internação via PA: pelo desfecho',
      'Internação via PA: pelo encaminhamento',
    ])
      await expect(tabela.getByRole('row', { name: new RegExp(nome) })).toBeVisible();
    // O denominador do retorno e da internação é o total do PA do período (as parcelas impressas no cartão do PA).
    const linhaRetorno = tabela.getByRole('row', { name: /Retorno ao PA em 72 horas/ });
    await expect(linhaRetorno.getByRole('cell').nth(2)).toHaveText(/^\d+$/);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('ind-atd-exportar-pa').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^indicadores-pa-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await readFile((await download.path()) as string, 'utf8');
    const linhas = csv.split('\r\n');
    expect(linhas[0]).toBe('Início;Fim;Indicador;Numerador;Denominador;Taxa (%)');
    expect(linhas[1]).toMatch(/;Retorno ao PA em 72 horas;\d+;\d+;/);
    expect(linhas[2]).toMatch(/;Taxa de internação via PA;\d+;\d+;/);

    await semViolacaoAxe(page, 'indicadores do PA');
    expect(externas).toEqual([]);
  });
});
