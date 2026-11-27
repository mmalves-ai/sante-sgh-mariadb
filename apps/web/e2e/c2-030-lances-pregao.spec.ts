// E2E @C2-030 (05-SUP linha 26): os lances da disputa aberta do pregão pelo caminho da tela,
// Lei 14.133/2021, art. 56 e 57. O agente de contratação abre a tela da licitação pelo menu (Suprimentos > Compras >
// Licitação e pregão), segue o atalho "Lances da disputa", escolhe o pregão em sessão e, no primeiro item, tenta um lance
// que não melhora a oferta (a regra do domínio avisa na hora e trava o botão) e registra um lance válido. Ao recarregar a
// tela, o lance segue no histórico do item e na oferta do licitante. axe sem violação séria. Os lances só existem no banco
// do cliente (na fonte sintética do E2E a API responde 503): as respostas são simuladas pelo Playwright com massa
// SINTÉTICA, no contrato do servidor (lance-pregao.controller.ts), e a simulação confere o lance pela mesma regra do
// domínio; o efeito no banco é provado por lance-pregao.int.spec.ts. Nenhum dado de pessoa.
import { expect, type Page, type Route, test } from '@playwright/test';
import { podeRegistrarLance } from '@sgh/contratos/regras-suprimentos';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

interface Disputa {
  id: number;
  numero: string;
  objeto: string;
  sentido: 'menor' | 'maior' | null;
  itens: {
    sequencia: number;
    propostas: {
      fornecedor: number;
      fornecedorNome: string;
      valor: number;
      ultimoLance: number | null;
      apta: boolean;
    }[];
    lances: { fornecedor: number; valor: number }[];
  }[];
}

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

function novaDisputa() {
  return {
    id: 94001,
    numero: 'PE-C2030L/2030',
    objeto: 'Pregão sintético de seringas',
    etapa: 'sessao',
    modalidade: 'pregao_eletronico',
    sentido: 'menor' as const,
    itens: [
      {
        id: 94101,
        sequencia: 1,
        descricao: 'SERINGA SINTETICA 10ML',
        quantidade: 1000,
        propostas: [
          {
            fornecedor: 94201,
            fornecedorNome: 'FORNECEDOR SINTETICO A',
            valor: 1.2,
            ultimoLance: null,
            apta: true,
          },
          {
            fornecedor: 94202,
            fornecedorNome: 'FORNECEDOR SINTETICO B',
            valor: 1.25,
            ultimoLance: null,
            apta: true,
          },
        ],
        lances: [] as { id: number; fornecedor: number; rodada: number; valor: number; em: string }[],
        classificacao: [
          { fornecedor: 94201, valor: 1.2, posicao: 1 },
          { fornecedor: 94202, valor: 1.25, posicao: 2 },
        ],
      },
    ],
  };
}

/** O servidor simulado: confere o lance pela regra do domínio e grava no histórico e na oferta do licitante. */
async function simular(page: Page, d: ReturnType<typeof novaDisputa>): Promise<void> {
  await page.route(/\/api\/suprimentos\/lances-pregao/, (r) => {
    const caminho = new URL(r.request().url()).pathname.replace(/^.*\/lances-pregao/, '');
    const metodo = r.request().method();
    if (caminho === '' && metodo === 'GET')
      return json(r, [{ id: d.id, numero: d.numero, objeto: d.objeto, modalidade: d.modalidade }]);
    if (caminho !== `/${d.id}`) return r.fallback();
    if (metodo === 'GET') return json(r, d);
    const corpo = r.request().postDataJSON() as { item: number; fornecedor: number; valor: number };
    const item = d.itens.find((i) => i.id === corpo.item)!;
    const p = item.propostas.find((x) => x.fornecedor === corpo.fornecedor);
    const recusa = podeRegistrarLance({
      etapa: d.etapa,
      modalidade: d.modalidade,
      proposta: p ? { valor: p.valor, desclassificada: !p.apta, inabilitada: false } : null,
      lancesProprios: item.lances.filter((l) => l.fornecedor === corpo.fornecedor).map((l) => l.valor),
      valor: corpo.valor,
      intervaloMinimoPercentual: null,
    });
    if (recusa) return json(r, { status: 422, title: recusa.mensagem, codigo: recusa.codigo }, 422);
    const rodada = item.lances.filter((l) => l.fornecedor === corpo.fornecedor).length + 1;
    const id = 94300 + item.lances.length;
    item.lances.push({
      id,
      fornecedor: corpo.fornecedor,
      rodada,
      valor: corpo.valor,
      em: '2030-03-10T10:00:00Z',
    });
    Object.assign(p!, { ultimoLance: corpo.valor });
    item.classificacao = item.propostas
      .map((x) => ({ fornecedor: x.fornecedor, valor: x.ultimoLance ?? x.valor }))
      .sort((a, b) => a.valor - b.valor)
      .map((x, k) => ({ ...x, posicao: k + 1 }));
    const posicao = item.classificacao.find((c) => c.fornecedor === corpo.fornecedor)!.posicao;
    return json(
      r,
      { id, item: item.id, fornecedor: corpo.fornecedor, rodada, valor: corpo.valor, posicao },
      201,
    );
  });
}

