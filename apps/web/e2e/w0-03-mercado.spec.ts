// E2E @W0-03 (mercado do pacote; enfermagem): as escalas novas pela tela dos escores e a profilaxia de TEV como
// pendência visível ao prescritor:
//   - a enfermagem registra a Padua do paciente clínico pela tela (o perfil escolhido, o total calculado na prévia);
//   - a pendência aparece no cartão do paciente e na lista da unidade;
//   - o prescritor abre o paciente na mesma tela, decide "não prescrita" com o motivo no diálogo, e a pendência sai;
//   - a escala pediátrica (FLACC) registra com a conduta e se estorna com o motivo (inativa e tachada).
// axe sem violação séria. Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
// Paciente sintético da enfermaria só deste spec (os outros usam os da UTI).
const P4 = { atendimento: 25104, paciente: 25004 };

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** Responde todos os itens da escala aberta: o "Sim" nos códigos dados e a primeira opção nos demais. */
async function responder(page: Page, codigos: Record<string, string>): Promise<void> {
  const itens = page.locator('[data-testid^="es-item-"]');
  const n = await itens.count();
  for (let i = 0; i < n; i++) {
    const item = itens.nth(i);
    const codigo = (await item.getAttribute('data-testid'))!.replace('es-item-', '');
    await escolher(item, { rotulo: codigos[codigo] ?? 'Não (0)' });
  }
}

