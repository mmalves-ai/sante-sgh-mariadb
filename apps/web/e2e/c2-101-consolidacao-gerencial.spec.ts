// E2E @C2-101 (F8, 07-FIN L127): consolidação gerencial pela tela /contabil/consolidacao. O administrador escolhe o
// grupo e a competência, inclui uma conta gerencial do plano comum, liga a conta do estabelecimento que estava sem
// de-para (só aparecem as gerenciais analíticas da mesma natureza), vê a prévia com a eliminação entre empresas
// (CPC 36) e sem pendências, apura, libera e confere a DRE e o balanço consolidados. As rotas
// /api/contabil/consolidacao exigem o banco próprio e o E2E roda com a fonte sintética: as respostas são simuladas pelo
// Playwright com massa SINTÉTICA. O efeito no banco está em apps/api/src/modulos/contabil/consolidacao.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher, esperarSemSelectNativo, rotulosDoCombo } from './combos.js';

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

const gravacao = (mensagem: string, resultado: Record<string, unknown> = {}) => ({
  mensagem,
  repetida: false,
  resultado,
});

test.describe('Consolidação gerencial do grupo @C2-101 @fase7', () => {
  test.setTimeout(180_000);
  test('de-para da conta pendente, prévia com eliminação, apurar, liberar e demonstrações consolidadas; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let ligada = false;
    let situacao: 'nenhuma' | 'apurada' | 'liberada' = 'nenhuma';
    const gerenciais = [
      { id: 31, classificacao: '3', descricao: 'RECEITAS', natureza: 'receita', tipo: 'sintetica', nivel: 1 },
      {
        id: 32,
        classificacao: '3.1',
        descricao: 'RECEITA DE SERVICOS',
        natureza: 'receita',
        tipo: 'analitica',
        nivel: 2,
      },
      {
        id: 41,
        classificacao: '4.1',
        descricao: 'DESPESA COM SERVICOS',
        natureza: 'despesa',
        tipo: 'analitica',
        nivel: 2,
      },
    ];
    const rodada = () =>
      situacao === 'nenhuma' ? null : { id: 90, situacao, versao: situacao === 'liberada' ? 2 : 1 };

    await page.route('**/api/contabil/consolidacao/**', async (r) => {
      const u = new URL(r.request().url());
      const caminho = u.pathname.replace('/api/contabil/consolidacao', '');
      if (r.request().method() === 'POST') {
        const corpo = (r.request().postDataJSON() ?? {}) as Record<string, unknown>;
        pedidos.push({ caminho, corpo });
        if (caminho === '/contas-gerenciais') {
          gerenciais.push({
            id: 33,
            classificacao: '3.2',
            descricao: 'RECEITA ENTRE EMPRESAS',
            natureza: 'receita',
            tipo: 'analitica',
            nivel: 2,
          });
          return json(r, gravacao('Conta gerencial incluída no plano comum.', { conta: 33 }));
        }
        if (caminho === '/grupos/7/depara') {
          ligada = true;
          return json(
            r,
            gravacao('De-para salvo: 1 ligada(s), 0 trocada(s) ou desligada(s).', { ligadas: 1 }),
          );
        }
        if (caminho === '/grupos/7/apurar') {
          situacao = 'apurada';
          return json(
            r,
            gravacao('Consolidação apurada: 1 eliminação(ões) somando R$ 500,00.', { apuracao: 90 }),
          );
        }
        if (caminho === '/apuracoes/90/liberar') {
          situacao = 'liberada';
          return json(r, gravacao('Consolidação liberada; a competência não se refaz mais.'));
        }
        return json(r, { title: 'inesperado' }, 400);
      }
      if (caminho === '/apoio')
        return json(r, {
          estabelecimentos: [
            { id: 1, nome: 'HOSPITAL SINTETICO MATRIZ' },
            { id: 2, nome: 'CLINICA SINTETICA FILIAL' },
          ],
          grupos: [{ id: 7, codigo: 'GS', nome: 'GRUPO SINTETICO', situacao: 'ativo', membros: 2 }],
          metodos: ['integral', 'proporcional', 'equivalencia_patrimonial'],
          naturezas: [
            'ativo',
            'passivo',
            'patrimonio_liquido',
            'receita',
            'custo',
            'despesa',
            'resultado',
            'compensacao',
          ],
        });
      if (caminho === '/grupos/7')
        return json(r, {
          grupo: {
            id: 7,
            codigo: 'GS',
            nome: 'GRUPO SINTETICO',
            vigenciaInicio: '2027-01-01',
            vigenciaFim: null,
            eliminaEntreEmpresas: true,
            situacao: 'ativo',
            observacao: null,
            versao: 3,
          },
          membros: [
            {
              estabelecimento: 1,
              nome: 'HOSPITAL SINTETICO MATRIZ',
              percentual: 100,
              metodo: 'integral',
              consolidadora: true,
            },
            {
              estabelecimento: 2,
              nome: 'CLINICA SINTETICA FILIAL',
              percentual: 80,
              metodo: 'proporcional',
              consolidadora: false,
            },
          ],
          gerenciais,
          depara: [
            {
              conta: 501,
              estabelecimento: 1,
              classificacao: '3.1.01',
              descricao: 'SERVICOS',
              natureza: 'receita',
              gerencial: 32,
            },
            {
              conta: 502,
              estabelecimento: 2,
              classificacao: '3.1.09',
              descricao: 'SERVICOS A COLIGADA',
              natureza: 'receita',
              gerencial: ligada ? 33 : null,
            },
          ],
          apuracoes:
            situacao === 'nenhuma'
              ? []
              : [
                  {
                    id: 90,
                    competencia: '2027-03',
                    situacao,
                    eliminado: 500,
                    liberadoEm: situacao === 'liberada' ? '2027-04-02T10:00:00' : null,
                    versao: situacao === 'liberada' ? 2 : 1,
                  },
                ],
        });
      if (caminho === '/grupos/7/previa')
        return json(r, {
          competencia: '2027-03',
          rodadaVigente: rodada(),
          membros: [],
          totais: [
            {
              gerencial: 32,
              classificacao: '3.1',
              descricao: 'RECEITA DE SERVICOS',
              anterior: 0,
              debitos: 0,
              creditos: 250000,
              final: -250000,
              eliminado: 0,
            },
          ],
          eliminacoes: ligada
            ? [
                {
                  sequencia: 1,
                  transacao: 77,
                  origem: 2,
                  contraparte: 1,
                  debitoConta: 502,
                  creditoConta: 601,
                  valor: 50000,
                  origemNome: 'CLINICA SINTETICA FILIAL',
                  contraparteNome: 'HOSPITAL SINTETICO MATRIZ',
                  debitoNome: 'SERVICOS A COLIGADA',
                  creditoNome: 'DESPESA COM COLIGADA',
                },
              ]
            : [],
          pendencias: ligada
            ? []
            : [
                {
                  tipo: 'conta-sem-depara',
                  estabelecimento: 2,
                  conta: 502,
                  transacao: null,
                  valor: 50000,
                  estabelecimentoNome: 'CLINICA SINTETICA FILIAL',
                  contaNome: 'SERVICOS A COLIGADA',
                },
              ],
          totalEliminado: ligada ? 50000 : 0,
          conferencia: 'Débitos = créditos (sintético)',
        });
      if (caminho === '/grupos/7/demonstracoes')
        return json(r, {
          competencia: '2027-03',
          rodada: rodada(),
          dre: {
            linhas: [
              {
                chave: 'receitaBruta',
                rotulo: 'Receita bruta',
                valorCentavos: 250000,
                total: false,
                parcelas: [],
              },
              {
                chave: 'resultado',
                rotulo: 'Resultado do mês',
                valorCentavos: 250000,
                total: true,
                parcelas: [],
              },
            ],
            resultadoCentavos: 250000,
            rotuloResultado: 'Superávit',
            conferencia: 'DRE sintética conferida',
          },
          balanco: {
            ativo: { rotulo: 'Ativo', totalCentavos: 250000, parcelas: [] },
            passivo: { rotulo: 'Passivo', totalCentavos: 0, parcelas: [] },
            patrimonioLiquido: { rotulo: 'Patrimônio líquido', totalCentavos: 0, parcelas: [] },
            resultadoExercicioCentavos: 250000,
            resultadoAnterioresCentavos: 0,
            totalAtivoCentavos: 250000,
            totalPassivoPlCentavos: 250000,
            compensacao: null,
            equilibrado: true,
            conferencia: 'Balanço sintético conferido',
          },
        });
      return json(r, { title: 'nao-encontrado' }, 404);
    });

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/contabil/consolidacao');
    const tela = page.getByTestId('tela-consolidacao');
    await expect(tela).toBeVisible();
    await esperarSemSelectNativo(tela);
    await page.getByTestId('consolidacao-competencia').fill('2027-03');

    // Prévia: a conta da filial sem de-para aparece como pendência.
    await expect(page.getByTestId('consolidacao-pendencias')).toContainText('SERVICOS A COLIGADA');
    await expect(page.getByTestId('consolidacao-rodada')).toContainText('ainda não foi apurada');

    // Grupo: a consolidadora é única e a falta aparece na hora.
    await page.getByTestId('consolidacao-aba-grupo').click();
    await expect(page.getByTestId('consolidacao-membro-1-percentual')).toHaveValue('80');
    await expect(page.getByTestId('consolidacao-problemas-grupo')).toHaveCount(0);
    await page.getByTestId('consolidacao-codigo').fill('');
    await expect(page.getByTestId('consolidacao-problemas-grupo')).toContainText('código');
    await page.getByTestId('consolidacao-codigo').fill('GS');

    // Plano gerencial: a classificação é conferida na hora; a conta nova entra no plano comum.
    await page.getByTestId('consolidacao-aba-depara').click();
    await page.getByTestId('consolidacao-conta-classificacao').fill('3.x');
    await page.getByTestId('consolidacao-conta-descricao').fill('Receita entre empresas');
    await expect(page.getByTestId('consolidacao-problemas-conta')).toContainText('classificação');
    await page.getByTestId('consolidacao-conta-classificacao').fill('3.2');
    await escolher(page.getByTestId('consolidacao-conta-natureza'), { rotulo: 'Receita' });
    await page.getByTestId('consolidacao-incluir-conta').click();
    await expect(page.getByTestId('consolidacao-aviso')).toContainText('Conta gerencial incluída');

    // De-para: só as gerenciais analíticas da mesma natureza; o filtro mostra só a pendente.
    await page.getByTestId('consolidacao-so-pendentes').check();
    await expect(page.getByTestId('consolidacao-depara-501')).toHaveCount(0);
    const combo = page.getByTestId('consolidacao-depara-502-gerencial');
    const rotulos = await rotulosDoCombo(combo);
    expect(rotulos.some((x) => x.includes('DESPESA'))).toBe(false);
    expect(rotulos.some((x) => x.startsWith('3 '))).toBe(false);
    await escolher(combo, { rotulo: /RECEITA ENTRE EMPRESAS/ });
    await page.getByTestId('consolidacao-salvar-depara').click();
    await expect(page.getByTestId('consolidacao-aviso')).toContainText('1 ligada');
    await semViolacaoAxe(page, '/contabil/consolidacao (de-para)');

    // Prévia sem pendências e com a eliminação entre empresas; apurar e liberar.
    await page.getByTestId('consolidacao-aba-apuracao').click();
    await expect(page.getByTestId('consolidacao-sem-pendencias')).toBeVisible();
    await expect(page.getByTestId('consolidacao-eliminacoes')).toContainText('DESPESA COM COLIGADA');
    await expect(page.getByTestId('consolidacao-total-eliminado')).toContainText('500,00');
    await page.getByTestId('consolidacao-apurar').click();
    await expect(page.getByTestId('consolidacao-aviso')).toContainText('Consolidação apurada');
    await page.getByTestId('consolidacao-liberar-90').click();
    await expect(page.getByTestId('consolidacao-aviso')).toContainText('liberada');
    await expect(page.getByTestId('consolidacao-apurar')).toHaveCount(0);

    // DRE e balanço consolidados.
    await page.getByTestId('consolidacao-aba-demonstracoes').click();
    await expect(page.getByTestId('consolidacao-dre')).toContainText('Resultado do mês');
    await expect(page.getByTestId('consolidacao-equilibrio')).toContainText('equilibrado');
    await semViolacaoAxe(page, '/contabil/consolidacao (demonstrações)');

    expect(pedidos.map((p) => p.caminho)).toEqual([
      '/contas-gerenciais',
      '/grupos/7/depara',
      '/grupos/7/apurar',
      '/apuracoes/90/liberar',
    ]);
    expect(pedidos[0]!.corpo).toMatchObject({
      exercicio: 2027,
      classificacao: '3.2',
      natureza: 'receita',
      tipo: 'analitica',
    });
    expect(pedidos[1]!.corpo).toEqual({ itens: [{ conta: 502, gerencial: 33 }] });
    expect(pedidos[2]!.corpo).toEqual({ competencia: '2027-03' });
    expect(pedidos[3]!.corpo).toEqual({ versao: 1 });
  });
});
