// E2E @C1-104 (03-PEP L100): o médico registra a alergia de dentro do formulário clínico (o componente de alergia
// grava na hora, ligado ao atendimento: D-ALE-2), retira a alergia com o motivo, reativa a retirada por engano (motivo
// obrigatório) e altera a ativa (gravidade, reação e manifestações); o histórico mostra cada passo e nada é apagado.
// Sessão real sobre a fonte sintética de dev e as portas em MEMÓRIA (modelo ALERG, agentes e manifestações
// SINTÉTICOS; nada vai à cópia).
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const AGENTE = 'CAMARÃO SINTETICO';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function abrirHistorico(cartao: ReturnType<Page['locator']>) {
  const historico = cartao.locator('[data-testid^="historico-alergia-"]').first();
  await historico.locator('summary').click();
  return historico.getByRole('list', { name: 'Histórico desta alergia' });
}

test.describe('Alergia: formulário, reativação e alteração @C1-104 @fase3', () => {
  test.setTimeout(180_000);
  test('médico registra pelo formulário, retira, reativa e altera; o histórico guarda tudo', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.MEDICO');

    // 1) Dentro do registro clínico: o componente de alergia grava na hora, ligado ao atendimento aberto.
    await page.goto('/pep/1001/registro/ALERG');
    await expect(page.getByTestId('form-renderer')).toBeVisible();
    const noFormulario = page.getByTestId('formulario-alergias');
    await expect(noFormulario).toBeVisible();
    await expect(noFormulario.getByTestId('alergia-no-formulario')).toBeVisible();
    await escolher(noFormulario.getByTestId('alergia-agente'), { rotulo: AGENTE });
    await noFormulario.getByTestId('alergia-manifestacao-1').check();
    await noFormulario.getByTestId('alergia-manifestacao-3').check();
    await noFormulario.getByTestId('alergia-registrar').click();
    await expect(noFormulario.locator('li.cartao').filter({ hasText: AGENTE }).first()).toBeVisible();
    await semViolacaoAxe(page, 'registro clínico: alergia no formulário');

    // 2) Na aba de alergias do paciente, a mesma alergia já está ativa; retirada com o motivo.
    await page.goto('/pep/paciente/1001/alergias');
    const aba = page.getByTestId('aba-alergias-conteudo');
    const ativa = () => aba.locator('li.cartao[data-testid^="alergia-"]').filter({ hasText: AGENTE });
    await expect(ativa().first()).toBeVisible();
    await ativa()
      .first()
      .locator('input[data-testid^="motivo-inativar-"]')
      .fill('Retirada por engano SINTETICO');
    await ativa().first().getByRole('button', { name: 'Retirar da lista ativa' }).click();
    await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
    await expect(ativa()).toHaveCount(0);

    // 3) Reativação: o botão só libera com o motivo (10 caracteres ou mais); a alergia volta às ativas.
    const retiradas = aba.locator('details').filter({ has: page.locator('summary', { hasText: /\(\d+\)/ }) });
    await retiradas.locator('summary').first().click();
    const retirada = retiradas.locator('li.cartao').filter({ hasText: AGENTE }).first();
    const motivoReativar = retirada.locator('input[data-testid^="motivo-reativar-"]');
    const botaoReativar = retirada.locator('[data-testid^="reativar-"]');
    await motivoReativar.fill('curto');
    await expect(botaoReativar).toBeDisabled();
    await motivoReativar.fill('Teste de provocação positivo SINTETICO');
    await expect(botaoReativar).toBeEnabled();
    await botaoReativar.click();
    await expect(ativa().first()).toBeVisible();
    const passosReativada = await abrirHistorico(ativa().first());
    await expect(passosReativada).toContainText('Registrada');
    await expect(passosReativada).toContainText('Retirada da lista');
    await expect(passosReativada).toContainText('Reativada');
    await expect(passosReativada).toContainText('Teste de provocação positivo SINTETICO');

    // 4) Alteração da ativa: gravidade, reação e uma manifestação a menos; o histórico mostra 'Alterada'.
    const alterar = ativa().first().locator('[data-testid^="alterar-alergia-"]');
    await alterar.locator('summary').click();
    await escolher(alterar.locator('[data-testid^="alterar-gravidade-"]'), { rotulo: 'Grave' });
    await alterar.locator('input[data-testid^="alterar-reacao-"]').fill('Edema de glote SINTETICO');
    const edema = alterar.locator('input[data-testid^="alterar-manifestacao-"][data-testid$="-3"]');
    await expect(edema).toBeChecked();
    await edema.uncheck();
    await alterar.locator('input[data-testid^="alterar-motivo-"]').fill('Reavaliação SINTETICO');
    await alterar.locator('[data-testid^="alterar-gravar-"]').click();
    // Gravada, o painel de alteração fecha (o formulário sai) e a lista é relida.
    await expect(alterar.locator('[data-testid^="alterar-gravar-"]')).toBeHidden();

    // O histórico é lido ao abrir: recarrega a aba para ver a alteração gravada.
    await page.reload();
    await expect(ativa().first()).toBeVisible();
    const passos = await abrirHistorico(ativa().first());
    await expect(passos).toContainText('Registrada');
    await expect(passos).toContainText('Retirada da lista');
    await expect(passos).toContainText('Reativada');
    await expect(passos).toContainText('Alterada');
    await expect(passos).toContainText('Reavaliação SINTETICO');
    const historico = ativa().first().locator('[data-testid^="historico-alergia-"]').first();
    await expect(historico).toContainText('URTICÁRIA SINTETICO');
    await semViolacaoAxe(page, 'alergias: reativada e alterada');
    expect(externas).toEqual([]);
  });
});
