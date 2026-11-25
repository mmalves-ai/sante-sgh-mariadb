// E2E @C1-088 (05-SUP linha 20): acompanhar o pedido de compra que nasceu ligado ao contrato do fornecedor. A criação
// com o contrato no combo está no E2E c1-032-contrato-pedido.spec.ts; aqui se prova a gestão do pedido ligado: a tela
// mostra o contrato e o valor que o pedido compromete do saldo, e o cancelamento parcial (motivo pelo combo,
// justificativa, confirmação) devolve ao saldo a parte cancelada (a tela relê a gestão e o valor comprometido cai). A
// gestão grava só no banco próprio e o E2E roda com a fonte sintética (sem núcleo, a leitura responde 503), por isso a
// leitura e a gravação são simuladas pelo Playwright com massa SINTÉTICA. O efeito no MariaDB (o saldo do contrato pela
// regra valorPedidoNoContrato depois do cancelamento parcial e do inteiro) está no contrato de efeito
// apps/api/src/modulos/suprimentos/contrato-pedido-compra.int.spec.ts. Nenhum dado de pessoa.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const OPS = ['suprimentos.cancelarCompra'];

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

function massa() {
  const hoje = new Date().toISOString().slice(0, 10);
  return {
    pedido: {
      id: 1,
      ano: 2026,
      doc: 88,
      situacao: 'aprovado',
      dataPedido: hoje,
      fornecedor: 'FORNECEDOR SINTETICO',
      canceladoEm: null,
      motivoCancelamento: null,
      justificativaCancelamento: null,
      contrato: { id: 41, numero: 'CT-SINT-2026-1', valorComprometido: 100 },
    },
    hoje,
    itens: [
      {
        id: 601,
        sequencia: 1,
        insumo: 9001,
        nome: 'ITEM SINTETICO',
        quantidade: 10,
        recebida: 0,
        cancelada: 0,
        pendente: 10,
        canceladoEm: null,
        motivoCancelamento: null,
        cancelamentos: [] as Record<string, unknown>[],
        entregas: [] as Record<string, unknown>[],
      },
    ],
    acompanhamentos: [] as Record<string, unknown>[],
    motivos: [
      {
        id: 32,
        versao: 1,
        codigo: 'SEM-ESTOQUE',
        descricao: 'Fornecedor sem estoque',
        aplicaPedido: true,
        aplicaItem: true,
        exigeJustificativa: true,
        ativo: true,
      },
    ],
  };
}

test.describe('@C1-088 Pedido ligado ao contrato: acompanhar e cancelar devolve ao saldo', () => {
  test('a gestão mostra o contrato e o comprometido; o cancelamento parcial reduz o comprometido; axe', async ({
    page,
  }) => {
    const g = massa();
    let enviado: Record<string, unknown> | undefined;
    await page.route('**/api/suprimentos/gravacao', async (rota) => {
      const r = await rota.fetch();
      const corpo = (await r.json()) as { operacoes: Record<string, unknown> };
      for (const op of OPS) corpo.operacoes[op] = { ligada: true, motivo: null };
      return json(rota, corpo);
    });
    await page.route('**/api/suprimentos/pedidos/2026/88/**', async (rota) => {
      const req = rota.request();
      if (req.method() === 'GET') return json(rota, g);
      if (new URL(req.url()).pathname.endsWith('/cancelamento')) {
        enviado = req.postDataJSON() as Record<string, unknown>;
        const q = Number(enviado['quantidade']);
        const item = g.itens[0]!;
        item.cancelada += q;
        item.pendente -= q;
        item.cancelamentos = [
          {
            id: 902,
            ocorridoEm: `${g.hoje}T11:00:00`,
            usuario: 'SINT.COMPRADOR',
            abrangencia: 'item',
            quantidade: q,
            motivo: 'Fornecedor sem estoque',
            justificativa: enviado['justificativa'],
          },
        ];
        // A regra do saldo: aprovado (10 × R$ 10,00) menos a parte cancelada pelo preço adjudicado.
        g.pedido.contrato = { ...g.pedido.contrato, valorComprometido: 100 - q * 10 };
        return json(rota, {
          mensagem: 'Cancelamento registrado.',
          repetida: false,
          ids: { id: 1 },
          avisos: [],
        });
      }
      return json(rota, { title: 'rota não simulada' }, 404);
    });

    await entrar(page, 'SINT.COMPRADOR');
    await page.goto('/suprimentos/pedidos/2026/88/acompanhar');
    await expect(page.getByTestId('pg-situacao')).toHaveText('aprovado');
    await expect(page.getByTestId('pg-contrato')).toContainText('CT-SINT-2026-1');
    await expect(page.getByTestId('pg-contrato-valor')).toContainText('100,00');

    await page.getByTestId('pg-cancelar-item-1').click();
    await escolher(page.getByTestId('pg-canc-motivo'), { rotulo: 'Fornecedor sem estoque' });
    await page.getByTestId('pg-canc-qtd').fill('4');
    await page.getByTestId('pg-canc-just').fill('Fornecedor entrega só seis unidades pelo contrato.');
    await expect(page.getByTestId('pg-canc-recusas')).toHaveCount(0);
    await page.getByTestId('pg-canc-confirmar').click();
    const dialogo = page.getByTestId('confirmacao');
    await expect(dialogo).toBeVisible();
    expect(enviado).toBeUndefined();
    await dialogo.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByTestId('pg-cancelamentos-1')).toBeVisible();
    expect(enviado).toMatchObject({ item: 601, quantidade: 4, motivo: 32 });
    await expect(page.getByTestId('pg-contrato-valor')).toContainText('60,00');
    await semViolacaoAxe(page, 'pedido ligado ao contrato');
  });
});
