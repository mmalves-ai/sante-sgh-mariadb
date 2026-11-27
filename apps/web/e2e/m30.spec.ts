// E2E @M30 (ficha, seção 10): conta de internação de teste com itens lançados automaticamente → explicar preço →
// conferência em bloco → pendência (impede o fechamento) → resolvida → fechamento → tentativa de reabrir a conta
// apresentada recusada → o procedimento lançado depois do fechamento aparece na fila; particular com orçamento, Pix
// simulado e recibo; axe sem violação séria em cada tela. Sessão real sobre a fonte sintética de dev e a porta da conta
// em MEMÓRIA (contas, itens e fichas SINTÉTICOS; nada vai à cópia).
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

test.describe('Conta do paciente, lançamentos e auditoria @M30', () => {
  test.setTimeout(300_000);

  test('internação: explicar preço, conferência em bloco, pendência, fechamento, reabertura recusada, fila tardia; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.CONTAS');

    await page.goto('/faturamento/contas');
    await expect(page.getByTestId('tela-faturamento-contas-conta')).toBeVisible();
    await expect(page.getByTestId('ctas-situacao-9001')).toContainText('Emitida');
    await semViolacaoAxe(page, '/faturamento/contas');

    // Lançamentos da conta de internação: explicar o preço do item de mat/med e conferir em bloco.
    await page.goto('/faturamento/contas/9001/lancamentos');
    await expect(page.getByTestId('tela-faturamento-lancamentos')).toBeVisible();
    await expect(page.getByTestId('lan-grade')).toBeVisible();
    const primeiro = page.locator('[data-testid^="lan-explicar-"]').last();
    await primeiro.click();
    await expect(page.getByTestId('lan-explicacao-conclusao')).toContainText('Confere');
    await semViolacaoAxe(page, '/faturamento/contas/9001/lancamentos');
    await page.getByTestId('lan-marcar-todos').click();
    await page.getByTestId('lan-conferir').click();
    await expect(page.getByTestId('lan-mensagem')).toContainText('5 itens conferidos');

    // A conta: pendência bloqueante impede o fechamento; resolvida, fecha.
    await page.goto('/faturamento/contas/9001');
    await expect(page.getByTestId('tela-faturamento-conta')).toBeVisible();
    await page.getByTestId('cta-aba-pendencias').click();
    await escolher(page.getByTestId('cta-tipo'), '1');
    await page.getByTestId('cta-descricao').fill('Falta a assinatura do médico');
    await page.getByTestId('cta-registrar-pendencia').click();
    await expect(page.getByTestId('cta-mensagem')).toContainText('Pendência registrada');
    await semViolacaoAxe(page, '/faturamento/contas/9001 (pendências)');
    await page.getByTestId('cta-aba-resumo').click();
    await expect(page.getByTestId('cta-prevoo')).toContainText('pendência');
    await page.getByTestId('cta-fechar').click();
    await expect(page.getByTestId('recusa-faturamento')).toContainText('pendência');
    await page.getByTestId('cta-aba-pendencias').click();
    const resolucao = page.locator('[data-testid^="cta-resolucao-"]').first();
    await resolucao.fill('Assinatura colhida');
    await page.locator('[data-testid^="cta-resolver-"]').first().click();
    await expect(page.getByTestId('cta-mensagem')).toContainText('Pendência resolvida');
    await page.getByTestId('cta-aba-resumo').click();
    await expect(page.getByTestId('cta-prevoo-ok')).toBeVisible();
    await page.getByTestId('cta-fechar').click();
    await expect(page.getByTestId('cta-mensagem')).toContainText('Conta fechada');
    await expect(page.getByTestId('cta-situacao')).toContainText('Fechada');
    await semViolacaoAxe(page, '/faturamento/contas/9001 (fechada)');

    // Reabrir a conta apresentada: recusado com o motivo.
    await page.goto('/faturamento/contas/9003');
    await page.getByTestId('cta-motivo').fill('Tentativa de reabrir a apresentada');
    await page.getByTestId('cta-reabrir').click();
    await expect(page.getByTestId('recusa-faturamento')).toContainText('apresentada');

    // O procedimento lançado depois do fechamento aparece na fila e recebe a decisão.
    await page.goto('/faturamento/lancamento-automatico');
    await expect(page.getByTestId('tela-faturamento-automatico')).toBeVisible();
    await expect(page.getByTestId('aut-tardio-7001')).toBeVisible();
    await semViolacaoAxe(page, '/faturamento/lancamento-automatico');
    await escolher(page.getByTestId('aut-d-7001'), 'complementar');
    await page.getByTestId('aut-m-7001').fill('Conta complementar a gerar');
    await page.getByTestId('aut-decidir-7001').click();
    await expect(page.getByTestId('aut-decisao-7001')).toContainText('Conta complementar');

    // Auditoria, itens SUS, simulador, regras, pacotes, tipos, nota de sala e a fila de trabalho: abrem sem violação.
    for (const [rota, tela] of [
      ['/faturamento/contas/9001/auditoria', 'tela-faturamento-auditoria'],
      ['/faturamento/contas/9001/sigtap', 'tela-faturamento-sigtap'],
      ['/faturamento/simulador', 'tela-faturamento-simulador'],
      ['/faturamento/regras-faturabilidade', 'tela-faturamento-regras'],
      ['/faturamento/pacotes', 'tela-faturamento-pacotes'],
      ['/faturamento/pendencias-tipos', 'tela-faturamento-tipos'],
      ['/cirurgia/notas-sala', 'tela-faturamento-notas'],
      ['/cirurgia/cirurgias/5001/nota-sala', 'tela-faturamento-nota'],
      ['/inicio/faturamento', 'tela-faturamento-worklist'],
    ] as const) {
      await page.goto(rota);
      await expect(page.getByTestId(tela)).toBeVisible();
      await semViolacaoAxe(page, rota);
    }
    expect(externas).toEqual([]);
  });

  test('regras e pacotes: criar, editar e desativar; filtros da lista de contas; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.CONTAS');
    await page.goto('/faturamento/regras-faturabilidade');
    await expect(page.getByTestId('tela-faturamento-regras')).toBeVisible();
    await escolher(page.getByTestId('reg-conv'), '91');
    await page.getByTestId('reg-nome').fill('Senha obrigatória E2E');
    await page.getByTestId('reg-gravar').click();
    await expect(page.getByTestId('reg-mensagem')).toBeVisible();
    const linha = page.getByTestId('reg-lista').locator('tr', { hasText: 'Senha obrigatória E2E' });
    await linha.locator('[data-testid^="reg-editar-"]').click();
    await page.getByTestId('reg-nome').fill('Senha obrigatória E2E editada');
    await page.getByTestId('reg-gravar').click();
    const editada = page.getByTestId('reg-lista').locator('tr', { hasText: 'Senha obrigatória E2E editada' });
    await expect(editada).toHaveCount(1);
    await editada.locator('[data-testid^="reg-alternar-"]').click();
    await expect(editada.locator('[data-testid^="reg-ativa-"]')).toHaveText('Não');
    await semViolacaoAxe(page, 'regras');

    await page.goto('/faturamento/pacotes');
    await escolher(page.getByTestId('pac-conv'), '91');
    await page.getByTestId('pac-cod').fill('70001');
    await page.getByTestId('pac-nome').fill('Pacote E2E');
    await page.getByTestId('pac-valor').fill('1500');
    await page.getByTestId('pac-item-0').fill('40302199');
    await page.getByTestId('pac-qtd-0').fill('2');
    await page.getByTestId('pac-gravar').click();
    const pac = page.getByTestId('pac-lista').locator('tr', { hasText: 'Pacote E2E' });
    await expect(pac).toContainText('40302199 × 2');
    await pac.locator('[data-testid^="pac-editar-"]').click();
    await page.getByTestId('pac-qtd-0').fill('3');
    await page.getByTestId('pac-gravar').click();
    await expect(pac).toContainText('40302199 × 3');
    await semViolacaoAxe(page, 'pacotes');

    await page.goto('/faturamento/contas');
    await escolher(page.getByTestId('ctas-situacao'), 'aberta');
    await escolher(page.getByTestId('ctas-convenio'), '91');
    await page.getByTestId('ctas-alta-dias').fill('0');
    await page.getByTestId('ctas-buscar').click();
    await expect(page.getByTestId('ctas-situacao-9002')).toContainText('Aberta');
    await expect(page.getByTestId('ctas-situacao-9003')).toHaveCount(0);
    await semViolacaoAxe(page, 'contas filtradas');
    expect(externas).toEqual([]);
  });

  test('particular: orçamento, caixa, Pix simulado e recibo; urgência sem caução; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.CAIXA');
    await page.goto('/faturamento/particular/orcamentos');
    await expect(page.getByTestId('tela-faturamento-orcamentos')).toBeVisible();
    await page.getByTestId('orc-nome').fill('PACIENTE SINTETICO PARTICULAR');
    await page.getByTestId('orc-desc-0').fill('Consulta sintética');
    await page.getByTestId('orc-unit-0').fill('200');
    await page.getByTestId('orc-urgencia').check();
    await page.getByTestId('orc-garantia').check();
    await page.getByTestId('orc-gravar').click();
    await expect(page.getByTestId('recusa-faturamento')).toContainText('12.653');
    await page.getByTestId('orc-garantia').uncheck();
    await page.getByTestId('orc-gravar').click();
    await expect(page.getByTestId('orc-mensagem')).toContainText('registrado');
    await semViolacaoAxe(page, '/faturamento/particular/orcamentos');

    await page.goto('/faturamento/particular/caixa');
    await expect(page.getByTestId('tela-faturamento-caixa')).toBeVisible();
    await page.getByTestId('cx-saldo').fill('50');
    await page.getByTestId('cx-abrir').click();
    await expect(page.getByTestId('cx-aberto')).toBeVisible();
    await escolher(page.getByTestId('cx-orc'), { indice: 1 });
    await escolher(page.getByTestId('cx-forma'), 'pix');
    await page.getByTestId('cx-valor').fill('200');
    await page.getByTestId('cx-receber').click();
    await expect(page.getByTestId('cx-mensagem')).toContainText('Pagamento recebido');
    await expect(page.getByTestId('cx-mensagem')).toContainText('simulado');
    await page.getByTestId('cx-pagador').fill('PAGADOR SINTETICO');
    await page.getByTestId('cx-ref').fill('Consulta sintética');
    await page.getByTestId('cx-recibo').click();
    await expect(page.getByTestId('cx-mensagem')).toContainText('Recibo nº');
    await semViolacaoAxe(page, '/faturamento/particular/caixa');
    await page.getByTestId('cx-contado').fill('50');
    await page.getByTestId('cx-fechar').click();
    await expect(page.getByTestId('cx-mensagem')).toContainText('sem diferença');

    await page.goto('/faturamento/particular/pagamentos');
    await expect(page.getByTestId('pag-lista')).toContainText('Simulado');
    await semViolacaoAxe(page, '/faturamento/particular/pagamentos');
    expect(externas).toEqual([]);
  });
});
