// E2E @W0-03 (programa CRUD completo; hemoterapia, RDC 34/2014 art. 15 §1º): cada correção pela tela, com o motivo no
// diálogo único e a versão anterior legível:
//   - a requisição alterada (volume e urgência) antes do atendimento; as versões; depois do início, o botão some e o
//     servidor responde 409;
//   - a bolsa corrigida (volume) antes do uso, com a versão anterior; depois do uso, 409;
//   - o adendo no ato transfusional: o registro original não muda (a linha lida antes é igual à lida depois).
// axe sem violação séria nas telas e diálogos. Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados
// SINTÉTICOS; nada vai à cópia nem sai do servidor). Usa um item de hemoterapia só (a massa em memória tem poucos).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PESSOAS = ['SINT.BIOMEDICO', 'SINT.HEMOTERAPEUTA', 'SINT.ENF.PLANTAO'];
const SINAIS = { pas: 118, pad: 76, fc: 84, temperatura: 36.6 };

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
  'idempotency-key': `e2e-w003-hemo-${k}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
});

async function post(page: Page, url: string, data: unknown, k = 'p') {
  return page.request.post(`/api${url}`, { headers: await cabecalhos(page, k), data });
}

/** A agência completa (etapa 2) ligada ou desligada para as pessoas do teste, com o pré-requisito sintético da DP-21. */
async function agenciaCompleta(page: Page, ligar: boolean): Promise<void> {
  await entrar(page, 'SINT.ADMIN');
  if (ligar) {
    const pre = await page.request.put('/api/administracao/liberacao/prerequisitos', {
      headers: await cabecalhos(page, 'pre'),
      data: {
        recurso: 'agencia.completa',
        tipo: 'aprovacao',
        situacao: 'cumprido',
        validade: '2099-12-31',
        evidencia: 'decisão sintética da DP-21 (E2E do W0-03)',
        senha: SENHA,
      },
    });
    expect(pre.status(), await pre.text()).toBe(200);
  }
  const r = await post(page, '/administracao/liberacao', {
    chave: 'agencia.completa',
    tipo: 'recurso',
    escopo: 'pessoa',
    valores: PESSOAS,
    ligar,
    justificativa: 'Agência própria sintética (E2E do W0-03)',
    senha: SENHA,
  });
  expect(r.status(), await r.text()).toBe(200);
}

let req = 0;
let atendimento = 0;
let paciente = 0;
let ato = 0;
let bolsaId = 0;
let agora = '';
const numero = `SINT03E${String(Date.now()).slice(-6)}`;
const validade = () => `${String(Number(agora.slice(0, 4)) + 1)}-01-31T23:59`;

test.describe.serial('Correções da hemoterapia @W0-03 @crud', () => {
  test.setTimeout(300_000);
  test.use({ actionTimeout: 30_000 });

  test('7 requisição alterada antes do atendimento, com o motivo; a versão anterior fica legível', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.MEDICO');
    const itens = (await (await page.request.get('/api/sadt/transfusao/itens')).json()) as {
      agora: string;
      itens: { item: number; atendimento: number; paciente: { id: number } }[];
    };
    agora = itens.agora;
    const item = itens.itens[0];
    expect(item, 'há um item de hemoterapia a atender na massa em memória').toBeDefined();
    atendimento = item!.atendimento;
    paciente = item!.paciente.id;
    const det = await (await page.request.get(`/api/sadt/transfusao/itens/${item!.item}`)).json();
    const r = await post(page, '/sadt/transfusao/requisicoes', {
      itemHemoterapia: item!.item,
      atendimento,
      quantidadeBolsas: 1,
      volumeMl: null,
      urgencia: 'rotina',
      programadaPara: null,
      indicacao: 'Hemoglobina sintética 6,9 (E2E do W0-03)',
      examesDeApoio: null,
      termo: det.termos[0]?.id ?? null,
      justificativaUrgencia: null,
      transfusaoAnterior: 'nao',
      reacaoAnterior: 'nao',
      gestacaoAnterior: 'naoSeAplica',
    });
    expect(r.status(), await r.text()).toBe(201);
    req = (await r.json()).id;

    await page.goto('/sadt/agencia/requisicoes');
    await page.getByTestId(`tr-alterar-${req}`).click();
    await expect(page.getByTestId('tr-dialogo-alterar')).toBeVisible();
    await page.getByTestId('tr-alt-volume').fill('300');
    await escolher(page.getByTestId('tr-alt-urgencia'), 'urgente');
    // Motivo curto: o botão não confirma.
    await page.getByTestId('tr-dialogo-alterar-motivo').fill('curto');
    await expect(page.getByTestId('tr-dialogo-alterar-confirmar')).toBeDisabled();
    await page.getByTestId('tr-dialogo-alterar-motivo').fill('Volume e urgência pedidos errado');
    await semViolacaoAxe(page, '/sadt/agencia/requisicoes (alterar)');
    await page.getByTestId('tr-dialogo-alterar-confirmar').click();
    await expect(page.getByTestId('tr-mensagem')).toContainText('versão anterior');
    await expect(page.getByTestId(`tr-req-${req}`)).toContainText('Urgente');
    await page.getByTestId(`tr-versoes-${req}`).click();
    const painel = page.getByTestId(`tr-painel-versoes-${req}`);
    await expect(painel.getByTestId('tr-versao-vigente')).toContainText('Versão 2');
    await expect(painel.getByTestId('tr-versao-vigente')).toContainText('300');
    await expect(painel.getByTestId('tr-versao-1')).toContainText('Rotina');
    await expect(painel.getByTestId('tr-versao-1')).toContainText('Volume e urgência pedidos errado');
    await semViolacaoAxe(page, '/sadt/agencia/requisicoes (versões)');
    expect(externas).toEqual([]);
  });

  test('8 bolsa corrigida antes do uso, com a versão anterior legível', async ({ page }) => {
    await agenciaCompleta(page, true);
    await entrar(page, 'SINT.BIOMEDICO');
    const r = await post(page, '/sadt/agencia/bolsas', {
      numero,
      hemocomponente: 'CH',
      tipagem: { abo: 'O', rh: 'negativo' },
      volumeMl: 280,
      validade: validade(),
      origem: 'Hemocentro sintético',
      local: 1,
      irradiada: false,
      leucorreduzida: true,
      temperaturaC: 4,
      inspecaoOk: true,
      liberarNaEntrada: true,
    });
    expect(r.status(), await r.text()).toBe(201);
    bolsaId = (await r.json()).id;
    await page.goto('/sadt/agencia/estoque');
    await page.getByTestId(`ag-abrir-bolsa-${numero}`).click();
    await page.getByTestId('ag-corrigir').click();
    await expect(page.getByTestId('ag-dialogo-corrigir')).toBeVisible();
    await page.getByTestId('ag-corr-volume').fill('300');
    await page.getByTestId('ag-dialogo-corrigir-motivo').fill('Volume da etiqueta digitado errado');
    await semViolacaoAxe(page, '/sadt/agencia/estoque (corrigir)');
    await page.getByTestId('ag-dialogo-corrigir-confirmar').click();
    await expect(page.getByTestId('ag-mensagem')).toContainText('versão anterior');
    await expect(page.getByTestId('ag-versao-1')).toContainText('280 mL');
    await expect(page.getByTestId('ag-versao-1')).toContainText('Volume da etiqueta digitado errado');
    await expect(page.getByTestId(`ag-bolsa-${numero}`)).toContainText('300');
    await semViolacaoAxe(page, '/sadt/agencia/estoque (versões)');
    // Desligada a agência completa, o ato da etapa 1 não confere o estoque (a bolsa é usada no próximo passo).
    await agenciaCompleta(page, false);
  });

  test('9 depois do uso: a requisição e a bolsa não se alteram mais (409); a versão anterior continua legível', async ({
    page,
  }) => {
    await entrar(page, 'SINT.ENF.PLANTAO');
    await post(page, `/sadt/transfusao/requisicoes/${req}/amostra`, {
      pulseira: { lida: true, codigo: `P${paciente}|A${atendimento + 100}` },
      identificadoresConferidos: true,
      rotuladaNoLeito: true,
      coletadaEm: agora.slice(0, 16),
    });
    const i = await post(page, `/sadt/transfusao/requisicoes/${req}/atos`, {
      horario: null,
      pulseira: { lida: true, codigo: `P${paciente}|A${atendimento + 100}` },
      bolsa: {
        numero,
        hemocomponente: 'CH',
        tipagem: { abo: 'O', rh: 'negativo' },
        validade: validade(),
        volumeMl: 300,
        etiquetaDoReceptorConfere: true,
        inspecaoVisualOk: true,
      },
      segundoProfissional: { login: 'SINT.ENF.APOIO', senha: SENHA },
      sinaisAntes: SINAIS,
      justificativaRh: null,
    });
    expect(i.status(), await i.text()).toBe(201);
    ato = (await i.json()).ato;

    await entrar(page, 'SINT.MEDICO');
    await page.goto('/sadt/agencia/requisicoes');
    await expect(page.getByTestId(`tr-req-${req}`)).toHaveAttribute('data-estado', 'emAtendimento');
    await expect(page.getByTestId(`tr-alterar-${req}`)).toHaveCount(0);
    const depois = await post(page, `/sadt/transfusao/requisicoes/${req}/alterar`, {
      volumeMl: 250,
      motivo: 'Alterar depois do atendimento',
    });
    expect(depois.status()).toBe(409);
    expect((await depois.json()).codigo).toBe('requisicao-ja-atendida');
    await page.getByTestId(`tr-versoes-${req}`).click();
    await expect(page.getByTestId('tr-versao-1')).toContainText('Volume e urgência pedidos errado');

    await agenciaCompleta(page, true);
    await entrar(page, 'SINT.BIOMEDICO');
    await page.goto('/sadt/agencia/estoque');
    await page.getByTestId(`ag-abrir-bolsa-${numero}`).click();
    await expect(page.getByTestId('ag-bolsa-aberta')).toContainText('Transfundida');
    await expect(page.getByTestId('ag-corrigir')).toHaveCount(0);
    await expect(page.getByTestId('ag-versao-1')).toContainText('280 mL');
    const b = await (await page.request.get(`/api/sadt/agencia/bolsas/${bolsaId}`)).json();
    const usada = await post(page, `/sadt/agencia/bolsas/${bolsaId}/corrigir`, {
      volumeMl: 250,
      versao: b.bolsa.versao,
      motivo: 'Corrigir depois do uso',
    });
    expect(usada.status()).toBe(409);
    expect((await usada.json()).codigo).toBe('bolsa-usada');
    await agenciaCompleta(page, false);
  });

  test('10 adendo no ato: o registro original não muda (a linha antes = depois)', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ENF.PLANTAO');
    const ler = async () => {
      const d = await (await page.request.get(`/api/sadt/transfusao/requisicoes/${req}`)).json();
      const a = d.atos.find((x: { id: number }) => x.id === ato);
      const { adendos, tarefas, ...linha } = a;
      return { linha, adendos, tarefas };
    };
    const antes = await ler();
    await page.goto(`/enfermagem/transfusao/${req}`);
    await expect(page.getByTestId(`at-sinais-${ato}`)).toContainText('PA 118/76');
    await page.getByTestId(`at-adendo-abrir-${ato}`).click();
    await expect(page.getByTestId('at-dialogo-adendo')).toBeVisible();
    await page.getByTestId('at-ad-pas').fill('128');
    await page.getByTestId('at-dialogo-adendo-motivo').fill('PAS digitada 118 em vez de 128');
    await semViolacaoAxe(page, '/enfermagem/transfusao (adendo)');
    await page.getByTestId('at-dialogo-adendo-confirmar').click();
    await expect(page.getByTestId('at-mensagem')).toContainText('original não mudou');
    const sinais = page.getByTestId(`at-sinais-${ato}`);
    await expect(sinais).toContainText('PA 118/76');
    await expect(sinais).toContainText('Registro original');
    await expect(sinais).toContainText('PA 128/76');
    await expect(sinais).toContainText('PAS digitada 118 em vez de 128');
    const depois = await ler();
    expect(depois.linha).toEqual(antes.linha);
    expect(depois.adendos).toHaveLength(1);
    await semViolacaoAxe(page, '/enfermagem/transfusao (com adendo)');
    expect(externas).toEqual([]);
  });
});
