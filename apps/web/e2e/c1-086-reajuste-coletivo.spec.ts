// E2E @C1-086 (F7, 08-SGO L96): reajuste além do anual digitado pela tela /operadora/reajustes-coletivos, aberta pelo
// link da tela de cobrança. A equipe da operadora cadastra o teto da ANS com o protocolo (falta mostrada na hora), cria o
// agrupamento do coletivo pequeno (os contratos elegíveis entram de uma vez), calcula o percentual único informado com
// a memória e aplica no aniversário; cadastra a regra por sinistralidade com faixas contínuas, apura o contrato grande
// (a conta aparece impressa) e registra o reajuste. As rotas /api/operadora/reajustes-coletivos exigem o banco próprio
// e o E2E roda com a fonte sintética: as respostas são simuladas pelo Playwright com massa SINTÉTICA. O efeito no banco
// está em apps/api/src/modulos/operadora/reajuste-coletivo-propria.int.spec.ts.
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

test.describe('Reajuste coletivo e índices da operadora @C1-086 @fase7', () => {
  test.setTimeout(180_000);
  test('teto da ANS, agrupamento com percentual único aplicado e reajuste pela sinistralidade; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let agrupamento = {
      id: 5,
      versao: 1,
      descricao: 'AGRUPAMENTO SINTETICO 2027',
      vigencia: '2027-05-01',
      limiteVidas: 29,
      contratos: 1,
      vidas: 2,
      percentual: null as number | null,
      dataAplicacao: null as string | null,
      situacao: 'aberto',
      memoria: null as string | null,
      reajustes: 0,
    };
    await page.route('**/api/operadora/reajustes-coletivos/**', async (r) => {
      const u = new URL(r.request().url());
      const caminho = u.pathname.replace('/api/operadora/reajustes-coletivos', '');
      if (r.request().method() === 'POST') {
        const corpo = r.request().postDataJSON() as Record<string, unknown>;
        pedidos.push({ caminho, corpo });
        if (caminho.endsWith('/agrupamentos'))
          return json(r, { id: 5, versao: 1, contratos: 1, vidas: 2 }, 201);
        if (caminho.endsWith('/calculo')) {
          agrupamento = {
            ...agrupamento,
            versao: 2,
            percentual: 9.5,
            situacao: 'calculado',
            memoria: 'Nota atuarial',
          };
          return json(r, { id: 5, versao: 2, percentual: 9.5 });
        }
        if (caminho.endsWith('/aplicacao')) {
          agrupamento = { ...agrupamento, versao: 3, situacao: 'aplicado', dataAplicacao: '2027-05-03' };
          return json(r, { id: 5, versao: 3, aplicados: 1, ignorados: '' });
        }
        if (caminho.endsWith('/sinistralidade'))
          return json(r, { id: 9, versao: 1, percentual: 12, sinistralidade: 80 }, 201);
        return json(r, { id: 1, versao: 1 }, 201);
      }
      if (caminho === '/indices') return json(r, []);
      if (caminho.endsWith('/regras'))
        return json(r, [
          {
            id: 3,
            versao: 1,
            codigo: 'SIN-70',
            descricao: 'REGRA SINTETICA',
            base: 'sinistralidade',
            meses: 12,
            meta: 70,
            vigenciaInicio: '2026-01-01',
            vigenciaFim: null,
            ativo: true,
            faixas: [
              { de: 0, ate: 70, percentual: 3 },
              { de: 70, ate: null, percentual: 12 },
            ],
          },
        ]);
      if (caminho.endsWith('/agrupamentos'))
        return json(r, pedidos.some((p) => p.caminho.endsWith('/agrupamentos')) ? [agrupamento] : []);
      if (caminho.endsWith('/contratos') && caminho.startsWith('/agrupamentos'))
        return json(r, [
          { id: 1, contrato: 11, numero: 'COL-P', mesReajuste: 5, vidas: 2, reajustado: false },
        ]);
      if (caminho.endsWith('/contratos'))
        return json(r, [
          {
            id: 11,
            numero: 'COL-P',
            operadora: 7,
            situacao: 'ativo',
            inicio: '2026-01-01',
            mesReajuste: 5,
            tipoContratacao: 2,
            vidas: 2,
          },
          {
            id: 12,
            numero: 'COL-G',
            operadora: 7,
            situacao: 'ativo',
            inicio: '2026-01-01',
            mesReajuste: 5,
            tipoContratacao: 2,
            vidas: 30,
          },
        ]);
      if (caminho.endsWith('/previa'))
        return json(r, {
          contrato: 12,
          regra: 3,
          receita: 10000,
          despesa: 8000,
          meses: 12,
          valorApurado: 80,
          faixa: { de: 70, ate: null, percentual: 12 },
          percentual: 12,
          memoria: 'Sinistralidade = despesa 8000,00 / receita 10000,00 × 100 = 80,00% (12 meses)',
          periodo: { inicio: '2026-05-01', fim: '2027-04-30' },
          problemas: [],
          problemasContrato: [],
        });
      return json(r, []);
    });

    // A operadora vem da tela da cobrança (fonte sintética): a fatia da operadora não está ligada na massa do E2E.
    await page.route('**/api/operadora/cobranca/tela', (r) =>
      json(r, {
        liberacao: { ligada: true, motivo: null },
        acoes: { gerar: false, motivo: 'Somente consulta' },
        operadoras: [{ id: 7, razaoSocial: 'OPERADORA SINTETICA', registroAns: '000001' }],
        hoje: '2027-05-01',
        mensagens: { enviar: false, motivo: 'Desenvolvimento' },
        parametros: {
          multaPercentual: 2,
          jurosPercentualMes: 1,
          diasLimiteNotificacao: 50,
          diasInadimplencia: 60,
          diasPrazoNotificacao: 10,
          parcelasMaximas: 12,
        },
      }),
    );
    await entrar(page, 'SINT.OPERADORA');
    await page.goto('/operadora/cobranca');
    await page.getByTestId('link-reajuste-coletivo').click();
    await expect(page).toHaveURL(/\/operadora\/reajustes-coletivos/);
    await expect(page.getByTestId('tela-reajuste-coletivo')).toBeVisible();
    await escolher(page.getByTestId('reajuste-operadora'), { indice: 0 });

    // Teto da ANS: o protocolo é cobrado na hora.
    await page.getByTestId('ind-codigo').locator('input').fill('ANS-2027');
    await page.getByTestId('ind-descricao').locator('input').fill('Teto individual sintético');
    await page.getByTestId('ind-inicio').locator('input').fill('2027-05-01');
    await page.getByTestId('ind-percentual').locator('input').fill('6,06');
    await expect(page.getByTestId('ind-falta')).toContainText('protocolo');
    await page.getByTestId('ind-protocolo').locator('input').fill('OF-SINT-1');
    await expect(page.getByTestId('ind-falta')).toHaveCount(0);
    await page.getByTestId('ind-salvar').click();
    await expect(page.getByTestId('reajuste-aviso')).toContainText('Índice cadastrado');

    // Agrupamento: cria, calcula o percentual informado com memória e aplica no aniversário.
    await page.getByTestId('aba-agrupamento').click();
    await page.getByTestId('agr-descricao').locator('input').fill('Agrupamento sintético 2027');
    await page.getByTestId('agr-vigencia').locator('input').fill('2027-05-01');
    await page.getByTestId('agr-criar').click();
    await expect(page.getByTestId('reajuste-aviso')).toContainText('1 contrato');
    await page.getByTestId('agrupamento-abrir-5').click();
    await page.getByTestId('agr-percentual').locator('input').fill('9,5');
    await page
      .getByTestId('agr-justificativa')
      .locator('input')
      .fill('Nota atuarial sintética do agrupamento');
    await page.getByTestId('agr-calcular').click();
    await expect(page.getByTestId('agrupamento-situacao-5')).toHaveText('Calculado');
    await page.getByTestId('agrupamento-abrir-5').click();
    await page.getByTestId('agr-competencia').locator('input').fill('2027-05');
    await page.getByTestId('agr-aplicar').click();
    await expect(page.getByTestId('reajuste-aviso')).toContainText('1 contrato');

    // Sinistralidade do contrato grande: a conta impressa antes de registrar.
    await page.getByTestId('aba-sinistralidade').click();
    await escolher(page.getByTestId('sin-contrato'), { rotulo: /COL-G/ });
    await escolher(page.getByTestId('sin-regra'), { rotulo: /SIN-70/ });
    await page.getByTestId('sin-competencia').locator('input').fill('2027-05');
    await page.getByTestId('sin-apurar').click();
    await expect(page.getByTestId('sin-memoria')).toContainText('despesa 8000,00 / receita 10000,00');
    await expect(page.getByTestId('sin-percentual')).toHaveText('12%');
    await page.getByTestId('sin-registrar').click();
    await expect(page.getByTestId('reajuste-aviso')).toContainText('Reajuste de 12%');

    const caminhos = pedidos.map((p) => p.caminho);
    expect(caminhos).toEqual([
      '/indices',
      expect.stringMatching(/^\/\d+\/agrupamentos$/),
      '/agrupamentos/5/calculo',
      '/agrupamentos/5/aplicacao',
      '/contratos/12/sinistralidade',
    ]);
    expect(pedidos[0]!.corpo).toMatchObject({
      tipo: 'teto_individual_ans',
      percentual: 6.06,
      protocolo: 'OF-SINT-1',
    });
    expect(pedidos[2]!.corpo).toMatchObject({ regra: null, percentual: 9.5 });
    expect(pedidos[3]!.corpo).toMatchObject({ competencia: '2027-05' });
    expect(pedidos[4]!.corpo).toEqual({ competencia: '2027-05', regra: 3 });
    await semViolacaoAxe(page, 'reajuste coletivo');
  });
});
