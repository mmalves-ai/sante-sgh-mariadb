// E2E @C2-098 (F8, 04-HOT linha 141): cardápio e produção pelo caminho da tela (`/nutricao/cardapio`). A copa
// (SINT.COPA: hotelaria.mapaDieta.ler, .fechar e .imprimir) cria a preparação com a ficha técnica e vê na hora o per
// capita líquido pelo fator de correção e o custo da porção; monta o rascunho do cardápio por dia e opção (a preparação
// repetida na mesma opção do dia é avisada na hora), envia para aprovação (o aprovar não aparece para quem não é
// nutricionista), publica o aprovado, calcula a previsão da produção do dia e registra a escolha do paciente entre as
// opções do cardápio publicado. Os combos são SanteSelecao (nenhum <select> nativo). O cardápio só existe no banco do
// cliente (na fonte sintética a API responde 503): as respostas são simuladas pelo Playwright com massa SINTÉTICA, no
// contrato do servidor. O que fica no banco está no contrato de efeito
// (apps/api/src/modulos/nutricao/cardapio-propria.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, esperarSemSelectNativo } from './combos.js';

const SENHA = 'Sintetico#2026';
const HOJE = new Intl.DateTimeFormat('en-CA').format(new Date());

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

const CADASTROS = {
  refeicoes: [{ id: 2, descricao: 'Almoço' }],
  alternativas: [
    { id: 5, descricao: 'Opção A' },
    { id: 6, descricao: 'Opção B' },
  ],
  modalidades: [{ id: 1, descricao: 'Dieta livre' }],
  unidades: [{ id: 9, descricao: 'KG - Quilograma' }],
  tipos: ['prato_principal', 'guarnicao', 'outro'],
};

