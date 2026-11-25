// F3.8 (07-FIN linha 66): a tela do pagamento eletrônico. Chega-se por um clique a partir das remessas; o arquivo de
// retorno é conferido na hora, antes de enviar (arquivo que não é retorno CNAB 240 prende o botão e diz o motivo; o
// arquivo bem formado mostra quantas linhas e quantos títulos traz); nos dados bancários do credor, o credor é achado
// pelo código ou nome e a chave Pix é conferida a cada tecla; só o cadastro de credores (SINT.FIN.CREDOR) grava a conta,
// quem gera a remessa (SINT.FIN.PAGA) vê o botão preso (C1-026) (chave inválida ou de outro titular prende o botão; o tipo
// da chave é sugerido pela forma digitada). A fonte do E2E é a sintética, sem banco: a gravação (baixa pelo retorno,
// cadastro da conta e remessa por Pix) é provada no contrato de efeito pagamento-eletronico.int.spec.ts. Axe nos passos.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const linha = (campos: readonly (readonly [number, string])[]) => {
  const l = Array.from({ length: 240 }, () => ' ');
  for (const [de, v] of campos) for (let i = 0; i < v.length; i++) l[de - 1 + i] = v[i] as string;
  return l.join('');
};
/** Retorno CNAB 240 sintético bem formado: cabeçalho de retorno, um segmento A e o rodapé. */
const RETORNO = [
  linha([
    [1, '001'],
    [8, '0'],
    [143, '2'],
    [158, '000001'],
  ]),
  linha([
    [1, '001'],
    [8, '3'],
    [14, 'A'],
    [74, '00000000000000000001'],
    [120, '000000000010000'],
    [231, '00'],
  ]),
  linha([
    [1, '001'],
    [8, '9'],
    [24, '000003'],
  ]),
].join('\r\n');

test.describe('financeiro: pagamento eletrônico @F3.8-03', () => {
  test.setTimeout(180_000);

  test('atalho das remessas; retorno conferido na hora; chave Pix do credor conferida a cada tecla; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.FIN.PAGA');
    await page.goto('/financeiro/pagar/remessas');
    await page.getByTestId('remessas-pagamento-eletronico').click();
    await expect(page).toHaveURL(/\/financeiro\/pagar\/pagamento-eletronico/);
    await expect(page.getByTestId('tela-fin-pagamento-eletronico')).toBeVisible();
    await expect(page.getByTestId('pe-aba-retorno')).toHaveAttribute('aria-pressed', 'true');

    // Arquivo que não é retorno: o motivo aparece na hora e o botão fica preso.
    await page.getByTestId('pe-arquivo').setInputFiles({
      name: 'nao-e-retorno.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('linha curta\r\noutra linha\r\n'),
    });
    await expect(page.getByTestId('pe-arquivo-recusado')).toContainText('240 posições');
    await expect(page.getByTestId('pe-processar')).toBeDisabled();
    // Remessa em vez de retorno (cabeçalho sem o código de retorno): também recusado antes de enviar.
    await page.getByTestId('pe-arquivo').setInputFiles({
      name: 'remessa.rem',
      mimeType: 'text/plain',
      buffer: Buffer.from(RETORNO.replace(/^(.{142})2/, '$11')),
    });
    await expect(page.getByTestId('pe-arquivo-recusado')).toContainText('código de retorno');
    // Arquivo bem formado: a tela diz o que ele traz (o botão ainda espera a remessa escolhida).
    await page.getByTestId('pe-arquivo').setInputFiles({
      name: 'retorno-sintetico.ret',
      mimeType: 'text/plain',
      buffer: Buffer.from(RETORNO),
    });
    await expect(page.getByTestId('pe-arquivo-ok')).toContainText('3 linha(s), 1 título(s)');
    await expect(page.getByTestId('pe-processar')).toBeDisabled();
    await semViolacaoAxe(page, '/financeiro/pagar/pagamento-eletronico (retorno)');

    // Remessa por Pix: sem título marcado o botão fica preso e o total diz zero.
    await page.getByTestId('pe-aba-pix').click();
    await expect(page.getByTestId('pe-pix-gerar')).toBeDisabled();
    await expect(page.getByTestId('pe-pix-total')).toContainText('0 título(s)');

    // C1-026, segregação de funções: quem gera a remessa vê os dados bancários do credor, mas não os grava.
    await page.getByTestId('pe-aba-credor').click();
    await page.getByTestId('pe-credor-busca').fill('5001');
    await page.locator('[data-testid^="pe-credor-opcao-"]').first().click();
    await expect(page.getByTestId('pe-credor-escolhido')).toBeVisible();
    await page.getByTestId('pe-titular').fill('Fornecedor Sintético');
    await page.getByTestId('pe-documento').fill('529.982.247-25');
    await page.getByTestId('pe-chave').fill('529.982.247-25');
    await expect(page.getByTestId('pe-recusa-conta')).toHaveCount(0);
    await expect(page.getByTestId('pe-sem-permissao-conta')).toContainText('cadastro de credores');
    await expect(page.getByTestId('pe-gravar-conta')).toBeDisabled();

    // Dados bancários do credor pelo cadastro de credores: achado pelo código, sem id digitado às cegas; só a aba
    // do credor aparece (não lê nem gera remessa).
    await entrar(page, 'SINT.FIN.CREDOR');
    await page.goto('/financeiro/pagar/pagamento-eletronico');
    await expect(page.getByTestId('tela-fin-pagamento-eletronico')).toBeVisible();
    await expect(page.getByTestId('pe-aba-retorno')).toHaveCount(0);
    await expect(page.getByTestId('pe-aba-pix')).toHaveCount(0);
    await expect(page.getByTestId('pe-aba-credor')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('pe-credor-busca').fill('5001');
    await page.locator('[data-testid^="pe-credor-opcao-"]').first().click();
    await expect(page.getByTestId('pe-credor-escolhido')).toBeVisible();
    await page.getByTestId('pe-titular').fill('Fornecedor Sintético');
    await page.getByTestId('pe-documento').fill('11.222.333/0001-81');
    // Sem conta nem chave: falta o destino.
    await expect(page.getByTestId('pe-recusa-conta')).toContainText('conta em banco ou a chave Pix');
    await expect(page.getByTestId('pe-gravar-conta')).toBeDisabled();
    // CPF como chave de um titular com CNPJ: o tipo é sugerido pela forma e a chave de outro titular é recusada.
    await page.getByTestId('pe-chave').fill('529.982.247-25');
    await expect(page.getByTestId('pe-recusa-conta')).toContainText('documento do titular');
    await expect(page.getByTestId('pe-gravar-conta')).toBeDisabled();
    // A chave do próprio titular fecha: o botão libera.
    await page.getByTestId('pe-cancelar-correcao').waitFor({ state: 'detached' });
    await page.getByTestId('pe-chave').fill('');
    await page.getByTestId('pe-titular').fill('Fornecedor Sintético');
    await page.getByTestId('pe-documento').fill('529.982.247-25');
    await page.getByTestId('pe-chave').fill('529.982.247-25');
    await expect(page.getByTestId('pe-recusa-conta')).toHaveCount(0);
    await expect(page.getByTestId('pe-sem-permissao-conta')).toHaveCount(0);
    await expect(page.getByTestId('pe-gravar-conta')).toBeEnabled();
    await semViolacaoAxe(page, '/financeiro/pagar/pagamento-eletronico (dados bancários do credor)');
    expect(externas).toEqual([]);
  });
});
