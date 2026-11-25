// E2E @C1-049 (03-PEP L102): notas e lembretes livres sobre o paciente, no que a fonte sintética permite. O médico
// abre o prontuário do paciente sintético, segue o atalho "Notas e lembretes" do cabeçalho e chega à tela das notas.
// As notas moram só no banco do cliente: na fonte sintética (sem cliente padrão) a leitura GET
// /api/pep/notas/paciente/:id responde 503, e a tela mostra a mensagem de erro sem inventar formulário, lista nem
// avisos; a faixa de avisos do cabeçalho do prontuário fica oculta (não há alerta a mostrar). Gravar a nota com tipo,
// texto, quem vê e validade, encerrar, cancelar com motivo, mudar a validade (prorrogar, com o teto de 2 anos), o
// vínculo assistencial, a conta sem profissional recusada e os alertas em vigor ficam SEM E2E e são provados no
// contrato de efeito apps/api/src/modulos/pep/notas-paciente-propria.int.spec.ts (MariaDB) e na regra do domínio
// packages/dominio-pep/src/nota-paciente.spec.ts. Sessão real sobre a fonte sintética de dev (paciente SINTÉTICO;
// nada vai à cópia). axe sem violação séria.
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

test.describe('Notas e lembretes do paciente @C1-049 @fase8', () => {
  test.setTimeout(120_000);
  test('atalho do prontuário leva às notas; sem o banco do cliente, a tela mostra o erro e não grava; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.MEDICO');

    // A faixa do cabeçalho e a tela leem as notas pela mesma rota; na fonte sintética, a primeira leitura já é 503.
    const leitura = page.waitForResponse((r) => r.url().includes(`/api/pep/notas/paciente/${PACIENTE}`));
    await page.goto(`/pep/paciente/${PACIENTE}/linha-do-tempo`);
    await expect(page.getByTestId('tela-prontuario-paciente')).toBeVisible();
    // Sem notas em vigor (a leitura responde 503 na fonte sintética), a faixa de avisos do cabeçalho não aparece.
    await expect(page.getByTestId('notas-alerta')).toHaveCount(0);

    await page.getByTestId('atalho-notas').click();
    await expect(page).toHaveURL(new RegExp(`/pep/paciente/${PACIENTE}/notas$`));
    expect((await leitura).status()).toBe(503);

    const tela = page.getByTestId('notas-tela');
    await expect(tela).toBeVisible();
    await expect(tela.getByTestId('mensagem-erro').first()).toBeVisible();
    // Sem os dados do banco do cliente, nada para gravar nem listar: nem formulário, nem avisos, nem notas.
    await expect(page.getByTestId('notas-nova')).toHaveCount(0);
    await expect(page.getByTestId('notas-alertas')).toHaveCount(0);
    await expect(page.locator('article[data-testid^="nota-"]')).toHaveCount(0);
    await expect(page.getByTestId('notas-ok')).toHaveCount(0);

    await semViolacaoAxe(page, '/pep/paciente/:id/notas (sem o banco do cliente)');
    expect(externas).toEqual([]);
  });
});