function simular(page: Page) {
  const estado = {
    preparacoes: [] as Record<string, unknown>[],
    plano: null as null | Record<string, unknown>,
    escolhas: [] as Record<string, unknown>[],
    gravouPreparacao: null as unknown,
    gravouPlano: null as unknown,
  };
  const planoCompleto = (): Record<string, unknown> => ({
    id: 80,
    descricao: 'Almoço da semana',
    periodoInicio: HOJE,
    periodoFim: HOJE,
    refeicao: 2,
    modalidade: null,
    publico: 'paciente',
    porcoesPrevistas: null,
    observacao: null,
    aprovador: null,
    versao: 1,
    situacao: 'rascunho',
    itens: [],
    ...estado.plano,
  });
  void page.route(/\/api\/nutricao\/cardapio\/cadastros$/, (r) => json(r, CADASTROS));
  void page.route(/\/api\/nutricao\/cardapio\/generos\?/, (r) =>
    json(r, {
      itens: [{ id: 30, codigo: 'G30', nome: 'Peito de frango sintético', unidade: 9, sigla: 'KG' }],
    }),
  );
  void page.route(/\/api\/nutricao\/cardapio\/preparacoes(\?.*)?$/, async (r) => {
    if (r.request().method() === 'POST') {
      estado.gravouPreparacao = r.request().postDataJSON();
      estado.preparacoes = [
        {
          id: 70,
          codigo: 'FRANGO',
          nome: 'Frango grelhado',
          tipo: 'prato_principal',
          ativo: true,
          ingredientes: 1,
          custoPorcao: 4.5,
          versao: 1,
        },
      ];
      return json(r, { id: 70, custoPorcao: 4.5, mensagem: 'Preparação salva.' });
    }
    return json(r, { itens: estado.preparacoes });
  });
  void page.route(/\/api\/nutricao\/cardapio\/planejamentos(\?.*)?$/, async (r) => {
    if (r.request().method() === 'POST') {
      const corpo = r.request().postDataJSON() as { itens: { data: string; alternativa: number | null }[] };
      estado.gravouPlano = corpo;
      estado.plano = {
        situacao: 'rascunho',
        versao: 1,
        itens: corpo.itens.map((i) => ({
          ...i,
          alternativaDescricao: i.alternativa ? 'Opção A' : null,
          nome: 'Frango grelhado',
          tipo: 'prato_principal',
        })),
      };
      return json(r, { id: 80 });
    }
    if (!estado.plano) return json(r, { itens: [] });
    const p = planoCompleto();
    return json(r, {
      itens: [
        {
          id: 80,
          descricao: p['descricao'],
          periodoInicio: HOJE,
          periodoFim: HOJE,
          situacao: p['situacao'],
          publico: 'paciente',
          refeicao: 2,
          refeicaoDescricao: 'Almoço',
          modalidade: null,
          itens: (p['itens'] as unknown[]).length,
          aprovado: false,
          versao: p['versao'],
        },
      ],
    });
  });
  void page.route(/\/api\/nutricao\/cardapio\/planejamentos\/80$/, (r) => json(r, planoCompleto()));
  void page.route(/\/api\/nutricao\/cardapio\/planejamentos\/80\/acao$/, async (r) => {
    const { acao } = r.request().postDataJSON() as { acao: string };
    // A aprovação da nutricionista acontece em outra sessão: depois do envio, o cardápio volta aprovado.
    const situacao = acao === 'enviar' ? 'aprovado' : acao === 'publicar' ? 'publicado' : 'cancelado';
    estado.plano = {
      ...estado.plano,
      situacao,
      versao: Number(planoCompleto()['versao']) + 1,
      aprovador: 'NUTRICIONISTA SINTETICA',
    };
    return json(r, { id: 80, situacao });
  });
  void page.route(/\/api\/nutricao\/cardapio\/planejamentos\/80\/producao\?/, (r) =>
    json(r, {
      data: HOJE,
      situacao: 'publicado',
      comensaisMapa: 10,
      preparacoes: [{ preparacao: 70, alternativa: 5, porcoes: 11, base: 'mapa', nome: 'Frango grelhado' }],
      generos: [
        { insumo: 30, quantidade: 1.65, custo: 49.5, nome: 'Peito de frango sintético', sigla: 'KG' },
      ],
      custoTotal: 49.5,
    }),
  );
  void page.route(/\/api\/nutricao\/cardapio\/dia\?/, (r) =>
    json(r, {
      opcoes: [
        { alternativa: 5, descricao: 'Opção A', preparacoes: ['Frango grelhado'] },
        { alternativa: 6, descricao: 'Opção B', preparacoes: ['Omelete'] },
      ],
      escolhas: estado.escolhas,
    }),
  );
  void page.route(/\/api\/nutricao\/cardapio\/escolhas$/, async (r) => {
    const corpo = r.request().postDataJSON() as { alternativa: number };
    estado.escolhas = [
      {
        id: 90,
        comensal: 'paciente',
        acompanhante: null,
        alternativa: corpo.alternativa,
        descricao: corpo.alternativa === 5 ? 'Opção A' : 'Opção B',
        quantidade: 1,
        situacao: 'escolhida',
        escolhidoEm: `${HOJE}T10:00`,
        versao: 1,
      },
    ];
    return json(r, { id: 90, substituida: null }, 201);
  });
  return estado;
}

