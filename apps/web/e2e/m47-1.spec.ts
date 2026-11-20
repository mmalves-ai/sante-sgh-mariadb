// E2E @M47.1 (ficha do M47, seções 7, 10 e 11; etapa 1, requisição, amostra, ato transfusional, reação e
// hemovigilância): o médico requisita a transfusão a partir do item de hemoterapia da prescrição (com o termo de
// consentimento); a enfermeira registra a amostra com a pulseira e abre o ato à beira do leito; sem a senha certa do
// segundo profissional a transfusão não começa (o bloqueio aparece com o motivo); com a dupla checagem, o horário da
// prescrição fica administrado e o ato em curso, com as tarefas dos sinais; os sinais aos 10 a 15 minutos; a reação
// (grau 3) interrompe a transfusão e sugere a notificação imediata; na hemovigilância, os indicadores com o numerador e
// o denominador e os campos da notificação só com as iniciais, com o envio registrado. axe sem violação séria em cada
// tela. Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS; nada vai à cópia).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const UTI2 = { pulseira: 'P25002|A25202' };

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** Agora em São Paulo (o relógio do estabelecimento sintético), AAAA-MM-DDTHH:mm, mais n dias. */
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

async function sinais(
  page: Page,
  prefixo: string,
  v: { pas: string; pad: string; fc: string; temperatura: string },
) {
  for (const [c, x] of Object.entries(v)) await page.getByTestId(`${prefixo}-${c}`).fill(x);
}

