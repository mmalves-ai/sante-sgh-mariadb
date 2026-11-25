// C2-072 (07-FIN linha 149, F8; CPC 27 / NBC TG 27): agregação de valor na ficha do bem (registrar o componente
// buscado pela plaqueta com a soma ao custo, recusa da data futura, retirada com data, motivo e confirmação),
// imobilizado em andamento (abrir a obra, apropriar o custo por título a pagar, ativar gerando o bem) e seguro dos bens
// (incluir a apólice, segurar um bem com o subseguro visível e retirá-lo da cobertura). Fonte sintética: as rotas da API dos complementos são simuladas com page.route (sem o banco
// do cliente a porta própria responde 503); o efeito no banco é provado no contrato complementos.int.spec.ts.
import { expect, type Locator, type Page, type Route, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe } from './ajuda.js';
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

const campo = (l: Locator) =>
  l.locator('xpath=self::input | self::textarea | .//input | .//textarea').first();
const br = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const HOJE = new Date();
const UM_ANO = new Date(HOJE.getFullYear() + 1, HOJE.getMonth(), HOJE.getDate());

const APOIO = {
  grupos: [{ id: 901, codigo: 'E2E-OBR', descricao: 'Edificações sintéticas', vidaUtilMeses: 300 }],
  contas: [{ id: 801, codigo: '1.2.3.99', descricao: 'Imobilizado em andamento sintético' }],
  seguradoras: [{ id: 701, nome: 'Seguradora sintética' }],
  origens: [{ id: 601, descricao: 'Construção própria' }],
  centros: [{ id: 501, codigo: 'CC-E2E', nome: 'Centro sintético' }],
};

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

/** Estado simulado da obra: aberta → custo apropriado → ativada. */
function simularObras(page: Page) {
  const obra = {
    id: 41,
    numero: 7,
    descricao: 'Reforma sintética da ala E2E',
    grupo: { id: 901, codigo: 'E2E-OBR', descricao: 'Edificações sintéticas' },
    conta: 801,
    centro: 501,
    dataInicio: iso(HOJE),
    dataPrevista: null as string | null,
    dataAtivacao: null as string | null,
    orcadoCent: 1_000_000 as number | null,
    acumuladoCent: 0,
    orcamento: { percentual: 0 as number | null, estado: 'dentro' as string },
    bem: null as { id: number; plaqueta: string } | null,
    situacao: 'em_andamento',
    observacao: null,
    versao: 1,
    apropriacoes: [] as unknown[],
  };
  let aberta = false;
  return page.route(/\/api\/patrimonio\/(complementos\/apoio|obras)(\/.*)?(\?.*)?$/, async (rota) => {
    const url = new URL(rota.request().url());
    const metodo = rota.request().method();
    if (url.pathname.endsWith('/complementos/apoio')) return json(rota, APOIO);
    if (metodo === 'GET' && url.pathname.endsWith('/obras')) return json(rota, aberta ? [obra] : []);
    if (metodo === 'GET') return json(rota, obra);
    if (url.pathname.endsWith('/obras')) {
      aberta = true;
      return json(rota, { id: obra.id, numero: obra.numero }, 201);
    }
    if (url.pathname.endsWith('/apropriacoes')) {
      obra.acumuladoCent = 950_000;
      obra.orcamento = { percentual: 95, estado: 'alerta' };
      obra.versao += 1;
      obra.apropriacoes = [
        {
          id: 1,
          sequencia: 1,
          data: iso(HOJE),
          titulo: 3301,
          nota: null,
          conta: 801,
          descricao: null,
          valorCent: 950_000,
        },
      ];
      return json(rota, { id: 1, versao: obra.versao }, 201);
    }
    if (url.pathname.endsWith('/ativacao')) {
      obra.situacao = 'ativado';
      obra.dataAtivacao = iso(HOJE);
      obra.bem = { id: 9001, plaqueta: 'E2E-0072' };
      return json(rota, { bem: 9001 }, 201);
    }
    return json(rota, { type: 'about:blank', status: 404 }, 404);
  });
}