test.describe('Lances do pregão @C2-030', () => {
  test.setTimeout(180_000);

  test('o lance que não melhora é avisado na hora; o válido fica gravado no histórico do item', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const d = novaDisputa();
    await simular(page, d);
    await entrar(page, 'SINT.LICITACAO');

    // page.request não passa pela simulação da página: a disputa vem do mesmo estado do servidor simulado.
    const disputa: Disputa = d;
    const item = disputa.itens[0]!;
    const licitante = item.propostas.find((x) => x.apta)!;
    const proprios = item.lances.filter((l) => l.fornecedor === licitante.fornecedor).map((l) => l.valor);
    const anterior = Math.min(licitante.valor, ...proprios);
    const lance = Math.round(anterior * 0.95 * 100) / 100;
    test.skip(!(lance > 0 && lance < anterior), 'A oferta anterior não deixa lance menor com 2 casas.');

    // Pelo menu (as áreas começam recolhidas: a busca do menu abre a área com o item).
    await (await itemDoMenu(page, 'Licitação e pregão')).click();
    await expect(page).toHaveURL(/\/suprimentos\/licitacao/);
    await page.getByTestId('lic-lances').click();
    await expect(page.getByTestId('tela-lances-pregao')).toBeVisible();
    await semViolacaoAxe(page, '/suprimentos/licitacao/lances');

    await escolher(page.getByTestId('lance-processo'), { rotulo: new RegExp(disputa.numero) });
    const s = item.sequencia;
    await escolher(page.getByTestId(`lance-licitante-${s}`), { rotulo: licitante.fornecedorNome });
    // Não melhora: a regra do domínio avisa na hora e o botão fica travado.
    await page.getByTestId(`lance-valor-${s}`).fill(String(anterior).replace('.', ','));
    await expect(page.getByTestId(`lance-aviso-${s}`)).toBeVisible();
    await expect(page.getByTestId(`lance-registrar-${s}`)).toBeDisabled();

    await page.getByTestId(`lance-valor-${s}`).fill(String(lance).replace('.', ','));
    await expect(page.getByTestId(`lance-aviso-${s}`)).toHaveCount(0);
    await page.getByTestId(`lance-registrar-${s}`).click();
    await expect(page.getByTestId('lance-mensagem')).toBeVisible();
    await expect(page.getByTestId(`lance-historico-${s}`)).toContainText(licitante.fornecedorNome);
    await semViolacaoAxe(page, '/suprimentos/licitacao/lances');

    // Recarregada a tela, o lance segue gravado (histórico e oferta do licitante).
    await page.reload();
    await escolher(page.getByTestId('lance-processo'), { rotulo: new RegExp(disputa.numero) });
    await expect(page.getByTestId(`lance-historico-${s}`)).toContainText(licitante.fornecedorNome);
    const oferta = d.itens[0]!.propostas.find((x) => x.fornecedor === licitante.fornecedor)!.ultimoLance;
    expect(oferta).toBe(lance);
    expect(externas).toEqual([]);
  });
});
