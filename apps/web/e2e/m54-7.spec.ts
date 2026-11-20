// E2E @M54.7 (ficha do M54, etapa F7: orçamento por centro de custo, realizado e desvio): o controller abre
// Financeiro > Orçamento empresarial pelo menu → cria a versão de 2026 a partir do realizado de 2025 com ajuste de 5%
// → a grade centro × natureza × item × 12 meses vem preenchida → altera um mês e grava só o que mudou (com o total do
// ano antes e depois) → não aprova a própria versão (segregação, motivo visível) → outra pessoa (SINT.ORCAMENTO.APROVA)
// aprova e a versão vira a vigente do ano → o comparativo mostra orçado × realizado com o desvio, a avaliação e as
// parcelas dos totais → quem só consulta vê as versões e o comparativo sem criar, gravar nem aprovar. Axe sem violação
// séria em cada estado. Sessão real sobre a fonte sintética de dev; o orçamento em MEMÓRIA (centros, itens e realizado
// SINTÉTICOS; nada vai à cópia); nenhum dado de pessoa.
import { expect, type Page, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';
// Receita particular sem centro (o realizado do item vem sem centro de custo).
const LINHA = '0|receita|100.1.1';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('controladoria, etapa F7: orçamento empresarial, orçado × realizado e desvio @M54.7', () => {
  test.setTimeout(300_000);
  test.use({ actionTimeout: 30_000 });

  test('menu → criar do realizado com ajuste → gravar um mês → segregação → aprovar → comparativo → consulta; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);

    // Quem monta o orçamento chega pela árvore do menu.
    await entrar(page, 'SINT.ORCAMENTO');
    await (await itemDoMenu(page, 'Orçamento empresarial')).click();
    await expect(page).toHaveURL(/\/financeiro\/orcamento/);
    await expect(page.getByRole('heading', { level: 1, name: 'Orçamento empresarial' })).toBeVisible();
    await expect(page.getByTestId('orc-versoes')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('orc-aviso-gravacao')).toHaveCount(0);
    await semViolacaoAxe(page, '/financeiro/orcamento (versões)');

    // Nova versão de 2026 a partir do realizado de 2025, com ajuste de 5%.
    await page.getByTestId('orc-nova').click();
    const form = page.getByTestId('orc-form-nova');
    await expect(form).toBeVisible();
    await form
      .getByTestId('orc-nova-descricao')
      .locator('input, textarea')
      .first()
      .fill('Orçamento 2026 (E2E M54.7)');
    await form.getByLabel('O realizado do ano anterior, com ajuste').check();
    await form.getByTestId('orc-nova-ajuste').fill('5');
    await semViolacaoAxe(page, '/financeiro/orcamento (nova versão)');
    await form.getByTestId('orc-nova-criar').click();

    // A versão nova abre em rascunho com a grade preenchida pelo realizado ajustado.
    await expect(page.getByTestId('orc-versao')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('orc-situacao')).toContainText('Em elaboração');
    await expect(page.getByTestId('orc-grade')).toBeVisible();
    await expect(page.getByTestId(`orc-linha-${LINHA}`)).toBeVisible();
    await expect(page.getByTestId('orc-pendentes')).toContainText('Nenhuma alteração');
    await expect(page.getByTestId('orc-total-natureza-receita')).toContainText('R$');
    const totalAntes = (await page.getByTestId(`orc-total-${LINHA}`).innerText()).trim();
    await semViolacaoAxe(page, '/financeiro/orcamento (grade do rascunho)');

    // Altera janeiro da receita particular e grava só o que mudou.
    await page.getByTestId(`orc-mes-${LINHA}-1`).fill('30.000,00');
    await expect(page.getByTestId(`orc-total-${LINHA}`)).not.toHaveText(totalAntes);
    await expect(page.getByTestId('orc-pendentes')).toContainText('1 linha(s) alterada(s)');
    await page.getByTestId('orc-gravar').click();
    await expect(page.getByTestId('orc-mensagem')).toContainText(
      '0 incluída(s), 1 alterada(s), 0 removida(s)',
      {
        timeout: 30_000,
      },
    );
    await expect(page.getByTestId('orc-mensagem')).toContainText('Total do ano de R$');
    await expect(page.getByTestId(`orc-mes-${LINHA}-1`)).toHaveValue('30.000,00');

    // Segregação: quem montou não aprova; o motivo aparece.
    await expect(page.getByTestId('orc-aprovar')).toBeDisabled();
    await expect(page.getByTestId('orc-motivo-sem-aprovar')).toBeVisible();
    await semViolacaoAxe(page, '/financeiro/orcamento (rascunho gravado)');

    // Outra pessoa aprova: a versão vira a vigente do ano.
    await entrar(page, 'SINT.ORCAMENTO.APROVA');
    await page.goto('/financeiro/orcamento');
    await expect(page.getByTestId('orc-lista')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('orc-abrir-1').click();
    await expect(page.getByTestId('orc-versao')).toBeVisible();
    await expect(page.getByTestId('orc-aprovar')).toBeEnabled();
    await page.getByTestId('orc-aprovar').click();
    const aprovar = page.getByTestId('orc-form-aprovar');
    await expect(aprovar).toBeVisible();
    await aprovar
      .getByTestId('orc-aprovar-observacao')
      .locator('input, textarea')
      .first()
      .fill('Aprovado na reunião de orçamento (E2E M54.7)');
    await semViolacaoAxe(page, '/financeiro/orcamento (aprovação)');
    await aprovar.getByTestId('orc-aprovar-confirmar').click();
    await expect(page.getByTestId('orc-mensagem')).toContainText('Versão aprovada', { timeout: 30_000 });
    await expect(page.getByTestId('orc-situacao')).toContainText('Aprovado (vigente)');
    await expect(page.getByTestId('orc-aprovado-por')).toContainText('SINT.ORCAMENTO.APROVA');
    await expect(page.getByTestId('orc-fechada')).toBeVisible();

    // Comparativo: orçado × realizado com o desvio, a avaliação e as parcelas.
    await page.getByTestId('orc-aba-comparativo').click();
    await expect(page.getByTestId('orc-comparativo')).toBeVisible({ timeout: 30_000 });
    const receita = page.getByTestId('orc-comp-total-receita');
    await expect(receita).toContainText('orçado R$');
    await expect(receita).toContainText('realizado R$');
    await expect(receita).toContainText('desvio R$');
    await expect(receita).toContainText(/favorável|desfavorável/i);
    await expect(page.getByTestId('orc-comp-total-despesa')).toContainText('desvio R$');
    await receita.locator('summary').first().click();
    await expect(page.getByTestId('orc-comp-conta-orcado-receita')).toContainText('=');
    await expect(page.getByTestId('orc-comp-tabela')).toBeVisible();
    await semViolacaoAxe(page, '/financeiro/orcamento (comparativo)');

    // Quem só consulta: vê as versões e o comparativo, sem criar, gravar nem aprovar.
    await entrar(page, 'SINT.ORCAMENTO.CONSULTA');
    await page.goto('/financeiro/orcamento');
    await expect(page.getByTestId('orc-aviso-gravacao')).toContainText('Seu perfil consulta', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('orc-nova')).toHaveCount(0);
    await page.getByTestId('orc-abrir-1').click();
    await expect(page.getByTestId('orc-versao')).toBeVisible();
    await expect(page.getByTestId('orc-gravar')).toHaveCount(0);
    await expect(page.locator('[data-testid^="orc-mes-"]')).toHaveCount(0);
    await expect(page.getByTestId('orc-aprovar')).toHaveCount(0);
    await page.getByTestId('orc-aba-comparativo').click();
    await expect(page.getByTestId('orc-comp-total-receita')).toContainText('desvio R$', { timeout: 30_000 });
    await semViolacaoAxe(page, '/financeiro/orcamento (somente consulta)');

    expect(externas).toEqual([]);
  });
});
