// E2E @M60.2 (ficha do M60, etapa 2, instalação no Ubuntu 24.04): o administrador abre a "Saúde do sistema", passa
// pela aba "Conferência da instalação" e vê a situação geral, os oito itens na ordem do contrato, a versão, a conexão
// ao banco (motor, autenticação Srp, canal cifrado, conta e papel) e as atualizações do banco em dia; "Conferir de
// novo" refaz a leitura; quem não tem sistema.saude.ler não abre a tela (e o servidor recusa a API); a sonda da
// conferência não existe sem o segredo. axe em cada tela; nenhum texto cita o outro sistema pelo nome.
// Sessão real sobre a fonte sintética de dev e a porta da conferência EM MEMÓRIA (nada vai à cópia).
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const ITENS = [
  'motor',
  'autenticacao',
  'canal-cifrado',
  'charset',
  'conta-propria',
  'papel-aplicacao',
  'scripts',
  'versao',
] as const;

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Conferência da instalação @M60.2 @fase7', () => {
  test.setTimeout(180_000);

  test('aba da Saúde do sistema: situação, itens na ordem, conexão, scripts em dia e conferir de novo; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/saude');
    await page.getByTestId('aba-conferencia').click();
    await expect(page).toHaveURL(/\/administracao\/saude\/instalacao$/);
    const tela = page.getByTestId('tela-conferencia-instalacao');
    await expect(tela).toBeVisible();
    await expect(page.getByTestId('aba-conferencia')).toHaveAttribute('aria-current', 'page');

    const situacao = page.getByTestId('conferencia-situacao');
    await expect(situacao).toBeVisible();
    expect(['ok', 'alerta', 'falha']).toContain(await situacao.getAttribute('data-situacao'));

    // Os oito itens, na ordem do contrato.
    const linhas = page.getByTestId('tabela-itens').locator('tbody tr');
    await expect(linhas).toHaveCount(ITENS.length);
    for (const [i, codigo] of ITENS.entries())
      await expect(linhas.nth(i)).toHaveAttribute('data-testid', `item-${codigo}`);
    // A porta sintética é uma instalação correta no Firebird 3: Srp, canal cifrado, conta própria com o papel.
    for (const codigo of [
      'motor',
      'autenticacao',
      'canal-cifrado',
      'conta-propria',
      'papel-aplicacao',
      'scripts',
    ])
      await expect(page.getByTestId(`item-${codigo}`)).toContainText('Em ordem');
    await expect(page.getByTestId('conexao-versaoMotor')).toContainText('3.0.14');
    await expect(page.getByTestId('conexao-autenticacao')).toContainText('Srp256');
    await expect(page.getByTestId('conexao-canalCifrado')).toContainText('Sim');
    await expect(page.getByTestId('conexao-papel')).toContainText('SGH_APLICACAO');
    await expect(page.getByTestId('conferencia-versao')).toBeVisible();
    await expect(page.getByTestId('scripts-em-dia')).toBeVisible();
    await expect(page.getByTestId('scripts-pendentes')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(/SPDATA|legado|sistema atual/i);
    await semViolacaoAxe(page, '/administracao/saude/instalacao');

    // Conferir de novo refaz a leitura (nova requisição à API).
    const nova = page.waitForResponse(
      (r) => r.url().includes('/api/administracao/implantacao/conferencia') && r.status() === 200,
    );
    await page.getByTestId('conferencia-atualizar').click();
    await nova;
    await expect(linhas).toHaveCount(ITENS.length);

    // De volta aos painéis pela aba.
    await page.getByTestId('aba-paineis').click();
    await expect(page).toHaveURL(/\/administracao\/saude$/);
    await expect(page.getByTestId('aba-paineis')).toHaveAttribute('aria-current', 'page');
    await semViolacaoAxe(page, '/administracao/saude (abas)');
    expect(externas).toEqual([]);
  });

  test('sem sistema.saude.ler: a tela não abre e a API recusa; a sonda não existe sem o segredo', async ({
    page,
  }) => {
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/administracao/saude/instalacao');
    await expect(page).toHaveURL(/\/sem-permissao$/);
    await expect(page.getByTestId('tela-conferencia-instalacao')).toHaveCount(0);
    expect((await page.request.get('/api/administracao/implantacao/conferencia')).status()).toBe(403);
    expect((await page.request.get('/api/sistema/sonda/instalacao')).status()).toBe(404);
    expect(
      (
        await page.request.get('/api/sistema/sonda/instalacao', { headers: { 'x-sonda-token': 'errado' } })
      ).status(),
    ).toBe(404);
  });
});
