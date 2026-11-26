// E2E @C3-001 (F3.7, 06-FAT linha 11): o simulador explica o valor de um item e mede o impacto de um reajuste. Quem
// fatura abre /faturamento/simulador, simula a consulta em consultório (TUSS 10101012) no convênio sintético 305,
// vê a origem do valor e os passos do cálculo; um percentual fora da faixa é recusado; com 10% no índice e 10% na
// tabela, o impacto diz quais alvos mudam o item, o valor atual, o reajustado e a diferença. Nada é gravado (nenhum
// POST sai da tela). Fonte sintética; axe na tela.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const CONVENIO = '305';
const CODIGO = '10101012';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Simulador: explicar o valor e medir o reajuste @C3-001 @fase3', () => {
  test('explicação do valor, percentual recusado e impacto por alvo, sem gravar; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    // O supervisor das contas (M30) tem o simulador (faturamento.preco.*); SINT.FATURAMENTO é o dos convênios (M12).
    await entrar(page, 'SINT.CONTAS');
    let gravacoes = 0;
    page.on('request', (r) => {
      if (r.method() !== 'GET' && new URL(r.url()).pathname.startsWith('/api/faturamento')) gravacoes++;
    });
    await page.goto('/faturamento/simulador');
    const tela = page.getByTestId('tela-faturamento-simulador');
    await expect(tela).toBeVisible();
    await expect(tela).not.toContainText(/SPDATA|legado|sistema atual/i);

    // Sonda: sem banco próprio (503) ou sem o item na tabela do convênio sintético, pula com o motivo.
    const hoje = new Date().toISOString().slice(0, 10);
    const sonda = await page.request.get(
      `/api/faturamento/simulador?convenio=${CONVENIO}&tipo=3&codigo=${CODIGO}&quantidade=2&data=${hoje}`,
    );
    test.skip(sonda.status() === 503, 'API sem banco próprio');
    const corpo = (await sonda.json()) as { encontrado: boolean; preco: unknown };
    test.skip(!corpo.encontrado || !corpo.preco, 'O item sintético não tem preço no convênio 305 nesta data');

    // O setor é escolhido pela lista dos setores do estabelecimento (nunca digitado pelo id).
    await expect(page.getByTestId('sim-setor')).toBeVisible();
    await expect(page.locator('input#sim-setor')).toHaveCount(0);
    await page.getByTestId('sim-conv').fill(CONVENIO);
    await page.getByTestId('sim-cod').fill(CODIGO);
    await page.getByLabel('Quantidade').fill('2');
    await page.getByTestId('sim-rodar').click();
    const resultado = page.getByTestId('sim-resultado');
    await expect(resultado.getByTestId('sim-valor')).toBeVisible();
    await expect(resultado.getByTestId('sim-origem')).toHaveText(/Índice do acordo|Vigência do valor/);
    await expect(resultado.getByTestId('sim-passos').locator('li').last()).toContainText('× 2 =');
    await expect(resultado.getByTestId('sim-impacto')).toHaveCount(0);

    // Percentual fora da faixa: recusado pelo servidor com a mensagem do domínio.
    await page.getByTestId('sim-pct-indice').fill('2000');
    await page.getByTestId('sim-rodar').click();
    await expect(page.getByText(/Percentual entre -99,9999 e 1000/)).toBeVisible();

    // 10% no índice e 10% na tabela: o impacto diz o que muda o item.
    await page.getByTestId('sim-pct-indice').fill('10');
    await page.getByTestId('sim-pct-tabela').fill('10');
    await page.getByTestId('sim-rodar').click();
    const impacto = page.getByTestId('sim-impacto');
    await expect(impacto).toBeVisible();
    await expect(impacto.getByTestId('sim-afetado')).toHaveText(
      /Índice \(CH, UCO, filme\)|Tabela \(vigência do valor\)/,
    );
    await expect(impacto.getByTestId('sim-afetado')).not.toContainText(',');
    await expect(impacto.getByTestId('sim-diferenca')).toBeVisible();
    await expect(impacto.getByTestId('sim-percentual')).toContainText('%');

    // Só o porte anestésico: o item da consulta não usa porte anestésico, e o simulador diz isso.
    await page.getByTestId('sim-pct-indice').fill('');
    await page.getByTestId('sim-pct-tabela').fill('');
    await page.getByTestId('sim-pct-porteAnestesico').fill('5');
    await page.getByTestId('sim-rodar').click();
    await expect(page.getByTestId('sim-nao-afeta')).toBeVisible();

    expect(gravacoes).toBe(0);
    await semViolacaoAxe(page, '/faturamento/simulador');
    expect(externas).toEqual([]);
  });
});
