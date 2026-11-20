// E2E @W0-03 (mercado M5, critério 13): a contenção mecânica pela tela.
//   - a enfermeira prescreve a contenção (motivo, avaliação, membros, prazo e intervalo) e a ordem aparece com os
//     horários da checagem aprazados;
//   - a checagem de um horário com achado alterado exige a observação; feita, o horário fica "Feita";
//   - a retirada encerra (o diálogo pede o motivo): o cartão volta a "Sem contenção" e o histórico mostra a retirada
//     com os horários seguintes cancelados;
//   - a ordem lançada errada é inativada pelo autor com o motivo e a senha (fica no histórico, tachada);
//   - o indicador do período imprime o numerador e o denominador;
//   - a técnica de enfermagem checa, mas não prescreve.
// Revisão W0-03: a tela se abre pelo atalho da tela dos escores; a checagem feita se corrige por adendo do autor (a
// original continua visível no histórico, com o adendo e o motivo). O médico prescritor (sem a linha do turno da
// enfermagem) abre a tela, prescreve e retira.
// axe sem violação séria. Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
// Paciente sintético da UTI só deste spec (a contenção não é usada pelos outros).
const P3 = 25103;

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function abrirUti(page: Page): Promise<void> {
  // O caminho pela interface: o atalho da tela dos escores (a entrada de menu é do W4-01).
  await page.goto('/enfermagem/escores');
  await page.getByTestId('es-atalho-contencao').click();
  await expect(page).toHaveURL(/\/enfermagem\/contencao/);
  await expect(page.getByTestId('tela-contencao')).toBeVisible();
  await escolher(page.getByTestId('enf-unidade'), 'UTI');
  await expect(page.getByTestId(`ct-paciente-${P3}`)).toBeVisible();
}

async function prescrever(page: Page, paciente = P3): Promise<void> {
  await page.getByTestId(`ct-prescrever-${paciente}`).click();
  await expect(page.getByTestId('ct-dialogo-ordem')).toBeVisible();
  await escolher(page.getByTestId('ct-motivo'), { rotulo: /retirada de dispositivo/ });
  await page.getByTestId('ct-justificativa').fill('curto');
  await page.getByTestId('ct-membro-msd').check();
  await page.getByTestId('ct-prazo').fill('1');
  await page.getByTestId('ct-intervalo').fill('15');
  await expect(page.getByTestId('ct-ordem-confirmar')).toBeDisabled();
  await page
    .getByTestId('ct-justificativa')
    .fill('Tentou retirar o tubo duas vezes; contenção verbal sem efeito');
  await page.getByTestId('ct-ordem-confirmar').click();
  await expect(page.getByTestId('ct-mensagem')).toContainText('Contenção prescrita');
  await expect(page.getByTestId(`ct-paciente-${paciente}`)).toHaveAttribute('data-situacao', 'ativa');
}

