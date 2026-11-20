// E2E @M46.4 (ficha do M46, seções 7, 10 e 11; etapa 4: consignados e manipulação): o bloco pede a prótese consignada
// (o item sintético 950003 do fornecedor 7001) para a cirurgia 704, suprimentos autoriza e a circulante consome em sala;
// o almoxarife dos consignados registra a remessa, vê o saldo com as parcelas, repõe e fatura o consumo pela nota da
// entrada (o indicador com o numerador e o denominador) e devolve ao fornecedor; na farmácia, o farmacêutico abre a
// ordem do item validado com a capela, o grupo, o insumo e o lote, não confere a própria ordem, o segundo farmacêutico
// confere e o insumo é baixado do estoque. axe sem violação séria. Sessão real sobre a fonte sintética e as portas em
// MEMÓRIA (dados SINTÉTICOS).
import { type Browser, expect, type Page, test } from '@playwright/test';
import { ORIGEM, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const AG = 704;
const ITEM = 950003;
const FORN = 7001;

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function novaAba(browser: Browser, login: string): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: ORIGEM, timezoneId: 'America/Sao_Paulo' });
  const p = await ctx.newPage();
  await entrar(p, login);
  return p;
}

/** O dia útil `n` adiante em São Paulo (o da cirurgia sintética 704: dois dias úteis). */
function diaUtil(n: number): string {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const d = new Date(`${hoje}T12:00:00Z`);
  for (let i = 0; i < n; i++) {
    do d.setUTCDate(d.getUTCDate() + 1);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  }
  return d.toISOString().slice(0, 10);
}
const hojeSp = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

