// E2E @C1-084 (F7, 07-FIN linha 92): a conta corrente do paciente particular pelo caminho da tela. O operador do caixa
// recebe o adiantamento, usa o saldo na conta em aberto com um clique, estorna o uso com motivo e PEDE a devolução do
// disponível (o pedido reserva o saldo e não mostra "aprovar" a quem pediu); outra pessoa (financeiro) abre a mesma
// conta corrente, vê o pedido em aberto e aprova. As rotas exigem o banco próprio e o E2E roda com a fonte sintética:
// as respostas são simuladas pelo Playwright com massa SINTÉTICA, no contrato do servidor. O efeito no banco está em
// apps/api/src/modulos/faturamento/particular-adiantamento-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 8401;
const CONTA = 8402;

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

/** O estado simulado do servidor: adiantamentos, usos, pedidos de devolução e a conta em aberto. */
function simular(page: Page) {
  const st = {
    adiantamentos: [] as { id: number; valor: number; saldo: number }[],
    usos: [] as {
      id: number;
      adiantamento: number;
      valor: number;
      estornado: boolean;
      motivo: string | null;
    }[],
    pedidos: [] as { id: number; adiantamento: number; valor: number; motivo: string; situacao: string }[],
    corpos: [] as { rota: string; corpo: Record<string, unknown> }[],
  };
  const reservado = (a: number) =>
    st.pedidos
      .filter((p) => p.adiantamento === a && p.situacao === 'solicitada')
      .reduce((t, p) => t + p.valor, 0);
  const aplicado = () => st.usos.filter((u) => !u.estornado).reduce((t, u) => t + u.valor, 0);
  const contaCorrente = () => ({
    paciente: { id: PACIENTE, nome: 'PACIENTE SINTETICO C1084' },
    saldo: st.adiantamentos.reduce((t, a) => t + a.saldo, 0),
    adiantamentos: st.adiantamentos.map((a) => ({
      id: a.id,
      numero: `AD-${a.id}`,
      tipo: 'adiantamento',
      recebidoEm: '2026-03-15T10:00:00.000Z',
      valor: a.valor,
      saldo: a.saldo,
      situacao: a.saldo === a.valor ? 'ativo' : a.saldo > 0 ? 'aplicado_parcial' : 'devolvido',
      forma: 'dinheiro',
      urgencia: false,
      voluntaria: false,
      disponivel: Math.max(0, a.saldo - reservado(a.id)),
    })),
    devolucoesPendentes: st.pedidos
      .filter((p) => p.situacao === 'solicitada')
      .map((p) => ({
        id: p.id,
        adiantamento: p.adiantamento,
        numero: `AD-${p.adiantamento}`,
        valor: p.valor,
        forma: 'pix',
        favorecido: 'PACIENTE SINTETICO C1084',
        motivo: p.motivo,
        solicitadoEm: '2026-03-15T11:00:00.000Z',
        solicitanteId: 999_001,
        solicitante: 'OPERADOR SINTETICO',
      })),
    aplicacoes: st.usos.map((u) => ({
      id: u.id,
      adiantamento: u.adiantamento,
      contaId: CONTA,
      conta: 'C-8402',
      aplicadoEm: '2026-03-15T10:30:00.000Z',
      valor: u.valor,
      estornado: u.estornado,
      motivoEstorno: u.motivo,
    })),
    contasAbertas: [
      { id: CONTA, numero: 'C-8402', situacao: 'aberta', total: 300, devido: Math.max(0, 300 - aplicado()) },
    ],
    atendimentos: [],
    extrato: { linhas: [], creditos: 0, debitos: 0, saldo: 0 },
  });
  const corpo = (r: Route) => JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>;
  return {
    st,
    async instalar() {
      await page.route(`**/api/faturamento/pacientes/${PACIENTE}/conta-corrente`, (r) =>
        json(r, contaCorrente()),
      );
      await page.route('**/api/faturamento/adiantamentos', (r) => {
        const c = corpo(r);
        st.corpos.push({ rota: 'receber', corpo: c });
        const id = 8410 + st.adiantamentos.length;
        st.adiantamentos.push({ id, valor: Number(c['valor']), saldo: Number(c['valor']) });
        return json(r, { id, numero: `AD-${id}` }, 201);
      });
      await page.route(`**/api/faturamento/contas/${CONTA}/adiantamentos`, (r) => {
        const a = st.adiantamentos[0]!;
        const valor = Math.min(a.saldo, 300 - aplicado());
        a.saldo -= valor;
        st.usos.push({
          id: 8420 + st.usos.length,
          adiantamento: a.id,
          valor,
          estornado: false,
          motivo: null,
        });
        return json(r, { id: 8420, total: valor }, 201);
      });
      await page.route('**/api/faturamento/aplicacoes-adiantamento/*/estorno', (r) => {
        const c = corpo(r);
        const u = st.usos.find((x) => !x.estornado)!;
        u.estornado = true;
        u.motivo = String(c['motivo']);
        st.adiantamentos.find((a) => a.id === u.adiantamento)!.saldo += u.valor;
        return json(r, { id: u.id, saldo: 0 });
      });
      await page.route('**/api/faturamento/adiantamentos/*/devolucoes', (r) => {
        const c = corpo(r);
        st.corpos.push({ rota: 'devolver', corpo: c });
        const adiantamento = Number(r.request().url().split('/').at(-2));
        st.pedidos.push({
          id: 8430 + st.pedidos.length,
          adiantamento,
          valor: Number(c['valor']),
          motivo: String(c['motivo']),
          situacao: 'solicitada',
        });
        return json(r, { id: 8430, situacao: 'solicitada', disponivel: 0 }, 201);
      });
      await page.route('**/api/faturamento/devolucoes-adiantamento/*/aprovacao', (r) => {
        const id = Number(r.request().url().split('/').at(-2));
        const p = st.pedidos.find((x) => x.id === id)!;
        p.situacao = 'devolvida';
        st.adiantamentos.find((a) => a.id === p.adiantamento)!.saldo -= p.valor;
        return json(r, { id, saldo: 0, movimento: null });
      });
    },
  };
}

