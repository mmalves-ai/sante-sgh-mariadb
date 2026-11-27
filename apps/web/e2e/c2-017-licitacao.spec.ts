// E2E @C2-017 (09-AREA linha 81): o processo de contratação pública sobre a porta PRÓPRIA (MariaDB, cliente de teste),
// Lei 14.133/2021. O agente de contratação abre uma dispensa por valor (art. 75, II), passa pela pesquisa de preços, pela
// proposta do fornecedor e pelo julgamento; não homologa o que conduz (segregação de funções, art. 7º). A autoridade
// entra pelo menu (Suprimentos > Compras > Licitação e pregão), acha o processo pelo filtro e homologa. Ao recarregar a
// tela, o processo continua homologado e o histórico (só de inclusão) traz os atos: o que prova que ficou no banco e não
// na memória. axe sem violação séria. O fornecedor vem da busca da própria rota (massa SINTÉTICA do cliente de teste);
// sem fornecedor, o teste é pulado com o motivo dito. Nenhum dado de pessoa.
//
// Segundo teste (solicitação de compra com a fonte de recurso por item, Lei 14.133, art. 72, IV, e art. 150): a
// gravação só existe na porta própria (na fonte sintética do E2E a API responde 503), então as rotas
// /api/suprimentos/solicitacoes-compra-publica são simuladas no contrato do servidor (ata-empenho.controller.ts), com a
// mesma regra do domínio (conferirFontesSolicitacao e fontePrincipal) e massa SINTÉTICA; o efeito no banco é provado
// por solicitacao-compra-fonte.int.spec.ts.
import { conferirFontesSolicitacao, fontePrincipal } from '@sgh/contratos/regras-suprimentos';
import { expect, type Page, type Route, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const L = '/api/suprimentos/licitacoes';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

function dia(deslocamento: number): string {
  const d = new Date();
  d.setDate(d.getDate() + deslocamento);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

const ORIGENS = [
  { id: 94001, codigo: '1.500.1002', descricao: 'Recurso federal sintético', esfera: 'federal' },
  { id: 94002, codigo: '1.500.1001', descricao: 'Recurso próprio sintético', esfera: 'municipal' },
];
const LOCAIS = [{ id: 94101, nome: 'ALMOXARIFADO SINTETICO' }];
const INSUMOS = [
  { id: 94201, nome: 'LUVA PROCEDIMENTO SINTETICA M' },
  { id: 94202, nome: 'SERINGA SINTETICA 10 ML' },
];

interface ItemEnviado {
  insumo: number;
  quantidade: number;
  valorUnitarioEstimado: number | null;
  fontes: { origem: number; quantidade: number | null; percentual: number | null }[];
}
interface Solicitacao {
  id: number;
  numero: number;
  corpo: { localEstoque: number; justificativa: string; itens: ItemEnviado[] };
  principal: number | null;
}

/** A solicitação com fonte como o servidor guarda: a regra do domínio recusa, a fonte principal é calculada. */
async function simularSolicitacao(page: Page, st: Solicitacao[]): Promise<void> {
  const codigo = (id: number | null) => ORIGENS.find((o) => o.id === id)?.codigo ?? null;
  const visao = (s: Solicitacao) => {
    const valor = s.corpo.itens.reduce((t, i) => t + i.quantidade * (i.valorUnitarioEstimado ?? 0), 0);
    return {
      id: s.id,
      numero: s.numero,
      situacao: 'aberta',
      solicitadoEm: new Date().toISOString(),
      processo: null,
      fontePrincipal: codigo(s.principal),
      valorEstimado: Math.round(valor * 100) / 100,
      itens: s.corpo.itens.map((i, k) => ({
        sequencia: k + 1,
        insumoNome: INSUMOS.find((x) => x.id === i.insumo)?.nome ?? '',
        quantidade: i.quantidade,
        valorUnitarioEstimado: i.valorUnitarioEstimado,
        fontes: i.fontes.map((f) => ({
          codigo: codigo(f.origem) ?? '',
          descricao: ORIGENS.find((o) => o.id === f.origem)?.descricao ?? '',
          quantidade: f.quantidade,
          percentual: f.percentual,
        })),
      })),
    };
  };
  await page.route(
    /\/api\/suprimentos\/(atas-registro-preco|empenhos|adesoes-ata|solicitacoes-compra-publica)/,
    (r) => {
      const url = new URL(r.request().url());
      const caminho = url.pathname.replace(/^.*\/api\/suprimentos/, '');
      const metodo = r.request().method();
      if (caminho === '/solicitacoes-compra-publica/apoio') {
        const termo = (url.searchParams.get('termo') ?? '').trim().toUpperCase();
        return json(r, {
          origens: ORIGENS,
          locais: LOCAIS,
          insumos: termo ? INSUMOS.filter((i) => i.nome.includes(termo)) : [],
        });
      }
      if (caminho === '/solicitacoes-compra-publica' && metodo === 'GET') return json(r, st.map(visao));
      if (caminho === '/solicitacoes-compra-publica' && metodo === 'POST') {
        const corpo = r.request().postDataJSON() as Solicitacao['corpo'];
        const itens = corpo.itens.map((i) => ({
          quantidadeSolicitada: i.quantidade,
          valorUnitarioEstimado: i.valorUnitarioEstimado,
          fontes: i.fontes,
        }));
        const recusa = conferirFontesSolicitacao(itens, new Set(ORIGENS.map((o) => o.id)))[0];
        if (recusa)
          return json(
            r,
            { status: 422, codigo: recusa.codigo, title: 'Recusa', detail: recusa.mensagem },
            422,
          );
        const s: Solicitacao = {
          id: 94300 + st.length,
          numero: 7001 + st.length,
          corpo,
          principal: fontePrincipal(itens),
        };
        st.push(s);
        return json(r, { id: s.id, numero: String(s.numero), itens: itens.length, valorTotal: 0 }, 201);
      }
      if (metodo === 'GET' && /^\/(atas-registro-preco(\/processos)?|empenhos|adesoes-ata)$/.test(caminho))
        return json(r, []);
      return r.fallback();
    },
  );
}

test.describe('Contratação pública na porta própria @C2-017', () => {
  test.setTimeout(240_000);

  test('dispensa por valor gravada no banco: o agente conduz, a autoridade homologa e o histórico fica', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.LICITACAO');
    let seq = 0;
    const chave = () => `e2e-c2017-${Date.now().toString(36)}-${++seq}`;
    const post = async (url: string, data: Record<string, unknown>, esperado = 201) => {
      const k = chave();
      const csrf = (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '';
      const r = await page.request.post(url, {
        headers: { 'x-csrf': csrf, 'Idempotency-Key': k },
        data: { ...data, chave: k },
      });
      expect(r.status(), await r.text()).toBe(esperado);
      return (await r.json()) as Record<string, unknown>;
    };
    const versao = async (id: number) =>
      ((await (await page.request.get(`${L}/${id}`)).json()) as { versao: number }).versao;

    // O fornecedor sai da busca da rota (cadastro do cliente de teste), nunca de um código fixo da memória.
    let fornecedor: number | null = null;
    for (const termo of ['ltda', 'sint', 'forn', 'com', 'me']) {
      const r = (await (await page.request.get(`${L}/fornecedores?termo=${termo}`)).json()) as {
        itens: { codigo: number }[];
      };
      if (r.itens.length > 0) {
        fornecedor = r.itens[0]!.codigo;
        break;
      }
    }
    test.skip(fornecedor === null, 'Sem fornecedor cadastrado no cliente do E2E.');

    const numero = `DL-C2017-${Date.now() % 1_000_000}/2026`;
    const id = (
      await post(L, {
        numero,
        regime: 'lei-14133',
        modalidade: 'dispensa',
        fundamento: 'art. 75, II',
        natureza: 'servico-comum',
        objeto: 'Serviço sintético de manutenção de equipamentos (teste)',
        justificativa: 'Manutenção anual sintética dos equipamentos do setor (teste)',
        agente: 'SINT.LICITACAO',
        itens: [{ descricao: 'Manutenção sintética', unidade: 'UN', quantidade: 1 }],
      })
    ).id as number;
    await post(`${L}/${id}/etapas`, { versao: await versao(id), para: 'pesquisa' });
    const item = ((await (await page.request.get(`${L}/${id}`)).json()) as { itensDetalhe: { id: number }[] })
      .itensDetalhe[0]!.id;
    await post(`${L}/${id}/precos`, {
      versao: await versao(id),
      item,
      fonte: 'fornecedor',
      referencia: 'Cotação sintética',
      valor: 5000,
      data: dia(-1),
      fornecedor,
    });
    await post(`${L}/${id}/etapas`, {
      versao: await versao(id),
      para: 'sessao',
      justificativaPesquisa: 'Prestador único credenciado (sintético)',
    });
    await post(`${L}/${id}/propostas`, { versao: await versao(id), item, fornecedor, valor: 4800 });
    await post(`${L}/${id}/etapas`, { versao: await versao(id), para: 'julgado' });
    // Quem conduz não homologa.
    await post(`${L}/${id}/homologacao`, { versao: await versao(id), observacao: null }, 403);

    // A autoridade, pelo menu.
    await entrar(page, 'SINT.AUTORIDADE');
    const menu = page.getByRole('navigation', { name: 'Menu principal' });
    await menu.getByRole('button', { name: /^Suprimentos/ }).click();
    const compras = menu.getByRole('button', { name: /^Compras/ });
    if ((await compras.count()) > 0 && (await compras.first().getAttribute('aria-expanded')) !== 'true')
      await compras.first().click();
    await menu.getByRole('link', { name: 'Licitação e pregão' }).click();
    await expect(page).toHaveURL(/\/suprimentos\/licitacao$/);
    await semViolacaoAxe(page, 'painel da licitação');
    await page.getByTestId('lic-f-termo').fill(numero);
    await page.getByTestId('lic-f-aplicar').click();
    await page.getByTestId(`lic-abrir-${id}`).click();
    await expect(page.getByTestId('lic-det-etapa')).toHaveAttribute('data-etapa', 'julgado');
    await page.getByTestId('lic-det-aba-autoridade').click();
    await page.getByTestId('lic-hom-obs').fill('Homologação sintética da dispensa (teste)');
    await page.getByTestId('lic-homologar').click();
    await expect(page.getByTestId('lic-det-etapa')).toHaveAttribute('data-etapa', 'homologado');
    await expect(page.getByTestId('lic-det-mensagem')).toContainText('Processo homologado');

    // Recarregada a tela, o processo segue homologado: está no banco próprio.
    await page.reload();
    await page.getByTestId('lic-f-termo').fill(numero);
    await page.getByTestId('lic-f-aplicar').click();
    await page.getByTestId(`lic-abrir-${id}`).click();
    await expect(page.getByTestId('lic-det-etapa')).toHaveAttribute('data-etapa', 'homologado');
    const detalhe = (await (await page.request.get(`${L}/${id}`)).json()) as {
      etapa: string;
      eventos: unknown[];
    };
    expect(detalhe.etapa).toBe('homologado');
    expect(detalhe.eventos.length).toBeGreaterThanOrEqual(4);
    await semViolacaoAxe(page, 'processo homologado');
    expect(externas).toEqual([]);
  });

  test('solicitação de compra com a fonte de recurso de cada item: a regra recusa o item sem fonte e grava a principal', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const st: Solicitacao[] = [];
    await simularSolicitacao(page, st);
    await entrar(page, 'SINT.LICITACAO');
    await (await itemDoMenu(page, 'Ata de registro de preços e empenho')).click();
    await expect(page).toHaveURL(/\/suprimentos\/atas-registro-preco/);
    const painel = page.getByTestId('scf-painel');
    await expect(painel).toBeVisible();
    await expect(painel.getByTestId('scf-sem-fonte')).toHaveCount(0);

    const item = async (termo: string, insumo: RegExp, quantidade: string, valor: string) => {
      await painel.getByTestId('scf-termo').fill(termo);
      await painel.getByTestId('scf-termo').press('Tab');
      await escolher(painel.getByTestId('scf-insumo'), { rotulo: insumo });
      await painel.getByTestId('scf-quantidade').fill(quantidade);
      await painel.getByTestId('scf-valor').fill(valor);
    };
    const fonte = async (codigo: RegExp, percentual: string) => {
      await escolher(painel.getByTestId('scf-fonte'), { rotulo: codigo });
      await painel.getByTestId('scf-percentual').fill(percentual);
      await painel.getByTestId('scf-adicionar-fonte').click();
    };

    // Item sem fonte: o servidor recusa pela regra (art. 150, crédito orçamentário indicado) e nada é gravado.
    await escolher(painel.getByTestId('scf-local'), { rotulo: /ALMOXARIFADO SINTETICO/ });
    await painel.getByTestId('scf-justificativa').fill('Reposição do almoxarifado para o semestre');
    await item('luva', /LUVA PROCEDIMENTO/, '200', '0,42');
    await painel.getByTestId('scf-adicionar-item').click();
    await painel.getByTestId('scf-registrar').click();
    await expect(painel.getByTestId('recusa-suprimentos')).toContainText('fonte de recurso do item 1');
    expect(st).toHaveLength(0);

    // Recomeça: a luva por duas fontes (60% + 40%) e a seringa por uma (100%).
    await page.reload();
    await expect(painel).toBeVisible();
    await escolher(painel.getByTestId('scf-local'), { rotulo: /ALMOXARIFADO SINTETICO/ });
    await painel.getByTestId('scf-justificativa').fill('Reposição do almoxarifado para o semestre');
    await item('luva', /LUVA PROCEDIMENTO/, '200', '0,42');
    await fonte(/1\.500\.1002/, '60');
    await fonte(/1\.500\.1001/, '40');
    await expect(painel.getByTestId('scf-fontes-item')).toContainText('1.500.1002 60% + 1.500.1001 40%');
    await painel.getByTestId('scf-adicionar-item').click();
    await item('seringa', /SERINGA SINTETICA/, '100', '1,10');
    await fonte(/1\.500\.1001/, '100');
    await painel.getByTestId('scf-adicionar-item').click();
    await expect(painel.getByTestId('scf-itens').locator('li')).toHaveCount(2);
    await painel.getByTestId('scf-registrar').click();
    await expect(painel.getByTestId('scf-mensagem')).toContainText('Solicitação 7001 registrada');
    await semViolacaoAxe(page, '/suprimentos/atas-registro-preco (solicitação com fonte)');

    // Recarregada a tela, a solicitação volta do servidor com a fonte principal (a de maior valor estimado).
    await page.reload();
    const s = page.getByTestId('scf-7001');
    await expect(s).toContainText('fonte principal: 1.500.1001');
    await expect(s.locator('li')).toHaveCount(2);
    await expect(s.locator('li').first()).toContainText('1.500.1002 60% + 1.500.1001 40%');
    // O que a tela mandou ao servidor: o local, as fontes por percentual e o valor estimado de cada item.
    expect(st).toHaveLength(1);
    expect(st[0]?.corpo.localEstoque).toBe(94101);
    expect(st[0]?.corpo.itens.map((i) => i.fontes.map((f) => [f.origem, f.percentual]))).toEqual([
      [
        [94001, 60],
        [94002, 40],
      ],
      [[94002, 100]],
    ]);
    expect(st[0]?.corpo.itens.map((i) => i.valorUnitarioEstimado)).toEqual([0.42, 1.1]);
    expect(externas).toEqual([]);
  });
});
