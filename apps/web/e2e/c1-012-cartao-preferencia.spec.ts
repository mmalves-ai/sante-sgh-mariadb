// C1-012 (F8, 04-CC linha 105): o cartão de preferência do cirurgião. A validação roda na hora pela mesma regra do
// domínio que a API aplica; tudo se escolhe pelo nome (cirurgião, procedimento, grupo, caixa, equipamento, kit pelos
// combos do padrão da casa; produto do estoque pela busca de 3 letras, um clique inclui), nunca por código interno.
// O pedido de sala no mapa recebe a sugestão do cartão (sala, tempo e posição) e um clique preenche sala e duração.
// Fonte SINTÉTICA: as rotas do cartão são respondidas pelo próprio teste (page.route), porque o E2E roda sem banco
// próprio; o que fica no banco (itens sem apagar, versão, grupo, vigência, kit, cartão aplicável pela data do ato com a
// sugestão do mapa e do gasto de sala) é provado pelo contrato de efeito cartao-preferencia-propria.int.spec.ts. Axe.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, esperarSemSelectNativo, esperarValor } from './combos.js';

const SENHA = 'Sintetico#2026';
const op = (id: number, descricao: string) => ({ id, descricao });
const APOIO = {
  cirurgioes: [op(7, 'CIRURGIAO SINTETICO A'), op(8, 'CIRURGIAO SINTETICO B')],
  procedimentos: [op(30, 'PROCEDIMENTO SINTETICO X (PX1)')],
  grupos: [op(5, 'GRUPO SINTETICO VIDEO')],
  posicoes: [op(2, 'DECUBITO DORSAL')],
  salas: [op(1, 'SALA SINTETICA 1')],
  caixas: [op(40, 'CAIXA SINTETICA LAPAROSCOPIA')],
  equipamentos: [op(50, 'BISTURI SINTETICO')],
  kits: [op(60, 'KIT SINTETICO VIDEO')],
};

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** Responde as leituras do cartão com massa sintética; o aplicável devolve o cartão do grupo com a sala 1 e 150 min. */
async function cartaoSintetico(page: Page): Promise<void> {
  await page.route('**/api/cirurgia/cartoes-preferencia**', async (rota) => {
    const url = new URL(rota.request().url());
    if (rota.request().method() !== 'GET') return rota.fallback();
    const corpo = (json: unknown) =>
      rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
    if (url.pathname.endsWith('/apoio')) return corpo(APOIO);
    if (url.pathname.endsWith('/produtos'))
      return corpo({
        itens: (url.searchParams.get('busca') ?? '').length >= 3 ? [op(11, 'GAZE SINTETICA (G1)')] : [],
      });
    if (url.pathname.endsWith('/aplicavel'))
      return corpo({
        cartao: {
          id: 900,
          cirurgiao: Number(url.searchParams.get('cirurgiao')),
          procedimento: null,
          grupo: 5,
          vigenciaInicio: null,
          vigenciaFim: null,
          grupoDescricao: 'GRUPO SINTETICO VIDEO',
          posicao: 2,
          sala: 1,
          tempoMinutos: 150,
          tamanhoLuva: null,
          preparoPele: null,
          fiosSutura: null,
          observacao: null,
          ativo: true,
          versao: 1,
          cirurgiaoNome: 'CIRURGIAO SINTETICO A',
          procedimentoDescricao: null,
          posicaoDescricao: 'DECUBITO DORSAL',
          salaDescricao: 'SALA SINTETICA 1',
          itens: [],
        },
        mapa: { sala: 1, tempoMinutos: 150, posicao: 2 },
        gasto: [{ insumo: 11, quantidade: 6, insumoNome: 'GAZE SINTETICA (G1)' }],
      });
    return corpo({ itens: [] });
  });
}

