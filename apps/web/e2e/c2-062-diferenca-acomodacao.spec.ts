// E2E @C2-062 (F3.4, 04-INT linha 81): diferença de acomodação cobrada do paciente. As rotas
// `/api/internacao/diferenca-acomodacao*` só existem no banco do cliente (na fonte sintética respondem 503), então este
// E2E simula essas rotas com um estado em memória que segue a regra do servidor. O que fica no banco (a cobrança diária
// na conta particular, o estorno ao encerrar e o pacote de diárias) está no contrato de efeito
// apps/api/src/modulos/adt/conta-entrada.int.spec.ts. Aqui se prova o fluxo: a visão por paciente pelo número do
// atendimento, a proposta com a acomodação utilizada já preenchida pela atual e a mesma acomodação recusada na hora (sem
// ida ao servidor), o aceite com a única conta particular já escolhida e o cobrado na lista, e o encerramento. Axe na
// tela. Massa SINTÉTICA.
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

function simular(page: Page) {
  const corpos: Record<string, unknown>[] = [];
  const acomodacoes = [
    { id: 1, rotulo: 'ENFERMARIA FICTICIA' },
    { id: 2, rotulo: 'APARTAMENTO FICTICIO' },
  ];
  const diferencas: Record<string, unknown>[] = [];
  const estado = () => ({
    atendimento: 'FIC-62',
    internacao: 620,
    situacaoInternacao: 'ativa',
    acomodacaoAtual: acomodacoes[1],
    diferencas,
    contasParticulares: [{ id: 77, rotulo: 'FIC-62-2 PARTICULAR FICTICIO' }],
    acomodacoes,
    itens: [{ id: 5, rotulo: 'DIF01 DIFERENCA FICTICIA' }],
    hoje: '2025-05-10',
  });
  return {
    corpos,
    async ligar() {
      await page.route(/\/api\/internacao\/diferenca-acomodacao\?atendimento=/, (rota) =>
        json(rota, estado()),
      );
      await page.route('**/api/internacao/diferenca-acomodacao', async (rota) => {
        const c = rota.request().postDataJSON() as Record<string, number | string | null>;
        corpos.push(c);
        diferencas.push({
          id: 31,
          versao: 1,
          direito: acomodacoes.find((a) => a.id === c['direito']),
          utilizada: acomodacoes.find((a) => a.id === c['utilizada']),
          item: { id: 5, rotulo: 'DIF01 DIFERENCA FICTICIA' },
          valorDiario: c['valorDiario'],
          inicio: c['inicio'],
          fim: c['fim'],
          situacao: 'proposta',
          aceiteEm: null,
          responsavel: null,
          conta: null,
          diasCobrados: 0,
          totalCobrado: 0,
        });
        await json(rota, {
          ok: true,
          mensagem: 'Diferença proposta ao paciente.',
          resultado: { id: 31 },
          repetida: false,
        });
      });
      await page.route('**/api/internacao/diferenca-acomodacao/aceite', async (rota) => {
        const c = rota.request().postDataJSON() as Record<string, unknown>;
        corpos.push(c);
        Object.assign(diferencas[0]!, {
          versao: 2,
          situacao: 'aceita',
          aceiteEm: '2025-05-10 10:00',
          responsavel: c['responsavel'],
          conta: 'FIC-62-2',
          diasCobrados: 3,
          totalCobrado: 240,
        });
        await json(rota, {
          ok: true,
          mensagem: 'Aceite registrado: 3 dia(s) cobrado(s) na conta particular.',
          resultado: { id: 31, lancados: 3, estornados: 0 },
          repetida: false,
        });
      });
      await page.route('**/api/internacao/diferenca-acomodacao/decisao', async (rota) => {
        const c = rota.request().postDataJSON() as Record<string, unknown>;
        corpos.push(c);
        Object.assign(diferencas[0]!, {
          versao: 3,
          situacao: 'encerrada',
          fim: c['fim'],
          diasCobrados: 1,
          totalCobrado: 80,
        });
        await json(rota, {
          ok: true,
          mensagem: 'Diferença atualizada.',
          resultado: { id: 31 },
          repetida: false,
        });
      });
    },
  };
}

test.describe('@C2-062 diferença de acomodação', () => {
  test('proposta validada na hora, aceite com a conta particular e cobrança, encerramento', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const api = simular(page);
    await api.ligar();
    // Segregação: o administrador da plataforma não lê a internação; a recepção da internação (internacao.internacao.ler).
    await entrar(page, 'SINT.INTERNACAO');
    await page.goto('/internacao/diferenca-acomodacao');
    await expect(page.getByTestId('tela-diferenca-acomodacao')).toBeVisible();
    await page.getByTestId('diferenca-atendimento').fill('FIC-62');
    await page.getByTestId('diferenca-abrir').click();
    await expect(page.getByTestId('diferenca-internacao')).toContainText('APARTAMENTO FICTICIO');
    await semViolacaoAxe(page, '/internacao/diferenca-acomodacao');

    // A utilizada já vem com a atual (apartamento); escolher a mesma como direito é recusado sem ir ao servidor.
    await escolher(page.getByTestId('diferenca-direito'), '2');
    await expect(page.getByTestId('diferenca-problemas')).toContainText('mesma de direito');
    await expect(page.getByTestId('diferenca-propor')).toBeDisabled();
    await escolher(page.getByTestId('diferenca-direito'), '1');
    await expect(page.getByTestId('diferenca-problemas')).toHaveCount(0);
    await escolher(page.getByTestId('diferenca-item'), '5');
    await page.getByTestId('diferenca-valor').fill('80');
    await page.getByTestId('diferenca-inicio').fill('2025-05-08');
    await page.getByTestId('diferenca-propor').click();
    await expect(page.getByTestId('diferenca-aviso')).toContainText('proposta');
    expect(api.corpos[0]).toMatchObject({
      internacao: 620,
      direito: 1,
      utilizada: 2,
      item: 5,
      valorDiario: 80,
      inicio: '2025-05-08',
    });
    await expect(page.getByTestId('diferenca-situacao-31')).toContainText('Proposta');

    // O aceite: a única conta particular já vem escolhida; sem o nome de quem aceita o botão fica desligado.
    await expect(page.getByTestId('diferenca-aceitar')).toBeDisabled();
    await page.getByTestId('diferenca-responsavel').fill('RESPONSAVEL FICTICIO');
    await page.getByTestId('diferenca-aceitar').click();
    await expect(page.getByTestId('diferenca-aviso')).toContainText('3 dia(s)');
    expect(api.corpos[1]).toMatchObject({
      diferenca: 31,
      versao: 1,
      responsavel: 'RESPONSAVEL FICTICIO',
      conta: 77,
    });
    await expect(page.getByTestId('diferenca-situacao-31')).toContainText('Aceita');
    await expect(page.getByTestId('diferenca-cobrado-31')).toContainText('3 dia(s)');

    // Encerrar no primeiro dia: os dias seguintes deixam de ser cobrados.
    await page.getByTestId('diferenca-fim-encerrar').fill('2025-05-08');
    await page.getByTestId('diferenca-encerrar').click();
    await expect(page.getByTestId('diferenca-situacao-31')).toContainText('Encerrada');
    expect(api.corpos[2]).toMatchObject({ diferenca: 31, versao: 2, acao: 'encerrar', fim: '2025-05-08' });
    await expect(page.getByTestId('diferenca-cobrado-31')).toContainText('1 dia(s)');
    await semViolacaoAxe(page, '/internacao/diferenca-acomodacao');
    expect(externas).toEqual([]);
  });
});