test.describe('Contenção mecânica @W0-03 @crud', () => {
  test.setTimeout(300_000);

  test('prescrever, checar, retirar, inativar a lançada errada e o indicador', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ENF.PLANTAO');
    await abrirUti(page);
    await prescrever(page);
    const cartao = page.getByTestId(`ct-paciente-${P3}`);
    // Prazo de 1 hora a cada 15 minutos: quatro horários aprazados.
    await expect(cartao.locator('[data-testid^="ct-horario-"]')).toHaveCount(4);
    await semViolacaoAxe(page, '/enfermagem/contencao (ordem ativa)');

    // A checagem do primeiro horário (já dentro da tolerância): o alterado exige a observação.
    await cartao.locator('[data-testid^="ct-checar-"]').first().click();
    await expect(page.getByTestId('ct-dialogo-checar')).toBeVisible();
    await page.getByTestId('ct-achado-pele').getByLabel('Alterado').check();
    await expect(page.getByTestId('ct-checar-confirmar')).toBeDisabled();
    await page.getByTestId('ct-observacao').fill('Hiperemia leve no punho; contenção afrouxada');
    await semViolacaoAxe(page, '/enfermagem/contencao (checagem)');
    await page.getByTestId('ct-checar-confirmar').click();
    await expect(page.getByTestId('ct-mensagem')).toContainText('alterado');
    await expect(cartao.locator('[data-estado="feita"]')).toHaveCount(1);

    // O adendo da checagem pelo autor: os achados corrigidos e o motivo; a original continua.
    await cartao.locator('[data-testid^="ct-adendo-"]').first().click();
    await expect(page.getByTestId('ct-dialogo-adendo')).toBeVisible();
    await page.getByTestId('ct-adendo-achado-pele').getByLabel('Normal').check();
    await page.getByTestId('ct-adendo-motivo').fill('curto');
    await expect(page.getByTestId('ct-adendo-confirmar')).toBeDisabled();
    await page.getByTestId('ct-adendo-motivo').fill('A hiperemia anotada era de outro paciente');
    await semViolacaoAxe(page, '/enfermagem/contencao (adendo)');
    await page.getByTestId('ct-adendo-confirmar').click();
    await expect(page.getByTestId('ct-mensagem')).toContainText('Adendo');
    await expect(cartao.locator('[data-testid^="ct-adendo-lido-"]').first()).toContainText('1 adendo');

    // A retirada com o motivo: o cartão volta a "sem contenção"; o histórico mostra a retirada e os cancelados.
    await page.getByTestId(`ct-retirar-${P3}`).click();
    await page
      .getByTestId('ct-dialogo-retirar-motivo')
      .fill('Paciente calmo, colaborativo e sem risco ao tubo');
    await page.getByTestId('ct-dialogo-retirar-confirmar').click();
    await expect(page.getByTestId('ct-mensagem')).toContainText('retirada');
    await expect(cartao).toHaveAttribute('data-situacao', 'sem');
    await page.getByTestId(`ct-historico-${P3}`).click();
    const retirada = page.locator('[data-testid^="ct-hist-"][data-situacao="retirada"]').first();
    await expect(retirada).toContainText('Retirada por SINT.ENF.PLANTAO');
    await expect(retirada).toContainText('Cancelada');
    await expect(retirada.locator('[data-testid^="ct-hist-adendo-"]').first()).toContainText(
      'era de outro paciente',
    );

    // Uma nova ordem lançada errada: o autor inativa com o motivo e a senha; fica tachada no histórico.
    await prescrever(page);
    await page.getByTestId(`ct-inativar-${P3}`).click();
    await expect(page.getByTestId('ct-dialogo-inativar')).toBeVisible();
    await page.getByTestId('ct-dialogo-inativar-motivo').fill('Ordem lançada no paciente errado');
    await page.getByTestId('ct-dialogo-inativar-senha').fill(SENHA);
    await semViolacaoAxe(page, '/enfermagem/contencao (inativar)');
    await page.getByTestId('ct-dialogo-inativar-confirmar').click();
    await expect(page.getByTestId('ct-mensagem')).toContainText('inativada');
    await expect(page.locator('[data-testid^="ct-hist-"][data-inativo="sim"]').first()).toContainText(
      'paciente errado',
    );

    // O indicador do período: o numerador e o denominador impressos.
    await page.getByTestId('ct-ind-calcular').click();
    await expect(page.getByTestId('ct-ind-impressao')).toContainText('× 1.000');
    await expect(page.getByTestId('ct-ind-resultado')).toContainText('/');
    expect(externas).toEqual([]);
  });

  // Revisão W0-03: o médico prescritor (sem a permissão da linha do turno da enfermagem) abre a tela e prescreve.
  test('o médico prescritor abre a tela, prescreve e retira a ordem', async ({ page }) => {
    const P2 = 25102;
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/enfermagem/contencao');
    await expect(page.getByTestId('tela-contencao')).toBeVisible();
    await escolher(page.getByTestId('enf-unidade'), 'UTI');
    await expect(page.getByTestId(`ct-paciente-${P2}`)).toBeVisible();
    await prescrever(page, P2);
    // A checagem é da enfermagem: o médico não checa.
    await expect(page.getByTestId(`ct-paciente-${P2}`).locator('[data-testid^="ct-checar-"]')).toHaveCount(0);
    await semViolacaoAxe(page, '/enfermagem/contencao (médico)');
    await page.getByTestId(`ct-retirar-${P2}`).click();
    await page
      .getByTestId('ct-dialogo-retirar-motivo')
      .fill('Paciente calmo e colaborativo na reavaliação médica');
    await page.getByTestId('ct-dialogo-retirar-confirmar').click();
    await expect(page.getByTestId('ct-mensagem')).toContainText('retirada');
    await expect(page.getByTestId(`ct-paciente-${P2}`)).toHaveAttribute('data-situacao', 'sem');
  });

  test('a técnica de enfermagem não prescreve', async ({ page }) => {
    await entrar(page, 'SINT.TECNICO.ENF');
    await abrirUti(page);
    await expect(page.getByTestId(`ct-prescrever-${P3}`)).toBeDisabled();
  });
});