test.describe('Agência transfusional: requisição, amostra, ato com dupla checagem, reação e hemovigilância @M47 @M47.1 @fase5', () => {
  test.setTimeout(300_000);

  test('prescrição de hemoterapia → requisição → amostra → ato com dupla checagem → sinais → reação → notificação; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);

    // O médico requisita a partir do item de hemoterapia da prescrição vigente (paciente da UTI, com horário).
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/sadt/agencia/requisicoes');
    await expect(page.getByTestId('tela-requisicoes-transfusao')).toBeVisible();
    const linha = page.locator('[data-testid^="tr-item-"]').filter({ hasText: 'DOIS' }).first();
    await expect(linha).toBeVisible();
    const item = (await linha.getAttribute('data-testid'))!.replace('tr-item-', '');
    await semViolacaoAxe(page, '/sadt/agencia/requisicoes (a atender)');
    await page.getByTestId(`tr-requisitar-${item}`).click();
    await expect(page.getByTestId('tr-form-requisicao')).toBeVisible();
    await escolher(page.getByTestId('tr-urgencia'), 'urgente');
    await semViolacaoAxe(page, '/sadt/agencia/requisicoes (requisitar)');
    await page.getByTestId('tr-gravar-requisicao').click();
    await expect(page.getByTestId('tr-mensagem')).toContainText('Requisição transfusional registrada');
    const req = page.locator(`[data-testid^="tr-req-"][data-item="${item}"]`).first();
    await expect(req).toHaveAttribute('data-estado', 'requisitada');
    const id = (await req.getAttribute('data-testid'))!.replace('tr-req-', '');
    await expect(page.getByTestId(`tr-item-${item}`)).toHaveCount(0);

    // A enfermeira registra a amostra com a pulseira do paciente e abre o ato à beira do leito.
    await entrar(page, 'SINT.ENF.PLANTAO');
    await page.goto('/sadt/agencia/requisicoes');
    await page.getByTestId(`tr-amostra-${id}`).click();
    await expect(page.getByTestId('tr-form-amostra')).toBeVisible();
    await page.locator('#tr-pulseira').fill(UTI2.pulseira);
    await page.getByTestId('tr-identificadores').check();
    await page.getByTestId('tr-rotulada').check();
    await semViolacaoAxe(page, '/sadt/agencia/requisicoes (amostra)');
    await page.getByTestId('tr-gravar-amostra').click();
    await expect(page.getByTestId('tr-mensagem')).toContainText('Amostra HT');
    await expect(page.getByTestId(`tr-req-${id}`)).toHaveAttribute('data-estado', 'amostraColetada');
    await page.getByTestId(`tr-ato-${id}`).click();
    await expect(page).toHaveURL(new RegExp(`/enfermagem/transfusao/${id}`));
    await expect(page.getByTestId('at-horario')).toBeVisible();

    // A bolsa conferida e os sinais de antes; a senha errada do segundo profissional bloqueia (sem dupla checagem).
    await page.locator('#at-pulseira').fill(UTI2.pulseira);
    await page.locator('#at-bolsa').fill('SINT47E2E01');
    await escolher(page.getByTestId('at-hemo'), 'CH');
    await escolher(page.getByTestId('at-abo'), 'O');
    await escolher(page.getByTestId('at-rh'), 'positivo');
    await page.getByTestId('at-validade').fill(agoraSp(20));
    await page.getByTestId('at-volume').fill('300');
    await page.getByTestId('at-etiqueta').check();
    await page.getByTestId('at-inspecao').check();
    await sinais(page, 'at-antes', { pas: '120', pad: '80', fc: '82', temperatura: '36.5' });
    await page.getByTestId('at-login').fill('SINT.ENF.APOIO');
    await page.getByTestId('at-senha').fill('senha-errada');
    await semViolacaoAxe(page, '/enfermagem/transfusao/:req (início)');
    await page.getByTestId('at-iniciar').click();
    await expect(page.locator('[data-bloqueio="sem-segundo-profissional"]')).toBeVisible();
    await page.getByTestId('at-senha').fill(SENHA);
    await page.getByTestId('at-iniciar').click();
    await expect(page.getByTestId('at-mensagem')).toContainText('Transfusão iniciada');
    const ato = page.locator('[data-testid^="at-ato-"][data-estado="emCurso"]').first();
    await expect(ato).toBeVisible();
    const idAto = (await ato.getAttribute('data-testid'))!.replace('at-ato-', '');
    await expect(page.getByTestId(`at-tarefas-${idAto}`).locator('[data-momento="antes"]')).toHaveAttribute(
      'data-situacao',
      'feita',
    );
    await semViolacaoAxe(page, '/enfermagem/transfusao/:req (em curso)');

    // Os sinais aos 10 a 15 minutos (registrados agora: fora da janela, vão ao indicador).
    await sinais(page, 'at-s', { pas: '118', pad: '78', fc: '90', temperatura: '36.8' });
    await page.getByTestId(`at-gravar-sinais-${idAto}`).click();
    await expect(page.getByTestId('at-mensagem')).toContainText('Sinais registrados');
    await expect(page.getByTestId(`at-tarefas-${idAto}`).locator('[data-momento="durante"]')).toHaveAttribute(
      'data-situacao',
      'feita',
    );

    // A reação grave interrompe a transfusão e sugere a notificação imediata.
    await page.getByTestId(`at-reacao-${idAto}`).click();
    await expect(page.getByTestId(`at-form-reacao-${idAto}`)).toBeVisible();
    await escolher(page.getByTestId('rc-tipo'), 'hemoliticaAgudaImune');
    await escolher(page.getByTestId('rc-grau'), '3');
    await page.locator('#rc-sinais-sintomas').fill('Dor lombar, febre e hipotensão (sintético)');
    await page.getByTestId('rc-conduta-comunicarMedico').check();
    await page.getByTestId('rc-volume').fill('60');
    await semViolacaoAxe(page, '/enfermagem/transfusao/:req (reação)');
    await page.getByTestId('rc-gravar').click();
    await expect(page.getByTestId('at-mensagem')).toContainText('Notificação sugerida');
    await expect(page.getByTestId(`at-ato-${idAto}`)).toHaveAttribute('data-estado', 'interrompido');

    // A hemovigilância: os indicadores com o numerador e o denominador e os campos só com as iniciais.
    await page.goto('/sadt/agencia/hemovigilancia');
    await expect(page.getByTestId('tela-hemovigilancia')).toBeVisible();
    await expect(page.getByTestId('hv-ind-reacoesPorMil')).toContainText('1 de 1');
    const reacao = page.locator('[data-testid^="hv-reacao-"]').first();
    await expect(reacao).toHaveAttribute('data-prioridade', 'imediata');
    const idReacao = (await reacao.getAttribute('data-testid'))!.replace('hv-reacao-', '');
    await page.getByTestId(`hv-campos-${idReacao}`).click();
    await expect(page.getByTestId('hv-campos-texto')).toContainText('Paciente:');
    await expect(page.getByTestId('hv-campos-texto')).not.toContainText('SINTETICO');
    await semViolacaoAxe(page, '/sadt/agencia/hemovigilancia');
    await page.getByTestId('hv-marcar').click();
    await expect(page.getByTestId('hv-mensagem')).toContainText('Envio da notificação registrado');
    await expect(page.getByTestId(`hv-reacao-${idReacao}`)).toContainText('Notificação enviada');

    expect(externas).toEqual([]);
  });
});
