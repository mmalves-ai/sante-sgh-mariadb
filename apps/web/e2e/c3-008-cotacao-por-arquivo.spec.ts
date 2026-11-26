// E2E @C3-008 (05-SUP linha 19): a troca do mapa de cotação por arquivo, primeiro adaptador da porta genérica do portal
// de cotação. Roda na sessão sintética de dev/ci (logins SINT.*, porta de suprimentos em memória, que lê o arquivo pela
// mesma regra da porta própria). O comprador abre o mapa de cotação de um pedido, baixa o mapa em CSV, preenche o preço
// de uma linha e importa o arquivo devolvido: a proposta mostra o preço novo. Uma linha com valor negativo recusa o
// arquivo inteiro. O efeito no MariaDB (cotacao_resposta_item, cotacao_fornecedor e vinculo_pedido_compra_portal) está
// em apps/api/src/modulos/suprimentos/mapa-cotacao.int.spec.ts. Massa SINTÉTICA; nenhum dado de pessoa.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const LOGIN = 'SINT.CONTRATOS';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('@C3-008 cotação por arquivo', () => {
  test('baixa o mapa, importa o arquivo devolvido e recusa a linha inválida', async ({ page }) => {
    vigiarExternas(page);
    await entrar(page, LOGIN);
    await page.goto('/suprimentos/pedidos');
    await page
      .getByRole('link', { name: /Mapa de cotação/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/suprimentos\/pedidos\/\d+\/\d+\/cotacao/);
    await expect(page.getByText(/Troca por arquivo/)).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('cot-baixar-mapa').click(),
    ]);
    const caminho = await download.path();
    const fs = await import('node:fs/promises');
    const mapa = (await fs.readFile(caminho!, 'utf-8')).replace(/^\uFEFF/, '');
    const linhas = mapa.split('\r\n');
    expect(linhas[0]).toContain('codigo_proposta;item;sequencia');
    const primeira = linhas[1]!.split(';');
    primeira[7] = '4,25';
    primeira[8] = 'Marca Sintética';
    const devolvido = [linhas[0], primeira.join(';')].join('\r\n');

    await page.getByTestId('cot-arquivo').setInputFiles({
      name: 'mapa-devolvido.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(devolvido, 'utf-8'),
    });
    await expect(page.getByTestId('cot-mensagem')).toHaveText('Respostas da cotação importadas.');

    const invalido = [linhas[0], `${primeira[0]};;;;;;;-1;`].join('\r\n');
    await page.getByTestId('cot-arquivo').setInputFiles({
      name: 'mapa-invalido.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(invalido, 'utf-8'),
    });
    await expect(page.getByText(/Linha 2: O valor unitário/)).toBeVisible();
    await semViolacaoAxe(page);
  });
});
