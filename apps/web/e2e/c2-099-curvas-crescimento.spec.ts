// E2E @C2-099 (03-PEP L141): curvas de crescimento do paciente, no que a fonte sintética permite. O médico abre o
// prontuário do paciente sintético, segue o atalho "Curvas de crescimento" do cabeçalho e chega à tela das curvas. As
// curvas e as medidas moram só no banco do cliente: na fonte sintética (sem cliente padrão) a leitura GET
// /api/pep/crescimento/paciente/:id responde 503, e a tela mostra a mensagem de erro sem inventar gráfico, tabela nem
// formulário. O escore Z, o percentil, a classificação, o gráfico com as linhas da OMS e os pontos do paciente, a
// medida de crescimento gravada como aferição com o nível de alerta, as recusas e o vínculo assistencial ficam SEM E2E
// e são provados no contrato de efeito apps/api/src/modulos/pep/curvas-crescimento-propria.int.spec.ts (MariaDB), na
// regra do domínio packages/dominio-pep/src/curvas-crescimento.spec.ts e no carregador
// catalogos/testes/test_curvas.py. Sessão real sobre a fonte sintética de dev (paciente SINTÉTICO; nada vai à cópia).
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

test.describe('Curvas de crescimento do paciente @C2-099 @fase8', () => {
  test.setTimeout(120_000);
  test('atalho do prontuário leva às curvas; sem o banco do cliente, a tela mostra o erro e não grava; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.MEDICO');

    await page.goto(`/pep/paciente/${PACIENTE}/linha-do-tempo`);
    await expect(page.getByTestId('tela-prontuario-paciente')).toBeVisible();

    const leitura = page.waitForResponse((r) =>
      r.url().includes(`/api/pep/crescimento/paciente/${PACIENTE}`),
    );
    await page.getByTestId('atalho-crescimento').click();
    await expect(page).toHaveURL(new RegExp(`/pep/paciente/${PACIENTE}/crescimento$`));
    expect((await leitura).status()).toBe(503);

    const tela = page.getByTestId('crescimento-tela');
    await expect(tela).toBeVisible();
    await expect(tela.getByTestId('mensagem-erro').first()).toBeVisible();
    // Sem os dados do banco do cliente: nem formulário, nem gráfico, nem medidas.
    await expect(page.getByTestId('crescimento-nova')).toHaveCount(0);
    await expect(page.getByTestId('crescimento-grafico')).toHaveCount(0);
    await expect(page.getByTestId('crescimento-medidas')).toHaveCount(0);
    await expect(page.getByTestId('crescimento-ok')).toHaveCount(0);

    await semViolacaoAxe(page, '/pep/paciente/:id/crescimento (sem o banco do cliente)');
    expect(externas).toEqual([]);
  });
});
