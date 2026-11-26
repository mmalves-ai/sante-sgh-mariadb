// C3-026 (08-SGO L111): contabilidade regulatória da operadora, pelo caminho da tela. As rotas
// /api/operadora/provisoes-tecnicas exigem o banco próprio, e o E2E roda com a fonte sintética (sem núcleo); por isso
// as respostas são simuladas pelo Playwright com massa SINTÉTICA. O que se prova é a tela: incluir conta no plano
// padrão da ANS, ligar uma conta própria achada pela busca remota, calcular as provisões pela metodologia da ANS com a
// base informada, contabilizar a variação e ver o balancete no padrão da ANS. O efeito no banco está no contrato de
// efeito (apps/api/src/modulos/operadora/provisao-tecnica-propria.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
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

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

const conta = (id: number, codigo: string, tipo: 'sintetica' | 'analitica', superior: number | null) => ({
  id,
  versao: 1,
  codigo,
  descricao: `CONTA SINTETICA ${codigo}`,
  tipo,
  natureza: 'credora',
  modalidades: null,
  vigenciaInicio: '2031-01-01',
  vigenciaFim: null,
  versaoFonte: 'RN 528/2022',
  grau: codigo.length,
  superior,
});

test.describe('C3-026 contabilidade regulatória da operadora @C3-026', () => {
  test('plano da ANS, mapa por busca remota, cálculo pela metodologia da ANS, contabilização e balancete', async ({
    page,
  }) => {
    const pedidos: { metodo: string; caminho: string; corpo: Record<string, unknown> | null }[] = [];
    const plano = [conta(1, '8', 'sintetica', null), conta(2, '81', 'sintetica', 1)];
    const mapas: Record<string, unknown>[] = [];
    const provisoes: Record<string, unknown>[] = [];
    await page.route('**/api/operadora/ans/apoio', (r) =>
      json(r, {
        destino: 'simulador',
        leiaute: 'sintetico',
        operadoras: [{ id: 7, nome: 'OPERADORA SINTETICA', registroAns: '410361' }],
        obrigacoes: [],
        motivosSib: [],
        camposSib: [],
        valoresTps: [],
        situacao: { vale: true, motivo: null },
      }),
    );
    await page.route('**/api/operadora/provisoes-tecnicas**', (r) => {
      const req = r.request();
      const url = new URL(req.url());
      const caminho = url.pathname.replace('/api/operadora/provisoes-tecnicas', '');
      const corpo = req.method() === 'POST' ? (req.postDataJSON() as Record<string, unknown>) : null;
      pedidos.push({ metodo: req.method(), caminho: `${caminho}${url.search}`, corpo });
      if (req.method() === 'GET') {
        if (caminho === '/plano-ans') return json(r, plano);
        if (caminho === '/7/mapa') return json(r, mapas);
        if (caminho === '/contas-contabeis')
          return json(r, [
            { id: 31, classificacao: '2.9.26.001', descricao: 'PEONA SINTETICA' },
            { id: 32, classificacao: '2.9.26.002', descricao: 'PESL SINTETICA' },
            { id: 33, classificacao: '4.9.26.001', descricao: 'DESPESA SINTETICA' },
          ]);
        if (caminho === '/7/balancete')
          return json(r, {
            data: url.searchParams.get('data'),
            linhas: [
              {
                codigo: '8',
                descricao: 'CONTA SINTETICA 8',
                tipo: 'sintetica',
                grau: 1,
                saldoCentavos: -1700000,
                parcelas: [],
              },
              {
                codigo: '81',
                descricao: 'CONTA SINTETICA 81',
                tipo: 'sintetica',
                grau: 2,
                saldoCentavos: -1700000,
                parcelas: [],
              },
              {
                codigo: '811',
                descricao: 'CONTA SINTETICA 811',
                tipo: 'analitica',
                grau: 3,
                saldoCentavos: -1700000,
                parcelas: [{ classificacao: '2.9.26.001', saldoCentavos: -1700000 }],
              },
            ],
            semMapa: [{ contaContabil: 33, classificacao: '4.9.26.001', saldoCentavos: 1700000 }],
            diferencaCentavos: 0,
          });
        if (caminho === '') return json(r, provisoes);
        return json(r, []);
      }
      if (caminho === '/plano-ans') {
        plano.push(conta(3, String(corpo?.['codigo']), 'analitica', 2));
        return json(r, { id: 3, versao: 1 }, 201);
      }
      if (caminho === '/7/mapa') {
        mapas.push({
          id: 41,
          versao: 1,
          contaContabil: corpo?.['contaContabil'],
          contaAns: corpo?.['contaAns'],
          contaAnsDescricao: 'CONTA SINTETICA 811',
          classificacao: '2.9.26.001',
          contaDescricao: 'PEONA SINTETICA',
          duplicaValor: false,
          grupo: null,
          subgrupo: null,
          paginaDiops: null,
          linhaDiops: null,
          vigenciaInicio: corpo?.['vigenciaInicio'],
          vigenciaFim: null,
          ativo: true,
        });
        return json(r, { id: 41, versao: 1 }, 201);
      }
      if (caminho === '/calculo') {
        provisoes.push({
          id: 51,
          versao: 1,
          competencia: '2031-02-01',
          baseInicio: '2030-03-01',
          baseFim: '2031-02-28',
          metodo: 'metodologia_ans',
          situacao: 'calculada',
          calculadoEm: '2031-03-01T10:00:00',
          contabilizadoEm: null,
          observacao: null,
          total: 17000,
          itens: [
            {
              id: 61,
              sequencia: 1,
              tipo: 'peona',
              conta: 31,
              classificacao: '2.9.26.001',
              valor: 17000,
              valorAnterior: null,
              observacao: null,
            },
          ],
        });
        return json(r, { id: 51, versao: 1 }, 201);
      }
      if (caminho === '/51/contabilizacao') {
        const p = provisoes[0]!;
        p['situacao'] = 'contabilizada';
        p['versao'] = 2;
        return json(r, { id: 51, versao: 2 });
      }
      return json(r, { type: 'about:blank', title: 'Não simulado', status: 404 }, 404);
    });

    // A contabilidade regulatória exige operadora.provisaoTecnica.* (perfil operadora-ans), que o SINT.ADMIN não tem;
    // o SINT.OPERADORA tem os perfis da operadora concedidos nominalmente (lê, edita o plano e o mapa, calcula).
    await entrar(page, 'SINT.OPERADORA');
    await page.goto('/operadora/ans/provisoes-tecnicas');
    await expect(page.getByTestId('tela-provisoes-tecnicas')).toBeVisible();

    // Plano padrão da ANS: inclui a conta analítica 811 sob a 81.
    await page.getByTestId('plano-codigo').locator('input').fill('811');
    await page.getByTestId('plano-descricao').locator('input').fill('PEONA SINTETICA ANS');
    await escolher(page.getByTestId('plano-tipo'), 'analitica');
    await page.getByTestId('plano-inicio').locator('input').fill('2031-01-01');
    await page.getByTestId('plano-incluir').click();
    await expect(page.getByTestId('plano-conta-811')).toBeVisible();
    const inclusao = pedidos.find((p) => p.metodo === 'POST' && p.caminho === '/plano-ans');
    expect(inclusao?.corpo).toMatchObject({ codigo: '811', tipo: 'analitica', versaoFonte: 'RN 528/2022' });

    // Mapa: conta própria achada pela busca remota, ligada à 811 (a opção mostra a classificação e a descrição).
    await page.getByTestId('aba-mapa').click();
    await expect(page.getByTestId('painel-mapa')).toBeVisible();
    await escolher(page.getByTestId('mapa-propria'), { rotulo: '2.9.26.001 PEONA SINTETICA' });
    expect(pedidos.some((p) => p.caminho.startsWith('/contas-contabeis?busca='))).toBe(true);
    await escolher(page.getByTestId('mapa-ans'), '811');
    await page.getByTestId('mapa-inicio').locator('input').fill('2031-01-01');
    await page.getByTestId('mapa-incluir').click();
    await expect(page.getByTestId('mapa-linha-41')).toBeVisible();
    expect(pedidos.find((p) => p.caminho === '/7/mapa' && p.metodo === 'POST')?.corpo).toMatchObject({
      contaContabil: 31,
      contaAns: '811',
      duplicaValor: false,
    });

    // Provisões: metodologia da ANS com a base informada; depois contabiliza a variação.
    await page.getByTestId('aba-provisoes').click();
    await page.getByTestId('prov-competencia').locator('input').fill('2031-02');
    await escolher(page.getByTestId('prov-conta-peona'), { rotulo: '2.9.26.001 PEONA SINTETICA' });
    await escolher(page.getByTestId('prov-conta-pesl'), { rotulo: '2.9.26.002 PESL SINTETICA' });
    await escolher(page.getByTestId('prov-origem'), 'informada');
    await page.getByTestId('prov-contraprestacoes').locator('input').fill('200000');
    await page.getByTestId('prov-eventos').locator('input').fill('170000');
    await page.getByTestId('prov-avisados').locator('input').fill('0');
    await page.getByTestId('prov-calcular').click();
    await expect(page.getByTestId('prov-situacao-51')).toHaveText('Calculada');
    expect(pedidos.find((p) => p.caminho === '/calculo')?.corpo).toMatchObject({
      competencia: '2031-02-01',
      metodo: 'metodologia_ans',
      contas: { peona: 31, pesl: 32 },
      base: { contraprestacoes: 200000, eventos: 170000, avisadosNaoPagos: 0 },
      versao: null,
    });
    await escolher(page.getByTestId('prov-conta-despesa'), { rotulo: '4.9.26.001 DESPESA SINTETICA' });
    await page.getByTestId('prov-contabilizar-51').click();
    await expect(page.getByTestId('prov-situacao-51')).toHaveText('Contabilizada');
    expect(pedidos.find((p) => p.caminho === '/51/contabilizacao')?.corpo).toEqual({
      versao: 1,
      contaDespesa: 33,
      contaReversao: null,
    });

    // Balancete no padrão da ANS na data, com as parcelas e as contas sem ligação.
    await page.getByTestId('aba-balancete').click();
    await page.getByTestId('balancete-data').locator('input').fill('2031-02-28');
    await page.getByTestId('balancete-montar').click();
    await expect(page.getByTestId('balancete-linha-811')).toContainText('2.9.26.001');
    await expect(page.getByTestId('balancete-sem-mapa')).toContainText('4.9.26.001');
    await expect(page.getByTestId('balancete-diferenca')).toHaveText('O balancete fecha.');

    await semViolacaoAxe(page, 'contabilidade regulatória da operadora');
  });
});
