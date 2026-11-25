// E2E @F3.6 (05-SUP linha 20): acompanhar o pedido de compra emitido pelo caminho da tela. A gestão do pedido (agenda
// de entregas, contatos com o fornecedor e cancelamento com motivo) grava só no banco próprio, e o E2E roda com a fonte
// sintética (sem núcleo, a leitura responde 503). Por isso a leitura e as gravações são simuladas pelo Playwright com
// massa SINTÉTICA, e as operações aparecem ligadas para a sessão. O que se prova é a tela: a soma da agenda conferida
// na hora (o botão só grava com a soma certa), o envio da agenda, do contato (seguimento do anterior) e do
// cancelamento parcial (motivo pelo combo, justificativa exigida pelo motivo, confirmação antes de gravar) e o
// histórico do cancelamento no item depois de gravar. O efeito no banco (eventos imutáveis do cancelamento, entregas
// abatidas, baixa da agenda pela nota) está no contrato de efeito apps/api/src/modulos/suprimentos/pedido-gestao.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const OPS = [
  'suprimentos.programarEntregasPedido',
  'suprimentos.acompanharPedido',
  'suprimentos.cancelarCompra',
  'suprimentos.gravarMotivoCancelamentoCompra',
];

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
const resultado = (mensagem: string) => ({ mensagem, repetida: false, ids: { id: 1 }, avisos: [] });

function massa() {
  const hoje = new Date().toISOString().slice(0, 10);
  const mais = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
  return {
    hoje,
    mais,
    gestao: {
      pedido: {
        id: 1,
        ano: 2026,
        doc: 77,
        situacao: 'aprovado',
        dataPedido: hoje,
        fornecedor: 'FORNECEDOR SINTETICO',
        canceladoEm: null,
        motivoCancelamento: null,
        justificativaCancelamento: null,
      },
      hoje,
      itens: [
        {
          id: 501,
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
          id: 31,
          versao: 1,
          codigo: 'SEM-ESTOQUE',
          descricao: 'Fornecedor sem estoque',
          aplicaPedido: true,
          aplicaItem: true,
          exigeJustificativa: true,
          ativo: true,
        },
      ],
    },
  };
}