test.describe('@C2-098 cardápio, ficha técnica, planejamento e produção', () => {
  test('ficha técnica com cálculo na hora → rascunho → envio → publicação → produção → escolha; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const estado = simular(page);
    await entrar(page, 'SINT.COPA');
    await page.goto('/nutricao/cardapio');
    await expect(page.getByTestId('tela-cardapio')).toBeVisible();

    await page.getByTestId('nova-preparacao').click();
    await esperarSemSelectNativo(page.getByTestId('form-preparacao'));
    await page.getByTestId('prep-codigo').locator('input').fill('FRANGO');
    await page.getByTestId('prep-nome').locator('input').fill('Frango grelhado');
    await page.getByTestId('busca-genero').locator('input').fill('frango');
    await page.getByTestId('buscar-genero').click();
    await page.getByTestId('incluir-genero').click();
    await page.getByTestId('ficha-bruto-30').locator('input').fill('0,15');
    await page.getByTestId('ficha-fc-30').locator('input').fill('1,5');
    await page.getByTestId('ficha-custo-30').locator('input').fill('30');
    await expect(page.getByTestId('ficha-liquido-30')).toHaveText('0.1');
    await expect(page.getByTestId('custo-porcao')).toContainText('4,50');
    await semViolacaoAxe(page, '/nutricao/cardapio (ficha técnica)');
    await page.getByTestId('salvar-preparacao').click();
    await expect(page.getByTestId('cardapio-mensagem')).toContainText('Preparação salva');
    expect(estado.gravouPreparacao).toMatchObject({
      codigo: 'FRANGO',
      ficha: [{ insumo: 30, unidade: 9, perCapitaBruto: 0.15, fatorCorrecao: 1.5, custoUnidade: 30 }],
    });

    await page.getByTestId('aba-planejamento').click();
    await page.getByTestId('novo-planejamento').click();
    await page.getByTestId('plano-descricao').locator('input').fill('Almoço da semana');
    await escolher(page.getByTestId('linha-opcao'), { rotulo: 'Opção A' });
    await escolher(page.getByTestId('linha-preparacao'), { rotulo: 'Frango grelhado' });
    await page.getByTestId('linha-porcoes').locator('input').fill('20');
    await page.getByTestId('incluir-linha').click();
    await expect(page.getByTestId('item-plano-0')).toContainText('Frango grelhado');
    await escolher(page.getByTestId('linha-opcao'), { rotulo: 'Opção A' });
    await escolher(page.getByTestId('linha-preparacao'), { rotulo: 'Frango grelhado' });
    await expect(page.getByText('Esta preparação já está nesta opção deste dia.')).toBeVisible();
    await page.getByTestId('salvar-planejamento').click();
    await expect(page.getByTestId('plano-situacao')).toContainText('Rascunho');
    expect(estado.gravouPlano).toMatchObject({
      descricao: 'Almoço da semana',
      refeicao: 2,
      itens: [{ alternativa: 5, preparacao: 70, porcoes: 20 }],
    });

    await page.getByTestId('plano-enviar').click();
    await expect(page.getByTestId('plano-aprovar')).toHaveCount(0);
    await expect(page.getByTestId('plano-situacao')).toContainText('Aprovado');
    await expect(page.getByTestId('plano-situacao')).toContainText('NUTRICIONISTA SINTETICA');
    await page.getByTestId('plano-publicar').click();
    await expect(page.getByTestId('plano-situacao')).toContainText('Publicado');

    await page.getByTestId('producao-calcular').click();
    await expect(page.getByTestId('producao-comensais')).toContainText('10');
    await expect(page.getByTestId('producao-generos')).toContainText('Peito de frango sintético');
    await expect(page.getByTestId('producao-custo')).toContainText('49,50');
    await semViolacaoAxe(page, '/nutricao/cardapio (planejamento)');

    await page.getByTestId('aba-escolha').click();
    await escolher(page.getByTestId('escolha-refeicao'), { rotulo: 'Almoço' });
    await page.getByTestId('escolha-internacao').locator('input').fill('501');
    await page.getByTestId('escolha-ver').click();
    await expect(page.getByTestId('opcoes-do-dia')).toContainText('Opção B');
    await page.getByTestId('escolher-6').click();
    await expect(page.getByTestId('cardapio-mensagem')).toContainText('Escolha registrada');
    await expect(page.getByTestId('escolha-90')).toContainText('Opção B');
    await semViolacaoAxe(page, '/nutricao/cardapio (escolha)');
    expect(externas).toEqual([]);
  });
});
