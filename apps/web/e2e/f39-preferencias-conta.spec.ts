// E2E @F39-3 (01-ADM L84, ficha F3.9): as preferências seguem a conta. O médico troca o tema para escuro e escolhe a
// tela inicial na tela de preferências (cada escolha grava na hora, sem botão); sai e entra de novo no mesmo navegador
// e cai na tela inicial escolhida, com o tema escuro; num navegador limpo (outro computador: nada guardado no
// navegador), entra e vê as duas aplicadas. O que fica no banco é provado no contrato de efeito
// operacoes-preferencias-propria.int.spec.ts. Sessão real sobre a fonte sintética de dev; nenhum dado real.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, rotulosDoCombo } from './combos.js';

const SENHA = 'Sintetico#2026';
const LOGIN = 'SINT.MEDICO';

async function entrar(page: Page): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(LOGIN);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
}

const situacao = (page: Page) => page.getByTestId('pref-situacao');

test.describe('Preferências seguem a conta @F39-3 @fase3', () => {
  test.setTimeout(180_000);
  test('tema escuro e tela inicial gravados na conta; sair e entrar (e navegador limpo) aplicam os dois; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page);
    await expect(page).toHaveURL(/\/inicio/);
    await page.goto('/preferencias');
    await expect(situacao(page)).toContainText('Guardado na sua conta');
    await page.getByRole('radio', { name: 'Escuro' }).check();
    await expect(situacao(page)).toContainText('Guardado na sua conta');
    const campo = page.getByTestId('pref-tela-inicial');
    const rotulos = await rotulosDoCombo(campo);
    // A primeira opção é "a do perfil"; escolhe a primeira tela do menu do cargo.
    expect(rotulos.length).toBeGreaterThan(1);
    await escolher(campo, { indice: 1 });
    await expect(situacao(page)).toContainText('Guardado na sua conta');
    const lidas = (await page.evaluate(async () => {
      const r = await fetch('/api/acesso/preferencias/minhas', { headers: { accept: 'application/json' } });
      return (await r.json()) as {
        geral: { tema: string };
        telaInicial: { rota: string; titulo: string } | null;
      };
    })) as { geral: { tema: string }; telaInicial: { rota: string; titulo: string } | null };
    expect(lidas.geral.tema).toBe('escuro');
    expect(lidas.telaInicial?.titulo).toBe(rotulos[1]);
    const rota = lidas.telaInicial!.rota;
    expect(rota).not.toBe('/inicio');
    await semViolacaoAxe(page, '/preferencias (tema escuro)');

    // Sai e entra de novo no mesmo navegador: abre a tela inicial escolhida, com o tema escuro.
    await page.getByTestId('sair').click();
    await expect(page).toHaveURL(/\/entrar/);
    await entrar(page);
    await expect(page).toHaveURL(new RegExp(`${rota.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    await expect(page.locator('html')).toHaveClass(/modo-escuro/);

    // Navegador limpo (outro computador): a conta é a fonte.
    const limpo = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    try {
      const outra = await limpo.newPage();
      await entrar(outra);
      await expect(outra).toHaveURL(new RegExp(`${rota.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
      await expect(outra.locator('html')).toHaveClass(/modo-escuro/);
    } finally {
      await limpo.close();
    }
    expect(externas).toEqual([]);
  });
});
