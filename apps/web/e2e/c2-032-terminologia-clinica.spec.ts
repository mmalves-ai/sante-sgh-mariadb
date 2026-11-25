// E2E @C2-032 (09-AREA L84): diagnósticos do paciente com a CID-10 e o conceito clínico equivalente, no que a fonte
// sintética permite. O médico abre o prontuário do paciente sintético, segue o atalho "Diagnósticos" do cabeçalho e
// chega à tela dos diagnósticos do paciente. Os diagnósticos e a terminologia clínica moram só no banco do cliente: na
// fonte sintética (sem cliente padrão) a leitura GET /api/pep/terminologia-clinica/paciente/:id/diagnosticos responde
// 503, e a tela mostra a mensagem de erro sem inventar formulário nem lista. A busca da CID-10 e dos conceitos, o
// registro com o conceito sugerido pela equivalência, a troca e a retirada do conceito, a região anatômica do exame
// (ligar com a padrão única, retirar só desativando, religar) e o vínculo assistencial ficam SEM E2E e são provados no
// contrato de efeito apps/api/src/modulos/pep/terminologia-clinica-propria.int.spec.ts (MariaDB), na regra do domínio
// packages/dominio-pep/src/terminologia-clinica.spec.ts e no carregador catalogos/testes/test_snomed.py. Sessão real
// sobre a fonte sintética de dev (paciente SINTÉTICO; nada vai à cópia). Sem combo nativo. axe sem violação séria.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { esperarSemSelectNativo } from './combos.js';

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

test.describe('Diagnósticos do paciente com a terminologia clínica @C2-032 @fase8', () => {
  test.setTimeout(120_000);
  test('atalho do prontuário leva aos diagnósticos; sem o banco do cliente, a tela mostra o erro e não grava; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.MEDICO');

    await page.goto(`/pep/paciente/${PACIENTE}/linha-do-tempo`);
    await expect(page.getByTestId('tela-prontuario-paciente')).toBeVisible();

    const leitura = page.waitForResponse((r) =>
      r.url().includes(`/api/pep/terminologia-clinica/paciente/${PACIENTE}/diagnosticos`),
    );
    await page.getByTestId('atalho-diagnosticos').click();
    await expect(page).toHaveURL(new RegExp(`/pep/paciente/${PACIENTE}/diagnosticos(\\?|$)`));
    expect((await leitura).status()).toBe(503);

    const tela = page.getByTestId('diagnosticos-tela');
    await expect(tela).toBeVisible();
    await expect(tela.getByTestId('mensagem-erro').first()).toBeVisible();
    // Sem os dados do banco do cliente, nada para gravar nem listar: nem formulário, nem lista, nem "nenhum".
    await expect(page.getByTestId('diagnosticos-novo')).toHaveCount(0);
    await expect(page.getByTestId('diagnosticos-nenhum')).toHaveCount(0);
    await expect(page.locator('article[data-testid^="diagnostico-"]')).toHaveCount(0);
    await expect(page.getByTestId('diagnosticos-ok')).toHaveCount(0);
    await esperarSemSelectNativo(tela);

    await semViolacaoAxe(page, '/pep/paciente/:id/diagnosticos (sem o banco do cliente)');
    expect(externas).toEqual([]);
  });
});
