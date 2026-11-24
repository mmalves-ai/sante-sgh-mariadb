// F3.8 (07-FIN linha 63): prorrogar o vencimento da parcela a pagar na própria ficha do título. Quem lança grava o
// título; na ficha, a data para trás e o motivo que exige justificativa travam o botão na hora (com o aviso); a
// prorrogação válida muda o vencimento da parcela e entra no histórico com o motivo, a data anterior e a nova. Axe em
// cada passo. Porta do financeiro em MEMÓRIA sobre a fonte sintética (nada vai a banco nem a banco de pagamento).
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

/** dd/mm/aaaa → aaaa-mm-dd somado de `dias`. */
function somar(br: string, dias: number): { iso: string; br: string } {
  const [d, m, a] = br.split('/').map(Number);
  const x = new Date(Date.UTC(a!, m! - 1, d! + dias));
  const iso = x.toISOString().slice(0, 10);
  return { iso, br: iso.split('-').reverse().join('/') };
}

test.describe('financeiro: prorrogação do vencimento @F3.8', () => {
  test.setTimeout(180_000);

  test('data para trás e justificativa travam na hora; prorroga e o histórico guarda o anterior; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const documento = String(600_000 + (Date.now() % 100_000));
    await entrar(page, 'SINT.FIN.LANCA');
    await page.goto('/financeiro/pagar/titulos');
    await page.getByTestId('tp-novo').click();
    await page.getByTestId('tp-novo-credor').fill('5001');
    await page.getByTestId('tp-novo-documento').fill(documento);
    await page.getByTestId('tp-novo-valor').fill('900');
    await page.getByTestId('tp-novo-quantas').fill('1');
    await escolher(page.getByTestId('tp-novo-classificacao'), '216.2.1');
    await page.getByTestId('tp-lancar').click();
    await expect(page.getByTestId('tp-mensagem')).toContainText('lançado');

    await page
      .getByTestId('tp-lista')
      .locator('tbody tr', { hasText: documento })
      .getByRole('link')
      .first()
      .click();
    await expect(page.getByTestId('tela-fin-titulo-pagar')).toBeVisible();
    await expect(page.getByTestId('tpd-prorrogar')).toBeVisible();
    await expect(page.getByTestId('tpd-prorrogacoes')).toContainText('Nenhuma prorrogação');
    const atual = (
      (await page.getByTestId('tpd-parcelas').locator('tbody tr td').nth(1).textContent()) ?? ''
    ).trim();
    expect(atual).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    const nova = somar(atual, 10);

    // Data igual à atual: aviso na hora e botão preso.
    await page.getByTestId('tpd-prorrogar-vencimento').fill(somar(atual, 0).iso);
    await escolher(page.getByTestId('tpd-prorrogar-motivo'), '1');
    await expect(page.getByTestId('tpd-prorrogar-aviso')).toBeVisible();
    await expect(page.getByTestId('tpd-prorrogar-botao')).toBeDisabled();
    // Motivo que exige justificativa sem ela: também preso.
    await page.getByTestId('tpd-prorrogar-vencimento').fill(nova.iso);
    await escolher(page.getByTestId('tpd-prorrogar-motivo'), '2');
    await expect(page.getByTestId('tpd-prorrogar-aviso')).toContainText('justificativa');
    await expect(page.getByTestId('tpd-prorrogar-botao')).toBeDisabled();
    await semViolacaoAxe(page, '/financeiro/pagar/titulos/:id (prorrogação travada)');

    await page.getByTestId('tpd-prorrogar-justificativa').fill('Nota fiscal reemitida pelo credor');
    await expect(page.getByTestId('tpd-prorrogar-botao')).toBeEnabled();
    await page.getByTestId('tpd-prorrogar-botao').click();
    await expect(page.getByTestId('tpd-mensagem')).toBeVisible();
    await expect(page.getByTestId('tpd-parcelas')).toContainText(nova.br);
    const historico = page.getByTestId('tpd-prorrogacoes');
    await expect(historico).toContainText(`${atual} → ${nova.br}`);
    await expect(historico).toContainText('Outro motivo');
    await semViolacaoAxe(page, '/financeiro/pagar/titulos/:id (prorrogado)');
    expect(externas).toEqual([]);
  });
});
