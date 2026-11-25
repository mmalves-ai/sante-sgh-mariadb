// E2E @C2-083 (07-FIN linha 157): remuneração variável do profissional. O analista escolhe o médico sintético, inclui o
// mínimo garantido, vê as faixas sobrepostas recusadas na hora (o botão fica desligado e o aviso aparece), corrige e
// inclui a meta de produtividade, informa o valor apurado da competência, escolhe a apuração em aberto, confere a
// simulação (lançado/a lançar) e lança; axe sem violação séria. Fonte sintética de dev (médico, eventos, indicadores e
// apuração SINTÉTICOS); combos pelo e2e/combos.ts.
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

test.describe('remuneração variável do profissional @C2-083', () => {
  test.setTimeout(180_000);

  test('mínimo → faixas recusadas na hora → meta → valor apurado → simular → lançar; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.REP.ANALISTA');
    await page.goto('/repasse/remuneracao-variavel');
    await expect(page.getByTestId('tela-rep-remuneracao-variavel')).toBeVisible();

    // O médico pela busca (nome · conselho).
    await page.getByTestId('rv-medico-busca').fill('7002');
    await page.getByTestId('rv-medico-buscar').click();
    await expect(page.getByTestId('rv-medico')).toContainText('MEDICO SINTETICO');
    await expect(page.getByTestId('rv-min-incluir')).toBeVisible();
    await semViolacaoAxe(page, '/repasse/remuneracao-variavel');

    // Mínimo garantido: sem evento o botão fica desligado; com tudo, grava.
    await page.getByTestId('rv-min-valor').fill('5000');
    await expect(page.getByTestId('rv-min-incluir')).toBeDisabled();
    await escolher(page.getByTestId('rv-min-evento'), { indice: 0 });
    await expect(page.getByTestId('rv-min-incluir')).toBeEnabled();
    await page.getByTestId('rv-min-incluir').click();
    await expect(page.getByTestId('rv-mensagem')).toContainText('Gravado');
    await expect(page.getByTestId('rv-minimos')).toContainText('5.000,00');

    // Meta de produtividade: faixas sobrepostas recusadas na hora, sem ir ao servidor.
    await escolher(page.getByTestId('rv-meta-indicador'), { indice: 0 });
    await escolher(page.getByTestId('rv-meta-forma'), { rotulo: /% da produção/ });
    await escolher(page.getByTestId('rv-meta-evento'), { indice: 0 });
    await page.getByTestId('rv-faixa-de-0').fill('80');
    await page.getByTestId('rv-faixa-ate-0').fill('100');
    await page.getByTestId('rv-faixa-premio-0').fill('5');
    await page.getByTestId('rv-faixa-mais').click();
    await page.getByTestId('rv-faixa-de-1').fill('95');
    await page.getByTestId('rv-faixa-premio-1').fill('10');
    await expect(page.getByTestId('rv-faixas-problemas')).toContainText('se sobrepõem');
    await expect(page.getByTestId('rv-meta-incluir')).toBeDisabled();
    await page.getByTestId('rv-faixa-de-1').fill('100.01');
    await expect(page.getByTestId('rv-faixas-problemas')).toHaveCount(0);
    await page.getByTestId('rv-meta-incluir').click();
    await expect(page.getByTestId('rv-mensagem')).toContainText('Gravado');
    await expect(page.getByTestId('rv-metas')).toBeVisible();

    // Valor apurado da competência na linha da meta.
    const linha = page
      .locator('[data-testid^="rv-meta-"]')
      .filter({ has: page.locator('[data-testid^="rv-apu-valor-"]') });
    await linha.first().locator('[data-testid^="rv-apu-valor-"]').fill('92');
    await linha.first().locator('[data-testid^="rv-apu-informar-"]').click();
    await expect(page.getByTestId('rv-mensagem')).toContainText('Gravado');
    await expect(linha.first().locator('[data-testid^="rv-apurados-"]')).toContainText('92');

    // Na apuração: simulação com o complemento do mínimo e a produtividade, depois o lançamento.
    await escolher(page.getByTestId('rv-apuracao'), { indice: 0 });
    await expect(page.getByTestId('rv-sim-itens')).toBeVisible();
    await expect(page.getByTestId('rv-sim-itens')).toContainText('a lançar');
    await semViolacaoAxe(page, '/repasse/remuneracao-variavel (apuração)');
    await page.getByTestId('rv-lancar').click();
    await expect(page.getByTestId('rv-mensagem')).toContainText('lançamento(s)');
    await expect(page.getByTestId('rv-sim-itens')).not.toContainText('a lançar');
    await expect(page.getByTestId('rv-lancar')).toBeDisabled();

    expect(externas).toEqual([]);
  });
});
