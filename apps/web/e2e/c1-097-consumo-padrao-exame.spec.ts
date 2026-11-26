// E2E @C1-097 (F8, 05-SADT linha 22): consumo padrão de insumos por exame pelo caminho da tela /sadt/consumo-padrao,
// aberta pelo item do menu "Diagnóstico > Consumo padrão do exame". O laboratório cadastra o consumo do exame (um
// produto ajustável, achado pela busca de 3 letras, e um kit): o botão só libera com o exame e ao menos um item, e o item
// repetido é recusado na hora. Na aba de realização, o exame pendente abre a sugestão; só o produto ajustável aceita
// outra quantidade, o executante tira um item da cobrança e a baixa vai com o local de estoque escolhido; depois, o
// consumo aparece como baixado. Quem só lança no setor (sem o catálogo) entra pelo item "Baixa do consumo do exame", não
// vê o cadastro e recebe a recusa da conta não lançável sem nada baixado. As rotas /api/sadt/consumo-padrao exigem o banco próprio e o E2E roda com a fonte
// sintética (sem núcleo): as respostas são simuladas pelo Playwright com massa SINTÉTICA. O efeito no banco (baixa pelo
// motor do estoque, lançamento na conta só do cobrável fora do pacote, nada baixado duas vezes) está em
// apps/api/src/modulos/sadt/consumo-padrao.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { abrirMenuInteiro, menuPrincipal, semViolacaoAxe } from './ajuda.js';
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

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

const PRODUTO = { id: 801, codigo: 'SINT-801', nome: 'CONTRASTE SINTETICO' };
const PRODUTO_KIT = 802;

const sugestao = (baixado: boolean) => ({
  item: 9001,
  versao: 3,
  situacao: 'em_execucao',
  exame: 'TOMOGRAFIA SINTETICA',
  setor: 601,
  comAtendimento: true,
  realizadoEm: null,
  consumo: { id: 71, baixaAutomatica: true, lancamentoConta: true },
  produtos: [
    { insumo: PRODUTO.id, quantidade: 2, ajustavel: true, nome: PRODUTO.nome, cobravelNoCadastro: true },
    {
      insumo: PRODUTO_KIT,
      quantidade: 1,
      ajustavel: false,
      nome: 'SERINGA SINTETICA',
      cobravelNoCadastro: true,
    },
  ],
  baixados: baixado
    ? [
        {
          insumo: PRODUTO.id,
          nome: PRODUTO.nome,
          quantidade: 3,
          cobravel: true,
          movimento: 1,
          itemConta: 11,
        },
        {
          insumo: PRODUTO_KIT,
          nome: 'SERINGA SINTETICA',
          quantidade: 1,
          cobravel: false,
          movimento: 2,
          itemConta: null,
        },
      ]
    : [],
});

