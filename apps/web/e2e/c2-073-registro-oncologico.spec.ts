// E2E @C2-073 (F8, 09-AREA linha 69): registro oncológico e radioterapia pela aba "Tumor e radioterapia" da ficha da
// oncologia (`/pep/especialidades/oncologia/:reg`). O médico registra o tumor pela busca na CID-10 e na CID-O-3 (a
// topografia vem sugerida pelo CID), vê a recusa do domínio na hora (comportamento /2 com CID maligno), estadia com o
// TNM (M1 sem sítio trava o gravar; o estádio IV é sugerido), planeja a radioterapia (a dose total é calculada) e
// registra a sessão com a dose da fração já preenchida. O registro só existe no banco do cliente (na fonte sintética a
// API responde 503): as respostas são simuladas pelo Playwright com massa SINTÉTICA, no contrato do servidor. O efeito
// no banco está em apps/api/src/modulos/especialidades/registro-oncologico.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const REG = 950102;
const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const HOJE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const TUMOR = {
  id: 7301,
  versao: 1,
  cid: 'C50.4',
  cidDescricao: 'C2073 NEOPLASIA SINTETICA',
  topografia: 'C50.4',
  topografiaDescricao: 'QUADRANTE SINTETICO',
  morfologia: 'M8500/3',
  morfologiaDescricao: 'MORFOLOGIA SINTETICA',
  lateralidade: 'esquerda',
  diagnosticadoEm: '2026-10-01',
  baseDiagnostica: 'histologia_primario',
  ecog: 1,
  situacao: 'ativo',
  estadiamentos: [] as unknown[],
  metastases: [] as unknown[],
};
const PLANO = {
  id: 7311,
  versao: 2,
  numero: 'RT000001',
  tumor: 7301,
  regiao: 'Mama',
  aparelho: null,
  intencao: 'Adjuvante',
  tecnica: 'conformacional',
  doseTotalCgy: 5000,
  doseFracaoCgy: 200,
  fracoesPrevistas: 25,
  fracoesPorSemana: 5,
  situacao: 'aprovado',
  inicioPrevisto: null,
  inicio: null,
  fim: null,
  fisico: true,
  realizadas: 0,
  doseAcumuladaCgy: 0,
  motivoEncerramento: null,
  sessoes: [] as unknown[],
};

