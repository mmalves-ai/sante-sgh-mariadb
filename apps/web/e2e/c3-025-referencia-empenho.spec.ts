// E2E @C3-025 (07-FIN linha 132): só a referência do empenho no pedido de compra e no título a pagar, com o arquivo para
// o ente (a execução orçamentária fica no sistema contábil do ente). A autoridade entra pelo menu (Suprimentos > Compras >
// Ata de registro de preços e empenho), escolhe um empenho em vigor no painel da referência, vê o resumo (empenhado,
// referido, saldo), refere o empenho num pedido e num título do mesmo credor quando há candidatos (a busca é remota) e
// baixa o CSV do período com o cabeçalho para o ente. axe sem violação séria. Precisa de um empenho emitido no cliente
// do E2E (o fluxo @C2-030 emite um); sem ele, o teste é pulado com o motivo dito. Massa SINTÉTICA, nenhum dado de pessoa.
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

test.describe('@C3-025 referência do empenho no pedido e no título', () => {
  test('refere o empenho em vigor no pedido e no título do credor e baixa o arquivo para o ente', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.AUTORIDADE');
    await page.getByRole('link', { name: 'Ata de registro de preços e empenho' }).first().click();
    await expect(page).toHaveURL(/\/suprimentos\/atas-registro-preco/);
    const painel = page.getByTestId('ref-empenho');
    await expect(painel).toBeVisible();

    const empenhos = (await (await page.request.get('/api/suprimentos/empenhos')).json()) as {
      id: number;
      numero: string;
      situacao: string;
    }[];
    const emp = empenhos.find((e) => e.situacao === 'emitido' || e.situacao === 'parcial');
    test.skip(!emp, 'Sem empenho em vigor no cliente do E2E.');

    await escolher(painel.getByTestId('ref-empenho-escolha'), { rotulo: new RegExp(emp!.numero) });
    await expect(painel.getByTestId('ref-resumo')).toContainText('saldo');
    await semViolacaoAxe(page, '/suprimentos/atas-registro-preco');

    const cand = (await (
      await page.request.get(`/api/suprimentos/empenhos/${emp!.id}/candidatos?termo=`)
    ).json()) as {
      pedidos: { rotulo: string }[];
      titulos: { rotulo: string }[];
    };
    if (cand.pedidos[0]) {
      await escolher(painel.getByTestId('ref-pedido'), {
        rotulo: new RegExp(cand.pedidos[0].rotulo.split(' ')[0]!),
      });
      await painel.getByTestId('ref-referir-pedido').click();
      await expect(painel.getByTestId('ref-mensagem')).toContainText(emp!.numero);
      await expect(painel.getByTestId('ref-pedidos')).toContainText(cand.pedidos[0].rotulo.split(' ')[0]!);
    }
    if (cand.titulos[0]) {
      await escolher(painel.getByTestId('ref-titulo'), {
        rotulo: new RegExp(cand.titulos[0].rotulo.split(' ')[0]!),
      });
      await painel.getByTestId('ref-referir-titulo').click();
      await expect(painel.getByTestId('ref-mensagem')).toContainText(emp!.numero);
    }

    // O arquivo para o ente: cabeçalho fixo e o empenho do período.
    await painel.getByTestId('ref-inicio').fill('2000-01-01');
    const href = await painel.getByTestId('ref-baixar').getAttribute('href');
    const csv = await (await page.request.get(href!)).text();
    expect(csv.split('\r\n')[0]).toBe(
      'empenho;emitido_em;fonte_recurso;natureza_despesa;valor_empenho;credor_documento;credor_nome;pedido;titulo;documento;emissao_documento;valor_titulo;situacao_titulo',
    );
    expect(csv).toContain(`${emp!.numero};`);
    expect(externas).toEqual([]);
  });
});
