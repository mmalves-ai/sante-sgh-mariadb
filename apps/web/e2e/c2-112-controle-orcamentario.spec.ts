// E2E @C2-112 (F8, 07-FIN L130): controle orçamentário na compra e no pagamento pela tela
// /financeiro/orcamento/controle, aberta pelo orçamento empresarial. Quem edita o orçamento cria a regra (a dispensa sem
// recorte aparece na hora e trava o botão), reserva o pedido de compra vendo o saldo e a regra antes de gravar (o
// alerta pede ciência), tenta o título que a regra bloqueia e pede a exceção justificada ali mesmo; quem aprova decide a
// exceção (a pessoa que pediu não vê os botões); a reserva recebe a nota final e outra é liberada com o motivo. As
// rotas /api/financeiro/controle-orcamentario exigem o banco próprio e o E2E roda com a fonte sintética: as respostas
// são simuladas pelo Playwright com massa SINTÉTICA. O efeito no banco está em
// apps/api/src/modulos/orcamento/controle-orcamentario-propria.int.spec.ts.
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

const regra = (acao: string) => ({
  id: 5,
  versao: 1,
  acao,
  tipoDocumento: 'todos',
  planoOrcamentario: null,
  versaoOrcamento: null,
  centroCusto: 7,
  contaOrcamentaria: null,
  naturezaFinanceira: null,
  tolerancia: 0,
  periodo: 'mensal',
  prioridade: 10,
  vigenciaInicio: '2027-01-01',
  vigenciaFim: null,
  ativo: true,
});
const reserva = (id: number, situacao: string, aberto: number) => ({
  id,
  versao: 1,
  numero: `RPC${id}-1`,
  tipoDocumento: 'pedido_compra',
  documento: 41,
  documentoNumero: '2027/41',
  linha: 9,
  centro: 'Centro sintético A',
  competencia: '2027-03-01',
  reservado: 800,
  consumido: situacao === 'consumida' ? 800 : 0,
  liberado: 0,
  aberto,
  excedeuSaldo: false,
  situacao,
  motivoLiberacao: null,
});
const excecao = (situacao: string, solicitante: number) => ({
  id: 61,
  versao: 1,
  numero: 'ETP42-1',
  tipoDocumento: 'titulo_pagar',
  documento: 42,
  documentoNumero: '9042',
  linha: 9,
  competencia: '2027-03-01',
  conta: 'Material sintético',
  valor: 300,
  saldoDisponivel: 200,
  justificativa: 'Reposição urgente de material sintético para a unidade',
  solicitante,
  solicitanteNome: 'Usuário sintético',
  situacao,
  aprovadorNome: null,
  parecer: null,
  reserva: null,
});

