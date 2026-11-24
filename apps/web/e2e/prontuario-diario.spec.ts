// E2E @M23 (ficha, seção 10): o médico abre "Meus pacientes" → prontuário (cabeçalho fixo) → alergia ligada ao
// registro clínico → pede exames → dá ciência do crítico → receita de controle especial → atestado com CID
// autorizado → sumário de alta → assina em lote; a psicóloga registra e o médico vê só "houve atendimento"; o
// parecer pedido pela tela entra na fila, a enfermagem aceita e responde; o residente registra e o preceptor coassina;
// axe sem violação séria. Sessão real sobre a fonte
// sintética de dev e as portas em MEMÓRIA (pacientes, exames e resultados SINTÉTICOS; nada vai à cópia).
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** Registro clínico EVAM do M22 no atendimento aberto (a alergia e o parecer partem dele). */
async function registrarEvam(page: Page, paciente: number, query = ''): Promise<void> {
  await page.goto(`/pep/${paciente}/registro/EVAM${query}`);
  await expect(page.getByTestId('form-renderer')).toBeVisible();
  await page.getByRole('textbox', { name: /Quadro clínico/ }).fill('Quadro SINTETICO estável');
  await page.getByTestId('finalizar-registro').click();
  await expect(page).toHaveURL(new RegExp(`/pep/${paciente}/registro/\\d+\\?finalizado=1`));
}

/** Volta a tela ao topo: a janela e o conteúdo da casca, que rola por si em tela larga. */
async function rolarAoTopo(p: Page): Promise<void> {
  await p.evaluate(() => {
    window.scrollTo(0, 0);
    document.getElementById('conteudo')?.scrollTo(0, 0);
  });
}

