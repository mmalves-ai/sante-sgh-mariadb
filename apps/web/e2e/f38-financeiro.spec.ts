// F3.8 (financeiro): o adiantamento ponta a ponta, com dois olhos antes de cada saída. Quem lança pede o adiantamento
// (sem saída) e não o aprova; outra pessoa aprova na alçada; uma terceira paga (a saída na conta). A compensação é uma
// baixa: o título não aprovado é recusado e, aprovado por outra pessoa, é compensado (a tela lista só os títulos do mesmo
// credor e sugere o valor). Depois, a devolução do saldo; o título aparece pago e a saída e a entrada aparecem no
// movimento da conta. Axe em cada passo.
import { expect, type Page, test } from '@playwright/test';
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

const linhaCom = (page: Page, tabela: string, texto: string) =>
  page.getByTestId(tabela).locator('tbody tr', { hasText: texto });

test.describe('financeiro: adiantamento @F3.8 @F3.8-04', () => {
  test.setTimeout(300_000);

  test('pedir → aprovar → pagar → compensar só o título aprovado → devolver; título pago e movimento; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const documento = String(600_000 + (Date.now() % 100_000));
    const finalidade = `Viagem técnica ${documento}`;
    const motivo = `Sobra devolvida ${documento}`;

    // Quem lança: o título em aberto do credor 5001 e o pedido do adiantamento de 2.000,00 ao mesmo credor.
    await entrar(page, 'SINT.FIN.LANCA');
    await page.goto('/financeiro/pagar/titulos');
    await page.getByTestId('tp-novo').click();
    // O credor do título achado pelo nome preenche o código.
    await page.getByTestId('tp-novo-credor-nome-busca').fill('SINTETICO A');
    await page.getByTestId('tp-novo-credor-nome-opcao-5001').click();
    await expect(page.getByTestId('tp-novo-credor')).toHaveValue('5001');
    // O nome escolhido e o código são um estado só: trocar o tipo limpa os dois (o código do fornecedor não vira o
    // credor do título de médico), e no médico a busca preenche o credor e o profissional.
    await escolher(page.getByTestId('tp-novo-tipo'), 'M');
    await expect(page.getByTestId('tp-novo-credor')).toHaveValue('');
    await expect(page.getByTestId('tp-novo-credor-nome-escolhido')).toHaveCount(0);
    await page.getByTestId('tp-novo-credor-nome-busca').fill('MEDICO');
    await page.getByTestId('tp-novo-credor-nome-opcao-7001').click();
    await expect(page.getByTestId('tp-novo-credor')).toHaveValue('7001');
    await expect(page.getByTestId('tp-novo-profissional')).toHaveValue('7001');
    // Digitar outro código à mão desfaz a escolha: o nome exibido nunca é de outro código.
    await page.getByTestId('tp-novo-credor').fill('7002');
    await expect(page.getByTestId('tp-novo-credor-nome-escolhido')).toHaveCount(0);
    await escolher(page.getByTestId('tp-novo-tipo'), 'F');
    await expect(page.getByTestId('tp-novo-credor')).toHaveValue('');
    await page.getByTestId('tp-novo-credor-nome-busca').fill('SINTETICO A');
    await page.getByTestId('tp-novo-credor-nome-opcao-5001').click();
    await expect(page.getByTestId('tp-novo-credor')).toHaveValue('5001');
    await expect(page.getByTestId('tp-novo-credor-nome-escolhido')).toContainText('FORNECEDOR SINTETICO A');
    await page.getByTestId('tp-novo-documento').fill(documento);
    await page.getByTestId('tp-novo-valor').fill('1500');
    await page.getByTestId('tp-novo-quantas').fill('1');
    await escolher(page.getByTestId('tp-novo-classificacao'), '216.2.1');
    await page.getByTestId('tp-lancar').click();
    await expect(page.getByTestId('tp-mensagem')).toContainText('lançado');

    await page.goto('/financeiro/pagar/adiantamentos');
    await expect(page.getByTestId('tela-fin-adiantamentos')).toBeVisible();
    await expect(page.getByTestId('ad-conceder')).toBeDisabled();
    // O credor é achado pelo nome (parte dele), não pelo código digitado; sem credor escolhido não há pedido.
    await page.getByTestId('ad-novo-credor-busca').fill('SINTETICO A');
    await page.getByTestId('ad-novo-credor-opcao-5001').click();
    await expect(page.getByTestId('ad-novo-credor-escolhido')).toContainText('FORNECEDOR SINTETICO A');
    await page.getByTestId('ad-novo-valor').fill('2000');
    await page.getByTestId('ad-novo-referente').fill(finalidade);
    await semViolacaoAxe(page, '/financeiro/pagar/adiantamentos (novo)');
    await page.getByTestId('ad-conceder').click();
    await expect(page.getByTestId('ad-mensagem')).toContainText('aguarda a aprovação');
    await expect(linhaCom(page, 'ad-lista', finalidade)).toContainText('Aguardando aprovação');
    await expect(linhaCom(page, 'ad-lista', finalidade)).toContainText('FORNECEDOR SINTETICO A');
    // Quem pediu não aprova (a segregação no servidor).
    await linhaCom(page, 'ad-lista', finalidade).getByRole('button', { name: 'Aprovar' }).click();
    await expect(page.getByTestId('recusa-faturamento')).toContainText('Quem lançou');

    // Outra pessoa aprova o adiantamento na alçada.
    await entrar(page, 'SINT.FIN.APROVA');
    await page.goto('/financeiro/pagar/adiantamentos');
    await linhaCom(page, 'ad-lista', finalidade).getByRole('button', { name: 'Aprovar' }).click();
    await expect(page.getByTestId('ad-mensagem')).toContainText('aprovado na alçada');
    await expect(linhaCom(page, 'ad-lista', finalidade)).toContainText('Aprovado, a pagar');
    await semViolacaoAxe(page, '/financeiro/pagar/adiantamentos (aprovado)');

    // Um terceiro paga (a saída) e tenta compensar no título ainda não aprovado: recusado.
    await entrar(page, 'SINT.FIN.PAGA');
    await page.goto('/financeiro/pagar/adiantamentos');
    await linhaCom(page, 'ad-lista', finalidade).getByRole('button', { name: 'Pagar' }).click();
    await expect(page.getByTestId('ad-mensagem')).toContainText('Adiantamento pago');
    const linha = linhaCom(page, 'ad-lista', finalidade);
    await expect(linha).toContainText('2.000,00');
    await linha.getByRole('button', { name: 'Compensar' }).click();
    const titulo = page.getByTestId('ad-titulos').locator('li', { hasText: `${documento}/1` });
    await expect(titulo).toContainText('1.500,00');
    await titulo.getByRole('button').click();
    await expect(page.getByTestId('recusa-faturamento')).toContainText('aprovação');

    // Outra pessoa aprova o título; aí o terceiro compensa: o valor sugerido é o saldo do título (1.500,00); sobra 500,00.
    await entrar(page, 'SINT.FIN.APROVA');
    await page.goto('/financeiro/pagar/aprovacao');
    await linhaCom(page, 'ap-lista', `${documento}/1`).getByRole('button').click();
    await expect(linhaCom(page, 'ap-lista', `${documento}/1`)).toContainText('1 / 1');

    await entrar(page, 'SINT.FIN.PAGA');
    await page.goto('/financeiro/pagar/adiantamentos');
    await linhaCom(page, 'ad-lista', finalidade).getByRole('button', { name: 'Compensar' }).click();
    await semViolacaoAxe(page, '/financeiro/pagar/adiantamentos (compensar)');
    await page
      .getByTestId('ad-titulos')
      .locator('li', { hasText: `${documento}/1` })
      .getByRole('button')
      .click();
    await expect(page.getByTestId('ad-mensagem')).toContainText('compensado');
    await expect(linhaCom(page, 'ad-lista', finalidade)).toContainText('500,00');

    // O painel segue aberto: a devolução do saldo pede o motivo e encerra o adiantamento.
    await expect(page.getByTestId('ad-devolver')).toBeDisabled();
    await page.getByTestId('ad-dev-valor').fill('500');
    await page.getByTestId('ad-dev-motivo').fill(motivo);
    await page.getByTestId('ad-devolver').click();
    await expect(page.getByTestId('ad-mensagem')).toContainText('Devolução');
    await expect(linhaCom(page, 'ad-lista', finalidade)).toContainText('Encerrado');
    await semViolacaoAxe(page, '/financeiro/pagar/adiantamentos (encerrado)');

    // O título aparece pago, e a saída e a entrada aparecem no movimento da conta.
    await page.goto('/financeiro/pagar/titulos');
    await escolher(page.getByTestId('tp-situacao'), 'pago');
    await page.getByTestId('tp-consultar').click();
    await expect(page.getByTestId('tp-lista')).toContainText(documento);
    await page.goto('/financeiro/tesouraria/movimento');
    await expect(page.getByTestId('mv-lista')).toContainText(finalidade);
    await expect(page.getByTestId('mv-lista')).toContainText(motivo);
    expect(externas).toEqual([]);
  });
});
