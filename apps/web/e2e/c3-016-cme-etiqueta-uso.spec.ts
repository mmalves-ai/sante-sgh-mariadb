// F7 (04-CME linha 118) @C3-016: rastreabilidade do pacote estéril pela etiqueta, pelo caminho da tela da CME. As
// rotas exigem o banco próprio e o E2E roda com a fonte sintética, então as respostas da API são simuladas pelo
// Playwright com massa SINTÉTICA. O que se prova é a tela: a etiqueta incompleta não oferece a impressão; a completa
// gera o ZPL do pacote; a abertura no paciente só se registra com a embalagem conferida e manda o indicador externo;
// a baixa do uso aparece no rastreio. O efeito no banco (uso_pacote_esteril com paciente, atendimento e conferência)
// está no contrato de efeito apps/api/src/modulos/cirurgia/cme-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const ETIQUETA = 'PE00100000061';

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

interface Estado {
  faltas: string[];
  usado: boolean;
  corpoUso: unknown;
}

const PAINEL = {
  setores: [],
  unidades: [],
  agendamentos: [],
  caixas: [],
  equipamentos: [],
  metodos: [],
  pacotes: [],
  ciclos: [],
  solicitacoes: [],
};

function rastreio(e: Estado) {
  return {
    pacote: {
      id: 61,
      etiqueta: ETIQUETA,
      caixa: 41,
      produto: 'CAIXA SINTETICA',
      situacao: e.usado ? 'usado' : 'distribuido',
      ciclo: 71,
      lote: e.faltas.includes('lote') ? null : 'LOTE-SINT-1',
      validade: '2026-12-25',
      versao: 1,
      esterilizadoEm: '2026-11-25T10:00:00',
      preparadoPor: 'USUARIO SINTETICO',
      metodo: 'VAPOR SINTETICO',
      faltasEtiqueta: e.faltas,
    },
    ciclo: null,
    cirurgias: [
      {
        movimento: 101,
        agendamento: 81,
        agendamentoNumero: 'AG-SINT-1',
        atendimento: 111,
        paciente: 121,
        pacienteNome: 'PACIENTE SINTETICO',
        entregueEm: '2026-11-25T11:00:00',
        usado: e.usado,
      },
    ],
    usos: e.usado
      ? [
          {
            id: 131,
            usadoEm: '2026-11-25T12:00:00',
            paciente: 121,
            atendimento: 111,
            atoCirurgico: null,
            integridadeConferida: true,
            indicadorExternoOk: true,
          },
        ]
      : [],
  };
}

async function simular(page: Page, e: Estado): Promise<void> {
  await page.route('**/api/cirurgia/cme', (r) => json(r, PAINEL));
  await page.route(/\/api\/cirurgia\/cme\/rastreio\?/, (r) => json(r, rastreio(e)));
  await page.route(/\/api\/cirurgia\/cme\/pacotes\/etiqueta\?/, (r) =>
    json(r, {
      codigo: ETIQUETA,
      zpl: `^XA\n^FO10,112^BCN,70,N,N,N^FD${ETIQUETA}^FS\n^XZ\n`,
      sha256: 'a'.repeat(64),
    }),
  );
  await page.route('**/api/cirurgia/cme/pacotes/61/usar', (r) => {
    e.corpoUso = r.request().postDataJSON();
    e.usado = true;
    return json(r, { pacote: 61, uso: 131 });
  });
}

test.describe('@C3-016 etiqueta e baixa do uso do pacote estéril (04-CME linha 118)', () => {
  test('etiqueta incompleta não imprime; a completa gera o ZPL', async ({ page }) => {
    const e: Estado = { faltas: ['lote'], usado: false, corpoUso: null };
    await simular(page, e);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cirurgia/cme');
    await page.getByTestId('cme-etiqueta').fill(ETIQUETA);
    await page.getByTestId('cme-rastrear').click();
    await expect(page.getByTestId('cme-rastreio-etiqueta')).toContainText('lote');
    await expect(page.getByTestId('cme-etiqueta-zpl')).toHaveCount(0);

    e.faltas = [];
    await page.getByTestId('cme-rastrear').click();
    await page.getByTestId('cme-etiqueta-zpl').click();
    await expect(page.getByTestId('cme-zpl')).toContainText(ETIQUETA);
    await semViolacaoAxe(page, 'etiqueta do pacote estéril');
  });

  test('a abertura no paciente exige a embalagem conferida e grava a baixa do uso', async ({ page }) => {
    const e: Estado = { faltas: [], usado: false, corpoUso: null };
    await simular(page, e);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cirurgia/cme');
    await page.getByTestId('cme-etiqueta').fill(ETIQUETA);
    await page.getByTestId('cme-rastrear').click();
    await expect(page.getByTestId('cme-usar')).toBeDisabled();
    await page.getByTestId('cme-integridade').check();
    await escolher(page.getByTestId('cme-indicador'), { rotulo: 'Embalagem sem indicador externo' });
    await escolher(page.getByTestId('cme-indicador'), { rotulo: 'Virou' });
    await page.getByTestId('cme-usar').click();
    await expect(page.getByTestId('cme-rastreio-situacao')).toHaveText('Usado');
    expect(e.corpoUso).toEqual({ agendamento: 81, integridadeConferida: true, indicadorExternoOk: true });
    await expect(page.getByTestId('cme-usos')).toContainText('atendimento 111');
    await semViolacaoAxe(page, 'baixa do uso do pacote estéril');
  });
});
