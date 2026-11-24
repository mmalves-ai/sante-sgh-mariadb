// E2E @F36-5 (F3.6, 05-SUP linha 28): vínculo do item com a referência de preço pelo caminho da ficha do item
// (/suprimentos/itens/cadastro/:id). A pessoa abre o item, vê o vigente de cada publicação, busca pela parte do código,
// escolhe a referência (o fator sugerido pela unidade e a edição vigente já vêm preenchidos), a conferência na hora
// recusa o fator zero e o início antes de hoje sem ir ao servidor, e um clique grava. A resposta perdida não grava duas
// vezes: o reenvio leva a mesma Idempotency-Key; depois do sucesso, a próxima gravação leva outra. O vínculo novo da
// mesma publicação aparece como vigente e o anterior continua no histórico. As rotas /api/suprimentos/cadastro exigem o
// banco próprio e o E2E roda com a fonte sintética (sem núcleo): as respostas são simuladas pelo Playwright com massa
// SINTÉTICA. O efeito no banco (linha do tempo por publicação, recusas, idempotência, preço da saída na conta pelo
// fator do vínculo) está em apps/api/src/modulos/suprimentos/vinculo-referencia-preco.int.spec.ts e em
// apps/api/src/modulos/farmacia/estoque-conta.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const HOJE = '2026-03-15';
const ITEM = 9001;

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({
    status,
    contentType: status >= 400 ? 'application/problem+json' : 'application/json',
    body: JSON.stringify(corpo),
  });

const fichaItem = {
  id: ITEM,
  versao: 3,
  situacao: 'ativo',
  saldoTotal: 0,
  registrosNaData: [],
  nomesPrincipios: {},
  nomesFabricantes: {},
  codigo: 'MAT-SINT-1',
  nome: 'SERINGA SINTETICA 10 ML',
  nomeResumido: null,
  tipo: 'material',
  grupo: 1,
  subgrupo: null,
  unidadeEstoque: 11,
  unidadeCompra: null,
  fatorCompraEstoque: 1,
  unidadeConsumo: null,
  fatorEstoqueConsumo: 1,
  unidadePrescricao: null,
  fatorConsumoPrescricao: 1,
  fabricante: null,
  gtin: null,
  ncm: null,
  cest: null,
  classeRisco: null,
  controlaLote: false,
  controlaValidade: false,
  controlado: false,
  antimicrobiano: false,
  altaVigilancia: false,
  fracionavel: false,
  prescritivel: false,
  estoqueMinimo: null,
  estoqueMaximo: null,
  principiosAtivos: [],
  vias: [],
  codigosBarras: [],
  apresentacoes: [],
  estabilidades: [],
};

const apoio = {
  hoje: HOJE,
  grupos: [{ id: 1, codigo: 'G1', nome: 'MATERIAIS SINTETICOS' }],
  subgrupos: [],
  unidades: [
    { id: 11, codigo: 'UN', nome: 'UNIDADE' },
    { id: 12, codigo: 'CX', nome: 'CAIXA' },
  ],
  vias: [],
  setores: [],
  centrosCusto: [],
  locais: [],
  guardas: [],
  diluentes: [],
};

const referencia = (id: number, fonte: string, codigo: string, descricao: string) => ({
  id,
  fonte,
  codigo,
  descricao,
  apresentacao: null,
  tipoProduto: 'material',
  situacao: 'ativo',
  unidade: 'CX',
  ean: null,
});
const ANTERIOR = referencia(301, 'simpro', 'SIMP-OLD', 'SERINGA SINTETICA ANTIGA');
const NOVA = referencia(302, 'simpro', 'SIMP-N10', 'SERINGA SINTETICA NOVA');
const OUTRA_PUB = referencia(303, 'brasindice', 'BRAS-77', 'SERINGA SINTETICA BRAS');

const vinculo = (
  id: number,
  r: ReturnType<typeof referencia>,
  fator: number,
  inicio: string,
  fim: string | null,
  vigente: boolean,
) => ({ id, versao: 1, referencia: r, edicao: { id: 41, numero: 'ED-SINT-9' }, fator, inicio, fim, vigente });

