// E2E @M08 (ficha, seção 10): incluir, alterar e inativar um domínio pelo CRUD genérico; definir parâmetro
// novo e ver "explicar valor"; ligar uma chave para um setor (com a senha de novo); axe sem violação séria.
// Sessão real sobre a fonte sintética de dev (SINT.ADMIN, usuário sintético) e o banco de domínios em
// MEMÓRIA (nada vai à cópia); nenhum dado real.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('CRUD genérico, parâmetros e funcionalidades @M08', () => {
  test('domínio: índice, incluir, duplicidade, alterar e inativar; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cadastros/dominios/grupo/hotelaria');
    await expect(page.getByRole('heading', { level: 1, name: 'Cadastros auxiliares' })).toBeVisible();
    await expect(page.getByTestId('dominio-internacao.tipoLimpeza')).toBeVisible();
    await semViolacaoAxe(page, '/cadastros/dominios/grupo/hotelaria');
    await page.getByTestId('dominio-internacao.tipoLimpeza').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Tipos de limpeza' })).toBeVisible();
    await expect(page.getByTestId('tabela-dominio').locator('tbody tr')).toHaveCount(3);
    await semViolacaoAxe(page, '/cadastros/dominios/internacao/tipoLimpeza');
    // Incluir
    await page.getByTestId('botao-incluir').click();
    const form = page.getByTestId('form-dominio');
    await form.getByLabel('Descrição').fill('Limpeza sintética E2E');
    await form.getByLabel('Tempo previsto (HH:MM)').fill('00:45');
    await semViolacaoAxe(page, 'formulário de inclusão');
    await form.getByTestId('botao-salvar').click();
    await expect(page.getByTestId('mensagem-dominio')).toContainText('Incluído com o código');
    await expect(page.getByTestId('tabela-dominio').locator('tbody tr')).toHaveCount(4);
    // Duplicidade (regra 3): mesma descrição sem acento e em minúsculas → recusa em português.
    await page.getByTestId('botao-incluir').click();
    await form.getByLabel('Descrição').fill('limpeza sintetica e2e');
    await form.getByLabel('Tempo previsto (HH:MM)').fill('00:30');
    await form.getByTestId('botao-salvar').click();
    await expect(form.getByText(/Já existe item ativo/)).toBeVisible();
    await form.getByRole('button', { name: 'Cancelar' }).click();
    // Alterar o tempo previsto do item incluído
    const linha = page
      .getByTestId('tabela-dominio')
      .locator('tbody tr', { hasText: 'Limpeza sintética E2E' });
    const codigo = (await linha.locator('td').first().innerText()).trim();
    await page.getByTestId(`alterar-${codigo}`).click();
    await form.getByLabel('Tempo previsto (HH:MM)').fill('01:15');
    await form.getByTestId('botao-salvar').click();
    await expect(page.getByTestId('mensagem-dominio')).toContainText('Alterado');
    await expect(linha).toContainText('01:15');
    // Inativar (com a confirmação do botão destrutivo)
    await page.getByTestId(`inativar-${codigo}`).click();
    // Revisão do W0-02: a inativação pede o motivo (diálogo de gravação).
    await page
      .getByTestId('form-gravacao')
      .getByTestId('dialogo-motivo')
      .fill('Não é mais usado (teste E2E)');
    await page.getByTestId('form-gravacao').getByTestId('dialogo-confirmar').click();
    await expect(page.getByTestId('mensagem-dominio')).toContainText('Inativado');
    await expect(
      page.getByTestId('tabela-dominio').locator('tbody tr', { hasText: 'Limpeza sintética E2E' }),
    ).toHaveCount(0);
    await page.getByTestId('mostrar-inativos').check();
    await expect(
      page.getByTestId('tabela-dominio').locator('tbody tr', { hasText: 'Limpeza sintética E2E' }),
    ).toContainText('Inativo');
    expect(externas).toEqual([]);
  });

  test('parâmetro novo: definir por estabelecimento e explicar valor; axe', async ({ page }) => {
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/parametros');
    await expect(page.getByRole('heading', { level: 1, name: 'Parâmetros por módulo' })).toBeVisible();
    await expect(page.getByTestId('tabela-parametros-legado')).toBeVisible();
    await semViolacaoAxe(page, '/administracao/parametros');
    await page.getByTestId('definir-cadastro.itensPorPagina').click();
    const form = page.getByTestId('form-parametro');
    await form.getByTestId('parametro-valor').fill('40');
    await form.getByLabel('Justificativa').fill('Ajuste sintético do teste E2E');
    await form.getByTestId('parametro-salvar').click();
    await expect(page.getByTestId('mensagem-parametro')).toContainText('Versão nova gravada');
    const explicacao = page.getByTestId('explicacao-cadastro.itensPorPagina');
    await expect(explicacao).toBeVisible();
    await expect(explicacao).toContainText('Estabelecimento');
    await expect(explicacao).toContainText('vale');
    await expect(explicacao).toContainText('Padrão do sistema');
    await expect(page.getByTestId('parametro-cadastro.itensPorPagina')).toContainText('40');
    await semViolacaoAxe(page, '/administracao/parametros (explicar valor)');
  });

  test('funcionalidades: pré-requisito à vista; ligar uma chave para um setor com a senha; axe', async ({
    page,
  }) => {
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Funcionalidades por estabelecimento' }),
    ).toBeVisible();
    await expect(page.getByTestId('recurso-pessoas.esocial')).toContainText(
      'Certificado digital do empregador',
    );
    await semViolacaoAxe(page, '/administracao/liberacao');
    // eSocial sem o certificado: ligar é recusado e a tela diz o que falta.
    await page.getByTestId('abrir-pessoas.esocial').click();
    const form = page.getByTestId('form-liberacao');
    await form.getByLabel('Justificativa').fill('Tentativa sintética do teste E2E');
    await form.getByTestId('liberacao-senha').fill(SENHA);
    await form.getByTestId('liberacao-aplicar').click();
    await expect(form.getByTestId('recusa-liberacao')).toContainText('Certificado digital do empregador');
    // Licitação (sem pré-requisito) para o setor 10.
    await page.getByTestId('abrir-licitacao').click();
    await escolher(form.getByTestId('liberacao-escopo'), 'setor');
    await form.getByTestId('liberacao-valores').fill('10');
    await form.getByLabel('Justificativa').fill('Liberação sintética para um setor');
    await form.getByTestId('liberacao-senha').fill(SENHA);
    await form.getByTestId('liberacao-aplicar').click();
    await expect(page.getByTestId('mensagem-liberacao')).toContainText('1 chave(s) alterada(s)');
    await semViolacaoAxe(page, '/administracao/liberacao (lote aplicado)');
  });
});
