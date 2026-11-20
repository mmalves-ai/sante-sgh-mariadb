// E2E @M54.3 (ficha do M54, fatia F3: balancete, razão, diário, DRE, balanço; ECD e ECF; seções 7, 8 regra 5, 10
// "Documento: balancete, DRE (...) em PDF/A" e 11 na parte da F3): com a contabilidade ainda desligada, as
// demonstrações e o SPED mostram o motivo → o administrador liga a contabilidade → o contador publica a regra da receita,
// contabiliza os fatos de 10/2026 e grava um lançamento manual em 12/2025 → o balancete do ano (D = C, com a
// conferência impressa) → do balancete ao razão da conta, no mesmo intervalo → o diário com os totais e as parcelas,
// exportado em XLSX e PDF/A → a DRE com o resultado → o balanço com o resultado não apurado → a apuração de 2026 impedida (o
// exercício não terminou) e a de 2025 gravada com a senha (a segunda vez impedida) → a DRE de 2025 sem a apuração → o
// SPED segue desligado pela chave própria, com o motivo → ligado pelo administrador, o contador vê a prévia da ECD de
// 2025 com os impedimentos e o motivo de cada um, e as tabelas do SPED contábil. Axe sem violação séria em cada estado. Sessão, plano, fatos e
// lançamentos SINTÉTICOS em memória (nada vai à cópia; nenhuma pessoa).
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
  await editor.getByTestId('regra-nome').locator('input').fill('Receita de convênios (E2E M54.3)');
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
    .fill('Regra da receita para a contabilização (E2E M54.3).');
  await editor.getByTestId('regra-senha').fill(SENHA);
  await editor.getByTestId('regra-publicar').click();
  await expect(page.getByTestId('regras-aviso')).toContainText('publicada', { timeout: 30_000 });
}

async function data(page: Page, testid: string, valor: string): Promise<void> {
  const campo = page.getByTestId(testid).locator('input').first();
  await campo.fill(valor);
  await campo.press('Tab');
}

