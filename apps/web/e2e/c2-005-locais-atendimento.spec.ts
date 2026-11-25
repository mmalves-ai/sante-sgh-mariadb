// E2E @C2-005 (02-REC linha 33): o hospital cadastra pela tela os locais de atendimento de cada recepção e os
// encaminhamentos entre eles. Na tela de recepções, inclui um local (o código chega sugerido pelo nome), liga o
// encaminhamento, marca os destinos numa lista só e vê a lista no cartão do local; a regra confere na hora (o
// código repetido fecha o botão de gravar); desativar pede o motivo e o local continua na lista, marcado; reativar
// devolve. axe sem violação séria. Sessão real sobre a fonte sintética de dev e a porta dos locais em MEMÓRIA.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Locais de atendimento e encaminhamentos @C2-005 @fase3', () => {
  test.setTimeout(120_000);

  test('incluir local, conferir na hora, escolher destinos, desativar e reativar', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.SENHAS');
    await page.goto('/recepcao/recepcoes');
    const bloco = page.getByTestId('locais-atendimento');
    await expect(bloco).toBeVisible();
    await semViolacaoAxe(page, '/recepcao/recepcoes (locais)');

    // Um local que já existe (o código dele serve para a recusa e como destino).
    const outro = await bloco.locator('li[data-testid^="local-"]').first().getAttribute('data-testid');
    const codigoUsado = (outro ?? '').replace(/^local-/, '');
    expect(codigoUsado).not.toBe('');

    // Local novo na primeira recepção: o código acompanha o nome.
    const cartao = bloco.locator('article').first();
    await cartao.getByRole('button', { name: /Novo local em/ }).click();
    const dialogo = page.getByRole('dialog', { name: /Novo local em/ });
    await dialogo.getByLabel('Nome do local').fill('Sala de triagem');
    await expect(dialogo.getByLabel('Código')).toHaveValue('SALA-DE-TRIAGEM');
    await page.getByTestId('local-permite').check();
    await semViolacaoAxe(page, '/recepcao/recepcoes (diálogo do local)');

    // A regra confere na hora: um código já usado fecha o botão de gravar.
    await dialogo.getByLabel('Código').fill(codigoUsado);
    await expect(page.getByTestId('recusa-local')).toContainText('Já existe um local');
    await expect(page.getByTestId('gravar-local')).toBeDisabled();
    await dialogo.getByLabel('Código').fill('SALA-DE-TRIAGEM');
    await expect(page.getByTestId('gravar-local')).toBeEnabled();
    await page.getByTestId('gravar-local').click();
    await expect(page.getByTestId('mensagem-locais')).toContainText('Local de atendimento cadastrado');
    await expect(page.getByTestId('destinos-SALA-DE-TRIAGEM')).toContainText('não encaminha');

    // Destinos: marca o local já existente numa lista só e grava.
    await page.getByTestId('destinos-local-SALA-DE-TRIAGEM').click();
    const destinos = page.getByRole('dialog', { name: /Para onde Sala de triagem encaminha/ });
    await expect(destinos.getByTestId('destino-SALA-DE-TRIAGEM')).toHaveCount(0);
    await destinos.getByTestId(`destino-${codigoUsado}`).check();
    await page.getByTestId('gravar-destinos').click();
    await expect(page.getByTestId('mensagem-locais')).toContainText('Encaminhamentos gravados');
    await expect(page.getByTestId('destinos-SALA-DE-TRIAGEM')).toContainText('encaminha para');

    // Com destinos na lista, desligar o encaminhamento é recusado na hora.
    await page.getByTestId('alterar-local-SALA-DE-TRIAGEM').click();
    await page.getByTestId('local-permite').uncheck();
    await expect(page.getByTestId('recusa-local')).toContainText('não encaminha');
    await expect(page.getByTestId('gravar-local')).toBeDisabled();
    await page.getByRole('button', { name: 'Cancelar' }).click();

    // Desativar pede o motivo; o local continua na lista, marcado; reativar devolve.
    await page.getByTestId('desativar-local-SALA-DE-TRIAGEM').click();
    await expect(page.getByTestId('confirmar-desativar-local')).toBeDisabled();
    await page
      .getByRole('dialog')
      .getByLabel(/Motivo/)
      .fill('Sala em reforma');
    await page.getByTestId('confirmar-desativar-local').click();
    await expect(page.getByTestId('local-SALA-DE-TRIAGEM')).toContainText('desativado');
    await page.getByTestId('reativar-local-SALA-DE-TRIAGEM').click();
    await expect(page.getByTestId('local-SALA-DE-TRIAGEM')).not.toContainText('desativado');

    expect(externas).toEqual([]);
  });
});
