// E2E @C2-003 (F3.3, 03-PEP linha 115): limites de alerta e aferição detalhada dos sinais vitais. A coordenação de
// enfermagem (com conselho) aplica o padrão do adulto (NEWS2) e inclui um limite por setor na tela de limites (a
// ordem das faixas é conferida na hora, sem pedido ao servidor); depois, a enfermeira do plantão, na tela de sinais
// vitais do paciente sintético, registra a
// aferição detalhada com instrumento, local e posição, mais um parâmetro não aferido com o motivo, e confere o nível
// do alerta em texto na lista das recentes. Fonte sintética; combos por e2e/combos.ts; axe nas duas telas.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 25001;

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Limites de alerta e aferição detalhada dos sinais vitais @C2-003 @fase3', () => {
  test('NEWS2, limite por setor, aferição com detalhe e não aferido com motivo; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    // Os limites são da coordenação de enfermagem (perfil com conselho: enfermagem.limiteSinal.editar).
    await entrar(page, 'SINT.COORD.ENF');

    // Tela de limites: padrão NEWS2 num clique.
    await page.goto('/enfermagem/limites-sinais');
    const tela = page.getByTestId('tela-limites-sinais');
    await expect(
      tela.getByRole('heading', { level: 1, name: 'Limites de alerta dos sinais vitais' }),
    ).toBeVisible();
    await expect(tela).not.toContainText(/SPDATA|legado|sistema atual/i);
    await page.getByTestId('ls-news2').click();
    await expect(page.getByTestId('ls-feito')).toBeVisible();
    await expect(page.getByTestId('ls-ativos')).toBeVisible();

    // Faixas fora de ordem: a tela avisa na hora e não grava.
    let gravacoes = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/enfermagem/limites-sinais')
        gravacoes++;
    });
    await escolher(page.getByTestId('ls-parametro'), { indice: 0 });
    await escolher(page.getByTestId('ls-setor'), { indice: 1 });
    await page.getByTestId('ls-normal-inferior').fill('100');
    await page.getByTestId('ls-normal-superior').fill('60');
    await expect(page.getByTestId('ls-problema')).toContainText('em ordem');
    await expect(page.getByTestId('ls-incluir')).toBeDisabled();
    expect(gravacoes).toBe(0);

    // Limite válido do setor: entra na lista dos ativos.
    await page.getByTestId('ls-limite-inferior').fill('40');
    await page.getByTestId('ls-normal-inferior').fill('50');
    await page.getByTestId('ls-normal-superior').fill('100');
    await page.getByTestId('ls-limite-superior').fill('130');
    await expect(page.getByTestId('ls-problema')).toHaveCount(0);
    await semViolacaoAxe(page, '/enfermagem/limites-sinais');
    await page.getByTestId('ls-incluir').click();
    await expect(page.getByTestId('ls-feito')).toBeVisible();
    await expect(page.getByTestId('ls-ativos')).toContainText('130');

    // Sinais vitais do paciente: aferição detalhada, pela enfermeira do plantão.
    await page.context().clearCookies();
    await entrar(page, 'SINT.ENF.PLANTAO');
    await page.goto(`/enfermagem/paciente/${PACIENTE}/sinais-vitais`);
    const painel = page.getByTestId('sd-painel');
    await expect(painel.getByRole('heading', { name: 'Aferição detalhada' })).toBeVisible();
    const parametros = painel.locator('fieldset[data-testid^="sd-param-"]');
    await expect(parametros.first()).toBeVisible();
    const primeiro = (await parametros.nth(0).getAttribute('data-testid'))!.replace('sd-param-', '');
    const segundo = (await parametros.nth(1).getAttribute('data-testid'))!.replace('sd-param-', '');

    // Primeiro parâmetro com valor, instrumento e, quando o cadastro mostra, local e posição.
    await page.getByTestId(`sd-valor-${primeiro}`).fill('80');
    await escolher(page.getByTestId(`sd-instrumento-${primeiro}`), { indice: 1 });
    if (await page.getByTestId(`sd-local-${primeiro}`).count())
      await escolher(page.getByTestId(`sd-local-${primeiro}`), { indice: 1 });
    if (await page.getByTestId(`sd-posicao-${primeiro}`).count())
      await escolher(page.getByTestId(`sd-posicao-${primeiro}`), { indice: 1 });

    // Segundo parâmetro não aferido: sem o motivo, a conferência do domínio avisa na hora e o botão fica preso.
    await page.getByTestId(`sd-nao-${segundo}`).check();
    await expect(page.getByTestId(`sd-erros-${segundo}`)).toContainText('motivo');
    await expect(page.getByTestId('sd-registrar')).toBeDisabled();
    await escolher(page.getByTestId(`sd-motivo-${segundo}`), { indice: 1 });
    if (await page.getByTestId(`sd-complemento-${segundo}`).count())
      await page.getByTestId(`sd-complemento-${segundo}`).fill('Paciente em procedimento');
    await expect(page.getByTestId(`sd-erros-${segundo}`)).toHaveCount(0);
    if (await page.getByTestId('sd-confirmar').count()) await page.getByTestId('sd-confirmar').check();
    await semViolacaoAxe(page, '/enfermagem/paciente/sinais-vitais (aferição detalhada)');
    await page.getByTestId('sd-registrar').click();
    if (await page.getByTestId('sd-confirmar').count()) {
      // O servidor pediu a confirmação pelo limite do setor: confirma e grava de novo.
      await page.getByTestId('sd-confirmar').check();
      await page.getByTestId('sd-registrar').click();
    }
    await expect(page.getByTestId('sd-feito')).toBeVisible();

    // Recentes: o nível em texto e o não aferido com o motivo.
    const recentes = page.getByTestId('sd-recentes');
    await expect(recentes).toBeVisible();
    await expect(recentes.locator('td[data-testid^="sd-nivel-"]').first()).toHaveText(
      /Normal|Atenção|Crítico/,
    );
    await expect(recentes).toContainText('Não aferido');
    expect(externas).toEqual([]);
  });
});