test.describe('Vínculo do item com a referência de preço @F36-5 @fase3', () => {
  test.setTimeout(180_000);
  test('busca pela parte do código, fator sugerido, conferência na hora, chave guardada até o sucesso; axe', async ({
    page,
  }) => {
    let historico = [
      vinculo(51, ANTERIOR, 10, '2026-01-01', null, true),
      vinculo(52, OUTRA_PUB, 5, '2026-01-01', null, true),
    ];
    const gravacoes: { chave: string; corpo: Record<string, unknown> }[] = [];
    let perder = true;
    await page.route(/\/api\/suprimentos\/cadastro\/apoio(\?.*)?$/, (rota) => json(rota, apoio));
    await page.route(new RegExp(`/api/suprimentos/cadastro/itens/${ITEM}(\\?.*)?$`), (rota) =>
      json(rota, fichaItem),
    );
    await page.route(new RegExp(`/api/suprimentos/cadastro/itens/${ITEM}/referencias-preco`), (rota) => {
      const req = rota.request();
      const url = new URL(req.url());
      if (url.pathname.endsWith('/buscar')) {
        expect(url.searchParams.get('termo')).toBe('SIMP-N');
        return json(rota, [{ ...NOVA, fatorSugerido: 10, edicaoVigente: { id: 41, numero: 'ED-SINT-9' } }]);
      }
      if (req.method() === 'GET')
        return json(rota, {
          hoje: HOJE,
          item: { id: ITEM, codigo: 'MAT-SINT-1', nome: 'SERINGA SINTETICA 10 ML', unidade: 'UN' },
          vigentes: historico.filter((v) => v.vigente),
          historico,
        });
      const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      gravacoes.push({ chave: req.headers()['idempotency-key'] ?? '', corpo });
      // A primeira resposta se perde (servidor fora do ar): a tela guarda a chave para o reenvio.
      if (perder) {
        perder = false;
        return json(
          rota,
          { type: 'about:blank', title: 'Serviço indisponível', status: 503, codigo: 'indisponivel' },
          503,
        );
      }
      historico = [
        vinculo(51, ANTERIOR, 10, '2026-01-01', '2026-03-14', false),
        historico[1]!,
        vinculo(53, NOVA, 12, HOJE, null, true),
      ];
      return json(rota, { id: 53 });
    });

    await entrar(page, 'SINT.ADMIN');
    await page.goto(`/suprimentos/itens/cadastro/${ITEM}`);
    const painel = page.getByTestId('vinculo-referencia');
    await expect(painel).toBeVisible();
    // Um vigente por publicação.
    await expect(page.getByTestId('vinculo-referencia-vigente-simpro')).toContainText('SIMP-OLD');
    await expect(page.getByTestId('vinculo-referencia-vigente-brasindice')).toContainText('BRAS-77');

    // Busca pela parte do código; ao escolher, o fator sugerido e a edição vigente já vêm.
    await page.getByTestId('vinculo-referencia-busca').fill('SIMP-N');
    await page.getByTestId('vinculo-referencia-escolher-SIMP-N10').click();
    await expect(page.getByTestId('vinculo-referencia-escolhida')).toContainText('ED-SINT-9');
    const fator = page.getByTestId('vinculo-referencia-fator');
    await expect(fator).toHaveValue('10');
    const botao = page.getByTestId('vinculo-referencia-vincular');

    // Conferência na hora, pela mesma regra do servidor: fator zero e início antes de hoje são recusados.
    await fator.fill('0');
    await expect(page.getByTestId('vinculo-referencia-recusa-fator-invalido')).toBeVisible();
    await expect(botao).toBeDisabled();
    await fator.fill('12');
    await page.getByTestId('vinculo-referencia-inicio').fill('2026-03-10');
    await expect(page.getByTestId('vinculo-referencia-recusa-vinculo-retroativo')).toBeVisible();
    await expect(botao).toBeDisabled();
    await page.getByTestId('vinculo-referencia-inicio').fill(HOJE);
    await expect(botao).toBeEnabled();
    expect(gravacoes).toHaveLength(0);

    // A resposta perdida: o erro aparece e o reenvio leva a mesma chave.
    await botao.click();
    await expect.poll(() => gravacoes.length).toBe(1);
    await expect(botao).toBeEnabled();
    await botao.click();
    await expect(page.getByTestId('vinculo-referencia-ok')).toBeVisible();
    expect(gravacoes).toHaveLength(2);
    expect(gravacoes[0]!.chave).not.toBe('');
    expect(gravacoes[1]!.chave).toBe(gravacoes[0]!.chave);
    expect(gravacoes[1]!.corpo).toEqual({ referencia: 302, edicao: 41, fator: 12, inicio: HOJE });

    // O novo vigente da publicação; o anterior fica no histórico (nada some) e a outra publicação continua.
    await expect(page.getByTestId('vinculo-referencia-vigente-simpro')).toContainText('SIMP-N10');
    await expect(page.getByTestId('vinculo-referencia-vigente-brasindice')).toContainText('BRAS-77');
    const hist = page.getByTestId('vinculo-referencia-historico');
    await expect(hist.locator('tbody tr')).toHaveCount(3);
    await expect(hist).toContainText('SIMP-OLD');
    await expect(hist).toContainText('2026-03-14');

    // A próxima gravação leva outra chave (a anterior foi usada com sucesso).
    await page.getByTestId('vinculo-referencia-busca').fill('SIMP-N');
    await page.getByTestId('vinculo-referencia-escolher-SIMP-N10').click();
    await fator.fill('15');
    await page.getByTestId('vinculo-referencia-inicio').fill('2026-03-16');
    await botao.click();
    await expect.poll(() => gravacoes.length).toBe(3);
    expect(gravacoes[2]!.chave).not.toBe(gravacoes[0]!.chave);

    await semViolacaoAxe(page, 'ficha do item com o vínculo da referência de preço');
  });
});