async function abrirDemonstracoes(page: Page): Promise<void> {
  await (await itemDoMenu(page, 'Balancete, DRE e balanço')).click();
  await expect(page).toHaveURL(/\/contabil\/demonstracoes$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

test.describe('controladoria, fatia F3: balancete, razão, diário, DRE, balanço, apuração e SPED @M54.3', () => {
  test.setTimeout(300_000);

  test('desligada → contabilizar → balancete → razão → diário (XLSX e PDF) → DRE → balanço → apurar → SPED desligado → ECD; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);

    // Desligada: as demonstrações e o SPED mostram o motivo (POL-3).
    await entrar(page, 'SINT.CONTADOR');
    await abrirDemonstracoes(page);
    await expect(page.getByTestId('contabil-desligada')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('aba-balancete')).toHaveCount(0);
    await semViolacaoAxe(page, '/contabil/demonstracoes (contabilidade desligada)');

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await ligar(page, 'contabil', 'Competência sintética conferida com o escritório (E2E M54.3)');

    // Os lançamentos: os fatos de 10/2026 pela regra e um manual em 12/2025.
    await entrar(page, 'SINT.CONTADOR');
    await publicarRegra(page);
    await (await itemDoMenu(page, 'Lançamentos automáticos dos módulos e razão')).click();
    await expect(page.getByTestId('aba-lancamentos')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('lancamentos-aba-fatos').click();
    const cont = page.getByTestId('fatos-contabilizar');
    await expect(cont).toBeVisible({ timeout: 30_000 });
    await escolher(cont.getByTestId('contabilizar-competencia'), { rotulo: '10/2026' });
    await cont.getByTestId('contabilizar-acionar').click();
    await expect(page.getByTestId('contabilizar-resultado')).toContainText('3 lançamentos', {
      timeout: 30_000,
    });
    await page.getByTestId('lancamentos-aba-lancamentos').click();
    await page.getByTestId('lancamento-novo').click();
    const f = page.getByTestId('lancamento-manual');
    await expect(f).toBeVisible();
    await data(page, 'manual-data', '15/12/2025');
    await f.getByTestId('manual-historico').locator('input').fill('Receita de dezembro de 2025 (E2E)');
    await escolher(f.getByTestId('manual-conta-0'), { rotulo: /Convênios a receber/ });
    await escolher(f.getByTestId('manual-conta-1'), { rotulo: /Receita de convênios/ });
    await f.getByTestId('manual-valor-0').locator('input').fill('100,00');
    await f.getByTestId('manual-valor-1').locator('input').fill('100,00');
    await f.getByTestId('manual-centro-1').locator('input').fill('12');
    await expect(f.getByTestId('manual-problemas')).toHaveCount(0);
    await f.getByTestId('manual-gravar').click();
    await expect(page.getByTestId('lancamento-resultado')).toContainText('gravado', { timeout: 30_000 });

    // O balancete do ano (01/2026 a 10/2026): D = C por conta e no total, com a conferência impressa (regra 5).
    await abrirDemonstracoes(page);
    await expect(page.getByTestId('aba-balancete')).toBeVisible({ timeout: 30_000 });
    await semViolacaoAxe(page, '/contabil/demonstracoes (balancete, antes da consulta)');
    await page.getByTestId('balancete-consultar').click();
    await expect(page.getByTestId('tabela-balancete')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('balancete-linha-1.1.2.01.0001')).toContainText('R$ 2.525,50');
    await expect(page.getByTestId('balancete-totais')).toContainText('R$ 2.525,50');
    await expect(page.getByTestId('balancete-conferencia')).toBeVisible();
    await expect(page.getByTestId('balancete-desequilibrado')).toHaveCount(0);
    await expect(page.getByTestId('balancete-abertas')).toBeVisible();
    await expect(page.getByTestId('exportar-balancete')).toBeVisible();
    await semViolacaoAxe(page, '/contabil/demonstracoes (balancete)');

    // Do balancete ao razão da conta, no mesmo intervalo.
    await page.getByTestId('balancete-razao-1.1.2.01.0001').click();
    await expect(page).toHaveURL(/\/contabil\/lancamentos\?.*aba=razao/);
    await expect(page.getByTestId('tabela-razao')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('razao-totais')).toContainText('R$ 2.525,50');
    await expect(page.getByTestId('razao-conferencia')).toBeVisible();
    await semViolacaoAxe(page, '/contabil/lancamentos (razão aberto do balancete)');

    // O diário de 10/2026: os lançamentos com as partidas, os totais e as parcelas; exportado em XLSX.
    await abrirDemonstracoes(page);
    await page.getByTestId('demonstracoes-aba-diario').click();
    await page.getByTestId('diario-consultar').click();
    await expect(page.getByTestId('tabela-diario')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid^="diario-lancamento-"]')).toHaveCount(3);
    await expect(page.getByTestId('diario-totais')).toContainText('R$ 2.525,50');
    await expect(page.getByTestId('diario-conferencia')).toBeVisible();
    await semViolacaoAxe(page, '/contabil/demonstracoes (diário)');
    const baixa = page.waitForEvent('download');
    await page.getByTestId('exportar-diario-xlsx').click();
    expect((await baixa).suggestedFilename()).toMatch(/\.xlsx$/);
    // O PDF/A pelo conversor do projeto (a conformidade no veraPDF está na integração da API).
    const pdf = page.waitForEvent('download');
    await page.getByTestId('exportar-diario-pdf').click();
    expect((await pdf).suggestedFilename()).toMatch(/\.pdf$/);

    // A DRE do ano: a receita e o resultado, com a conferência.
    await page.getByTestId('demonstracoes-aba-dre').click();
    await page.getByTestId('dre-consultar').click();
    await expect(page.getByTestId('tabela-dre')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('dre-resultado')).toContainText('R$ 2.525,50');
    await expect(page.getByTestId('dre-conferencia')).toBeVisible();
    await semViolacaoAxe(page, '/contabil/demonstracoes (DRE)');

    // O balanço de 10/2026: o ativo contra o PL com o resultado ainda não apurado.
    await page.getByTestId('demonstracoes-aba-balanco').click();
    await page.getByTestId('balanco-consultar').click();
    await expect(page.getByTestId('tabela-balanco')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('balanco-resultado-exercicio')).toContainText('R$ 2.525,50');
    await expect(page.getByTestId('balanco-desequilibrado')).toHaveCount(0);
    await expect(page.getByTestId('balanco-conferencia')).toBeVisible();
    await semViolacaoAxe(page, '/contabil/demonstracoes (balanço)');

    // A apuração: 2026 impedida (o exercício não terminou); 2025 apurada contra o PL com a senha.
    await page.getByTestId('demonstracoes-aba-apuracao').click();
    await escolher(page.getByTestId('apuracao-exercicio'), { rotulo: '2026' });
    await expect(page.getByTestId('apuracao-impedimento-exercicio-em-curso')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('apuracao-confirmar')).toHaveCount(0);
    await semViolacaoAxe(page, '/contabil/demonstracoes (apuração impedida)');
    await escolher(page.getByTestId('apuracao-exercicio'), { rotulo: '2025' });
    await expect(page.getByTestId('apuracao-resultado')).toContainText('R$ 100,00', { timeout: 30_000 });
    await expect(page.getByTestId('apuracao-conferencia')).toContainText('superávit');
    const apurar = page.getByTestId('apuracao-apurar');
    await expect(apurar).toBeVisible();
    await expect(apurar.getByTestId('apuracao-destino')).toContainText('Superávits acumulados');
    await apurar.getByTestId('apuracao-observacao').locator('input').fill('Encerramento de 2025 (E2E)');
    await page.getByTestId('apuracao-senha').fill(SENHA);
    await semViolacaoAxe(page, '/contabil/demonstracoes (apuração pronta)');
    await page.getByTestId('apuracao-confirmar').click();
    await expect(page.getByTestId('apuracao-mensagem')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('apuracao-ativa')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('apuracao-impedimento-ja-apurado')).toBeVisible();
    await semViolacaoAxe(page, '/contabil/demonstracoes (apuração gravada)');

    // A DRE de 2025 não conta a apuração: o resultado segue o do exercício.
    await page.getByTestId('demonstracoes-aba-dre').click();
    await escolher(page.getByTestId('dre-de'), { rotulo: '01/2025' });
    await escolher(page.getByTestId('dre-ate'), { rotulo: '12/2025' });
    await page.getByTestId('dre-consultar').click();
    await expect(page.getByTestId('dre-resultado')).toContainText('R$ 100,00', { timeout: 30_000 });

    // O SPED: a chave própria segue desligada, com o motivo.
    await (await itemDoMenu(page, 'SPED ECD/ECF')).click();
    await expect(page).toHaveURL(/\/contabil\/sped$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('sped-desligado')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('sped-gerar')).toHaveCount(0);
    await semViolacaoAxe(page, '/contabil/sped (desligado)');

    // Com a decisão da controladoria registrada, o administrador liga o SPED; o contador gera a ECD de 2025.
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await ligar(page, 'contabil.sped', 'Decisão sintética da controladoria (E2E M54.3)');
    await entrar(page, 'SINT.CONTADOR');
    await (await itemDoMenu(page, 'SPED ECD/ECF')).click();
    await expect(page.getByTestId('sped-ver-previa')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('sped-desligado')).toHaveCount(0);
    await expect(page.getByTestId('sped-sem-cifra')).toHaveCount(0);
    await page.getByTestId('sped-ver-previa').click();
    await expect(page.getByTestId('sped-previa-resumo')).toBeVisible({ timeout: 30_000 });
    // A prévia aponta o que impede gerar, com o motivo: os meses abertos e a conta sem o referencial (a geração, o
    // recibo e o cancelamento estão provados pela HTTP e na integração: aqui o exercício sintético não fecha).
    const imp = page.getByTestId('sped-impedimentos');
    await expect(imp).toBeVisible();
    await expect(imp).toContainText('Encerre todos os meses do exercício');
    await expect(imp).toContainText('3.1.1.01.0001');
    await expect(page.getByTestId('sped-gerar')).toHaveCount(0);
    await expect(page.getByTestId('sped-arquivos-vazio')).toBeVisible();
    await semViolacaoAxe(page, '/contabil/sped (prévia da ECD com impedimentos)');
    // As tabelas do SPED contábil são consulta do catálogo: o contador não a lê e não vê o atalho; o administrador lê.
    await expect(page.getByTestId('sped-tabelas')).toHaveCount(0);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/contabil/sped/tabelas');
    await expect(page).toHaveURL(/\/contabil\/sped\/tabelas$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
    await semViolacaoAxe(page, '/contabil/sped/tabelas (tabelas do SPED contábil)');

    expect(externas).toEqual([]);
  });
});
