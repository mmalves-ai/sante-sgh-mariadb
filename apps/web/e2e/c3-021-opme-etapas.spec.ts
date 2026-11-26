// F7 (05-SUP linha 25) @C3-021: as etapas logísticas do OPME (órteses, próteses e materiais especiais) pela tela de
// Suprimentos › OPME. As rotas exigem o banco próprio e o E2E roda com a fonte sintética, então as respostas da API são
// simuladas pelo Playwright com massa SINTÉTICA. O que se prova é a tela: o pedido de compra vai com ano e número, a
// esterilização recusada pela CME (central de material e esterilização) mostra o motivo sem mudar a situação, e a nota
// fiscal vai com ano, mês e número; a situação lida volta da API. O efeito no banco (etapa_solicitacao_opme ligada ao
// pedido_compra, à remessa_consignada, ao recebimento da CME e à nota_entrada) está no contrato de efeito
// apps/api/src/modulos/suprimentos/opme-manipulacao-propria.int.spec.ts.
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

// A gravação no formato do contrato (GravacaoAgenda): ligada, motivo e a permissão por operação.
const gravacao = {
  ligada: true,
  motivo: null,
  operacoes: {
    solicitar: { pode: true, motivo: null },
    autorizar: { pode: true, motivo: null },
    avancar: { pode: true, motivo: null },
  },
};

const vazia = {
  quantidade: null,
  fornecedor: null,
  senha: null,
  guia: null,
  validade: null,
  pedido: null,
  nf: null,
  saida: null,
  lancamento: null,
  consumo: null,
  observacao: null,
  usuario: 'SINT.OPME',
};

test.describe('@C3-021 OPME: pedido, esterilização e nota fiscal ligados aos documentos', () => {
  test('a tela registra as etapas logísticas, mostra a recusa da CME e a situação lida; axe', async ({
    page,
  }) => {
    const estado = {
      situacao: 'autorizada',
      versao: 2,
      etapas: [
        { ...vazia, seq: 1, etapa: 'solicitacao', em: '2026-11-20T09:00', quantidade: 1 },
        {
          ...vazia,
          seq: 2,
          etapa: 'autorizacao',
          em: '2026-11-20T10:00',
          quantidade: 1,
          senha: 'S2',
          guia: 'G2',
        },
      ] as Record<string, unknown>[],
    };
    const corpos: Record<string, unknown>[] = [];
    const solicitacao = () => ({
      id: 31,
      agendamento: 501,
      sala: 3,
      dataHora: '2026-11-27T08:00',
      atendimento: 9001,
      item: 77,
      itemNome: 'PLACA SINTETICA DE TITANIO',
      tuss: '70000014',
      quantidade: 1,
      fornecedor: 7001,
      fornecedorNome: 'FORNECEDOR SINTETICO ALFA',
      justificativa: 'Fixação de fratura com placa (sintético).',
      situacao: estado.situacao,
      autorizada: 1,
      consumida: 0,
      devolvida: 0,
      consignado: true,
      senha: 'S2',
      guia: 'G2',
      validadeSenha: '2026-12-31',
      versao: estado.versao,
      criadoPor: 'SINT.BLOCO',
      criadoEm: '2026-11-20T09:00',
      etapas: estado.etapas,
    });
    await page.route('**/api/suprimentos/opme/cirurgias**', (r) =>
      json(r, {
        data: '2026-11-27',
        truncado: false,
        cirurgias: [],
        locais: [],
        localSugerido: null,
        gravacao,
      }),
    );
    await page.route('**/api/suprimentos/opme/31/etapas', async (r) => {
      const corpo = r.request().postDataJSON() as Record<string, unknown>;
      corpos.push(corpo);
      if (corpo['etapa'] === 'cme')
        return json(
          r,
          {
            type: 'https://sgh.invalid/problemas/cme-em-processamento',
            title: 'Recusado',
            status: 409,
            codigo: 'cme-em-processamento',
            detail: 'O material está na CME e ainda não foi liberado estéril: aguarde a liberação do ciclo.',
          },
          409,
        );
      const seq = estado.etapas.length + 1;
      estado.etapas = [
        ...estado.etapas,
        {
          ...vazia,
          seq,
          etapa: corpo['etapa'],
          em: '2026-11-21T10:00',
          pedido: corpo['pedido'] ?? null,
          nf: corpo['nf'] ?? null,
        },
      ];
      if (corpo['etapa'] === 'pedido') estado.situacao = 'pedido';
      estado.versao += 1;
      return json(r, { ok: true, id: 900 + seq, mensagem: 'Etapa do OPME registrada.' });
    });
    await page.route(/\/api\/suprimentos\/opme(\?.*)?$/, (r) =>
      r.request().method() === 'GET'
        ? json(r, {
            de: '2026-11-20',
            ate: '2026-11-30',
            solicitacoes: [solicitacao()],
            cortada: false,
            gravacao,
          })
        : r.fallback(),
    );

    await entrar(page, 'SINT.OPME');
    await page.goto('/suprimentos/opme?aba=autorizacao');
    await page.getByTestId('opme-de').fill('2026-11-20');
    await page.getByTestId('opme-ate').fill('2026-11-30');
    await expect(page.getByTestId('opme-sol-situacao-31')).toHaveText('Autorizada pela operadora');
    await page.getByTestId('opme-sol-abrir-31').click();
    await expect(page.getByTestId('opme-detalhe')).toBeVisible();

    // O pedido de compra: ano e número.
    await escolher(page.getByTestId('opme-etapa'), 'pedido');
    await page.locator('#opme-pano').fill('2026');
    await page.getByTestId('opme-pedido').fill('970123');
    await semViolacaoAxe(page, '/suprimentos/opme (etapa do pedido de compra)');
    await page.getByTestId('opme-registrar-etapa').click();
    await expect(page.getByTestId('opme-sol-situacao-31')).toHaveText('Pedido de compra feito');
    expect(corpos[0]).toMatchObject({ etapa: 'pedido', pedido: { ano: 2026, doc: 970123 } });

    // A esterilização com o material ainda na CME: o motivo aparece e a situação não muda.
    await escolher(page.getByTestId('opme-etapa'), 'cme');
    await page.getByTestId('opme-registrar-etapa').click();
    await expect(page.getByText(/ainda não foi liberado estéril/)).toBeVisible();
    await expect(page.getByTestId('opme-sol-situacao-31')).toHaveText('Pedido de compra feito');
    expect(corpos[1]).toMatchObject({ etapa: 'cme' });

    // A nota fiscal de entrada: ano, mês e número.
    await escolher(page.getByTestId('opme-etapa'), 'nf');
    await page.getByTestId('opme-nf').fill('970123');
    await page.getByTestId('opme-registrar-etapa').click();
    await expect.poll(() => corpos.length).toBe(3);
    expect(corpos[2]).toMatchObject({ etapa: 'nf', nf: { doc: 970123 } });
    await expect(page.getByTestId('opme-detalhe')).toContainText(/Nota fiscal/);
    await semViolacaoAxe(page, '/suprimentos/opme (etapas registradas)');
  });
});
