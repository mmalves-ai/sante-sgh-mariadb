// E2E @M06: permissões do legado na tela, com a sessão real (fonte sintética em dev: usuários sintéticos com
// concessões sintéticas, nenhum login real). Menu filtrado por dois perfis (Gestor de acessos × recepção),
// telas de consulta (grupos e mapa, lidas ao vivo da cópia: só metadado e contagens), quebra de vidro com o
// alerta ao Auditor entregue no Mailpit (fila email do worker) e axe sem violação séria.
import { expect, test, type Page } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe } from './ajuda.js';
import { escolher, rotulosDoCombo } from './combos.js';

const SENHA = 'Sintetico#2026';
const MAILPIT = 'http://127.0.0.1:8325';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('permissões do legado e quebra de vidro @M06', () => {
  test('menu filtrado por dois perfis: o Gestor de acessos vê o acesso; a recepção não vê nem abre', async ({
    page,
  }) => {
    await entrar(page, 'SINT.GESTOR');
    const menu = page.getByRole('navigation', { name: 'Menu principal' });
    await expect(await itemDoMenu(page, 'Permissões, menus e papéis SBIS')).toBeVisible();
    await expect(await itemDoMenu(page, 'Grupos de usuários e perfis')).toBeVisible();
    await menu.getByRole('link', { name: /Grupos de usuários e perfis/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Grupos de usuários e perfis' })).toBeVisible();
    const linhas = page.getByTestId('tabela-grupos').locator('tbody tr');
    await expect(linhas).toHaveCount(42);
    await expect(page.getByTestId('tabela-grupos')).toContainText('Caso a caso');
    await semViolacaoAxe(page, 'grupos');

    await page.getByTestId('menu-usuario').click();
    await page.getByTestId('sair').click();
    await expect(page).toHaveURL(/\/entrar/);

    await entrar(page, 'SINT.RECEPCAO');
    await expect(await itemDoMenu(page, 'Grupos de usuários e perfis')).toHaveCount(0);
    await expect(await itemDoMenu(page, 'Permissões, menus e papéis SBIS')).toHaveCount(0);
    await page.goto('/administracao/acesso/grupos');
    await expect(page).toHaveURL(/sem-permissao/);
    // A tela é conveniência: o servidor recusa também.
    const r = await page.request.get('/api/acesso/grupos');
    expect(r.status()).toBe(403);
  });

  test('mapa: a árvore de um módulo do legado com a permissão de cada opção', async ({ page }) => {
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/mapa');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Permissões, menus e papéis SBIS' }),
    ).toBeVisible();
    const seletor = page.getByLabel('Módulo');
    await expect.poll(async () => (await rotulosDoCombo(seletor)).length).toBeGreaterThan(1);
    await escolher(seletor, '23'); // P.E.P. (sghpep)
    const arvore = page.getByTestId('arvore-mapa');
    await expect(arvore).toContainText('pep.modulo.acessar');
    await expect(arvore).toContainText('opção inativa');
    await semViolacaoAxe(page, 'mapa');
  });

  test('quebra de vidro: aviso, motivo, justificativa, senha de novo e alerta ao Auditor no Mailpit', async ({
    page,
  }) => {
    const inicio = Date.now();
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/demonstracao/quebra-de-vidro');
    await page.getByRole('button', { name: 'Abrir o prontuário' }).click();
    await expect(page.getByTestId('oferta-quebra-vidro')).toBeVisible();
    await page.getByRole('button', { name: 'Usar a quebra de vidro' }).click();
    const dialogo = page.getByTestId('dialogo-quebra-vidro');
    await expect(dialogo).toBeVisible();
    await expect(dialogo).toContainText('excepcional e auditado');
    await semViolacaoAxe(page, 'diálogo de quebra de vidro');
    await escolher(dialogo.getByLabel('Motivo'), 'parada-cardiorrespiratoria');
    await dialogo
      .getByLabel('Justificativa (obrigatória)')
      .fill('Parada no corredor do setor; atendimento imediato.');
    await dialogo.getByLabel('Sua senha (confirmação)').fill(SENHA);
    await dialogo.getByRole('button', { name: 'Abrir com quebra de vidro' }).click();
    const aberta = page.getByTestId('emergencia-aberta');
    await expect(aberta).toContainText('alerta ao Auditor: enfileirado');
    const id = /nº (\d+)/.exec((await aberta.textContent()) ?? '')?.[1];
    expect(id).toBeTruthy();
    await expect(page.getByTestId('prontuario-sintetico')).toContainText('Paciente Fictício Um');

    // O worker entrega o alerta (fila email → SMTP) no Mailpit: assunto só com o número e o estabelecimento.
    let assunto: string | null = null;
    for (let i = 0; i < 40 && !assunto; i++) {
      const r = await page.request.get(`${MAILPIT}/api/v1/messages?limit=50`);
      const corpo = (await r.json()) as { messages: { Subject: string; Created: string }[] };
      assunto =
        corpo.messages.find(
          (m) =>
            m.Subject.startsWith(`Acesso de emergência nº ${id} (`) &&
            new Date(m.Created).getTime() >= inicio - 5_000,
        )?.Subject ?? null;
      if (!assunto) await page.waitForTimeout(500);
    }
    expect(assunto).toMatch(/^Acesso de emergência nº \d+ \([a-z0-9]+\)$/);
  });
});
