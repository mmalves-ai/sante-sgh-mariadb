// E2E @C1-049 (03-PEP L102): notas e lembretes livres sobre o paciente. O médico abre "Notas e lembretes" do paciente
// (atalho do prontuário), escreve uma nota com validade de 7 dias visível à equipe (o botão só libera com tipo e
// texto; o contador mostra o que resta), vê a nota em vigor na lista, cancela a própria nota (o botão só libera com o
// motivo de 5 caracteres) e a reencontra como cancelada, com o motivo, ao mostrar também as encerradas e canceladas.
// Uma segunda nota é marcada como cumprida e sai da lista em vigor. Pré-condição da base do E2E: ao menos um tipo de
// nota ativo (cadastro genérico do prontuário). Sessão real sobre a fonte sintética de dev (paciente SINTÉTICO; nada
// vai à cópia). axe sem violação séria.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 1001;

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function escrever(page: Page, texto: string): Promise<void> {
  const form = page.getByTestId('notas-nova');
  await escolher(form.getByTestId('notas-tipo'), { indice: 0 });
  const botao = form.getByTestId('notas-registrar');
  await expect(botao).toBeDisabled();
  await form.getByTestId('notas-texto').fill(texto);
  await expect(form.getByText(`${4000 - texto.length} caracteres restantes`)).toBeVisible();
  await escolher(form.getByTestId('notas-validade'), 'd7');
  await expect(botao).toBeEnabled();
  await botao.click();
  await expect(page.getByTestId('notas-ok')).toBeVisible();
}

const cartao = (page: Page, texto: string) =>
  page.locator('article[data-testid^="nota-"]').filter({ hasText: texto }).first();

test.describe('Notas e lembretes do paciente @C1-049 @fase8', () => {
  test.setTimeout(120_000);
  test('escreve com validade, cancela com motivo e marca o lembrete como cumprido', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.MEDICO');
    const marca = Date.now().toString(36).slice(-5).toUpperCase();
    const errada = `Lembrete sintético ${marca}: confirmar jejum`;
    const cumprir = `Lembrete sintético ${marca}: ligar para a família`;

    await page.goto(`/pep/paciente/${PACIENTE}/notas`);
    await expect(page.getByTestId('notas-tela')).toBeVisible();
    await semViolacaoAxe(page, 'notas do paciente');

    await escrever(page, errada);
    const nota = cartao(page, errada);
    await expect(nota).toBeVisible();
    await expect(nota).toContainText('Em vigor');
    await expect(nota).toContainText('vale até');

    const cancelar = nota.locator('[data-testid^="nota-cancelar-"]');
    await expect(cancelar).toBeDisabled();
    await nota.locator('[data-testid^="nota-motivo-"]').fill('err');
    await expect(cancelar).toBeDisabled();
    await nota.locator('[data-testid^="nota-motivo-"]').fill('Nota escrita no paciente errado');
    await expect(cancelar).toBeEnabled();
    await cancelar.click();
    await expect(page.getByTestId('notas-ok')).toBeVisible();
    await expect(cartao(page, errada)).toHaveCount(0);
    await page.getByTestId('notas-todas').check();
    const cancelada = cartao(page, errada);
    await expect(cancelada).toContainText('Cancelada');
    await expect(cancelada).toContainText('Nota escrita no paciente errado');
    await page.getByTestId('notas-todas').uncheck();

    await escrever(page, cumprir);
    const lembrete = cartao(page, cumprir);
    await lembrete.locator('[data-testid^="nota-encerrar-"]').click();
    await expect(page.getByTestId('notas-ok')).toBeVisible();
    await expect(cartao(page, cumprir)).toHaveCount(0);
    await page.getByTestId('notas-todas').check();
    await expect(cartao(page, cumprir)).toContainText('Encerrada');

    await semViolacaoAxe(page, 'notas do paciente: depois dos passos');
    expect(externas).toEqual([]);
  });
});
