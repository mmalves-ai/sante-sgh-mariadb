// E2E @C1-018 (08-INTG L141; ficha F78-08): a catraca com o crachá do colaborador. O supervisor da portaria liga o
// crachá à matrícula sintética SINT-0001 (setor UTI SINTETICA), passa no simulador e a passagem é negada sem regra;
// grava uma regra de dia inteiro, todos os dias, para o setor do colaborador e a passagem é liberada; desativa a regra
// (nunca apagada) e a passagem volta a ser negada. A validação da regra roda na hora (sem dia marcado, o gravar trava).
// Sessão real sobre a fonte sintética e a porta em MEMÓRIA (dados SINTÉTICOS).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const CRACHA = 'COLSINT0018';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function passar(page: Page): Promise<void> {
  await escolher(page.getByTestId('tm-sim-terminal'), { rotulo: 'CATRACA SINTETICA PRINCIPAL' });
  await page.getByTestId('tm-sim-cracha').fill(CRACHA);
  await escolher(page.getByTestId('tm-sim-sentido'), { rotulo: 'Entrada' });
  await page.getByTestId('tm-sim-passar').click();
}

test.describe('Catraca com o crachá do colaborador @C1-018 @F8', () => {
  test.setTimeout(180_000);

  test('crachá ligado à matrícula → sem regra negado → regra do setor liberado → regra desativada negado; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.PORTARIA.SUP');
    await page.goto('/portaria/terminais');
    await expect(page.getByTestId('tela-terminais')).toBeVisible();

    // O crachá do colaborador: o código inválido trava o botão na hora.
    await page.getByTestId('tm-cracha-matricula').fill('SINT-0001');
    await page.getByTestId('tm-cracha-codigo').fill('ab');
    await expect(page.getByTestId('tm-cracha-ligar')).toBeDisabled();
    await page.getByTestId('tm-cracha-codigo').fill(CRACHA);
    await page.getByTestId('tm-cracha-ligar').click();
    await expect(page.getByTestId('tm-mensagem')).toBeVisible();

    // Sem regra de acesso no terminal: negado com o motivo.
    await passar(page);
    await expect(page.getByTestId('tm-sim-resultado')).toContainText('sem regra de acesso');

    // A regra do setor UTI SINTETICA, todos os dias, o dia inteiro, entrada e saída.
    const form = page.getByTestId('tm-regra-form');
    await escolher(page.getByTestId('tm-regra-terminal'), { rotulo: 'CATRACA SINTETICA PRINCIPAL' });
    await escolher(page.getByTestId('tm-regra-setor'), { rotulo: 'UTI SINTETICA' });
    for (const d of [2, 3, 4, 5, 6]) await form.getByTestId(`tm-regra-dia-${d}`).uncheck();
    await expect(page.getByTestId('tm-regra-problemas')).toContainText('Marque ao menos um dia');
    await expect(page.getByTestId('tm-regra-gravar')).toBeDisabled();
    for (const d of [1, 2, 3, 4, 5, 6, 7]) await form.getByTestId(`tm-regra-dia-${d}`).check();
    await page.getByTestId('tm-regra-inicio').fill('00:00');
    await page.getByTestId('tm-regra-fim').fill('23:59');
    await expect(page.getByTestId('tm-regra-problemas')).toHaveCount(0);
    await page.getByTestId('tm-regra-gravar').click();
    const regras = page.getByTestId('tm-regras');
    await expect(regras).toContainText('UTI SINTETICA');
    await semViolacaoAxe(page, '/portaria/terminais');

    await passar(page);
    await expect(page.getByTestId('tm-sim-resultado')).toHaveText('Liberado');

    // Desativada (nunca apagada): a regra fica na grade e a passagem volta a ser negada.
    await regras.getByRole('button', { name: 'Desativar' }).first().click();
    await expect(regras.getByRole('button', { name: 'Reativar' }).first()).toBeVisible();
    await expect(regras).toContainText('UTI SINTETICA');
    await passar(page);
    await expect(page.getByTestId('tm-sim-resultado')).toContainText('Negado');
    await expect(page.getByTestId('tm-eventos')).toContainText(CRACHA);

    expect(externas).toEqual([]);
  });
});
