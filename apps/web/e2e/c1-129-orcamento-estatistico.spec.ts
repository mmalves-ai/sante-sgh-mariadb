// E2E @C1-129 (ficha 07-FIN linha 131: orçamento estatístico e indicadores orçamentários por setor): quem monta o
// orçamento abre Financeiro > Orçamento empresarial → cria a versão vazia do ano → aba Estatísticas e indicadores: o
// indicador com projeção e sem dado estatístico é apontado na hora → cadastra o indicador → inclui a linha (indicador ×
// setor) com a projeção do realizado → um clique copia a projeção, a quantidade inválida é apontada na hora → grava a
// linha → o painel mostra o orçado × realizado com a situação e a conta com as parcelas → esvazia um mês e grava (a
// célula é retirada, o total cai). Axe sem violação séria em cada estado. Sessão real sobre a fonte sintética de dev; o
// orçamento em MEMÓRIA (nada vai à cópia); nenhum dado de pessoa. O efeito no banco está em
// apps/api/src/modulos/orcamento/estatisticas-orcamento.int.spec.ts.
import { expect, type Page, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';
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

const campo = (page: Page, id: string) => page.getByTestId(id).locator('input, textarea').first();

test.describe('orçamento estatístico e indicadores por setor @C1-129', () => {
  test.setTimeout(300_000);
  test.use({ actionTimeout: 30_000 });

  test('indicador validado na hora → linha com a projeção → gravada → painel com as parcelas → mês retirado; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ORCAMENTO');
    await (await itemDoMenu(page, 'Orçamento empresarial')).click();
    await expect(page).toHaveURL(/\/financeiro\/orcamento/);

    // Versão vazia do ano (em elaboração).
    await page.getByTestId('orc-nova').click();
    await campo(page, 'orc-nova-descricao').fill('Orçamento estatístico (E2E C1-129)');
    await page.getByTestId('orc-form-nova').getByTestId('orc-nova-criar').click();
    await expect(page.getByTestId('orc-versao')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('orc-voltar').click();

    // Aba das estatísticas: a versão em elaboração já vem escolhida; painel e grade vazios.
    await page.getByTestId('orc-aba-estatisticas').click();
    await expect(page.getByTestId('orc-estatisticas')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('orc-est-grade-vazia')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('orc-est-painel-vazio')).toBeVisible();
    await expect(page.getByTestId('orc-est-cad-DIARIAS')).toBeVisible();

    // Cadastro do indicador: a projeção sem dado estatístico é apontada na hora pela regra do domínio.
    const form = page.getByTestId('orc-est-form');
    await campo(page, 'orc-est-codigo').fill('cirurgias-e2e');
    await campo(page, 'orc-est-descricao').fill('Cirurgias do E2E');
    await form.getByTestId('orc-est-gravar-indicador').click();
    await expect(page.getByTestId('orc-est-dado-erro')).toContainText('ligue o indicador');
    await escolher(form.getByTestId('orc-est-dado'), { rotulo: /Pacientes-dia/ });
    await expect(page.getByTestId('orc-est-dado-erro')).toHaveCount(0);
    await semViolacaoAxe(page, '/financeiro/orcamento (indicador novo)');
    await form.getByTestId('orc-est-gravar-indicador').click();
    await expect(page.getByTestId('orc-est-mensagem')).toContainText('Indicador cadastrado', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('orc-est-cad-CIRURGIAS-E2E')).toBeVisible();

    // Nova linha: diárias na UTI, com a projeção do realizado (média dos últimos meses).
    const nova = page.getByTestId('orc-est-nova');
    await escolher(nova.getByTestId('orc-est-nova-indicador'), { rotulo: /DIARIAS/ });
    await escolher(nova.getByTestId('orc-est-nova-setor'), { rotulo: /UTI ADULTO SINTETICA/ });
    await nova.getByTestId('orc-est-nova-incluir').click();
    const linha = page.getByTestId('orc-est-linha-1-101');
    await expect(linha).toBeVisible({ timeout: 30_000 });
    await linha.getByTestId('orc-est-projetar-1-101').click();
    await expect(page.getByTestId('orc-est-total-1-101')).toHaveText('1.212');

    // Quantidade inválida apontada na hora; o botão de gravar fica bloqueado até corrigir.
    const ano = await page.getByTestId('orc-est-ano').getAttribute('data-valor');
    const jan = page.getByTestId(`orc-est-cel-1-101-${ano}-01`);
    await jan.fill('1,234');
    await expect(jan).toHaveAttribute('aria-invalid', 'true');
    await expect(linha.getByTestId('orc-est-gravar-1-101')).toBeDisabled();
    await jan.fill('120');
    await expect(jan).toHaveAttribute('aria-invalid', 'false');
    await expect(page.getByTestId('orc-est-total-1-101')).toHaveText('1.231');
    await semViolacaoAxe(page, '/financeiro/orcamento (grade estatística)');
    await linha.getByTestId('orc-est-gravar-1-101').click();
    await expect(page.getByTestId('orc-est-mensagem')).toContainText('12 incluída(s)', { timeout: 30_000 });

    // Painel: orçado × realizado do indicador com a conta e as parcelas por setor.
    await expect(page.getByTestId('orc-est-ind-DIARIAS')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('orc-est-conta-DIARIAS')).toContainText('UTI ADULTO SINTETICA');
    await expect(page.getByTestId('orc-est-sit-DIARIAS')).not.toBeEmpty();

    // Mês esvaziado: a célula é retirada (lógica) e o total cai.
    await page.getByTestId(`orc-est-cel-1-101-${ano}-12`).fill('');
    await page.getByTestId('orc-est-linha-1-101').getByTestId('orc-est-gravar-1-101').click();
    await expect(page.getByTestId('orc-est-mensagem')).toContainText('1 retirada(s)', { timeout: 30_000 });
    await expect(page.getByTestId('orc-est-total-1-101')).toHaveText('1.130');
    await semViolacaoAxe(page, '/financeiro/orcamento (painel dos indicadores)');
    expect(externas).toEqual([]);
  });
});
