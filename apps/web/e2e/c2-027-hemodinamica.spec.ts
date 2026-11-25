// E2E @C2-027 (F8, 04-CC linha 107): registro estruturado do exame de hemodinâmica. As rotas
// `/api/sadt/hemodinamica/*` só existem no banco do cliente (na fonte sintética respondem 503), então este E2E simula
// essas rotas com um estado em memória que segue a regra do servidor (um registro por exame; versão a cada gravação;
// concluído não muda mais). O que fica no banco está no contrato de efeito
// apps/api/src/modulos/sadt/hemodinamica-propria.int.spec.ts. Aqui se prova o fluxo: o atalho na tela de métodos
// gráficos, a fila do setor por paciente, abrir o registro com a validação na hora (segundo operador igual ao
// primeiro é recusado), os achados por vaso com a regra do grau, "Salvar e concluir" travado até os indicadores de
// dose (RDC Anvisa 611/2022) e o alerta de dose substancial; concluído, a tela fica só leitura. Axe na tela. Massa
// SINTÉTICA.
import { expect, type Page, type Route, test } from '@playwright/test';
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

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

const lista = (l: string[]) => l.map((id) => ({ id, rotulo: id }));
const OPCOES = {
  profissionais: [
    { id: 11, rotulo: 'OPERADOR FICTICIO UM' },
    { id: 12, rotulo: 'OPERADOR FICTICIO DOIS' },
  ],
  vias: lista(['radial_direita', 'femoral_direita']),
  anestesias: lista(['local', 'sedacao', 'geral']),
  dominancias: lista(['direita', 'esquerda', 'balanceada']),
  hemostasias: lista(['compressao_manual', 'pulseira_compressiva']),
  condutas: lista(['tratamento_clinico', 'angioplastia', 'cirurgia']),
  tiposAchado: lista(['normal', 'estenose', 'oclusao']),
  calcificacoes: lista(['ausente', 'leve']),
  condutasAchado: lista(['nenhuma', 'angioplastia']),
};

function simular(page: Page) {
  const corpos: Record<string, unknown>[] = [];
  const exame = {
    item: 71,
    numero: 'R-FIC-71',
    solicitadoEm: '2030-03-10T12:30:00.000Z',
    urgente: true,
    situacaoItem: 'solicitado',
    paciente: 'PACIENTE FICTICIO H',
    prontuario: '9071',
    exame: 'CATETERISMO FICTICIO',
    setor: 'HEMODINAMICA FICTICIA',
  };
  let registro: Record<string, unknown> | null = null;
  let achados: Record<string, unknown>[] = [];
  const alertas = () =>
    registro && Number(registro['kermaReferenciaMgy'] ?? 0) >= 5000 ? ['dose-substancial'] : [];
  return {
    corpos,
    async ligar() {
      await page.route('**/api/sadt/hemodinamica/**', async (rota) => {
        const req = rota.request();
        const url = new URL(req.url());
        const caminho = url.pathname.replace('/api/sadt/hemodinamica', '');
        if (req.method() === 'GET' && caminho === '/fila')
          return json(rota, {
            de: url.searchParams.get('de'),
            ate: url.searchParams.get('ate'),
            exames: [
              {
                ...exame,
                registro: registro ? registro['id'] : null,
                situacao: registro ? registro['situacao'] : 'sem_registro',
                inicioEm: registro ? registro['inicioEm'] : null,
                vasosComLesao: achados.some((a) => Number(a['grauPercentual'] ?? 0) >= 70) ? 1 : 0,
                alertas: alertas(),
              },
            ],
          });
        if (req.method() === 'GET' && caminho === '/itens/71')
          return json(rota, {
            exame,
            registro,
            achados,
            achadosCorrigidos: 0,
            alertas: alertas(),
            vasosComLesao: 0,
            opcoes: OPCOES,
          });
        const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
        corpos.push(corpo);
        if (caminho === '/itens/71/iniciar') {
          registro = {
            id: 501,
            versao: 1,
            situacao: 'em_andamento',
            fimEm: null,
            introdutorFrench: null,
            anestesia: null,
            contrasteNome: null,
            contrasteVolumeMl: null,
            heparinaUi: null,
            tempoFluoroscopiaSegundos: null,
            kermaReferenciaMgy: null,
            produtoDoseAreaGycm2: null,
            dominancia: null,
            fracaoEjecao: null,
            pressaoDiastolicaFinalVe: null,
            hemostasia: null,
            complicacoes: null,
            conclusao: null,
            condutaIndicada: null,
            segundoOperador: null,
            anestesista: null,
            ...corpo,
          };
          return json(rota, { id: 501 });
        }
        if (caminho === '/registros/501' && registro) {
          if (corpo['versao'] !== registro['versao'])
            return json(rota, { status: 409, codigo: 'conflito-versao' }, 409);
          const { achados: novos, ...resto } = corpo;
          delete resto['versao'];
          registro = { ...registro, ...resto, versao: Number(registro['versao']) + 1 };
          achados = (novos as Record<string, unknown>[]).map((a, i) => ({
            id: 600 + i,
            sequencia: i + 1,
            segmento: null,
            grauPercentual: null,
            fluxoTimi: null,
            calcificacao: null,
            comprimentoMm: null,
            bifurcacao: false,
            conduta: null,
            stentImplantado: false,
            observacao: null,
            ...a,
          }));
          return json(rota, { id: 501, versao: registro['versao'] });
        }
        if (caminho === '/registros/501/concluir' && registro) {
          registro = { ...registro, situacao: 'concluido', versao: Number(registro['versao']) + 1 };
          return json(rota, { id: 501, versao: registro['versao'], alertas: alertas() });
        }
        return json(rota, { status: 404 }, 404);
      });
    },
  };
}

