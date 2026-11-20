// E2E @M46.3 (ficha do M46, seções 7, 10 e 11; etapa 3: OPME): o bloco pede o OPME para a cirurgia do paciente
// internado (a sintética 704, dois dias úteis adiante); suprimentos registra a autorização da operadora (senha e guia)
// e a esterilização; a circulante abre o consumo em sala pelo quadro do bloco, lê o código da embalagem (GS1), registra
// o consumo com o rastreio por lote e série e recebe a etiqueta em três vias (ZPL: prontuário, paciente e faturamento,
// com o TUSS só na do faturamento; o código só com os IDs); sem a autorização, o consumo fica só para o supervisor; o
// faturista vê a conciliação com a conta (o indicador com o numerador e o denominador) e o rastreio reverso acha o
// paciente exposto pelo lote. axe sem violação séria. Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados
// SINTÉTICOS).
import { type Browser, expect, type Page, test } from '@playwright/test';
import { ORIGEM, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const AG = 704;
const ITEM = 950001;
const LOTE = 'L-E2E-463';
const SERIE = 'SN-E2E-1';

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

test.describe('OPME: solicitação, autorização, consumo em sala com etiqueta e conciliação @M46 @M46.3 @fase5', () => {
  test.setTimeout(300_000);

  test('OPME pedido na agenda, autorizado, consumido com etiqueta, conciliado na conta e rastreado pelo lote; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    const dia = diaUtil(2);

    // O bloco (quem agenda) pede o OPME para a cirurgia.
    await entrar(page, 'SINT.BLOCO');
    await page.goto('/suprimentos/opme');
    await expect(page.getByTestId('tela-opme-solicitacoes')).toBeVisible();
    await page.getByTestId('opme-dia').fill(dia);
    await expect(page.getByTestId(`opme-cirurgia-${AG}`)).toContainText('0 pedida');
    await semViolacaoAxe(page, '/suprimentos/opme (solicitar)');
    await page.getByTestId(`opme-escolher-${AG}`).click();
    await page.getByTestId('opme-termo').fill('placa');
    await page.getByTestId('opme-buscar').click();
    await page.getByTestId(`opme-item-${ITEM}`).getByRole('radio').check();
    await page.getByTestId('opme-tuss').fill('70000014');
    await page.getByTestId('opme-qtd').fill('1');
    // O fornecedor sugerido vem da busca no cadastro (nunca o código digitado às cegas).
    await page.getByTestId('opme-fornecedor-termo').fill('alfa');
    await page.getByTestId('opme-fornecedor-buscar').click();
    await escolher(page.getByTestId('opme-fornecedor'), '7001');
    await page.getByTestId('opme-justificativa').fill('Fixação de fratura com placa (sintético).');
    await semViolacaoAxe(page, '/suprimentos/opme (formulário)');
    await page.getByTestId('opme-solicitar').click();
    await expect(page.getByTestId('opme-mensagem')).toContainText('OPME solicitado');
    await expect(page.getByTestId(`opme-cirurgia-${AG}`)).toContainText('1 pedida');

    // Suprimentos: a autorização da operadora (senha e guia, à mão) e a esterilização.
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
    await semViolacaoAxe(sup, '/suprimentos/opme (autorização)');
    await sup.getByTestId('opme-registrar-etapa').click();
    await expect(sup.getByTestId(`opme-sol-situacao-${id}`)).toHaveText('Autorizada pela operadora');
    await escolher(sup.getByTestId('opme-etapa'), 'cme');
    await sup.getByTestId('opme-registrar-etapa').click();
    await expect(sup.getByTestId(`opme-sol-situacao-${id}`)).toHaveText('Pronta na esterilização');

    // A circulante: o consumo em sala (a leitura do código da embalagem e a etiqueta em três vias).
    const circ = await novaAba(browser, 'SINT.CIRCULANTE');
    await circ.goto('/bloco/opme');
    await circ.getByTestId('opmec-dia').fill(dia);
    await semViolacaoAxe(circ, '/bloco/opme (escolha)');
    await circ.getByTestId(`opmec-abrir-${AG}`).click();
    await expect(circ).toHaveURL(new RegExp(`/bloco/opme/${AG}$`));
    await expect(circ.getByTestId('opmec-cabecalho')).toContainText('Atendimento 77004');
    // Sem solicitação, só o supervisor registra (a circulante vê o aviso e o botão fica desabilitado).
    await circ.getByTestId('opmec-sem-solicitacao').click();
    await expect(circ.getByTestId('opmec-excecao')).toContainText('só o supervisor');
    await expect(circ.getByTestId('opmec-registrar')).toBeDisabled();
    await circ.getByTestId(`opmec-usar-${id}`).click();
    await circ.getByTestId('opmec-codigo').fill(`(01)07891234567895(17)280131(10)${LOTE}(21)${SERIE}`);
    await circ.getByTestId('opmec-ler').click();
    await expect(circ.getByTestId('opmec-leitura')).toContainText(LOTE);
    // O GTIN da embalagem fica à vista para a conferência; o item veio da solicitação.
    await expect(circ.getByTestId('opmec-leitura')).toContainText('07891234567895');
    await expect(circ.getByTestId('opmec-item')).toHaveAttribute('data-valor', String(ITEM));
    await expect(circ.getByTestId('opmec-lote')).toHaveValue(LOTE);
    await expect(circ.getByTestId('opmec-validade')).toHaveValue('2028-01-31');
    await circ.getByTestId('opmec-fabricante').fill('Fabricante Sintético');
    await circ.getByTestId('opmec-anvisa').fill('80123450001');
    await semViolacaoAxe(circ, '/bloco/opme/:agenda');
    await circ.getByTestId('opmec-registrar').click();
    await expect(circ.getByTestId('opmec-mensagem')).toContainText('Etiqueta gerada');
    const zpl = (await circ.getByTestId('opmec-zpl').textContent()) ?? '';
    // As três vias, na ordem; o TUSS e a conta só na do faturamento; o código só com os IDs; sem o nome do paciente.
    expect(zpl.match(/\^XA/g)).toHaveLength(3);
    expect(zpl.indexOf('VIA PRONTUARIO')).toBeLessThan(zpl.indexOf('VIA PACIENTE'));
    expect(zpl.indexOf('VIA PACIENTE')).toBeLessThan(zpl.indexOf('VIA FATURAMENTO'));
    expect(zpl.match(/TUSS 70000014/g)).toHaveLength(1);
    expect(zpl).toContain(`LOTE ${LOTE} SERIE ${SERIE}`);
    expect(zpl).toMatch(/\^FDOPME-\d+-\d+\^FS/);
    expect(zpl).not.toMatch(/PACIENTE SINTETICO OPME/i);
    await expect(circ.locator('[data-testid^="opmec-consumo-"]')).toHaveCount(1);
    await semViolacaoAxe(circ, '/bloco/opme/:agenda (etiqueta)');

    // O consumo de urgência pelo supervisor, de outro local (não o primeiro da lista), com o item buscado no cadastro;
    // a devolução do não usado volta ao local de onde saiu.
    const supc = await novaAba(browser, 'SINT.OPME');
    await supc.goto(`/bloco/opme/${AG}`);
    await supc.getByTestId('opmec-sem-solicitacao').click();
    await escolher(supc.getByTestId('opmec-local'), '15');
    await supc.getByTestId('opmec-termo').fill('placa');
    await supc.getByTestId('opmec-buscar-item').click();
    await escolher(supc.getByTestId('opmec-item'), String(ITEM));
    await supc.getByTestId('opmec-lote').fill('L-E2E-15');
    await supc.getByTestId('opmec-fabricante').fill('Fabricante Sintético');
    await supc.getByTestId('opmec-anvisa').fill('80123450001');
    await supc.getByTestId('opmec-justificativa').fill('Urgência: material do segundo local (sintético).');
    await supc.getByTestId('opmec-registrar').click();
    await expect(supc.getByTestId('opmec-mensagem')).toContainText('Etiqueta gerada');
    const urg = supc.locator('[data-testid^="opmec-devolver-"]').last();
    await urg.click();
    await supc.getByTestId('opmec-qtd-dev').fill('1');
    await supc.getByTestId('opmec-motivo-dev').fill('Não usado: aberto por engano (sintético).');
    await supc.getByTestId('opmec-confirmar-devolucao').click();
    await expect(supc.getByTestId('opmec-mensagem')).toContainText('devolvido');
    await supc.context().close();

    // A remissão do quadro do bloco ao OPME da cirurgia.
    await page.goto(`/bloco/rastreio?data=${dia}`);
    if (await page.getByTestId(`ras-opme-${AG}`).count())
      await expect(page.getByTestId(`ras-opme-${AG}`)).toBeVisible();

    // O faturista: a conciliação com a conta e o indicador.
    const fat = await novaAba(browser, 'SINT.FATURISTA.OPME');
    await fat.goto('/suprimentos/opme/conciliacao');
    await expect(fat.getByTestId('opmez-indicador')).toContainText('0 de 1');
    await expect(fat.locator('[data-testid^="opmez-situacao-"]', { hasText: 'Na conta' })).toHaveCount(1);
    await semViolacaoAxe(fat, '/suprimentos/opme/conciliacao');

    // Suprimentos: o rastreio reverso (entrada própria, pela permissão do rastreio) pelo item buscado e o lote acha o
    // paciente exposto e a saída do lote no estoque.
    await sup.goto('/suprimentos/opme/rastreio');
    await expect(sup.getByTestId('tela-opme-rastreio')).toBeVisible();
    await sup.getByTestId('opmez-termo').fill('placa');
    await sup.getByTestId('opmez-buscar-item').click();
    await escolher(sup.getByTestId('opmez-item'), String(ITEM));
    await sup.getByTestId('opmez-lote').fill(LOTE);
    await sup.getByTestId('opmez-rastrear').click();
    await expect(sup.getByTestId('opmez-expostos')).toContainText('Pacientes expostos: 1');
    await expect(sup.locator('[data-testid^="opmez-exposto-"]').first()).toContainText('77004');
    await expect(sup.locator('[data-testid^="opmez-saida-"]').first()).toContainText('Consumo em sala');
    await semViolacaoAxe(sup, '/suprimentos/opme/rastreio');

    for (const p of [sup, circ, fat]) await p.context().close();
    expect(externas).toEqual([]);
  });
});
