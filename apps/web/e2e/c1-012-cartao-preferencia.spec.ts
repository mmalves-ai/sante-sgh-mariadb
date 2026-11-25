// C1-012 (F8, 04-CC linha 105): a tela do cartão de preferência do cirurgião. A validação roda na hora pela mesma regra
// do domínio que a API aplica: o botão de salvar só libera com o cirurgião, algum conteúdo, tempo e luva válidos e
// cada item com o cadastro certo ou a descrição; os combos são do padrão da casa (sem select nativo). Axe no fim.
// O E2E roda sem banco próprio (fonte sintética): o que fica no banco (itens sem apagar, versão, cartão aplicável com
// a sugestão do mapa e do gasto de sala) é provado pelo contrato de efeito cartao-preferencia-propria.int.spec.ts.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, esperarSemSelectNativo } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('centro cirúrgico: cartão de preferência do cirurgião @C1-012', () => {
  test.setTimeout(180_000);

  test('validação na hora (cirurgião, conteúdo, tempo, luva, item por natureza e repetido); axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cirurgia/cartoes-preferencia');
    const tela = page.getByTestId('tela-cartoes-preferencia');
    await expect(tela).toBeVisible();
    await esperarSemSelectNativo(tela);

    const salvar = page.getByTestId('cartao-salvar');
    const problemas = page.getByTestId('cartao-problemas');
    await expect(problemas).toContainText('cirurgião');
    await expect(problemas).toContainText('cartão vazio');
    await expect(salvar).toBeDisabled();

    await page.getByTestId('cartao-cirurgiao').fill('7');
    await page.getByTestId('cartao-tempo').fill('3');
    await expect(problemas).toContainText('5 a 1440');
    await page.getByTestId('cartao-tempo').fill('90');
    await page.getByTestId('cartao-luva').fill('12');
    await expect(problemas).toContainText('luva');
    await page.getByTestId('cartao-luva').fill('7,5');
    await expect(problemas).toHaveCount(0);
    await expect(salvar).toBeEnabled();

    // Item sem cadastro nem descrição: recusado; com a descrição, libera.
    await page.getByTestId('cartao-novo-item').click();
    await escolher(page.getByTestId('cartao-item-0-natureza'), 'equipamento');
    await expect(problemas).toContainText('Item 1');
    await expect(salvar).toBeDisabled();
    await page.getByTestId('cartao-item-0-descricao').fill('Bisturi elétrico');
    await expect(problemas).toHaveCount(0);

    // Item repetido (mesma descrição e natureza): recusado; tirar o segundo libera.
    await page.getByTestId('cartao-novo-item').click();
    await escolher(page.getByTestId('cartao-item-1-natureza'), 'equipamento');
    await page.getByTestId('cartao-item-1-descricao').fill('bisturi elétrico');
    await expect(problemas).toContainText('repetido');
    await page.getByTestId('cartao-item-1-tirar').click();
    await expect(problemas).toHaveCount(0);
    await expect(salvar).toBeEnabled();

    // "Outro" não aceita código de cadastro: o campo fica desabilitado.
    await escolher(page.getByTestId('cartao-item-0-natureza'), 'outro');
    await expect(page.getByTestId('cartao-item-0-codigo')).toBeDisabled();

    await expect(page.getByTestId('consulta-botao')).toBeDisabled();
    await page.getByTestId('consulta-cirurgiao').fill('7');
    await expect(page.getByTestId('consulta-botao')).toBeEnabled();
    await semViolacaoAxe(page, '/cirurgia/cartoes-preferencia (cartão em edição)');
    expect(externas).toEqual([]);
  });
});
