// E2E C3-024 (07-FIN linha 126): SPED contábil com a ECF do lucro real e os signatários do cadastro. Com o SPED ligado,
// o contador abre a geração da ECF, vê o lucro real entre as formas geradas (sem o aviso de forma não gerada), confere
// que os signatários do cadastro da empresa preenchem o formulário quando existem e o aviso de que ficam guardados no
// cadastro. Axe sem violação séria. Sessão e empresa SINTÉTICAS (nenhuma pessoa real).
import { expect, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

test.describe('@C3-024 SPED: ECF do lucro real e signatários do cadastro', () => {
  test('a forma lucro real é gerada e o formulário avisa da guarda dos signatários', async ({ page }) => {
    vigiarExternas(page);
    await page.context().clearCookies();
    await page.goto('/entrar');
    await page.getByTestId('campo-login').fill('contador.sintetico');
    await page.getByTestId('campo-senha').fill(SENHA);
    await page.getByTestId('botao-entrar').click();
    await expect(page).toHaveURL(/\/inicio/);
    await page.goto('/contabil/sped');
    await expect(page.getByTestId('sped-ver-previa')).toBeVisible({ timeout: 30_000 });
    await escolher(page, 'sped-tipo', 'ECF');
    await page.getByTestId('sped-gerar').click();
    await escolher(page, 'sped-forma', '1 Lucro real');
    await expect(page.getByTestId('sped-forma-nao-gerada')).toHaveCount(0);
    await expect(page.getByTestId('sped-guardar-signatarios')).toContainText('cadastro da empresa');
    // Sem cadastro, os dois signatários ficam para digitar; com cadastro, o aviso diz quantos vieram.
    const doCadastro = page.getByTestId('sped-signatarios-cadastro');
    if ((await doCadastro.count()) > 0) await expect(doCadastro).toContainText('cadastro da empresa');
    else await expect(page.getByTestId('sped-signatario-1')).toBeVisible();
    await semViolacaoAxe(page);
  });
});
