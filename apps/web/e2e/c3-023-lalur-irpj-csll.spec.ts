// E2E @C3-023 (F7, 07-FIN L115): LALUR/LACS e apuração do IRPJ e da CSLL pela tela /contabil/lalur. O administrador
// escolhe a apuração trimestral aberta, inclui a adição com a conta da parte B, escolhe as contas do prejuízo fiscal e
// da base negativa, apura (compensação de 30%), provisiona, fecha e confere o bloco M da ECF. As rotas
// /api/contabil/lalur exigem o banco próprio e o E2E roda com a fonte sintética: as respostas são simuladas pelo
// Playwright com massa SINTÉTICA. O efeito no banco está em apps/api/src/modulos/contabil/lalur.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher, esperarSemSelectNativo } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
const gravacao = (mensagem: string, resultado: Record<string, unknown> = {}) => ({
  mensagem,
  repetida: false,
  resultado,
});

test.describe('LALUR e apuração do IRPJ e da CSLL @C3-023 @fase7', () => {
  test.setTimeout(180_000);
  test('ajuste com parte B, apuração com compensação, provisão, fechamento e bloco M; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let situacao = 'aberta';
    let ajustes: Record<string, unknown>[] = [];
    const contasB = [
      { id: 7, codigo: 'PF', descricao: 'PREJUIZO FISCAL SINTETICO', tributo: 'irpj', natureza: 'devedor' },
      { id: 8, codigo: 'BN', descricao: 'BASE NEGATIVA SINTETICA', tributo: 'csll', natureza: 'devedor' },
      { id: 9, codigo: 'PROV', descricao: 'PROVISOES TEMPORARIAS', tributo: 'ambos', natureza: 'devedor' },
    ].map((c) => ({
      ...c,
      saldoInicialCentavos: 100000_00,
      dataSaldoInicial: '2027-01-01',
      saldoCentavos: 100000_00,
    }));
    const apurado = () => situacao !== 'aberta';
    await page.route('**/api/contabil/lalur/**', async (r) => {
      const url = new URL(r.request().url());
      const caminho = url.pathname.replace('/api/contabil/lalur', '');
      if (r.request().method() === 'POST') {
        const corpo = (r.request().postDataJSON() ?? {}) as Record<string, unknown>;
        pedidos.push({ caminho, corpo });
        if (caminho.endsWith('/ajustes')) {
          ajustes = [
            {
              id: 1,
              sequencia: 1,
              tipo: corpo['tipo'],
              codigo: corpo['codigoTabelaDinamica'],
              descricao: corpo['descricao'],
              valorCentavos: Math.round(Number(corpo['valor']) * 100),
              irpj: true,
              csll: true,
              contaParteB: 'PROV',
              versao: 1,
            },
          ];
          return json(
            r,
            gravacao('Ajuste incluído, com o lançamento na parte B.', { ajuste: 1, movimento: 3 }),
          );
        }
        if (caminho.endsWith('/apurar')) {
          situacao = 'apurada';
          return json(
            r,
            gravacao('Apurado: IRPJ a recolher R$ 30.750,00 e CSLL R$ 15.300,00.', { apuracao: 5 }),
          );
        }
        if (caminho.endsWith('/provisionar')) {
          situacao = 'provisionada';
          return json(r, gravacao('Provisão lançada na contabilidade.', { apuracao: 5, lancamento: 44 }));
        }
        if (caminho.endsWith('/estornar-provisao')) {
          situacao = 'apurada';
          return json(
            r,
            gravacao('Provisão estornada: a apuração voltou a apurada e os ajustes estão abertos.', {
              apuracao: 5,
              estorno: 45,
            }),
          );
        }
        if (caminho.endsWith('/fechar')) {
          situacao = 'fechada';
          return json(
            r,
            gravacao('Apuração fechada; a parte B leva o prejuízo e a base negativa do período.'),
          );
        }
        return json(r, gravacao('ok'));
      }
      if (caminho.startsWith('/apoio'))
        return json(r, {
          estabelecimento: 1,
          estabelecimentos: [{ id: 1, nome: 'HOSPITAL SINTETICO' }],
          formas: ['trimestral', 'anual', 'estimativa_mensal'],
          configuracao: null,
          contasContabeis: [
            { id: 59, classificacao: '5.9', descricao: 'DESPESA DE IRPJ', natureza: 'despesa' },
          ],
          contasParteB: contasB,
          apuracoes: [
            {
              id: 5,
              forma: 'trimestral',
              inicio: '2027-01-01',
              fim: '2027-03-31',
              situacao,
              aRecolherCentavos: 0,
            },
          ],
        });
      return json(r, {
        apuracao: {
          id: 5,
          inicio: '2027-01-01',
          fim: '2027-03-31',
          forma: 'trimestral',
          situacao,
          versao: 1,
          lucroAntes: 200000_00,
          baseIrpj: apurado() ? 147000_00 : 0,
          baseCsll: apurado() ? 170000_00 : 0,
          irpjRecolher: apurado() ? 30750_00 : 0,
          csllRecolher: apurado() ? 15300_00 : 0,
        },
        ajustes,
        ecf: {
          linhas: ajustes.length ? ['|M300|93|PROVISAO SINTETICA|A|2|20000,00|PROVISAO SINTETICA|'] : [],
          avisos: [],
        },
        memoria: apurado()
          ? ['Compensação do prejuízo fiscal = menor entre 30% de 210.000,00 e o saldo = 63.000,00']
          : [],
      });
    });

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/contabil/lalur');
    const tela = page.getByTestId('tela-lalur');
    await expect(tela).toBeVisible();
    await esperarSemSelectNativo(tela);

    // Parte A: a adição temporária constitui saldo na conta PROV da parte B.
    await page.getByTestId('lalur-ajuste-descricao').fill('PROVISAO SINTETICA');
    await page.getByTestId('lalur-ajuste-data').fill('2027-03-31');
    await page.getByTestId('lalur-ajuste-valor').fill('20000');
    await page.getByTestId('lalur-ajuste-codigo').fill('93');
    await escolher(page.getByTestId('lalur-ajuste-conta-b'), { rotulo: /PROV/ });
    await page.getByTestId('lalur-incluir-ajuste').click();
    await expect(page.getByTestId('lalur-aviso')).toContainText('parte B');
    await expect(page.getByTestId('lalur-ajustes')).toContainText('PROVISAO SINTETICA');
    const ajuste = pedidos.find((p) => p.caminho.endsWith('/ajustes'));
    expect(ajuste?.corpo['parteB']).toEqual({ conta: 9, efeito: 'constitui' });
    await semViolacaoAxe(page, '/contabil/lalur (parte A)');

    // Apuração com as contas do prejuízo fiscal e da base negativa.
    await escolher(page.getByTestId('lalur-conta-prejuizo'), { rotulo: /PF/ });
    await escolher(page.getByTestId('lalur-conta-base-negativa'), { rotulo: /BN/ });
    await page.getByTestId('lalur-apurar').click();
    await expect(page.getByTestId('lalur-aviso')).toContainText('IRPJ a recolher');
    await expect(page.getByTestId('lalur-totais')).toContainText('30.750,00');
    await expect(page.getByTestId('lalur-memoria')).toContainText('30%');
    const apuracao = pedidos.find((p) => p.caminho.endsWith('/apurar'));
    expect(apuracao?.corpo).toMatchObject({ contaPrejuizo: 7, contaBaseNegativa: 8 });

    await page.getByTestId('lalur-provisionar').click();
    await expect(page.getByTestId('lalur-aviso')).toContainText('Provisão lançada');
    // Estorno da provisão (com o motivo) e nova provisão.
    await page.getByTestId('lalur-justificativa-estorno').fill('Provisão refeita após revisão');
    await page.getByTestId('lalur-estornar').click();
    await expect(page.getByTestId('lalur-aviso')).toContainText('Provisão estornada');
    expect(pedidos.find((p) => p.caminho.endsWith('/estornar-provisao'))?.corpo).toMatchObject({
      justificativa: 'Provisão refeita após revisão',
    });
    await page.getByTestId('lalur-provisionar').click();
    await expect(page.getByTestId('lalur-aviso')).toContainText('Provisão lançada');
    await page.getByTestId('lalur-fechar').click();
    await expect(page.getByTestId('lalur-aviso')).toContainText('fechada');
    await expect(page.getByTestId('lalur-ecf')).toContainText('|M300|93|');
    await expect(page.getByTestId('lalur-form-ajuste')).toHaveCount(0);
    await semViolacaoAxe(page, '/contabil/lalur (fechada)');
  });
});