/** Estado simulado da apólice com um bem segurado abaixo de 80% do valor contábil (subseguro). */
function simularSeguros(page: Page) {
  const bemSegurado = {
    id: 31,
    bem: 9001,
    plaqueta: 'E2E-0072',
    descricao: 'Bem sintético',
    valorSeguradoCent: 500_000,
    valorIndenizadoCent: 0,
    inicio: iso(HOJE),
    fim: null as string | null,
    ativo: true,
    valorContabilCent: 950_000,
    cobertura: { percentual: 52, subseguro: true, detalhe: 'abaixo de 80%' },
  };
  const apolice = {
    id: 21,
    numero: 'AP-E2E-072',
    tipo: 'patrimonial',
    seguradora: { id: 701, nome: 'Seguradora sintética' },
    corretorNome: null,
    corretorTelefone: null,
    corretorEmail: null,
    cobertura: null,
    inicio: iso(HOJE),
    fim: iso(UM_ANO),
    premioCent: 120_000,
    franquiaCent: null,
    totalSeguradoCent: 0,
    anterior: null,
    situacao: 'vigente',
    situacaoVista: 'vigente',
    bensCobertos: 0,
    versao: 1,
    bens: [] as (typeof bemSegurado)[],
  };
  let incluida = false;
  return page.route(
    /\/api\/patrimonio\/(complementos\/apoio|apolices|bens-segurados|bens)(\/.*)?(\?.*)?$/,
    async (rota) => {
      const url = new URL(rota.request().url());
      const metodo = rota.request().method();
      if (url.pathname.endsWith('/complementos/apoio')) return json(rota, APOIO);
      // A busca do bem (BuscaBem) lê a lista paginada dos bens.
      if (metodo === 'GET' && /\/api\/patrimonio\/bens$/.test(url.pathname))
        return json(rota, {
          bens: [{ id: 9001, plaqueta: 'E2E-0072', descricao: 'Bem sintético', situacao: 'ativo' }],
          total: 1,
        });
      if (metodo === 'GET' && url.pathname.endsWith('/apolices'))
        return json(rota, incluida ? [apolice] : []);
      if (metodo === 'GET') return json(rota, apolice);
      if (url.pathname.endsWith('/apolices')) {
        incluida = true;
        return json(rota, { id: apolice.id }, 201);
      }
      if (url.pathname.endsWith('/bens')) {
        apolice.bens = [bemSegurado];
        apolice.bensCobertos = 1;
        apolice.totalSeguradoCent = bemSegurado.valorSeguradoCent;
        apolice.versao += 1;
        return json(rota, { id: bemSegurado.id, versao: apolice.versao }, 201);
      }
      if (url.pathname.endsWith('/retirada')) {
        bemSegurado.ativo = false;
        bemSegurado.fim = iso(HOJE);
        apolice.bensCobertos = 0;
        return json(rota, { versao: 2 });
      }
      return json(rota, { type: 'about:blank', status: 404 }, 404);
    },
  );
}

