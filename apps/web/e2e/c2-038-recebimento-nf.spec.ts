// E2E @C2-038 (05-SUP linha 21): recebimento por nota fiscal com a conferência física e os impostos por item. As rotas
// `/api/suprimentos/conferencias-recebimento` só existem no banco do cliente (na fonte sintética do E2E e do CI
// respondem 503), então este E2E as simula com um estado em memória que segue a regra do servidor (a divergência do item
// é o apontamento; a divergente só se valida com justificativa; a nota liga a conferência validada). O que fica no banco
// (conferência, itens, impostos por item, custo de entrada e a ligação com a nota) é provado no contrato de efeito
// `apps/api/src/modulos/suprimentos/recebimento-nf.int.spec.ts`; o resto (fornecedor, busca de itens, leitura do XML e o
// POST da nota) é a API real da porta sintética. Aqui se prova o fluxo da tela: o almoxarife abre "Entrada por nota
// fiscal" pelo menu, segue o atalho da conferência física, registra a entrega de um item com avaria (a regra do domínio
// avisa na hora e trava o botão até a descrição) e grava: a conferência fica "Divergente". Outra pessoa (o comprador)
// valida: sem justificativa, a regra avisa e trava o botão; com a justificativa, fica "Validada". Depois a nota entra pelo
// XML SINTÉTICO com ICMS e IPI no item: o item do estoque é ligado à linha do XML (quantidade e impostos vêm dela), o
// custo de entrada aparece na hora (produtos + IPI, sem crédito de ICMS, padrão do hospital) e a conferência validada é
// escolhida e vai no POST da nota. axe sem violação séria. Massa SINTÉTICA; nenhum dado de pessoa.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const C = '/api/suprimentos/conferencias-recebimento';
const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

interface ItemConf {
  sequencia: number;
  item: number;
  nome: string;
  esperada: number | null;
  conferida: number;
  lote: string | null;
  validade: string | null;
  divergencia: string;
  observacao: string | null;
}
interface Conf {
  id: number;
  tipo: string;
  fornecedor: number;
  fornecedorNome: string;
  local: number;
  localNome: string;
  numeroNota: string | null;
  chegadaEm: string;
  situacao: string;
  conferente: string | null;
  validador: string | null;
  nota: number | null;
  itens: number;
  divergentes: number;
  observacao: string | null;
  motivoCancelamento: string | null;
  itensDetalhe: ItemConf[];
}
const problema = (rota: Route, titulo: string) =>
  rota.fulfill({
    status: 422,
    contentType: 'application/problem+json',
    body: JSON.stringify({ type: 'about:blank', title: titulo, status: 422, detail: titulo }),
  });

