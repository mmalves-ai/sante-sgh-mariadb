// F3.8 (07-FIN linha 100): o de-para contábil mantido na tela da exportação, pela API de verdade. Sessão real sobre a
// fonte sintética e a porta do financeiro em MEMÓRIA (o `ContabilFiscalController` responde por ela quando não há
// banco do cliente, com as mesmas regras da gravação; nada vai a banco nem ao escritório contábil). O que fica no banco
// é provado no contrato de efeito `contabil-fiscal.int.spec.ts`; aqui se prova o fluxo: o título lançado no mês aparece
// como "falta conta"; a conta de cada lado é gravada ao sair do campo; a conta fora do formato é recusada na hora; a
// exceção por natureza entra na mesma grade e mostra a conta que o outro lado herda; o credor é achado pelo nome e
// ganha o código do escritório; com tudo mapeado o aviso some e o lote do período sai sem lançamento de fora. Axe.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const DESPESA = 'fin_despesa_reconhecida';
const PAGAMENTO = 'fin_pagamento_titulo';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const gravacao = (page: Page) =>
  page.waitForResponse(
    (r) => r.url().includes('/api/financeiro/contabil-fiscal/de-para') && r.request().method() === 'POST',
  );

/** Digita no campo e sai dele: a grade grava na saída do campo. Devolve o status da gravação. */
async function gravarCampo(page: Page, testid: string, valor: string): Promise<number> {
  const campo = page.getByTestId(testid);
  const resposta = gravacao(page);
  await campo.fill(valor);
  await campo.blur();
  return (await resposta).status();
}

/** Deixa o campo vazio (desliga a regra, que continua no histórico) quando uma execução anterior o preencheu. */
async function esvaziar(page: Page, testid: string): Promise<void> {
  const campo = page.getByTestId(testid);
  if ((await campo.count()) === 0 || (await campo.inputValue()) === '') return;
  expect(await gravarCampo(page, testid, '')).toBe(200);
}

