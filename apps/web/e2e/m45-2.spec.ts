// E2E @M45.2 (ficha do M45, seções 7, 10 e 11; etapa 2): a enfermeira abre os escores da UTI pelo menu, vê as
// reavaliações vencidas, registra a aferição com NEWS2 7 e recebe a conduta (acionar o Time de Resposta Rápida); registra
// Braden em risco aceitando e recusando com o motivo os cuidados preventivos; classifica o paciente pelo NAS no turno e
// confere a carga da unidade; o médico da UTI registra o APACHE II do caso publicado (22 pontos, 45,2%) pela
// configuração do estabelecimento e o valida com a senha; a aferição pela tela dos sinais vitais (M25) mostra o NEWS2
// e a conduta. axe sem violação séria nas telas. Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados
// SINTÉTICOS; nada vai à cópia).
import { type Browser, expect, type Page, test } from '@playwright/test';
import { ORIGEM, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

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

test.describe('Escores, classificação de pacientes e índices de UTI @M45 @M45.2 @fase5', () => {
  test.setTimeout(300_000);

  test('aferição → NEWS2 7 → aviso; Braden com os cuidados; NAS no turno; APACHE II validado pelo médico; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ENF.PLANTAO');
    await page.goto('/enfermagem/escores');
    await expect(page.getByTestId('tela-escores')).toBeVisible();
    await expect(page.getByTestId('es-unidade')).toBeVisible();
    // Internados há 30 horas sem escore: a admissão vencida aparece na unidade.
    await expect(page.getByTestId('es-linha-25001')).toContainText('vencida');
    await semViolacaoAxe(page, '/enfermagem/escores (unidade)');

    // A aferição com os sete parâmetros: NEWS2 7 → acionar o Time de Resposta Rápida.
    await page.getByTestId('es-abrir-25001').click();
    await expect(page.getByTestId('es-paciente')).toContainText('UTI-01');
    await page.getByTestId('es-af-fr').fill('26');
    await page.getByTestId('es-af-spo2').fill('93');
    await page.getByTestId('es-af-o2').fill('2');
    await page.getByTestId('es-af-pas').fill('120');
    await page.getByTestId('es-af-fc').fill('72');
    await page.getByTestId('es-af-temperatura').fill('36,8');
    await expect(page.getByTestId('es-af-previa')).toContainText('NEWS2 calculado: 7');
    await page.getByTestId('es-af-confirmar').check();
    await page.getByTestId('es-af-registrar').click();
    const conduta = page.getByTestId('es-conduta');
    await expect(conduta).toBeVisible();
    await expect(conduta).toContainText('Acionar o Time de Resposta Rápida');
    await expect(conduta).toContainText('Braden e Morse ficaram devidos');
    await expect(page.getByTestId('es-reav-braden-mudanca-quadro')).toBeVisible();
    await semViolacaoAxe(page, '/enfermagem/escores (paciente)');

    // Braden em risco: o total calculado e os cuidados preventivos (um recusado com o motivo).
    const itens: Record<string, string> = {
      percepcao: '2',
      umidade: '2',
      atividade: '1',
      mobilidade: '2',
      nutricao: '2',
      friccao: '1',
    };
    for (const [k, v] of Object.entries(itens)) await escolher(page.getByTestId(`es-item-${k}`), v);
    await expect(page.getByTestId('es-esc-previa')).toContainText('Total calculado: 10');
    await expect(page.getByTestId('es-cuidados')).toBeVisible();
    for (const c of [
      'mudancaDecubito',
      'superficieRedistribuicao',
      'protecaoProeminencias',
      'avaliacaoNutricional',
    ])
      await page.getByTestId(`es-cuidado-aceitar-${c}`).check();
    await page.getByTestId('es-cuidado-recusar-hidratacaoPele').check();
    await page.getByTestId('es-cuidado-motivo-hidratacaoPele').fill('Pele íntegra e hidratada no banho');
    await page.getByTestId('es-esc-registrar').click();
    await expect(page.getByTestId('es-mensagem')).toContainText('Braden');
    await expect(page.getByTestId('es-historico')).toContainText('Braden');
    await expect(page.getByTestId('es-reav-braden-mudanca-quadro')).toHaveCount(0);

    // A classificação do turno pelo NAS e a carga da unidade.
    await page.goto('/enfermagem/classificacao');
    await expect(page.getByTestId('tela-classificacao')).toBeVisible();
    await page.getByTestId('cl-classificar-25001').click();
    await expect(page.getByTestId('cl-dialogo')).toBeVisible();
    await escolher(page.getByTestId('cl-instrumento'), 'nas');
    await escolher(page.getByTestId('cl-nas-1'), '1b');
    await escolher(page.getByTestId('cl-nas-17'), 'sim');
    await expect(page.getByTestId('cl-previa')).toContainText('Total: 19,1');
    await semViolacaoAxe(page, '/enfermagem/classificacao (diálogo)');
    await page.getByTestId('cl-salvar').click();
    await expect(page.getByTestId('cl-mensagem')).toContainText('Classificado');
    await expect(page.getByTestId('cl-carga')).toContainText('19,1');
    await expect(page.getByTestId('cl-comparacao')).toContainText('h disponíveis');

    // A aferição pela tela dos sinais vitais (M25) com os sete parâmetros: o NEWS2 e a conduta aparecem ali também.
    await page.goto('/enfermagem/paciente/25002/sinais-vitais');
    await expect(page.getByTestId('sv-form')).toBeVisible();
    const sv: Record<string, string> = {
      fr: '26',
      spo2: '93',
      o2: '2',
      pas: '120',
      fc: '72',
      acvpu: '0',
      temperatura: '36,8',
    };
    for (const [k, x] of Object.entries(sv)) await page.getByTestId(`sv-${k}`).fill(x);
    await page.getByTestId('sv-confirmar-fora').check();
    await page.getByTestId('sv-registrar').click();
    const svNews2 = page.getByTestId('sv-news2');
    await expect(svNews2).toContainText('NEWS2 calculado: 7');
    await expect(svNews2).toContainText('Time de Resposta Rápida');
    await expect(svNews2).toContainText('Braden e Morse ficaram devidos');
    await semViolacaoAxe(page, '/enfermagem/paciente/sinais-vitais (NEWS2)');

    // O médico da UTI: o APACHE II do caso publicado, a validação com a senha.
    const med = await novaAba(browser, 'SINT.MEDICO.UTI');
    await med.goto('/pep/uti/indices');
    await expect(med.getByTestId('tela-indices-uti')).toBeVisible();
    await med.getByTestId('ui-abrir-25001').click();
    await expect(med.getByTestId('ui-paciente')).toContainText('UTI-01');
    await expect(med.getByTestId('ui-saps3')).toContainText('DP-20');
    const v: Record<string, string> = {
      TEMP: '39,2',
      PAS: '95',
      PAD: '50',
      FC: '125',
      FR: '28',
      FIO2: '0,4',
      PAO2: '68',
      PH: '7,30',
      NASERICO: '138',
      KSERICO: '3,2',
      CREATININA: '1,8',
      HEMATOCRITO: '32',
      LEUCOCITO: '18000',
    };
    for (const [k, x] of Object.entries(v)) await med.getByTestId(`ui-v-${k}`).fill(x);
    await escolher(med.getByTestId('ui-glasgow-ocular'), '3');
    await escolher(med.getByTestId('ui-glasgow-verbal'), '8');
    await escolher(med.getByTestId('ui-glasgow-motora'), '15');
    await med.getByTestId('ui-idade').fill('67');
    await escolher(med.getByTestId('ui-categoria'), { rotulo: /^Sepse/ });
    await expect(med.getByTestId('ui-previa')).toContainText('Pontuação calculada: 22');
    await expect(med.getByTestId('ui-equacao')).toContainText('R = 45,2%');
    await semViolacaoAxe(med, '/pep/uti/indices (paciente)');
    await med.getByTestId('ui-registrar').click();
    await expect(med.getByTestId('ui-mensagem')).toContainText('APACHE II 22 registrado');
    await med.locator('[data-testid^="ui-validar-"]').first().click();
    await med.getByTestId('ui-senha').fill(SENHA);
    await med.getByTestId('ui-confirmar-validacao').click();
    await expect(med.getByTestId('ui-mensagem')).toContainText('validado pelo médico');
    await expect(med.getByTestId('ui-indices')).toContainText('validado por SINT.MEDICO.UTI');
    expect(externas).toEqual([]);
  });
});
