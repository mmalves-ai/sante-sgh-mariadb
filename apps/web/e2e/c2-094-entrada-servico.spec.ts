// F7 (09-AREA linha 78, C2-094): a tela da entrada de serviço tomado. As leituras e gravações de
// `/api/financeiro/fiscal/entradas-servico` só existem no banco do cliente (na fonte sintética respondem 503), então este
// E2E simula as rotas com um estado em memória que segue a regra do servidor. O que fica no banco (entrada, itens,
// câmbio, retenções por item, baixa no pedido, escrituração, cancelamento com justificativa) é provado no contrato de
// efeito `apps/api/src/modulos/financeiro/entrada-servico.int.spec.ts`; aqui se prova o fluxo da tela: escolhido o
// fornecedor e o pedido, os serviços com saldo e preço entram prontos; o preço acima do pedido é recusado na hora
// (mesma regra do domínio); a prévia das retenções aparece; registrar, concluir e cancelar (a justificativa curta é
// recusada antes de gravar); o detalhe mostra as retenções; e o item no menu. Axe em cada passo. Massa SINTÉTICA.
import { expect, type Page, type Route, test } from '@playwright/test';
import { escolher } from './combos.js';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';
// Quem gere o financeiro com o perfil de administrador do sistema (que dá financeiro.entradaServico.*).
const LOGIN = 'SINT.FIN.GESTOR';
const TELA = '/financeiro/fiscal/entradas-servico';
const API = '/api/financeiro/fiscal/entradas-servico';

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