test.describe('Prontuário de uso diário @M23 @fase2', () => {
  test.setTimeout(240_000);
  test('médico: painel, alergia, exames, crítico, receita, atestado, sumário e assinatura em lote; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/pep/pacientes');
    await expect(page.getByTestId('tela-meus-pacientes')).toBeVisible();
    await expect(page.getByTestId('painel-paciente-1001')).toBeVisible();
    await semViolacaoAxe(page, 'meus pacientes');
    await page.getByTestId('abrir-prontuario-1001').click();
    await expect(page).toHaveURL(/\/pep\/paciente\/1001\/linha-do-tempo/);
    await expect(page.getByTestId('tela-prontuario-paciente')).toBeVisible();
    await expect(page.getByTestId('linha-do-tempo')).toBeVisible();
    await semViolacaoAxe(page, 'prontuário: linha do tempo');

    // Alergia: no registro clínico do atendimento (feito antes, no formulário).
    await registrarEvam(page, 1001);
    await page.goto('/pep/paciente/1001/alergias');
    await expect(page.getByTestId('form-alergia')).toBeVisible();
    await escolher(page.getByTestId('alergia-agente'), { rotulo: 'DIPIRONA SINTETICO' });
    await page.getByTestId('alergia-reacao').fill('Urticária');
    await page.getByTestId('alergia-registrar').click();
    await expect(page.getByTestId('aba-alergias-conteudo')).toContainText('DIPIRONA SINTETICO');
    await semViolacaoAxe(page, 'alergias');

    // Pedido de exames: hemograma pelo catálogo.
    await page.getByTestId('aba-exames').click();
    await page.getByTestId('incluir-exame-501').click();
    await page.getByTestId('enviar-pedido').click();
    await expect(page.getByTestId('aba-exames-conteudo')).toContainText('Pedido enviado.');
    // O clique rolou a lista para baixo do cabeçalho fixo: o axe confere a tela no topo (sem alvo encoberto). Em tela
    // larga quem rola é o conteúdo da casca (#conteudo), não a janela.
    await rolarAoTopo(page);
    await semViolacaoAxe(page, 'exames');

    // Resultado crítico: ciência com a conduta.
    await page.getByTestId('aba-resultados').click();
    await expect(page.getByTestId('resultado-7001')).toContainText('Valor crítico');
    await page.getByTestId('conduta-7001').fill('Repetido o exame e iniciada a correção');
    await page.getByTestId('ciencia-7001').click();
    await expect(page.getByTestId('resultado-7001')).toContainText('Ciência de');
    await semViolacaoAxe(page, 'resultados');

    // Receita de controle especial.
    await page.getByTestId('aba-receitas').click();
    await escolher(page.getByTestId('receita-tipo'), 'controle-especial');
    await page.getByTestId('receita-medicamento-0').fill('CLONAZEPAM SINTETICO 2 mg');
    await page.getByTestId('receita-posologia-0').fill('1 comprimido à noite');
    await page.getByTestId('receita-quantidade-0').fill('30 comprimidos');
    await page.getByTestId('emitir-receita').click();
    await expect(page.getByTestId('aba-receitas-conteudo')).toContainText('Receita emitida.');
    await expect(page.getByTestId('tabela-receita')).toContainText('Receita de controle especial');
    await semViolacaoAxe(page, 'receitas');

    // Atestado com CID autorizado pelo paciente.
    await page.getByTestId('aba-atestados').click();
    await page
      .getByTestId('atestado-texto')
      .fill('Atesto, para os devidos fins, que o paciente esteve em atendimento.');
    await page.getByTestId('atestado-dias').fill('2');
    await page.getByTestId('atestado-cid').fill('J11');
    await escolher(page.getByTestId('atestado-autorizacao'), 'paciente');
    await page.getByTestId('emitir-atestado').click();
    await expect(page.getByTestId('aba-atestados-conteudo')).toContainText('Documento emitido.');
    await semViolacaoAxe(page, 'atestados');

    // Sumário de alta montado, completado e finalizado.
    await page.getByTestId('aba-alta').click();
    await page.getByTestId('sumario-diagnosticos').fill('I20 - Angina');
    await page.getByTestId('sumario-plano').fill('Retorno em 7 dias');
    await page.getByTestId('sumario-condicao').fill('Estável');
    await page.getByTestId('sumario-finalizar').click();
    await expect(page.getByTestId('aba-alta-conteudo')).toContainText('Sumário finalizado.');
    await semViolacaoAxe(page, 'alta');

    // Fim do plantão: assinatura em lote, com a senha.
    await page.goto('/inicio/assinaturas');
    await expect(page.getByTestId('lista-pendencias')).toBeVisible();
    await semViolacaoAxe(page, 'pendências de assinatura');
    await page.getByTestId('assinar-todos').click();
    await page.getByLabel('Senha (confirmação da identidade)').fill(SENHA);
    await page.getByTestId('assinar-lote').click();
    await expect(page.getByTestId('tela-assinaturas')).toContainText('assinado(s)');
    expect(externas).toEqual([]);
  });

  test('óbito (F3.3 L126): o médico emite com número e causas e cancela com motivo e senha; a declaração sai da alta e da fila de assinatura', async ({
    page,
  }) => {
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/pep/paciente/1001/alergias');
    await page.getByTestId('aba-alta').click();
    const form = page.getByTestId('form-obito');
    await expect(form).toBeVisible();
    await form.getByLabel('Data e hora do óbito').fill('2026-11-20T10:00');
    // Emitida (com número), e não rascunho: o cancelamento é o da declaração emitida.
    await form.getByLabel('Número da declaração').fill('90000001');
    await form.getByLabel('Causa (a)').fill('Causa SINTETICA imediata');
    await form.getByLabel('Parte II').fill('Condição SINTETICA');
    await form.locator('input[type=password]').fill(SENHA);
    await form.getByRole('button').click();
    await expect(page.getByTestId('aba-alta-conteudo')).toContainText('Óbito registrado em');
    const cancelar = page.getByTestId('form-cancelar-obito');
    await expect(cancelar).toBeVisible();
    await semViolacaoAxe(page, 'cancelamento da declaração de óbito');
    await page.getByTestId('cancelar-obito-motivo').fill('Paciente SINTETICO trocado na emissão');
    await cancelar.locator('input[type=password]').fill(SENHA);
    await page.getByTestId('cancelar-obito').click();
    await page.getByTestId('confirmacao').getByRole('button').last().click();
    await expect(page.getByTestId('aba-alta-conteudo')).toContainText('Declaração de óbito cancelada.');
    await expect(page.getByTestId('form-obito')).toBeVisible();
    // O documento da declaração cancelada sai de vigência: não está mais na fila de assinatura do médico.
    await page.goto('/inicio/assinaturas');
    await expect(page.getByTestId('tela-assinaturas')).toBeVisible();
    await expect(page.getByTestId('tela-assinaturas')).not.toContainText('Declaração de óbito');
  });

  test('preceptoria: o residente registra indicando o preceptor; o preceptor coassina nas pendências', async ({
    browser,
  }) => {
    const ctxRes = await browser.newContext();
    const res = await ctxRes.newPage();
    await entrar(res, 'SINT.RESIDENTE');
    await res.goto('/pep/1003/registro/EVAM');
    await expect(res.getByTestId('form-renderer')).toBeVisible();
    await res.getByRole('textbox', { name: /Quadro clínico/ }).fill('Evolução do residente SINTETICO');
    await res.getByTestId('registro-preceptor').fill('SINT.MEDICO');
    await rolarAoTopo(res);
    await semViolacaoAxe(res, 'registro do residente com preceptor');
    await res.getByTestId('finalizar-registro').click();
    await expect(res).toHaveURL(/\/pep\/1003\/registro\/\d+\?finalizado=1/);
    await ctxRes.close();

    const ctxMed = await browser.newContext();
    const med = await ctxMed.newPage();
    await entrar(med, 'SINT.MEDICO');
    await med.goto('/inicio/assinaturas');
    const lista = med.getByTestId('lista-coassinaturas');
    await expect(lista).toContainText('SINT.RESIDENTE');
    await semViolacaoAxe(med, 'coassinaturas pendentes');
    await lista.getByRole('button', { name: 'Coassinar' }).first().click();
    await expect(med.getByTestId('coassinatura-feita')).toBeVisible();
    await ctxMed.close();
  });

  test('sigilo da psicologia: o médico vê só que houve atendimento', async ({ browser }) => {
    const ctxPsi = await browser.newContext();
    const psi = await ctxPsi.newPage();
    await entrar(psi, 'SINT.PSICOLOGO');
    await registrarEvam(psi, 1003);
    await psi.goto('/pep/paciente/1003/linha-do-tempo');
    await expect(psi.getByTestId('linha-do-tempo')).toContainText('EVOLUÇÃO MÉDICA');
    await ctxPsi.close();

    const ctxMed = await browser.newContext();
    const med = await ctxMed.newPage();
    await entrar(med, 'SINT.MEDICO');
    await med.goto('/pep/paciente/1003/linha-do-tempo');
    await expect(med.getByTestId('marca-sigilo').first()).toBeVisible();
    await expect(med.getByTestId('linha-do-tempo')).toContainText('Houve atendimento.');
    await semViolacaoAxe(med, 'linha do tempo com sigilo');
    await ctxMed.close();
  });

  test('parecer: pedido pela tela (categoria, prioridade, prazo), aceito e respondido pela enfermagem', async ({
    browser,
  }) => {
    const ctxMed = await browser.newContext();
    const med = await ctxMed.newPage();
    await entrar(med, 'SINT.MEDICO');
    await med.goto('/pep/paciente/1001/linha-do-tempo');
    await med.getByTestId('pedir-parecer').click();
    await expect(med.getByTestId('form-pedir-parecer')).toBeVisible();
    await semViolacaoAxe(med, 'pedir parecer');
    await escolher(med.getByTestId('parecer-categoria'), 'enfermagem');
    await escolher(med.getByTestId('parecer-prioridade'), 'urgente');
    await med.getByTestId('parecer-prazo').fill('6');
    await med.getByTestId('parecer-abrir').click();
    await expect(med).toHaveURL(/\/pep\/1001\/registro\/MED09\?/);
    await expect(med.getByTestId('aviso-parecer')).toBeVisible();
    await med
      .getByRole('textbox', { name: /Motivo do parecer/ })
      .fill('Avaliação de lesão por pressão SINTETICO');
    await med.getByTestId('finalizar-registro').click();
    await expect(med).toHaveURL(/\/pep\/1001\/registro\/\d+\?finalizado=1/);
    await med.goto('/pep/interconsultas');
    await expect(med.getByTestId('tabela-fila')).toContainText('Urgente');
    await semViolacaoAxe(med, 'fila de pareceres');
    await ctxMed.close();

    const ctxEnf = await browser.newContext();
    const enf = await ctxEnf.newPage();
    await entrar(enf, 'SINT.ENFERMEIRO');
    await enf.goto('/pep/interconsultas');
    const linha = enf.locator('[data-testid^="parecer-"]').filter({ hasText: 'Solicitado' }).first();
    await expect(linha).toBeVisible();
    const id = (await linha.getAttribute('data-testid'))?.replace('parecer-', '') ?? '';
    await enf.getByTestId(`aceitar-${id}`).click();
    await expect(enf.getByTestId(`parecer-${id}`)).toContainText('Aceito');
    await enf.getByTestId(`responder-${id}`).click();
    await expect(enf).toHaveURL(new RegExp(`/pep/1001/registro/MED10\\?parecer=${id}`));
    await enf.getByRole('textbox', { name: /^Parecer/ }).fill('Curativo e mudança de decúbito SINTETICO');
    await enf.getByTestId('finalizar-registro').click();
    await expect(enf).toHaveURL(/\/pep\/1001\/registro\/\d+\?finalizado=1/);
    await enf.goto('/pep/interconsultas');
    await expect(enf.getByTestId(`parecer-${id}`)).toContainText('Respondido');
    await ctxEnf.close();
  });
});
