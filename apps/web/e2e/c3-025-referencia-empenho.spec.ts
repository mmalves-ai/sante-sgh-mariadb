// E2E @C3-025 (07-FIN linha 132): só a referência do empenho no pedido de compra e no título a pagar, com o arquivo para
// o ente (a execução orçamentária fica no sistema contábil do ente). A autoridade entra pelo menu (Suprimentos > Compras >
// Ata de registro de preços e empenho), escolhe um empenho em vigor no painel da referência, vê o resumo (empenhado,
// referido, saldo), refere o empenho num pedido e num título do mesmo credor (a busca é remota), vê recusado o título que
// passaria do valor empenhado e baixa o CSV do período com o cabeçalho para o ente. axe sem violação séria.
// A ata e o empenho só existem no banco do cliente (na fonte sintética do E2E respondem 503), então este E2E simula
// `/api/suprimentos/atas-registro-preco*` e `/api/suprimentos/empenhos*` com um estado em memória que aplica as mesmas
// regras do domínio (conferirVinculoPedidoEmpenho, conferirVinculoTituloEmpenho, saldoReferenciaEmpenho e
// exportacaoEmpenhoCsv), como os specs do SLA e do encontro de contas. Massa SINTÉTICA, nenhum dado de pessoa.
import {
  conferirSemOutroEmpenho,
  conferirVinculoPedidoEmpenho,
  conferirVinculoTituloEmpenho,
  exportacaoEmpenhoCsv,
  type RecusaSuprimentos,
  saldoReferenciaEmpenho,
} from '@sgh/contratos/regras-suprimentos';
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
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

const CREDOR = 7001;
const EMPENHO = {
  id: 9101,
  numero: 'EMP-E2E-C3025',
  emitidoEm: new Date().toISOString().slice(0, 10),
  fornecedor: 'Fornecedor Sintético C3-025',
  fonteRecurso: '1500',
  valorTotal: 1000,
  situacao: 'emitido',
  ata: null,
  itens: 1,
  versao: 1,
  motivoAnulacao: null,
};

interface PedidoSim {
  id: number;
  numero: string;
  situacao: string;
  fornecedor: number;
  versao: number;
  empenho: number | null;
}
interface TituloSim {
  id: number;
  numero: string;
  documento: string;
  emissao: string;
  valorLiquido: number;
  situacao: string;
  credor: number;
  versao: number;
  empenho: number | null;
}