test.describe('@C2-072 imobilizado em andamento e seguro dos bens', () => {
  test('abre a obra, apropria o custo com alerta de orçamento e ativa gerando o bem', async ({ page }) => {
    await entrar(page, 'SINT.PATRIMONIO');
    await simularObras(page);
    await (await itemDoMenu(page, 'Imobilizado em andamento')).click();
    await expect(page).toHaveURL(/\/patrimonio\/obras/);
    await expect(page.getByTestId('obras-nenhuma')).toBeVisible();
    await semViolacaoAxe(page, '/patrimonio/obras');

    await page.getByTestId('obras-nova').click();
    const f = page.getByTestId('obras-form');
    await expect(f.getByTestId('obras-problemas')).toContainText('Escolha o grupo do bem.');
    await campo(f.getByTestId('obras-descricao')).fill('Reforma sintética da ala E2E');
    await escolher(f.getByTestId('obras-grupo'), '901');
    await campo(f.getByTestId('obras-orcado')).fill('10000,00');
    await expect(f.getByTestId('obras-problemas')).toHaveCount(0);
    await f.getByTestId('obras-gravar').click();
    await expect(page.getByTestId('obras-mensagem')).toContainText('Obra nº 7 aberta');
    await expect(page.getByTestId('obra-detalhe')).toBeVisible();

    await page.getByTestId('obra-apropriar').click();
    const ap = page.getByTestId('apropriacao-form');
    await campo(ap.getByTestId('apropriacao-documento')).fill('3301');
    await campo(ap.getByTestId('apropriacao-valor')).fill('9500,00');
    await ap.getByTestId('apropriacao-gravar').click();
    await expect(page.getByTestId('obras-mensagem')).toContainText('Custo apropriado');
    await expect(page.getByTestId('obra-alerta-orcamento')).toContainText('90%');
    await expect(page.getByTestId('obra-apropriacoes')).toContainText('Título a pagar nº 3301');

    await page.getByTestId('obra-ativar').click();
    const at = page.getByTestId('ativacao-form');
    // A vida útil vem preenchida pelo grupo (300 meses).
    await expect(campo(at.getByTestId('ativacao-vida'))).toHaveValue('300');
    await campo(at.getByTestId('ativacao-plaqueta')).fill('E2E-0072');
    await escolher(at.getByTestId('ativacao-origem'), '601');
    await at.getByTestId('ativacao-gravar').click();
    await expect(page.getByTestId('obras-mensagem')).toContainText('bem E2E-0072 gerado');
    await semViolacaoAxe(page, '/patrimonio/obras (ativada)');
  });

  test('inclui a apólice, segura um bem com subseguro visível e o retira da cobertura', async ({ page }) => {
    await entrar(page, 'SINT.PATRIMONIO');
    await simularSeguros(page);
    await (await itemDoMenu(page, 'Seguro dos bens')).click();
    await expect(page).toHaveURL(/\/patrimonio\/seguros/);
    await expect(page.getByTestId('seguros-nenhuma')).toBeVisible();

    await page.getByTestId('seguros-nova').click();
    const f = page.getByTestId('seguros-form');
    await campo(f.getByTestId('seguros-numero')).fill('AP-E2E-072');
    await escolher(f.getByTestId('seguros-seguradora'), '701');
    const fim = campo(f.getByTestId('seguros-fim'));
    await fim.fill(br(UM_ANO));
    await fim.press('Tab');
    await campo(f.getByTestId('seguros-premio')).fill('1200,00');
    await expect(f.getByTestId('seguros-problemas')).toHaveCount(0);
    await semViolacaoAxe(page, '/patrimonio/seguros (incluir)');
    await f.getByTestId('seguros-gravar').click();
    await expect(page.getByTestId('seguros-mensagem')).toContainText('Apólice incluída');
    await expect(page.getByTestId('apolice-detalhe')).toBeVisible();

    await page.getByTestId('apolice-segurar').click();
    const s = page.getByTestId('segurar-form');
    await campo(s.getByTestId('segurar-bem-busca')).fill('E2E-0072');
    await escolher(s.getByTestId('segurar-bem'), '9001');
    await campo(s.getByTestId('segurar-valor')).fill('5000,00');
    await s.getByTestId('segurar-gravar').click();
    await expect(page.getByTestId('seguros-mensagem')).toContainText('Bem incluído na cobertura');
    await expect(page.getByTestId('segurado-subseguro-31')).toContainText('Subseguro');

    await page.getByTestId('segurado-retirar-31').click();
    const r = page.getByTestId('retirada-form');
    await campo(r.getByTestId('retirada-motivo')).fill('Bem vendido (E2E C2-072).');
    await r.getByTestId('retirada-gravar').click();
    await page.getByTestId('confirmacao').getByRole('button').last().click();
    await expect(page.getByTestId('seguros-mensagem')).toContainText('Bem retirado da cobertura');
    await semViolacaoAxe(page, '/patrimonio/seguros (detalhe)');
  });
});

/** Bem sintético aberto na ficha, com as agregações em memória (registrar → retirar). */
function simularAgregacoes(page: Page) {
  const bem = {
    id: 9101,
    plaqueta: 'E2E-0101',
    qr: 'PAT1:e2e:E2E-0101:1',
    descricao: 'Monitor sintético E2E',
    grupo: 'equipamentoMedico',
    origem: { id: 601, nome: 'Compra' },
    documento: 'termo',
    nota: null,
    termo: null,
    empresa: 1,
    dataAquisicao: '2026-01-10',
    valorCent: 1_200_000,
    residualCent: 0,
    vidaUtilMeses: 120,
    coeficiente: null,
    inicioDepreciacao: '2026-02',
    depreciavel: true,
    centro: { id: 501, codigo: 1, nome: 'Centro sintético' },
    localDetalhe: null,
    tipoResponsavel: null,
    responsavel: null,
    marca: null,
    modelo: null,
    numeroSerie: null,
    situacao: 'ativo',
    baixadoEm: null,
    acumuladaCent: 0,
    contabilCent: 1_200_000,
    ultimaCompetencia: null,
    cotas: 0,
    movimentoPendente: null,
    versao: 3,
    criadoPor: 'SINT.PATRIMONIO',
    criadoEm: '2026-01-10T10:00:00Z',
    alteradoPor: 'SINT.PATRIMONIO',
    alteradoEm: '2026-01-10T10:00:00Z',
  };
  const componente = { ...bem, id: 9102, plaqueta: 'E2E-0102', descricao: 'Placa sintética E2E' };
  const agregacoes: Record<string, unknown>[] = [];
  let agregadoCent = 0;
  return page.route(/\/api\/patrimonio\/(bens|agregacoes|movimentos)(\/.*)?(\?.*)?$/, async (rota) => {
    const url = new URL(rota.request().url());
    const metodo = rota.request().method();
    const p = url.pathname;
    if (p.endsWith('/movimentos')) return json(rota, []);
    if (p.endsWith('/bens/codigo')) return json(rota, bem);
    if (metodo === 'GET' && /\/bens$/.test(p))
      return json(rota, {
        bens: [bem, componente],
        total: 2,
        pagina: 1,
        tamanho: 30,
        totaisPagina: { valorCent: 0, acumuladaCent: 0, contabilCent: 0 },
      });
    if (/\/bens\/9101\/(ajustes|laudos)$/.test(p)) return json(rota, []);
    if (p.endsWith('/bens/9101/agregacoes') && metodo === 'POST') {
      const corpo = rota.request().postDataJSON() as { valorCent: number; descricao: string; data: string };
      agregadoCent += corpo.valorCent;
      agregacoes.push({
        id: 71,
        sequencia: 1,
        tipo: 'componente',
        bemAgregado: { id: componente.id, plaqueta: componente.plaqueta, descricao: componente.descricao },
        numeroDocumento: null,
        descricao: corpo.descricao,
        data: corpo.data,
        valorCent: corpo.valorCent,
        agregaValor: true,
        dataDesagregacao: null,
        observacao: null,
        versao: 1,
      });
      return json(rota, { id: 71 }, 201);
    }
    if (p.endsWith('/bens/9101/agregacoes'))
      return json(rota, {
        bem: bem.id,
        versaoBem: bem.versao,
        custoCent: bem.valorCent,
        agregadoVigenteCent: agregadoCent,
        agregacoes,
      });
    if (p.endsWith('/agregacoes/71/retirada')) {
      agregacoes[0] = { ...agregacoes[0], dataDesagregacao: iso(HOJE), versao: 2 };
      agregadoCent = 0;
      return json(rota, { versao: 2 });
    }
    if (p.endsWith('/bens/9101')) return json(rota, bem);
    return rota.continue();
  });
}