test.describe('@C2-027 registro de hemodinâmica', () => {
  test('o laudador abre o registro pela fila, lança os achados e conclui com os indicadores de dose', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const api = simular(page);
    await api.ligar();
    await entrar(page, 'SINT.LAUDADOR');

    // O atalho na tela de métodos gráficos leva ao registro.
    await page.goto('/sadt/laudos');
    await page.getByTestId('laudo-ir-hemodinamica').click();
    await expect(page).toHaveURL(/\/sadt\/hemodinamica/);
    await expect(page.getByTestId('hemodinamica')).toBeVisible();
    await expect(page.getByTestId('hemodinamica-item-71')).toHaveAttribute('data-situacao', 'sem_registro');
    await expect(page.getByTestId('hemodinamica-item-71')).toContainText('PACIENTE FICTICIO H');

    // Abrir o registro: a validação roda na hora (segundo operador igual ao primeiro é recusado).
    await page.getByTestId('hemodinamica-abrir-71').click();
    await page.getByTestId('hemo-inicio').locator('input').fill('10:00');
    await escolher(page.getByTestId('hemo-via'), 'radial_direita');
    await escolher(page.getByTestId('hemo-op1'), '11');
    await escolher(page.getByTestId('hemo-op2'), '11');
    await expect(page.getByTestId('hemo-problema').first()).toContainText('outra pessoa');
    await expect(page.getByTestId('hemo-iniciar')).toBeDisabled();
    await escolher(page.getByTestId('hemo-op2'), '12');
    await expect(page.getByTestId('hemo-problema')).toHaveCount(0);
    await page.getByTestId('hemo-iniciar').click();
    await expect(page.getByTestId('hemodinamica-situacao')).toHaveAttribute('data-situacao', 'em_andamento');
    expect(api.corpos[0]).toMatchObject({
      viaAcesso: 'radial_direita',
      primeiroOperador: 11,
      segundoOperador: 12,
    });

    // Achado: estenose sem grau é recusada na hora; com 80% e stent, aceita.
    await page.getByTestId('hemo-incluir-achado').click();
    await page.getByTestId('hemo-achado-vaso-0').locator('input').fill('Descendente anterior');
    await expect(page.getByTestId('hemo-problema').first()).toContainText('grau');
    await page.getByTestId('hemo-achado-grau-0').locator('input').fill('80');
    await escolher(page.getByTestId('hemo-achado-conduta-0'), 'angioplastia');
    await page.getByTestId('hemo-achado-stent-0').check();
    await expect(page.getByTestId('hemo-problema')).toHaveCount(0);

    // Concluir fica travado até o desfecho e os indicadores de dose.
    await expect(page.getByTestId('hemo-concluir')).toBeDisabled();
    await expect(page.getByTestId('hemo-falta-concluir')).toContainText('RDC Anvisa 611/2022');
    await page.getByTestId('hemo-fim').locator('input').fill('11:10');
    await escolher(page.getByTestId('hemo-hemostasia'), 'pulseira_compressiva');
    await escolher(page.getByTestId('hemo-conduta'), 'angioplastia');
    await page
      .getByTestId('hemo-conclusao')
      .locator('input, textarea')
      .first()
      .fill('Lesão uniarterial fictícia.');
    await page.getByTestId('hemo-fluoro').locator('input').fill('25:00');
    await page.getByTestId('hemo-kerma').locator('input').fill('5200');
    await expect(page.getByTestId('hemodinamica-alerta').first()).toContainText('Dose substancial');
    await expect(page.getByTestId('hemo-falta-concluir')).toHaveCount(0);
    await semViolacaoAxe(page, '/sadt/hemodinamica');

    await page.getByTestId('hemo-concluir').click();
    await expect(page.getByTestId('hemodinamica-mensagem')).toContainText('concluído');
    expect(api.corpos[1]).toMatchObject({
      versao: 1,
      tempoFluoroscopiaSegundos: 1500,
      kermaReferenciaMgy: 5200,
      achados: [
        { vaso: 'Descendente anterior', tipo: 'estenose', grauPercentual: 80, stentImplantado: true },
      ],
    });
    expect(api.corpos[2]).toEqual({ versao: 2 });
    await expect(page.getByTestId('hemodinamica-situacao')).toHaveAttribute('data-situacao', 'concluido');
    await expect(page.getByTestId('hemodinamica-encerrado')).toBeVisible();
    await expect(page.getByTestId('hemo-salvar')).toHaveCount(0);
    await expect(page.getByTestId('hemodinamica-item-71')).toHaveAttribute('data-situacao', 'concluido');
    await semViolacaoAxe(page, '/sadt/hemodinamica');
    expect(externas).toEqual([]);
  });
});
