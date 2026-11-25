import { expect, type Page, test } from '@playwright/test';
import { escolher, esperarSemSelectNativo } from './combos.js';

// 08-SGO L102 (C2-120): remuneração e pagamento do prestador. Fonte sintética (rotas da API respondidas aqui): a tela
// mostra a tabela negociada em unidades com o valor calculado na hora, a visão pelo prestador com as contas analisadas
// sem lote, calcula o lote com o tributo retido e o fecha gerando o título no contas a pagar. Sem <select> nativo.
const A = '**/api/operadora/remuneracao-rede';
const op = (id: number, rotulo: string) => ({ id, rotulo });

async function prepararApi(page: Page) {
  const corpos: Record<string, unknown> = {};
  await page.route('**/api/operadora/cobranca/tela**', (r) =>
    r.fulfill({
      json: { operadoras: [{ id: 1, razaoSocial: 'OPERADORA SINTETICA', registroAns: '999999' }] },
    }),
  );
  await page.route(`${A}/1/opcoes`, (r) =>
    r.fulfill({
      json: {
        prestadores: [op(5, 'P1 — PRESTADOR SINTETICO')],
        tabelas: [op(9, 'T1 — TABELA SINTETICA')],
        grupos: [],
        indices: [],
        tributos: [op(3, 'IRRF — Imposto de renda')],
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
  return corpos;
}

test.describe('remuneração e pagamento do prestador @C2-120', () => {
  test('tabela em unidades com valor calculado; lote com tributo e título gerado', async ({ page }) => {
    const corpos = await prepararApi(page);
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
    await page.getByTestId('remun-l-tributo').click();
    await escolher(page.locator('#remun-l-trib-0'), { rotulo: /IRRF/ });
    await page.getByLabel('Alíquota (%)').fill('1,5');
    await page.getByTestId('remun-l-calcular').click();
    await expect(page.getByTestId('remun-aviso')).toContainText('Lote calculado');
    expect(corpos['lote']).toMatchObject({
      prestador: 5,
      competencia: '2031-04-01',
      contas: [70],
      tributos: [{ tributo: 3, aliquota: 1.5 }],
    });

    await escolher(page.locator('#remun-p-natureza'), { rotulo: /Serviços de saúde/ });
    await escolher(page.locator('#remun-p-documento'), { rotulo: 'Nota fiscal' });
    await page.getByTestId('remun-lote-fechar').click();
    await expect(page.getByTestId('remun-lote-PR-1')).toContainText('TP-33');
    expect(corpos['fechar']).toEqual({ versao: 1, natureza: 4, documento: 6 });
  });
});
