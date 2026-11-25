// E2E @F3.6-02 (F3.6, 05-SUP linha 3): o cadastro do local de estoque e o escopo do usuário, pela tela. No local, a
// pessoa abre o almoxarifado, marca o que ele atende (pedido do setor, só urgente), limita o que ele guarda a um grupo
// e grava de uma vez; ao reabrir, o que foi gravado está lá; a inativação do local com saldo é recusada com o motivo
// na tela. No escopo, a pessoa acha o usuário pelo nome, marca mais uma ação no local que ele já tem, concede outro
// local e grava; ao reabrir o usuário, as duas concessões aparecem. Sessão real sobre a fonte sintética de dev e a
// porta do cadastro do estoque EM MEMÓRIA (locais e usuários SINTÉTICOS; nada vai ao banco). O que fica no banco e a
// aplicação do cadastro nas gravações (requisição, saída, transferência, nota, pedido) estão nos contratos de efeito
// apps/api/src/modulos/suprimentos/cadastro-estoque-porta-propria.int.spec.ts e politica-local-propria.int.spec.ts.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const ALMOXARIFADO = 'ALMOXARIFADO CENTRAL SINTETICO';
const POSTO = 'POSTO SINTETICO DA CLINICA MEDICA';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Local de estoque e escopo do usuário @F3.6-02', () => {
  test.describe.configure({ mode: 'serial' });

  test('local: marca o que atende e o que guarda, grava, reabre e a inativação com saldo é recusada; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/suprimentos/locais/cadastro');
    await expect(page.getByTestId('tela-suprimentos-locais-cadastro')).toBeVisible();
    await page.getByTestId('local-abrir-ALM').click();
    const form = page.getByTestId('local-form');
    await expect(page.getByTestId('local-nome')).toHaveValue(ALMOXARIFADO);
    await form.getByLabel('Atende pedido do setor').check();
    await form.getByLabel('Só urgente').check();
    await escolher(page.getByTestId('local-grupo'), { rotulo: 'MEDICAMENTOS SINTETICOS' });
    await expect(form).toContainText('MEDICAMENTOS SINTETICOS');
    await semViolacaoAxe(page, '/suprimentos/locais/cadastro');
    await page.getByTestId('local-salvar').click();
    await expect(page.getByTestId('local-ok')).toBeVisible();

    // Reabrir: o que foi gravado volta do servidor.
    await page.goto('/suprimentos/locais/cadastro');
    await page.getByTestId('local-abrir-ALM').click();
    await expect(page.getByTestId('local-nome')).toHaveValue(ALMOXARIFADO);
    await expect(form.getByLabel('Atende pedido do setor')).toBeChecked();
    await expect(form.getByLabel('Só urgente')).toBeChecked();
    await expect(form.getByLabel('Atende pedido do paciente')).not.toBeChecked();
    await expect(form).toContainText('MEDICAMENTOS SINTETICOS');

    // O local tem saldo: a inativação é recusada e o local continua ativo.
    await page.getByTestId('local-motivo').fill('Encerramento sintético do local');
    await page.getByTestId('local-situacao').click();
    await expect(page.getByTestId('recusa-suprimentos')).toBeVisible();
    await expect(page.getByTestId('local-situacao')).toContainText('Inativar');
    expect(externas).toEqual([]);
  });

  test('escopo: acha o usuário, marca mais uma ação, concede outro local e as concessões ficam; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ADMIN');
    const abrirUsuario = async () => {
      await page.goto('/suprimentos/usuarios-estoque/escopo');
      await expect(page.getByTestId('tela-suprimentos-escopo-cadastro')).toBeVisible();
      await page.getByTestId('escopo-termo').fill('ALMOX');
      await page.getByTestId('escopo-termo').press('Enter');
      await page.getByTestId('escopo-usuario-SINT.ALMOXARIFE').click();
      await expect(page.getByTestId('escopo-grade')).toBeVisible();
    };
    await abrirUsuario();
    const inventariar = page.getByRole('checkbox', { name: `${ALMOXARIFADO} Inventariar` });
    await expect(page.getByRole('checkbox', { name: `${ALMOXARIFADO} Requisitar` })).toBeChecked();
    await inventariar.check();
    await page.getByTestId('escopo-gravar-10').click();
    await expect(page.getByTestId('recusa-suprimentos')).toHaveCount(0);

    // Outro local: nasce com a ação de requisitar marcada e é gravado com um clique.
    await escolher(page.getByTestId('escopo-novo-local'), { rotulo: POSTO });
    await expect(page.getByTestId('escopo-local-20')).toBeVisible();
    await page.getByTestId('escopo-gravar-20').click();
    await expect(page.getByTestId('recusa-suprimentos')).toHaveCount(0);
    await semViolacaoAxe(page, '/suprimentos/usuarios-estoque/escopo');

    await abrirUsuario();
    await expect(page.getByRole('checkbox', { name: `${ALMOXARIFADO} Inventariar` })).toBeChecked();
    await expect(page.getByTestId('escopo-local-20')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: `${POSTO} Requisitar` })).toBeChecked();
    expect(externas).toEqual([]);
  });
});
