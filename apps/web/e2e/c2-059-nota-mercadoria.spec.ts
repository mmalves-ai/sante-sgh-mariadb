// F7 (07-FIN linha 114, C2-059): a tela da NF-e de saída de mercadoria. As leituras e gravações de
// `/api/financeiro/fiscal/notas-mercadoria` só existem no banco do cliente (na fonte sintética respondem 503), então
// este E2E simula as rotas com um estado em memória que segue a regra do servidor. O que fica no banco (nota, itens com
// CFOP e lote, referência, eventos, XML assinado, a devolução com a chave) é provado no contrato de efeito
// `apps/api/src/modulos/financeiro/aplicacao/nota-mercadoria.int.spec.ts`; aqui se prova o fluxo da tela: a devolução
// sem nota vira NF-e com um clique; a remessa para conserto é montada com o CFOP e os totais na hora; o cancelamento e a
// carta de correção recusam o texto curto antes de gravar; o histórico mostra os eventos; e o item no menu. Axe em cada
// passo. Massa SINTÉTICA.
import { expect, type Page, type Route, test } from '@playwright/test';
import { escolher } from './combos.js';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';
// Quem gere o financeiro com o perfil de administrador do sistema (que dá financeiro.notaMercadoria.*).
const LOGIN = 'SINT.FIN.GESTOR';
const TELA = '/financeiro/fiscal/notas-mercadoria';
const API = '/api/financeiro/fiscal/notas-mercadoria';

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