test.describe('Consumo padrão do exame @C1-097 @fase7', () => {
  test.setTimeout(180_000);
  test('cadastra o consumo e baixa o exame pendente com ajuste e item fora da cobrança; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let consumos: unknown[] = [];
    let baixado = false;
    await page.route('**/api/sadt/catalogo/opcoes**', (rota) =>
      json(rota, {
        exames: [{ id: 501, nome: 'TOMOGRAFIA SINTETICA' }],
        setores: [{ id: 601, nome: 'IMAGEM SINTETICA' }],
        analitos: [],
      }),
    );
    await page.route('**/api/sadt/consumo-padrao**', (rota) => {
      const req = rota.request();
      const url = new URL(req.url());
      const caminho = url.pathname.replace(/^\/api\/sadt\/consumo-padrao\/?/, '');
      if (req.method() === 'GET') {
        if (caminho === 'apoio')
          return json(rota, {
            setores: [{ id: 601, nome: 'IMAGEM SINTETICA' }],
            locais: [{ id: 41, nome: 'ESTOQUE SINTETICO DA IMAGEM' }],
            kits: [{ id: 51, nome: 'KIT SINTETICO DE PUNCAO' }],
            produtos: (url.searchParams.get('busca') ?? '').length >= 3 ? [PRODUTO] : [],
          });
        if (caminho === '') return json(rota, { itens: consumos });
        if (caminho === 'pendentes')
          return json(rota, {
            itens: baixado
              ? []
              : [
                  {
                    item: 9001,
                    situacao: 'em_execucao',
                    exame: 'TOMOGRAFIA SINTETICA',
                    requisicao: 'REQ-SINT-1',
                    solicitadoEm: '2026-03-15T10:00:00.000Z',
                    paciente: 'PACIENTE SINTETICO',
                    setor: 'IMAGEM SINTETICA',
                    comAtendimento: true,
                  },
                ],
          });
        if (caminho === 'exames/9001') return json(rota, sugestao(baixado));
        return json(rota, { codigo: 'nao-simulado' }, 500);
      }
      const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      pedidos.push({ caminho, corpo });
      if (caminho === '') {
        consumos = [
          {
            id: 71,
            exame: 501,
            exameNome: 'TOMOGRAFIA SINTETICA',
            setor: 601,
            setorNome: 'IMAGEM SINTETICA',
            descricao: null,
            baixaAutomatica: true,
            lancamentoConta: true,
            ativo: true,
            versao: 1,
            itens: [
              {
                id: 1,
                sequencia: 1,
                insumo: PRODUTO.id,
                kit: null,
                nome: PRODUTO.nome,
                quantidade: 2,
                ajustavel: true,
              },
              {
                id: 2,
                sequencia: 2,
                insumo: null,
                kit: 51,
                nome: 'KIT SINTETICO DE PUNCAO',
                quantidade: 1,
                ajustavel: false,
              },
            ],
          },
        ];
        return json(rota, { tabela: 'consumo_padrao_exame', id: 71, versao: 1 });
      }
      if (caminho === 'exames/9001/realizar') {
        baixado = true;
        return json(rota, { tabela: 'exame_item', id: 9001, baixados: 2, itensConta: 1 });
      }
      return json(rota, { codigo: 'nao-simulado' }, 500);
    });

    await entrar(page, 'SINT.LABORATORIO');
    await abrirMenuInteiro(page);
    await menuPrincipal(page).getByRole('link', { name: 'Consumo padrão do exame', exact: true }).click();
    await expect(page).toHaveURL(/\/sadt\/consumo-padrao$/);
    await expect(page.getByTestId('consumo-padrao')).toBeVisible();
    await semViolacaoAxe(page, '/sadt/consumo-padrao');

    // Cadastro: o botão só libera com o exame e ao menos um item.
    const gravar = page.getByTestId('consumo-gravar');
    await expect(gravar).toBeDisabled();
    await escolher(page.getByTestId('consumo-exame'), { rotulo: 'TOMOGRAFIA SINTETICA' });
    await escolher(page.getByTestId('consumo-setor'), { rotulo: 'IMAGEM SINTETICA' });
    await expect(gravar).toBeDisabled();
    await page.getByTestId('consumo-item-busca').fill('CON');
    await escolher(page.getByTestId('consumo-item-produto'), { rotulo: /CONTRASTE SINTETICO/ });
    await page.getByTestId('consumo-item-quantidade').fill('2');
    await page.getByTestId('consumo-item-ajustavel').check();
    await page.getByTestId('consumo-item-adicionar').click();
    await expect(page.getByTestId(`consumo-item-p${PRODUTO.id}`)).toBeVisible();
    // O mesmo produto outra vez é recusado na hora.
    await page.getByTestId('consumo-item-busca').fill('CON');
    await escolher(page.getByTestId('consumo-item-produto'), { rotulo: /CONTRASTE SINTETICO/ });
    await expect(page.getByTestId('consumo-item-repetido')).toBeVisible();
    await expect(page.getByTestId('consumo-item-adicionar')).toBeDisabled();
    await escolher(page.getByTestId('consumo-item-tipo'), { rotulo: 'Kit' });
    await escolher(page.getByTestId('consumo-item-kit'), { rotulo: 'KIT SINTETICO DE PUNCAO' });
    await page.getByTestId('consumo-item-quantidade').fill('1');
    await page.getByTestId('consumo-item-adicionar').click();
    await expect(page.getByTestId('consumo-item-k51')).toBeVisible();
    expect(pedidos).toHaveLength(0);
    await gravar.click();
    await expect(page.getByTestId('consumo-mensagem')).toBeVisible();
    expect(pedidos[0]).toMatchObject({
      caminho: '',
      corpo: {
        exame: 501,
        setor: 601,
        baixaAutomatica: true,
        lancamentoConta: true,
        itens: [
          { insumo: PRODUTO.id, kit: null, quantidade: 2, ajustavel: true },
          { insumo: null, kit: 51, quantidade: 1, ajustavel: false },
        ],
      },
    });
    await expect(page.getByTestId('consumo-71')).toContainText('IMAGEM SINTETICA');

    // Realização: a sugestão abre o kit; só o ajustável muda; a seringa sai da cobrança.
    await page.getByTestId('consumo-aba-realizacao').click();
    await escolher(page.getByTestId('consumo-local'), { rotulo: 'ESTOQUE SINTETICO DA IMAGEM' });
    await page.getByTestId('consumo-conferir-9001').click();
    await expect(page.getByTestId('consumo-sugestao')).toBeVisible();
    await expect(page.getByTestId(`consumo-ajuste-${PRODUTO_KIT}`)).toHaveCount(0);
    await page.getByTestId(`consumo-ajuste-${PRODUTO.id}`).fill('3');
    await page.getByTestId(`consumo-cobrar-${PRODUTO_KIT}`).uncheck();
    await semViolacaoAxe(page, '/sadt/consumo-padrao (realização)');
    await page.getByTestId('consumo-realizar').click();
    await expect(page.getByTestId('consumo-mensagem')).toContainText('2');
    const realizar = pedidos.find((p) => p.caminho === 'exames/9001/realizar');
    expect(realizar?.corpo).toMatchObject({
      local: 41,
      ajustes: [
        { insumo: PRODUTO.id, quantidade: 3, cobrar: true },
        { insumo: PRODUTO_KIT, quantidade: 1, cobrar: false },
      ],
    });
    await expect(page.getByTestId('consumo-baixados')).toContainText(PRODUTO.nome);
    await expect(page.getByTestId('consumo-pendente-9001')).toHaveCount(0);
  });

  test('quem só lança no setor entra pela baixa, não vê o cadastro e vê a recusa da conta não lançável', async ({
    page,
  }) => {
    // A sessão do laboratório sem as permissões do catálogo: sobra o lançamento do setor (sadt.lancamento.*).
    await page.route('**/api/sessao', async (rota) => {
      const resposta = await rota.fetch();
      const corpo = (await resposta.json()) as { permissoes?: string[] };
      if (Array.isArray(corpo.permissoes))
        corpo.permissoes = corpo.permissoes.filter((p) => !p.startsWith('sadt.catalogo.'));
      await rota.fulfill({ response: resposta, json: corpo });
    });
    let tentativas = 0;
    await page.route('**/api/sadt/catalogo/opcoes**', (rota) => json(rota, { codigo: 'sem-permissao' }, 403));
    await page.route('**/api/sadt/consumo-padrao**', (rota) => {
      const req = rota.request();
      const url = new URL(req.url());
      const caminho = url.pathname.replace(/^\/api\/sadt\/consumo-padrao\/?/, '');
      if (req.method() === 'GET') {
        if (caminho === 'apoio')
          return json(rota, {
            setores: [{ id: 601, nome: 'IMAGEM SINTETICA' }],
            locais: [{ id: 41, nome: 'ESTOQUE SINTETICO DA IMAGEM' }],
            kits: [],
            produtos: [],
          });
        if (caminho === 'pendentes')
          return json(rota, {
            itens: [
              {
                item: 9001,
                situacao: 'em_execucao',
                exame: 'TOMOGRAFIA SINTETICA',
                requisicao: 'REQ-SINT-1',
                solicitadoEm: '2026-03-15T10:00:00.000Z',
                paciente: 'PACIENTE SINTETICO',
                setor: 'IMAGEM SINTETICA',
                comAtendimento: true,
              },
            ],
          });
        if (caminho === 'exames/9001') return json(rota, sugestao(false));
        if (caminho === '') return json(rota, { codigo: 'sem-permissao' }, 403);
        return json(rota, { codigo: 'nao-simulado' }, 500);
      }
      if (caminho === 'exames/9001/realizar') {
        tentativas += 1;
        return json(
          rota,
          { codigo: 'conta-nao-lancavel', status: 409, titulo: 'Conta não lançável', detalhe: 'sintético' },
          409,
        );
      }
      return json(rota, { codigo: 'nao-simulado' }, 500);
    });

    await entrar(page, 'SINT.LABORATORIO');
    await abrirMenuInteiro(page);
    const menu = menuPrincipal(page);
    await expect(menu.getByRole('link', { name: 'Consumo padrão do exame', exact: true })).toHaveCount(0);
    await menu.getByRole('link', { name: 'Baixa do consumo do exame', exact: true }).click();
    await expect(page).toHaveURL(/\/sadt\/consumo-padrao\/realizacao$/);
    await expect(page.getByTestId('consumo-aba-cadastro')).toHaveCount(0);
    await expect(page.getByTestId('consumo-cadastro')).toHaveCount(0);
    await expect(page.getByTestId('consumo-realizacao')).toBeVisible();
    await escolher(page.getByTestId('consumo-realizacao-setor'), { rotulo: 'IMAGEM SINTETICA' });
    await escolher(page.getByTestId('consumo-local'), { rotulo: 'ESTOQUE SINTETICO DA IMAGEM' });
    await page.getByTestId('consumo-conferir-9001').click();
    await expect(page.getByTestId('consumo-sugestao')).toBeVisible();
    await page.getByTestId('consumo-realizar').click();
    await expect(page.getByTestId('recusa-sadt')).toContainText('nada foi baixado');
    expect(tentativas).toBe(1);
    await expect(page.getByTestId('consumo-pendente-9001')).toBeVisible();
    await semViolacaoAxe(page, '/sadt/consumo-padrao/realizacao');
  });
});
