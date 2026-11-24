// E2E @PLATAFORMA (obra carga-painel, ADR 0010): a tela "Carga e sincronismo" do painel técnico. A plataforma entra
// com acesso total em nome de um usuário sintético, abre a tela pelo menu Técnico e vê o andamento de uma carga com a
// barra segmentada (gravado, recusado, restante), o indicador de erros e a tabela atual; pausa e vê o Retomar. As
// respostas da API de carga são simuladas pela página (o serviço do conector não roda no E2E): dados sintéticos.
import { expect, test, type Page, type Route } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#Plataforma2026';
const B = '/api/plataforma/carga';

const execucao = (estado: string, o: Record<string, unknown> = {}) => ({
  id: 21,
  tipo: 'importar',
  modo: 'completa',
  estado,
  etapa: 'onda 1 de 3',
  percentual: 30,
  motivoFalha: null,
  solicitadoEm: '2026-11-24T10:00:00.000Z',
  iniciadoEm: '2026-11-24T10:00:01.000Z',
  concluidoEm: estado === 'pausada' ? '2026-11-24T10:10:00.000Z' : null,
  batimentoEm: '2026-11-24T10:05:00.000Z',
  pausaSolicitadaEm: null,
  temLog: true,
  ...o,
});
const progresso = {
  tabelaAtual: 'atendimento',
  tabelaOrigemLinhas: 1000,
  tabelaProcessadas: 400,
  onda: 1,
  ondas: 3,
  tabelasFeitas: 4,
  tabelasTotal: 12,
  linhasTotal: 2000,
  linhasProcessadas: 600,
  gravadas: 500,
  puladasIguais: 40,
  recusadas: 60,
  pendenciasAviso: 2,
  recusasPorTabela: [{ tabela: 'atendimento', recusadas: 60 }],
  atualizadoEm: '2026-11-24T10:05:00.000Z',
};

async function simularApi(page: Page): Promise<void> {
  let pausada = false;
  const json = (route: Route, corpo: unknown) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpo) });
  await page.route(`**${B}/conectores`, (r) =>
    json(r, {
      conectores: [
        {
          codigo: 'sintetico',
          nome: 'Hospital sintético',
          origem: {
            tipo: 'firebird_servidor',
            nomeExibicao: 'Base sintética',
            endereco: 'fb-sintetico:3050/base_sintetica',
            senhaDefinida: true,
          },
          ultimaExecucao: execucao(pausada ? 'pausada' : 'gravando'),
        },
      ],
    }),
  );
  await page.route(`**${B}/clientes/sintetico/carga/pausar`, (r) => {
    pausada = true;
    return json(r, { ok: true });
  });
  await page.route(`**${B}/clientes/sintetico/carga`, (r) =>
    json(r, {
      codigo: 'sintetico',
      execucao: execucao(pausada ? 'pausada' : 'gravando'),
      progresso,
      batimentoAtrasado: false,
      conciliacaoCarga: null,
      acoes: { iniciar: pausada, pausar: !pausada, retomar: pausada },
    }),
  );
}

async function entrarComoTotal(page: Page): Promise<void> {
  await page.goto('/plataforma/entrar');
  await page.getByTestId('plataforma-email').fill('plataforma@sintetico.invalid');
  await page.getByTestId('plataforma-senha').fill(SENHA);
  await page.getByTestId('plataforma-acessar').click();
  await expect(page.getByTestId('plataforma-inicio')).toBeVisible();
  await expect(page.getByTestId('link-carga')).toBeVisible();
  await page.getByTestId('abrir-como').click();
  await page.getByTestId('como-modo-total').check();
  await escolher(page.getByTestId('como-grupo'), 'SINTETICO');
  await escolher(page.getByTestId('como-usuario'), 'SINT.ADMIN');
  await page.getByTestId('como-abrir').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Carga e sincronismo @PLATAFORMA', () => {
  test('andamento com barra segmentada e erros; pausar oferece Retomar', async ({ page }) => {
    await simularApi(page);
    await entrarComoTotal(page);
    await page.goto('/plataforma/carga');
    await expect(page.getByRole('heading', { name: 'Carga e sincronismo' })).toBeVisible();
    await expect(page.getByTestId('carga-origem-endereco')).toHaveText('fb-sintetico:3050/base_sintetica');
    const barra = page.getByRole('progressbar', { name: 'Evolução da carga' });
    await expect(barra).toHaveAttribute('aria-valuenow', '30');
    await expect(page.getByTestId('carga-tabela-atual')).toContainText('atendimento');
    await expect(page.getByTestId('carga-erros')).toContainText('60 recusadas (3% do total)');
    await expect(page.getByTestId('carga-onda')).toHaveText('Onda 1 de 3');
    await expect(page.getByTestId('carga-log')).toHaveAttribute(
      'href',
      `${B}/clientes/sintetico/carga/21/log`,
    );
    await semViolacaoAxe(page, 'carga-sincronismo');
    await page.getByTestId('carga-pausar').click();
    await expect(page.getByTestId('carga-pausada')).toBeVisible();
    await expect(page.getByTestId('carga-retomar')).toBeEnabled();
  });
});
