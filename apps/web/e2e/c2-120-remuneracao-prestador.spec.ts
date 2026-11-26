import { expect, type Page, test } from '@playwright/test';
import { escolher, esperarSemSelectNativo } from './combos.js';

// 08-SGO L102 (C2-120): remuneração e pagamento do prestador. Fonte sintética (rotas da API respondidas aqui): a tela
// mostra a tabela negociada em unidades com o valor calculado na hora, a visão pelo prestador com as contas analisadas
// sem lote, calcula o lote com o tributo retido e o fecha gerando o título no contas a pagar. Sem <select> nativo.
// Os tributos vêm do cadastro (alíquota vazia); a alíquota digitada é exceção e só segue com o motivo. Pacotes: o
// principal, os itens dentro e fora, a validação na hora (ambulatorial sem diárias) e a inclusão.
const A = '**/api/operadora/remuneracao-rede';
const SENHA = 'Sintetico#2026';

// O gestor da operadora (sintético) lê e grava a remuneração da rede (operadora.prestador.ler/editar, conta.pagar).
async function entrar(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill('SINT.OPERADORA');
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}
const op = (id: number, rotulo: string) => ({ id, rotulo });

async function prepararApi(page: Page) {
  const corpos: Record<string, unknown> = {};
  await page.route('**/api/operadora/cobranca/tela**', (r) =>
    r.fulfill({
      // Resposta completa da tela da cobrança (o cliente confere o formato inteiro).
      json: {
        liberacao: { ligada: true, motivo: null },
        acoes: { gerar: true, motivo: null },
        operadoras: [{ id: 1, razaoSocial: 'OPERADORA SINTETICA', registroAns: '999999' }],
        hoje: '2026-11-25',
        mensagens: { enviar: false, motivo: 'fora de produção' },
        parametros: {
          multaPercentual: 2,
          jurosPercentualMes: 1,
          diasLimiteNotificacao: 50,
          diasInadimplencia: 60,
          diasPrazoNotificacao: 10,
          parcelasMaximas: 12,
        },
      },
    }),
  );
  await page.route(`${A}/1/opcoes`, (r) =>
    r.fulfill({
      json: {
        prestadores: [op(5, 'P1 — PRESTADOR SINTETICO')],
        tabelas: [op(9, 'T1 — TABELA SINTETICA')],
        grupos: [],
        indices: [],
        tributos: [op(3, 'IRRF — Imposto de renda'), op(8, 'ISS — Imposto sobre serviços')],
        naturezas: [op(4, 'D1 — Serviços de saúde')],
        documentos: [op(6, 'Nota fiscal')],
        contratos: [],
        tiposPrestador: [],
      },
    }),
  );
  await page.route(`${A}/1/tabelas`, (r) =>
    r.fulfill({
      json: [
        {
          id: 9,
          versao: 1,
          codigo: 'T1',
          nome: 'TABELA SINTETICA',
          finalidade: 'pagamento_rede',
          tipoValor: 'indice',
          valorCh: 0.5,
          valorUco: 12,
          valorFilme: null,
          prestador: null,
          prestadorNome: null,
          situacao: 'vigente',
          inicio: '2030-01-01',
          fim: null,
          itens: 1,
        },
      ],
    }),
  );
  await page.route(`${A}/1/regras`, (r) => r.fulfill({ json: [] }));
  await page.route(`${A}/tabela/9/itens`, (r) =>
    r.fulfill({
      json: [
        {
          id: 1,
          sequencia: 1,
          procedimento: 2,
          procedimentoRotulo: '10101012 — CONSULTA SINTETICA',
          grupo: null,
          grupoRotulo: null,
          prestador: null,
          valor: null,
          quantidadeCh: 100,
          quantidadeUco: 2,
          quantidadeFilme: null,
          inicio: '2030-01-01',
          fim: null,
          valorCalculado: 74,
        },
      ],
    }),
  );
  let fechado = false;
  await page.route(`${A}/1/prestador/5`, (r) =>
    r.fulfill({
      json: {
        contas: fechado
          ? []
          : [
              {
                id: 70,
                protocolo: 'PROT-1',
                competencia: '2031-03-01',
                tipoGuia: 'consulta',
                apresentado: 10500,
                glosado: 500,
                liberado: 10000,
              },
            ],
        adiantamentos: [],
        lotes: corpos['lote']
          ? [
              {
                id: 80,
                versao: 1,
                numero: 'PR-1',
                competencia: '2031-04-01',
                prestador: 5,
                prestadorNome: 'PRESTADOR SINTETICO',
                vencimento: '2031-04-10',
                situacao: fechado ? 'fechado' : 'calculado',
                bruto: 10000,
                tributos: 150,
                liquido: 9850,
                titulo: fechado ? 33 : null,
                tituloNumero: fechado ? 'TP-33' : null,
                contas: 1,
              },
            ]
          : [],
      },
    }),
  );
  await page.route(`${A}/1/lotes`, async (r) => {
    corpos['lote'] = r.request().postDataJSON();
    await r.fulfill({ status: 201, json: { id: 80, versao: 1 } });
  });
  await page.route(`${A}/lote/80/fechar`, async (r) => {
    corpos['fechar'] = r.request().postDataJSON();
    fechado = true;
    await r.fulfill({ json: { id: 80, versao: 2, titulo: 33, tituloNumero: 'TP-33' } });
  });
  await page.route(`${A}/1/pacotes`, async (r) => {
    if (r.request().method() === 'POST') {
      corpos['pacote'] = r.request().postDataJSON();
      await r.fulfill({ status: 201, json: { id: 90, versao: 1 } });
      return;
    }
    await r.fulfill({
      json: corpos['pacote']
        ? [
            {
              id: 90,
              versao: 1,
              codigo: 'PK1',
              descricao: 'PACOTE SINTETICO',
              tipo: 'cirurgico',
              regime: 'internacao',
              diarias: 2,
              valorGlobal: 2500,
              inicio: '2031-01-01',
              fim: null,
              prestadorNome: null,
              principal: '31000001 — CIRURGIA SINTETICA',
              itens: 3,
            },
          ]
        : [],
    });
  });
  await page.route(
    (u) =>
      u.pathname.endsWith('/api/operadora/remuneracao-rede/procedimentos') &&
      u.searchParams.get('tipo') === 'item',
    (r) =>
      r.fulfill({
        json: [
          op(21, '31000001 — CIRURGIA SINTETICA'),
          op(22, '60000001 — DIARIA SINTETICA'),
          op(23, '70000001 — ORTESE SINTETICA'),
        ],
      }),
  );
  return corpos;
}

