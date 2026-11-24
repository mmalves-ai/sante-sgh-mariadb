// E2E @F3.1 (ficha docs/fases/fichas/F3.1-cadastros.md): os fluxos principais das funções fechadas no marco de
// cadastros. Desfazer a unificação (02-CAD linha 7): a unificação segue só a permissão do cargo (sem chave de
// liberação); no histórico do prontuário que ficou, "Desfazer unificação" pede o motivo (validação na hora) e a senha,
// e o absorvido volta a ativo. Quem não tem a permissão não desfaz. Sessão real sobre a fonte sintética, portas em
// MEMÓRIA (pacientes SINTÉTICOS).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function csrf(page: Page): Promise<string> {
  return (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '';
}

test.describe('@F3.1 cadastros', () => {
  test.describe.configure({ timeout: 240_000 });

  test('unificar um par e desfazer pelo histórico, com motivo e senha', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.SAME');
    await page.goto('/cadastros/pacientes/duplicidades');
    await page.getByTestId('botao-atualizar-fila').click();
    await expect(page.getByTestId('unificacao-motivo')).toContainText('Unificação liberada');
    const linhas = page.getByTestId('tabela-duplicidades').locator('tbody tr');
    await expect(linhas.first()).toBeVisible();
    const par = ((await linhas.first().getAttribute('data-testid')) ?? '').replace('par-', '');
    const u = await page.request.post(`/api/cadastros/pacientes/duplicidades/${par}/unificar`, {
      headers: { 'x-csrf': await csrf(page) },
      data: { fica: 'a', justificativa: 'Mesmo CPF e mesma mãe (teste)', senha: SENHA },
    });
    expect(u.status()).toBe(200);
    const { idAbsorvido, idSobrevivente } = (await u.json()) as {
      idAbsorvido: number;
      idSobrevivente: number;
    };

    await page.goto(`/cadastros/pacientes/${idSobrevivente}/historico`);
    await expect(page.getByTestId(`unificacao-${idAbsorvido}`)).toBeVisible();
    await page.getByTestId(`desfazer-unificacao-${idAbsorvido}`).click();
    await expect(page.getByTestId('form-desfazer-unificacao')).toBeVisible();
    await page.getByTestId('motivo-desfazer').fill('abc');
    await expect(page.getByTestId('botao-confirmar-desfazer')).toBeDisabled();
    await page.getByTestId('motivo-desfazer').fill('Eram pessoas diferentes: documentos conferidos');
    await page.getByTestId('senha-desfazer').fill(SENHA);
    await semViolacaoAxe(page, 'desfazer unificação');
    await page.getByTestId('botao-confirmar-desfazer').click();
    await expect(page.getByTestId('mensagem-desfazer')).toContainText(`prontuário ${idAbsorvido} está ativo`);
    await expect(page.getByTestId(`unificacao-${idAbsorvido}`)).toHaveCount(0);
    // O par volta à fila aberta.
    await page.goto('/cadastros/pacientes/duplicidades');
    await expect(page.getByTestId(`par-${par}`)).toBeVisible();
    expect(externas).toEqual([]);

    // Quem não tem a permissão de unificar: 403 também para desfazer.
    await entrar(page, 'SINT.RECEPCAO');
    const r = await page.request.post(`/api/cadastros/pacientes/unificacoes/${idAbsorvido}/desfazer`, {
      headers: { 'x-csrf': await csrf(page) },
      data: { motivo: 'Tentativa sem a permissão', senha: SENHA },
    });
    expect(r.status()).toBe(403);
  });
});
