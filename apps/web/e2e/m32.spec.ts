// E2E @M32 (ficha, seção 10): lançar → aprovar (outro usuário) → borderô → pagar, com a tentativa de aprovar o próprio
// título recusada; títulos da competência do convênio → glosa no título pelo demonstrativo → baixa manual; conciliação
// de um extrato sintético (sugestão confirmada e o crédito não identificado atribuído); quem é só da tesouraria e do
// fiscal (sem contas a pagar) abre a fila, lança o movimento e gera a DMED; as demais telas abertas; axe sem
// violação séria em cada tela. Sessão real sobre a fonte sintética de dev e a porta do financeiro em MEMÓRIA (credores,
// títulos, contas e extrato SINTÉTICOS; nada vai à cópia, ao banco, à prefeitura nem à Receita).
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

const linhaCom = (page: Page, tabela: string, texto: string) =>
  page.getByTestId(tabela).locator('tbody tr', { hasText: texto });

test.describe('financeiro: contas a pagar, a receber e tesouraria @M32', () => {
  test.setTimeout(300_000);

  test('lançar → aprovar (outro usuário) → borderô → pagar; aprovar o próprio título é recusado; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const documento = String(800_000 + (Date.now() % 100_000));
    await entrar(page, 'SINT.FIN.LANCA');
    await page.goto('/financeiro/pagar/titulos');
    await expect(page.getByTestId('tela-fin-titulos-pagar')).toBeVisible();
    await semViolacaoAxe(page, '/financeiro/pagar/titulos');
    await page.getByTestId('tp-novo').click();
    await page.getByTestId('tp-novo-credor').fill('5001');
    await page.getByTestId('tp-novo-documento').fill(documento);
    await page.getByTestId('tp-novo-valor').fill('1500');
    await page.getByTestId('tp-novo-quantas').fill('1');
    await escolher(page.getByTestId('tp-novo-classificacao'), '216.2.1');
    await expect(page.getByTestId('tp-previa')).toContainText('1.500,00');
    await semViolacaoAxe(page, '/financeiro/pagar/titulos (lançamento)');
    await page.getByTestId('tp-lancar').click();
    await expect(page.getByTestId('tp-mensagem')).toContainText('lançado');

    // Quem lançou não aprova (a segregação no servidor).
    await page.goto('/financeiro/pagar/aprovacao');
    await expect(page.getByTestId('ap-lista')).toBeVisible();
    await linhaCom(page, 'ap-lista', `${documento}/1`).getByRole('button').click();
    await expect(page.getByTestId('recusa-faturamento')).toContainText('Quem lançou');
    await semViolacaoAxe(page, '/financeiro/pagar/aprovacao (recusa)');

    // Outro usuário aprova na alçada.
    await entrar(page, 'SINT.FIN.APROVA');
    await page.goto('/financeiro/pagar/aprovacao');
    await linhaCom(page, 'ap-lista', `${documento}/1`).getByRole('button').click();
    await expect(page.getByTestId('ap-mensagem')).toBeVisible();
    await expect(linhaCom(page, 'ap-lista', `${documento}/1`)).toContainText('1 / 1');

    // Um terceiro paga por borderô.
    await entrar(page, 'SINT.FIN.PAGA');
    await page.goto('/financeiro/pagar/borderos');
    await expect(page.getByTestId('tela-fin-borderos')).toBeVisible();
    await linhaCom(page, 'bd-aprovados', `${documento}/1`).locator('input[type="checkbox"]').check();
    await escolher(page.getByTestId('bd-conta'), '1');
    await semViolacaoAxe(page, '/financeiro/pagar/borderos');
    await page.getByTestId('bd-pagar').click();
    await expect(page.getByTestId('bd-mensagem')).toBeVisible();
    await expect(page.getByTestId('bd-lista')).toBeVisible();

    // O título aparece pago na lista (a situação derivada da data de pagamento e do borderô).
    await page.goto('/financeiro/pagar/titulos');
    await escolher(page.getByTestId('tp-situacao'), 'pago');
    await page.getByTestId('tp-consultar').click();
    await expect(page.getByTestId('tp-lista')).toContainText(documento);

    // Remessa ao simulador e adiantamentos (consulta).
    await page.goto('/financeiro/pagar/remessas');
    await expect(page.getByTestId('rm-simulador')).toBeVisible();
    await semViolacaoAxe(page, '/financeiro/pagar/remessas');
    expect(externas).toEqual([]);
  });

  test('títulos da competência → glosa no título → baixa manual; axe @M42', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.FIN.LANCA');
    await page.goto('/financeiro/receber/titulos');
    await expect(page.getByTestId('tela-fin-titulos-receber')).toBeVisible();
    const mes = String(new Date().getUTCMonth() + 1);
    await page.getByTestId('tr-c-convenio').fill('92');
    await page.getByTestId('tr-c-mes').fill(mes);
    await page.getByTestId('tr-c-consultar').click();
    await expect(page.getByTestId('tr-contas')).toBeVisible();
    await semViolacaoAxe(page, '/financeiro/receber/titulos (contas sem título)');
    await page.getByTestId('tr-c-documento').fill(String(700_000 + (Date.now() % 100_000)));
    await page.getByTestId('tr-gerar-competencia').click();
    await expect(page.getByTestId('tr-mensagem')).toContainText('título(s) a receber criado(s)');

    // A glosa no título do convênio 91 pelo demonstrativo (o valor glosado dos itens baixados).
    await page.goto('/financeiro/receber/demonstrativos?titulo=9001');
    await expect(page.getByTestId('glosa-resumo')).toBeVisible();
    await page.getByTestId('dm-motivo').fill('Glosa aceita no demonstrativo sintético');
    await semViolacaoAxe(page, '/financeiro/receber/demonstrativos');
    await page.getByTestId('dm-registrar').click();
    await expect(page.getByTestId('dm-mensagem')).toBeVisible();
    await expect(page.getByTestId('glosa-lista')).toContainText('Glosa aceita');

    // A baixa manual do saldo (valor − recebido − glosa aceita).
    await page.goto('/financeiro/receber/titulos/9001');
    await expect(page.getByTestId('glosa-saldo')).toBeVisible();
    await escolher(page.getByTestId('trd-conta'), '1');
    await page.getByTestId('trd-motivo').fill('Recebido conforme extrato sintético');
    await semViolacaoAxe(page, '/financeiro/receber/titulos/:id');
    await page.getByTestId('trd-baixar').click();
    await expect(page.getByTestId('trd-mensagem')).toBeVisible();

    // Consultas do contas a receber.
    for (const [rota, tela] of [
      ['/financeiro/receber/convenios', 'tela-fin-convenios'],
      ['/financeiro/receber/renegociacoes', 'tela-fin-renegociacoes'],
    ] as const) {
      await page.goto(rota);
      await expect(page.getByTestId(tela)).toBeVisible();
      await semViolacaoAxe(page, rota);
    }
    expect(externas).toEqual([]);
  });

  test('conciliação de extrato sintético: sugestão confirmada e crédito não identificado atribuído; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.FIN.CONCILIA');
    await page.goto('/financeiro/tesouraria/conciliacao');
    await expect(page.getByTestId('tela-fin-conciliacao')).toBeVisible();
    // A tarifa de R$ 35,90 de dois dias atrás (o movimento 501) e um crédito sem casamento.
    const d = new Date();
    const dia = (n: number) => {
      const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
      return `${String(x.getUTCDate()).padStart(2, '0')}/${String(x.getUTCMonth() + 1).padStart(2, '0')}/${x.getUTCFullYear()}`;
    };
    const unico = (Date.now() % 1000) / 100;
    await page
      .getByTestId('cb-conteudo')
      .fill(
        `data;valor;historico;documento\n${dia(-2)};-35,90;TARIFA SINTETICA;1\n${dia(0)};${(250 + unico).toFixed(2).replace('.', ',')};CREDITO SINTETICO;`,
      );
    await page.getByTestId('cb-importar-enviar').click();
    await expect(page.getByTestId('cb-mensagem')).toBeVisible();
    await expect(page.getByTestId('cb-colunas')).toBeVisible();
    await semViolacaoAxe(page, '/financeiro/tesouraria/conciliacao');
    await page.locator('[data-testid^="cb-confirmar-"]').first().click();
    await expect(page.getByTestId('cb-mensagem')).toBeVisible();
    await page.locator('[data-testid^="cb-pendente-"]').first().click();
    await expect(page.getByTestId('cb-creditos')).toContainText('pendente');
    const campo = page.locator('[data-testid^="cb-cr-"]').first();
    await campo.fill('9001');
    await page.locator('[data-testid^="cb-atribuir-"]').first().click();
    await expect(page.getByTestId('cb-mensagem')).toBeVisible();
    await semViolacaoAxe(page, '/financeiro/tesouraria/conciliacao (créditos)');
    expect(externas).toEqual([]);
  });

  test('só tesouraria e fiscal (sem contas a pagar): a fila abre, lança o movimento e gera a DMED; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.FIN.TESFIS');
    await page.goto('/inicio/financeiro');
    await expect(page.getByTestId('tela-fin-worklist')).toBeVisible();
    await expect(page.getByTestId('wf-cartao-creditos')).toBeVisible();
    await expect(page.getByTestId('wf-cartao-fiscal')).toBeVisible();
    await semViolacaoAxe(page, '/inicio/financeiro (tesouraria e fiscal)');
    // O movimento: só a conta do escopo e o botão de lançar liberado (antes, sem a leitura de contas a pagar, ficava
    // desabilitado para sempre).
    await page.goto('/financeiro/tesouraria/movimento');
    await expect(page.getByTestId('mv-lancar')).toBeEnabled();
    await escolher(page.getByTestId('mv-novo-tipo'), 'C');
    await escolher(page.getByTestId('mv-novo-credito'), '1');
    await page.getByTestId('mv-novo-valor').fill('12,34');
    await page.getByTestId('mv-novo-historico').fill('SINTETICO CREDITO E2E');
    await escolher(page.getByTestId('mv-novo-classificacao'), '100.1.1');
    await page.getByTestId('mv-lancar').click();
    await expect(page.getByTestId('mv-mensagem')).toBeVisible();
    // A DMED com a permissão da DMED (sem as opções da EFD-REINF).
    await page.goto('/financeiro/fiscal/dmed');
    await expect(page.getByTestId('dc-gerar')).toBeEnabled();
    await page.getByTestId('dc-gerar').click();
    await expect(page.getByTestId('dc-mensagem')).toBeVisible();
    await semViolacaoAxe(page, '/financeiro/fiscal/dmed (tesouraria e fiscal)');
    expect(externas).toEqual([]);
  });

  test('tesouraria, gerencial, parâmetros, fiscal e exportação contábil abrem sem violação; nada sai', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.FIN.LANCA');
    for (const [rota, tela] of [
      ['/financeiro/tesouraria/movimento', 'tela-fin-movimento'],
      ['/financeiro/tesouraria/fluxo-caixa', 'tela-fin-fluxo-caixa'],
      ['/financeiro/gerencial', 'tela-fin-gerencial'],
      ['/financeiro/parametros', 'tela-fin-parametros'],
      ['/financeiro/fiscal/entradas', 'tela-fin-entradas'],
      ['/financeiro/fiscal/nfse', 'tela-fin-nfse'],
      ['/financeiro/fiscal/dmed', 'tela-fin-dmed'],
      ['/financeiro/fiscal/reinf', 'tela-fin-reinf'],
      ['/financeiro/contabil/exportacao', 'tela-fin-contabil'],
      ['/financeiro/pagar/adiantamentos', 'tela-fin-adiantamentos'],
      ['/inicio/financeiro', 'tela-fin-worklist'],
    ] as const) {
      await page.goto(rota);
      await expect(page.getByTestId(tela)).toBeVisible();
      await semViolacaoAxe(page, rota);
    }
    // A DRE nas duas réguas e os indicadores com as parcelas.
    await page.goto('/financeiro/gerencial');
    await expect(page.getByTestId('gr-dre')).toBeVisible();
    await expect(page.getByTestId('gr-indicadores')).toBeVisible();
    // A NFS-e vai ao simulador; a REINF sai gerada e não enviada.
    await page.goto('/financeiro/fiscal/nfse');
    await page.getByTestId('nf-titulo-receber').fill('9001');
    await page.getByTestId('nf-classificacao').fill('010101');
    await page.getByTestId('nf-item').fill('4.03');
    await page.getByTestId('nf-valor').fill('100');
    await page.getByTestId('nf-emitir').click();
    await expect(page.getByTestId('nf-mensagem')).toBeVisible();
    await page.goto('/financeiro/fiscal/reinf');
    await page.getByTestId('dc-gerar').click();
    await expect(page.getByTestId('dc-mensagem')).toBeVisible();
    await expect(page.getByTestId('dc-lista')).toBeVisible();
    expect(externas).toEqual([]);
  });
});