interface Estado {
  login: string;
  confs: Conf[];
  notas: Record<string, unknown>[];
}
/** Simula a conferência do recebimento como o servidor (estado em memória) e observa o POST real da nota. */
async function simularConferencias(page: Page, estado: Estado) {
  await page.route(`**${C}**`, async (rota) => {
    const req = rota.request();
    const url = new URL(req.url());
    const caminho = url.pathname;
    const id = Number(/conferencias-recebimento\/(\d+)/.exec(caminho)?.[1] ?? 0);
    const conf = estado.confs.find((c) => c.id === id);
    if (req.method() === 'GET') {
      if (caminho.includes('/pedido/')) return json(rota, []);
      if (id) return conf ? json(rota, conf) : json(rota, { title: 'Conferência inexistente' }, 404);
      const situacao = url.searchParams.get('situacao');
      return json(
        rota,
        estado.confs.filter((c) => !situacao || c.situacao === situacao),
      );
    }
    const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    if (caminho.endsWith('/validar')) {
      if (!conf) return json(rota, { title: 'Conferência inexistente' }, 404);
      if (conf.conferente === estado.login)
        return problema(rota, 'Quem conferiu não valida a própria conferência.');
      if (conf.situacao === 'divergente' && !String(corpo['justificativa'] ?? '').trim())
        return problema(rota, 'A conferência divergente só se valida com justificativa.');
      conf.situacao = 'validada';
      conf.validador = estado.login;
      return json(rota, { id: conf.id, situacao: conf.situacao, divergentes: conf.divergentes });
    }
    if (caminho.endsWith('/cancelar')) return problema(rota, 'Fora deste teste.');
    const itens = (corpo['itens'] ?? []) as {
      item: number;
      esperada: number | null;
      conferida: number;
      lote?: string | null;
      validade?: string | null;
      apontamento?: string | null;
      observacao?: string | null;
    }[];
    const detalhe: ItemConf[] = itens.map((i, k) => ({
      sequencia: k + 1,
      item: i.item,
      nome: `ITEM ${i.item}`,
      esperada: i.esperada,
      conferida: i.conferida,
      lote: i.lote ?? null,
      validade: i.validade ?? null,
      divergencia: i.apontamento ?? 'nenhuma',
      observacao: i.observacao ?? null,
    }));
    const divergentes = detalhe.filter((i) => i.divergencia !== 'nenhuma').length;
    const nova: Conf = {
      id: 3800 + estado.confs.length + 1,
      tipo: String(corpo['tipo'] ?? 'compra'),
      fornecedor: Number(corpo['fornecedor']),
      fornecedorNome: 'FORNECEDOR SINTÉTICO',
      local: Number(corpo['local']),
      localNome: 'ALMOXARIFADO SINTÉTICO',
      numeroNota: (corpo['numeroNota'] as string | null) ?? null,
      chegadaEm: new Date().toISOString(),
      situacao: divergentes ? 'divergente' : 'conferida',
      conferente: estado.login,
      validador: null,
      nota: null,
      itens: detalhe.length,
      divergentes,
      observacao: null,
      motivoCancelamento: null,
      itensDetalhe: detalhe,
    };
    estado.confs.push(nova);
    return json(rota, { id: nova.id, situacao: nova.situacao, divergentes });
  });
  // O POST da nota vai à API real; quando grava, a conferência levada fica ligada a ela (como faz o servidor).
  await page.route('**/api/suprimentos/notas', async (rota) => {
    const req = rota.request();
    if (req.method() !== 'POST') return rota.continue();
    const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    const resposta = await rota.fetch();
    if (resposta.ok()) {
      estado.notas.push(corpo);
      const ligada = estado.confs.find((c) => c.id === Number(corpo['conferencia']));
      if (ligada && ligada.situacao === 'validada') ligada.nota = Number(corpo['numero']);
    }
    return rota.fulfill({ response: resposta });
  });
}

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** NF-e sintética de um item: 10 unidades a R$ 12,00; ICMS 18% e IPI 5% (por fora). */
function xmlSintetico(numero: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc><NFe><infNFe Id="NFe35261100000000000191550010000${String(numero).padStart(5, '0')}1000000010">
<ide><nNF>${numero}</nNF><serie>1</serie><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide>
<emit><CNPJ>00000000000191</CNPJ><xNome>Distribuidora sintética</xNome></emit>
<det nItem="1"><prod><cProd>SINT-001</cProd><xProd>Insumo sintético</xProd><uCom>UN</uCom><qCom>10.0000</qCom>
<vUnCom>12.0000</vUnCom><vProd>120.00</vProd></prod>
<imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>120.00</vBC><pICMS>18.00</pICMS><vICMS>21.60</vICMS></ICMS00></ICMS>
<IPI><IPITrib><CST>50</CST><vBC>120.00</vBC><pIPI>5.00</pIPI><vIPI>6.00</vIPI></IPITrib></IPI></imposto></det>
<total><ICMSTot><vBC>120.00</vBC><vICMS>21.60</vICMS><vProd>120.00</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg>
<vDesc>0.00</vDesc><vIPI>6.00</vIPI><vOutro>0.00</vOutro><vNF>126.00</vNF></ICMSTot></total>
</infNFe></NFe></nfeProc>`;
}

test.describe('Recebimento por nota fiscal com conferência física e impostos @C2-038', () => {
  test.setTimeout(240_000);

  test('conferência com avaria, validada por outra pessoa, e a nota do XML com impostos usa a conferência', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const estado: Estado = { login: 'SINT.ALMOXARIFE', confs: [], notas: [] };
    await simularConferencias(page, estado);
    await entrar(page, 'SINT.ALMOXARIFE');

    const fornecedores = (await (await page.request.get('/api/suprimentos/fornecedores?termo=a')).json()) as
      { itens?: { codigo?: number; id?: number }[] } | { codigo?: number; id?: number }[];
    const lista = Array.isArray(fornecedores) ? fornecedores : (fornecedores.itens ?? []);
    const fornecedor = lista[0]?.codigo ?? lista[0]?.id ?? null;
    expect(fornecedor, 'fornecedor ativo na porta sintética').not.toBeNull();

    // ── Conferência física pela tela ──
    await page.getByRole('link', { name: 'Entrada por nota fiscal' }).first().click();
    await expect(page).toHaveURL(/\/suprimentos\/notas-fiscais$/);
    await page.getByTestId('nf-conferencias').click();
    const tela = page.getByTestId('tela-conferencia-recebimento');
    await expect(tela).toBeVisible();
    await semViolacaoAxe(page, '/suprimentos/notas-fiscais/conferencias');

    await tela.getByTestId('conf-fornecedor').fill(String(fornecedor));
    await escolher(tela.getByTestId('conf-local'), { indice: 1 });
    await tela.getByTestId('conf-busca-termo').fill('a');
    await tela.getByTestId('conf-busca-buscar').click();
    const opcoes = tela.locator('[data-testid^="conf-busca-opcao-"]');
    await expect(opcoes.first()).toBeVisible();
    const testid = (await opcoes.first().getAttribute('data-testid'))!;
    const item = Number(testid.replace('conf-busca-opcao-', ''));
    await opcoes.first().click();
    const linha = tela.getByTestId(`conf-linha-${item}`);
    await expect(linha).toBeVisible();
    await tela.getByTestId(`conf-qtde-${item}`).fill('10');
    const comLote = (await tela.getByTestId(`conf-lote-${item}`).count()) > 0;
    if (comLote) {
      await tela.getByTestId(`conf-lote-${item}`).fill('LOTE-SINT-38');
      await tela.getByTestId(`conf-validade-${item}`).fill('2029-12-31');
    }
    // Apontamento sem descrição: a regra do domínio avisa na hora e o botão fica travado.
    await escolher(tela.getByTestId(`conf-apontamento-${item}`), { rotulo: 'Avaria' });
    await expect(tela.getByTestId('conf-aviso')).toBeVisible();
    await expect(tela.getByTestId('conf-registrar')).toBeDisabled();
    await tela.getByTestId(`conf-observacao-${item}`).fill('Caixa externa amassada, conteúdo íntegro');
    await expect(tela.getByTestId('conf-aviso')).toHaveCount(0);
    await expect(tela.getByTestId(`conf-divergencia-${item}`)).toHaveText('Avaria');
    await tela.getByTestId('conf-registrar').click();
    await expect(tela.getByTestId('conf-mensagem')).toContainText('Divergente');
    const detalhe = tela.getByTestId('conf-detalhe');
    await expect(detalhe).toBeVisible();
    const conferencia = Number(
      ((await detalhe.getByRole('heading').first().textContent()) ?? '').replace(/\D+/g, ''),
    );
    expect(conferencia).toBeGreaterThan(0);

    // ── Validação por outra pessoa ──
    estado.login = 'SINT.COMPRADOR';
    await entrar(page, 'SINT.COMPRADOR');
    await page.goto('/suprimentos/notas-fiscais/conferencias');
    await escolher(tela.getByTestId('conf-filtro'), { rotulo: 'Divergente' });
    await tela.getByTestId(`conf-abrir-${conferencia}`).click();
    await expect(tela.getByTestId('conf-aviso-validar')).toBeVisible();
    await expect(tela.getByTestId('conf-validar')).toBeDisabled();
    await tela.getByTestId('conf-justificativa').fill('Avaria só na caixa externa; produto aceito');
    await expect(tela.getByTestId('conf-validar')).toBeEnabled();
    await tela.getByTestId('conf-validar').click();
    await expect(tela.getByTestId('conf-mensagem')).toContainText('validada');
    await semViolacaoAxe(page, '/suprimentos/notas-fiscais/conferencias');

    // ── A nota pelo XML sintético, com os impostos e a conferência ligada ──
    estado.login = 'SINT.ALMOXARIFE';
    await entrar(page, 'SINT.ALMOXARIFE');
    await page.goto('/suprimentos/notas-fiscais');
    const nf = page.getByTestId('tela-suprimentos-notas');
    const numeroNota = 38_000 + (Date.now() % 900);
    await nf.getByTestId('nf-xml').setInputFiles({
      name: 'nfe-sintetica.xml',
      mimeType: 'text/xml',
      buffer: Buffer.from(xmlSintetico(numeroNota)),
    });
    await expect(nf.getByTestId('nf-numero')).toHaveValue(String(numeroNota));
    await nf.getByTestId('nf-fornecedor').fill(String(fornecedor));
    await escolher(nf.getByTestId('nf-local'), { indice: 1 });
    await nf.getByTestId('nf-busca-termo').fill(String(item));
    await nf.getByTestId('nf-busca-buscar').click();
    await nf.getByTestId(`nf-busca-opcao-${item}`).click();
    await escolher(nf.getByTestId(`nf-xml-linha-${item}`), { indice: 1 });
    await expect(nf.getByTestId(`nf-qtde-${item}`)).toHaveValue('10');
    await expect(nf.getByTestId(`nf-impostos-${item}`)).toContainText('ICMS');
    await expect(nf.getByTestId(`nf-impostos-${item}`)).toContainText('IPI');
    // Custo de entrada: 120,00 + IPI 6,00 (o ICMS próprio já está no preço e o hospital não toma crédito).
    await expect(nf.getByTestId('nf-custo-entrada')).toContainText('126,00');
    if (comLote) {
      await nf.getByTestId(`nf-lote-${item}-0`).fill('LOTE-SINT-38');
      await nf.getByTestId(`nf-validade-${item}-0`).fill('2029-12-31');
      await nf.getByTestId(`nf-lote-qtde-${item}-0`).fill('10');
    }
    await escolher(nf.getByTestId('nf-conferencia'), { rotulo: new RegExp(`^${conferencia} `) });
    await semViolacaoAxe(page, '/suprimentos/notas-fiscais');
    await nf.getByTestId('nf-gravar').click();
    await expect(page.getByTestId('nf-mensagem')).toBeVisible();

    // A nota gravou levando a conferência validada (a ligação no banco é do contrato de efeito).
    await expect.poll(() => estado.notas.length).toBe(1);
    expect(estado.notas[0]?.['conferencia']).toBe(conferencia);
    const depois = estado.confs.find((c) => c.id === conferencia);
    expect(depois?.situacao).toBe('validada');
    expect(depois?.validador).toBe('SINT.COMPRADOR');
    expect(depois?.nota).not.toBeNull();
    expect(externas).toEqual([]);
  });
});