test.describe('Mercado da enfermagem @W0-03 @crud', () => {
  test.setTimeout(300_000);

  test('Padua pela tela vira pendência de profilaxia; o prescritor decide com o motivo', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ENF.PLANTAO');
    await page.goto(`/enfermagem/escores?atendimento=${P4.atendimento}`);
    await expect(page.getByTestId('es-paciente')).toBeVisible();
    await escolher(page.getByTestId('es-escala-escolher'), { rotulo: 'Padua (risco de TEV, clínico)' });
    await expect(page.getByTestId('es-escala-perfil-tev')).toBeVisible();
    await responder(page, { cancer: 'Sim (3)', idade70: 'Sim (1)' });
    await expect(page.getByTestId('es-esc-previa')).toContainText('4');
    await expect(page.getByTestId('es-esc-previa')).toContainText('Risco alto');
    await semViolacaoAxe(page, '/enfermagem/escores (Padua)');
    await page.getByTestId('es-esc-registrar').click();
    await expect(page.getByTestId('es-conduta')).toContainText('profilaxia');
    await expect(page.getByTestId('es-tev-paciente')).toBeVisible();
    await expect(page.getByTestId('es-tev-pendente')).toBeVisible();
    // A enfermagem não decide: o botão é do prescritor.
    await expect(page.getByTestId('es-tev-decidir-paciente')).toHaveCount(0);

    // A lista da unidade mostra a pendência a quem abre a unidade.
    await page.getByTestId('es-voltar').click();
    await escolher(page.getByTestId('enf-unidade'), 'ENF1');
    await expect(page.getByTestId('es-tev-pendentes')).toContainText('Padua 4');

    // O prescritor abre o paciente: a pendência está no cartão, com o botão de decidir.
    await entrar(page, 'SINT.MEDICO');
    await page.goto(`/enfermagem/escores?atendimento=${P4.atendimento}`);
    await expect(page.getByTestId('es-tev-pendente')).toBeVisible();
    await page.getByTestId('es-tev-decidir-paciente').click();
    await expect(page.getByTestId('es-tev-dialogo')).toBeVisible();
    await escolher(page.getByTestId('es-tev-decisao-escolher'), {
      rotulo: 'Não prescrita (informe o motivo)',
    });
    await page.getByTestId('es-tev-motivo').fill('curto');
    await expect(page.getByTestId('es-tev-confirmar')).toBeDisabled();
    await page.getByTestId('es-tev-motivo').fill('Plaquetopenia com risco alto de sangramento');
    await semViolacaoAxe(page, '/enfermagem/escores (profilaxia)');
    await page.getByTestId('es-tev-confirmar').click();
    await expect(page.getByTestId('es-mensagem')).toContainText('não prescrita');
    await expect(page.getByTestId('es-tev-decisao')).toContainText('SINT.MEDICO');
    await expect(page.getByTestId('es-tev-pendente')).toHaveCount(0);
    // Revisão W0-03: o autor corrige a decisão (fato novo com a justificativa); anulada, a pendência volta.
    await page.getByTestId('es-tev-corrigir').click();
    await expect(page.getByTestId('es-tev-dialogo-corrigir')).toBeVisible();
    await page.getByTestId('es-tev-justificativa').fill('Decisão registrada no paciente errado');
    await page.getByTestId('es-tev-correcao-confirmar').click();
    await expect(page.getByTestId('es-mensagem')).toContainText('anulada');
    await expect(page.getByTestId('es-tev-pendente')).toBeVisible();
    await expect(page.getByTestId('es-tev-historico')).toContainText('SINT.MEDICO');
    // Revisão W0-03: a pendência reaberta aparece na tela própria de quem prescreve (rota só com a permissão de
    // prescrever), que decide ali mesmo; o atalho da tela dos escores leva até ela.
    await page.getByTestId('es-voltar').click();
    await page.getByTestId('es-atalho-profilaxia').click();
    await expect(page).toHaveURL(/\/enfermagem\/escores\/profilaxia$/);
    await escolher(page.getByTestId('enf-unidade'), 'ENF1');
    const item = page.locator('[data-testid^="pt-tev-"]').filter({ hasText: 'Padua 4' });
    await expect(item).toHaveCount(1);
    await semViolacaoAxe(page, '/enfermagem/escores/profilaxia');
    await item.locator('[data-testid^="pt-tev-decidir-"]').click();
    await expect(page.getByTestId('pt-dialogo')).toBeVisible();
    await page.getByTestId('pt-confirmar').click();
    await expect(page.getByTestId('pt-mensagem')).toContainText('prescrita');
    await expect(page.locator('[data-testid^="pt-tev-"]').filter({ hasText: 'Padua 4' })).toHaveCount(0);
    expect(externas).toEqual([]);
  });

  test('FLACC registrada com a conduta e estornada com o motivo (inativa e tachada)', async ({ page }) => {
    await entrar(page, 'SINT.ENF.PLANTAO');
    await page.goto(`/enfermagem/escores?atendimento=${P4.atendimento}`);
    await escolher(page.getByTestId('es-escala-escolher'), { rotulo: 'FLACC (dor na criança)' });
    const itens = page.locator('[data-testid^="es-item-"]');
    await expect(itens).toHaveCount(5);
    for (let i = 0; i < 5; i++) await escolher(itens.nth(i), { indice: i < 2 ? 3 : 1 });
    await expect(page.getByTestId('es-esc-previa')).toContainText('Dor moderada');
    await page.getByTestId('es-esc-registrar').click();
    await expect(page.getByTestId('es-conduta')).toContainText('analgesia');
    const linha = page
      .locator('[data-testid^="es-hist-"][data-inativo="nao"]')
      .filter({ hasText: 'FLACC' })
      .first();
    const id = (await linha.getAttribute('data-testid'))!.replace('es-hist-', '');
    await page.getByTestId(`es-estornar-${id}`).click();
    await expect(page.getByTestId('es-dialogo-estorno')).toBeVisible();
    await page.getByTestId('es-dialogo-estorno-motivo').fill('Escala aplicada no paciente errado');
    await page.getByTestId('es-dialogo-estorno-confirmar').click();
    await expect(page.getByTestId(`es-hist-${id}`)).toHaveAttribute('data-inativo', 'sim');
    await expect(page.getByTestId(`es-hist-estorno-${id}`)).toContainText('paciente errado');
  });
});
