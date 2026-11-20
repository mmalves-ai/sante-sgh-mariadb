// E2E @W0-02 (motor do CRUD genérico): na DominioTela, a reativação pela situação do cadastro pede o motivo (diálogo de
// gravação) e grava; a inativação segue com a confirmação; a coluna de referência do formulário é o SanteSelecao (com a
// busca embutida). Sessão real sobre a fonte sintética de dev (SINT.ADMIN) e o banco de domínios em MEMÓRIA (nada vai
// à cópia); nenhum dado real. Rodada 2: a exclusão física nos pilotos do catálogo (características de dieta): o item com
// dependentes (as ligações com a dieta, em memória) é recusado com a lista e "Inativar em vez disso"; o nunca usado é
// excluído com motivo e senha; o texto longo (respostas possíveis) se edita na alteração. Revisão do W0-02: a senha
// errada é recusada no diálogo da exclusão; a inativação pede o motivo; o texto longo entra também na inclusão.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { abrirCombo } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('motor do CRUD genérico: reativar com motivo e combos de referência @W0-02', () => {
  test('excluir: recusa com os dependentes e "Inativar em vez disso"; o nunca usado sai com motivo e senha; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cadastros/dominios/pep/caracteristicaDieta');
    await expect(page.getByRole('heading', { level: 1, name: 'Características de dieta' })).toBeVisible();
    // O item 1 é usado pelas ligações com a dieta (a referência obrigatória das linhas em memória).
    await page.getByTestId('excluir-1').click();
    const dialogo = page.getByTestId('form-gravacao');
    await expect(dialogo).toBeVisible();
    await expect(dialogo.getByTestId('dialogo-confirmar')).toBeDisabled();
    await dialogo.getByTestId('dialogo-motivo').fill('Cadastrado em duplicidade (teste E2E)');
    await dialogo.getByTestId('dialogo-senha').fill(SENHA);
    await semViolacaoAxe(page, 'diálogo da exclusão');
    await dialogo.getByTestId('dialogo-confirmar').click();
    const recusa = page.getByTestId('dominio-dependentes');
    await expect(recusa).toBeVisible();
    await expect(recusa.getByTestId('dependente-0')).toContainText('Características das dietas');
    await semViolacaoAxe(page, 'recusa da exclusão com os dependentes');
    await recusa.getByTestId('inativar-em-vez').click();
    // Segue o fluxo de inativar, com o motivo (revisão do W0-02; no banco em memória a conferência de uso não acha
    // uso: inativa direto).
    await dialogo.getByTestId('dialogo-motivo').fill('Inativado no lugar da exclusão (teste E2E)');
    await dialogo.getByTestId('dialogo-confirmar').click();
    await expect(page.getByTestId('mensagem-dominio')).toContainText('Inativado');
    await expect(page.getByTestId('item-1')).toHaveCount(0);
    // O item 3 não tem dependentes. Revisão do W0-02: a senha errada é recusada dentro do diálogo (a sessão é real:
    // a reautenticação confere a senha também sobre o banco de domínios em memória) e nada é apagado.
    await page.getByTestId('excluir-3').click();
    await dialogo.getByTestId('dialogo-motivo').fill('Incluído por engano (teste E2E)');
    await dialogo.getByTestId('dialogo-senha').fill('senha-errada');
    await dialogo.getByTestId('dialogo-confirmar').click();
    await expect(dialogo.getByTestId('dialogo-senha-erro')).toContainText('A senha não confere');
    await expect(page.getByTestId('item-3')).toHaveCount(1);
    // Com a senha certa, sai.
    await dialogo.getByTestId('dialogo-senha').fill(SENHA);
    await dialogo.getByTestId('dialogo-confirmar').click();
    await expect(page.getByTestId('mensagem-dominio')).toContainText('Item 3 excluído.');
    await expect(page.getByTestId('item-3')).toHaveCount(0);
    expect(externas).toEqual([]);
  });

  test('o texto longo (respostas possíveis) se edita na alteração', async ({ page }) => {
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cadastros/dominios/pep/caracteristicaDieta');
    await page.getByTestId('alterar-2').click();
    const form = page.getByTestId('form-dominio');
    const texto = form.getByTestId('texto-longo-possiveisRespostas');
    await expect(texto).toBeVisible();
    await texto.fill('Sim\nNão\nÀs vezes — conforme a aceitação');
    await form.getByTestId('botao-salvar').click();
    await expect(page.getByTestId('mensagem-dominio')).toBeVisible();
    await page.getByTestId('textos-2').click();
    await expect(page.getByTestId('texto-possiveisRespostas')).toHaveValue(/Às vezes/);
  });

  test('o texto longo também na inclusão', async ({ page }) => {
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cadastros/dominios/pep/caracteristicaDieta');
    await page.getByTestId('botao-incluir').click();
    const form = page.getByTestId('form-dominio');
    await form.getByLabel('Descrição').fill('TEXTURA E2E');
    await form.getByTestId('campo-tipoResposta').fill('1');
    await form.getByTestId('texto-longo-possiveisRespostas').fill('Líquida\nPastosa');
    await form.getByTestId('botao-salvar').click();
    await expect(page.getByTestId('mensagem-dominio')).toContainText('Incluído com o código');
    const linha = page.getByTestId('tabela-dominio').locator('tbody tr', { hasText: 'TEXTURA E2E' });
    const codigo = (await linha.locator('td').first().innerText()).trim();
    await page.getByTestId(`textos-${codigo}`).click();
    await expect(page.getByTestId('texto-possiveisRespostas')).toHaveValue(/Pastosa/);
  });

  test('inativar e reativar (motivo obrigatório) pela situação do cadastro; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cadastros/dominios/internacao/tipoLimpeza');
    await expect(page.getByRole('heading', { level: 1, name: 'Tipos de limpeza' })).toBeVisible();
    await page.getByTestId('inativar-2').click();
    // Revisão do W0-02: a inativação pede o motivo (diálogo de gravação).
    await page
      .getByTestId('form-gravacao')
      .getByTestId('dialogo-motivo')
      .fill('Não é mais usado (teste E2E)');
    await page.getByTestId('form-gravacao').getByTestId('dialogo-confirmar').click();
    await expect(page.getByTestId('mensagem-dominio')).toContainText('Inativado');
    await page.getByTestId('mostrar-inativos').check();
    await page.getByTestId('reativar-2').click();
    const dialogo = page.getByTestId('form-gravacao');
    await expect(dialogo).toBeVisible();
    // Sem motivo (ou curto demais), não confirma.
    await expect(dialogo.getByTestId('dialogo-confirmar')).toBeDisabled();
    await dialogo.getByTestId('dialogo-motivo').fill('Voltou a ser usado no setor (teste E2E)');
    await semViolacaoAxe(page, 'diálogo da reativação');
    await dialogo.getByTestId('dialogo-confirmar').click();
    await expect(page.getByTestId('mensagem-dominio')).toContainText('Item reativado.');
    await expect(page.getByTestId('item-2')).toContainText('Ativo');
    expect(externas).toEqual([]);
  });

  test('a referência do formulário é o SanteSelecao com busca (sem select cru)', async ({ page }) => {
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cadastros/dominios/hotelaria/area');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.getByTestId('botao-incluir').click();
    const form = page.getByTestId('form-dominio');
    const campo = form.getByTestId('campo-criticidade');
    await expect(campo).toBeVisible();
    const lista = await abrirCombo(campo);
    await expect(lista.getByRole('option').first()).toBeVisible();
    expect(
      await page.evaluate(() => document.querySelectorAll('[data-testid="form-dominio"] select').length),
    ).toBe(0);
  });
});