test.describe('controle orçamentário na compra e no pagamento @C2-112', () => {
  test.setTimeout(240_000);
  test.use({ actionTimeout: 30_000 });

  test('regra validada na hora → reserva com saldo e ciência → bloqueio pede exceção → decisão → nota e liberação; axe', async ({
    page,
  }) => {
    let acao = 'alertar';
    let regras: unknown[] = [];
    let reservas: unknown[] = [];
    let excecoes: unknown[] = [];
    let usuario = 1;
    const corpos: Record<string, unknown> = {};
    await page.route('**/api/financeiro/controle-orcamentario**', async (rota) => {
      const url = new URL(rota.request().url());
      const metodo = rota.request().method();
      if (metodo === 'GET' && url.pathname.endsWith('/saldo'))
        return json(rota, {
          orcado: 1000,
          comprometido: 0,
          realizado: 0,
          disponivel: url.searchParams.get('tipoDocumento') === 'titulo_pagar' ? 200 : 1000,
          regra: regras.length ? { id: 5, acao, tolerancia: 0 } : null,
          acao: regras.length ? acao : 'conferir',
          periodo: 'mensal',
        });
      if (metodo === 'GET')
        return json(rota, {
          regras,
          excecoes,
          reservas,
          linhas: [{ id: 9, nome: '2027 v1 #1 · Centro sintético A · Material' }],
          documentos: [
            {
              tipoDocumento: 'pedido_compra',
              id: 41,
              numero: '2027/41',
              fornecedor: 'Fornecedor sintético',
              valor: 800,
              reservado: 0,
            },
            {
              tipoDocumento: 'titulo_pagar',
              id: 42,
              numero: '9042',
              fornecedor: 'Fornecedor sintético',
              valor: 1000,
              reservado: 0,
            },
          ],
          contas: [{ id: 3, nome: '1.01 Material sintético' }],
          centros: [{ id: 7, nome: 'Centro sintético A' }],
          naturezas: [{ id: 8, nome: 'Material sintético' }],
          planos: [{ id: 2, nome: 'Plano sintético' }],
          usuario,
        });
      const corpo = rota.request().postDataJSON() as Record<string, unknown>;
      if (url.pathname.endsWith('/regras') || /\/regras\/\d+$/.test(url.pathname)) {
        corpos['regra'] = corpo;
        acao = String(corpo['acao']);
        regras = [regra(acao)];
        return json(rota, { id: 5 }, 201);
      }
      if (url.pathname.endsWith('/documento')) {
        corpos['documento'] = corpo;
        return json(rota, { id: null, situacao: 'coberto', reserva: null }, 201);
      }
      if (url.pathname.endsWith('/excecoes')) {
        corpos['excecao'] = corpo;
        excecoes = [excecao('pendente', 1)];
        return json(rota, { id: 61, saldoDisponivel: 200 }, 201);
      }
      if (url.pathname.endsWith('/decidir')) {
        corpos['decisao'] = corpo;
        excecoes = [excecao('aprovada', 1)];
        return json(rota, { id: 61 });
      }
      if (url.pathname.endsWith('/nota')) {
        corpos['nota'] = corpo;
        reservas = [reserva(71, 'consumida', 0)];
        return json(rota, { id: 81, consumir: 800, liberar: 0, ajuste: 50, situacao: 'consumida' });
      }
      if (url.pathname.endsWith('/liberar')) {
        corpos['liberar'] = corpo;
        return json(rota, { id: 72, liberado: 800 });
      }
      corpos['reserva'] = corpo;
      reservas = [reserva(71, 'ativa', 800), reserva(72, 'ativa', 800)];
      return json(rota, { id: 71, valor: 800, decisao: 'alerta', excesso: 0, disponivel: 1000 }, 201);
    });

    await entrar(page, 'SINT.ORCAMENTO');
    await page.goto('/financeiro/orcamento');
    await page.getByTestId('orc-ir-controle').click();
    await expect(page).toHaveURL(/\/financeiro\/orcamento\/controle/);
    await expect(page.getByTestId('tela-controle-orcamentario')).toBeVisible();
    await semViolacaoAxe(page, '/financeiro/orcamento/controle (abertura)');

    // Regra: a dispensa sem recorte aparece na hora e trava o botão; grava o alerta no centro.
    await page.getByTestId('ctl-aba-regras').click();
    await page.getByTestId('ctl-regra-nova').click();
    await escolher(page.getByTestId('ctl-regra-acao'), 'nao_controlar');
    await expect(page.getByTestId('ctl-regra-problemas')).toContainText('recorte');
    await expect(page.getByTestId('ctl-regra-gravar')).toBeDisabled();
    await escolher(page.getByTestId('ctl-regra-acao'), 'alertar');
    await escolher(page.getByTestId('ctl-regra-centro'), '7');
    await page.getByTestId('ctl-regra-prioridade').fill('10');
    await page.getByTestId('ctl-regra-inicio').fill('2027-01-01');
    await expect(page.getByTestId('ctl-regra-problemas')).toHaveCount(0);
    await page.getByTestId('ctl-regra-gravar').click();
    await expect(page.getByTestId('ctl-aviso')).toBeVisible();
    expect(corpos['regra']).toMatchObject({ acao: 'alertar', centroCusto: 7, prioridade: 10, ativo: true });
    await expect(page.getByTestId('ctl-regra-5')).toContainText('Alertar');

    // Reserva do pedido: saldo e regra à vista; acima do saldo, o alerta pede ciência.
    await page.getByTestId('ctl-aba-reservar').click();
    // O documento é escolhido pelo número de negócio (com fornecedor e valor), não pelo identificador interno.
    await escolher(page.getByTestId('ctl-documento'), { rotulo: /2027\/41 · Fornecedor sintético/ });
    // Reservar pela linha do centro do documento: o mesmo caminho da aprovação do pedido.
    await page.getByTestId('ctl-reservar-documento').click();
    await expect
      .poll(() => corpos['documento'])
      .toMatchObject({ tipoDocumento: 'pedido_compra', documento: 41 });
    await escolher(page.getByTestId('ctl-linha'), '9');
    await page.getByTestId('ctl-competencia').fill('2027-03');
    await expect(page.getByTestId('ctl-disponivel')).toContainText('1.000,00');
    await expect(page.getByTestId('ctl-regra-que-vale')).toContainText('Alertar');
    await page.getByTestId('ctl-valor').fill('1200');
    await expect(page.getByTestId('ctl-excesso')).toContainText('200,00');
    await expect(page.getByTestId('ctl-reservar-gravar')).toBeDisabled();
    await page.getByTestId('ctl-ciente').check();
    await semViolacaoAxe(page, '/financeiro/orcamento/controle (reserva com alerta)');
    await page.getByTestId('ctl-valor').fill('800');
    await expect(page.getByTestId('ctl-excesso')).toHaveCount(0);
    await page.getByTestId('ctl-reservar-gravar').click();
    expect(corpos['reserva']).toMatchObject({
      tipoDocumento: 'pedido_compra',
      documento: 41,
      linha: 9,
      competencia: '2027-03-01',
      valor: 800,
    });

    // A regra passa a bloquear: o título acima do saldo trava a reserva e abre o pedido de exceção.
    await page.getByTestId('ctl-aba-regras').click();
    await page.getByTestId('ctl-regra-editar-5').click();
    await escolher(page.getByTestId('ctl-regra-acao'), 'bloquear');
    await page.getByTestId('ctl-regra-gravar').click();
    expect(corpos['regra']).toMatchObject({ acao: 'bloquear', versao: 1 });
    await page.getByTestId('ctl-aba-reservar').click();
    await escolher(page.getByTestId('ctl-tipo-documento'), 'titulo_pagar');
    await escolher(page.getByTestId('ctl-documento'), { rotulo: /9042 · Fornecedor sintético/ });
    await page.getByTestId('ctl-valor').fill('500');
    await expect(page.getByTestId('ctl-excesso')).toContainText('300,00');
    await expect(page.getByTestId('ctl-reservar-gravar')).toBeDisabled();
    await expect(page.getByTestId('ctl-excecao')).toBeVisible();
    await page.getByTestId('ctl-justificativa').fill('curta');
    await expect(page.getByTestId('ctl-excecao-problemas')).toBeVisible();
    await expect(page.getByTestId('ctl-excecao-enviar')).toBeDisabled();
    await escolher(page.getByTestId('ctl-conta'), '3');
    await page
      .getByTestId('ctl-justificativa')
      .fill('Reposição urgente de material sintético para a unidade');
    await expect(page.getByTestId('ctl-excecao-problemas')).toHaveCount(0);
    await page.getByTestId('ctl-excecao-enviar').click();
    expect(corpos['excecao']).toMatchObject({
      tipoDocumento: 'titulo_pagar',
      documento: 42,
      contaOrcamentaria: 3,
      valor: 300,
    });
    // Quem pediu não decide.
    await page.getByTestId('ctl-aba-excecoes').click();
    await expect(page.getByTestId('ctl-excecao-61')).toContainText('Esperando decisão');
    await expect(page.getByTestId('ctl-aprovar-61')).toHaveCount(0);

    // Quem aprova decide a exceção.
    usuario = 2;
    await entrar(page, 'SINT.ORCAMENTO.APROVA');
    await page.goto('/financeiro/orcamento/controle');
    await page.getByTestId('ctl-aba-excecoes').click();
    await page.getByTestId('ctl-parecer-61').fill('De acordo com a reposição');
    await page.getByTestId('ctl-aprovar-61').click();
    expect(corpos['decisao']).toMatchObject({
      versao: 1,
      aprovar: true,
      parecer: 'De acordo com a reposição',
    });
    await expect(page.getByTestId('ctl-excecao-61')).toContainText('Aprovada');
    await semViolacaoAxe(page, '/financeiro/orcamento/controle (exceção decidida)');

    // Reservas: a nota final realiza a do pedido; a outra é liberada com o motivo.
    await page.getByTestId('ctl-aba-reservas').click();
    await page.getByTestId('ctl-liberar-72').click();
    await page.getByTestId('ctl-liberar-motivo').fill('x');
    await expect(page.getByTestId('ctl-liberar-confirmar')).toBeDisabled();
    await page.getByTestId('ctl-liberar-motivo').fill('Pedido cancelado');
    await page.getByTestId('ctl-liberar-confirmar').click();
    expect(corpos['liberar']).toMatchObject({ versao: 1, motivo: 'Pedido cancelado' });
    await page.getByTestId('ctl-nota-71').click();
    await page.getByTestId('ctl-nota-valor').fill('850');
    await page.getByTestId('ctl-nota-numero').fill('NF-SINT-9');
    await page.getByTestId('ctl-nota-final').check();
    await page.getByTestId('ctl-nota-gravar').click();
    expect(corpos['nota']).toMatchObject({
      versao: 1,
      valorRealizado: 850,
      final: true,
      numeroDocumento: 'NF-SINT-9',
    });
    await expect(page.getByTestId('ctl-reserva-71')).toContainText('Realizada');
    await expect(page.getByTestId('ctl-reserva-71')).toContainText('2027/41');
    await semViolacaoAxe(page, '/financeiro/orcamento/controle (reservas)');
  });
});
