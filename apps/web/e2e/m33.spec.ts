// E2E @M33 (ficha, seção 10): regra nova → simular → aprovar (outro usuário) → apurar → conferir → aprovar (outro
// usuário) → a apuração em simulação NÃO lança (D-DOURADO-33; o motivo visível) → ajuste avulso e estorno por glosa pela
// tela (o médico pela busca; o estorno herda o médico do original) → emitir RPA com a senha → o PDF do RPA emitido →
// título visível no contas a pagar; o extrato visto só pelo próprio médico, com a competência e a conta de cada valor
// (quem não tem vínculo vê o aviso; o médico não abre as telas do setor); axe sem violação séria em cada tela.
// Sessão real sobre a fonte sintética de dev e as portas do repasse e do financeiro em MEMÓRIA (regras, produção,
// lançamentos e títulos SINTÉTICOS; nada vai à cópia nem ao banco).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

/** Busca o médico pelo nome ou código e confere que a primeira opção (nome · conselho) ficou escolhida. */
async function medico(page: Page, testid: string, termo: string, codigo: string): Promise<void> {
  await page.getByTestId(`${testid}-busca`).fill(termo);
  await page.getByTestId(`${testid}-buscar`).click();
  await expect(page.getByTestId(testid)).toContainText('MEDICO SINTETICO');
  await expect(page.getByTestId(testid)).toHaveAttribute('data-valor', REGISTRO[codigo]!);
}
const REGISTRO: Record<string, string> = { '7001': '17001', '7002': '17002' };

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('repasse médico @M33 @C1-138', () => {
  test.setTimeout(300_000);

  test('regra → simular → aprovar → apurar → conferir → aprovar → ajuste e estorno → RPA → título; axe @M42', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    // O analista propõe a regra do médico 7002 e simula contra a proposta.
    await entrar(page, 'SINT.REP.ANALISTA');
    await page.goto('/repasse/regras');
    await expect(page.getByTestId('tela-rep-regras')).toBeVisible();
    await escolher(page.getByTestId('rg-convenio'), '301');
    await page.getByTestId('rg-consultar').click();
    await expect(page.getByTestId('rg-lista')).toBeVisible();
    await semViolacaoAxe(page, '/repasse/regras');
    await page.getByTestId('rg-nova').click();
    await medico(page, 'rg-profissional', '7002', '7002');
    await escolher(page.getByTestId('rg-f-convenio'), '301');
    await page.getByTestId('rg-procedimento').fill('10101012');
    await page.getByTestId('rg-percentual').fill('22');
    await page.getByTestId('rg-justificativa').fill('Regra sintética do médico 7002 no convênio A');
    await semViolacaoAxe(page, '/repasse/regras (proposta)');
    await page.getByTestId('rg-propor').click();
    await expect(page.getByTestId('rg-mensagem')).toContainText('Regra proposta');
    await escolher(page.getByTestId('sim-versao'), { rotulo: /Rascunho/ });
    await escolher(page.getByTestId('sim-convenio'), '301');
    await page.getByTestId('sim-procedimento').fill('10101012');
    await medico(page, 'sim-profissional', 'sintetico b', '7002');
    await page.getByTestId('sim-cobrado').fill('1000');
    await page.getByTestId('sim-rodar').click();
    await expect(page.getByTestId('sim-resultado')).toContainText('220,00');
    await semViolacaoAxe(page, '/repasse/regras (simulador)');

    // O supervisor aprova (quem propôs não aprova).
    await entrar(page, 'SINT.REP.SUPERVISOR');
    await page.goto('/repasse/regras');
    const linha = page.getByTestId('rg-versoes').locator('tbody tr', { hasText: 'Simulada' }).first();
    await linha.locator('input').fill('Conferida com o setor de repasse');
    await linha.getByRole('button', { name: 'Aprovar' }).click();
    await expect(page.getByTestId('rg-dec-mensagem')).toContainText('aprovada');

    // O analista apura e confere; o supervisor aprova; o analista lança pela apuração.
    await entrar(page, 'SINT.REP.ANALISTA');
    await page.goto('/repasse/apuracao');
    await expect(page.getByTestId('tela-rep-apuracao')).toBeVisible();
    await expect(page.getByTestId('ap-competencia')).not.toHaveValue('');
    await page.getByTestId('ap-consultar').click();
    await page.getByTestId('ap-apurar').click();
    await expect(page.getByTestId('ap-mensagem')).toContainText('Período apurado');
    await expect(page.getByTestId('ap-totais')).toBeVisible();
    await expect(page.getByTestId('ap-pendencias')).toContainText('Item sem executante');
    // @C1-138: a memória do item pendente (sem profissional, o motivo e a conta) e quem apurou, ainda sem conferência.
    await expect(page.getByTestId('ap-itens-pendentes')).toContainText('Item sem executante');
    await expect(page.getByTestId('ap-itens-pendentes')).toContainText('Sem profissional');
    await expect(page.getByTestId('ap-itens-pendentes')).toContainText('sem repasse');
    // @C1-138 (revisão): a referência de negócio do item para agir nele (conta, procedimento) e o filtro pelo motivo,
    // pela rota paginada, com a contagem da página.
    await expect(page.getByTestId('ap-itens-pendentes')).toContainText(/C\d+/);
    await expect(page.getByTestId('ap-itens-pendentes')).toContainText('10101012');
    await expect(page.getByTestId('ap-pend-paginas')).toContainText('1 a 1 de 1');
    await escolher(page.getByTestId('ap-pend-motivo'), { rotulo: /Item sem executante/ });
    await expect(page.getByTestId('ap-itens-pendentes')).toContainText('Sem profissional');
    await expect(page.getByTestId('ap-pend-paginas')).toContainText('1 a 1 de 1');
    await expect(page.getByTestId('ap-pend-proxima')).toBeDisabled();
    await expect(page.getByTestId('ap-apurado-por')).toContainText('SINT.REP.ANALISTA');
    await expect(page.getByTestId('ap-conferido-por')).toContainText('Ainda não');
    await semViolacaoAxe(page, '/repasse/apuracao');
    await page.getByTestId('ap-conferir').click();
    await expect(page.getByTestId('ap-mensagem')).toContainText('conferida');
    await expect(page.getByTestId('ap-conferido-por')).toContainText('SINT.REP.ANALISTA');
    await entrar(page, 'SINT.REP.SUPERVISOR');
    await page.goto('/repasse/apuracao');
    await expect(page.getByTestId('ap-competencia')).not.toHaveValue('');
    await page.getByTestId('ap-consultar').click();
    await page.getByTestId('ap-aprovar').click();
    await expect(page.getByTestId('ap-mensagem')).toContainText('aprovada');
    await entrar(page, 'SINT.REP.ANALISTA');
    await page.goto('/repasse/apuracao');
    await expect(page.getByTestId('ap-competencia')).not.toHaveValue('');
    await page.getByTestId('ap-consultar').click();
    // Banco próprio: a apuração gravada é a que vale (o sistema é o de registro do repasse), nunca simulação; o
    // lançamento pela apuração fica liberado e sem o aviso de simulação (a regra da coexistência não vale aqui).
    await expect(page.getByTestId('ap-lancar')).toBeEnabled();
    await expect(page.getByTestId('ap-lancar-motivo')).toHaveCount(0);
    await page.getByTestId('ap-demo-7001').click();
    await expect(page.getByTestId('dm-total')).toContainText('333,00');
    await semViolacaoAxe(page, '/repasse/apuracao/:apuracao/:beneficiario');

    // O ajuste avulso pela tela (o médico pela busca, sem digitar código interno).
    await page.goto('/repasse/lancamentos');
    await expect(page.getByTestId('lc-competencia')).not.toHaveValue('');
    await page.getByTestId('lc-novo').click();
    await medico(page, 'lc-prestador', 'sintetico a', '7001');
    await page.getByTestId('lc-valor').fill('333');
    await page.getByTestId('lc-justificativa').fill('Ajuste sintético do repasse do médico A');
    await semViolacaoAxe(page, '/repasse/lancamentos (ajuste)');
    await page.getByTestId('lc-gravar').click();
    await expect(page.getByTestId('lc-mensagem')).toContainText('Lançamento incluído');
    await expect(page.getByTestId('lc-lista')).toContainText('333,00');
    // O estorno por glosa do lançamento pago de maio: herda o médico e o registro; entra na competência atual.
    await page.getByTestId('lc-competencia').fill('2026-05');
    await page.getByTestId('lc-consultar').click();
    await page.getByTestId('lc-estornar-51').click();
    await expect(page.getByTestId('lc-prestador')).toHaveAttribute('data-valor', '7001');
    await page.getByTestId('lc-valor').fill('100');
    await page.getByTestId('lc-justificativa').fill('Glosa mantida do convênio sintético');
    await page.getByTestId('lc-gravar').click();
    await expect(page.getByTestId('lc-mensagem')).toContainText('Estorno lançado');
    await expect(page.getByTestId('lc-lista')).toContainText('Estorno do lançamento 51');
    await semViolacaoAxe(page, '/repasse/lancamentos');

    // O RPA do médico 7001 com as retenções escritas, a senha de novo e o título no contas a pagar.
    await page.goto('/repasse/rpa');
    await medico(page, 'rp-prestador', '7001', '7001');
    await page.getByTestId('rp-consultar').click();
    await page.getByTestId('rp-livres').locator('input[type="checkbox"]').first().check();
    await page.getByTestId('rp-calcular').click();
    await expect(page.getByTestId('rp-conta')).toContainText('279,72');
    await semViolacaoAxe(page, '/repasse/rpa');
    await expect(page.getByTestId('rp-emitir')).toBeDisabled();
    await page.getByTestId('rp-senha').fill(SENHA);
    await page.getByTestId('rp-emitir').click();
    await expect(page.getByTestId('rp-mensagem')).toContainText('RPA emitido');
    // O PDF do RPA emitido (relido do banco), na linha da lista.
    const pdf = page.getByTestId('rp-lista').locator('a[data-testid^="rp-pdf-"]').first();
    await expect(pdf).toBeVisible();
    const href = await pdf.getAttribute('href');
    expect(href).toMatch(/^\/api\/repasse\/rpas\/\d+\/pdf$/);
    const doc = await page.request.get(href!);
    expect(doc.status()).toBe(200);
    expect(doc.headers()['content-type']).toMatch(/application\/pdf|text\/html/);
    await page.goto('/financeiro/pagar/titulos');
    await expect(page.getByTestId('tela-fin-titulos-pagar')).toBeVisible();
    await expect(page.getByTestId('tp-lista')).toContainText('279,72');

    // Os cadastros do repasse (CRUD genérico dos subitens).
    for (const rota of ['/repasse/cooperativas', '/repasse/configuracoes', '/repasse/integracao-contabil']) {
      await page.goto(rota);
      await expect(page).toHaveURL(/\/cadastros\/dominios\/grupo\/repasse/);
      await semViolacaoAxe(page, rota);
    }
    expect(externas).toEqual([]);
  });

  test('o extrato é só do próprio médico; quem não tem vínculo vê o aviso; o médico não abre o setor; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.REP.MEDICO');
    await page.goto('/repasse/meu-extrato');
    await expect(page.getByTestId('ex-lancamentos')).toBeVisible();
    await expect(page.getByTestId('ex-lancamentos')).toContainText('925,50');
    // A conta de cada valor da competência (só os itens do próprio médico; sem apuração, o aviso).
    await expect(page.getByTestId('ex-conta').or(page.getByTestId('ex-conta-vazia')).first()).toBeVisible();
    await semViolacaoAxe(page, '/repasse/meu-extrato');
    await page.getByTestId('ex-competencia').fill('2026-05');
    await page.getByTestId('ex-consultar').click();
    await expect(page.getByTestId('ex-lancamentos')).toContainText('925,50');
    await expect(page.getByTestId('ex-conta-vazia')).toBeVisible();
    await page.goto('/repasse/apuracao');
    await expect(page.getByTestId('tela-rep-apuracao')).toHaveCount(0);
    await entrar(page, 'SINT.REP.SUPERVISOR');
    await page.goto('/repasse/meu-extrato');
    await expect(page.getByTestId('ex-sem-vinculo')).toBeVisible();
    expect(externas).toEqual([]);
  });
});