test.describe('acompanhar o pedido de compra (05-SUP linha 20) @F3.6', () => {
  test('agenda conferida na hora, contato com o fornecedor e cancelamento parcial com motivo e histórico; axe', async ({
    page,
  }) => {
    const m = massa();
    const g = m.gestao;
    const enviados: Record<string, Record<string, unknown>> = {};
    await page.route('**/api/suprimentos/gravacao', async (rota) => {
      const r = await rota.fetch();
      const corpo = (await r.json()) as { operacoes: Record<string, unknown> };
      for (const op of OPS) corpo.operacoes[op] = { ligada: true, motivo: null };
      return json(rota, corpo);
    });
    await page.route('**/api/suprimentos/pedidos/2026/77/**', async (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname;
      if (req.method() === 'GET') return json(rota, g);
      const corpo = req.postDataJSON() as Record<string, unknown>;
      const item = g.itens[0]!;
      if (caminho.endsWith('/entregas')) {
        enviados['entregas'] = corpo;
        item.entregas = (corpo['entregas'] as Record<string, unknown>[]).map((e, k) => ({
          id: 700 + k,
          sequencia: k + 1,
          dataPrevista: e['dataPrevista'],
          dataLimite: e['dataLimite'],
          quantidade: e['quantidade'],
          recebida: 0,
          cancelada: 0,
          atrasada: false,
        }));
        return json(rota, resultado('Entregas programadas.'));
      }
      if (caminho.endsWith('/acompanhamentos')) {
        enviados['acompanhamentos'] = corpo;
        g.acompanhamentos = [
          {
            id: 801,
            ocorridoEm: `${m.hoje}T10:00:00`,
            usuario: 'SINT.COMPRADOR',
            contatoNome: null,
            contatoTelefone: null,
            contatoEmail: null,
            previsaoEntrega: corpo['previsaoEntrega'],
            situacao: corpo['situacao'],
            andamento: corpo['andamento'],
            anterior: corpo['anterior'],
          },
        ];
        return json(rota, resultado('Contato registrado.'));
      }
      if (caminho.endsWith('/cancelamento')) {
        enviados['cancelamento'] = corpo;
        const q = Number(corpo['quantidade']);
        item.cancelada += q;
        item.pendente -= q;
        item.cancelamentos = [
          {
            id: 901,
            ocorridoEm: `${m.hoje}T11:00:00`,
            usuario: 'SINT.COMPRADOR',
            abrangencia: 'item',
            quantidade: q,
            motivo: 'Fornecedor sem estoque',
            justificativa: corpo['justificativa'],
          },
        ];
        return json(rota, resultado('Cancelamento registrado.'));
      }
      return json(rota, { title: 'rota não simulada' }, 404);
    });

    await entrar(page, 'SINT.COMPRADOR');
    await page.goto('/suprimentos/pedidos/2026/77/acompanhar');
    await expect(page.getByTestId('pg-situacao')).toHaveText('aprovado');
    await expect(page.getByTestId('pg-item-1')).toContainText('ITEM SINTETICO');

    // Agenda: duas entregas; a soma acima do pedido é recusada na hora e o botão não grava.
    await page.getByTestId('pg-agenda-1').click();
    await page.getByTestId('pg-ag-data-0').fill(m.mais(5));
    await page.getByTestId('pg-ag-qtd-0').fill('6');
    await page.getByTestId('pg-ag-mais').click();
    await page.getByTestId('pg-ag-data-1').fill(m.mais(20));
    await page.getByTestId('pg-ag-qtd-1').fill('6');
    await expect(page.getByTestId('pg-ag-recusas')).toBeVisible();
    await expect(page.getByTestId('pg-ag-gravar')).toBeDisabled();
    await page.getByTestId('pg-ag-qtd-1').fill('4');
    await expect(page.getByTestId('pg-ag-recusas')).toHaveCount(0);
    await page.getByTestId('pg-ag-gravar').click();
    await expect(page.getByTestId('pg-aviso')).toBeVisible();
    expect(enviados['entregas']).toMatchObject({
      item: 501,
      entregas: [
        { dataPrevista: m.mais(5), quantidade: 6 },
        { dataPrevista: m.mais(20), quantidade: 4 },
      ],
    });
    await expect(page.getByTestId('pg-item-1')).toContainText('6');

    // Contato com o fornecedor: andamento e previsão.
    await page.getByTestId('pg-novo-contato').click();
    await page.getByTestId('pg-ct-previsao').fill(m.mais(5));
    await page.getByTestId('pg-ct-andamento').fill('Fornecedor confirma a primeira entrega.');
    await page.getByTestId('pg-ct-gravar').click();
    await expect(page.getByTestId('pg-contatos')).toContainText('Fornecedor confirma a primeira entrega.');
    expect(enviados['acompanhamentos']).toMatchObject({
      previsaoEntrega: m.mais(5),
      andamento: 'Fornecedor confirma a primeira entrega.',
      anterior: null,
    });

    // Cancelamento parcial do item: o motivo exige justificativa; a confirmação vem antes do envio.
    await page.getByTestId('pg-cancelar-item-1').click();
    await escolher(page.getByTestId('pg-canc-motivo'), { rotulo: 'Fornecedor sem estoque' });
    await page.getByTestId('pg-canc-qtd').fill('3');
    await expect(page.getByTestId('pg-canc-recusas')).toBeVisible();
    await expect(page.getByTestId('pg-canc-confirmar')).toBeDisabled();
    await page.getByTestId('pg-canc-just').fill('Fornecedor só entrega sete unidades.');
    await expect(page.getByTestId('pg-canc-recusas')).toHaveCount(0);
    await page.getByTestId('pg-canc-confirmar').click();
    const dialogo = page.getByTestId('confirmacao');
    await expect(dialogo).toBeVisible();
    expect(enviados['cancelamento']).toBeUndefined();
    await dialogo.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByTestId('pg-cancelamentos-1')).toBeVisible();
    expect(enviados['cancelamento']).toMatchObject({
      item: 501,
      quantidade: 3,
      motivo: 31,
      justificativa: 'Fornecedor só entrega sete unidades.',
    });
    await page.getByTestId('pg-cancelamentos-1').locator('summary').click();
    await expect(page.getByTestId('pg-cancelamentos-1')).toContainText(
      'Fornecedor só entrega sete unidades.',
    );
    await expect(page.getByTestId('pg-item-1')).toContainText('7');
    await semViolacaoAxe(page, 'acompanhar o pedido de compra');
  });
});
