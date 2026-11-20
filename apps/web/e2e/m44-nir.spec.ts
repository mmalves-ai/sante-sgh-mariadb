// E2E @M44.2 (ficha do M44, seção 10, etapa 2): a decisão de internar no PA vira a solicitação de leito pelo médico; o
// NIR analisa, reserva um leito compatível (o mapa mostra "reservado"), confirma e admite o paciente no leito reservado
// pela admissão do M21 (a solicitação sai da fila); uma reserva com a validade curta expira (o relógio do NIR em memória
// avança pelo arquivo do E2E) e a solicitação volta à análise; o outro sistema ocupa o leito reservado e a fila avisa o
// conflito; a alta prevista registrada pelo médico para amanhã fica amarela no quadro de permanência e vira vermelha
// quando vence; a reunião de leitos mostra os indicadores com numerador e denominador; a calibragem mostra as duas
// réguas; o de-para das situações aprova uma linha "a confirmar". axe sem violação séria em cada tela. Sessão real sobre
// a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS; nada vai à cópia).
import { rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { ORIGEM, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, esperarValor } from './combos.js';

const SENHA = 'Sintetico#2026';
const RELOGIO_NIR = resolve(import.meta.dirname, '../../../.tmp/e2e-nir-por-fora.json');
const LEITOS_POR_FORA = resolve(import.meta.dirname, '../../../.tmp/e2e-leitos-por-fora.json');
const CP1252 =
  'Pneumonia com hipoxemia: antibiótico venoso e oxigênio — avaliação da UTI se piorar (ação nº 2)';

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

let sequencia = 0;
async function postar(page: Page, url: string, data: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '';
  return (page.request as APIRequestContext).post(url, {
    headers: { 'x-csrf': csrf, 'idempotency-key': `e2e-m44n-${Date.now()}-${++sequencia}` },
    data: data as object,
  });
}

/** Abre um atendimento de PA SINTÉTICO pela recepção (a mesma gravação da tela de abertura do M20). */
async function abrirPa(page: Page, paciente: number): Promise<number> {
  const r = await postar(page, '/api/atendimento', {
    tipo: 'pa',
    paciente,
    convenio: 306,
    profissional: 7101,
    especialidade: 15,
    unidade: 3,
    centroCusto: 300400,
    procedimento: 10101039,
    carater: 'urgencia',
    cidPrincipal: 1,
    matricula: '900000000778',
  });
  expect(r.status(), await r.text()).toBe(201);
  return Number((await r.json()).resultado.reg);
}

const avancar = (min: number) => writeFileSync(RELOGIO_NIR, JSON.stringify({ avancarMin: min }));

/** O id da solicitação do cartão mais recente que contém o texto (o nome do paciente). */
async function solicitacaoDe(p: Page, texto: string): Promise<number> {
  const c = p.locator('[data-testid^="solicitacao-"]').filter({ hasText: texto }).first();
  await expect(c).toBeVisible({ timeout: 30_000 });
  return Number((await c.getAttribute('data-testid'))!.replace('solicitacao-', ''));
}

test.describe('NIR: solicitação, fila, reserva, alta prevista e permanência @M44 @M44.2 @fase5', () => {
  test.setTimeout(300_000);
  test.beforeEach(() => {
    rmSync(RELOGIO_NIR, { force: true });
    rmSync(LEITOS_POR_FORA, { force: true });
  });
  test.afterEach(() => {
    rmSync(RELOGIO_NIR, { force: true });
    rmSync(LEITOS_POR_FORA, { force: true });
  });

  test('decisão de internar no PA → fila → reserva (mapa reservado) → confirmação → admissão no leito reservado; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    const recepcao = await novaAba(browser, 'SINT.ATENDIMENTO');
    const reg = await abrirPa(recepcao, 1007);
    await recepcao.context().close();

    // O médico decide internar e pede o leito ao NIR (ato médico), com a indicação em CP1252.
    await entrar(page, 'SINT.MEDICO.NIR');
    await page.goto('/internacao/nir/fila');
    await expect(page.getByTestId('tela-fila-nir')).toBeVisible();
    await expect(page.getByTestId('nir-pedir')).toBeVisible();
    await escolher(page.getByTestId('nir-atendimento'), String(reg));
    await escolher(page.getByTestId('nir-prioridade'), 'urgente');
    await page.locator('#nir-justificativa').fill(CP1252);
    await page.getByTestId('nir-pedir-enviar').click();
    await expect(page.getByTestId('nir-pedido-enviado')).toBeVisible();
    await semViolacaoAxe(page, '/internacao/nir/fila (médico)');

    // O NIR opera a fila em outra aba: analisa, escolhe o leito compatível e reserva.
    const nir = await novaAba(browser, 'SINT.INTERNACAO');
    await nir.goto('/internacao/nir/fila');
    const id = await solicitacaoDe(nir, 'LETÍCIA');
    const cartao = nir.getByTestId(`solicitacao-${id}`);
    await expect(cartao).toHaveAttribute('data-estado', 'solicitado');
    await expect(cartao.getByTestId('equivalente')).toContainText(/em digitação/i);
    await expect(cartao).toContainText(CP1252);
    await nir.getByTestId(`analisar-${id}`).click();
    await expect(nir.getByTestId(`solicitacao-${id}`)).toHaveAttribute('data-estado', 'em_analise');
    await nir.getByTestId(`escolher-${id}`).click();
    const reservar = nir.locator(`[data-testid^="reservar-${id}-1|ENF1|"]`).first();
    await expect(reservar).toBeVisible();
    const chave = (await reservar.getAttribute('data-testid'))!.replace(`reservar-${id}-`, '');
    await reservar.click();
    await expect(nir.getByTestId(`solicitacao-${id}`)).toHaveAttribute('data-estado', 'reservado');
    await expect(nir.getByTestId(`solicitacao-${id}`).getByTestId('reserva')).toContainText('ENF1');
    await semViolacaoAxe(nir, '/internacao/nir/fila (NIR)');

    // O mapa mostra o leito reservado (só o paciente da solicitação é admitido nele).
    await nir.goto('/leitos/mapa');
    await expect(nir.getByTestId(`leito-${chave}`)).toHaveAttribute('data-situacao', 'reservado');
    await expect(nir.getByTestId(`reserva-${chave}`)).toContainText(`solicitação ${id}`);
    await semViolacaoAxe(nir, '/leitos/mapa (reservado)');

    // As reservas: confirma; depois admite pelo link do cartão (a admissão do M21 com a solicitação).
    await nir.goto('/internacao/nir/reservas');
    const reserva = nir.locator('[data-testid^="reserva-confirmar-"]').first();
    await reserva.click();
    await expect(nir.getByTestId('reservas-vigentes')).toContainText('Confirmada');
    await semViolacaoAxe(nir, '/internacao/nir/reservas');
    await nir.goto('/internacao/nir/fila');
    await nir.getByTestId(`transito-${id}`).click();
    await expect(nir.getByTestId(`solicitacao-${id}`)).toHaveAttribute('data-estado', 'em_transito');
    await nir.getByTestId(`concluir-${id}`).click();
    await expect(nir.getByTestId('admissao-vinda-nir')).toBeVisible();
    await expect(nir.getByTestId('admissao-paciente-escolhido')).toContainText('LETÍCIA');
    await escolher(nir.getByTestId('admissao-leito'), chave);
    await escolher(nir.getByTestId('admissao-convenio'), '901');
    await escolher(nir.getByTestId('admissao-especialidade'), '11');
    await nir.getByTestId('admissao-termo-medico').locator('input').fill('ANA');
    await nir.getByTestId('admissao-buscar-medico').click();
    await escolher(nir.getByTestId('admissao-assistente'), '7101');
    await escolher(nir.getByTestId('admissao-solicitante'), '7101');
    await nir.getByTestId('admissao-termo-cid').locator('input').fill('J18');
    await nir.getByTestId('admissao-buscar-cid').click();
    await escolher(nir.getByTestId('admissao-cid'), '50002');
    await nir.getByTestId('admissao-procedimento').locator('input').fill('303010037');
    await nir.getByTestId('admissao-gravar').click();
    await expect(nir.getByTestId('admissao-feita')).toBeVisible();
    // A solicitação saiu da fila (concluída) e a reserva foi consumida.
    await nir.goto('/internacao/nir/fila');
    await expect(nir.getByTestId(`solicitacao-${id}`)).toHaveCount(0);
    await nir.goto('/internacao/nir/reservas');
    await expect(nir.getByTestId('reservas-encerradas')).toContainText('Paciente no leito');
    await nir.context().close();
    expect(externas).toEqual([]);
  });

  test('reserva expirada volta à análise; leito reservado ocupado por fora avisa o NIR; alta prevista amarela → vermelha; reunião, calibragem e de-para; axe', async ({
    page,
    browser,
  }) => {
    // O médico pede o leito de outro paciente do PA.
    const recepcao = await novaAba(browser, 'SINT.ATENDIMENTO');
    const reg = await abrirPa(recepcao, 1002);
    await recepcao.context().close();
    await entrar(page, 'SINT.MEDICO.NIR');
    await page.goto('/internacao/nir/fila');
    await escolher(page.getByTestId('nir-atendimento'), String(reg));
    await page.locator('#nir-justificativa').fill('Internação sintética para antibioticoterapia venosa');
    await page.getByTestId('nir-pedir-enviar').click();
    await expect(page.getByTestId('nir-pedido-enviado')).toBeVisible();

    const nir = await novaAba(browser, 'SINT.INTERNACAO');
    await nir.goto('/internacao/nir/fila');
    const id = await solicitacaoDe(nir, 'JOSÉ DA SILVA');
    await nir.getByTestId(`escolher-${id}`).click();
    await nir.getByTestId(`solicitacao-${id}`).getByLabel('Validade da reserva (minutos)').fill('15');
    const reservar = nir.locator(`[data-testid^="reservar-${id}-1|"]`).first();
    const chave = (await reservar.getAttribute('data-testid'))!.replace(`reservar-${id}-`, '');
    await reservar.click();
    await expect(nir.getByTestId(`solicitacao-${id}`)).toHaveAttribute('data-estado', 'reservado');
    // Vinte minutos depois a reserva expirou: o leito voltou a livre e a solicitação, à análise.
    avancar(20);
    await nir.reload();
    await expect(nir.getByTestId(`solicitacao-${id}`)).toHaveAttribute('data-estado', 'em_analise');
    await nir.goto('/internacao/nir/reservas');
    await expect(nir.getByTestId('reservas-encerradas')).toContainText('Expirada');
    await nir.goto('/leitos/mapa');
    await expect(nir.getByTestId(`leito-${chave}`)).toHaveAttribute('data-situacao', 'livre');

    // Reserva de novo; o outro sistema ocupa o leito reservado: o mapa mostra o conflito e a fila avisa.
    await nir.goto('/internacao/nir/fila');
    await nir.getByTestId(`escolher-${id}`).click();
    await nir.getByTestId(`reservar-${id}-${chave}`).click();
    await expect(nir.getByTestId(`solicitacao-${id}`)).toHaveAttribute('data-estado', 'reservado');
    const [bloco, acomodacao, leito] = chave.split('|');
    writeFileSync(
      LEITOS_POR_FORA,
      JSON.stringify({
        reg: 990_442,
        bloco,
        acomodacao,
        leito,
        iniciais: 'S.N.',
        sexo: 'M',
        nascimento: '1960-01-01',
        convenio: 'CONVENIO SINTETICO',
      }),
    );
    await nir.goto('/leitos/mapa');
    await expect(nir.getByTestId(`leito-${chave}`)).toHaveAttribute('data-situacao', 'conflito');
    await nir.goto('/internacao/nir/fila');
    await expect(nir.locator('[data-testid^="conflito-reserva-"]').first()).toContainText('990442');
    rmSync(LEITOS_POR_FORA, { force: true });

    // A alta prevista: o médico registra amanhã; o quadro fica amarelo; vencida, vermelho.
    const a = await (await page.request.get('/api/nir/altas-previstas')).json();
    const internado = a.itens[0] as { internacao: number };
    const amanha = new Date(Date.parse(`${a.hoje}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const dataBr = `${amanha.slice(8, 10)}/${amanha.slice(5, 7)}/${amanha.slice(0, 4)}`;
    await page.goto('/internacao/nir/altas-previstas');
    const form = page.getByTestId(`form-dpa-${internado.internacao}`);
    await form.locator('summary').click();
    const dataCampo = form.locator('input').first();
    await dataCampo.fill(dataBr);
    await dataCampo.press('Tab');
    await page.getByTestId(`gravar-dpa-${internado.internacao}`).click();
    await expect(page.getByTestId(`internado-${internado.internacao}`).getByTestId('dpa')).toContainText(
      dataBr,
    );
    await semViolacaoAxe(page, '/internacao/nir/altas-previstas');
    // A barreira de alta pelo NIR.
    await nir.goto('/internacao/nir/altas-previstas');
    const fb = nir.getByTestId(`form-barreira-${internado.internacao}`);
    await fb.locator('summary').click();
    await fb.getByLabel('Descrição').fill('Tomografia de tórax agendada');
    await fb.getByLabel('Quem resolve (setor ou função)').fill('Imagem');
    const prazo = fb.locator('.sgh-data input').first();
    await prazo.fill(dataBr);
    await prazo.press('Tab');
    await nir.getByTestId(`gravar-barreira-${internado.internacao}`).click();
    await expect(nir.getByTestId(`internado-${internado.internacao}`)).toContainText(
      'Tomografia de tórax agendada',
    );

    await nir.goto('/internacao/nir/permanencia');
    await expect(nir.getByTestId('coluna-amarelo').getByTestId(`perm-${internado.internacao}`)).toContainText(
      'Alta prevista para amanhã.',
    );
    await expect(nir.getByTestId('indicadores-nir')).toContainText('Numerador');
    await expect(nir.getByTestId('calib-tabela')).toBeVisible();
    await semViolacaoAxe(nir, '/internacao/nir/permanencia');
    avancar(20 + 2 * 24 * 60);
    await nir.reload();
    await expect(
      nir.getByTestId('coluna-vermelho').getByTestId(`perm-${internado.internacao}`),
    ).toContainText('Alta prevista vencida.');

    // O de-para das situações: aprova uma "a confirmar".
    await nir.goto('/internacao/nir/situacoes');
    await expect(nir.getByTestId('situacoes-resumo')).toContainText('6 a confirmar');
    await escolher(nir.getByTestId('situacao-4').locator('.sgh-selecao'), 'internado');
    await nir.getByTestId('aprovar-4').click();
    await expect(nir.getByTestId('situacoes-resumo')).toContainText('5 a confirmar');
    await semViolacaoAxe(nir, '/internacao/nir/situacoes');
    await nir.context().close();
  });

  test('"Pedir o leito" de uma cirurgia que pede UTI preenche o pedido na própria tela; o pedido com o tipo de leito; axe', async ({
    page,
    browser,
  }) => {
    await entrar(page, 'SINT.MEDICO.NIR');
    await page.goto('/internacao/nir/fila');
    await expect(page.getByTestId('nir-pedir')).toBeVisible();
    // A tela já aberta (origem "pa"); o atalho da cirurgia muda só a query e a tela é reaproveitada.
    await esperarValor(page.getByTestId('nir-origem'), 'pa');
    await page.getByRole('link', { name: 'Pedir o leito' }).first().click();
    await expect(page).toHaveURL(/agendamento=990446/);
    await esperarValor(page.getByTestId('nir-origem'), 'cirurgia');
    await esperarValor(page.getByTestId('nir-cirurgia'), '990446');
    // O tipo de leito aceito: escolhido na seleção com busca, aparece entre os escolhidos e vai no pedido.
    // (o cadastro sintético: Apartamento 2, Enfermaria 1, U.T.I. 3; o pedido aceita só apartamento).
    await escolher(page.getByTestId('nir-tipo'), { rotulo: 'Apartamento' });
    await expect(page.getByTestId('nir-tipo-escolhido-2')).toContainText('Apartamento');
    const nomeTipo = 'Apartamento';
    await page.locator('#nir-justificativa').fill('Pós-operatório sintético de grande porte: leito de UTI');
    await page.getByTestId('nir-pedir-enviar').click();
    await expect(page.getByTestId('nir-pedido-enviado')).toBeVisible();
    await semViolacaoAxe(page, '/internacao/nir/fila (atalho da cirurgia)');

    // O NIR vê o pedido com o tipo no perfil e, ao escolher o leito, os de outro tipo saem com o motivo.
    const nir = await novaAba(browser, 'SINT.INTERNACAO');
    await nir.goto('/internacao/nir/fila');
    const id = await solicitacaoDe(nir, `só ${nomeTipo}`);
    await nir.getByTestId(`escolher-${id}`).click();
    await expect(nir.getByTestId(`solicitacao-${id}`)).toContainText(
      'O tipo de acomodação do leito não está entre os aceitos pelo pedido.',
      { timeout: 30_000 },
    );
    await expect(nir.locator(`[data-testid^="leito-compativel-1|APT1|"]`).first()).toBeVisible();
    await expect(nir.locator(`[data-testid^="leito-compativel-1|ENF1|"]`)).toHaveCount(0);
    await nir.context().close();
  });
});
