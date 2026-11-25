// E2E @F3.6-06 (F3.6, 05-SUP linha 13): o kit padrão no pedido de material, pela tela. A pessoa cadastra o kit padrão
// de uma cirurgia em `/suprimentos/kits` e, na requisição do setor, acha a cirurgia pelo nome, vê o kit com a
// composição, é barrada na hora se o número de kits não vale, soma o kit ao pedido (2 kits × a composição numa linha
// marcada "do kit padrão"), soma de novo sem duplicar a linha e envia. Sessão real sobre a fonte sintética de dev e a
// porta do estoque EM MEMÓRIA (itens, cirurgias e locais FICTÍCIOS; nada vai ao banco). O que fica no banco (o kit
// gravado na linha da requisição e as recusas) está no contrato de efeito
// apps/api/src/modulos/suprimentos/kit-padrao-requisicao.int.spec.ts.
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

test.describe('Kit padrão no pedido de material @F3.6-06', () => {
  test('cadastra o kit da cirurgia, soma ao pedido com validação na hora e envia a requisição; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ADMIN');

    // O kit padrão da cirurgia de joelho: 2 unidades do item 5001 por kit.
    await page.goto('/suprimentos/kits');
    await expect(page.getByTestId('kit-padrao-cadastro')).toBeVisible();
    await page.getByTestId('kit-padrao-novo').click();
    await page.getByTestId('kit-padrao-codigo').fill('KE2E6');
    await page.getByTestId('kit-padrao-nome').fill('KIT FICTICIO JOELHO');
    await page.getByTestId('kit-padrao-busca-termo').fill('LUVA');
    await page.getByTestId('kit-padrao-busca-buscar').click();
    await page.getByTestId('kit-padrao-busca-opcao-5001').click();
    await page.getByTestId('kit-padrao-qtd-5001').fill('2');
    await page.getByTestId('kit-padrao-proc-termo').fill('JOELHO');
    await page.getByTestId('kit-padrao-proc-buscar').click();
    await page.getByTestId('kit-padrao-proc-CIR-702').click();
    await page.getByTestId('kit-padrao-padrao-0').check();
    await page.getByTestId('kit-padrao-gravar').click();
    await expect(page.getByTestId('kit-padrao-mensagem')).toBeVisible();

    // Na requisição: a cirurgia sem kit padrão não sugere nada; a de joelho traz o kit com a composição.
    await page.goto('/suprimentos/requisicoes');
    await expect(page.getByTestId('tela-suprimentos-requisicoes')).toBeVisible();
    await page.getByTestId('kit-pedido-termo').fill('CURATIVO');
    await page.getByTestId('kit-pedido-buscar').click();
    await expect(page.getByTestId('kit-pedido-nenhum')).toBeVisible();
    await page.getByTestId('kit-pedido-termo').fill('JOELHO');
    await page.getByTestId('kit-pedido-buscar').click();
    const sugerido = page.getByTestId('kit-pedido-CIR-702');
    await expect(sugerido).toContainText('KIT FICTICIO JOELHO');
    await expect(sugerido).toContainText('LUVA DE PROCEDIMENTO');

    // Número de kits que não vale: a recusa aparece na hora e o botão fica desligado.
    await page.getByTestId('kit-pedido-kits-CIR-702').fill('0');
    await expect(page.getByTestId('kit-pedido-recusa-CIR-702')).toBeVisible();
    await expect(page.getByTestId('kit-pedido-somar-CIR-702')).toBeDisabled();
    await page.getByTestId('kit-pedido-kits-CIR-702').fill('2');
    await expect(page.getByTestId('kit-pedido-recusa-CIR-702')).toHaveCount(0);

    // Dois kits × 2 unidades = 4 na linha, marcada como do kit padrão; somar de novo não duplica a linha.
    await page.getByTestId('kit-pedido-somar-CIR-702').click();
    await expect(page.getByTestId('kit-pedido-mensagem')).toBeVisible();
    await expect(page.getByTestId('req-qtde-5001')).toHaveValue('4');
    await expect(page.getByTestId('req-linha-5001')).toContainText('do kit padrão');
    await page.getByTestId('kit-pedido-somar-CIR-702').click();
    await expect(page.getByTestId('req-qtde-5001')).toHaveValue('8');
    await expect(page.locator('[data-testid^="req-linha-"]')).toHaveCount(1);
    await semViolacaoAxe(page, '/suprimentos/requisicoes');

    // Envia a requisição com o local e o centro de custo.
    await escolher(page.getByTestId('req-local'), '10');
    await escolher(page.getByTestId('req-cc'), '101');
    await page.getByTestId('req-enviar').click();
    await expect(page.getByTestId('req-mensagem')).toBeVisible();
    await expect(page.locator('[data-testid^="req-linha-"]')).toHaveCount(0);
    expect(externas).toEqual([]);
  });
});
