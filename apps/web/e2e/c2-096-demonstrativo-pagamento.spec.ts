// E2E @C2-096 (06-FAT linha 33, F3.7): demonstrativos da operadora com conciliação item a item. No lote sintético, o
// faturista digita o demonstrativo de análise (um item com glosa e motivo), importa (casamento item a item) e concilia
// (baixa por item, linhas "baixadas"); depois importa o demonstrativo de PAGAMENTO pelo XML TISS (protocolo do lote,
// débito e crédito), que entra na mesma lista como pagamento e abre as linhas por protocolo, sem o botão de baixa (a
// baixa é pelo de análise); reimportar o mesmo número não duplica. axe sem violação séria. Sessão real sobre a fonte
// sintética de dev; XML e números SINTÉTICOS (nenhuma pessoa real); nenhuma saída externa (vigiarExternas).
import { expect, type Page, test } from '@playwright/test';
import { demonstrativoPagamentoSinteticoXml } from '@sgh/dominio-faturamento';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const LOTE = 8002;

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

    // 1. Demonstrativo de análise digitado: um item pago em parte, com o motivo da glosa.
    await page.goto(`/faturamento/demonstrativos?lote=${LOTE}`);
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
      protocolos: [{ numeroLote: String(LOTE), protocolo: 'PROT-E2E', informado: 300, liberado: 290 }],
      descontos: [
        { indicador: 1, tipo: '01', descricao: 'IRRF SINTETICO', valor: 4.35 },
        { indicador: 2, tipo: '05', descricao: 'AJUSTE SINTETICO', valor: 1 },
      ],
    });
    await escolher(page.getByTestId('dm-modo'), 'xml');
    await escolher(page.getByTestId('dm-tipo'), 'pagamento');
    await page.getByTestId('dm-numero').fill(`PG-${sufixo}`);
    await page.getByTestId('dm-xml').fill(xml);
    await page.getByTestId('dm-importar').click();
    await expect(page.getByTestId('dm-mensagem')).toContainText('Demonstrativo importado');
    const linhaPagamento = page.locator('[data-testid^="dm-pag-"]').first();
    await expect(linhaPagamento).toBeVisible();
    await linhaPagamento.locator('[data-testid^="dm-ver-pag-"]').click();
    await expect(page.getByTestId('dm-detalhe')).toBeVisible();
    await expect(page.getByTestId('dm-conciliar')).toHaveCount(0);
    await semViolacaoAxe(page, '/faturamento/demonstrativos (pagamento)');

    // 3. Reimportar o mesmo pagamento não duplica.
    await page.getByTestId('dm-importar').click();
    await expect(page.getByTestId('dm-mensagem')).toContainText('já foi importado');

    expect(externas).toEqual([]);
  });
});
