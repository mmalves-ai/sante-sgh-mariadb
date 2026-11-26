// E2E @C2-096 (06-FAT linha 33, F3.7): demonstrativos da operadora com conciliação item a item. No lote sintético, o
// faturista digita o demonstrativo de análise (um item com glosa e motivo), importa (casamento item a item) e concilia
// (baixa por item, linhas "baixadas"); depois importa o demonstrativo de PAGAMENTO pelo XML TISS com o número do lote
// e o protocolo reais do lote sintético 8002 ('000000000040', 'P00000000040') e um protocolo de fora: a linha do lote
// casa (lote 8002, situação "Casado", pendente da baixa), a de fora fica sem casamento, e o resumo mostra liberado,
// débitos, créditos e líquido (290 + 10 - 4,35 + 1 = 296,65) e as duas deduções; reimportar o mesmo número não duplica. A
// baixa do recebimento nos títulos é provada no contrato de efeito (demonstrativo-importacao-propria.int.spec). axe
// sem violação séria. Sessão real sobre a fonte sintética de dev; XML e números SINTÉTICOS (nenhuma pessoa real);
// nenhuma saída externa (vigiarExternas).
import { expect, type Page, test } from '@playwright/test';
import { demonstrativoPagamentoSinteticoXml } from '@sgh/dominio-faturamento';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const LOTE = 8002;
// O número do lote e o protocolo do lote sintético 8002 (o pagamento casa por eles, não pelo id).
const NUMERO_LOTE = '000000000040';
const PROTOCOLO = 'P00000000040';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('demonstrativo de análise e de pagamento, conciliação item a item @C2-096', () => {
  test.setTimeout(240_000);

  test('análise digitada e conciliada; pagamento pelo XML com protocolo, débito e crédito; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.TISS');
    const sufixo = Date.now().toString(36).slice(-6).toUpperCase();

    // 1. Demonstrativo de análise digitado num lote do próprio teste (conta 9102 do convênio 91): o item não
    // conciliado do lote 8002 é o do M31, e a porta em memória é uma só na rodada.
    await page.goto('/faturamento/lotes');
    await expect(page.getByTestId('tela-tiss-lotes')).toBeVisible();
    await escolher(page.getByTestId('lot-convenio'), '91');
    await escolher(page.getByTestId('lot-tipo-guia'), '2');
    await page.getByTestId('lot-buscar').click();
    await expect(page.getByTestId('lot-prontas')).toBeVisible();
    const abrir = page.locator('[data-testid^="lot-abrir-"]').first();
    const antes = (await abrir.getAttribute('data-testid')) ?? '';
    await page.getByTestId('lot-marcar-9102').check();
    await page.getByTestId('lot-montar').click();
    await expect(page.getByTestId('lot-mensagem')).toContainText('04.03.00');
    await expect(abrir).not.toHaveAttribute('data-testid', antes);
    const loteAnalise = ((await abrir.getAttribute('data-testid')) ?? '').replace('lot-abrir-', '');
    await page.goto(`/faturamento/demonstrativos?lote=${loteAnalise}`);
    await expect(page.getByTestId('tela-tiss-demonstrativos')).toBeVisible();
    await page.getByTestId('dm-numero').fill(`AN-${sufixo}`);
    const pago = page.locator('[data-testid^="dm-pago-"]').first();
    await pago.fill('10');
    await escolher(page.locator('[data-testid^="dm-motivo-"]').first(), '1705');
    await semViolacaoAxe(page, '/faturamento/demonstrativos');
    await page.getByTestId('dm-importar').click();
    await expect(page.getByTestId('dm-mensagem')).toContainText('casado');
    await expect(page.getByTestId('dm-detalhe')).toBeVisible();
    await page.getByTestId('dm-conciliar').click();
    await expect(page.getByTestId('dm-mensagem')).toContainText('baixado');

    // 2. Demonstrativo de pagamento pelo XML TISS: protocolo do lote, um débito e um crédito.
    const xml = demonstrativoPagamentoSinteticoXml({
      numero: `PG-${sufixo}`,
      dataEmissao: '2026-11-20',
      dataPagamento: '2026-11-25',
      protocolos: [
        { numeroLote: NUMERO_LOTE, protocolo: PROTOCOLO, informado: 300, liberado: 290 },
        { numeroLote: '000000999999', protocolo: 'P-FORA-E2E', informado: 10, liberado: 10 },
      ],
      descontos: [
        { indicador: 1, tipo: '01', descricao: 'IRRF SINTETICO', valor: 4.35 },
        { indicador: 2, tipo: '05', descricao: 'AJUSTE SINTETICO', valor: 1 },
      ],
    });
    await escolher(page.getByTestId('dm-modo'), 'xml');
    await escolher(page.getByTestId('dm-tipo'), 'pagamento');
    // Pelo XML, o número do demonstrativo vem no próprio arquivo (não há campo digitado).
    await page.getByTestId('dm-xml').fill(xml);
    await page.getByTestId('dm-importar').click();
    await expect(page.getByTestId('dm-mensagem')).toContainText(
      '1 item(ns) casado(s) com a conta, 1 sem casamento',
    );
    // A importação abre o pagamento: o resumo com os totais e as deduções.
    await expect(page.getByTestId('dm-pag-resumo')).toBeVisible();
    await expect(page.getByTestId('dm-pag-liberado')).toContainText('300,00');
    await expect(page.getByTestId('dm-pag-debitos')).toContainText('4,35');
    await expect(page.getByTestId('dm-pag-creditos')).toContainText('1,00');
    await expect(page.getByTestId('dm-pag-liquido')).toContainText('296,65');
    await expect(page.getByTestId('dm-pag-situacao')).toContainText('aguarda a baixa');
    await expect(page.getByTestId('dm-pag-deducoes').locator('tbody tr')).toHaveCount(2);
    await expect(page.getByTestId('dm-pag-deducao-1')).toContainText('IRRF SINTETICO');
    // As linhas: a do lote casada com o lote 8002 (pendente da baixa), a de fora sem casamento.
    const linhas = page.getByTestId('dm-detalhe').locator('tbody tr');
    await expect(linhas).toHaveCount(2);
    await expect(linhas.nth(0).locator('[data-testid^="dm-linha-lote-"]')).toHaveText(String(LOTE));
    await expect(linhas.nth(0).locator('[data-testid^="dm-situacao-"]')).toHaveText('Casado');
    await expect(linhas.nth(1).locator('[data-testid^="dm-linha-lote-"]')).toHaveText('—');
    await expect(linhas.nth(1).locator('[data-testid^="dm-situacao-"]')).toHaveText('Sem casamento');
    await expect(page.getByTestId('dm-conciliar')).toHaveCount(0);
    // Na lista do lote, o pagamento aparece com o líquido.
    const linhaPagamento = page
      .getByTestId('dm-lista')
      .locator('tr[data-testid^="dm-pag-"]')
      .filter({ hasText: `PG-${sufixo}` });
    await expect(linhaPagamento).toHaveCount(1);
    await expect(linhaPagamento).toContainText('296,65');
    await linhaPagamento.locator('[data-testid^="dm-ver-pag-"]').click();
    await expect(page.getByTestId('dm-pag-resumo')).toBeVisible();
    await semViolacaoAxe(page, '/faturamento/demonstrativos (pagamento)');

    // 3. Reimportar o mesmo pagamento não duplica.
    await page.getByTestId('dm-importar').click();
    await expect(page.getByTestId('dm-mensagem')).toContainText('já foi importado');

    expect(externas).toEqual([]);
  });
});