test.describe('@C2-072 agregação de valor na ficha do bem', () => {
  test('registra o componente buscado pela plaqueta somando ao custo, recusa a data futura e retira com motivo', async ({
    page,
  }) => {
    await entrar(page, 'SINT.PATRIMONIO');
    await simularAgregacoes(page);
    await page.goto('/patrimonio/bens');
    await expect(page.getByTestId('tela-bens')).toBeVisible({ timeout: 30_000 });
    await campo(page.getByTestId('bens-codigo-campo')).fill('PAT1:e2e:E2E-0101:1');
    await page.getByTestId('bens-codigo-abrir').click();
    const ag = page.getByTestId('agregacoes-bem');
    await expect(ag.getByTestId('agregacoes-nenhuma')).toBeVisible({ timeout: 30_000 });

    await ag.getByTestId('agregacoes-registrar').click();
    const f = ag.getByTestId('agregacoes-form');
    await escolher(f.getByTestId('agregacoes-tipo'), 'componente');
    await expect(f.getByTestId('agregacoes-problemas')).toContainText('Escolha o bem incorporado');
    await expect(f.getByTestId('agregacoes-gravar')).toBeDisabled();
    await campo(f.getByTestId('agregacoes-componente-busca')).fill('E2E-0102');
    await escolher(f.getByTestId('agregacoes-componente'), '9102');
    await campo(f.getByTestId('agregacoes-descricao')).fill('Placa de vídeo sintética (E2E C2-072)');
    await campo(f.getByTestId('agregacoes-valor')).fill('1500,00');
    await escolher(f.getByTestId('agregacoes-soma'), 'sim');
    const amanha = new Date(HOJE.getFullYear(), HOJE.getMonth(), HOJE.getDate() + 1);
    const d = campo(f.getByTestId('agregacoes-data'));
    await d.fill(br(amanha));
    await d.press('Tab');
    await expect(f.getByTestId('agregacoes-data')).toContainText('não pode passar de');
    await d.fill(br(HOJE));
    await d.press('Tab');
    await expect(f.getByTestId('agregacoes-problemas')).toHaveCount(0);
    await semViolacaoAxe(page, '/patrimonio/bens (agregação)');
    await f.getByTestId('agregacoes-gravar').click();
    await expect(ag.getByTestId('agregacoes-mensagem')).toContainText('Agregação registrada');
    await expect(ag.getByTestId('agregacoes-custo')).toContainText('1.500,00');

    await ag.getByTestId('agregacao-retirar-71').click();
    const r = ag.getByTestId('agregacoes-retirada');
    await expect(r.getByTestId('agregacoes-retirada-confirmar')).toBeDisabled();
    await campo(r.getByTestId('agregacoes-retirada-motivo')).fill('Placa devolvida (E2E C2-072).');
    await r.getByTestId('agregacoes-retirada-confirmar').click();
    await page.getByTestId('confirmacao').getByRole('button').last().click();
    await expect(ag.getByTestId('agregacoes-mensagem')).toContainText('Retirada registrada');
    await expect(ag.getByTestId('agregacao-retirada-71')).toBeVisible();
  });
});