test.describe('Consignados e manipulação @M46 @M46.4 @fase5', () => {
  test.setTimeout(360_000);

  test('consumo consignado reposto e faturado, remessa e devolução; ordem de manipulação com dupla conferência e baixa; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    const dia = diaUtil(2);

    // O consumo consignado nasce do fluxo do OPME (etapa 3): a solicitação com o fornecedor, a autorização e o consumo.
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
    await page.getByTestId('opme-justificativa').fill('Prótese consignada para a artroplastia (sintético).');
    await page.getByTestId('opme-solicitar').click();
    await expect(page.getByTestId('opme-mensagem')).toContainText('OPME solicitado');

    const sup = await novaAba(browser, 'SINT.OPME');
    await sup.goto('/suprimentos/opme?aba=autorizacao');
    await sup.getByTestId('opme-de').fill(hojeSp());
    await sup.getByTestId('opme-ate').fill(dia);
    const linha = sup.locator('[data-testid^="opme-sol-situacao-"]').first();
    await expect(linha).toHaveText('Solicitada');
    const id = ((await linha.getAttribute('data-testid')) ?? '').replace('opme-sol-situacao-', '');
    await sup.getByTestId(`opme-sol-abrir-${id}`).click();
    await escolher(sup.getByTestId('opme-etapa'), 'autorizacao');
    await sup.getByTestId('opme-senha').fill('SENHA-E2E');
    await sup.getByTestId('opme-guia').fill('778899');
    await sup.getByTestId('opme-qtd-aut').fill('1');
    await sup.getByTestId('opme-registrar-etapa').click();
    await expect(sup.getByTestId(`opme-sol-situacao-${id}`)).toHaveText('Autorizada pela operadora');
    await sup.context().close();

    const circ = await novaAba(browser, 'SINT.CIRCULANTE');
    await circ.goto(`/bloco/opme/${AG}`);
    await circ.getByTestId(`opmec-usar-${id}`).click();
    await circ.getByTestId('opmec-lote').fill('L-CONSIG-1');
    await circ.getByTestId('opmec-fabricante').fill('Fabricante Sintético');
    await circ.getByTestId('opmec-anvisa').fill('80123450002');
    await circ.getByTestId('opmec-registrar').click();
    await expect(circ.getByTestId('opmec-mensagem')).toContainText('Etiqueta gerada');
    await circ.context().close();

    // Consignados: a remessa, o saldo com as parcelas, a reposição, o faturamento e a devolução ao fornecedor.
    const consig = await novaAba(browser, 'SINT.CONSIGNADO');
    await consig.goto('/suprimentos/consignados');
    await expect(consig.getByTestId('tela-consignados')).toBeVisible();
    await expect(consig.getByTestId('consig-indicador')).toContainText(
      '1 de 1 consumos consignados sem faturamento',
    );
    await semViolacaoAxe(consig, '/suprimentos/consignados (saldo)');
    await consig.getByTestId('consig-aba-remessa').click();
    await consig.getByTestId('consig-rem-fornecedor-termo').fill('alfa');
    await consig.getByTestId('consig-rem-fornecedor-buscar').click();
    await escolher(consig.getByTestId('consig-rem-fornecedor'), String(FORN));
    await consig.getByTestId('consig-rem-item-termo').fill('protese');
    await consig.getByTestId('consig-rem-item-buscar').click();
    await escolher(consig.getByTestId('consig-rem-item'), String(ITEM));
    await consig.getByTestId('consig-rem-qtd').fill('2');
    await consig.getByTestId('consig-rem-nf').fill('445566');
    await consig.getByTestId('consig-rem-lote').fill('L-CONSIG-1');
    await semViolacaoAxe(consig, '/suprimentos/consignados (remessa)');
    await consig.getByTestId('consig-rem-gravar').click();
    await expect(consig.getByTestId('consig-mensagem')).toContainText('Remessa em consignação registrada');
    await consig.getByTestId('consig-aba-saldo').click();
    await expect(consig.getByTestId(`consig-saldo-valor-${FORN}-${ITEM}`)).toContainText('2 + 0 − 1 − 0 = 1');

    await consig.getByTestId('consig-aba-consumos').click();
    const consumo = consig.locator('[data-testid^="consig-escolher-"]').first();
    const cid = ((await consumo.getAttribute('data-testid')) ?? '').replace('consig-escolher-', '');
    await consumo.check();
    await consig.getByTestId('consig-acao-repor').click();
    await consig.getByTestId('consig-rep-nf').fill('445567');
    await consig.getByTestId('consig-rep-emissao').fill(hojeSp());
    await semViolacaoAxe(consig, '/suprimentos/consignados (reposição)');
    await consig.getByTestId('consig-repor-gravar').click();
    await expect(consig.getByTestId('consig-mensagem')).toContainText('Reposição do fornecedor registrada');
    await expect(consig.getByTestId(`consig-reposicao-${cid}`)).not.toContainText('pendente');
    await consig.getByTestId(`consig-escolher-${cid}`).check();
    await consig.getByTestId('consig-acao-faturar').click();
    // A nota da entrada escolhida na lista das notas do fornecedor com o item (revisão do M46.4).
    await escolher(consig.getByTestId('consig-fat-nota'), '2026/10/55');
    await consig.getByTestId('consig-repor-gravar').click();
    await expect(consig.getByTestId('consig-mensagem')).toContainText('Faturamento ligado à nota fiscal');
    await expect(consig.getByTestId(`consig-faturamento-${cid}`)).toContainText('nota 55 (10/2026)');
    await expect(consig.getByTestId('consig-indicador')).toContainText(
      '0 de 1 consumos consignados sem faturamento',
    );

    await consig.getByTestId('consig-aba-devolucao').click();
    await escolher(consig.getByTestId('consig-dev-item'), `${FORN}:${ITEM}`);
    await consig.getByTestId('consig-dev-qtd').fill('1');
    await consig.getByTestId('consig-dev-motivo').fill('Material não usado no mês (sintético).');
    await semViolacaoAxe(consig, '/suprimentos/consignados (devolução)');
    await consig.getByTestId('consig-dev-gravar').click();
    await expect(consig.getByTestId('consig-mensagem')).toContainText('Devolução ao fornecedor registrada');
    await consig.getByTestId('consig-aba-saldo').click();
    await expect(consig.getByTestId(`consig-saldo-valor-${FORN}-${ITEM}`)).toContainText('2 + 1 − 1 − 1 = 1');
    await consig.getByTestId('consig-aba-movimentos').click();
    for (const t of ['remessa', 'reposicao', 'faturamento', 'devolucao'])
      await expect(consig.locator(`[data-tipo="${t}"]`)).toHaveCount(1);
    await semViolacaoAxe(consig, '/suprimentos/consignados (movimentos)');
    await consig.context().close();

    // Manipulação: a ordem do item validado, a dupla conferência por outro farmacêutico e a baixa do insumo.
    const farm = await novaAba(browser, 'SINT.MANIPULACAO');
    await farm.goto('/farmacia/manipulacao');
    await expect(farm.getByTestId('tela-manipulacao')).toBeVisible();
    await expect(farm.getByTestId('manip-item-9464001')).toContainText('UTI-03');
    await expect(farm.getByTestId('manip-item-9464003')).toHaveCount(0);
    await semViolacaoAxe(farm, '/farmacia/manipulacao (itens)');
    await farm.getByTestId('manip-abrir-9464001').click();
    await escolher(farm.getByTestId('manip-grupo'), '1');
    await farm.getByTestId('manip-insumo-termo').fill('ceftriaxona');
    await farm.getByTestId('manip-insumo-buscar').click();
    await escolher(farm.getByTestId('manip-insumo'), '5005');
    await expect(farm.getByTestId('manip-saldo')).toContainText('Saldo no local');
    await escolher(farm.getByTestId('manip-lote'), { indice: 1 });
    await farm.getByTestId('manip-qtd').fill('2');
    await farm.getByTestId('manip-dose').fill('1 g em 100 mL');
    await semViolacaoAxe(farm, '/farmacia/manipulacao (ordem)');
    await farm.getByTestId('manip-abrir-gravar').click();
    await expect(farm.getByTestId('manip-mensagem')).toContainText('falta a dupla conferência');
    const ordem = farm.locator('[data-testid^="manip-situacao-"]').first();
    await expect(ordem).toContainText('Preparada');
    const oid = ((await ordem.getAttribute('data-testid')) ?? '').replace('manip-situacao-', '');
    // Quem preparou não confere a própria ordem.
    await farm.getByTestId(`manip-conferir-${oid}`).click();
    await farm.getByTestId('manip-conf-gravar').click();
    await expect(farm.getByRole('alert').first()).toContainText('outro farmacêutico');
    await farm.context().close();

    const farm2 = await novaAba(browser, 'SINT.MANIPULACAO2');
    await farm2.goto('/farmacia/manipulacao');
    await farm2.getByTestId('manip-aba-ordens').click();
    await farm2.getByTestId(`manip-conferir-${oid}`).click();
    await semViolacaoAxe(farm2, '/farmacia/manipulacao (conferência)');
    await farm2.getByTestId('manip-conf-gravar').click();
    await expect(farm2.getByTestId('manip-mensagem')).toContainText('Dupla conferência aprovada');
    await expect(farm2.getByTestId(`manip-situacao-${oid}`)).toContainText('Conferida');
    await farm2.getByTestId(`manip-baixar-${oid}`).click();
    await escolher(farm2.getByTestId('manip-baixa-centro'), '102');
    await farm2.getByTestId('manip-baixa-gravar').click();
    await expect(farm2.getByTestId('manip-mensagem')).toContainText('Insumo baixado do estoque');
    await expect(farm2.getByTestId(`manip-situacao-${oid}`)).toContainText('Insumo baixado');
    await farm2.getByTestId('manip-aba-capelas').click();
    await expect(farm2.getByTestId('manip-capela-1')).toContainText('Em funcionamento');
    await semViolacaoAxe(farm2, '/farmacia/manipulacao (capelas)');
    await farm2.context().close();

    expect(externas).toEqual([]);
  });
});
