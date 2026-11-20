// E2E @M59.4 (ficha do M59, etapa 4, F4 saneamento dos grupos em perfis de função), com axe: da tela de Grupos ao
// saneamento; o painel dos grupos de acesso amplo; a dissolução do grupo sem ativos (retirada das opções com a senha);
// os usuários do grupo com a sugestão pelo uso; a decisão de troca de grupo com o simulador do antes e depois (perde
// opção usada nos últimos 180 dias: exige a aprovação da área); a aprovação por outra pessoa (a da área, com a senha);
// a aplicação com a senha pelo gestor; e a decisão de bloqueio de quem não entra há mais de 180 dias, descartada.
// Sessões reais sobre a fonte sintética; a porta sintética do saneamento (porta-sintetica.ts) e a gestão em memória:
// nada na cópia. Contas sintéticas SINT.SANEAR.GESTOR (decide e aplica), SINT.SANEAR.AREA (aprova) e os alvos
// SINT.SANEAR.ALVO1 e SINT.SANEAR.ALVO2 (grupo MASTER_SEM_FINANCEIRO sintético).
import { expect, test, type Browser, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const ALVO1 = 'SINT.SANEAR.ALVO1';
const ALVO2 = 'SINT.SANEAR.ALVO2';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function novaPagina(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

const semTextoDoOutroSistema = async (page: Page) =>
  expect(page.locator('body')).not.toContainText(/SPDATA|legado|sistema atual/i);

test.describe('Saneamento dos grupos @M59.4 @fase7', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240_000);

  test('painel e dissolução do grupo sem ativos; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.SANEAR.GESTOR');
    await page.goto('/administracao/acesso/grupos');
    await page.getByTestId('grupos-ir-saneamento').click();
    await expect(page).toHaveURL(/\/administracao\/acesso\/grupos\/saneamento/);
    await expect(page.getByTestId('tabela-saneamento-grupos')).toBeVisible();
    await expect(page.getByTestId('saneamento-administradores')).toBeVisible();
    await expect(page.getByTestId('saneamento-grupo-MASTER_SEM_FINANCEIRO')).toBeVisible();
    await semTextoDoOutroSistema(page);
    await semViolacaoAxe(page, '/administracao/acesso/grupos/saneamento (painel, M59.4)');

    // O MASTER nunca se dissolve; o grupo sem ativos, sim (as opções saem em lote, com a senha).
    await expect(page.getByTestId('saneamento-dissolver-MASTER')).toHaveCount(0);
    await page.getByTestId('saneamento-dissolver-MASTER_CONSULTA_FINANCEIRO').click();
    await expect(page.getByTestId('form-saneamento-dissolver')).toBeVisible();
    await semViolacaoAxe(page, 'saneamento: dissolver (M59.4)');
    await page.getByTestId('dissolver-motivo').fill('Grupo sem ninguém ativo: as opções saem (E2E M59.4)');
    await page.getByTestId('dissolver-senha').fill(SENHA);
    await page.getByTestId('dissolver-confirmar').click();
    await expect(page.getByTestId('saneamento-aviso')).toContainText('MASTER_CONSULTA_FINANCEIRO');
    await expect(page.getByTestId('saneamento-grupo-MASTER_CONSULTA_FINANCEIRO')).toContainText('0');
    await expect(page.getByTestId('saneamento-dissolver-MASTER_CONSULTA_FINANCEIRO')).toHaveCount(0);
    expect(externas).toEqual([]);
  });

  test('troca de grupo pelo simulador, aprovação da área e aplicação; bloqueio descartado; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.SANEAR.GESTOR');
    await page.goto('/administracao/acesso/grupos/saneamento');
    await page.getByTestId('saneamento-ver-MASTER_SEM_FINANCEIRO').click();
    await expect(page.getByTestId('tabela-saneamento-usuarios')).toBeVisible();
    // A sugestão pelo uso: o grupo de trabalho que cobre mais opções usadas.
    await expect(page.getByTestId(`saneamento-usuario-${ALVO1}`)).toContainText('ANESTESIA');
    await semViolacaoAxe(page, 'saneamento: usuários do grupo (M59.4)');

    // Decisão com o simulador: a troca para ANESTESIA perde uma opção usada → exige a aprovação da área.
    await page.getByTestId(`saneamento-decidir-${ALVO1}`).click();
    await expect(page.getByTestId('form-saneamento-decidir')).toBeVisible();
    await expect(page.getByTestId('saneamento-simulador')).toBeVisible();
    await expect(page.getByTestId('simulador-exige')).toBeVisible();
    await expect(page.getByTestId('simulador-perdidas')).toBeVisible();
    await semViolacaoAxe(page, 'saneamento: decidir com o simulador (M59.4)');
    await page.getByTestId('decidir-motivo').fill('Perfil de função pela atividade real (E2E M59.4)');
    await page.getByTestId('decidir-confirmar').click();
    await expect(page.getByTestId('saneamento-aviso')).toContainText(ALVO1);
    await expect(
      page.getByTestId(`saneamento-usuario-${ALVO1}`).getByTestId('saneamento-exige'),
    ).toBeVisible();
    // Quem propôs não aplica sem a aprovação: a ação é "aprovar".
    await expect(page.getByTestId(`saneamento-aplicar-${ALVO1}`)).toHaveCount(0);

    // Bloqueio de quem não entra há mais de 180 dias: decidido e depois descartado.
    await page.getByTestId(`saneamento-decidir-${ALVO2}`).click();
    await escolher(page.getByTestId('decidir-tipo'), 'bloquear');
    await page.getByTestId('decidir-motivo').fill('Sem entrar há mais de 180 dias (E2E M59.4)');
    await page.getByTestId('decidir-confirmar').click();
    await expect(page.getByTestId(`saneamento-descartar-${ALVO2}`)).toBeVisible();
    await page.getByTestId(`saneamento-descartar-${ALVO2}`).click();
    await expect(page.getByTestId('saneamento-aviso')).toContainText(ALVO2);
    await expect(page.getByTestId(`saneamento-decidir-${ALVO2}`)).toBeVisible();

    // A aprovação da área: outra pessoa, com o nome da área, o motivo e a senha.
    const area = await novaPagina(browser);
    const externasArea = vigiarExternas(area);
    await entrar(area, 'SINT.SANEAR.AREA');
    await area.goto('/administracao/acesso/grupos/saneamento');
    await area.getByTestId('saneamento-ver-MASTER_SEM_FINANCEIRO').click();
    await area.getByTestId(`saneamento-aprovar-${ALVO1}`).click();
    await expect(area.getByTestId('form-saneamento-alvo')).toBeVisible();
    await semViolacaoAxe(area, 'saneamento: aprovar pela área (M59.4)');
    await area.getByTestId('aprovar-area').fill('Coordenação de enfermagem');
    await area.getByTestId('aprovar-motivo').fill('A escala sai do perfil: vai para a coordenação (E2E)');
    await area.getByTestId('alvo-senha').fill(SENHA);
    await area.getByTestId('alvo-confirmar').click();
    await expect(area.getByTestId('saneamento-aviso')).toContainText(ALVO1);
    expect(externasArea).toEqual([]);

    // A aplicação pelo gestor, com a senha: o usuário sai do grupo de acesso amplo.
    await page.reload();
    await page.getByTestId('saneamento-ver-MASTER_SEM_FINANCEIRO').click();
    await page.getByTestId(`saneamento-aplicar-${ALVO1}`).click();
    await expect(page.getByTestId('form-saneamento-alvo')).toBeVisible();
    await page.getByTestId('alvo-senha').fill(SENHA);
    await page.getByTestId('alvo-confirmar').click();
    await expect(page.getByTestId('saneamento-aviso')).toContainText(ALVO1);
    await expect(page.getByTestId(`saneamento-usuario-${ALVO1}`)).toHaveCount(0);
    await semTextoDoOutroSistema(page);
    await semViolacaoAxe(page, 'saneamento: depois da aplicação (M59.4)');
    expect(externas).toEqual([]);
  });
});
