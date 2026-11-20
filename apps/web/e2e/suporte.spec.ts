// E2E @SUPORTE (ADR 0021): conta da plataforma e "login como" com as contas e os usuários SINTÉTICOS de dev
// (nenhum login real). A plataforma entra pelo login próprio, abre o "como" de um usuário sintético (faixa fixa
// com "Voltar à minha conta"), volta, designa um suporte (convite) e vê a sessão na auditoria; o suporte
// sintético só vê o estabelecimento atribuído; o suporte sem estabelecimento não tem o "Entrar como".
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher, esperarOpcoes } from './combos.js';

const SENHA = 'Sintetico#Plataforma2026';

async function entrarPlataforma(page: Page, email: string): Promise<void> {
  await page.goto('/plataforma/entrar');
  await page.getByTestId('plataforma-email').fill(email);
  await page.getByTestId('plataforma-senha').fill(SENHA);
  await page.getByTestId('plataforma-acessar').click();
  await expect(page.getByTestId('plataforma-inicio')).toBeVisible();
}

test.describe('suporte técnico e login como @SUPORTE', () => {
  test('plataforma: entra como um usuário sintético, vê a faixa e volta à própria conta', async ({
    page,
  }) => {
    await entrarPlataforma(page, 'plataforma@sintetico.invalid');
    await semViolacaoAxe(page, 'plataforma');
    await page.getByTestId('abrir-como').click();
    await esperarOpcoes(page.getByTestId('como-estabelecimento'), null);
    await escolher(page.getByTestId('como-grupo'), 'SINTETICO');
    await escolher(page.getByTestId('como-usuario'), 'SINT.ADMIN');
    await page.getByTestId('como-motivo').fill('CHAMADO-E2E');
    await page.getByTestId('como-abrir').click();
    await expect(page).toHaveURL(/\/inicio/);
    await expect(page.getByTestId('faixa-como')).toContainText('administração da plataforma');
    // A sessão é a do alvo: o servidor devolve a marca e as permissões dele.
    const s = await page.request.get('/api/sessao');
    expect((await s.json()).como.ator.tipo).toBe('plataforma');
    await page.getByTestId('voltar-conta').click();
    await expect(page.getByTestId('plataforma-inicio')).toBeVisible();
    // Sem o cookie do "como" (no E2E, sem cookie vale a sessão sintética dos testes): nenhuma marca "como".
    const depois = await page.request.get('/api/sessao');
    expect(depois.status() === 401 || (await depois.json()).como === undefined).toBe(true);
  });

  test('plataforma: designa um suporte (convite) e vê a sessão na auditoria', async ({ page }) => {
    await entrarPlataforma(page, 'plataforma@sintetico.invalid');
    await page.getByTestId('link-suporte').click();
    await page.getByTestId('aba-suportes').click();
    await page.getByTestId('novo-suporte-email').fill(`e2e.${Date.now()}@sintetico.invalid`);
    await page.getByTestId('novo-suporte').click();
    await expect(page.getByTestId('convite')).toContainText('/plataforma/convite?token=');
    await page.getByTestId('aba-auditoria').click();
    await expect(page.getByTestId('sessoes')).toContainText('SINT.ADMIN');
    await semViolacaoAxe(page, 'suporte-tecnico');
  });

  test('suporte: só o estabelecimento atribuído; sem estabelecimento, sem "Entrar como"', async ({
    page,
  }) => {
    await entrarPlataforma(page, 'suporte@sintetico.invalid');
    await page.getByTestId('abrir-como').click();
    await esperarOpcoes(page.getByTestId('como-estabelecimento'), 1);
    const r = await page.request.get('/api/plataforma/como/estabelecimentos');
    expect(((await r.json()) as unknown[]).length).toBe(1);
    await page.goto('/plataforma/entrar');
    await entrarPlataforma(page, 'suporte.livre@sintetico.invalid');
    await expect(page.getByTestId('sem-como')).toBeVisible();
    expect((await page.request.get('/api/plataforma/como/estabelecimentos')).status()).toBe(403);
  });
});
