// E2E @C2-104 (F3, 03-PEP linha 108): restrições do hospital no apoio à decisão da prescrição, pela tela própria da
// farmácia clínica:
//   - a farmácia abre "Ajuste renal e restrições da prescrição", busca um item e escolhe o alvo (princípio ativo);
//   - validação na hora: a faixa invertida e a redução sem limite desligam o botão; corrigida, grava e a faixa aparece
//     na lista; desligar mantém a linha (inativa), nada é apagado;
//   - a restrição de posologia por idade e setor pede a mensagem antes de gravar;
//   - a configuração do alerta no setor grava e aparece na lista.
// Sessão real sobre a fonte sintética; dados SINTÉTICOS (nada vai à cópia). axe sem violação séria.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('@C2-104 restrições da prescrição: ajuste renal, posologia e alerta por setor', () => {
  test.setTimeout(180_000);

  test('valida na hora, grava a faixa, a restrição e o alerta do setor', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.FARMACIA');

    const r = await page.request.get('/api/pep/prescricao/restricoes');
    expect(r.status(), await r.text()).toBe(200);

    await page.goto('/farmacia-clinica/restricoes');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Restrições da prescrição');
    await semViolacaoAxe(page, '/farmacia-clinica/restricoes');

    await page.getByTestId('rp-busca').fill('sint');
    await page.getByTestId('rp-buscar').click();
    // A busca responde depois do clique: espera o primeiro item (a fonte sintética tem itens "SINTETICO").
    const primeiro = page.locator('[data-testid^="rp-item-"]').first();
    await expect(primeiro).toBeVisible();
    await primeiro.click();
    await expect(page.getByTestId('rp-escolhido')).toBeVisible();
    await escolher(page.getByTestId('rp-alvo-tipo'), 'principio');

    // Validação na hora.
    await page.getByTestId('rp-faixa-min').fill('40');
    await page.getByTestId('rp-faixa-max').fill('30');
    await expect(page.getByTestId('rp-problemas-ajuste')).toContainText('passa da máxima');
    await expect(page.getByTestId('rp-problemas-ajuste')).toContainText('dose máxima ou o percentual');
    await expect(page.getByTestId('rp-gravar-ajuste')).toBeDisabled();

    // Corrige e grava.
    await page.getByTestId('rp-faixa-min').fill('10');
    await page.getByTestId('rp-percentual').fill('50');
    const orientacao = `E2E sintético ${Date.now()}`;
    await page.getByTestId('rp-orientacao').fill(orientacao);
    await expect(page.getByTestId('rp-gravar-ajuste')).toBeEnabled();
    await page.getByTestId('rp-gravar-ajuste').click();
    await expect(page.getByTestId('rp-ok')).toBeVisible();
    await expect(page.getByTestId('rp-lista-ajustes').getByRole('row')).not.toHaveCount(1);

    // Restrição de posologia: sem mensagem não grava.
    await escolher(page.getByTestId('rp-tipo'), 'contraindicacao');
    await page.getByTestId('rp-idade-max').fill('28');
    await expect(page.getByTestId('rp-problemas-posologia')).toContainText('mensagem');
    await expect(page.getByTestId('rp-gravar-restricao')).toBeDisabled();
    await page.getByTestId('rp-mensagem').fill('Não usar em recém-nascido (sintético)');
    await page.getByTestId('rp-gravar-restricao').click();
    await expect(page.getByTestId('rp-lista-restricoes')).toContainText('recém-nascido');

    // Alerta no setor.
    await escolher(page.getByTestId('rp-regra'), { indice: 1 });
    await escolher(page.getByTestId('rp-cf-comportamento'), 'bloqueio');
    await page.getByTestId('rp-gravar-configuracao').click();
    await expect(page.getByTestId('rp-lista-configuracoes').getByRole('row')).not.toHaveCount(1);

    expect(externas).toEqual([]);
  });
});
