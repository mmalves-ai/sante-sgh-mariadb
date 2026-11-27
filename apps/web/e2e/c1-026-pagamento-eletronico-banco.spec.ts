// C1-026 (07-FIN linha 66): o ciclo completo do pagamento eletrônico sobre o banco do cliente, sem simular rota
// nenhuma. Roda com tools/obra/e2e-vm.sh --banco (cliente descartável, núcleo real); na fonte sintética (CI, sem banco)
// as rotas de /api/financeiro/pagamento-eletronico respondem 503 e o teste é pulado (a tela com rotas simuladas é o
// c1-026-conta-credor-profissional.spec.ts). O que o produto não cadastra por tela (banco do catálogo oficial, conta do
// estabelecimento, profissional credor, classificação) vem da massa sintética apps/web/e2e/massa-banco/
// c1-026-pagamento-eletronico.sql. Passos, cada um com o perfil certo (segregação de funções):
//   1. SINT.FIN.CREDOR (cadastro de credores), pelo menu: grava a conta e a chave Pix do profissional;
//   2. SINT.ADMIN liga o contas a pagar do estabelecimento (o cliente nasce em consulta); SINT.FIN.LANCA lança o título a pagar do profissional (API, com CSRF e Idempotency-Key, como a tela);
//   3. SINT.FIN.PAGA: o título aparece no Pix com a chave, a remessa é gerada; o retorno do banco vem do simulador do
//      banco (fora de produção) e é processado: o título sai da fila e a remessa fica sem pendência.
// Massa SINTÉTICA. Axe nos passos.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PE = '/api/financeiro/pagamento-eletronico';
const NOME = 'Profissional Sintético Pix';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** O administrador liga o contas a pagar do estabelecimento (Funcionalidades por estabelecimento, senha de novo e
 * justificativa); o cliente descartável nasce com ele em consulta. Se outro cenário já o ligou, segue. */
