// F3.8 (07-FIN linha 85): a tela do fechamento do período financeiro. As leituras e as gravações do período só existem
// no banco do cliente (na fonte sintética respondem 503), então este E2E simula `/api/financeiro/periodos` com um
// estado em memória que segue a regra do servidor (fechar o mês terminado; um pede a reabertura, outro decide; quem
// pediu não autoriza). O que fica no banco é provado no contrato de efeito `periodo-financeiro.int.spec.ts`; aqui se
// prova o fluxo da tela: um clique fecha a competência sugerida, a justificativa é conferida enquanto se digita, a
// decisão é de outro usuário na mesma linha, o histórico e o saldo do dia aparecem, e o item está no menu. Axe em cada
// passo.
import { expect, type Page, type Route, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const OPERACOES = [
  'financeiro.fecharPeriodo',
  'financeiro.pedirReaberturaPeriodo',
  'financeiro.reabrirPeriodo',
] as const;
const JUSTIFICATIVA = 'Tarifa do banco lançada fora do mês';

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
const recusa = (rota: Route, codigo: string, detail: string) =>
  rota.fulfill({
    status: 409,
    contentType: 'application/problem+json',
    body: JSON.stringify({ type: `urn:sgh:erro:${codigo}`, title: detail, status: 409, detail, codigo }),
  });

interface Periodo {
  competencia: string;
  situacao: 'aberto' | 'fechado' | 'reaberto';
  fechadoEm: string | null;
  fechadoPor: string | null;
  movimentos: number | null;
  reabertoEm: string | null;
  reabertoPor: string | null;
  autorizadoPor: string | null;
  justificativa: string | null;
  pedido: { por: string; usuario: number; justificativa: string } | null;
}

test.describe('financeiro: fechamento do período @F3.8-06', () => {
  test.setTimeout(180_000);

  test('fecha a competência sugerida, pede a reabertura com justificativa e outro usuário decide; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const periodos: Periodo[] = [];
    const eventos: Record<string, unknown>[] = [];
    const corpos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let quem = '';
    const agora = () => new Date().toISOString();
    const evento = (competencia: string, tipo: string, extra: Record<string, unknown> = {}) =>
      eventos.unshift({
        competencia,
        tipo,
        em: agora(),
        por: quem,
        justificativa: null,
        movimentos: null,
        ...extra,
      });

    // As três operações do período liberadas na situação da gravação (o resto vem do servidor).
    await page.route('**/api/financeiro/gravacao', async (rota) => {
      const r = await rota.fetch();
      const corpo = (await r.json()) as { operacoes: Record<string, unknown> };
      for (const op of OPERACOES) corpo.operacoes[op] = { ligada: true, motivo: null };
      return json(rota, corpo);
    });
    await page.route('**/api/financeiro/periodos**', async (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname.replace(/^.*\/periodos/, '');
      if (req.method() === 'GET') {
        if (caminho === '') return json(rota, periodos);
        if (caminho === '/eventos') return json(rota, eventos);
        const de = new URL(req.url()).searchParams.get('de') ?? '';
        const fechado = periodos.some((p) => p.competencia === de && p.situacao === 'fechado');
        return json(
          rota,
          fechado
            ? [
                {
                  data: `${de.slice(0, 8)}03`,
                  saldoAnterior: 1000,
                  entradas: 0,
                  saidas: 77.7,
                  saldoFinal: 922.3,
                  fechado: true,
                },
                {
                  data: `${de.slice(0, 8)}10`,
                  saldoAnterior: 922.3,
                  entradas: 20,
                  saidas: 0,
                  saldoFinal: 942.3,
                  fechado: true,
                },
              ]
            : [],
        );
      }
      const corpo = req.postDataJSON() as Record<string, unknown>;
      corpos.push({ caminho, corpo });
      const competencia = String(corpo['competencia']);
      const p = periodos.find((x) => x.competencia === competencia);
      const ok = (mensagem: string) => json(rota, { mensagem, repetida: false, ids: {}, avisos: [] });
      if (caminho === '/fechar') {
        if (p?.situacao === 'fechado')
          return recusa(rota, 'periodo-ja-fechado', 'A competência já está fechada.');
        const novo: Periodo = {
          competencia,
          situacao: 'fechado',
          fechadoEm: agora(),
          fechadoPor: quem,
          movimentos: 2,
          reabertoEm: null,
          reabertoPor: null,
          autorizadoPor: null,
          justificativa: null,
          pedido: null,
        };
        if (p) Object.assign(p, novo);
        else periodos.unshift(novo);
        evento(competencia, 'fechamento', { movimentos: 2 });
        return ok('Competência fechada; saldos do dia gravados.');
      }
      if (!p) return recusa(rota, 'periodo-nao-fechado', 'A competência não está fechada.');
      if (caminho === '/pedir-reabertura') {
        const justificativa = String(corpo['justificativa']);
        p.pedido = { por: quem, usuario: 1, justificativa };
        evento(competencia, 'pedido_reabertura', { justificativa });
        return ok('Pedido de reabertura registrado; outro usuário autoriza.');
      }
      if (!p.pedido) return recusa(rota, 'sem-pedido-reabertura', 'Não há pedido de reabertura.');
      if (p.pedido.por === quem)
        return recusa(rota, 'autorizador-igual-solicitante', 'Quem pediu a reabertura não pode autorizá-la.');
      const pedido = p.pedido;
      p.pedido = null;
      if (corpo['decisao'] === 'autorizar') {
        Object.assign(p, {
          situacao: 'reaberto',
          reabertoEm: agora(),
          reabertoPor: pedido.por,
          autorizadoPor: quem,
          justificativa: pedido.justificativa,
        });
        evento(competencia, 'reabertura', { justificativa: pedido.justificativa });
        return ok('Competência reaberta.');
      }
      evento(competencia, 'reabertura_recusada', { justificativa: corpo['observacao'] ?? null });
      return ok('Pedido de reabertura recusado.');
    });

    // Quem lança o movimento fecha a competência sugerida com um clique (o mês terminado antes do corrente).
    quem = 'SINT.FIN.TESFIS';
    await entrar(page, quem);
    const apoio = (await (await page.request.get('/api/financeiro/apoio')).json()) as { hoje: string };
    const [ano, mesCorrente] = apoio.hoje.split('-').map(Number) as [number, number];
    const anterior = new Date(Date.UTC(ano, mesCorrente - 2, 1)).toISOString().slice(0, 10);
    const rotulo = `${anterior.slice(5, 7)}/${anterior.slice(0, 4)}`;

    await page.goto('/financeiro/tesouraria/periodo');
    await expect(page.getByTestId('tela-fin-periodo')).toBeVisible();
    await expect(page.getByTestId('tela-fin-periodo')).toContainText(`Próxima a fechar: ${rotulo}`);
    await semViolacaoAxe(page, '/financeiro/tesouraria/periodo (nada fechado)');
    await page.getByTestId('pf-fechar').click();
    await expect(page.getByTestId('fat-mensagem')).toContainText('Competência fechada');
    expect(corpos.at(-1)).toEqual({ caminho: '/fechar', corpo: { competencia: anterior } });
    const linha = page.getByTestId(`pf-linha-${anterior}`);
    await expect(linha).toContainText('Fechada');
    await expect(linha).toContainText(quem);
    // O mês corrente nunca é sugerido: depois de fechar o anterior, não há próxima a fechar.
    await expect(page.getByTestId('pf-fechar')).toHaveCount(0);
    await expect(page.getByTestId('pf-historico')).toContainText('Fechamento');
    // O saldo gravado de cada dia da conta do escopo, sem recalcular.
    await expect(page.getByTestId('pf-saldos').locator('tbody tr')).toHaveCount(2);
    await expect(page.getByTestId('pf-saldos')).toContainText('942,30');
    await semViolacaoAxe(page, '/financeiro/tesouraria/periodo (fechada, com saldo diário)');

    // A reabertura é pedida com justificativa: o botão só libera com o mínimo de letras (validação na hora).
    await page.getByTestId(`pf-reabrir-${anterior}`).click();
    await expect(page.getByTestId('pf-reabertura')).toBeVisible();
    await page.getByTestId('pf-justificativa').fill('erro');
    await expect(page.getByTestId('pf-confirmar-reabertura')).toBeDisabled();
    await page.getByTestId('pf-justificativa').fill(JUSTIFICATIVA);
    await expect(page.getByTestId('pf-confirmar-reabertura')).toBeEnabled();
    await semViolacaoAxe(page, '/financeiro/tesouraria/periodo (pedido de reabertura)');
    await page.getByTestId('pf-confirmar-reabertura').click();
    await expect(page.getByTestId('fat-mensagem')).toContainText('Pedido de reabertura registrado');
    expect(corpos.at(-1)).toEqual({
      caminho: '/pedir-reabertura',
      corpo: { competencia: anterior, justificativa: JUSTIFICATIVA },
    });
    await expect(page.getByTestId(`pf-pedido-${anterior}`)).toContainText(JUSTIFICATIVA);
    // Quem pediu não decide: sem a permissão de decidir, os botões nem aparecem; a competência segue fechada.
    await expect(page.getByTestId(`pf-autorizar-${anterior}`)).toHaveCount(0);
    await expect(page.getByTestId(`pf-reabrir-${anterior}`)).toHaveCount(0);
    await expect(linha).toContainText('Fechada');

    // Outro usuário, com a permissão de decidir, recusa na mesma linha; o pedido some e o histórico guarda a recusa.
    quem = 'SINT.FIN.LANCA';
    await entrar(page, quem);
    await page.goto('/financeiro/tesouraria/periodo');
    await expect(page.getByTestId(`pf-pedido-${anterior}`)).toContainText('SINT.FIN.TESFIS');
    // Quem decide não lança movimento: não fecha nem pede reabertura.
    await expect(page.getByTestId(`pf-reabrir-${anterior}`)).toHaveCount(0);
    await page.getByTestId(`pf-observacao-${anterior}`).fill('Lançar no mês corrente');
    await page.getByTestId(`pf-recusar-${anterior}`).click();
    await expect(page.getByTestId('fat-mensagem')).toContainText('recusado');
    expect(corpos.at(-1)).toEqual({
      caminho: '/reabrir',
      corpo: { competencia: anterior, decisao: 'recusar', observacao: 'Lançar no mês corrente' },
    });
    await expect(page.getByTestId(`pf-pedido-${anterior}`)).toHaveCount(0);
    await expect(page.getByTestId('pf-historico')).toContainText('Reabertura recusada');
    await expect(page.getByTestId(`pf-linha-${anterior}`)).toContainText('Fechada');

    // Novo pedido de quem lança; agora o outro usuário autoriza e a competência volta a aceitar lançamentos.
    quem = 'SINT.FIN.TESFIS';
    await entrar(page, quem);
    await page.goto('/financeiro/tesouraria/periodo');
    await page.getByTestId(`pf-reabrir-${anterior}`).click();
    await page.getByTestId('pf-justificativa').fill(JUSTIFICATIVA);
    await page.getByTestId('pf-confirmar-reabertura').click();
    await expect(page.getByTestId(`pf-pedido-${anterior}`)).toBeVisible();

    quem = 'SINT.FIN.LANCA';
    await entrar(page, quem);
    await page.goto('/financeiro/tesouraria/periodo');
    await page.getByTestId(`pf-autorizar-${anterior}`).click();
    await expect(page.getByTestId('fat-mensagem')).toContainText('reaberta');
    expect(corpos.at(-1)).toEqual({
      caminho: '/reabrir',
      corpo: { competencia: anterior, decisao: 'autorizar' },
    });
    await expect(page.getByTestId(`pf-linha-${anterior}`)).toContainText('Reaberta');
    await expect(page.getByTestId(`pf-linha-${anterior}`)).toContainText('autorizada por SINT.FIN.LANCA');
    const historico = page.getByTestId('pf-historico');
    await expect(historico.locator('tbody tr')).toHaveCount(5);
    await expect(historico).toContainText('Reabertura autorizada');
    await expect(historico).toContainText('Pedido de reabertura');
    await semViolacaoAxe(page, '/financeiro/tesouraria/periodo (reaberta, histórico completo)');

    // O item está no menu de quem lê o movimento.
    await page.goto('/inicio');
    await (await itemDoMenu(page, 'Fechamento do período financeiro')).click();
    await expect(page).toHaveURL(/\/financeiro\/tesouraria\/periodo/);
    await expect(page.getByTestId('tela-fin-periodo')).toBeVisible();
    expect(externas).toEqual([]);
  });
});
