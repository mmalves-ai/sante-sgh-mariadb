// E2E @M60.3 (ficha do M60, etapa 3, testes pós-implantação): o administrador abre a "Saúde do sistema", passa pela
// aba "Fumaça do servidor" e vê a situação geral com a contagem, os oito itens na ordem do contrato (fuso, relógio, hora confiável,
// serviço de filas, trabalhadores, filas, estrutura do banco e funções liberadas), os relógios, as filas e as chaves;
// "Conferir de novo" refaz a leitura; quem não tem sistema.saude.ler não abre a tela (e o servidor recusa a API); a
// sonda da fumaça não existe sem o segredo. axe em cada tela; nenhum texto cita o outro sistema pelo nome nem os
// nomes técnicos dos serviços. Sessão real sobre a fonte sintética de dev (nada vai à cópia). A fumaça contra a
// instância INSTALADA (login e consulta ao vivo) é a de apps/web/e2e-instalado, rodada pelo ensaio do Ubuntu.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const ITENS = [
  'fuso',
  'relogio',
  'hora-confiavel',
  'valkey',
  'worker',
  'filas',
  'impressao-digital',
  'chaves',
] as const;

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Fumaça do servidor @M60.3 @fase7', () => {
  test.setTimeout(180_000);

  test('aba da Saúde do sistema: situação, oito itens na ordem, relógio, filas, chaves e conferir de novo; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/saude');
    await page.getByTestId('aba-fumaca').click();
    await expect(page).toHaveURL(/\/administracao\/saude\/fumaca$/);
    const tela = page.getByTestId('tela-fumaca-servidor');
    await expect(tela).toBeVisible();
    await expect(page.getByTestId('aba-fumaca')).toHaveAttribute('aria-current', 'page');

    const situacao = page.getByTestId('fumaca-situacao');
    await expect(situacao).toBeVisible();
    expect(['ok', 'alerta', 'falha']).toContain(await situacao.getAttribute('data-situacao'));
    await expect(page.getByTestId('fumaca-contagem')).toBeVisible();

    // Os oito itens, na ordem do contrato.
    const linhas = page.getByTestId('fumaca-itens').locator('tbody tr');
    await expect(linhas).toHaveCount(ITENS.length);
    for (const [i, codigo] of ITENS.entries())
      await expect(linhas.nth(i)).toHaveAttribute('data-testid', `fumaca-item-${codigo}`);
    // O fuso do processo é UTC (o núcleo recusa outro): o item fica em ordem também na obra.
    await expect(page.getByTestId('fumaca-item-fuso')).toContainText('Em ordem');

    // Os quadros de apoio: relógios, serviço de filas, filas, estrutura e funções liberadas.
    await expect(page.getByTestId('fumaca-relogio')).toBeVisible();
    await expect(page.getByTestId('fumaca-valkey')).toBeVisible();
    await expect(page.getByTestId('fumaca-impressao')).toBeVisible();
    await expect(
      page.getByTestId('fumaca-filas').or(page.getByTestId('filas-nenhuma')).first(),
    ).toBeVisible();
    await expect(
      page
        .getByTestId('fumaca-chaves')
        .or(page.getByTestId('chaves-nenhuma'))
        .or(page.getByTestId('chaves-nao-lidas'))
        .first(),
    ).toBeVisible();

    const corpo = page.locator('body');
    await expect(corpo).not.toContainText(/SPDATA|legado|sistema atual/i);
    // Os títulos e os quadros usam os termos do produto (o detalhe de uma falha cita o serviço no servidor, para a TI).
    for (const th of await page.getByTestId('fumaca-itens').locator('tbody th').allInnerTexts())
      expect(th).not.toMatch(/Valkey|Redis|worker|BullMQ/i);
    await expect(page.getByTestId('fumaca-valkey')).not.toContainText(/Valkey|Redis/i);
    await semViolacaoAxe(page, '/administracao/saude/fumaca');

    // Conferir de novo refaz a leitura (nova requisição à API).
    const nova = page.waitForResponse(
      (r) => r.url().includes('/api/administracao/implantacao/fumaca') && r.status() === 200,
    );
    await page.getByTestId('fumaca-atualizar').click();
    await nova;
    await expect(linhas).toHaveCount(ITENS.length);

    // As três abas convivem: de volta à conferência da instalação e aos painéis.
    await page.getByTestId('aba-conferencia').click();
    await expect(page).toHaveURL(/\/administracao\/saude\/instalacao$/);
    await page.getByTestId('aba-paineis').click();
    await expect(page).toHaveURL(/\/administracao\/saude$/);
    await semViolacaoAxe(page, '/administracao/saude (três abas)');
    expect(externas).toEqual([]);
  });

  test('sem sistema.saude.ler: a tela não abre e a API recusa; a sonda da fumaça não existe sem o segredo', async ({
    page,
  }) => {
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/administracao/saude/fumaca');
    await expect(page).toHaveURL(/\/sem-permissao$/);
    await expect(page.getByTestId('tela-fumaca-servidor')).toHaveCount(0);
    expect((await page.request.get('/api/administracao/implantacao/fumaca')).status()).toBe(403);
    expect((await page.request.get('/api/sistema/sonda/fumaca')).status()).toBe(404);
    expect(
      (
        await page.request.get('/api/sistema/sonda/fumaca', { headers: { 'x-sonda-token': 'errado' } })
      ).status(),
    ).toBe(404);
  });
});
