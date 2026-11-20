// E2E @M48.4 (ficha do M48, etapa 4, notificação compulsória; seções 7, 8 regra 8, 10 e 11): a vigilância
// epidemiológica vê o cartão na página inicial, abre a fila de sugestões (CID notificável, resultado reagente e óbito),
// confirma a abertura do caso de raiva (imediata, prazo de 24 h), registra a notificação por ficha impressa e abre a
// ficha do Sinan pré-preenchida para imprimir; abre um caso sem sugestão (busca ativa) pela busca de pacientes e pela
// lista nacional e o descarta com motivo e justificativa; a lista nacional abre com os exames que disparam a sugestão.
// axe sem violação séria em cada estado. Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS;
// nada vai à cópia).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
/** O gatilho sintético da raiva (CID A820 no atendimento 948002, porta em memória da notificação compulsória). */
const GATILHO_RAIVA = 'cid:948002:A820';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Notificação compulsória: sugestão, caso, notificação, ficha do Sinan, caso manual e descarte @M48 @M48.4 @fase5', () => {
  test.setTimeout(240_000);

  test('cartão → fila → abrir caso de raiva → notificar → ficha impressa → caso manual → descartar → lista nacional; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);

    // O cartão da fila de trabalho e a tela da notificação compulsória.
    await entrar(page, 'SINT.VIGILANCIA');
    await expect(page.getByTestId('cartao-agravos')).toBeVisible();
    await page.goto('/qualidade/vigilancia/agravos');
    await expect(page.getByTestId('tela-agravos')).toBeVisible();
    await expect(page.getByTestId('agravos-resumo')).toBeVisible();
    const fila = page.getByTestId('tabela-gatilhos');
    await expect(fila).toBeVisible();
    await expect(page.getByTestId(`gatilho-${GATILHO_RAIVA}`)).toContainText('A820');
    // O resultado reagente (VDRL) e o óbito também entram como sugestão.
    await expect(fila).toContainText('VDRL');
    await semViolacaoAxe(page, '/qualidade/vigilancia/agravos (sugestões)');

    // Quem decide é a vigilância: a abertura pede confirmação na linha.
    await page.getByTestId(`abrir-${GATILHO_RAIVA}`).click();
    await expect(page.getByTestId('confirmar-abertura')).toBeVisible();
    await semViolacaoAxe(page, '/qualidade/vigilancia/agravos (confirmar abertura)');
    await page.getByTestId('confirmar-abrir').click();
    await expect(page.getByTestId('agravos-aviso')).toBeVisible();
    const caso = page.getByTestId('caso-agravo');
    await expect(caso).toBeVisible();
    await expect(caso.getByTestId('caso-paciente')).toContainText('PACIENTE SINTETICO RAIVA');
    await expect(caso.getByTestId('caso-situacao')).toContainText('Aguardando notificação');
    await expect(caso.getByTestId('caso-prazo')).toBeVisible();
    await expect(page.getByTestId(`gatilho-${GATILHO_RAIVA}`)).toHaveCount(0);
    await semViolacaoAxe(page, '/qualidade/vigilancia/agravos (caso aberto)');

    // A notificação à secretaria municipal pela ficha impressa (canal padrão até a confirmação do canal municipal).
    await caso.getByTestId('caso-notificar').click();
    const notificar = page.getByTestId('form-notificar');
    await expect(notificar).toBeVisible();
    await notificar
      .getByTestId('notificar-observacao')
      .locator('textarea')
      .fill('Ficha entregue à vigilância municipal (texto sintético).');
    await semViolacaoAxe(page, '/qualidade/vigilancia/agravos (registrar notificação)');
    await notificar.getByTestId('notificar-gravar').click();
    await expect(caso.getByTestId('caso-situacao')).toContainText('Notificado');
    await expect(caso.getByTestId('caso-notificacao')).toBeVisible();

    // A ficha do Sinan pré-preenchida para impressão.
    await caso.getByTestId('caso-ficha').click();
    await expect(page).toHaveURL(/\/qualidade\/vigilancia\/agravos\/casos\/\d+\/ficha/);
    const ficha = page.getByTestId('tela-ficha-agravo');
    await expect(ficha).toBeVisible();
    await expect(ficha.getByTestId('ficha-paciente')).toContainText('PACIENTE SINTETICO RAIVA');
    await expect(ficha.getByTestId('ficha-preenchidas')).toBeVisible();
    await expect(ficha.getByTestId('ficha-imprimir')).toBeVisible();
    await semViolacaoAxe(page, '/qualidade/vigilancia/agravos/casos/:id/ficha');
    await ficha.getByTestId('ficha-voltar').click();
    await expect(page.getByTestId('tela-agravos')).toBeVisible();

    // O caso aberto pela vigilância sem sugestão (busca ativa): paciente do cadastro e CID da lista nacional.
    await page.getByTestId('aba-fila').click();
    await page.getByTestId('manual-abrir').click();
    const manual = page.getByTestId('novo-caso-manual');
    await expect(manual).toBeVisible();
    await manual.getByTestId('manual-termo').locator('input').fill('JOSE DA SILVA');
    await manual.getByTestId('manual-buscar').click();
    await manual.locator('[data-testid^="manual-paciente-"]').first().click();
    await expect(manual.getByTestId('manual-escolhido')).toBeVisible();
    const formManual = manual.getByTestId('form-manual');
    await escolher(formManual.getByTestId('manual-cid'), 'A150');
    await formManual
      .getByTestId('manual-suspeita')
      .locator('textarea')
      .fill('Comunicado pela unidade básica de saúde (texto sintético).');
    await semViolacaoAxe(page, '/qualidade/vigilancia/agravos (caso sem sugestão)');
    await formManual.getByTestId('manual-gravar').click();
    await expect(caso).toBeVisible();
    await expect(caso.getByTestId('caso-paciente')).toContainText(/JOS. DA SILVA/);
    await expect(caso.getByTestId('caso-situacao')).toContainText('Aguardando notificação');

    // Descartar o caso: motivo e justificativa; ele fica na lista, com o motivo.
    await caso.getByTestId('caso-descartar').click();
    const descartar = page.getByTestId('form-descartar');
    await expect(descartar).toBeVisible();
    await escolher(descartar.getByTestId('descartar-motivo'), 'naoConfirmado');
    await descartar
      .getByTestId('descartar-justificativa')
      .locator('textarea')
      .fill('Baciloscopia negativa e quadro explicado por outra causa (texto sintético).');
    await semViolacaoAxe(page, '/qualidade/vigilancia/agravos (descartar)');
    await descartar.getByTestId('descartar-gravar').click();
    await expect(caso.getByTestId('caso-situacao')).toContainText('Descartado');
    await expect(caso.getByTestId('caso-descarte')).toBeVisible();

    // A lista nacional (cadastro de CID) com os exames que disparam a sugestão.
    await page.getByTestId('aba-lista').click();
    await expect(page.getByTestId('lista-nacional')).toBeVisible();
    await expect(page.getByTestId('tabela-cids')).toContainText('A820');
    await expect(page.getByTestId('gatilhos-exame')).toBeVisible();
    await semViolacaoAxe(page, '/qualidade/vigilancia/agravos (lista nacional)');

    expect(externas).toEqual([]);
  });
});