test.describe('financeiro: NF-e de saída de mercadoria @C2-059', () => {
  test.setTimeout(180_000);

  test('devolução em um clique, conserto com CFOP e totais na hora, correção e cancelamento conferidos; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const corpos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const agora = new Date().toISOString();
    const notas: Record<string, unknown>[] = [];
    const eventos: Record<string, unknown>[] = [];
    const apoio = {
      destino: 'simulador',
      naturezas: [
        {
          codigo: 'devolucao_compra',
          descricao: 'Devolução de compra',
          finalidade: 'devolucao',
          cfopDentro: '5202',
          cfopFora: '6202',
          exigeReferencia: true,
          ativa: true,
        },
        {
          codigo: 'remessa_conserto',
          descricao: 'Remessa para conserto',
          finalidade: 'conserto',
          cfopDentro: '5915',
          cfopFora: '6915',
          exigeReferencia: false,
          ativa: true,
        },
        {
          codigo: 'simples_remessa',
          descricao: 'Simples remessa',
          finalidade: 'simples_remessa',
          cfopDentro: '5949',
          cfopFora: '6949',
          exigeReferencia: false,
          ativa: true,
        },
      ],
      devolucoes: [] as Record<string, unknown>[],
      fornecedores: [{ id: 41, rotulo: 'FORNECEDOR SINTETICO SP · 11222333000181' }],
      clientes: [],
      motivos: [{ id: 7, rotulo: 'ERRO DE EMISSAO SINTETICO' }],
      insumos: [{ id: 501, rotulo: 'INS-1 · BOMBA DE INFUSAO SINTETICA', ncm: '90189099' }],
    };
    apoio.devolucoes.push({
      devolucao: 900,
      numero: 'DEV-900',
      consignado: false,
      fornecedor: 'FORNECEDOR SINTETICO SP',
      valor: 250,
      itens: 2,
      devolvidaEm: agora,
    });
    const nova = (
      numero: number,
      natureza: string,
      cfop: string,
      valor: number,
      devolucao: number | null,
    ) => ({
      nota: numero,
      numero,
      serie: '1',
      situacao: 'autorizada',
      homologacao: true,
      chave: '3'.padEnd(44, '5'),
      protocolo: `13526${numero}`,
      emissao: agora,
      autorizadaEm: agora,
      valorTotal: valor,
      devolucao,
      natureza,
      naturezaDescricao: natureza === 'devolucao_compra' ? 'Devolução de compra' : 'Remessa para conserto',
      cfop,
      destinatario: 'FORNECEDOR SINTETICO SP',
      cartasCorrecao: 0,
      retorno: null,
    });

    await page.route(`**${API}**`, async (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname;
      if (req.method() === 'GET') {
        if (caminho.endsWith('/apoio')) return json(rota, apoio);
        if (caminho.endsWith('/historico')) {
          const n = notas.find((x) => caminho.includes(`/${String(x['nota'])}/`));
          return json(rota, { nota: n, itens: [], eventos, referencias: [] });
        }
        if (caminho.endsWith('/danfe')) return json(rota, { html: '<p>DANFE SINTETICO</p>' });
        return json(rota, notas);
      }
      const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      corpos.push({ caminho, corpo });
      if (caminho.endsWith(API)) {
        const dev = corpo['origem'] === 'devolucao_fornecedor';
        const n = nova(
          notas.length + 1,
          dev ? 'devolucao_compra' : 'remessa_conserto',
          dev ? '5202' : '5915',
          dev ? 250 : 300,
          dev ? 900 : null,
        );
        notas.unshift(n);
        // A remessa para conserto sai pela Sefaz sem resposta: fica assinada, para transmitir depois.
        if (!dev) {
          n.situacao = 'assinada';
          n.protocolo = '';
          return json(rota, { mensagem: `NF-e ${n.numero} assinada; a Sefaz não respondeu.` });
        }
        eventos.push({
          tipo: 'autorizacao',
          sequencia: 1,
          protocolo: n.protocolo,
          codigo: '100',
          mensagem: null,
          texto: null,
          em: agora,
        });
        if (dev) apoio.devolucoes = [];
        return json(rota, {
          mensagem: `NF-e ${n.numero} autorizada pelo simulador da Sefaz (sem valor fiscal).`,
        });
      }
      const alvo = notas.find((x) => caminho.includes(`/${String(x['nota'])}/`));
      if (alvo && caminho.endsWith('/transmitir')) {
        alvo['situacao'] = 'autorizada';
        alvo['protocolo'] = '135260000000002';
        return json(rota, { mensagem: `NF-e ${String(alvo['numero'])} autorizada pela Sefaz.` });
      }
      if (alvo && caminho.endsWith('/corrigir')) {
        alvo['cartasCorrecao'] = Number(alvo['cartasCorrecao']) + 1;
        eventos.push({
          tipo: 'carta_correcao',
          sequencia: 1,
          protocolo: null,
          codigo: '135',
          mensagem: null,
          texto: corpo['texto'],
          em: agora,
        });
        return json(rota, { mensagem: 'Carta de correção 1 registrada.' });
      }
      if (alvo && caminho.endsWith('/cancelar')) {
        alvo['situacao'] = 'cancelada';
        return json(rota, {
          mensagem: 'NF-e cancelada; ela continua no histórico e a devolução pode receber outra nota.',
        });
      }
      return json(rota, { detail: 'rota não simulada' }, 404);
    });

    await entrar(page, LOGIN);
    await page.goto(TELA);
    const tela = page.getByTestId('tela-fin-nota-mercadoria');
    await expect(tela.getByTestId('nfe-simulador')).toBeVisible();
    await expect(tela.getByTestId('nfe-devolucao-900')).toContainText('DEV-900');
    await semViolacaoAxe(page, `${TELA} (início)`);

    // A devolução sem nota vira NF-e com um clique.
    await tela.getByTestId('nfe-emitir-devolucao-900').click();
    await expect(tela.getByText(/NF-e 1 autorizada pelo simulador/)).toBeVisible();
    expect(corpos[0]?.corpo).toEqual({ origem: 'devolucao_fornecedor', devolucao: 900 });
    await expect(tela.getByTestId('nfe-sem-devolucao')).toBeVisible();
    await expect(tela.getByTestId('nfe-situacao-1')).toContainText('Autorizada');

    // Remessa para conserto: CFOP da natureza e totais na hora; o botão só liga com o pedido completo.
    const montar = tela.getByTestId('nfe-montar');
    await expect(montar.getByTestId('nfe-cfop')).toContainText('5915');
    await expect(montar.getByTestId('nfe-emitir')).toBeDisabled();
    await escolher(montar.getByTestId('nfe-destinatario'), { rotulo: /FORNECEDOR SINTETICO SP/ });
    await escolher(montar.getByTestId('nfe-item-insumo-0'), { rotulo: /BOMBA DE INFUSAO/ });
    await montar.getByTestId('nfe-item-quantidade-0').fill('2');
    await montar.getByTestId('nfe-item-valor-0').fill('150');
    await expect(montar.getByTestId('nfe-totais')).toContainText('300,00');
    await semViolacaoAxe(page, `${TELA} (conserto)`);
    await montar.getByTestId('nfe-emitir').click();
    await expect.poll(() => corpos.length).toBe(2);
    expect(corpos[1]?.corpo).toMatchObject({
      origem: 'conserto',
      fornecedor: 41,
      itens: [{ insumo: 501, quantidade: 2, valorUnitario: 150 }],
    });

    // Sem resposta da Sefaz a nota fica assinada; a transmissão a leva a autorizada, sem emitir outra.
    await expect(tela.getByTestId('nfe-situacao-2')).toContainText('Assinada');
    await expect(tela.getByTestId('nfe-corrigir-2')).toHaveCount(0);
    await tela.getByTestId('nfe-transmitir-2').click();
    await expect(tela.getByText(/NF-e 2 autorizada pela Sefaz/)).toBeVisible();
    expect(corpos[2]?.caminho).toBe(`${API}/2/transmitir`);
    await expect(tela.getByTestId('nfe-situacao-2')).toContainText('Autorizada');
    await expect(tela.getByTestId('nfe-transmitir-2')).toHaveCount(0);

    // Carta de correção: o texto curto é recusado na hora, antes de gravar.
    await tela.getByTestId('nfe-corrigir-1').click();
    const correcao = tela.getByTestId('nfe-correcao');
    await correcao.getByTestId('nfe-texto-correcao').fill('curto');
    await expect(correcao.getByTestId('nfe-recusa-correcao')).toBeVisible();
    await expect(correcao.getByTestId('nfe-confirmar-correcao')).toBeDisabled();
    await correcao.getByTestId('nfe-texto-correcao').fill('Corrigir o endereço de entrega do transportador.');
    await expect(correcao.getByTestId('nfe-recusa-correcao')).toHaveCount(0);
    await correcao.getByTestId('nfe-confirmar-correcao').click();
    await expect(tela.getByTestId('nfe-situacao-1')).toContainText('1 carta(s) de correção');

    // Cancelamento: motivo e justificativa de 15 caracteres ou mais, conferidos enquanto se digita.
    await tela.getByTestId('nfe-cancelar-1').click();
    const cancelamento = tela.getByTestId('nfe-cancelamento');
    await escolher(cancelamento.getByTestId('nfe-motivo'), { rotulo: /ERRO DE EMISSAO/ });
    await cancelamento.getByTestId('nfe-justificativa').fill('curta');
    await expect(cancelamento.getByTestId('nfe-recusa-cancelamento')).toBeVisible();
    await expect(cancelamento.getByTestId('nfe-confirmar-cancelamento')).toBeDisabled();
    await cancelamento
      .getByTestId('nfe-justificativa')
      .fill('Devolução registrada em duplicidade pelo almoxarifado.');
    await semViolacaoAxe(page, `${TELA} (cancelar)`);
    await cancelamento.getByTestId('nfe-confirmar-cancelamento').click();
    await expect(tela.getByTestId('nfe-situacao-1')).toContainText('Cancelada');
    expect(corpos.at(-1)?.corpo).toMatchObject({ motivo: 7 });

    // O histórico mostra os eventos (a cancelada continua na lista).
    await tela.getByTestId('nfe-historico-1').click();
    await expect(tela.getByTestId('nfe-historico-eventos')).toContainText('Autorização');
    await expect(tela.getByTestId('nfe-historico-eventos')).toContainText('Carta de correção');

    // O item no menu.
    await page.goto('/inicio');
    await (await itemDoMenu(page, 'NF-e de saída de mercadoria')).click();
    await expect(page).toHaveURL(new RegExp(`${TELA}$`));
    expect(externas).toEqual([]);
  });
});
