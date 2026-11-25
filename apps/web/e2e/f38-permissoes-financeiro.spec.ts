// F3.8-08 (07-FIN linha 99): permissões do financeiro numa tela só. Escopo de contas por usuário: a regra aparece na hora
// (quem movimenta consulta; a vigência não se inverte) e prende o botão; a primeira conta gravada restringe o usuário;
// ninguém altera o próprio escopo (o servidor recusa). Tipos por perfil e operação: o título a pagar lista tipos de
// credor e o movimento bancário, tipos de lançamento; cada operação tem a sua lista; marcar o primeiro tipo restringe o
// perfil, retirar o último deixa o perfil restrito sem nada, e desfazer a restrição é um passo explícito. Axe no fim.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PAGADOR = '9102';
const EU = '9101';
const CONTA = '9201';
const PERFIL = '9302';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** Deixa o perfil livre e sem tipo marcado na operação aberta (a memória da sessão sintética guarda entre execuções). */
async function limparOperacao(page: Page, codigos: readonly string[]): Promise<void> {
  for (const c of codigos) {
    const caixa = page.getByTestId(`pfin-tipo-${c}`);
    await expect(caixa).toBeVisible();
    if (await caixa.isChecked()) {
      await caixa.click();
      await expect(caixa).not.toBeChecked();
    }
  }
  if ((await page.getByTestId('pfin-tipos-aviso').textContent())?.includes('Perfil restrito')) {
    await page.getByTestId('pfin-restricao').click();
    await expect(page.getByTestId('pfin-tipos-aviso')).toContainText('Perfil livre');
  }
}

test.describe('financeiro: permissões por conta e por tipo @F3.8-08', () => {
  test.setTimeout(180_000);

  test('escopo de contas com a regra na hora; tipo por perfil em cada operação; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.FIN.LANCA');
    await page.goto('/financeiro/parametros/permissoes');
    await expect(page.getByTestId('tela-fin-permissoes')).toBeVisible();

    // Escopo de contas de outro usuário: a regra aparece na linha e prende o botão.
    await escolher(page.getByTestId('pfin-usuario'), PAGADOR);
    const linha = page.getByTestId(`pfin-conta-${CONTA}`);
    await expect(linha).toBeVisible();
    const consulta = linha.getByRole('checkbox', { name: 'Consulta' });
    const movimenta = linha.getByRole('checkbox', { name: 'Movimenta' });
    const gravar = page.getByTestId(`pfin-gravar-${CONTA}`);
    await movimenta.setChecked(true);
    await consulta.setChecked(false);
    await expect(linha.getByRole('alert')).toContainText('Quem movimenta precisa consultar');
    await expect(gravar).toBeDisabled();
    await consulta.setChecked(true);
    await movimenta.setChecked(false);
    await linha.getByLabel('Desde').fill('2026-12-10');
    await linha.getByLabel('Até').fill('2026-12-01');
    await expect(linha.getByRole('alert')).toContainText('O fim vem antes do início');
    await expect(gravar).toBeDisabled();
    await linha.getByLabel('Até').fill('2026-12-31');
    await expect(gravar).toBeEnabled();
    await gravar.click();
    await expect(page.getByText('Escopo de contas do usuário gravado.')).toBeVisible();
    await expect(page.getByTestId('pfin-escopo-aviso')).toContainText('só as contas marcadas');
    await expect(consulta).toBeChecked();
    await expect(movimenta).not.toBeChecked();

    // O próprio escopo: o servidor recusa (segregação), e nada muda.
    await escolher(page.getByTestId('pfin-usuario'), EU);
    await expect(page.getByTestId('pfin-escopo-aviso')).toContainText('ainda vê todas as contas');
    const recusa = page.waitForResponse(
      (r) => r.url().includes('/financeiro/gestao/escopo-contas') && r.request().method() === 'POST',
    );
    await page.getByTestId(`pfin-gravar-${CONTA}`).click();
    expect((await recusa).status()).toBe(409);
    await expect(page.getByTestId('pfin-escopo-aviso')).toContainText('ainda vê todas as contas');

    // Tipos por perfil: no título a pagar a lista é de tipos de credor.
    await escolher(page.getByTestId('pfin-perfil'), PERFIL);
    await escolher(page.getByTestId('pfin-operacao'), 'contas_pagar');
    const tipos = page.getByTestId('pfin-tipos');
    await expect(tipos.getByRole('columnheader', { name: 'Tipo de credor' })).toBeVisible();
    await limparOperacao(page, ['fornecedor', 'medico', 'tributos']);
    const aviso = page.getByTestId('pfin-tipos-aviso');
    await expect(aviso).toContainText('Perfil livre');
    const fornecedor = page.getByTestId('pfin-tipo-fornecedor');
    await fornecedor.click();
    await expect(fornecedor).toBeChecked();
    await expect(aviso).toContainText('Perfil restrito');
    await expect(page.getByTestId('pfin-tipo-medico')).not.toBeChecked();

    // A lista de uma operação não vale na outra: no movimento bancário o perfil segue livre, com tipos de lançamento.
    await escolher(page.getByTestId('pfin-operacao'), 'banco');
    await expect(tipos.getByRole('columnheader', { name: 'Tipo de lançamento' })).toBeVisible();
    await expect(page.getByTestId('pfin-tipo-transferencia')).toBeVisible();
    await limparOperacao(page, ['credito_avulso', 'tarifa', 'transferencia']);
    await expect(aviso).toContainText('Perfil livre');

    // Retirar o último tipo não devolve tudo: o perfil fica restrito sem nada; desfazer é um passo explícito.
    await escolher(page.getByTestId('pfin-operacao'), 'contas_pagar');
    await expect(fornecedor).toBeChecked();
    await fornecedor.click();
    await expect(fornecedor).not.toBeChecked();
    await expect(aviso).toContainText('Perfil restrito');
    await semViolacaoAxe(page, '/financeiro/parametros/permissoes (perfil restrito sem tipo)');
    await page.getByTestId('pfin-restricao').click();
    await expect(aviso).toContainText('Perfil livre');
    expect(externas).toEqual([]);
  });
});
