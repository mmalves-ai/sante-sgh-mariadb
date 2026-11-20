// E2E @M45.1 (ficha do M45, seções 7, 10 e 11; etapa 1): o administrador do PEP chega ao construtor pelo atalho da
// administração de modelos, cria um formulário novo a partir da escala de exemplo (título em CP1252), confere a prévia
// com o total sempre calculado, o registro-resumo e os casos de teste verdes, vê a regra guiada da soma, salva e envia
// à revisão; a aprovação pelo próprio autor é recusada (quatro olhos); a comissão de prontuário aprova com o parecer e
// publica com a senha e o hash mostrado (só no Sante SGH: a criação no prontuário está desligada, com o motivo); a versão
// publicada confere com o hash; o administrador aposenta com o motivo. axe sem violação séria na lista, no editor e no
// diálogo de publicação (acessibilidade do construtor). Sessão real sobre a fonte sintética e as portas em MEMÓRIA
// (dados SINTÉTICOS; nada vai à cópia).
import { type Browser, expect, type Page, test } from '@playwright/test';
import { ORIGEM, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const TITULO = 'Avaliação de risco — pressão e mobilidade (ação nº 1)';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function novaAba(browser: Browser, login: string): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: ORIGEM, timezoneId: 'America/Sao_Paulo' });
  const p = await ctx.newPage();
  await entrar(p, login);
  return p;
}

const editor = (p: Page) => p.getByTestId('fn-editor');

test.describe('Construtor de formulários novos @M45 @M45.1 @fase5', () => {
  test.setTimeout(300_000);

  test('criar → prévia e casos → revisão → quatro olhos → aprovar → publicar com hash → aposentar; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    const codigo = `E2E${String(Date.now() % 100_000).padStart(5, '0')}`;
    await entrar(page, 'SINT.ADMIN.PEP');
    await page.goto('/pep/admin/modelos');
    await page.getByTestId('atalho-formularios-novos').click();
    await expect(page).toHaveURL(/\/pep\/admin\/formularios-novos$/);
    await expect(page.getByTestId('tela-formularios-novos')).toBeVisible();
    // A criação no prontuário está desligada (POL-3): o motivo aparece; o construtor está ligado.
    await expect(page.getByTestId('fn-ponte')).toContainText('Criação no prontuário');
    await expect(page.getByTestId('fn-consulta')).toHaveCount(0);
    await semViolacaoAxe(page, '/pep/admin/formularios-novos (lista)');

    // Novo formulário a partir da escala de exemplo.
    await page.getByTestId('fn-novo').click();
    await expect(editor(page)).toBeVisible();
    await editor(page).getByRole('textbox', { name: 'Código do formulário' }).fill(codigo);
    await editor(page).getByRole('textbox', { name: 'Título', exact: true }).fill(TITULO);
    // Prévia: o total é sempre calculado (Acamado 1 + Fricção 2 = 3) e a conduta aparece com o total baixo.
    await escolher(page.getByTestId('fn-previa-mobilidade'), 'acamado');
    await page.getByTestId('fn-previa-riscos-friccao').check();
    await expect(page.getByTestId('fn-calc-total')).toContainText('Calculado: 3');
    await expect(page.getByTestId('fn-resumo')).toContainText(TITULO);
    await expect(page.getByTestId('fn-resumo')).toContainText('Acamado');
    // Os dois casos de teste de exemplo passam.
    await expect(page.getByTestId('fn-resultado-0')).toHaveText('Passou');
    await expect(page.getByTestId('fn-resultado-1')).toHaveText('Passou');
    // A regra guiada: a soma do total já vem marcada com as duas perguntas.
    await page.getByTestId('fn-pergunta-total').click();
    await expect(page.getByTestId('fn-guiado')).toBeVisible();
    await expect(page.getByTestId('fn-soma-mobilidade')).toBeChecked();
    await expect(page.getByTestId('fn-soma-riscos')).toBeChecked();
    await semViolacaoAxe(page, '/pep/admin/formularios-novos (editor)');

    await page.getByTestId('fn-salvar').click();
    await expect(page.getByTestId('fn-mensagem')).toHaveText('Rascunho salvo.');
    await expect(page.getByTestId(`fn-linha-${codigo}-1`)).toContainText('Rascunho');
    await page.getByTestId('fn-enviar').click();
    await expect(page.getByTestId('fn-mensagem')).toContainText('Enviado à revisão');
    // Quatro olhos: quem escreveu a versão não a aprova.
    await editor(page)
      .getByRole('textbox', { name: 'Parecer da comissão de prontuário' })
      .fill('Tentativa do próprio autor de aprovar');
    await page.getByTestId('fn-aprovar').click();
    await expect(page.getByTestId('fn-erro')).toContainText('Quem escreveu a versão não pode aprová-la.');

    // A comissão de prontuário aprova com o parecer e publica com a senha, vendo o hash.
    const com = await novaAba(browser, 'SINT.COMISSAO.PRONT');
    await com.goto('/pep/admin/formularios-novos');
    await com.getByTestId(`fn-linha-${codigo}-1`).getByRole('button').click();
    await expect(editor(com)).toContainText('Em revisão');
    await expect(com.getByTestId('fn-salvar')).toHaveCount(0);
    await editor(com)
      .getByRole('textbox', { name: 'Parecer da comissão de prontuário' })
      .fill('Conferido pela comissão: perguntas, pontos e casos de teste corretos (ação nº 2)');
    await com.getByTestId('fn-aprovar').click();
    await expect(com.getByTestId('fn-mensagem')).toContainText('aprovada');
    const hash = ((await com.getByTestId('fn-hash').textContent()) ?? '').replace(/^.*: /, '').trim();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    await com.getByTestId('fn-publicar').click();
    await expect(com.getByTestId('fn-dialogo')).toContainText(hash);
    await com.getByTestId('fn-senha').fill(SENHA);
    await semViolacaoAxe(com, '/pep/admin/formularios-novos (publicar)');
    await com.getByTestId('fn-confirmar').click();
    await expect(com.getByTestId('fn-mensagem')).toContainText('Versão publicada');
    await expect(com.getByTestId('fn-integro')).toBeVisible();
    await expect(com.getByTestId(`fn-linha-${codigo}-1`)).toContainText('Publicado');
    await expect(com.getByTestId('fn-historia-lista')).toContainText('aprovado por SINT.COMISSAO.PRONT');

    // O administrador vê a publicada (sem salvar: imutável), pode partir uma nova versão e aposenta com o motivo.
    await page.reload();
    await page.getByTestId(`fn-linha-${codigo}-1`).getByRole('button').click();
    await expect(page.getByTestId('fn-salvar')).toHaveCount(0);
    await expect(page.getByTestId('fn-nova-versao')).toBeVisible();
    await page.getByTestId('fn-aposentar').click();
    await page
      .getByTestId('fn-dialogo')
      .getByRole('textbox', { name: 'Motivo da aposentadoria' })
      .fill('Substituída por versão revisada da escala (ação nº 3)');
    await page.getByTestId('fn-senha').fill(SENHA);
    await page.getByTestId('fn-confirmar').click();
    await expect(page.getByTestId('fn-mensagem')).toContainText('aposentada');
    await expect(page.getByTestId(`fn-linha-${codigo}-1`)).toContainText('Aposentado');
    expect(externas).toEqual([]);
  });
});
