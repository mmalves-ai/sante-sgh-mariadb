// F3.8 (07-FIN linha 89): a tela do cartão de débito e crédito. Chega-se por um clique a partir do fluxo de caixa; na
// aba das taxas a taxa digitada é conferida a cada tecla pela regra do domínio (percentual em branco ou faixa de
// parcelas fora do limite prende o botão e diz o motivo), a venda de exemplo mostra na hora a taxa, o líquido e o
// primeiro crédito, e fora do crédito a faixa de parcelas some (débito é parcela única). No caixa, o recebimento em
// cartão de crédito: com administradora cadastrada o botão de receber fica preso e diz o motivo até a bandeira ser
// escolhida; a prévia do crédito (líquido, taxa e parcelas) aparece na hora e o recebimento vai com a administradora, a
// bandeira e as parcelas. A fonte do E2E é a sintética, sem banco (as opções e a prévia do cartão respondem pela regra
// do domínio): a gravação (taxa com vigência, transação e parcelas a receber ligadas ao recebimento, fluxo de caixa
// projetado e baixa do crédito) é provada nos contratos de efeito cartao.int.spec.ts e porta-propria.int.spec.ts do
// faturamento.
// Axe nos passos.
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

test.describe('financeiro: cartão de débito e crédito @F3.8-07', () => {
  test.setTimeout(180_000);

  test('atalho do fluxo de caixa; taxa conferida a cada tecla e venda de exemplo na hora; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.FIN.LANCA');
    await page.goto('/financeiro/tesouraria/fluxo-caixa');
    await page.getByTestId('fc-cartao').click();
    await expect(page).toHaveURL(/\/financeiro\/receber\/cartao/);
    await expect(page.getByTestId('tela-fin-cartao')).toBeVisible();
    await expect(page.getByTestId('ct-aba-receber')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('ct-de')).not.toHaveValue('');
    await semViolacaoAxe(page, '/financeiro/receber/cartao (a receber)');

    await page.getByTestId('ct-aba-taxas').click();
    await expect(page.getByTestId('ct-aba-taxas')).toHaveAttribute('aria-pressed', 'true');
    // Percentual em branco: o motivo aparece na hora e o botão fica preso.
    await expect(page.getByTestId('ct-recusa-taxa')).toContainText('percentual');
    await expect(page.getByTestId('ct-gravar-taxa')).toBeDisabled();
    // Crédito de 1 a 3 parcelas a 2,5%: a venda de exemplo de R$ 1.000,00 mostra a taxa, o líquido e o prazo.
    await page.getByTestId('ct-percentual').fill('2,5');
    await page.getByTestId('ct-parcela-final').fill('3');
    await expect(page.getByTestId('ct-recusa-taxa')).toHaveCount(0);
    const simulacao = page.getByTestId('ct-simulacao');
    await expect(simulacao).toContainText('em 3x');
    await expect(simulacao).toContainText('25,00');
    await expect(simulacao).toContainText('975,00');
    await expect(simulacao).toContainText('30 dia(s)');
    // Outro valor de exemplo: a conta refaz na hora.
    await page.getByTestId('ct-exemplo').fill('200');
    await expect(simulacao).toContainText('195,00');
    // Faixa de parcelas fora do limite: recusada antes de enviar.
    await page.getByTestId('ct-parcela-final').fill('30');
    await expect(page.getByTestId('ct-recusa-taxa')).toContainText('faixa de parcelas');
    await expect(page.getByTestId('ct-gravar-taxa')).toBeDisabled();
    // Percentual de 100: recusado.
    await page.getByTestId('ct-parcela-final').fill('3');
    await page.getByTestId('ct-percentual').fill('100');
    await expect(page.getByTestId('ct-recusa-taxa')).toContainText('menos de 100');
    await page.getByTestId('ct-percentual').fill('1,2');
    // Débito é parcela única: a faixa some e a venda de exemplo vira 1x.
    await escolher(page.getByTestId('ct-modalidade'), 'debito');
    await expect(page.getByTestId('ct-parcela-inicial')).toHaveCount(0);
    await expect(page.getByTestId('ct-parcela-final')).toHaveCount(0);
    await expect(simulacao).toContainText('em 1x');
    // Taxa em valor fixo por venda.
    await escolher(page.getByTestId('ct-tipo'), 'valor');
    await expect(page.getByTestId('ct-recusa-taxa')).toContainText('valor fixo');
    await page.getByTestId('ct-valor').fill('0,50');
    await expect(simulacao).toContainText('0,50');
    await expect(simulacao).toContainText('199,50');
    // Sem administradora escolhida a taxa não é gravada.
    await expect(page.getByTestId('ct-gravar-taxa')).toBeDisabled();
    // Administradora nova: o nome curto prende o botão.
    await page.getByTestId('ct-adm-nome').fill('A');
    await expect(page.getByTestId('ct-gravar-administradora')).toBeDisabled();
    await page.getByTestId('ct-adm-nome').fill('Administradora Sintética');
    await expect(page.getByTestId('ct-gravar-administradora')).toBeEnabled();
    await semViolacaoAxe(page, '/financeiro/receber/cartao (taxas)');
    expect(externas).toEqual([]);
  });

  test('caixa: recebimento em cartão de crédito com administradora, bandeira, parcelas e prévia; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.CAIXA');
    await page.goto('/faturamento/particular/orcamentos');
    await expect(page.getByTestId('tela-faturamento-orcamentos')).toBeVisible();
    await page.getByTestId('orc-nome').fill('PACIENTE SINTETICO CARTAO');
    await page.getByTestId('orc-desc-0').fill('Consulta sintética no cartão');
    await page.getByTestId('orc-unit-0').fill('200');
    await page.getByTestId('orc-gravar').click();
    await expect(page.getByTestId('orc-mensagem')).toContainText('registrado');

    await page.goto('/faturamento/particular/caixa');
    await expect(page.getByTestId('tela-faturamento-caixa')).toBeVisible();
    // O caixa do operador pode já estar aberto (outro teste do mesmo operador): abre só se preciso.
    await expect(page.getByTestId('cx-aberto').or(page.getByTestId('cx-abrir'))).toBeVisible();
    if (await page.getByTestId('cx-abrir').isVisible()) await page.getByTestId('cx-abrir').click();
    await expect(page.getByTestId('cx-aberto')).toBeVisible();
    await escolher(page.getByTestId('cx-orc'), { rotulo: /PACIENTE SINTETICO CARTAO/ });
    await page.getByTestId('cx-valor').fill('200');
    // Fora do cartão o bloco não existe.
    await expect(page.getByTestId('cx-cartao-administradora')).toHaveCount(0);
    await escolher(page.getByTestId('cx-forma'), 'cartao-credito');
    // A única administradora já vem escolhida; com mais de uma bandeira de crédito, falta a bandeira: o botão fica
    // preso e a tela diz o motivo.
    await expect(page.getByTestId('cx-cartao-administradora')).toBeVisible();
    await expect(page.getByTestId('cx-cartao-pendencia')).toContainText('administradora e a bandeira');
    await expect(page.getByTestId('cx-receber')).toBeDisabled();
    await expect(page.getByTestId('cx-cartao-previa')).toHaveCount(0);
    await escolher(page.getByTestId('cx-cartao-bandeira'), '1');
    await expect(page.getByTestId('cx-cartao-pendencia')).toHaveCount(0);
    await expect(page.getByTestId('cx-receber')).toBeEnabled();
    // À vista: 2% de taxa. Em 2x: 3%, duas parcelas, e a prévia refaz na hora.
    const previa = page.getByTestId('cx-cartao-previa');
    await expect(previa).toContainText('196,00');
    await escolher(page.getByTestId('cx-cartao-parcelas'), '2');
    await expect(previa).toContainText('194,00');
    await expect(previa).toContainText('6,00');
    await expect(previa).toContainText('2 parcela(s)');
    await semViolacaoAxe(page, '/faturamento/particular/caixa (cartão)');
    await page.getByTestId('cx-comprovante').fill('NSU-E2E-0001');
    const pedido = page.waitForRequest(
      (q) => q.method() === 'POST' && (q.postData() ?? '').includes('"cartao"'),
    );
    await page.getByTestId('cx-receber').click();
    const corpo = (await pedido).postDataJSON() as {
      pagamentos: { forma: string; valor: number; parcelas: number; comprovante: string; cartao: unknown }[];
    };
    expect(corpo.pagamentos).toHaveLength(1);
    expect(corpo.pagamentos[0]).toMatchObject({
      forma: 'cartao-credito',
      valor: 200,
      parcelas: 2,
      comprovante: 'NSU-E2E-0001',
      cartao: { administradora: 1, bandeira: 1 },
    });
    await expect(page.getByTestId('cx-mensagem')).toContainText('Pagamento recebido');
    await expect(page.getByTestId('cx-pagamentos')).toContainText('Cartão');
    // Débito: parcela única (o combo de parcelas some) e só as bandeiras de débito.
    await escolher(page.getByTestId('cx-forma'), 'cartao-debito');
    await expect(page.getByTestId('cx-cartao-parcelas')).toHaveCount(0);
    await expect(page.getByTestId('cx-receber')).toBeDisabled();
    expect(externas).toEqual([]);
  });
});