/** As rotas da ata e do empenho, com o estado em memória e as regras do domínio. */
async function simularEmpenho(page: Page): Promise<void> {
  const pedidos: PedidoSim[] = [
    { id: 9201, numero: 'PC-E2E-9201', situacao: 'aprovado', fornecedor: CREDOR, versao: 1, empenho: null },
  ];
  const titulos: TituloSim[] = [
    {
      id: 9301,
      numero: 'TP-E2E-9301',
      documento: 'NF 9301',
      emissao: EMPENHO.emitidoEm,
      valorLiquido: 400,
      situacao: 'aberto',
      credor: CREDOR,
      versao: 1,
      empenho: null,
    },
    {
      id: 9302,
      numero: 'TP-E2E-9302',
      documento: 'NF 9302',
      emissao: EMPENHO.emitidoEm,
      valorLiquido: 700,
      situacao: 'aberto',
      credor: CREDOR,
      versao: 1,
      empenho: null,
    },
  ];
  const empenhoReferido = { situacao: EMPENHO.situacao, credor: CREDOR, valorTotal: EMPENHO.valorTotal };
  const referido = () =>
    titulos.filter((t) => t.empenho === EMPENHO.id).reduce((a, t) => a + t.valorLiquido, 0);
  const json = (r: Route, status: number, corpo: unknown) =>
    r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
  const recusado = (r: Route, x: RecusaSuprimentos) =>
    r.fulfill({
      status: 422,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: `urn:sgh:problema:${x.codigo}`,
        title: x.mensagem,
        status: 422,
        detail: x.mensagem,
      }),
    });

  await page.route(/\/api\/suprimentos\/(atas-registro-preco|empenhos)(\/|\?|$)/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const caminho = url.pathname.replace(/^.*\/api\/suprimentos\//, '');
    if (caminho.startsWith('atas-registro-preco')) return json(route, 200, []);
    if (req.method() === 'GET' && caminho === 'empenhos') return json(route, 200, [EMPENHO]);
    if (req.method() === 'GET' && caminho === 'empenhos/exportacao') {
      const ligados = titulos.filter((t) => t.empenho === EMPENHO.id);
      const pedido = pedidos.find((p) => p.empenho === EMPENHO.id)?.numero ?? null;
      const base = {
        empenho: EMPENHO.numero,
        emitidoEm: EMPENHO.emitidoEm,
        fonteRecurso: EMPENHO.fonteRecurso,
        naturezaDespesa: '339030',
        valorEmpenho: EMPENHO.valorTotal,
        credorDocumento: '00000000000191',
        credorNome: EMPENHO.fornecedor,
        pedido,
      };
      const linhas =
        EMPENHO.emitidoEm >= (url.searchParams.get('inicio') ?? '') &&
        EMPENHO.emitidoEm <= (url.searchParams.get('fim') ?? '')
          ? ligados.length
            ? ligados.map((t) => ({
                ...base,
                titulo: t.numero,
                documento: t.documento,
                emissaoDocumento: t.emissao,
                valorTitulo: t.valorLiquido,
                situacaoTitulo: t.situacao,
              }))
            : [
                {
                  ...base,
                  titulo: null,
                  documento: null,
                  emissaoDocumento: null,
                  valorTitulo: null,
                  situacaoTitulo: null,
                },
              ]
          : [];
      return route.fulfill({
        status: 200,
        contentType: 'text/csv; charset=utf-8',
        body: exportacaoEmpenhoCsv(linhas),
      });
    }
    const m = /^empenhos\/(\d+)\/(referencias|candidatos|pedidos|titulos)$/.exec(caminho);
    if (!m || Number(m[1]) !== EMPENHO.id) return json(route, 404, { title: 'Não simulado', status: 404 });
    if (m[2] === 'referencias')
      return json(route, 200, {
        empenho: EMPENHO.id,
        numero: EMPENHO.numero,
        valorTotal: EMPENHO.valorTotal,
        referido: referido(),
        saldo: saldoReferenciaEmpenho(EMPENHO.valorTotal, referido()),
        pedidos: pedidos
          .filter((p) => p.empenho === EMPENHO.id)
          .map((p) => ({ id: p.id, numero: p.numero, situacao: p.situacao })),
        titulos: titulos
          .filter((t) => t.empenho === EMPENHO.id)
          .map((t) => ({
            id: t.id,
            numero: t.numero,
            documento: t.documento,
            valorLiquido: t.valorLiquido,
            situacao: t.situacao,
          })),
      });
    if (m[2] === 'candidatos') {
      const termo = (url.searchParams.get('termo') ?? '').toUpperCase();
      return json(route, 200, {
        pedidos: pedidos
          .filter((p) => p.empenho === null && p.numero.includes(termo))
          .map((p) => ({ id: p.id, rotulo: p.numero, versao: p.versao, valor: null })),
        titulos: titulos
          .filter((t) => t.empenho === null && t.numero.includes(termo))
          .map((t) => ({
            id: t.id,
            rotulo: `${t.numero} ${t.documento}`,
            versao: t.versao,
            valor: t.valorLiquido,
          })),
      });
    }
    const corpo = req.postDataJSON() as { id: number; versao: number };
    if (m[2] === 'pedidos') {
      const p = pedidos.find((x) => x.id === corpo.id)!;
      const r =
        conferirSemOutroEmpenho(p.empenho, EMPENHO.id) ?? conferirVinculoPedidoEmpenho(empenhoReferido, p);
      if (r) return recusado(route, r);
      p.empenho = EMPENHO.id;
      p.versao += 1;
    } else {
      const t = titulos.find((x) => x.id === corpo.id)!;
      const r =
        conferirSemOutroEmpenho(t.empenho, EMPENHO.id) ??
        conferirVinculoTituloEmpenho(empenhoReferido, t, referido());
      if (r) return recusado(route, r);
      t.empenho = EMPENHO.id;
      t.versao += 1;
    }
    return json(route, 200, {
      id: EMPENHO.id,
      numero: EMPENHO.numero,
      itens: 1,
      valorTotal: EMPENHO.valorTotal,
    });
  });
}

