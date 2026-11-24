// F3.4-3 (04-INT linha 82 e 04-CC linha 91): as telas da regra de cobrança dos gases e do cadastro do texto padrão da
// descrição cirúrgica. A validação roda na hora pela mesma regra do domínio que a API aplica: o botão de salvar só
// libera quando a regra (ou o texto) está correta. A tela dos gases leva à da regra por um atalho. Axe em cada passo.
// O E2E roda sem banco próprio (fonte sintética): o que fica no banco é provado pelos contratos de efeito
// (gas-medicinal-propria.int.spec.ts e texto-padrao-propria.int.spec.ts).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('internação e centro cirúrgico: regra do gás e texto padrão @F34-3', () => {
  test.setTimeout(180_000);

  test('regra de cobrança do gás: validação na hora (fração, simultâneo) e atalho da tela dos gases; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/internacao/atendimentos/1/gases');
    await expect(page.getByTestId('tela-gases')).toBeVisible();
    await page.getByTestId('gases-ir-regras').click();
    await expect(page).toHaveURL(/\/internacao\/gases\/regras/);
    await expect(page.getByTestId('tela-regras-gas')).toBeVisible();

    const salvar = page.getByTestId('regra-salvar');
    const problemas = page.getByTestId('regra-problemas');
    await expect(problemas).toContainText('Informe o gás');
    await expect(salvar).toBeDisabled();

    await page.getByTestId('regra-gas').fill('101');
    await expect(problemas).toHaveCount(0);
    await expect(salvar).toBeEnabled();

    // Fração de hora sem a fração mínima: recusada na hora; com 15 minutos, libera.
    await escolher(page.getByTestId('regra-unidade'), 'fracao_hora');
    await expect(problemas).toContainText('fração');
    await expect(salvar).toBeDisabled();
    await page.getByTestId('regra-fracao').fill('15');
    await expect(problemas).toHaveCount(0);

    // Simultâneo sem o outro gás: recusado; com o outro gás, libera.
    await page.getByTestId('regra-novo-simultaneo').click();
    await expect(problemas).toContainText('gás de cada uso simultâneo');
    await page.getByTestId('regra-simultaneo-0').locator('input[type="number"]').first().fill('102');
    await expect(problemas).toHaveCount(0);

    // Faixa nova começa onde a anterior terminou.
    await page.getByTestId('regra-nova-faixa').click();
    await expect(page.getByTestId('regra-faixa-0')).toBeVisible();
    await semViolacaoAxe(page, '/internacao/gases/regras (regra preenchida)');
    expect(externas).toEqual([]);
  });

  test('texto padrão: campos detectados na hora, marcação quebrada recusada, título mínimo; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cirurgia/textos-padrao');
    await expect(page.getByTestId('tela-textos-padrao')).toBeVisible();

    const salvar = page.getByTestId('texto-salvar');
    const problemas = page.getByTestId('texto-problemas');
    await page.getByTestId('texto-titulo').fill('ab');
    await expect(problemas).toContainText('título');
    await expect(salvar).toBeDisabled();

    await page.getByTestId('texto-titulo').fill('Colecistectomia por vídeo');
    await page
      .getByTestId('texto-descricao')
      .fill('Acesso {{acesso}} com {{ trocateres }} trocateres. Lado {{acesso}}.');
    await expect(page.getByTestId('texto-campos')).toContainText('acesso, trocateres');
    await expect(problemas).toHaveCount(0);
    await expect(salvar).toBeEnabled();

    await page.getByTestId('texto-risco').fill('Risco {{Classe');
    await expect(problemas).toContainText('mal escrito');
    await expect(salvar).toBeDisabled();
    await semViolacaoAxe(page, '/cirurgia/textos-padrao (texto em edição)');
    expect(externas).toEqual([]);
  });
});
