// C2-035 (F3.7, 06-FAT linha 12): a conta parcial por período usada no faturamento, pelo caminho da tela. As rotas
// exigem o banco próprio e o E2E roda com a fonte sintética (sem núcleo): as respostas da API são simuladas pelo
// Playwright com massa SINTÉTICA. O que se prova é a tela: itens, valor e guias de cada período, o que ficou sem
// período, o fechamento de fevereiro bloqueado na hora (janeiro ainda aberto), o fechamento de janeiro num clique e a
// reabertura com motivo conferido enquanto se digita. O efeito no banco está no contrato de efeito
// (apps/api/src/modulos/faturamento/conta-periodos-propria.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const CONTA = 7351;
const GUIA = 9351;

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

const periodo = (id: number, inicio: string, fim: string, competencia: string) => ({
  id,
  sequencia: id,
  inicio,
  fim,
  competencia,
  tipoLancamentoId: null,
  tipoLancamento: null,
  versao: 1,
});
const jan = periodo(1, '2026-01-20T08:00:00.000', '2026-01-31T23:59:59.999', '2026-01-01');
const fev = periodo(2, '2026-02-01T00:00:00.000', '2026-02-28T23:59:59.999', '2026-02-01');

async function simular(page: Page, enviados: Record<string, unknown>[]): Promise<void> {
  let janFechado = false;
  await page.route(`**/api/faturamento/contas/${CONTA}/periodos`, (rota) =>
    json(rota, {
      contaId: CONTA,
      situacao: 'aberta',
      editavel: true,
      inicioConta: '2026-01-20T08:00:00.000',
      fimConta: '2026-02-28T23:59:59.999',
      periodos: [jan, fev],
      sugestao: null,
    }),
  );
  const indisponivel = (rota: Route) =>
    json(rota, { type: 'about:blank', title: 'Indisponível', status: 503, codigo: 'indisponivel' }, 503);
  await page.route(`**/api/faturamento/contas/${CONTA}/segurado`, indisponivel);
  await page.route(`**/api/faturamento/contas/${CONTA}/guias-atributos`, indisponivel);
  await page.route(`**/api/faturamento/contas/${CONTA}/faturamento-por-periodo`, (rota) =>
    json(rota, {
      contaId: CONTA,
      situacao: 'aberta',
      editavel: true,
      periodos: [
        {
          ...jan,
          versao: janFechado ? 2 : 1,
          fechado: janFechado,
          fechadoEm: janFechado ? '2026-02-02T09:00:00.000' : null,
          itens: 2,
          valor: 150.5,
          guias: [GUIA],
        },
        { ...fev, fechado: false, fechadoEm: null, itens: 1, valor: 30, guias: [] },
      ],
      semPeriodo: { itens: 1, valor: 5, guias: [] },
      porCompetencia: [
        { competencia: '2026-01-01', itens: 2, valor: 150.5, guias: [GUIA] },
        { competencia: '2026-02-01', itens: 1, valor: 30, guias: [] },
      ],
    }),
  );
  await page.route('**/api/faturamento/periodos-conta/1/fechamento', (rota) => {
    enviados.push({ fechar: rota.request().postDataJSON() });
    janFechado = true;
    return json(rota, { id: 1, competencia: '2026-01-01', itens: 2, valor: 150.5, guias: String(GUIA) });
  });
  await page.route('**/api/faturamento/periodos-conta/1/reabertura', (rota) => {
    enviados.push({ reabrir: rota.request().postDataJSON() });
    janFechado = false;
    return json(rota, { id: 1 });
  });
}

test.describe('conta parcial por período no faturamento @C2-035', () => {
  test.setTimeout(180_000);

  test('itens e guias por período, fechamento em ordem num clique e reabertura com motivo; axe', async ({
    page,
  }) => {
    const enviados: Record<string, unknown>[] = [];
    await entrar(page, 'SINT.TISS');
    await simular(page, enviados);

    await page.goto(`/faturamento/contas/${CONTA}/complementos`);
    const secao = page.getByTestId('pf-faturamento-periodo');
    await expect(secao).toBeVisible();
    await expect(page.getByTestId('pf-periodo-1')).toContainText(String(GUIA));
    await expect(page.getByTestId('pf-periodo-1')).toContainText('150,50');
    await expect(page.getByTestId('pf-sem-periodo')).toContainText('1 item');
    await expect(page.getByTestId('pf-competencias')).toContainText('02/2026');
    await semViolacaoAxe(page, '/faturamento/contas/:id/complementos');

    // Fevereiro não fecha antes de janeiro: o botão vem bloqueado, com o motivo à vista.
    await expect(page.getByTestId('pf-fechar-2')).toBeDisabled();
    await expect(page.getByTestId('pf-periodo-2')).toContainText('anterior');

    // Janeiro fecha num clique.
    await page.getByTestId('pf-fechar-1').click();
    await expect.poll(() => enviados.find((e) => 'fechar' in e)).toBeTruthy();
    expect(enviados.find((e) => 'fechar' in e)?.['fechar']).toMatchObject({ versao: 1 });
    await expect(page.getByTestId('pf-mensagem')).toBeVisible();
    await expect(page.getByTestId('pf-reabrir-1')).toBeVisible();

    // Reabrir pede motivo, conferido enquanto se digita.
    await page.getByTestId('pf-reabrir-1').click();
    await page.getByTestId('pf-motivo').fill('ok');
    await expect(page.getByTestId('pf-confirmar-reabertura')).toBeDisabled();
    await expect(page.getByTestId('pf-erros-reabertura')).toContainText('motivo');
    await page.getByTestId('pf-motivo').fill('item lançado com data errada');
    await page.getByTestId('pf-confirmar-reabertura').click();
    await expect.poll(() => enviados.find((e) => 'reabrir' in e)).toBeTruthy();
    expect(enviados.find((e) => 'reabrir' in e)?.['reabrir']).toMatchObject({
      versao: 2,
      motivo: 'item lançado com data errada',
    });
    await expect(page.getByTestId('pf-fechar-1')).toBeVisible();
  });
});