test.describe('@C1-084 conta corrente do paciente: adiantamento, uso, estorno e devolução por duas pessoas', () => {
  test('o caixa recebe, usa, estorna e pede a devolução; o financeiro aprova', async ({ page }) => {
    const s = simular(page);
    await s.instalar();
    await entrar(page, 'SINT.CAIXA');
    await page.goto(`/faturamento/pacientes/${PACIENTE}/conta-corrente`);
    await expect(page.getByTestId('tela-conta-corrente')).toBeVisible();

    // Recebe 500 em dinheiro (a validação do domínio libera o botão na hora).
    await escolher(page.getByTestId('cc-tipo'), 'adiantamento');
    await page.getByTestId('cc-valor').fill('500');
    await escolher(page.getByTestId('cc-forma'), 'dinheiro');
    await page.getByTestId('cc-receber').click();
    await expect(page.getByTestId('cc-aviso')).toBeVisible();
    await expect(page.getByTestId('cc-saldo')).toContainText('500');
    expect(s.st.corpos[0]).toMatchObject({ rota: 'receber', corpo: { valor: 500, pacienteId: PACIENTE } });

    // Usa o saldo na conta com um clique (300 devidos) e estorna o uso com motivo.
    await page.getByTestId(`cc-usar-${CONTA}`).click();
    await expect(page.getByTestId('cc-saldo')).toContainText('200');
    page.once('dialog', (d) => void d.accept('item retirado'));
    await page.getByTestId('cc-aplicacoes').getByRole('button').first().click();
    await expect(page.getByTestId('cc-aplicacoes')).toContainText('item retirado');
    await expect(page.getByTestId('cc-saldo')).toContainText('500');

    // Pede a devolução de 200 por Pix, com a conta aberta confirmada: vira pedido e reserva o disponível.
    await page.getByTestId('cc-devolver-8410').click();
    await expect(page.getByTestId('cc-dev-disponivel')).toContainText('500');
    await page.getByTestId('cc-dev-valor').fill('200');
    await escolher(page.getByTestId('cc-dev-forma'), 'pix');
    await page.getByTestId('cc-dev-chave').fill('chave-sintetica');
    await page.getByTestId('cc-dev-motivo').fill('alta');
    await page.getByTestId('cc-dev-confirmar').check();
    await page.getByTestId('cc-dev-registrar').click();
    await expect(page.getByTestId('cc-pendente-8430')).toBeVisible();
    expect(s.st.corpos[1]).toMatchObject({
      rota: 'devolver',
      corpo: { valor: 200, forma: 'pix', chavePix: 'chave-sintetica', confirmarContaAberta: true },
    });
    // O operador do caixa não aprova (sem a permissão do financeiro).
    await expect(page.getByTestId('cc-aprovar-8430')).toHaveCount(0);
    await semViolacaoAxe(page, 'conta corrente do paciente');

    // Outra pessoa, do financeiro, abre a conta corrente e aprova o pedido.
    await entrar(page, 'SINT.FIN.APROVA');
    await page.goto(`/faturamento/pacientes/${PACIENTE}/conta-corrente`);
    await page.getByTestId('cc-aprovar-8430').click();
    await expect(page.getByTestId('cc-aviso')).toBeVisible();
    await expect(page.getByTestId('cc-pendentes')).toHaveCount(0);
    await expect(page.getByTestId('cc-saldo')).toContainText('300');
    expect(s.st.pedidos[0]?.situacao).toBe('devolvida');
  });

  test('o item do menu abre a busca do paciente', async ({ page }) => {
    await entrar(page, 'SINT.CAIXA');
    await page.goto('/faturamento/conta-corrente');
    await expect(page.getByTestId('cc-busca')).toBeVisible();
  });
});
