// E2E @M54.2 (ficha do M54, fatia F2: lançamentos automáticos, manual, estorno, conciliação de contas e encerramento com
// bloqueio; seções 7, 8 regras 3 e 5, 10 "regra → lançamento automático → estorno → encerrar" e 11 na parte da F2): o
// administrador liga a contabilidade → o contador publica a regra da receita (se outro cenário já a publicou, segue) →
// contabiliza os fatos de 10/2026 pela aba Fatos → abre um lançamento automático (partidas, débitos = créditos) e o
// estorna com justificativa → concilia a conta do a receber (o débito do original com o crédito do estorno) → consulta
// o razão da conta com a conferência → grava um lançamento manual em 09/2026 → encerra 09/2026 com a senha (sem
// impedimento) → o lançamento manual no período encerrado é recusado com o motivo → reabre o último encerrado com
// justificativa e senha. Axe sem violação séria em cada estado. Sessão, plano, fatos e regras SINTÉTICOS em memória
// (nada vai à cópia; nenhuma pessoa).
import { expect, type Page, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';
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

async function chave(page: Page, recurso: string, motivo: string): Promise<void> {
  await page.getByTestId(`abrir-${recurso}`).click();
  const form = page.getByTestId('form-liberacao');
  await form.getByTestId('opcao-ligar').check();
  await form.getByLabel('Justificativa').fill(motivo);
  await form.getByTestId('liberacao-senha').fill(SENHA);
  await form.getByTestId('liberacao-aplicar').click();
  await expect(page.getByTestId('mensagem-liberacao')).toContainText('chave(s) alterada(s)', {
    timeout: 30_000,
  });
}
/** Registra a conferência e liga o recurso (se outro cenário já o ligou, segue). */
async function ligar(page: Page, recurso: string, evidencia: string): Promise<void> {
  await expect(page.getByTestId(`recurso-${recurso}`)).toBeVisible({ timeout: 30_000 });
  const cartao = await page.getByTestId(`recurso-${recurso}`).innerText();
  if (cartao.includes('Ligada')) return;
  if (cartao.includes('Sem pré-requisito externo')) return chave(page, recurso, evidencia);
  await page.getByTestId(`abrir-${recurso}`).click();
  const pre = page.getByTestId('form-prerequisito');
  await pre.getByLabel('Evidência (protocolo ou número; nunca o certificado ou a senha)').fill(evidencia);
  await pre.locator('#prereq-senha').fill(SENHA);
  await pre.getByRole('button', { name: 'Registrar pré-requisito' }).click();
  await expect(page.getByTestId('mensagem-liberacao')).toBeVisible({ timeout: 30_000 });
  await chave(page, recurso, evidencia);
}

/** A regra da receita da conta fechada (débito no a receber, crédito na receita), publicada se ainda não houver. */
async function publicarRegra(page: Page): Promise<void> {
  await (await itemDoMenu(page, 'Plano de contas e plano referencial')).click();
  await expect(page.getByTestId('tabela-plano')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('plano-aba-regras').click();
  await escolher(page.getByTestId('regras-origem'), { rotulo: 'Convênio' });
  await escolher(page.getByTestId('regras-tipo-fato'), { rotulo: 'Receita da conta fechada' });
  await expect(page.getByTestId('regras-nenhuma').or(page.getByTestId('tabela-regras'))).toBeVisible({
    timeout: 30_000,
  });
  if (await page.getByTestId('tabela-regras').isVisible()) return;
  await page.getByTestId('regras-nova').click();
  const editor = page.getByTestId('regra-editor');
  await editor.getByTestId('regra-nome').locator('input').fill('Receita de convênios (E2E M54.2)');
  const inicio = editor.getByTestId('regra-inicio').locator('input').first();
  await inicio.fill('01/09/2026');
  await inicio.press('Tab');
  await escolher(editor.getByTestId('regra-partida-conta-0'), { rotulo: /Convênios a receber/ });
  await editor
    .getByTestId('regra-partida-0')
    .getByLabel(/Histórico/)
    .fill('Conta {documento}');
  await escolher(editor.getByTestId('regra-partida-conta-1'), { rotulo: /Receita de convênios/ });
  await editor
    .getByTestId('regra-partida-1')
    .getByLabel(/Histórico/)
    .fill('Receita {competencia}');
  await expect(editor.getByTestId('regra-problemas')).toHaveCount(0);
  await editor
    .getByTestId('regra-justificativa')
    .locator('textarea')
    .fill('Regra da receita para a contabilização (E2E M54.2).');
  await editor.getByTestId('regra-senha').fill(SENHA);
  await editor.getByTestId('regra-publicar').click();
  await expect(page.getByTestId('regras-aviso')).toContainText('publicada', { timeout: 30_000 });
}

async function data(page: Page, testid: string, valor: string): Promise<void> {
  const campo = page.getByTestId(testid).locator('input').first();
  await campo.fill(valor);
  await campo.press('Tab');
}

test.describe('controladoria, fatia F2: lançamentos, estorno, conciliação e encerramento @M54.2', () => {
  test.setTimeout(300_000);

  test('regra → contabilizar → estorno → conciliar → razão → manual → encerrar (recusa) → reabrir; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await ligar(page, 'contabil', 'Competência sintética conferida com o escritório (E2E M54.2)');

    await entrar(page, 'SINT.CONTADOR');
    await publicarRegra(page);

    // Os fatos de 10/2026 viram lançamentos automáticos pela regra publicada.
    await (await itemDoMenu(page, 'Lançamentos automáticos dos módulos e razão')).click();
    await expect(page).toHaveURL(/\/contabil\/lancamentos$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('aba-lancamentos')).toBeVisible({ timeout: 30_000 });
    await semViolacaoAxe(page, '/contabil/lancamentos (lançamentos, antes da contabilização)');
    await page.getByTestId('lancamentos-aba-fatos').click();
    const cont = page.getByTestId('fatos-contabilizar');
    await expect(cont).toBeVisible({ timeout: 30_000 });
    await escolher(cont.getByTestId('contabilizar-competencia'), { rotulo: '10/2026' });
    await cont.getByTestId('contabilizar-acionar').click();
    await expect(page.getByTestId('contabilizar-resultado')).toContainText('3 lançamentos', {
      timeout: 30_000,
    });
    await semViolacaoAxe(page, '/contabil/lancamentos (fatos contabilizados)');

    // O lançamento automático: partidas, débitos = créditos, o fato e a regra; o estorno com a justificativa.
    await page.getByTestId('lancamentos-aba-lancamentos').click();
    await expect(page.getByTestId('tabela-lancamentos')).toBeVisible({ timeout: 30_000 });
    const linha = page.locator('[data-testid^="lancamento-"]').filter({ hasText: 'R$ 1.250,00' }).first();
    await expect(linha).toBeVisible();
    await linha.locator('[data-testid^="lancamento-detalhe-"]').click();
    const detalhe = page.getByTestId('lancamento-detalhe');
    await expect(detalhe).toBeVisible({ timeout: 30_000 });
    await expect(detalhe.getByTestId('tabela-partidas')).toBeVisible();
    await expect(detalhe.getByTestId('lancamento-totais')).toContainText('= créditos');
    await expect(detalhe.getByTestId('lancamento-fato')).toBeVisible();
    await semViolacaoAxe(page, '/contabil/lancamentos (detalhe do automático)');
    await detalhe.getByTestId('lancamento-estornar').click();
    const estorno = page.getByTestId('lancamento-estorno');
    await expect(estorno.getByTestId('estorno-gravar')).toBeVisible();
    await estorno
      .getByTestId('estorno-justificativa')
      .locator('textarea')
      .fill('Conta reaberta para correção do convênio (E2E).');
    await semViolacaoAxe(page, '/contabil/lancamentos (estorno com justificativa)');
    await estorno.getByTestId('estorno-gravar').click();
    await expect(page.getByTestId('lancamento-resultado')).toContainText('estornado', { timeout: 30_000 });
    await expect(page.locator('[data-testid^="lancamento-estornado-"]')).toHaveCount(1);

    // A conciliação do a receber: o débito do original com o crédito do estorno (D = C).
    await page.getByTestId('lancamentos-aba-conciliacao').click();
    await escolher(page.getByTestId('conciliacao-conta'), { rotulo: /Convênios a receber/ });
    await data(page, 'conciliacao-ate', '31/10/2026');
    await expect(page.getByTestId('tabela-pendentes')).toBeVisible({ timeout: 30_000 });
    const pares = page.locator('[data-testid^="pendente-"]').filter({ hasText: 'R$ 1.250,00' });
    await expect(pares).toHaveCount(2);
    for (const i of [0, 1]) await pares.nth(i).locator('[data-testid^="marcar-"]').check();
    await expect(page.getByTestId('conciliacao-soma')).toContainText('pode conciliar');
    await semViolacaoAxe(page, '/contabil/lancamentos (conciliação marcada)');
    await page.getByTestId('conciliacao-conciliar').click();
    await expect(page.getByTestId('conciliacao-mensagem')).toContainText('2 partidas conciliadas', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('tabela-conciliacoes')).toBeVisible();

    // O razão da conta: saldo anterior, movimentos e a conferência impressa.
    await page.getByTestId('lancamentos-aba-razao').click();
    await escolher(page.getByTestId('razao-conta'), { rotulo: /Convênios a receber/ });
    await data(page, 'razao-de', '01/10/2026');
    await data(page, 'razao-ate', '31/10/2026');
    await page.getByTestId('razao-consultar').click();
    await expect(page.getByTestId('tabela-razao')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('razao-totais')).toBeVisible();
    await expect(page.getByTestId('razao-conferencia')).toBeVisible();
    await semViolacaoAxe(page, '/contabil/lancamentos (razão)');

    // O lançamento manual em 09/2026 (o período nasce com ele).
    const manual = async (historico: string) => {
      await page.getByTestId('lancamentos-aba-lancamentos').click();
      await page.getByTestId('lancamento-novo').click();
      const f = page.getByTestId('lancamento-manual');
      await expect(f).toBeVisible();
      await data(page, 'manual-data', '15/09/2026');
      await f.getByTestId('manual-historico').locator('input').fill(historico);
      await escolher(f.getByTestId('manual-conta-0'), { rotulo: /Convênios a receber/ });
      await escolher(f.getByTestId('manual-conta-1'), { rotulo: /Receita de convênios/ });
      await f.getByTestId('manual-valor-0').locator('input').fill('100,00');
      await f.getByTestId('manual-valor-1').locator('input').fill('100,00');
      await f.getByTestId('manual-centro-1').locator('input').fill('12');
      await expect(f.getByTestId('manual-problemas')).toHaveCount(0);
      return f;
    };
    const f1 = await manual('Ajuste de receita de setembro (E2E)');
    await expect(f1.getByTestId('manual-totais')).toContainText('R$ 100,00');
    await semViolacaoAxe(page, '/contabil/lancamentos (lançamento manual)');
    await f1.getByTestId('manual-gravar').click();
    await expect(page.getByTestId('lancamento-resultado')).toContainText('gravado', { timeout: 30_000 });

    // O encerramento de 09/2026: sem impedimento, com a senha.
    await page.getByTestId('lancamentos-aba-periodos').click();
    await expect(page.getByTestId('tabela-periodos')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('periodo-abrir-2026-09').click();
    await expect(page.getByTestId('tabela-parcelas')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('periodo-sem-impedimento')).toBeVisible();
    await semViolacaoAxe(page, '/contabil/lancamentos (período sem impedimento)');
    await page.getByTestId('encerrar-senha').fill(SENHA);
    await page.getByTestId('encerrar-confirmar').click();
    await expect(page.getByTestId('periodo-mensagem')).toContainText(/encerrad/i, { timeout: 30_000 });
    await expect(page.getByTestId('periodo-reabrir')).toBeVisible();
    await semViolacaoAxe(page, '/contabil/lancamentos (período encerrado)');

    // O lançamento no período encerrado é recusado com o motivo (regra 3).
    const f2 = await manual('Ajuste esquecido de setembro (E2E)');
    await f2.getByTestId('manual-gravar').click();
    await expect(page.getByTestId('recusa-contabil')).toContainText('está encerrado', { timeout: 30_000 });
    await semViolacaoAxe(page, '/contabil/lancamentos (lançamento recusado no período encerrado)');
    await f2.getByTestId('manual-cancelar').click();

    // A reabertura do último encerrado, com justificativa e senha.
    await page.getByTestId('lancamentos-aba-periodos').click();
    await page.getByTestId('periodo-abrir-2026-09').click();
    const reabrir = page.getByTestId('periodo-reabrir');
    await expect(reabrir).toBeVisible({ timeout: 30_000 });
    await reabrir
      .getByTestId('reabrir-justificativa')
      .locator('textarea')
      .fill('Ajuste esquecido de setembro (E2E).');
    await page.getByTestId('reabrir-senha').fill(SENHA);
    await page.getByTestId('reabrir-confirmar').click();
    await expect(page.getByTestId('periodo-mensagem')).toContainText(/reabert/i, { timeout: 30_000 });
    await expect(page.getByTestId('periodo-encerrar')).toBeVisible();
    await semViolacaoAxe(page, '/contabil/lancamentos (período reaberto)');

    expect(externas).toEqual([]);
  });
});
