// E2E @C1-014 (05-SUP linha 24): a aba "Taxa por faixa" da tela dos consignados. O almoxarife dos consignados vê que
// não há tabela vigente, monta a tabela geral nova só com o "até" e o percentual de cada faixa (a faixa seguinte começa
// sozinha onde a anterior termina), vê na hora o que falta (percentual vazio, início no passado) sem ir ao servidor,
// grava (um POST com a Idempotency-Key e as faixas contíguas a partir de zero), vê a tabela vigente e o histórico, e
// calcula a taxa de um material com as parcelas impressas (percentual, taxa bruta, teto, total). A taxa grava só no
// banco próprio: aqui as rotas /api/suprimentos/consignados/taxas são simuladas com estado (massa SINTÉTICA); o efeito
// no banco está em apps/api/src/modulos/suprimentos/consignado-taxa.int.spec.ts. O resto da tela (saldo, remessa,
// reposição, faturamento e devolução) é provado no segundo teste pelas rotas reais do módulo, sem simulação.
import { expect, type Page, test } from '@playwright/test';
import { ORIGEM, semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const hojeSp = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

interface Faixa {
  id: number;
  fornecedor: number | null;
  valorInicial: number;
  valorFinal: number | null;
  percentual: number;
  teto: number | null;
  inicio: string;
  fim: string | null;
}

test.describe('Taxa do consignado por faixa de valor @C1-014 @fase7', () => {
  test.setTimeout(180_000);

  test('tabela geral nova com validação na hora, gravação única, vigente, histórico e cálculo; axe', async ({
    page,
  }) => {
    const hoje = hojeSp();
    const faixas: Faixa[] = [];
    const posts: { chave: string | undefined; corpo: Record<string, unknown> }[] = [];
    await page.route(/\/api\/suprimentos\/consignados\/taxas(\?.*)?$/, async (rota) => {
      const r = rota.request();
      if (r.method() === 'POST') {
        const corpo = r.postDataJSON() as {
          fornecedor: number | null;
          inicio: string;
          faixas: Omit<Faixa, 'id' | 'fornecedor' | 'inicio' | 'fim'>[];
        };
        posts.push({ chave: r.headers()['idempotency-key'], corpo });
        const ids = corpo.faixas.map((f, i) => {
          faixas.push({
            ...f,
            id: 100 + faixas.length + i,
            fornecedor: corpo.fornecedor,
            inicio: corpo.inicio,
            fim: null,
          });
          return 100 + i;
        });
        return rota.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ids }) });
      }
      return rota.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          hoje,
          fornecedor: null,
          vigentes: faixas,
          origem: faixas.length ? 'geral' : 'sem-tabela',
          historico: faixas,
        }),
      });
    });

    await entrar(page, 'SINT.CONSIGNADO');
    await page.goto('/suprimentos/consignados');
    await expect(page.getByTestId('tela-consignados')).toBeVisible();
    await page.getByTestId('consig-aba-taxas').click();
    const painel = page.getByTestId('consig-taxa');
    await expect(painel.getByTestId('consig-taxa-origem')).toContainText('Nenhuma tabela vigente');
    await expect(painel.getByText('Nenhuma tabela gravada.')).toBeVisible();

    // Validação na hora: sem percentual, o botão fica desabilitado e a mensagem aparece, sem ir ao servidor.
    await expect(painel.getByTestId('consig-taxa-inicio')).toHaveValue(hoje);
    await painel.getByTestId('consig-taxa-ate-0').fill('1000');
    await expect(painel.getByTestId('consig-taxa-recusas')).toContainText('percentual da faixa 1');
    await expect(painel.getByTestId('consig-taxa-gravar')).toBeDisabled();
    await painel.getByTestId('consig-taxa-pct-0').fill('30');

    // A segunda faixa começa sozinha em R$ 1.000,00; fica sem fim e com teto.
    await painel.getByTestId('consig-taxa-adicionar').click();
    await expect(painel.getByTestId('consig-taxa-linha-1')).toContainText('1.000,00');
    await painel.getByTestId('consig-taxa-pct-1').fill('10');
    await painel.getByTestId('consig-taxa-teto-1').fill('500');
    await expect(painel.getByTestId('consig-taxa-recusas')).toHaveCount(0);

    // Início no passado: recusado na hora.
    await painel.getByTestId('consig-taxa-inicio').fill('2020-01-01');
    await expect(painel.getByTestId('consig-taxa-recusas')).toContainText('começa hoje ou depois');
    await painel.getByTestId('consig-taxa-inicio').fill(hoje);
    await semViolacaoAxe(page, '/suprimentos/consignados (taxa por faixa)');

    await painel.getByTestId('consig-taxa-gravar').click();
    await expect(painel.getByTestId('consig-taxa-mensagem')).toContainText('2 faixa(s)');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.chave).toMatch(/^m46\.e4\.taxa\./);
    expect(posts[0]!.corpo).toEqual({
      fornecedor: null,
      inicio: hoje,
      faixas: [
        { valorInicial: 0, valorFinal: 1000, percentual: 30, teto: null },
        { valorInicial: 1000, valorFinal: null, percentual: 10, teto: 500 },
      ],
    });

    // A vigente e o histórico; o cálculo com as parcelas, inclusive o teto.
    await expect(painel.getByTestId('consig-taxa-origem')).toContainText('Tabela geral');
    await expect(painel.getByTestId('consig-taxa-vigente').locator('tbody tr')).toHaveCount(2);
    await expect(painel.getByTestId('consig-taxa-historico').locator('tbody tr')).toHaveCount(2);
    await painel.getByTestId('consig-taxa-valor').fill('999');
    await expect(painel.getByTestId('consig-taxa-calculo')).toContainText('30%');
    await expect(painel.getByTestId('consig-taxa-calculo')).toContainText('1.298,70');
    await painel.getByTestId('consig-taxa-valor').fill('20000');
    await expect(painel.getByTestId('consig-taxa-calculo')).toContainText('2.000,00');
    await expect(painel.getByTestId('consig-taxa-calculo')).toContainText('20.500,00');
    // A tabela de hoje gravada errada se corrige no mesmo dia: a tela avisa que a nova a substitui (fica inativa).
    await expect(painel.getByTestId('consig-taxa-substitui')).toContainText(
      `${hoje.slice(8, 10)}/${hoje.slice(5, 7)}/${hoje.slice(0, 4)}`,
    );
    await semViolacaoAxe(page, '/suprimentos/consignados (taxa gravada)');
  });

  // O fluxo do consignado pelas rotas reais do módulo (o ConsignadoController registrado no modulo.ts; nada simulado):
  // o consumo em sala nasce do OPME, o almoxarife registra a remessa, repõe e fatura o consumo pela nota da entrada e
  // devolve ao fornecedor. No E2E a API roda sobre a fonte sintética (porta em memória); o efeito no banco próprio,
  // inclusive a taxa da faixa no faturamento, está nos contratos consignado-porta-propria.int.spec.ts e
  // consignado-faturamento-taxa.int.spec.ts.
  test('remessa, consumo reposto e faturado e devolução pelas rotas reais do consignado; axe', async ({
    page,
    browser,
  }) => {
    const AG = 704;
    const ITEM = 950003;
    const FORN = 7001;
    const diaUtil = (n: number) => {
      const d = new Date(`${hojeSp()}T12:00:00Z`);
      for (let i = 0; i < n; i++) {
        do d.setUTCDate(d.getUTCDate() + 1);
        while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
      }
      return d.toISOString().slice(0, 10);
    };
    const novaAba = async (login: string) => {
      const ctx = await browser.newContext({ baseURL: ORIGEM, timezoneId: 'America/Sao_Paulo' });
      const p = await ctx.newPage();
      await entrar(p, login);
      return p;
    };
    const naoSimuladas: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/suprimentos/consignados')) naoSimuladas.push(r.method());
    });
    const dia = diaUtil(2);

    // O consumo consignado em sala: solicitado pelo bloco, autorizado por suprimentos e usado pela circulante.
    await entrar(page, 'SINT.BLOCO');
    await page.goto('/suprimentos/opme');
    await page.getByTestId('opme-dia').fill(dia);
    await page.getByTestId(`opme-escolher-${AG}`).click();
    await page.getByTestId('opme-termo').fill('protese');
    await page.getByTestId('opme-buscar').click();
    await page.getByTestId(`opme-item-${ITEM}`).getByRole('radio').check();
    await page.getByTestId('opme-tuss').fill('70000014');
    await page.getByTestId('opme-qtd').fill('1');
    await page.getByTestId('opme-fornecedor-termo').fill('alfa');
    await page.getByTestId('opme-fornecedor-buscar').click();
    await escolher(page.getByTestId('opme-fornecedor'), String(FORN));
    await page
      .getByTestId('opme-justificativa')
      .fill('Prótese consignada para a artroplastia (sintético C1-014).');
    await page.getByTestId('opme-solicitar').click();
    await expect(page.getByTestId('opme-mensagem')).toContainText('OPME solicitado');

    const sup = await novaAba('SINT.OPME');
    await sup.goto('/suprimentos/opme?aba=autorizacao');
    await sup.getByTestId('opme-de').fill(hojeSp());
    await sup.getByTestId('opme-ate').fill(dia);
    const solicitada = sup
      .locator('[data-testid^="opme-sol-situacao-"]')
      .filter({ hasText: 'Solicitada' })
      .first();
    const id = ((await solicitada.getAttribute('data-testid')) ?? '').replace('opme-sol-situacao-', '');
    await sup.getByTestId(`opme-sol-abrir-${id}`).click();
    await escolher(sup.getByTestId('opme-etapa'), 'autorizacao');
    await sup.getByTestId('opme-senha').fill('SENHA-C1014');
    await sup.getByTestId('opme-guia').fill('771014');
    await sup.getByTestId('opme-qtd-aut').fill('1');
    await sup.getByTestId('opme-registrar-etapa').click();
    await expect(sup.getByTestId(`opme-sol-situacao-${id}`)).toHaveText('Autorizada pela operadora');
    await sup.context().close();

    const circ = await novaAba('SINT.CIRCULANTE');
    await circ.goto(`/bloco/opme/${AG}`);
    await circ.getByTestId(`opmec-usar-${id}`).click();
    await circ.getByTestId('opmec-lote').fill('L-C1014-1');
    await circ.getByTestId('opmec-fabricante').fill('Fabricante Sintético');
    await circ.getByTestId('opmec-anvisa').fill('80123450002');
    await circ.getByTestId('opmec-registrar').click();
    await expect(circ.getByTestId('opmec-mensagem')).toContainText('Etiqueta gerada');
    await circ.context().close();

    // A tela dos consignados sobre as rotas reais: remessa, saldo, reposição, faturamento e devolução.
    await entrar(page, 'SINT.CONSIGNADO');
    await page.goto('/suprimentos/consignados');
    await expect(page.getByTestId('tela-consignados')).toBeVisible();
    await page.getByTestId('consig-aba-remessa').click();
    await page.getByTestId('consig-rem-fornecedor-termo').fill('alfa');
    await page.getByTestId('consig-rem-fornecedor-buscar').click();
    await escolher(page.getByTestId('consig-rem-fornecedor'), String(FORN));
    await page.getByTestId('consig-rem-item-termo').fill('protese');
    await page.getByTestId('consig-rem-item-buscar').click();
    await escolher(page.getByTestId('consig-rem-item'), String(ITEM));
    await page.getByTestId('consig-rem-qtd').fill('2');
    await page.getByTestId('consig-rem-nf').fill('771015');
    await page.getByTestId('consig-rem-lote').fill('L-C1014-1');
    await page.getByTestId('consig-rem-gravar').click();
    await expect(page.getByTestId('consig-mensagem')).toContainText('Remessa em consignação registrada');
    await page.getByTestId('consig-aba-saldo').click();
    await expect(page.getByTestId(`consig-saldo-valor-${FORN}-${ITEM}`)).toBeVisible();

    await page.getByTestId('consig-aba-consumos').click();
    const pendente = page
      .locator('[data-testid^="consig-reposicao-"]')
      .filter({ hasText: 'pendente' })
      .first();
    const cid = ((await pendente.getAttribute('data-testid')) ?? '').replace('consig-reposicao-', '');
    expect(cid).not.toBe('');
    await page.getByTestId(`consig-escolher-${cid}`).check();
    await page.getByTestId('consig-acao-repor').click();
    await page.getByTestId('consig-rep-nf').fill('771016');
    await page.getByTestId('consig-rep-emissao').fill(hojeSp());
    await page.getByTestId('consig-repor-gravar').click();
    await expect(page.getByTestId('consig-mensagem')).toContainText('Reposição do fornecedor registrada');
    await expect(page.getByTestId(`consig-reposicao-${cid}`)).not.toContainText('pendente');
    await page.getByTestId(`consig-escolher-${cid}`).check();
    await page.getByTestId('consig-acao-faturar').click();
    await escolher(page.getByTestId('consig-fat-nota'), '2026/10/55');
    await page.getByTestId('consig-repor-gravar').click();
    await expect(page.getByTestId('consig-mensagem')).toContainText('Faturamento ligado à nota fiscal');
    await expect(page.getByTestId(`consig-faturamento-${cid}`)).toContainText('nota 55 (10/2026)');

    await page.getByTestId('consig-aba-devolucao').click();
    await escolher(page.getByTestId('consig-dev-item'), `${FORN}:${ITEM}`);
    await page.getByTestId('consig-dev-qtd').fill('1');
    await page.getByTestId('consig-dev-motivo').fill('Material não usado no mês (sintético C1-014).');
    await page.getByTestId('consig-dev-gravar').click();
    await expect(page.getByTestId('consig-mensagem')).toContainText('Devolução ao fornecedor registrada');
    await page.getByTestId('consig-aba-movimentos').click();
    for (const t of ['remessa', 'reposicao', 'faturamento', 'devolucao'])
      expect(await page.locator(`[data-tipo="${t}"]`).count()).toBeGreaterThanOrEqual(1);
    await semViolacaoAxe(page, '/suprimentos/consignados (fluxo real)');
    // As gravações foram ao módulo real: quatro POST (remessa, reposição, faturamento, devolução), nenhum simulado.
    expect(naoSimuladas.filter((m) => m === 'POST').length).toBeGreaterThanOrEqual(4);
  });
});
