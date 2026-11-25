// F3.8 (07-FIN linha 63): a baixa do título a pagar com valor informado. Quem lança grava o título, outra pessoa aprova
// e um terceiro paga: ao marcar o título, os valores da baixa abrem na própria linha; o valor acima do saldo avisa na
// hora e prende o botão; o valor menor com desconto mostra quanto liquida e quanto fica em aberto; pago, o título
// continua na lista com o saldo; a segunda baixa, em branco, quita e ele sai da lista. Axe em cada passo. Porta do
// financeiro em MEMÓRIA sobre a fonte sintética (nada vai a banco nem a banco de pagamento).
import { expect, type Locator, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const linhaCom = (page: Page, tabela: string, texto: string): Locator =>
  page.getByTestId(tabela).locator('tbody tr', { hasText: texto }).first();

test.describe('financeiro: baixa parcial com desconto e acréscimos @F3.8 @F3.8-01', () => {
  test.setTimeout(180_000);

  test('valor acima do saldo trava na hora; parcial deixa saldo na lista; a segunda baixa quita; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const documento = String(700_000 + (Date.now() % 100_000));
    await entrar(page, 'SINT.FIN.LANCA');
    await page.goto('/financeiro/pagar/titulos');
    await page.getByTestId('tp-novo').click();
    await page.getByTestId('tp-novo-credor').fill('5001');
    await page.getByTestId('tp-novo-documento').fill(documento);
    await page.getByTestId('tp-novo-valor').fill('1000');
    await page.getByTestId('tp-novo-quantas').fill('1');
    await escolher(page.getByTestId('tp-novo-classificacao'), '216.2.1');
    await page.getByTestId('tp-lancar').click();
    await expect(page.getByTestId('tp-mensagem')).toContainText('lançado');

    await entrar(page, 'SINT.FIN.APROVA');
    await page.goto('/financeiro/pagar/aprovacao');
    await linhaCom(page, 'ap-lista', `${documento}/1`).getByRole('button').click();
    await expect(linhaCom(page, 'ap-lista', `${documento}/1`)).toContainText('1 / 1');

    await entrar(page, 'SINT.FIN.PAGA');
    await page.goto('/financeiro/pagar/borderos');
    await expect(page.getByTestId('tela-fin-borderos')).toBeVisible();
    const linha = linhaCom(page, 'bd-aprovados', `${documento}/1`);
    await expect(linha).toContainText('1.000,00');
    const marcar = linha.locator('input[type="checkbox"]');
    const id = ((await marcar.getAttribute('id')) ?? '').replace('bd-marcar-', '');
    expect(id).toMatch(/^\d+$/);
    await marcar.check();
    await escolher(page.getByTestId('bd-conta'), '1');
    // Em branco, a prévia diz que quita.
    await expect(page.getByTestId(`bd-previa-${id}`)).toContainText('quitada');

    // Acima do saldo: aviso na hora e botão preso.
    await page.getByTestId(`bd-valorPago-${id}`).fill('1000.01');
    await expect(page.getByTestId(`bd-aviso-${id}`)).toContainText('saldo');
    await expect(page.getByTestId('bd-pagar')).toBeDisabled();
    await semViolacaoAxe(page, '/financeiro/pagar/borderos (baixa travada)');

    // 400 pagos com 30 de desconto e 10 de juros: liquida 420 e ficam 580 em aberto.
    await page.getByTestId(`bd-valorPago-${id}`).fill('400');
    await page.getByTestId(`bd-desconto-${id}`).fill('30');
    await page.getByTestId(`bd-juros-${id}`).fill('10');
    const previa = page.getByTestId(`bd-previa-${id}`);
    await expect(previa).toContainText('420,00');
    await expect(previa).toContainText('580,00');
    await page.getByTestId('bd-por-bordero').uncheck();
    await expect(page.getByTestId('bd-pagar')).toBeEnabled();
    await page.getByTestId('bd-pagar').click();
    await expect(page.getByTestId('bd-mensagem')).toBeVisible();

    // O título continua a pagar, com o saldo que sobrou; a ficha mostra "Pago em parte".
    await expect(page.getByTestId(`bd-saldo-${id}`)).toContainText('580,00');
    await semViolacaoAxe(page, '/financeiro/pagar/borderos (pago em parte)');
    await page.goto(`/financeiro/pagar/titulos/${id}`);
    await expect(page.getByTestId('tpd-parcelas')).toContainText('Pago em parte');
    await expect(page.getByTestId('tpd-parcelas')).toContainText('580,00');

    // A segunda baixa, em branco, quita o saldo: o título sai da lista dos que faltam pagar.
    await page.goto('/financeiro/pagar/borderos');
    await linhaCom(page, 'bd-aprovados', `${documento}/1`).locator('input[type="checkbox"]').check();
    await escolher(page.getByTestId('bd-conta'), '1');
    await expect(page.getByTestId(`bd-previa-${id}`)).toContainText('580,00');
    await page.getByTestId('bd-por-bordero').uncheck();
    await page.getByTestId('bd-pagar').click();
    await expect(page.getByTestId('bd-mensagem')).toBeVisible();
    await expect(page.getByTestId(`bd-marcar-${id}`)).toHaveCount(0);
    await page.goto(`/financeiro/pagar/titulos/${id}`);
    await expect(page.getByTestId('tpd-parcelas')).toContainText('Pago');
    await expect(page.getByTestId('tpd-parcelas')).not.toContainText('Pago em parte');
    expect(externas).toEqual([]);
  });
});