test.describe('financeiro: entrada de serviço tomado @C2-094', () => {
  test.setTimeout(180_000);

  test('pedido com serviços prontos, preço conferido na hora, retenções na prévia, concluir e cancelar; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const corpos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const competencia = new Date().toISOString().slice(0, 7);
    const entradas: Record<string, unknown>[] = [];
    const apoio = {
      fornecedores: [{ id: 41, rotulo: 'LAVANDERIA SINTETICA LTDA · 11222333000181' }],
      pedidos: [
        {
          id: 70,
          rotulo: '2026/15',
          fornecedor: 41,
          situacao: 'aprovado',
          itens: [
            { id: 701, servico: 9, descricao: 'LAVAGEM DE ROUPA SINTETICA', saldo: 10, valorUnitario: 100 },
          ],
        },
      ],
      servicos: [{ id: 9, rotulo: 'S-09 · LAVAGEM DE ROUPA SINTETICA' }],
      centros: [{ id: 3, rotulo: 'CC-03 · HOTELARIA SINTETICA' }],
      moedas: [{ id: 2, rotulo: 'USD · Dólar' }],
    };
    const previa = (valor: number) => {
      const ir = Math.round(valor * 1.5) / 100;
      const inss = Math.round(valor * 11) / 100;
      return {
        retencoes: [
          {
            tributo: 'INSS',
            campo: 'inss',
            base: valor,
            aliquota: 11,
            valorTributo: inss,
            valorRetido: inss,
            valorNaoRetido: 0,
            dispensada: false,
          },
          {
            tributo: 'IR',
            campo: 'ir',
            base: valor,
            aliquota: 1.5,
            valorTributo: ir,
            valorRetido: ir,
            valorNaoRetido: 0,
            dispensada: false,
          },
        ],
        liquido: Math.round((valor - ir - inss) * 100) / 100,
        reinf: { inss, ir },
      };
    };

    await page.route(`**${API}**`, async (rota) => {
      const req = rota.request();
      const url = new URL(req.url());
      const caminho = url.pathname;
      if (req.method() === 'GET') {
        if (caminho.endsWith('/apoio')) return json(rota, apoio);
        if (caminho.endsWith('/retencoes')) return json(rota, previa(Number(url.searchParams.get('valor'))));
        const id = /\/(\d+)$/.exec(caminho)?.[1];
        if (id) {
          const e = entradas.find((x) => String(x['id']) === id);
          const p = previa(Number(e?.['valorBruto']));
          return json(rota, {
            ...e,
            itens: [
              {
                sequencia: 1,
                servico: 'S-09 · LAVAGEM DE ROUPA SINTETICA',
                descricao: null,
                quantidade: 8,
                valorUnitario: 100,
                valorDesconto: 0,
                valorTotal: 800,
                centro: 'CC-03',
                doPedido: true,
                inssNaoRetido: 0,
              },
            ],
            retencoes: p.retencoes.map((r) => ({
              tributo: r.tributo,
              base: r.base,
              aliquota: r.aliquota,
              devido: r.valorTributo,
              retido: r.valorRetido,
              naoRetido: 0,
              dispensada: false,
            })),
            cambio: null,
          });
        }
        return json(rota, entradas);
      }
      const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      corpos.push({ caminho, corpo });
      if (caminho === API) {
        const itens = corpo['itens'] as { quantidade: number; valorUnitario: number }[];
        const bruto = itens.reduce((s, i) => s + i.quantidade * i.valorUnitario, 0);
        const p = previa(bruto);
        const retido = Math.round((bruto - p.liquido) * 100) / 100;
        entradas.push({
          id: entradas.length + 1,
          versao: 1,
          numero: `ES-${entradas.length + 1}`,
          documento: corpo['numeroDocumento'],
          serie: null,
          fornecedor: 'LAVANDERIA SINTETICA LTDA',
          fornecedorDocumento: '11222333000181',
          pedido: '2026/15',
          emissao: corpo['dataEmissao'],
          entrada: corpo['dataEntrada'],
          competencia,
          valorBruto: bruto,
          retido,
          liquido: p.liquido,
          situacao: 'aberta',
          titulo: null,
          concluidaEm: null,
        });
        return json(rota, { mensagem: `Entrada ES-${entradas.length} registrada.` });
      }
      const alvo = entradas.find((x) => caminho.includes(`/${String(x['id'])}/`));
      if (alvo && caminho.endsWith('/concluir')) {
        alvo['situacao'] = 'concluida';
        alvo['versao'] = 2;
        return json(rota, {
          mensagem: 'Entrada concluída: o pedido foi atendido e a nota foi para a escrituração.',
        });
      }
      if (alvo && caminho.endsWith('/cancelar')) {
        alvo['situacao'] = 'cancelada';
        return json(rota, { mensagem: 'Entrada cancelada; ela continua no histórico com a justificativa.' });
      }
      return json(rota, { detail: 'rota não simulada' }, 404);
    });

    await entrar(page, LOGIN);
    await page.goto(TELA);
    const tela = page.getByTestId('tela-fin-entrada-servico');
    await expect(tela.getByTestId('es-sem-entradas')).toBeVisible();
    await semViolacaoAxe(page, `${TELA} (início)`);

    // Fornecedor e pedido: o serviço com saldo entra pronto, no preço do pedido.
    const form = tela.getByTestId('es-registrar');
    await expect(form.getByTestId('es-gravar')).toBeDisabled();
    await escolher(form.getByTestId('es-fornecedor'), { rotulo: /LAVANDERIA SINTETICA/ });
    await escolher(form.getByTestId('es-pedido'), { rotulo: /2026\/15/ });
    await expect(form.getByTestId('es-item-saldo-0')).toContainText('10');
    await expect(form.getByTestId('es-item-quantidade-0')).toHaveValue('10');
    await expect(form.getByTestId('es-item-valor-0')).toHaveValue('100');
    await form.getByTestId('es-numero-documento').fill('NFS-123');
    await escolher(form.getByTestId('es-item-centro-0'), { rotulo: /HOTELARIA SINTETICA/ });
    // O preço acima do pedido é recusado na hora, antes de gravar.
    await form.getByTestId('es-item-valor-0').fill('120');
    await expect(form.getByTestId('es-recusa')).toContainText('preço do pedido');
    await expect(form.getByTestId('es-gravar')).toBeDisabled();
    await form.getByTestId('es-item-valor-0').fill('100');
    await form.getByTestId('es-item-quantidade-0').fill('8');
    await expect(form.getByTestId('es-recusa')).toHaveCount(0);
    // A prévia das retenções aparece na hora.
    await expect(form.getByTestId('es-previa-INSS')).toContainText('88,00');
    await expect(form.getByTestId('es-previa-IR')).toContainText('12,00');
    await expect(form.getByTestId('es-totais')).toContainText('700,00');
    await semViolacaoAxe(page, `${TELA} (registro)`);
    await form.getByTestId('es-gravar').click();
    await expect(tela.getByText(/Entrada ES-1 registrada/)).toBeVisible();
    expect(corpos[0]?.corpo).toMatchObject({
      fornecedor: 41,
      pedido: 70,
      numeroDocumento: 'NFS-123',
      itens: [{ servico: 9, pedidoItem: 701, quantidade: 8, valorUnitario: 100, centroCusto: 3 }],
      cambio: null,
    });

    // O detalhe mostra os serviços e as retenções por tributo.
    await expect(tela.getByTestId('es-situacao-1')).toContainText('Aberta');
    await tela.getByTestId('es-ver-1').click();
    await expect(tela.getByTestId('es-detalhe-retencoes')).toContainText('INSS');
    await tela.getByTestId('es-fechar').click();

    // Concluir leva a nota à escrituração.
    await tela.getByTestId('es-concluir-1').click();
    await tela.getByTestId('es-conclusao').getByTestId('es-confirmar-conclusao').click();
    await expect(tela.getByTestId('es-situacao-1')).toContainText('Concluída');
    expect(corpos[1]).toEqual({ caminho: `${API}/1/concluir`, corpo: { versao: 1, titulo: null } });

    // Cancelar: a justificativa curta é recusada na hora.
    await tela.getByTestId('es-cancelar-1').click();
    const cancelamento = tela.getByTestId('es-cancelamento');
    await cancelamento.getByTestId('es-justificativa').fill('curta');
    await expect(cancelamento.getByTestId('es-recusa-cancelamento')).toBeVisible();
    await expect(cancelamento.getByTestId('es-confirmar-cancelamento')).toBeDisabled();
    await cancelamento.getByTestId('es-justificativa').fill('Nota emitida em duplicidade pelo prestador.');
    await semViolacaoAxe(page, `${TELA} (cancelar)`);
    await cancelamento.getByTestId('es-confirmar-cancelamento').click();
    await expect(tela.getByTestId('es-situacao-1')).toContainText('Cancelada');
    expect(corpos.at(-1)?.corpo).toMatchObject({ versao: 2 });

    // O item no menu.
    await page.goto('/inicio');
    await (await itemDoMenu(page, 'Entrada de serviço tomado')).click();
    await expect(page).toHaveURL(new RegExp(`${TELA}$`));
    expect(externas).toEqual([]);
  });
});
