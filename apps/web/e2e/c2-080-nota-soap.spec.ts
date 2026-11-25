// E2E @C2-080 (03-PEP L98): nota clínica em quatro partes (subjetivo, objetivo, avaliação e plano) codificada, no que a
// fonte sintética permite. O médico abre o prontuário do paciente sintético, segue o atalho "Nota S.O.A.P." do
// cabeçalho e chega à tela da nota. Atendimentos, configuração, termos (CID-10 e CIAP-2) e notas moram só no banco do
// cliente: na fonte sintética (sem cliente padrão) a leitura GET /api/pep/nota-soap/paciente/:id responde 503, e a tela
// mostra a mensagem de erro sem inventar formulário nem notas. O rascunho, os códigos numerados, a CIAP-2 por
// configuração, o CID-10 obrigatório na avaliação, a gestação pela data da última menstruação, a assinatura com o
// problema do paciente, o sem efeito com justificativa, só o autor e o vínculo assistencial ficam provados no contrato
// de efeito apps/api/src/modulos/pep/nota-soap-propria.int.spec.ts (MariaDB) e na regra do domínio
// packages/dominio-pep/src/nota-soap.spec.ts. Sessão real sobre a fonte sintética de dev (paciente SINTÉTICO; nada vai
// à cópia). axe sem violação séria.
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

test.describe('Nota clínica S.O.A.P. codificada @C2-080 @fase8', () => {
  test.setTimeout(120_000);
  test('atalho do prontuário leva à nota; sem o banco do cliente, a tela mostra o erro e não grava; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.MEDICO');

    await page.goto(`/pep/paciente/${PACIENTE}/linha-do-tempo`);
    await expect(page.getByTestId('tela-prontuario-paciente')).toBeVisible();

    const leitura = page.waitForResponse((r) => r.url().includes(`/api/pep/nota-soap/paciente/${PACIENTE}`));
    await page.getByTestId('atalho-nota-soap').click();
    await expect(page).toHaveURL(new RegExp(`/pep/paciente/${PACIENTE}/nota-soap$`));
    expect((await leitura).status()).toBe(503);

    const tela = page.getByTestId('nota-soap-tela');
    await expect(tela).toBeVisible();
    await expect(tela.getByTestId('mensagem-erro').first()).toBeVisible();
    // Sem os dados do banco do cliente: nem formulário, nem notas registradas, nem confirmação.
    await expect(page.getByTestId('nota-soap-form')).toHaveCount(0);
    await expect(page.locator('article[data-testid^="nota-soap-registrada-"]')).toHaveCount(0);
    await expect(page.getByTestId('nota-soap-ok')).toHaveCount(0);

    await semViolacaoAxe(page, '/pep/paciente/:id/nota-soap (sem o banco do cliente)');
    expect(externas).toEqual([]);
  });
});