test.describe('@C3-025 referência do empenho no pedido e no título', () => {
  test('refere o empenho em vigor no pedido e no título do credor e baixa o arquivo para o ente', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await simularEmpenho(page);
    await entrar(page, 'SINT.AUTORIDADE');
    // O menu abre recolhido: Suprimentos > Compras antes do item.
    const menu = page.getByRole('navigation', { name: 'Menu principal' });
    await menu.getByRole('button', { name: /^Suprimentos/ }).click();
    const compras = menu.getByRole('button', { name: /^Compras/ });
    if ((await compras.count()) > 0 && (await compras.first().getAttribute('aria-expanded')) !== 'true')
      await compras.first().click();
    await menu.getByRole('link', { name: 'Ata de registro de preços e empenho' }).click();
    await expect(page).toHaveURL(/\/suprimentos\/atas-registro-preco/);
    const painel = page.getByTestId('ref-empenho');
    await expect(painel).toBeVisible();

    await escolher(painel.getByTestId('ref-empenho-escolha'), { rotulo: new RegExp(EMPENHO.numero) });
    await expect(painel.getByTestId('ref-resumo')).toContainText('saldo');
    await semViolacaoAxe(page, '/suprimentos/atas-registro-preco');

    // O pedido do mesmo credor recebe a referência e passa à lista do empenho.
    await escolher(painel.getByTestId('ref-pedido'), { rotulo: /PC-E2E-9201/ });
    await painel.getByTestId('ref-referir-pedido').click();
    await expect(painel.getByTestId('ref-mensagem')).toContainText(EMPENHO.numero);
    await expect(painel.getByTestId('ref-pedidos')).toContainText('PC-E2E-9201');

    // O título de 400 cabe no empenho de 1.000; o de 700 passaria do valor empenhado e é recusado.
    await escolher(painel.getByTestId('ref-titulo'), { rotulo: /TP-E2E-9301/ });
    await painel.getByTestId('ref-referir-titulo').click();
    await expect(painel.getByTestId('ref-titulos')).toContainText('TP-E2E-9301');
    await expect(painel.getByTestId('ref-resumo')).toContainText(/600,00/);
    await escolher(painel.getByTestId('ref-titulo'), { rotulo: /TP-E2E-9302/ });
    await painel.getByTestId('ref-referir-titulo').click();
    await expect(painel.getByTestId('recusa-suprimentos')).toContainText('acima do empenho');
    await expect(painel.getByTestId('ref-titulos')).not.toContainText('TP-E2E-9302');

    // O arquivo para o ente: cabeçalho fixo e o empenho do período, com o pedido e o título referidos.
    await painel.getByTestId('ref-inicio').fill('2000-01-01');
    const href = await painel.getByTestId('ref-baixar').getAttribute('href');
    expect(href).toContain('inicio=2000-01-01');
    const csv = await page.evaluate(async (u) => (await fetch(u!)).text(), href);
    expect(csv.split('\r\n')[0]).toBe(
      'empenho;emitido_em;fonte_recurso;natureza_despesa;valor_empenho;credor_documento;credor_nome;pedido;titulo;documento;emissao_documento;valor_titulo;situacao_titulo',
    );
    expect(csv).toContain(`${EMPENHO.numero};`);
    expect(csv).toContain(';PC-E2E-9201;TP-E2E-9301;NF 9301;');
    expect(externas).toEqual([]);
  });
});
