// E2E @C3-019 (03-PEP L142): plano de cuidado e estratificação de risco do paciente, no que a fonte sintética permite.
// O médico abre o prontuário do paciente sintético, segue o atalho "Plano de cuidado" do cabeçalho e chega à tela do
// plano. Os planos moram só no banco do cliente: na fonte sintética (sem cliente padrão) a leitura GET
// /api/pep/plano-cuidado/paciente/:id responde 503, e a tela mostra a mensagem de erro sem inventar formulário nem
// planos. Criar o rascunho, não criar com justificativa, itens em hierarquia, reestratificar com aviso, ativar, passos
// dos itens com desvio justificado, fechar e cancelar ficam SEM E2E e são provados no contrato de efeito
// apps/api/src/modulos/pep/plano-cuidado-propria.int.spec.ts (MariaDB) e na regra do domínio
// packages/dominio-pep/src/plano-cuidado.spec.ts. Sessão real sobre a fonte sintética de dev (paciente SINTÉTICO).
// axe sem violação séria.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 1001;

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Plano de cuidado do paciente @C3-019 @fase8', () => {
  test.setTimeout(120_000);
  test('atalho do prontuário leva ao plano; sem o banco do cliente, a tela mostra o erro e não grava; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.MEDICO');
    await page.goto(`/pep/paciente/${PACIENTE}/linha-do-tempo`);
    await expect(page.getByTestId('tela-prontuario-paciente')).toBeVisible();

    const leitura = page.waitForResponse((r) =>
      r.url().includes(`/api/pep/plano-cuidado/paciente/${PACIENTE}`),
    );
    await page.getByTestId('atalho-plano-cuidado').click();
    await expect(page).toHaveURL(new RegExp(`/pep/paciente/${PACIENTE}/plano-cuidado$`));
    expect((await leitura).status()).toBe(503);

    const tela = page.getByTestId('plano-cuidado-tela');
    await expect(tela).toBeVisible();
    await expect(tela.getByTestId('mensagem-erro').first()).toBeVisible();
    await expect(page.getByTestId('plano-novo')).toHaveCount(0);
    await expect(page.locator('article[data-testid^="plano-"]')).toHaveCount(0);
    await expect(page.getByTestId('plano-ok')).toHaveCount(0);

    await semViolacaoAxe(page, '/pep/paciente/:id/plano-cuidado (sem o banco do cliente)');
    expect(externas).toEqual([]);
  });
});
