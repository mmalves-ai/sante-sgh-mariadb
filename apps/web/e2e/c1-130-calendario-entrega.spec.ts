// E2E @C1-130 (06-FAT linha 31): lote e remessa TISS com a fatura ao pagador e o calendário de entrega por convênio.
// O lote protocolado mostra a fatura (número, situação protocolada, contas, valor apresentado, protocolo e entrega); o
// lote sem conta diz que não tem fatura; o painel de prazos mostra, por convênio, a janela de entrega aberta (dias até
// fechar) ou a próxima (dias até abrir) e o pagamento previsto; a escolha da situação do protocolo vem da porta. Sessão
// real sobre a fonte sintética de dev e a porta do pós-fechamento em MEMÓRIA (lotes e contas SINTÉTICOS).
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

test.describe('Lote TISS: fatura ao pagador e calendário de entrega @C1-130', () => {
  test.setTimeout(120_000);

  test('fatura no lote protocolado, lote sem fatura, janela de entrega nos prazos e situações do protocolo', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.TISS');

    // Lote protocolado com conta: a fatura ao convênio aparece com o protocolo.
    await page.goto('/faturamento/lotes/8002');
    await expect(page.getByTestId('tela-tiss-lote')).toBeVisible();
    const fatura = page.getByTestId('lt-fatura');
    await expect(fatura).toBeVisible();
    await expect(fatura).toContainText('P00000000040');
    await expect(page.getByTestId('lt-sem-fatura')).toHaveCount(0);
    await semViolacaoAxe(page, '/faturamento/lotes/:id (fatura)');

    // Lote sem conta: sem fatura.
    await page.goto('/faturamento/lotes/8001');
    await expect(page.getByTestId('tela-tiss-lote')).toBeVisible();
    await expect(page.getByTestId('lt-sem-fatura')).toBeVisible();

    // A escolha da situação do protocolo vem da porta (as situações do padrão TISS).
    await page.goto('/faturamento/lotes/8001/protocolo');
    await expect(page.getByTestId('tela-tiss-protocolo')).toBeVisible();
    await expect(page.getByTestId('pr-situacao')).toBeVisible();

    // Prazos: a janela de entrega do convênio 91 (aberta ou a próxima) com os dias e o pagamento previsto.
    await page.goto('/faturamento/prazos');
    await expect(page.getByTestId('pz-lista')).toBeVisible();
    const janela = page.getByTestId('pz-janela-91');
    await expect(janela).toBeVisible();
    await expect(janela).toContainText(/Aberta: fecha em \d+ dia|Abre em \d+ dia/);
    await expect(janela).toContainText('competência');
    await expect(page.getByTestId('pz-91')).toContainText(/\d{2}\/\d{2}\/\d{4}/);
    await semViolacaoAxe(page, '/faturamento/prazos (calendário)');

    expect(externas).toEqual([]);
  });
});