async function ligarContasPagar(page: Page): Promise<void> {
  await entrar(page, 'SINT.ADMIN');
  await page.goto('/administracao/liberacao');
  const recurso = 'financeiro.contasPagar';
  await expect(page.getByTestId(`recurso-${recurso}`)).toBeVisible({ timeout: 30_000 });
  if ((await page.getByTestId(`recurso-${recurso}`).innerText()).includes('Ligada')) return;
  const cartao = await page.getByTestId(`recurso-${recurso}`).innerText();
  await page.getByTestId(`abrir-${recurso}`).click();
  if (!cartao.includes('Sem pré-requisito externo')) {
    // A conferência pelos chave-usuários do setor, registrada com a evidência (sintética) antes de ligar.
    const pre = page.getByTestId('form-prerequisito');
    await pre
      .getByLabel('Evidência (protocolo ou número; nunca o certificado ou a senha)')
      .fill('Conferência sintética dos chave-usuários (E2E C1-026)');
    await pre.locator('#prereq-senha').fill(SENHA);
    await pre.getByRole('button', { name: 'Registrar pré-requisito' }).click();
    await expect(page.getByTestId('mensagem-liberacao')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId(`abrir-${recurso}`).click();
  }
  const form = page.getByTestId('form-liberacao');
  await form.getByTestId('opcao-ligar').check();
  await form.getByLabel('Justificativa').fill('Ciclo sintético do pagamento eletrônico (E2E C1-026)');
  await form.getByTestId('liberacao-senha').fill(SENHA);
  await form.getByTestId('liberacao-aplicar').click();
  // O fim do pedido: a mensagem do lote ou a recusa do servidor (com o texto, para o diagnóstico).
  const fim = page
    .getByTestId('mensagem-liberacao')
    .or(page.getByTestId('recusa-liberacao'))
    .or(form.getByRole('alert'));
  await expect(fim.first()).toBeVisible({ timeout: 30_000 });
  expect(await fim.first().innerText()).toContain('chave(s) alterada(s)');
}

const dia = (mais: number) => new Date(Date.now() + mais * 86_400_000).toISOString().slice(0, 10);

test.describe('financeiro: pagamento eletrônico no banco do cliente, ciclo completo @C1-026', () => {
  test.setTimeout(240_000);

  test('conta e chave do profissional; título; remessa Pix; retorno do banco baixa o título; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);

    // 0. O administrador liga o contas a pagar (o cliente descartável nasce com ele em consulta).
    await ligarContasPagar(page);

    // 1. Cadastro de credores: conta e chave Pix do profissional, pela tela.
    await entrar(page, 'SINT.FIN.CREDOR');
    const sonda = await page.request.get(`${PE}/bancos`);
    test.skip(
      sonda.status() === 503,
      'sem banco do cliente (fonte sintética): rode com tools/obra/e2e-vm.sh --banco',
    );
    expect(sonda.status(), await sonda.text()).toBe(200);
    const menu = page.getByRole('navigation', { name: 'Menu principal' });
    await menu.locator('#menu-buscar').fill('Dados bancários e chave Pix');
    await menu.getByRole('link', { name: 'Dados bancários e chave Pix do credor' }).click();
    await expect(page).toHaveURL(/\/financeiro\/pagar\/pagamento-eletronico\?aba=credor$/);
    await expect(page.getByTestId('pe-aba-pix')).toHaveCount(0);
    await escolher(page.getByTestId('pe-credor-tipo'), 'profissional');
    await page.getByTestId('pe-credor-busca').fill('Sintético Pix');
    const opcao = page.locator('[data-testid^="pe-credor-opcao-"]').filter({ hasText: NOME }).first();
    const testid = (await opcao.getAttribute('data-testid')) ?? '';
    const profissional = Number(testid.replace('pe-credor-opcao-', ''));
    expect(profissional, testid).toBeGreaterThan(0);
    await opcao.click();
    await expect(page.getByTestId('pe-credor-escolhido')).toBeVisible();
    await page.getByTestId('pe-titular').fill(NOME);
    await page.getByTestId('pe-documento').fill('529.982.247-25');
    await page.getByTestId('pe-chave').fill('529.982.247-25');
    await expect(page.getByTestId('pe-recusa-conta')).toHaveCount(0);
    await semViolacaoAxe(page, '/financeiro/pagar/pagamento-eletronico (conta do profissional, banco)');
    await page.getByTestId('pe-gravar-conta').click();
    await expect(page.getByTestId('pe-mensagem')).toContainText('Dados bancários do credor gravados');
    await expect(page.getByTestId('pe-contas')).toContainText(NOME);
    // A chave volta mascarada (nunca o valor inteiro na lista).
    await expect(page.getByTestId('pe-contas')).not.toContainText('529.982.247-25');

    // 2. O título a pagar do profissional, lançado por quem lança (não por quem paga).
    await entrar(page, 'SINT.FIN.LANCA');
    const csrf = (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '';
    const documento = 260_000 + Math.floor(Math.random() * 90_000);
    const titulo = await page.request.post('/api/financeiro/pagar/titulos', {
      headers: { 'x-csrf': csrf, 'idempotency-key': `e2e-c1-026-${documento}` },
      data: {
        tipo: 'M',
        credor: profissional,
        profissional,
        documento,
        emissao: dia(0),
        valorDocumento: 100,
        referente: 'HONORARIO SINTETICO E2E',
        parcelas: [{ parcela: 1, vencimento: dia(10), valor: 100 }],
        classificacao: { grupo: 9926, subgrupo: 1, item: 1 },
      },
    });
    expect(titulo.status(), await titulo.text()).toBe(200);

    // 3. Quem paga: o título do profissional já tem a chave e entra no Pix.
    await entrar(page, 'SINT.FIN.PAGA');
    await page.goto('/financeiro/pagar/pagamento-eletronico?aba=pix');
    await expect(page.getByTestId(`pe-pix-tipo-${documento}`)).toContainText('Profissional');
    await page.getByTestId(`pe-pix-marcar-${documento}`).check();
    await escolher(page.getByTestId('pe-pix-conta'), { rotulo: /Conta sintética de pagamentos/ });
    await page.getByTestId('pe-pix-data').fill(dia(10));
    await expect(page.getByTestId('pe-pix-total')).toContainText('1 título(s)');
    await semViolacaoAxe(page, '/financeiro/pagar/pagamento-eletronico (Pix do profissional, banco)');
    await page.getByTestId('pe-pix-gerar').click();
    await expect(page.getByTestId('pe-mensagem')).toContainText('Remessa por Pix gerada');
    // O título está na remessa: sai da lista do Pix.
    await expect(page.getByTestId(`pe-pix-tipo-${documento}`)).toHaveCount(0);

    // 4. O retorno do banco: o simulador (fora de produção) devolve o arquivo da remessa; processado, baixa o título.
    await page.getByTestId('pe-aba-retorno').click();
    await escolher(page.getByTestId('pe-remessa'), { indice: 0 });
    await page.getByTestId('pe-usar-simulador').click();
    await expect(page.getByTestId('pe-arquivo-ok')).toContainText('1 título(s)');
    await page.getByTestId('pe-processar').click();
    await expect(page.getByTestId('pe-mensagem')).toContainText('1 título(s) baixado(s)');
    await expect(page.getByTestId('pe-mensagem')).toContainText('0 parcela(s) ainda aguardam');
    const parcelas = (await (await page.request.get(`${PE}/pix/parcelas`)).json()) as { documento: string }[];
    expect(parcelas.map((p) => p.documento)).not.toContain(String(documento));
    expect(externas).toEqual([]);
  });
});