test.describe('remuneração e pagamento do prestador @C2-120', () => {
  test('tabela em unidades com valor calculado; lote com tributo e título gerado', async ({ page }) => {
    const corpos = await prepararApi(page);
    await entrar(page);
    await page.goto('/operadora/remuneracao-rede');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Remuneração e pagamento do prestador' }),
    ).toBeVisible();
    await page.getByTestId('remun-tabela-T1').click();
    await expect(page.getByTestId('remun-itens')).toContainText('74,00');
    await esperarSemSelectNativo(page.getByTestId('remuneracao-rede'));

    await escolher(page.getByTestId('remun-aba'), { rotulo: 'Pagamento do prestador' });
    await escolher(page.getByTestId('remun-p-prestador'), { rotulo: /PRESTADOR SINTETICO/ });
    await page.getByTestId('remun-conta-PROT-1').check();
    await page.getByLabel('Competência (mês) (AAAA-MM)').fill('2031-04');
    await page.getByLabel('Vencimento (AAAA-MM-DD)').fill('2031-04-10');
    // IRRF pelo cadastro (alíquota vazia); ISS com alíquota de exceção, que só segue com o motivo.
    await page.getByTestId('remun-l-tributo').click();
    await escolher(page.locator('#remun-l-trib-0'), { rotulo: /IRRF/ });
    await page.getByTestId('remun-l-tributo').click();
    await escolher(page.locator('#remun-l-trib-1'), { rotulo: /ISS/ });
    await page.locator('#remun-l-aliq-1').fill('2');
    await expect(page.getByTestId('remun-l-problema')).toContainText('precisa do motivo');
    await expect(page.getByTestId('remun-l-calcular')).toBeDisabled();
    await page.locator('#remun-l-motivo-1').fill('Alíquota do contrato');
    await expect(page.getByTestId('remun-l-problema')).toHaveCount(0);
    await page.getByTestId('remun-l-calcular').click();
    await expect(page.getByTestId('remun-aviso')).toContainText('Lote calculado');
    expect(corpos['lote']).toMatchObject({
      prestador: 5,
      competencia: '2031-04-01',
      contas: [70],
      tributos: [
        { tributo: 3, aliquota: null, deducao: 0, motivo: null },
        { tributo: 8, aliquota: 2, deducao: 0, motivo: 'Alíquota do contrato' },
      ],
    });

    await escolher(page.locator('#remun-p-natureza'), { rotulo: /Serviços de saúde/ });
    await escolher(page.locator('#remun-p-documento'), { rotulo: 'Nota fiscal' });
    await page.getByTestId('remun-lote-fechar').click();
    await expect(page.getByTestId('remun-lote-PR-1')).toContainText('TP-33');
    expect(corpos['fechar']).toEqual({ versao: 1, natureza: 4, documento: 6 });
  });

  test('pacote: principal, itens dentro e fora, validação na hora e inclusão', async ({ page }) => {
    const corpos = await prepararApi(page);
    await entrar(page);
    await page.goto('/operadora/remuneracao-rede');
    await escolher(page.getByTestId('remun-aba'), { rotulo: 'Pacotes' });
    await expect(page.getByTestId('remun-pacotes')).toBeVisible();
    await page.locator('#remun-k-codigo').fill('PK1');
    await page.locator('#remun-k-descricao').fill('PACOTE SINTETICO');
    await escolher(page.locator('#remun-k-regime'), { rotulo: 'Ambulatorial' });
    await page.locator('#remun-k-diarias').fill('2');
    await page.locator('#remun-k-valor').fill('2.500,00');
    await page.locator('#remun-k-inicio').fill('2031-01-01');
    await expect(page.getByTestId('remun-k-problema')).toContainText('principal');
    await expect(page.getByTestId('remun-k-salvar')).toBeDisabled();
    await page.locator('#remun-k-busca').fill('sintetica');
    await escolher(page.locator('#remun-k-item'), { rotulo: /CIRURGIA SINTETICA/ });
    await page.getByTestId('remun-k-principal').click();
    await expect(page.getByTestId('remun-k-principal-escolhido')).toContainText('CIRURGIA SINTETICA');
    await expect(page.getByTestId('remun-k-problema')).toContainText('ambulatorial não inclui diárias');
    await escolher(page.locator('#remun-k-regime'), { rotulo: 'Internação' });
    await escolher(page.locator('#remun-k-item'), { rotulo: /DIARIA SINTETICA/ });
    await page.getByTestId('remun-k-incluido').click();
    await page.locator('#remun-k-qtd-0').fill('2');
    await escolher(page.locator('#remun-k-item'), { rotulo: /ORTESE SINTETICA/ });
    await page.getByTestId('remun-k-excluido').click();
    await expect(page.getByTestId('remun-k-problema')).toHaveCount(0);
    await esperarSemSelectNativo(page.getByTestId('remuneracao-rede'));
    await page.getByTestId('remun-k-salvar').click();
    await expect(page.getByTestId('remun-aviso')).toContainText('Pacote incluído');
    expect(corpos['pacote']).toMatchObject({
      codigo: 'PK1',
      principal: 21,
      tipo: 'cirurgico',
      regime: 'internacao',
      diarias: 2,
      valorGlobal: 2500,
      inicio: '2031-01-01',
      itens: [
        { item: 22, inclusao: 'incluido', quantidade: 2 },
        { item: 23, inclusao: 'excluido', quantidade: null },
      ],
    });
    await expect(page.getByTestId('remun-pacote-PK1')).toContainText('R$');
  });
});
