// C1-089 (F3.4, 04-CC linha 91): o cadastro do procedimento cirúrgico (grupo, porte, especialidade, natureza, caráter e
// anestesia sugeridos, duração e exigências do agendamento). A validação roda na hora pela mesma regra do domínio que a
// API aplica: o botão de salvar só libera com código, descrição, porte e especialidade corretos. Quem mantém as tabelas
// do bloco (SINT.BLOCO: Tabelas › Salas, cirurgia.sala.ler e .editar) chega à tela; os combos são SanteSelecao (nenhum
// <select> nativo). Axe em cada passo.
// O E2E roda sem banco próprio (fonte sintética): as rotas existem e respondem 503 (não 404) na lista e nas opções, a
// tela mostra o erro e nada é inventado. O que fica no banco é provado pelo contrato de efeito
// (apps/api/src/modulos/cirurgia/procedimento-cirurgico-propria.int.spec.ts).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { esperarSemSelectNativo } from './combos.js';

const SENHA = 'Sintetico#2026';
const API = '/api/cirurgia/procedimentos-cirurgicos';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('centro cirúrgico: cadastro do procedimento cirúrgico @C1-089 @F34', () => {
  test.setTimeout(180_000);

  test('validação na hora (código, descrição, porte, especialidade, duração, marcações); rotas registradas; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.BLOCO');
    const lista = page.waitForResponse((r) => r.url().includes(API) && !r.url().includes('/apoio'));
    const apoio = page.waitForResponse((r) => r.url().includes(`${API}/apoio`));
    await page.goto('/cirurgia/procedimentos-cirurgicos');
    const tela = page.getByTestId('tela-procedimentos-cirurgicos');
    await expect(tela).toBeVisible();
    await expect(page.getByText('Sem permissão')).toHaveCount(0);
    // Sem banco próprio neste ambiente: a rota existe (503, não 404) e a tela mostra o erro.
    expect((await lista).status()).toBe(503);
    expect((await apoio).status()).toBe(503);
    await esperarSemSelectNativo(tela);
    await expect(page.getByTestId('procedimento-natureza')).toBeVisible();
    await expect(page.getByTestId('procedimento-porte')).toBeVisible();
    await expect(page.getByTestId('procedimento-especialidade')).toBeVisible();
    await expect(page.getByTestId('procedimento-carater')).toBeVisible();

    const salvar = page.getByTestId('procedimento-salvar');
    const problemas = page.getByTestId('procedimento-problemas');
    await expect(problemas).toContainText('código');
    await expect(salvar).toBeDisabled();

    await page.getByTestId('procedimento-codigo').fill('CC 001');
    await expect(problemas).toContainText('sem espaços');
    await page.getByTestId('procedimento-codigo').fill('cc-001');
    await page.getByTestId('procedimento-descricao').fill('ab');
    await expect(problemas).toContainText('pelo menos 3');
    await page.getByTestId('procedimento-descricao').fill('Colecistectomia por vídeo');
    await expect(problemas).not.toContainText('código');
    await expect(problemas).not.toContainText('descrição');
    // Porte e especialidade são exigidos (sem opções aqui: o apoio veio 503).
    await expect(problemas).toContainText('porte');
    await expect(problemas).toContainText('especialidade');
    await expect(salvar).toBeDisabled();

    await page.getByTestId('procedimento-duracao').fill('1500');
    await expect(problemas).toContainText('1 a 1440');
    await page.getByTestId('procedimento-duracao').fill('90');
    await expect(problemas).not.toContainText('1 a 1440');
    await page.getByTestId('procedimento-obstetrico').check();
    await page.getByTestId('procedimento-hemodinamica').check();
    await expect(problemas).toContainText('obstétrico e de hemodinâmica');
    await page.getByTestId('procedimento-hemodinamica').uncheck();
    await expect(problemas).not.toContainText('hemodinâmica');
    await expect(salvar).toBeDisabled();
    await semViolacaoAxe(page, '/cirurgia/procedimentos-cirurgicos (cadastro em edição)');
    expect(externas).toEqual([]);
  });

  test('sem a permissão das tabelas do bloco, a tela não abre', async ({ page }) => {
    await entrar(page, 'SINT.RECEPCAO');
    await page.goto('/cirurgia/procedimentos-cirurgicos');
    await expect(page.getByTestId('tela-procedimentos-cirurgicos')).toHaveCount(0);
  });
});