test.describe('financeiro: de-para contábil por evento @F3.8-09', () => {
  test.setTimeout(240_000);

  test('falta conta → grava ao sair do campo → exceção por natureza → código do credor → lote sem lançamento de fora; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const sufixo = String(Date.now() % 100_000);
    const documento = String(810_000 + Number(sufixo));
    await entrar(page, 'SINT.FIN.LANCA');

    // Um título a pagar emitido hoje: a despesa do mês que precisa de conta nos dois lados.
    await page.goto('/financeiro/pagar/titulos');
    await expect(page.getByTestId('tela-fin-titulos-pagar')).toBeVisible();
    await page.getByTestId('tp-novo').click();
    await page.getByTestId('tp-novo-credor').fill('5001');
    await page.getByTestId('tp-novo-documento').fill(documento);
    await page.getByTestId('tp-novo-valor').fill('1500');
    await page.getByTestId('tp-novo-quantas').fill('1');
    await escolher(page.getByTestId('tp-novo-classificacao'), '216.2.1');
    await page.getByTestId('tp-lancar').click();
    await expect(page.getByTestId('tp-mensagem')).toContainText('lançado');

    await page.goto('/financeiro/contabil/exportacao');
    await expect(page.getByTestId('tela-fin-contabil')).toBeVisible();
    await expect(page.getByTestId('dp-grade')).toBeVisible();
    await expect(page.getByTestId(`dp-linha-${DESPESA}-geral`)).toBeVisible();

    // Estado de partida: sem conta nos campos deste roteiro (a porta em memória guarda o de-para entre execuções).
    await esvaziar(page, `dp-debito-${DESPESA}-1`);
    await expect(page.getByTestId(`dp-linha-${DESPESA}-1`)).toHaveCount(0);
    for (const campo of [
      `dp-debito-${DESPESA}-geral`,
      `dp-credito-${DESPESA}-geral`,
      `dp-credito-${PAGAMENTO}-geral`,
    ])
      await esvaziar(page, campo);

    // O que falta no período aparece em cima, antes de exportar.
    await expect(page.getByTestId('dp-faltam')).toContainText('ficariam fora do lote');
    await expect(page.getByTestId('dp-faltam')).toContainText('débito');
    await semViolacaoAxe(page, '/financeiro/contabil/exportacao (falta conta)');

    // A conta fora do formato é recusada pelo servidor na hora; nada fica gravado.
    expect(await gravarCampo(page, `dp-debito-${DESPESA}-geral`, 'conta inválida!')).toBe(409);
    await expect(page.getByTestId('recusa-faturamento')).toContainText('letras, números');

    // A conta de cada lado, gravada ao sair do campo.
    const debito = `3.1.${sufixo}`;
    const credito = `2.1.${sufixo}`;
    expect(await gravarCampo(page, `dp-debito-${DESPESA}-geral`, debito)).toBe(200);
    await expect(page.getByTestId('dp-ok')).toContainText('De-para contábil gravado');
    await expect(page.getByTestId('recusa-faturamento')).toHaveCount(0);
    expect(await gravarCampo(page, `dp-credito-${DESPESA}-geral`, credito)).toBe(200);
    expect(await gravarCampo(page, `dp-credito-${PAGAMENTO}-geral`, `1.1.${sufixo}`)).toBe(200);
    await expect(page.getByTestId(`dp-debito-${DESPESA}-geral`)).toHaveValue(debito);
    await expect(page.getByTestId(`dp-credito-${DESPESA}-geral`)).toHaveValue(credito);

    // Com os dois lados mapeados, o aviso some.
    await expect(page.getByTestId('dp-completo')).toBeVisible();
    await expect(page.getByTestId('dp-faltam')).toHaveCount(0);

    // A exceção por natureza entra na mesma grade; o lado sem conta mostra a que herda da regra geral.
    await expect(page.getByTestId(`dp-nat-adicionar-${DESPESA}`)).toBeDisabled();
    await escolher(page.getByTestId(`dp-nat-${DESPESA}`), '1');
    await page.getByTestId(`dp-nat-conta-${DESPESA}`).fill(`3.9.${sufixo}`);
    const excecao = gravacao(page);
    await page.getByTestId(`dp-nat-adicionar-${DESPESA}`).click();
    expect((await excecao).status()).toBe(200);
    await expect(page.getByTestId(`dp-linha-${DESPESA}-1`)).toBeVisible();
    await expect(page.getByTestId(`dp-debito-${DESPESA}-1`)).toHaveValue(`3.9.${sufixo}`);
    await expect(page.getByTestId(`dp-herda-credito-${DESPESA}-1`)).toContainText(credito);

    // O credor achado pelo nome ganha o código do escritório contábil.
    await page.getByTestId('dp-credor-busca').fill('SINTETICO A');
    await page
      .getByTestId('dp-credor-achados')
      .getByRole('button', { name: /FORNECEDOR SINTETICO A/ })
      .click();
    await page.getByTestId('dp-credor-codigo').fill(`F-${sufixo}`);
    const credor = gravacao(page);
    await page.getByTestId('dp-credor-gravar').click();
    expect((await credor).status()).toBe(200);
    await expect(page.getByTestId('dp-cr-5001')).toHaveValue(`F-${sufixo}`);
    await semViolacaoAxe(page, '/financeiro/contabil/exportacao (de-para gravado)');

    // O lote do período usa o de-para mantido: nenhum lançamento fica de fora.
    await expect(page.getByTestId('ec-exportar')).toBeEnabled();
    await page.getByTestId('ec-exportar').click();
    await expect(page.getByTestId('ec-mensagem')).toContainText('Lote contábil exportado');
    await expect(page.getByTestId('ec-mensagem')).toContainText('0 sem de-para');

    // Recarregada a tela, o de-para gravado continua lá.
    await page.reload();
    await expect(page.getByTestId(`dp-debito-${DESPESA}-geral`)).toHaveValue(debito);
    await expect(page.getByTestId('dp-cr-5001')).toHaveValue(`F-${sufixo}`);
    expect(externas).toEqual([]);
  });
});
