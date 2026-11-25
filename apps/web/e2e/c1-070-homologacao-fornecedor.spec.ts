// E2E @C1-070 (09-AREA linha 66): homologação de fornecedores por questionário pontuado pelas rotas reais do módulo (o
// HomologacaoFornecedorController registrado no modulo.ts). O gestor de contratos abre a tela pelo menu (Suprimentos >
// Compras > Homologação de fornecedores). A porta grava só no banco próprio: na sessão sintética de dev/ci (logins
// SINT.*, sem o núcleo), GET /api/suprimentos/homologacao-fornecedor responde 503 e a tela mostra o erro sem inventar
// formulário nem ranking (primeiro teste). Com o banco do cliente ligado (o segundo teste se pula sem ele), o caminho
// completo: o questionário novo com a validação na hora (nota mínima fora da faixa recusada antes de gravar), a avaliação
// com a prévia da nota e das parcelas calculada na hora, o resultado registrado, o ranking e as respostas. O efeito no
// MariaDB (questionário, perguntas, avaliação, respostas, exceção, cancelamento e trilha) está em
// apps/api/src/modulos/suprimentos/homologacao-fornecedor.int.spec.ts. Massa SINTÉTICA; nenhum dado de pessoa.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const FORNECEDOR = '7001';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** Abre a tela pelo menu e devolve o status da leitura do painel. */
async function abrirPeloMenu(page: Page): Promise<number> {
  const leitura = page.waitForResponse(
    (r) => r.url().endsWith('/api/suprimentos/homologacao-fornecedor') && r.request().method() === 'GET',
  );
  const menu = page.getByRole('navigation', { name: 'Menu principal' });
  await menu.getByRole('button', { name: /^Suprimentos/ }).click();
  const compras = menu.getByRole('button', { name: /^Compras/ });
  if ((await compras.getAttribute('aria-expanded')) !== 'true') await compras.click();
  await menu.getByRole('link', { name: 'Homologação de fornecedores' }).click();
  await expect(page).toHaveURL(/\/suprimentos\/homologacao-fornecedores$/);
  await expect(page.getByTestId('tela-homologacao-fornecedores')).toBeVisible();
  return (await leitura).status();
}

test.describe('@C1-070 Homologação de fornecedores por questionário pontuado', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  test('pelo menu; sem o banco do cliente, a tela mostra o erro e não oferece gravação; axe', async ({
    page,
  }) => {
    vigiarExternas(page);
    await entrar(page, 'SINT.CONTRATOS');
    const status = await abrirPeloMenu(page);
    const tela = page.getByTestId('tela-homologacao-fornecedores');
    await expect(tela.getByTestId('homol-aba-avaliar')).toBeVisible();
    await expect(tela.getByTestId('homol-aba-ranking')).toBeVisible();
    if (status === 503) {
      await expect(tela.getByTestId('recusa-suprimentos').first()).toBeVisible();
      await expect(tela.getByTestId('homol-registrar')).toHaveCount(0);
      await expect(tela.getByTestId('homol-q-gravar')).toHaveCount(0);
      await expect(tela.getByTestId('homol-ranking-tabela')).toHaveCount(0);
    } else {
      expect(status).toBe(200);
      await expect(tela.getByTestId('homol-avaliar')).toBeVisible();
    }
    await semViolacaoAxe(page, '/suprimentos/homologacao-fornecedores');
  });

  test('com o banco do cliente: questionário conferido na hora, avaliação com a prévia, ranking e respostas', async ({
    page,
  }) => {
    vigiarExternas(page);
    await entrar(page, 'SINT.CONTRATOS');
    const status = await abrirPeloMenu(page);
    test.skip(status === 503, 'A homologação grava só no banco próprio; a fonte sintética responde 503.');
    const codigo = `E2E-${Date.now().toString(36).slice(-6).toUpperCase()}`;

    // 1. O questionário novo: a nota mínima fora de 0 a 100 é recusada na hora; corrigida, grava.
    await page.getByTestId('homol-aba-questionarios').click();
    await page.getByTestId('homol-q-codigo').fill(codigo);
    await page.getByTestId('homol-q-descricao').fill('Questionário sintético de medicamentos (teste C1-070)');
    await page.getByTestId('homol-q-minima').fill('120');
    await page.getByTestId('homol-qp-texto-1').fill('Autorização de funcionamento vigente?');
    await escolher(page.getByTestId('homol-qp-tipo-1'), 'sim_nao');
    await page.getByTestId('homol-qp-peso-1').fill('3');
    await page.getByTestId('homol-qp-eliminatoria-1').check();
    await expect(page.getByTestId('homol-q-recusa-0')).toBeVisible();
    await expect(page.getByTestId('homol-q-gravar')).toBeDisabled();
    await page.getByTestId('homol-q-minima').fill('70');
    await page.getByTestId('homol-q-mais-pergunta').click();
    await page.getByTestId('homol-qp-texto-2').fill('Cumprimento de prazo de entrega');
    await page.getByTestId('homol-qp-peso-2').fill('2');
    await expect(page.getByTestId('homol-q-recusa-0')).toHaveCount(0);
    await page.getByTestId('homol-q-gravar').click();
    await expect(page.getByTestId('homol-mensagem')).toContainText('Questionário gravado');
    await expect(page.getByTestId('homol-questionarios-tabela')).toContainText(codigo);

    // 2. A avaliação: o questionário e o fornecedor nos combos; a prévia calcula a nota e as parcelas na hora.
    await page.getByTestId('homol-aba-avaliar').click();
    await escolher(page.getByTestId('homol-questionario'), { rotulo: new RegExp(`^${codigo} `) });
    await page.getByTestId('homol-termo').fill(FORNECEDOR);
    await page.getByTestId('homol-buscar').click();
    await escolher(page.getByTestId('homol-fornecedor'), { indice: 1 });
    await expect(page.getByTestId('homol-pendencias')).toBeVisible();
    await expect(page.getByTestId('homol-registrar')).toBeDisabled();
    await page.getByTestId('homol-resposta-1-1').check();
    await page.getByTestId('homol-resposta-2-2').check();
    // (3 × 10/10 + 2 × 5/10) ÷ 5 × 100 = 80.
    await expect(page.getByTestId('homol-nota')).toHaveText('80');
    await expect(page.getByTestId('homol-parcelas')).toContainText('Nota = 100 × 4 ÷ 5 = 80');
    await expect(page.getByTestId('homol-previsto')).toContainText('Homologado');
    await page.getByTestId('homol-registrar').click();
    await expect(page.getByTestId('homol-mensagem')).toContainText('homologado com nota 80');

    // 3. O ranking do questionário e as respostas gravadas.
    await page.getByTestId('homol-aba-ranking').click();
    await escolher(page.getByTestId('homol-ranking-questionario'), { rotulo: new RegExp(`^${codigo} `) });
    await expect(page.getByTestId('homol-ranking-1')).toContainText('80');
    await page.getByTestId('homol-aba-avaliacoes').click();
    await page.getByTestId('homol-lista').getByRole('button', { name: 'Respostas' }).first().click();
    await expect(page.getByTestId('homol-detalhe')).toContainText('Atende parcialmente');
    await semViolacaoAxe(page, '/suprimentos/homologacao-fornecedores (avaliação registrada)');
  });
});