test.describe('@C2-073 registro oncológico e radioterapia', () => {
  test('tumor pela CID-O-3, estadiamento TNM com validação na hora, plano e sessão; axe', async ({
    page,
  }) => {
    vigiarExternas(page);
    const estado = { tumores: [] as unknown[], planos: [] as unknown[] };
    const enviados: Record<string, unknown> = {};
    const E = '**/api/especialidades/oncologia';
    await page.route(`${E}/internacoes/${REG}/registro`, (r) => json(r, { hoje: HOJE, ...estado }));
    await page.route(`${E}/registro/cadastros`, (r) =>
      json(r, {
        intencoes: [{ codigo: 'adjuvante', descricao: 'Adjuvante' }],
        regioes: [{ codigo: 'mama', descricao: 'Mama' }],
        aparelhos: [],
        estadios: ['IIB', 'IV'].map((c) => ({ codigo: c, descricao: `Estádio ${c}` })),
        fisicos: [{ codigo: '4401', descricao: 'FISICO SINTETICO C2073' }],
      }),
    );
    await page.route(`${E}/registro/busca?**`, (r) => {
      const u = new URL(r.request().url());
      const c = u.searchParams.get('catalogo');
      return json(r, {
        itens:
          c === 'cid'
            ? [{ codigo: 'C50.4', descricao: 'C2073 NEOPLASIA SINTETICA' }]
            : c === 'morfologia'
              ? [
                  { codigo: 'M8500/2', descricao: 'MORFOLOGIA IN SITU SINTETICA' },
                  { codigo: 'M8500/3', descricao: 'MORFOLOGIA SINTETICA' },
                ]
              : [
                  { codigo: 'C50.4', descricao: 'QUADRANTE SINTETICO' },
                  { codigo: 'C34.1', descricao: 'PULMAO SINTETICO' },
                ],
      });
    });
    await page.route(`${E}/registro/tumores?**`, (r) => {
      enviados['tumor'] = r.request().postDataJSON();
      estado.tumores = [TUMOR];
      return json(
        r,
        { ok: true, id: 7301, aviso: null, mensagem: 'Tumor registrado: estadie em seguida.' },
        201,
      );
    });
    await page.route(`${E}/registro/estadiamentos?**`, (r) => {
      enviados['estadiamento'] = r.request().postDataJSON();
      estado.tumores = [
        {
          ...TUMOR,
          estadiamentos: [
            {
              id: 1,
              tipo: 'clinico',
              data: HOJE,
              tnm: 'cT2N1M1b',
              t: 'T2',
              n: 'N1',
              m: 'M1b',
              estadio: 'IV',
              metastases: 'C34.1',
            },
          ],
          metastases: [{ sequencia: 1, topografia: 'C34.1', descricao: 'PULMAO SINTETICO' }],
        },
      ];
      return json(
        r,
        { ok: true, id: 1, mensagem: 'Estadiamento registrado: o anterior fica na linha do tempo.' },
        201,
      );
    });
    await page.route(`${E}/registro/planos?**`, (r) => {
      enviados['plano'] = r.request().postDataJSON();
      estado.planos = [{ ...PLANO, versao: 1, situacao: 'em_planejamento', fisico: false }];
      return json(
        r,
        {
          ok: true,
          id: 7311,
          numero: 'RT000001',
          mensagem: 'Plano de radioterapia RT000001 em planejamento.',
        },
        201,
      );
    });
    await page.route(`${E}/registro/planos/7311/aprovacao?**`, (r) => {
      enviados['aprovacao'] = r.request().postDataJSON();
      estado.planos = [PLANO];
      return json(r, { ok: true, id: 7311, situacao: 'aprovado', mensagem: 'Plano aprovado.' }, 201);
    });
    await page.route(`${E}/registro/planos/7311/sessoes?**`, (r) => {
      enviados['sessao'] = r.request().postDataJSON();
      estado.planos = [
        {
          ...PLANO,
          situacao: 'em_andamento',
          realizadas: 1,
          doseAcumuladaCgy: 200,
          sessoes: [
            {
              sequencia: 1,
              situacao: 'realizada',
              realizadaEm: `${HOJE}T09:00`,
              doseAplicadaCgy: 200,
              motivo: null,
            },
          ],
        },
      ];
      return json(r, { ok: true, id: 1, situacao: 'em_andamento', mensagem: 'Sessão registrada.' }, 201);
    });

    await entrar(page, 'SINT.ESPECIALISTA');
    await page.goto(`/pep/especialidades/oncologia/${REG}`);
    await page.getByRole('tab', { name: 'Tumor e radioterapia' }).click();
    await expect(page.getByTestId('onco-registro')).toContainText('Nenhum tumor registrado');

    // Tumor: CID pela busca sugere a topografia; a morfologia in situ com CID maligno é recusada na hora.
    await page.getByTestId('onco-novo-tumor').click();
    await page.getByTestId('onco-busca-cid').getByRole('textbox').fill('C50');
    await page.getByTestId('onco-escolher-cid-C50.4').click();
    // A topografia de outro sítio (pulmão para CID de mama) é recusada na hora; volta à sugerida.
    await page.getByTestId('onco-busca-topografia').getByRole('textbox').fill('C3');
    await page.getByTestId('onco-escolher-topografia-C34.1').click();
    await page.getByTestId('onco-diagnosticado-em').getByRole('textbox').fill('01/10/2026');
    await expect(page.getByTestId('onco-erros-tumor')).toContainText('não é do sítio do CID');
    await page.getByTestId('onco-busca-topografia').getByRole('textbox').fill('C50');
    await page.getByTestId('onco-escolher-topografia-C50.4').click();
    await page.getByTestId('onco-busca-morfologia').getByRole('textbox').fill('8500');
    await page.getByTestId('onco-escolher-morfologia-M8500/2').click();
    await page.getByTestId('onco-diagnosticado-em').getByRole('textbox').fill('01/10/2026');
    await escolher(page.getByLabel('Lateralidade'), { rotulo: 'Esquerda' });
    await expect(page.getByTestId('onco-erros-tumor')).toContainText('não combina com o CID');
    await expect(page.getByTestId('onco-gravar-tumor')).toBeDisabled();
    await page.getByTestId('onco-busca-morfologia').getByRole('textbox').fill('8500');
    await page.getByTestId('onco-escolher-morfologia-M8500/3').click();
    await expect(page.getByTestId('onco-erros-tumor')).toHaveCount(0);
    await page.getByTestId('onco-gravar-tumor').click();
    await expect(page.getByTestId('onco-registro-mensagem')).toContainText('Tumor registrado');
    expect(enviados['tumor']).toMatchObject({ cid: 'C50.4', topografia: 'C50.4', morfologia: 'M8500/3' });

    // Estadiamento: M1 sem sítio trava; o estádio IV é sugerido pelo TNM.
    await page.getByTestId('onco-estadiar-7301').click();
    await page.getByTestId('onco-t').getByRole('textbox').fill('cT2');
    await page.getByTestId('onco-n').getByRole('textbox').fill('N1');
    await page.getByTestId('onco-m').getByRole('textbox').fill('M1b');
    await expect(page.getByTestId('onco-erros-estadiamento')).toContainText('sítio de metástase');
    await expect(page.getByTestId('onco-gravar-estadiamento')).toBeDisabled();
    await expect(page.getByTestId('onco-registro')).toContainText('Pelo TNM o estádio é IV');
    await page.getByTestId('onco-metastases').getByRole('textbox').fill('C34.1');
    await escolher(page.getByLabel('Estádio'), 'IV');
    await page.getByTestId('onco-gravar-estadiamento').click();
    await expect(page.getByTestId('onco-tnm-7301')).toContainText('cT2N1M1b · IV');
    expect(enviados['estadiamento']).toMatchObject({ tumor: 7301, metastases: ['C34.1'], estadio: 'IV' });

    // Plano: a dose total é calculada (frações × dose por fração).
    await page.getByTestId('onco-planejar-7301').click();
    await escolher(page.getByLabel('Região irradiada'), { rotulo: 'Mama' });
    await escolher(page.getByLabel('Intenção'), { rotulo: 'Adjuvante' });
    await expect(page.getByTestId('onco-dose-total')).toContainText('5000');
    await page.getByTestId('onco-gravar-plano').click();
    expect(enviados['plano']).toMatchObject({
      tumor: 7301,
      doseTotalCgy: 5000,
      fracoesPrevistas: 25,
      regiao: 'mama',
    });

    // Aprovação: o físico médico vem da lista dos lotados no estabelecimento (nada de digitar id).
    await page.getByTestId('onco-aprovar-7311').click();
    await expect(page.getByTestId('onco-confirmar-aprovacao')).toBeDisabled();
    await escolher(page.getByLabel('Físico médico que conferiu o planejamento'), {
      rotulo: 'FISICO SINTETICO C2073',
    });
    await page.getByTestId('onco-confirmar-aprovacao').click();
    expect(enviados['aprovacao']).toMatchObject({ fisico: 4401, versao: 1 });

    // Sessão: um clique, com a dose da fração já preenchida.
    await page.getByTestId('onco-sessao-7311').click();
    await expect(page.getByTestId('onco-dose-aplicada')).toHaveValue('200');
    await page.getByTestId('onco-confirmar-sessao').click();
    await expect(page.getByTestId('onco-plano-progresso-7311')).toContainText('1 de 25 frações');
    expect(enviados['sessao']).toMatchObject({ desfecho: 'realizada', doseAplicadaCgy: 200 });
    await semViolacaoAxe(page, `/pep/especialidades/oncologia/${REG} (tumor e radioterapia)`);
  });
});
