// E2E @M47.2 (ficha do M47, seções 7, 10 e 11; etapa 2, construída e desligada pela chave da agência completa até a
// DP-21): a requisição e a amostra da etapa 1 (pela API, já cobertas pelo @M47.1); desligada (POL-3), a
// imuno-hematologia e o estoque ficam em consulta com o motivo; o administrador liga a agência completa com o
// pré-requisito (a DP-21 sintética); a biomédica registra a tipagem ABO e Rh (a interpretação na hora) e a pesquisa de
// anticorpos, recebe a bolsa do hemocentro e registra a prova cruzada; a hemoterapeuta libera os resultados (a dupla
// conferência); a tipagem da agência passa a valer; a bolsa é reservada para a requisição; a enfermeira inicia o ato à
// beira do leito com a bolsa reservada e a dupla checagem; a bolsa fica transfundida no estoque, com a transfusão no
// histórico; os itens do menu levam às telas; recolher volta à consulta. axe sem violação séria em cada tela e estado.
// Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS; nada vai à cópia).
import { expect, type Page, test } from '@playwright/test';
import { abrirMenuInteiro, menuPrincipal, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PULSEIRAS: Readonly<Record<number, string>> = { 25101: 'P25001|A25201', 25102: 'P25002|A25202' };
const PESSOAS = ['SINT.BIOMEDICO', 'SINT.HEMOTERAPEUTA', 'SINT.ENF.PLANTAO'];

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const cabecalhos = async (page: Page, k: string) => ({
  'x-csrf': (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '',
  'idempotency-key': `e2e-m47-2-${k}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
});

async function chave(page: Page, ligar: boolean): Promise<void> {
  const r = await page.request.post('/api/administracao/liberacao', {
    headers: await cabecalhos(page, `chave-${ligar}`),
    data: {
      chave: 'agencia.completa',
      tipo: 'recurso',
      escopo: 'pessoa',
      valores: PESSOAS,
      ligar,
      justificativa: 'Agência própria sintética (E2E da etapa 2)',
      senha: SENHA,
    },
  });
  expect(r.status(), await r.text()).toBe(200);
}

async function prerequisito(page: Page): Promise<void> {
  const r = await page.request.put('/api/administracao/liberacao/prerequisitos', {
    headers: await cabecalhos(page, 'pre'),
    data: {
      recurso: 'agencia.completa',
      tipo: 'aprovacao',
      situacao: 'cumprido',
      validade: '2099-12-31',
      evidencia: 'decisão sintética da DP-21 (E2E)',
      senha: SENHA,
    },
  });
  expect(r.status(), await r.text()).toBe(200);
}

/** Agora em São Paulo, AAAA-MM-DDTHH:mm, mais n dias. */
function agoraSp(dias = 0): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(Date.now() + dias * 86_400_000));
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  return `${v('year')}-${v('month')}-${v('day')}T${v('hour')}:${v('minute')}`;
}

test.describe('Agência transfusional completa: imuno-hematologia, prova cruzada e estoque @M47 @M47.2 @fase5', () => {
  test.setTimeout(420_000);
  // Toda ação com teto: a que não acha o elemento falha com o lugar (sem esperar o fim do teste).
  test.use({ actionTimeout: 30_000 });

  test('desligada → ligada com a DP-21 → tipagem, pesquisa, bolsa, prova, liberação, reserva → ato com a bolsa reservada → transfundida; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);

    // A requisição e a amostra (etapa 1, pela API): o primeiro item a atender de um paciente com pulseira conhecida.
    await entrar(page, 'SINT.MEDICO');
    const itens = (await (await page.request.get('/api/sadt/transfusao/itens')).json()) as {
      itens: { item: number; atendimento: number; hemocomponente: { codigo: string } }[];
    };
    // O item de concentrado de hemácias, se ainda a atender (a prova cruzada é das hemácias); senão (o @M47.1 já o
    // usou nesta sessão), o de plaquetas: sem prova cruzada, a bolsa é reservada direto.
    const comPulseira = itens.itens.filter((i) => PULSEIRAS[i.atendimento] !== undefined);
    const item = comPulseira.find((i) => i.hemocomponente.codigo === 'CH') ?? comPulseira[0]!;
    const hemo = item.hemocomponente.codigo;
    const hemacias = hemo === 'CH';
    expect(item).toBeDefined();
    const pulseira = PULSEIRAS[item.atendimento]!;
    const det = await (await page.request.get(`/api/sadt/transfusao/itens/${item.item}`)).json();
    const req = await page.request.post('/api/sadt/transfusao/requisicoes', {
      headers: await cabecalhos(page, 'req'),
      data: {
        itemHemoterapia: item.item,
        atendimento: item.atendimento,
        quantidadeBolsas: 1,
        volumeMl: null,
        urgencia: 'rotina',
        programadaPara: null,
        indicacao: 'Hemoglobina sintética 6,8 com sintomas (E2E da etapa 2)',
        examesDeApoio: null,
        termo: det.termos[0]?.id ?? null,
        justificativaUrgencia: null,
        transfusaoAnterior: 'nao',
        reacaoAnterior: 'nao',
        gestacaoAnterior: 'naoSeAplica',
      },
    });
    expect(req.status(), await req.text()).toBe(201);
    const id = (await req.json()).id as number;
    await entrar(page, 'SINT.ENF.PLANTAO');
    const am = await page.request.post(`/api/sadt/transfusao/requisicoes/${id}/amostra`, {
      headers: await cabecalhos(page, 'amostra'),
      data: {
        pulseira: { lida: true, codigo: pulseira },
        identificadoresConferidos: true,
        rotuladaNoLeito: true,
        coletadaEm: agoraSp(),
      },
    });
    expect(am.status(), await am.text()).toBe(201);

    // Desligada (POL-3): as telas ficam em consulta, com o motivo; os itens do menu levam a elas.
    await entrar(page, 'SINT.BIOMEDICO');
    await page.goto('/sadt/agencia/imuno');
    await expect(page.getByTestId('tela-imuno')).toBeVisible();
    await expect(page.getByTestId('ag-desligada')).toBeVisible();
    await page.getByTestId(`ag-abrir-${id}`).click();
    await expect(page.getByTestId('ag-receptor')).toContainText('cadastro');
    await expect(page.getByTestId('ag-form')).toHaveCount(0);
    await semViolacaoAxe(page, '/sadt/agencia/imuno (desligada)');
    await page.goto('/sadt/agencia/estoque');
    await expect(page.getByTestId('ag-desligada')).toBeVisible();
    await expect(page.getByTestId('ag-abrir-receber')).toHaveCount(0);
    await semViolacaoAxe(page, '/sadt/agencia/estoque (desligada)');
    await abrirMenuInteiro(page);
    await expect(
      menuPrincipal(page).getByRole('link', { name: 'Imuno-hematologia e prova cruzada' }),
    ).toHaveAttribute('href', '/sadt/agencia/imuno');
    await expect(
      menuPrincipal(page).getByRole('link', { name: 'Estoque de hemocomponentes' }),
    ).toHaveAttribute('href', '/sadt/agencia/estoque');

    try {
      // O administrador liga a agência completa (a DP-21 sintética como pré-requisito).
      await entrar(page, 'SINT.ADMIN');
      await prerequisito(page);
      await chave(page, true);

      // A biomédica registra a tipagem A positivo (a interpretação na hora) e a pesquisa de anticorpos negativa.
      await entrar(page, 'SINT.BIOMEDICO');
      await page.goto('/sadt/agencia/imuno');
      await expect(page.getByTestId('ag-desligada')).toHaveCount(0);
      await page.getByTestId(`ag-abrir-${id}`).click();
      await expect(page.getByTestId('ag-form')).toBeVisible();
      await escolher(page.getByTestId('ag-anti-a'), '4');
      await escolher(page.getByTestId('ag-anti-d'), '4');
      await escolher(page.getByTestId('ag-b'), '4');
      await expect(page.getByTestId('ag-interpretacao')).toContainText('A Rh positivo');
      await semViolacaoAxe(page, '/sadt/agencia/imuno (tipagem)');
      await page.getByTestId('ag-gravar').click();
      await expect(page.getByTestId('ag-mensagem')).toContainText('falta a liberação');
      await escolher(page.getByTestId('ag-tipo'), 'pai');
      await escolher(page.getByTestId('ag-pai-resultado'), 'negativo');
      await page.getByTestId('ag-gravar').click();
      await expect(page.getByTestId('ag-mensagem')).toContainText('falta a liberação');

      // A biomédica recebe a bolsa A positivo do hemocentro (liberada na entrada).
      const numero = `SINT47E2${String(Date.now()).slice(-5)}`;
      await page.goto('/sadt/agencia/estoque');
      await page.getByTestId('ag-abrir-receber').click();
      await page.locator('#ag-r-numero').fill(numero);
      await escolher(page.getByTestId('ag-r-hemo'), hemo);
      await escolher(page.getByTestId('ag-r-abo'), 'A');
      await escolher(page.getByTestId('ag-r-rh'), 'positivo');
      await page.getByTestId('ag-r-volume').fill('290');
      await page.getByTestId('ag-r-validade').fill(agoraSp(20));
      await page.locator('#ag-r-origem').fill('Hemocentro sintético');
      await page.getByTestId('ag-r-temp').fill(hemacias ? '4' : '22');
      await escolher(page.getByTestId('ag-r-leuco'), 'sim');
      await semViolacaoAxe(page, '/sadt/agencia/estoque (receber)');
      await page.getByTestId('ag-r-gravar').click();
      await expect(page.getByTestId('ag-mensagem')).toContainText('Bolsa recebida e liberada');
      await expect(page.getByTestId(`ag-situacao-${numero}`)).toContainText('Liberada');
      await expect(page.getByTestId('ag-resumo')).toBeVisible();

      // A prova cruzada da bolsa com a amostra da requisição (só nas hemácias).
      if (hemacias) {
        await page.goto('/sadt/agencia/imuno');
        await page.getByTestId(`ag-abrir-${id}`).click();
        await escolher(page.getByTestId('ag-tipo'), 'provaCruzada');
        await escolher(page.getByTestId('ag-bolsa'), numero);
        await escolher(page.getByTestId('ag-prova'), 'compativel');
        await page.getByTestId('ag-gravar').click();
        await expect(page.getByTestId('ag-mensagem')).toContainText('falta a liberação');
      }
      // Quem registrou não libera: a recusa aparece com o motivo (dupla conferência).
      await page.goto('/sadt/agencia/imuno');
      await page.locator('[data-testid^="ag-liberar-"]').first().click();
      await expect(page.getByTestId('recusa-transfusao')).toContainText('outro profissional');

      // A hemoterapeuta libera os resultados (a dupla conferência).
      await entrar(page, 'SINT.HEMOTERAPEUTA');
      await page.goto('/sadt/agencia/imuno');
      await expect(page.getByTestId('ag-fila')).toBeVisible();
      await semViolacaoAxe(page, '/sadt/agencia/imuno (a liberar)');
      for (let i = 0; i < (hemacias ? 3 : 2); i++) {
        const b = page.locator('[data-testid^="ag-liberar-"]').first();
        await b.click();
        await expect(page.getByTestId('ag-mensagem')).toContainText('Resultado liberado');
      }
      await page.getByTestId(`ag-abrir-${id}`).click();
      await expect(page.getByTestId('ag-receptor')).toContainText('A Rh positivo');
      await expect(page.getByTestId('ag-receptor')).toContainText('liberada pela agência');

      // A biomédica reserva a bolsa para a requisição.
      await entrar(page, 'SINT.BIOMEDICO');
      await page.goto('/sadt/agencia/estoque');
      await page.getByTestId(`ag-abrir-bolsa-${numero}`).click();
      await escolher(page.getByTestId('ag-mov-acao'), 'reservar');
      await escolher(page.getByTestId('ag-mov-requisicao'), String(id));
      await semViolacaoAxe(page, '/sadt/agencia/estoque (reserva)');
      await page.getByTestId('ag-mov-gravar').click();
      await expect(page.getByTestId('ag-mensagem')).toContainText('Movimento registrado');
      await expect(page.getByTestId(`ag-situacao-${numero}`)).toContainText('Reservada');

      // A enfermeira inicia o ato com a bolsa reservada e a dupla checagem.
      await entrar(page, 'SINT.ENF.PLANTAO');
      await page.goto(`/enfermagem/transfusao/${id}`);
      await expect(page.getByTestId('at-agencia')).toBeVisible();
      await expect(page.getByTestId('at-tipagem-agencia')).toContainText('A Rh positivo');
      await page.getByTestId(`at-usar-${numero}`).click();
      await page.locator('#at-pulseira').fill(pulseira);
      await page.getByTestId('at-etiqueta').check();
      await page.getByTestId('at-inspecao').check();
      for (const [c, x] of Object.entries({ pas: '120', pad: '80', fc: '82', temperatura: '36.5' }))
        await page.getByTestId(`at-antes-${c}`).fill(x);
      await page.getByTestId('at-login').fill('SINT.ENF.APOIO');
      await page.getByTestId('at-senha').fill(SENHA);
      await semViolacaoAxe(page, '/enfermagem/transfusao/:req (agência própria)');
      await page.getByTestId('at-iniciar').click();
      await expect(page.getByTestId('at-mensagem')).toContainText('Transfusão iniciada');

      // No estoque, a bolsa fica transfundida, com a transfusão no histórico.
      await entrar(page, 'SINT.BIOMEDICO');
      await page.goto('/sadt/agencia/estoque');
      await expect(page.getByTestId(`ag-situacao-${numero}`)).toContainText('Transfundida');
      await page.getByTestId(`ag-abrir-bolsa-${numero}`).click();
      await expect(page.getByTestId('ag-historico').locator('[data-tipo="transfusao"]')).toBeVisible();
      await expect(page.getByTestId('ag-form-mov')).toHaveCount(0);
      await semViolacaoAxe(page, '/sadt/agencia/estoque (transfundida)');

      // Os cadastros da agência (índice do CRUD genérico do item).
      await page.goto('/sadt/agencia/cadastros');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await semViolacaoAxe(page, '/sadt/agencia/cadastros');
    } finally {
      // Recolher: a agência completa volta à consulta.
      await entrar(page, 'SINT.ADMIN');
      await chave(page, false);
    }
    await entrar(page, 'SINT.BIOMEDICO');
    await page.goto('/sadt/agencia/estoque');
    await expect(page.getByTestId('ag-desligada')).toBeVisible();
    expect(externas).toEqual([]);
  });
});
