// E2E @M59.1 (ficha do M59, etapa 1: contas e privilégios). O painel "Contas do banco de dados e privilégios" é só
// consulta: abre pela tela de Permissões (link só para quem tem acesso.contaBanco.ler), mostra o resumo, a busca e
// os filtros (SanteSelecao), a aba Desvios com o plano por módulo ainda não aplicado; nenhum botão de revogar.
// Quem não tem a permissão não vê o link, cai em "sem permissão" e o servidor recusa (403). Sessão real sobre a
// fonte sintética de dev e a porta EM MEMÓRIA do inventário (só contas técnicas do catálogo; nada vai à cópia). axe.
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

async function sair(page: Page): Promise<void> {
  await page.getByTestId('menu-usuario').click();
  await page.getByTestId('sair').click();
  await expect(page).toHaveURL(/\/entrar/);
}

test.describe('Contas do banco de dados e privilégios @M59.1 @fase7', () => {
  test.setTimeout(180_000);

  test('inventário, busca, filtros e desvios; só consulta; sem a permissão, recusa; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const titulo = page.getByRole('heading', { level: 1, name: 'Contas do banco de dados e privilégios' });
    // O administrador do sistema abre o painel pelo link da tela de Permissões.
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/acesso/permissoes');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Permissões, menus e papéis SBIS' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Contas do banco de dados e privilégios' }).click();
    await expect(page).toHaveURL(/\/administracao\/acesso\/contas-banco/);
    await expect(titulo).toBeVisible();
    await sair(page);

    // O auditor abre direto pela rota.
    await entrar(page, 'SINT.AUDITOR');
    await page.goto('/administracao/acesso/contas-banco');
    await expect(titulo).toBeVisible();
    await expect(page.getByTestId('contas-resumo')).toBeVisible();
    await expect(page.getByTestId('contas-contexto')).toBeVisible();
    const tabela = page.getByTestId('tabela-contas');
    await expect(tabela).toBeVisible();
    await expect(page.getByTestId('conta-TISSWS')).toBeVisible();
    await expect(page.getByTestId('conta-HAL_AI')).toBeVisible();
    // Só consulta: nenhuma ação de revogar ou reduzir na tela.
    await expect(page.getByRole('button', { name: /revogar|reduzir|aplicar/i })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(/SPDATA|legado|sistema atual/i);
    await semViolacaoAxe(page, '/administracao/acesso/contas-banco (inventário)');

    // Busca pelo nome da conta.
    await page.getByLabel('Buscar conta').fill('HAL');
    await expect(page.getByTestId('conta-HAL_AI')).toBeVisible();
    await expect(page.getByTestId('conta-TISSWS')).toHaveCount(0);
    await page.getByTestId('contas-limpar').click();
    await expect(page.getByTestId('conta-TISSWS')).toBeVisible();

    // Filtro pelo destino (a conta da Hal-AI vira cliente da API do Sante, regra 12).
    await escolher(page.getByTestId('contas-filtro-destino'), 'fachada-sante-api');
    await expect(page.getByTestId('conta-HAL_AI')).toBeVisible();
    await expect(page.getByTestId('conta-TISSWS')).toHaveCount(0);
    await semViolacaoAxe(page, 'contas-banco filtrado');
    await page.getByTestId('contas-limpar').click();

    // Desvios do privilégio mínimo por módulo: o plano ainda não aplicado neste ambiente.
    await page.getByTestId('contas-aba-desvios').click();
    await expect(page.getByTestId('painel-desvios')).toBeVisible();
    await expect(page.getByTestId('desvios-totais')).toBeVisible();
    await expect(page.getByTestId('desvios-nao-aplicado')).toBeVisible();
    await expect(page.getByTestId('tabela-modulos')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/SPDATA|legado|sistema atual/i);
    await semViolacaoAxe(page, 'contas-banco desvios');

    // Sem a permissão: o gestor de acessos abre Permissões, mas não vê o link; a rota recusa; o servidor também.
    await sair(page);
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/permissoes');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Permissões, menus e papéis SBIS' }),
    ).toBeVisible();
    await expect(page.getByTestId('abrir-contas-banco')).toHaveCount(0);
    await page.goto('/administracao/acesso/contas-banco');
    await expect(page).toHaveURL(/sem-permissao/);
    const r = await page.request.get('/api/administracao/acesso/contas-banco');
    expect(r.status()).toBe(403);
    expect(externas).toEqual([]);
  });
});
