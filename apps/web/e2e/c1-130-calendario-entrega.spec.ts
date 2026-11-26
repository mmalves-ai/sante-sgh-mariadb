// E2E @C1-130 (06-FAT linha 31): lote e remessa TISS com a fatura ao pagador e o calendário de entrega por convênio.
// O lote protocolado mostra a fatura (número, situação protocolada, contas, valor apresentado, protocolo e entrega); o
// lote sem conta diz que não tem fatura; o painel de prazos mostra, por convênio, a janela de entrega aberta (dias até
// fechar) ou a próxima (dias até abrir) e o pagamento previsto; a escolha da situação do protocolo vem da porta. Sessão
// real sobre a fonte sintética de dev e a porta do pós-fechamento em MEMÓRIA (lotes e contas SINTÉTICOS).
// O cadastro do calendário (CalendarioEntrega, no painel de prazos): incluir a janela do convênio 92 pelo SanteSelecao,
// vê-la na lista e no painel, a sobreposição recusada enquanto se digita, e inativar (some da lista; volta com "inativas").
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

  test('cadastro do calendário: inclui a janela, aparece no painel, recusa a sobreposição na hora e inativa', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.TISS');
    await page.goto('/faturamento/prazos');
    await expect(page.getByTestId('ce-calendario')).toBeVisible();

    // Janela aberta hoje (do dia de hoje a 5 dias à frente), competência do mês corrente.
    const iso = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const hoje = iso(new Date());
    const fim = iso(new Date(Date.now() + 5 * 86_400_000));
    const competencia = hoje.slice(0, 7);
    const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
    const mesBr = `${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`;
    const linhas = page
      .getByTestId('ce-lista')
      .locator('tbody tr')
      .filter({ hasText: 'OPERADORA SINTETICA 2' })
      .filter({ hasText: mesBr });

    // Sobra de execução anterior interrompida: inativa a janela ativa da mesma competência antes de começar.
    await expect(page.getByTestId('ce-lista').or(page.getByTestId('ce-vazio'))).toBeVisible();
    while ((await linhas.locator('[data-testid^="ce-inativar-"]').count()) > 0) {
      await linhas.locator('[data-testid^="ce-inativar-"]').first().click();
      await expect(page.getByTestId('ce-mensagem')).toBeVisible();
    }

    const preencher = async () => {
      await escolher(page.getByTestId('ce-convenio'), '92');
      await page.getByTestId('ce-competencia').fill(competencia);
      await page.getByTestId('ce-inicio').fill(hoje);
      await page.getByTestId('ce-fim').fill(fim);
    };

    // Validação na hora: sem datas o botão fica travado com o motivo.
    await escolher(page.getByTestId('ce-convenio'), '92');
    await expect(page.getByTestId('ce-validacao')).toBeVisible();
    await expect(page.getByTestId('ce-gravar')).toBeDisabled();

    // Inclui a janela.
    await preencher();
    await expect(page.getByTestId('ce-validacao')).toHaveCount(0);
    await page.getByTestId('ce-gravar').click();
    await expect(page.getByTestId('ce-mensagem')).toContainText('Janela de entrega incluída.');
    const linha = linhas.first();
    await expect(linha).toBeVisible();
    await expect(linha).toContainText(`${br(hoje)} — ${br(fim)}`);

    // O painel de prazos do convênio 92 passa a usar a janela cadastrada (aberta, com a competência).
    const painel = page.getByTestId('pz-janela-92');
    await expect(painel).toContainText(/Aberta: fecha em \d+ dia/);
    await expect(painel).toContainText(mesBr);
    await expect(painel).toContainText(br(fim));

    // A mesma competência com entrega que se cruza: recusa enquanto se digita, sem ida ao servidor.
    await preencher();
    const recusa = page.getByTestId('ce-validacao');
    await expect(recusa).toContainText(`Já há uma janela de entrega da competência ${competencia}`);
    await expect(page.getByTestId('ce-gravar')).toBeDisabled();
    await semViolacaoAxe(page, '/faturamento/prazos (cadastro do calendário)');

    // Inativa: some da lista (e a sobreposição deixa de existir); volta só com "mostrar inativas".
    await linha.locator('[data-testid^="ce-inativar-"]').click();
    await expect(page.getByTestId('ce-mensagem')).toContainText('Janela de entrega inativada.');
    await expect(linhas.filter({ hasText: br(fim) })).toHaveCount(0);
    await expect(page.getByTestId('pz-janela-92')).not.toContainText(br(fim));
    await page.getByTestId('ce-inativas').check();
    const inativa = linhas.filter({ hasText: br(fim) }).first();
    await expect(inativa).toBeVisible();
    await expect(inativa).toContainText('Inativa');
    await expect(inativa.locator('[data-testid^="ce-inativar-"]')).toHaveCount(0);

    expect(externas).toEqual([]);
  });
});
