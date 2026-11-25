// E2E @C2-069 (03-PEP L97): exame físico estruturado por sistema e região do corpo, no que a fonte sintética permite.
// O médico abre o prontuário do paciente sintético, segue o atalho "Exame físico" do cabeçalho e chega à tela do
// exame. O catálogo (sistemas, regiões com o desenho do mapa, achados padronizados) e os achados moram só no banco do
// cliente: na fonte sintética (sem cliente padrão) a leitura GET /api/pep/exame-fisico/paciente/:id responde 503, e a
// tela mostra a mensagem de erro sem inventar mapa, montagem nem exames registrados. A montagem pelo mapa do corpo e
// pelos sistemas, o achado padronizado que completa o lugar, o lado obrigatório, o achado de outra idade, o repetido,
// o normal contra o alterado, a numeração no registro, só o autor com o registro em vigor e o vínculo assistencial
// ficam provados no contrato de efeito apps/api/src/modulos/pep/exame-fisico-propria.int.spec.ts (MariaDB) e na
// regra do domínio packages/dominio-pep/src/exame-fisico.spec.ts. Sessão real sobre a fonte sintética de dev
// (paciente SINTÉTICO; nada vai à cópia). axe sem violação séria.
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

test.describe('Exame físico estruturado @C2-069 @fase8', () => {
  test.setTimeout(120_000);
  test('atalho do prontuário leva ao exame físico; sem o banco do cliente, a tela mostra o erro e não grava; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.MEDICO');

    await page.goto(`/pep/paciente/${PACIENTE}/linha-do-tempo`);
    await expect(page.getByTestId('tela-prontuario-paciente')).toBeVisible();

    const leitura = page.waitForResponse((r) =>
      r.url().includes(`/api/pep/exame-fisico/paciente/${PACIENTE}`),
    );
    await page.getByTestId('atalho-exame-fisico').click();
    await expect(page).toHaveURL(new RegExp(`/pep/paciente/${PACIENTE}/exame-fisico$`));
    expect((await leitura).status()).toBe(503);

    const tela = page.getByTestId('exame-fisico-tela');
    await expect(tela).toBeVisible();
    await expect(tela.getByTestId('mensagem-erro').first()).toBeVisible();
    // Sem os dados do banco do cliente, nada para montar nem listar: nem mapa, nem montagem, nem exames registrados.
    await expect(page.getByTestId('exame-fisico-montar')).toHaveCount(0);
    await expect(page.getByTestId('exame-fisico-mapa')).toHaveCount(0);
    await expect(page.locator('article[data-testid^="exame-fisico-registrado-"]')).toHaveCount(0);
    await expect(page.getByTestId('exame-fisico-ok')).toHaveCount(0);

    await semViolacaoAxe(page, '/pep/paciente/:id/exame-fisico (sem o banco do cliente)');
    expect(externas).toEqual([]);
  });
});
