// E2E @F3.6-03 (F3.6, 05-SUP linha 6): a lista de separação da requisição pelo caminho da tela. O almoxarife grava a
// requisição (sessão real, porta em memória), vê a requisição na fila, abre a "Lista de separação" pelo link da própria
// requisição e confere: o cabeçalho (local, destino, urgência), as linhas na ordem do endereço no armazém com o item
// sem endereço no fim, os lotes sugeridos pela validade, o saldo, a falta só onde o saldo não cobre e o aviso do total
// de faltas; marca o que já separou (só na tela) e imprime pelo navegador. A requisição cancelada e a já atendida
// mostram a recusa do servidor em português, sem tabela (a lista só sai para requisição atendível); a requisição
// atendível sem item pendente mostra "nada pendente a separar".
// A lista lê a requisição, os saldos e os lotes do banco próprio, que a fonte sintética do E2E não tem (sem banco a
// rota responde 503): a resposta de `GET /api/suprimentos/cadastro/requisicoes/:id/separacao` é simulada pelo
// Playwright com massa SINTÉTICA no mesmo formato e no vocabulário do servidor (situação `autorizada`,
// `atendida_parcial`; recusa 409 `separacao-requisicao-nao-atendivel`). A regra (`montarSeparacao`, `conferirRequisicaoSeparavel`) está em
// packages/dominio-suprimentos/src/cadastro-estoque.spec.ts e o que sai do banco (só o que falta, endereço do
// local, lotes válidos e liberados, a falta, a recusa da não atendível) em
// apps/api/src/modulos/suprimentos/cadastro-estoque-porta-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { ORIGEM, semViolacaoAxe } from './ajuda.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** POST da página com o CSRF da sessão e a Idempotency-Key, como a tela faz. */
async function postar(page: Page, url: string, data: unknown) {
  const csrf = (await page.context().cookies(ORIGEM)).find((c) => c.name === 'sgh_csrf')?.value ?? '';
  return page.request.post(url, {
    data: data as Record<string, unknown>,
    headers: {
      'x-csrf': csrf,
      'idempotency-key': `e2e-f3603-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
  });
}

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({
    status,
    contentType: status >= 400 ? 'application/problem+json' : 'application/json',
    body: JSON.stringify(corpo),
  });

const SEPARACAO = /\/api\/suprimentos\/cadastro\/requisicoes\/(\d+)\/separacao(\?.*)?$/;
const CANCELADA = 990001;
const ATENDIDA = 990002;
const SEM_PENDENTE = 990003;

/** A recusa de `conferirRequisicaoSeparavel`, como o servidor a devolve (409). */
const recusaNaoAtendivel = (situacao: string) => ({
  type: 'about:blank',
  title: 'Recusa de negócio',
  status: 409,
  codigo: 'separacao-requisicao-nao-atendivel',
  detail: `A requisição está ${situacao}: não há o que separar.`,
});

const cabecalho = (requisicao: number, numero: number, situacao: string) => ({
  requisicao,
  numero,
  situacao,
  tipo: 'setor',
  local: { id: 10, codigo: 'ALMOX-SINT', nome: 'ALMOXARIFADO SINTETICO' },
  destino: 'POSTO SINTETICO 2',
  solicitadoEm: '2026-03-15T08:05:00',
  urgente: true,
  geradaEm: '2026-03-15T08:10:00',
});

// Já na ordem em que o servidor devolve: pelo endereço preferencial, o item sem endereço no fim.
const linhas = [
  {
    sequencia: 2,
    item: 5002,
    nome: 'SERINGA SINTETICA 10 ML',
    unidade: 'UN',
    aSeparar: 30,
    endereco: 'A-01-02',
    outrosEnderecos: ['C-07-01'],
    lotes: [
      { lote: 'LS-SINT-1', validade: '2026-06-30', quantidade: 20 },
      { lote: 'LS-SINT-2', validade: '2026-12-31', quantidade: 10 },
    ],
    saldo: 80,
    falta: 0,
  },
  {
    sequencia: 1,
    item: 5001,
    nome: 'DIPIRONA SINTETICA 500 MG',
    unidade: 'CP',
    aSeparar: 12,
    endereco: 'B-03-01',
    outrosEnderecos: [],
    lotes: [{ lote: 'LD-SINT-9', validade: '2026-09-30', quantidade: 8 }],
    saldo: 8,
    falta: 4,
  },
  {
    sequencia: 3,
    item: 5003,
    nome: 'LUVA SINTETICA M',
    unidade: 'PAR',
    aSeparar: 5,
    endereco: null,
    outrosEnderecos: [],
    lotes: [],
    saldo: 40,
    falta: 0,
  },
];

test.describe('Lista de separação da requisição @F3.6-03 @fase3', () => {
  test.setTimeout(180_000);

  test('da fila de requisições à lista: ordem do endereço, lotes pela validade, falta, marcar e imprimir; axe', async ({
    page,
  }) => {
    const pedidas: number[] = [];
    await page.route(SEPARACAO, (rota) => {
      expect(rota.request().method()).toBe('GET');
      const id = Number(SEPARACAO.exec(new URL(rota.request().url()).pathname)?.[1]);
      pedidas.push(id);
      return json(rota, { ...cabecalho(id, 4711, 'autorizada'), linhas, totalFalta: 1 });
    });
    await page.addInitScript(() => {
      (globalThis as unknown as { impressoes: number }).impressoes = 0;
      globalThis.print = () => {
        (globalThis as unknown as { impressoes: number }).impressoes += 1;
      };
    });

    await entrar(page, 'SINT.ALMOXARIFE');
    const r = await postar(page, '/api/suprimentos/requisicoes', {
      destino: 2,
      local: 10,
      centroCusto: 101,
      localConsumo: 11,
      itens: [{ item: 5001, quantidade: 1 }],
    });
    expect(r.status(), await r.text()).toBe(200);
    const doc = (await r.json()).ids.doc as number;

    // Um clique a partir da requisição na fila: o link leva o id da própria requisição.
    await page.goto('/suprimentos/requisicoes');
    const atalho = page.getByTestId(`separacao-${doc}`).first();
    await expect(atalho).toHaveText('Lista de separação');
    await atalho.click();
    await expect(page).toHaveURL(/\/suprimentos\/requisicoes\/\d+\/separacao$/);
    const tela = page.getByTestId('tela-suprimentos-separacao');
    await expect(tela.getByRole('heading', { level: 1 })).toHaveText('Lista de separação da requisição 4711');
    const idDaRota = Number(/requisicoes\/(\d+)\/separacao/.exec(page.url())?.[1]);
    expect(pedidas).toContain(idDaRota);

    const cab = tela.getByTestId('separacao-cabecalho');
    await expect(cab).toContainText('ALMOX-SINT · ALMOXARIFADO SINTETICO');
    await expect(cab).toContainText('Destino: POSTO SINTETICO 2');
    await expect(cab).toContainText('2026-03-15 08:05');
    await expect(cab).toContainText('Urgente');
    await expect(cab).toContainText('Gerada em 2026-03-15 08:10');
    await expect(tela.getByTestId('separacao-faltas')).toHaveText('1 item(ns) sem saldo suficiente.');

    // A ordem é a do caminho no armazém (a do servidor), o sem endereço no fim.
    const corpo = tela.getByTestId('separacao-linhas').locator('tbody tr');
    await expect(corpo).toHaveCount(3);
    await expect(corpo.nth(0)).toHaveAttribute('data-testid', 'separacao-item-5002');
    await expect(corpo.nth(1)).toHaveAttribute('data-testid', 'separacao-item-5001');
    await expect(corpo.nth(2)).toHaveAttribute('data-testid', 'separacao-item-5003');
    await expect(corpo.nth(0)).toContainText('A-01-02');
    await expect(corpo.nth(0)).toContainText('(C-07-01)');
    await expect(corpo.nth(0)).toContainText('LS-SINT-1 (2026-06-30)');
    await expect(corpo.nth(0)).toContainText('LS-SINT-2 (2026-12-31)');
    await expect(corpo.nth(2)).toContainText('Sem endereço');
    // A falta só aparece onde o saldo não cobre.
    await expect(tela.getByTestId('separacao-falta-5001').locator('strong')).toHaveText(/4/);
    await expect(tela.getByTestId('separacao-falta-5002').locator('strong')).toHaveCount(0);
    await expect(tela.getByTestId('separacao-falta-5003').locator('strong')).toHaveCount(0);

    // O separador marca o que já pôs na caixa: só na tela, nada vai ao servidor.
    const gravacoes: string[] = [];
    page.on('request', (q) => {
      if (q.method() !== 'GET' && q.url().includes('/api/')) gravacoes.push(`${q.method()} ${q.url()}`);
    });
    await tela.getByLabel('Separado SERINGA SINTETICA 10 ML').check();
    await expect(corpo.nth(0)).toHaveClass(/feito/);
    await expect(corpo.nth(1)).not.toHaveClass(/feito/);
    await tela.getByLabel('Separado SERINGA SINTETICA 10 ML').uncheck();
    await expect(corpo.nth(0)).not.toHaveClass(/feito/);

    await tela.getByTestId('separacao-imprimir').click();
    expect(await page.evaluate(() => (globalThis as unknown as { impressoes: number }).impressoes)).toBe(1);
    expect(gravacoes).toEqual([]);

    await expect(tela).not.toContainText(/spdata|legado/i);
    await semViolacaoAxe(page, '/suprimentos/requisicoes/:id/separacao');
  });

  test('requisição cancelada e a já atendida mostram a recusa do servidor; a atendível sem item pendente, nada pendente', async ({
    page,
  }) => {
    await page.route(SEPARACAO, (rota) => {
      const id = Number(SEPARACAO.exec(new URL(rota.request().url()).pathname)?.[1]);
      if (id === CANCELADA) return json(rota, recusaNaoAtendivel('cancelada'), 409);
      if (id === ATENDIDA) return json(rota, recusaNaoAtendivel('atendida'), 409);
      return json(rota, {
        ...cabecalho(id, 4712, 'atendida_parcial'),
        urgente: false,
        linhas: [],
        totalFalta: 0,
      });
    });
    await entrar(page, 'SINT.ALMOXARIFE');

    await page.goto(`/suprimentos/requisicoes/${CANCELADA}/separacao`);
    const tela = page.getByTestId('tela-suprimentos-separacao');
    await expect(tela.getByTestId('recusa-suprimentos')).toContainText(
      'A requisição está cancelada: não há o que separar.',
    );
    await expect(tela.getByTestId('separacao-linhas')).toHaveCount(0);
    await expect(tela.getByTestId('separacao-imprimir')).toHaveCount(0);

    // A atendida não é atendível: a mesma recusa, nunca uma lista vazia.
    await page.goto(`/suprimentos/requisicoes/${ATENDIDA}/separacao`);
    await expect(tela.getByTestId('recusa-suprimentos')).toContainText(
      'A requisição está atendida: não há o que separar.',
    );
    await expect(tela.getByTestId('separacao-linhas')).toHaveCount(0);
    await expect(tela.getByTestId('separacao-imprimir')).toHaveCount(0);

    // Atendida em parte e o que restava foi cancelado: a lista sai, sem linha pendente.
    await page.goto(`/suprimentos/requisicoes/${SEM_PENDENTE}/separacao`);
    await expect(tela.getByRole('heading', { level: 1 })).toHaveText('Lista de separação da requisição 4712');
    await expect(tela).toContainText('Nada pendente a separar nesta requisição.');
    await expect(tela.getByTestId('recusa-suprimentos')).toHaveCount(0);
    await expect(tela.getByTestId('separacao-faltas')).toHaveCount(0);
    await expect(tela.getByTestId('separacao-cabecalho')).not.toContainText('Urgente');
    await expect(tela.getByTestId('separacao-linhas')).toHaveCount(0);
  });
});