test.describe('centro cirúrgico: cartão de preferência do cirurgião @C1-012', () => {
  test.setTimeout(180_000);

  test('escolha por nome, validação na hora (conteúdo, tempo, luva, grupo, vigência, item, repetido); axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await cartaoSintetico(page);
    await entrar(page, 'SINT.BLOCO');
    await page.goto('/cirurgia/cartoes-preferencia');
    const tela = page.getByTestId('tela-cartoes-preferencia');
    await expect(tela).toBeVisible();
    await esperarSemSelectNativo(tela);

    const salvar = page.getByTestId('cartao-salvar');
    const problemas = page.getByTestId('cartao-problemas');
    await expect(problemas).toContainText('cirurgião');
    await expect(problemas).toContainText('cartão vazio');
    await expect(salvar).toBeDisabled();

    await escolher(page.getByTestId('cartao-cirurgiao'), { rotulo: 'CIRURGIAO SINTETICO A' });
    await esperarValor(page.getByTestId('cartao-cirurgiao'), '7');
    await page.getByTestId('cartao-tempo').fill('3');
    await expect(problemas).toContainText('5 a 1440');
    await page.getByTestId('cartao-tempo').fill('90');
    await page.getByTestId('cartao-luva').fill('12');
    await expect(problemas).toContainText('luva');
    await page.getByTestId('cartao-luva').fill('7,5');
    await expect(problemas).toHaveCount(0);
    await expect(salvar).toBeEnabled();

    // Cartão do grupo (sem procedimento) e vigência: fim antes do início é recusado na hora.
    await escolher(page.getByTestId('cartao-grupo'), { rotulo: 'GRUPO SINTETICO VIDEO' });
    await page.getByTestId('cartao-vigencia-inicio').fill('2026-12-10');
    await page.getByTestId('cartao-vigencia-fim').fill('2026-12-01');
    await expect(problemas).toContainText('vigência');
    await page.getByTestId('cartao-vigencia-fim').fill('2026-12-31');
    await expect(problemas).toHaveCount(0);
    // Com o procedimento escolhido, o grupo sai (o cartão é de um ou de outro).
    await escolher(page.getByTestId('cartao-procedimento'), { rotulo: 'PROCEDIMENTO SINTETICO X (PX1)' });
    await expect(page.getByTestId('cartao-grupo')).toHaveCount(0);

    // Produto do estoque pela busca: um clique inclui com o nome.
    await page.getByTestId('cartao-busca-produto').fill('GAZ');
    await page.getByTestId('cartao-produto-11').click();
    await expect(page.getByTestId('cartao-item-0-produto')).toContainText('GAZE SINTETICA');
    await expect(problemas).toHaveCount(0);

    // Kit padrão pelo combo do cadastro de kits; sem escolher, a descrição é exigida.
    await page.getByTestId('cartao-novo-item').click();
    await escolher(page.getByTestId('cartao-item-1-natureza'), 'kit');
    await expect(problemas).toContainText('Item 2');
    await expect(salvar).toBeDisabled();
    await escolher(page.getByTestId('cartao-item-1-cadastro'), { rotulo: 'KIT SINTETICO VIDEO' });
    await expect(problemas).toHaveCount(0);

    // Item repetido (mesmo kit): recusado; tirar o segundo libera.
    await page.getByTestId('cartao-novo-item').click();
    await escolher(page.getByTestId('cartao-item-2-natureza'), 'kit');
    await escolher(page.getByTestId('cartao-item-2-cadastro'), { rotulo: 'KIT SINTETICO VIDEO' });
    await expect(problemas).toContainText('repetido');
    await page.getByTestId('cartao-item-2-tirar').click();
    await expect(problemas).toHaveCount(0);
    await expect(salvar).toBeEnabled();

    // "Outro" não tem cadastro: só a descrição.
    await escolher(page.getByTestId('cartao-item-1-natureza'), 'outro');
    await expect(page.getByTestId('cartao-item-1-cadastro')).toHaveCount(0);

    // Qual cartão vale na data do ato: sugestão do mapa e produtos do gasto (kit aberto).
    await expect(page.getByTestId('consulta-botao')).toBeDisabled();
    await escolher(page.getByTestId('consulta-cirurgiao'), { rotulo: 'CIRURGIAO SINTETICO A' });
    await page.getByTestId('consulta-data').fill('2026-12-15');
    await page.getByTestId('consulta-botao').click();
    await expect(page.getByTestId('consulta-mapa')).toContainText('SALA SINTETICA 1');
    await expect(page.getByTestId('consulta-mapa')).toContainText('150');
    await expect(page.getByTestId('consulta-gasto')).toContainText('GAZE SINTETICA (G1) × 6');
    await semViolacaoAxe(page, '/cirurgia/cartoes-preferencia (cartão em edição)');
    expect(externas).toEqual([]);
  });

  test('pedido de sala no mapa: o cartão do cirurgião sugere sala, tempo e posição; um clique preenche', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await cartaoSintetico(page);
    await entrar(page, 'SINT.BLOCO');
    await page.goto('/cirurgia/mapa');
    await expect(page.getByTestId('tela-mapa-cirurgico')).toBeVisible();
    await page.getByTestId('pedido-duracao').fill('60');
    await page.getByTestId('pedido-procedimento').fill('COLE');
    await page.getByTestId('pedido-procedimento').press('Enter');
    await page.getByTestId('procedimento-30101271').click();
    await expect(page.getByTestId('pedido-cartao')).toHaveCount(0);
    await escolher(page.getByTestId('pedido-cirurgiao'), { indice: 1 });
    const sugestao = page.getByTestId('pedido-cartao');
    await expect(sugestao).toContainText('150 minutos');
    await expect(sugestao).toContainText('DECUBITO DORSAL');
    await page.getByTestId('pedido-usar-cartao').click();
    await expect(page.getByTestId('pedido-duracao')).toHaveValue('150');
    await semViolacaoAxe(page, '/cirurgia/mapa (sugestão do cartão de preferência)');
    expect(externas).toEqual([]);
  });
});
