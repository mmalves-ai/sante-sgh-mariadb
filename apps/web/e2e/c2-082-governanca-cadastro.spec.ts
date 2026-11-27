// E2E @C2-082 (F8, 05-SUP linha 2): governança do cadastro de itens pelo caminho da tela (menu Suprimentos > Estoque e
// almoxarifado > Padronização e unificação de itens). O supervisor do estoque pede item novo à comissão (a justificativa
// curta trava o envio na hora), a comissão aprova a inclusão com código, tipo, grupo e unidade de estoque e reprova outro
// pedido com motivo; na unificação, escolhe o item que permanece e o duplicado com o fator, pede, aprova e executa; na
// substituição, grava o de-para genérico. Os dados da governança só existem no banco do cliente (na fonte sintética a API
// responde 503): as respostas são simuladas pelo Playwright com massa SINTÉTICA, no contrato do servidor. A decisão da
// comissão (suprimentos.padronizacao.aprovar) é concedida por perfil (administrador do sistema): a sessão lida pela tela
// recebe a permissão na simulação; quem decide de verdade é o servidor (governanca-cadastro.int.spec.ts traz o efeito).
import { expect, type Page, type Route, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const B = '/api/suprimentos/governanca-cadastro';

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

const ITENS = [
  { id: 98201, codigo: 'C2082-A', nome: 'LUVA PROCEDIMENTO SINTETICA M', tipo: 'material', ativo: true },
  { id: 98202, codigo: 'C2082-B', nome: 'LUVA PROCEDIMENTO SINTETICA MEDIA', tipo: 'material', ativo: true },
  { id: 98203, codigo: 'C2082-C', nome: 'DIPIRONA SINTETICA 500MG', tipo: 'medicamento', ativo: true },
  { id: 98204, codigo: 'C2082-D', nome: 'METAMIZOL SINTETICO 500MG', tipo: 'medicamento', ativo: true },
];

interface Estado {
  solicitacoes: Record<string, unknown>[];
  unificacoes: Record<string, unknown>[];
  substituicoes: Record<string, unknown>[];
  corpos: { caminho: string; corpo: Record<string, unknown> }[];
}

const solicitacao = (id: number, numero: number, descricao: string) => ({
  id,
  numero,
  tipo: 'inclusao',
  item: null,
  descricao,
  justificativa: 'Pedido sintético anterior para a comissão de padronização.',
  situacao: 'enviada',
  solicitante: 1,
  solicitadoEm: '2030-03-10T10:00:00Z',
  parecer: null,
  motivoReprovacao: null,
  criadoItem: null,
  versao: 1,
});

async function simular(page: Page, st: Estado): Promise<void> {
  // A sessão lida pela tela recebe a decisão da comissão (no servidor ela vem do perfil administrador do sistema).
  await page.route('**/api/sessao', async (r) => {
    if (r.request().method() !== 'GET') return r.fallback();
    const real = await r.fetch();
    if (!real.ok()) return r.fulfill({ response: real });
    const corpo = (await real.json()) as { permissoes?: string[] };
    return json(r, {
      ...corpo,
      permissoes: [...(corpo.permissoes ?? []), 'suprimentos.padronizacao.aprovar'],
    });
  });
  await page.route(`**${B}/**`, (r) => {
    const url = new URL(r.request().url());
    const caminho = url.pathname.replace(/^.*\/governanca-cadastro/, '');
    const metodo = r.request().method();
    const corpo = (metodo === 'POST' ? r.request().postDataJSON() : {}) as Record<string, unknown>;
    if (metodo === 'POST') st.corpos.push({ caminho, corpo });
    if (caminho === '/itens') {
      const termo = (url.searchParams.get('termo') ?? '').toUpperCase();
      return json(
        r,
        ITENS.filter((i) => i.codigo.includes(termo) || i.nome.includes(termo)),
      );
    }
    if (caminho === '/solicitacoes' && metodo === 'GET') return json(r, st.solicitacoes);
    if (caminho === '/solicitacoes' && metodo === 'POST') {
      const id = 98290 + st.solicitacoes.length;
      st.solicitacoes.push({
        ...solicitacao(id, 900 + st.solicitacoes.length, String(corpo['descricao'])),
        justificativa: String(corpo['justificativa']),
      });
      return json(r, { id, situacao: 'enviada' }, 201);
    }
    const dec = /^\/solicitacoes\/(\d+)\/decisao$/.exec(caminho);
    if (dec) {
      const s = st.solicitacoes.find((x) => x['id'] === Number(dec[1]));
      const situacao =
        corpo['acao'] === 'aprovar' ? 'aprovada' : corpo['acao'] === 'reprovar' ? 'reprovada' : 'cancelada';
      if (s) Object.assign(s, { situacao, versao: Number(s['versao']) + 1 });
      return json(r, { id: Number(dec[1]), situacao });
    }
    if (caminho === '/unificacoes' && metodo === 'GET') return json(r, st.unificacoes);
    if (caminho === '/unificacoes' && metodo === 'POST') {
      const id = 98270 + st.unificacoes.length;
      st.unificacoes.push({
        id,
        numero: `UNI-${id}`,
        permanece: 'C2082-A · LUVA PROCEDIMENTO SINTETICA M',
        absorvidos: 'C2082-B · LUVA PROCEDIMENTO SINTETICA MEDIA',
        motivo: String(corpo['motivo']),
        situacao: 'aguardando_aprovacao',
        solicitante: 1,
        solicitadoEm: '2030-03-10T10:00:00Z',
        executadoEm: null,
        referenciasTransferidas: 0,
        versao: 1,
      });
      return json(r, { id, situacao: 'aguardando_aprovacao' }, 201);
    }
    const uni = /^\/unificacoes\/(\d+)\/decisao$/.exec(caminho);
    if (uni) {
      const u = st.unificacoes.find((x) => x['id'] === Number(uni[1]));
      const situacao =
        corpo['acao'] === 'aprovar' ? 'aprovada' : corpo['acao'] === 'executar' ? 'executada' : 'cancelada';
      if (u)
        Object.assign(u, {
          situacao,
          versao: Number(u['versao']) + 1,
          referenciasTransferidas: situacao === 'executada' ? 7 : 0,
        });
      return json(r, { id: Number(uni[1]), situacao });
    }
    if (caminho === '/substituicoes' && metodo === 'GET') return json(r, st.substituicoes);
    if (caminho === '/substituicoes' && metodo === 'POST') {
      const id = 98260 + st.substituicoes.length;
      st.substituicoes.push({
        id,
        item: 'C2082-C · DIPIRONA SINTETICA 500MG',
        substituto: 'C2082-D · METAMIZOL SINTETICO 500MG',
        tipo: String(corpo['tipo']),
        fator: Number(corpo['fator']),
        exigeAvisoPrescritor: Boolean(corpo['exigeAvisoPrescritor']),
        vigenciaInicio: null,
        vigenciaFim: null,
        ativo: true,
      });
      return json(r, { id, situacao: 'ativa' }, 201);
    }
    return json(r, { title: 'rota não simulada', status: 404 }, 404);
  });
}

test.describe('Governança do cadastro de itens @C2-082', () => {
  test.setTimeout(180_000);

  test('pedido de item novo à comissão, aprovação e reprovação, unificação executada e de-para; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const st: Estado = {
      solicitacoes: [solicitacao(98280, 899, 'CATETER SINTETICO PEDIDO ANTERIOR')],
      unificacoes: [],
      substituicoes: [],
      corpos: [],
    };
    await simular(page, st);
    await entrar(page, 'SINT.SUPERVISOR.ESTOQUE');

    await (await itemDoMenu(page, 'Padronização e unificação de itens')).click();
    await expect(page).toHaveURL(/\/suprimentos\/governanca-cadastro/);
    await expect(page.getByTestId('gov-tela')).toBeVisible();
    await semViolacaoAxe(page, '/suprimentos/governanca-cadastro');

    // Pedido de item novo: a justificativa curta trava o envio na hora.
    await escolher(page.getByTestId('gov-tipo'), { rotulo: 'Item novo' });
    await page.getByTestId('gov-descricao').fill('SERINGA SINTETICA 3ML SEM AGULHA');
    await page.getByTestId('gov-justificativa').fill('Uso na UTI');
    await expect(page.getByTestId('gov-falta')).toBeVisible();
    await expect(page.getByTestId('gov-pedido-recusas')).toBeVisible();
    await expect(page.getByTestId('gov-enviar')).toBeDisabled();
    await page
      .getByTestId('gov-justificativa')
      .fill('Uso diário na UTI adulto, sem item equivalente padronizado no cadastro.');
    await expect(page.getByTestId('gov-falta')).toHaveCount(0);
    await expect(page.getByTestId('gov-enviar')).toBeEnabled();
    await page.getByTestId('gov-enviar').click();
    await expect(page.getByTestId('gov-aviso')).toContainText('enviado à comissão');
    const novo = st.solicitacoes.at(-1)!['id'] as number;
    await expect(page.getByTestId(`gov-sol-${novo}`)).toContainText('SERINGA SINTETICA 3ML');

    // A comissão aprova a inclusão: o item nasce com código, tipo, grupo e unidade de estoque.
    await page.getByTestId(`gov-sol-abrir-${novo}`).click();
    await page.getByTestId('gov-parecer').fill('Aprovado pela comissão de padronização.');
    await page.getByTestId('gov-codigo').fill('C2082-N');
    await page.getByTestId('gov-tipo-item').fill('material');
    await page.getByTestId('gov-grupo').fill('11');
    await page.getByTestId('gov-unidade-estoque').fill('3');
    await page.getByTestId('gov-aprovar').click();
    await expect(page.getByTestId('gov-aviso')).toContainText('aprovada');
    const aprovacao = st.corpos.find((c) => c.caminho === `/solicitacoes/${novo}/decisao`)!.corpo;
    expect(aprovacao).toMatchObject({
      acao: 'aprovar',
      codigo: 'C2082-N',
      tipoItem: 'material',
      grupo: 11,
      unidadeEstoque: 3,
    });

    // O pedido anterior é reprovado com motivo.
    await page.getByTestId('gov-sol-abrir-98280').click();
    await page.getByTestId('gov-motivo').fill('Item equivalente já padronizado no cadastro.');
    await page.getByTestId('gov-reprovar').click();
    await expect(page.getByTestId('gov-aviso')).toContainText('reprovada');
    await expect(page.getByTestId('gov-sol-abrir-98280')).toHaveCount(0);

    // Unificação: o item que permanece, o duplicado com o fator, o pedido, a aprovação e a execução.
    await page.getByTestId('gov-aba-unificacao').click();
    await page.getByTestId('gov-permanece-busca').fill('C2082-A');
    await escolher(page.getByTestId('gov-permanece'), { rotulo: /C2082-A/ });
    await page.getByTestId('gov-absorvido-busca').fill('C2082-B');
    await escolher(page.getByTestId('gov-absorvido'), { rotulo: /C2082-B/ });
    await page.getByTestId('gov-fator').fill('1');
    await page.getByTestId('gov-adicionar').click();
    await expect(page.getByTestId('gov-absorvidos')).toContainText('LUVA PROCEDIMENTO SINTETICA MEDIA');
    await page.getByTestId('gov-motivo-unificacao').fill('Cadastro duplicado da mesma luva de procedimento.');
    await page.getByTestId('gov-pedir-unificacao').click();
    await expect(page.getByTestId('gov-aviso')).toContainText('aguardando');
    const uni = st.unificacoes[0]!['id'] as number;
    expect(st.corpos.find((c) => c.caminho === '/unificacoes')!.corpo).toMatchObject({
      permanece: 98201,
      absorvidos: [{ item: 98202, fator: 1 }],
    });
    await page.getByTestId(`gov-uni-aprovar-${uni}`).click();
    await expect(page.getByTestId('gov-aviso')).toContainText('aprovada');
    await page.getByTestId(`gov-uni-executar-${uni}`).click();
    await expect(page.getByTestId('gov-aviso')).toContainText('executada');
    await expect(page.getByTestId(`gov-uni-${uni}`)).toContainText('7');

    // Substituição (de-para genérico) entre dois itens do cadastro.
    await page.getByTestId('gov-aba-substituicao').click();
    await page.getByTestId('gov-sub-item-busca').fill('C2082-C');
    await escolher(page.getByTestId('gov-sub-item'), { rotulo: /C2082-C/ });
    await page.getByTestId('gov-substituto-busca').fill('C2082-D');
    await escolher(page.getByTestId('gov-substituto'), { rotulo: /C2082-D/ });
    await escolher(page.getByTestId('gov-sub-tipo'), { indice: 0 });
    await page.getByTestId('gov-sub-fator').fill('1');
    await page.getByTestId('gov-sub-gravar').click();
    await expect(page.getByTestId('gov-aviso')).toContainText('Gravado');
    expect(st.corpos.find((c) => c.caminho === '/substituicoes')!.corpo).toMatchObject({
      item: 98203,
      substituto: 98204,
      ativo: true,
    });
    await semViolacaoAxe(page, '/suprimentos/governanca-cadastro (substituição)');
    expect(externas).toEqual([]);
  });
});
