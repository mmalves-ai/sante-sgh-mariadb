// E2E @C2-070 @C1-108 @C3-007 (06-FAT linha 26, 04-INT linha 80, 08-INTG L128 (31)): a elegibilidade e a comunicação
// de internação e alta mostram o estado da troca on-line com a operadora na central de integrações externas (decisão
// 53, entrada operadora-tiss-webservice): o selo "Simulador", o aviso de treino e, como o real depende da definição do
// webservice de cada operadora, o que pedir a ela. O estado vem da API de verdade (a central responde também na fonte
// sintética); só as listas que exigem o banco próprio são simuladas pelo Playwright, com massa SINTÉTICA.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

async function conferirSelo(page: Page): Promise<void> {
  const quadro = page.getByTestId('transporte-tiss');
  await expect(quadro).toBeVisible();
  await expect(quadro.getByTestId('transporte-tiss-selo')).toHaveText('Simulador');
  await expect(quadro.getByTestId('transporte-tiss-simulador')).toContainText('Integrações externas');
  await expect(quadro.getByTestId('transporte-tiss-fornecedor')).toContainText(
    'passe a definição à equipe de desenvolvimento',
  );
  await expect(quadro.getByTestId('transporte-tiss-fornecedor')).toContainText(
    'Manual técnico da integração',
  );
}

test.describe('Troca on-line com a operadora pela central @C2-070 @C1-108 @C3-007 @fase3', () => {
  test.setTimeout(180_000);

  test('elegibilidade: selo do simulador e o que pedir à operadora; axe', async ({ page }) => {
    await page.route('**/api/tiss/elegibilidade/pacientes/**', (rota) =>
      json(rota, { coberturas: [], consultas: [] }),
    );
    await entrar(page, 'SINT.GUICHE');
    await page.goto('/faturamento/elegibilidade?paciente=7402');
    await expect(page.getByTestId('elegibilidade')).toBeVisible();
    await conferirSelo(page);
    await semViolacaoAxe(page, '/faturamento/elegibilidade (estado da central)');
  });

  test('comunicação de internação e alta: o mesmo estado da central; axe', async ({ page }) => {
    await page.route('**/api/internacao/comunicacoes-operadora/internacoes/**', (rota) =>
      json(rota, { itens: [] }),
    );
    await entrar(page, 'SINT.INTERNACAO');
    await page.goto('/internacao/7402/comunicacoes-operadora');
    await expect(page.getByTestId('tela-comunicacao-operadora')).toBeVisible();
    await conferirSelo(page);
    await semViolacaoAxe(page, '/internacao/:reg/comunicacoes-operadora (estado da central)');
  });
});
