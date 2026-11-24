// E2E @F3.6 (farmácia e suprimentos, 05-SUP linha 7): a regra de integração prescrição × estoque e a grade de horários
// padrão, editadas na tela com a validação na hora e gravadas pelo Executor. Sessão real sobre a fonte sintética de dev
// e a porta da farmácia em MEMÓRIA (centro, local e frequência SINTÉTICOS; nada vai à cópia).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Farmácia e suprimentos @F3.6', () => {
  test.setTimeout(180_000);

  test('parâmetros da integração: regra com validação na hora e grade de horários pelo número de doses; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/farmacia/parametros');
    await expect(page.getByTestId('tela-farmacia-parametros')).toBeVisible();
    await semViolacaoAxe(page, '/farmacia/parametros');

    // Regra: sem escopo nem local, a tela já diz o que falta e não deixa gravar.
    const recusas = page.getByTestId('par-recusas-regra');
    await expect(recusas).toContainText('centro de custo, setor ou unidade');
    await page.getByTestId('par-centro').selectOption({ index: 1 });
    // A exceção por item: o subgrupo filtra pelo grupo e o item pelo subgrupo.
    await page.getByTestId('par-grupo').selectOption({ index: 1 });
    await page.getByTestId('par-subgrupo').selectOption({ index: 1 });
    await page.getByTestId('par-item').selectOption({ index: 1 });
    await page.getByTestId('par-local').selectOption({ index: 1 });
    await page.getByTestId('par-momento').selectOption('antes_do_horario');
    await expect(recusas).toContainText('antecedência');
    await page.getByTestId('par-antecedencia').fill('90');
    await expect(recusas).toHaveCount(0);
    await page.getByTestId('par-gravar-regra').click();
    await expect(page.getByTestId('par-mensagem')).toContainText('Regra de integração gravada');
    await expect(page.locator('[data-testid^="par-regra-"]')).toHaveCount(1);

    // Grade de horários: a frequência de 3 doses por dia recusa 2 horários; com 3, grava.
    await page.getByTestId('par-frequencia').selectOption({ index: 1 });
    await page.getByTestId('par-horarios').fill('06:00, 14:00');
    await expect(page.getByTestId('par-recusas-grade')).toContainText('3 dose(s) por dia');
    await page.getByTestId('par-horarios').fill('06:00, 14:00, 22:00');
    await expect(page.getByTestId('par-recusas-grade')).toHaveCount(0);
    await page.getByTestId('par-gravar-grade').click();
    await expect(page.getByTestId('par-mensagem')).toContainText('Horários padrão gravados');
    await expect(page.getByTestId('par-grades')).toContainText('06:00, 14:00, 22:00');

    // Dias restritos num horário: gravados, mostrados na lista e preservados ao reabrir a grade e gravar de novo.
    await page.getByTestId('par-dia-0600-2').check();
    await page.getByTestId('par-dia-0600-4').check();
    await page.getByTestId('par-gravar-grade').click();
    await expect(page.getByTestId('par-grades')).toContainText('06:00 (Seg, Qua), 14:00, 22:00');
    await page.reload();
    await page.getByTestId('par-editar-grade-1').click();
    await expect(page.getByTestId('par-dia-0600-2')).toBeChecked();
    await expect(page.getByTestId('par-dia-0600-4')).toBeChecked();
    await expect(page.getByTestId('par-dia-1400-2')).not.toBeChecked();
    await page.getByTestId('par-gravar-grade').click();
    await expect(page.getByTestId('par-mensagem')).toContainText('Horários padrão gravados');
    await expect(page.getByTestId('par-grades')).toContainText('06:00 (Seg, Qua), 14:00, 22:00');
    await semViolacaoAxe(page, '/farmacia/parametros');
    expect(externas).toEqual([]);
  });
});
