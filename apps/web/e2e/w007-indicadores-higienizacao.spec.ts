// E2E @W0-07 (programa CRUD completo, mercado M3): os indicadores de higienização e giro de leito. Do painel da
// higienização, a tela de indicadores mostra o tempo de giro do leito, o percentual liberado no prazo e o tempo de
// execução com numerador e denominador, troca o recorte (por área) e exporta o CSV com o recorte e as parcelas. axe sem
// violação séria. Sessão real sobre as portas em MEMÓRIA (dados SINTÉTICOS; nada vai à cópia; nenhuma mensagem).
import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
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

test.describe('@W0-07 indicadores de higienização e giro de leito', () => {
  test('giro, no prazo e execução com numerador e denominador; recorte por área; CSV; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.SUPERVISOR.HIG');
    await page.goto('/higienizacao/painel');
    await page.getByTestId('hig-link-indicadores').click();
    await expect(page).toHaveURL(/\/higienizacao\/indicadores/);
    const tabela = page.getByTestId('hig-ind-tabela');
    await expect(tabela).toBeVisible();
    await expect(page.getByTestId('hig-ind-periodo')).toContainText('liberada');
    for (const nome of [
      'Tempo médio de giro do leito',
      'Higienizações liberadas dentro do prazo',
      'Tempo médio de execução da limpeza',
    ]) {
      const linha = tabela.getByRole('row', { name: new RegExp(nome) });
      await expect(linha).toBeVisible();
      await expect(linha.getByRole('cell').nth(2)).toHaveText(/^\d+$/);
      await expect(linha.getByRole('cell').nth(3)).toHaveText(/^\d+$/);
    }
    await escolher(page.getByTestId('hig-ind-recorte'), 'area');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('hig-ind-exportar').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(
      /^indicadores-higienizacao-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    const csv = (await readFile((await download.path()) as string, 'utf8')).split('\r\n');
    expect(csv[0]).toBe('Início;Fim;Indicador;Recorte;Grupo;Numerador;Denominador;Valor;Unidade');
    expect(csv[1]).toMatch(/;Tempo médio de giro do leito .*;Total;Total;\d+;\d+;[\d,]*;minutos$/);
    expect(
      csv.some((l) => /;Higienizações liberadas dentro do prazo;Total;Total;\d+;\d+;[\d,]*;%$/.test(l)),
    ).toBe(true);

    await semViolacaoAxe(page, 'indicadores de higienização');
    expect(externas).toEqual([]);
  });
});
