// E2E @M28 (ficha, seção 10): nota com dois lotes → saldo e custo lidos; requisição → atendimento parcial;
// transferência em dois passos; saída a paciente internado → o lote no atendimento; devolução → estorno; cotação com
// rateio → aprovação → vencedor; recusa do saldo insuficiente com a mensagem em português; axe sem violação séria em
// cada tela. Sessão real sobre a fonte sintética de dev e a porta do estoque em MEMÓRIA (itens, lotes, pedidos e
// pacientes SINTÉTICOS; nada vai à cópia).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher as escolherNoCombo } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}
const daqui = (dias: number) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const escolher = (page: Page, testid: string, valor: string) =>
  escolherNoCombo(page.getByTestId(testid), valor);
async function incluirItem(page: Page, prefixo: string, codigo: number): Promise<void> {
  await page.getByTestId(`${prefixo}-termo`).fill(String(codigo));
  await page.getByTestId(`${prefixo}-buscar`).click();
  await page.getByTestId(`${prefixo}-opcao-${codigo}`).click();
}

test.describe('Estoque, almoxarifado e compras @M28', () => {
  test.setTimeout(300_000);

  test('nota com dois lotes → saldo e custo; requisição parcial; transferência; saída a internado; devolução; recusa; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ALMOXARIFE');

    // Saldo antes da nota (item rastreável 5003 no almoxarifado central).
    await page.goto('/suprimentos/saldos');
    await expect(page.getByTestId('tela-suprimentos-saldos')).toBeVisible();
    await escolher(page, 'sal-local', '10');
    await expect(page.getByTestId('sal-5003-10')).toContainText('300');
    await semViolacaoAxe(page, '/suprimentos/saldos');

    // Nota fiscal com dois lotes.
    await page.goto('/suprimentos/notas-fiscais');
    await expect(page.getByTestId('tela-suprimentos-notas')).toBeVisible();
    await page.getByTestId('nf-fornecedor').fill('7001');
    await page.getByTestId('nf-numero').fill('88001');
    await escolher(page, 'nf-local', '10');
    await incluirItem(page, 'nf-busca', 5003);
    await page.getByTestId('nf-qtde-5003').fill('20');
    await page.getByTestId('nf-unitario-5003').fill('1,50');
    await page.getByTestId('nf-lote-5003-0').fill('E2E-L1');
    await page.getByTestId('nf-validade-5003-0').fill(daqui(120));
    await page.getByTestId('nf-lote-qtde-5003-0').fill('12');
    await page.getByTestId('nf-mais-lote-5003').click();
    await page.getByTestId('nf-lote-5003-1').fill('E2E-L2');
    await page.getByTestId('nf-validade-5003-1').fill(daqui(240));
    await page.getByTestId('nf-lote-qtde-5003-1').fill('8');
    await semViolacaoAxe(page, '/suprimentos/notas-fiscais');
    await page.getByTestId('nf-gravar').click();
    await expect(page.getByTestId('nf-mensagem')).toContainText('Nota fiscal registrada');

    // Saldo e custo lidos depois da nota: os dois lotes no local.
    await page.goto('/suprimentos/saldos');
    await escolher(page, 'sal-local', '10');
    await expect(page.getByTestId('sal-5003-10')).toContainText('320');
    await expect(page.getByTestId('sal-lote-5003-E2E-L1')).toBeVisible();
    await expect(page.getByTestId('sal-lote-5003-E2E-L2')).toBeVisible();

    // Requisição do setor → atendimento parcial.
    await page.goto('/suprimentos/requisicoes');
    await expect(page.getByTestId('tela-suprimentos-requisicoes')).toBeVisible();
    await escolher(page, 'req-local', '10');
    await escolher(page, 'req-cc', '101');
    await incluirItem(page, 'req-busca', 5001);
    await page.getByTestId('req-qtde-5001').fill('6');
    await page.getByTestId('req-enviar').click();
    await expect(page.getByTestId('req-mensagem')).toContainText('Requisição');
    await semViolacaoAxe(page, '/suprimentos/requisicoes');
    const req = page.locator('[data-testid^="requisicao-"]').last();
    await req.locator('[data-testid^="atender-"]').first().click();
    await page.getByTestId('atender-qtde-1').fill('4');
    await page.getByTestId('atender-confirmar').click();
    await expect(page.getByTestId('req-mensagem')).toContainText(/atendid|Saída/i);

    // Transferência em dois passos: envio da central para a satélite e o recebimento.
    await page.goto('/suprimentos/transferencias');
    await expect(page.getByTestId('tela-suprimentos-transferencias')).toBeVisible();
    await escolher(page, 'tra-origem', '10');
    await escolher(page, 'tra-destino', '20');
    await incluirItem(page, 'tra-itens-busca', 5002);
    await page.getByTestId('tra-itens-qtde-5002').fill('15');
    await page.getByTestId('tra-enviar').click();
    await expect(page.getByTestId('tra-mensagem')).toBeVisible();
    await semViolacaoAxe(page, '/suprimentos/transferencias');
    const envio = page
      .locator('[data-testid^="tra-envio-"]')
      .filter({ has: page.locator('[data-testid^="tra-receber-"]') })
      .last();
    await envio.locator('[data-testid^="tra-receber-"]').click();
    await expect(page.getByTestId('tra-mensagem')).toContainText(/recebida/i);

    // Saída a paciente internado (com conta) do lote que vence primeiro.
    await page.goto('/suprimentos/saidas');
    await expect(page.getByTestId('tela-suprimentos-saidas')).toBeVisible();
    await escolher(page, 'saida-destino', '1');
    await escolher(page, 'saida-local', '10');
    await escolher(page, 'saida-cc', '101');
    await page.getByTestId('saida-atendimento').fill('31337');
    await incluirItem(page, 'saida-itens-busca', 5003);
    await page.getByTestId('saida-itens-qtde-5003').fill('3');
    await page.getByTestId('saida-itens-sugerir-5003').click();
    await semViolacaoAxe(page, '/suprimentos/saidas');
    await page.getByTestId('saida-gravar').click();
    await expect(page.getByTestId('saida-mensagem')).toContainText('Saída registrada');
    // A lista das saídas por local e período (200 por página): a de hoje no local 10 aparece; em outro local, não.
    await escolher(page, 'saidas-filtro-local', '10');
    await page.getByTestId('saidas-filtro-inicio').fill(daqui(0));
    await page.getByTestId('saidas-filtro-inicio').dispatchEvent('change');
    await page.getByTestId('saidas-filtro-fim').fill(daqui(0));
    await page.getByTestId('saidas-filtro-fim').dispatchEvent('change');
    await expect(page.getByTestId('tabela-saidas').locator('tbody tr').first()).toBeVisible();
    await expect(page.getByTestId('saidas-filtro-anterior')).toBeDisabled();
    await escolher(page, 'saidas-filtro-local', '20');
    await expect(page.getByTestId('tabela-saidas')).toHaveCount(0);

    // O lote no atendimento do paciente (o item da conta lido pelo rastreio).
    await page.goto('/suprimentos/lotes/rastreio');
    await page.getByTestId('ras-atendimento').fill('31337');
    await page.getByRole('button', { name: 'Lotes do atendimento' }).click();
    await expect(page.getByTestId('ras-paciente')).toContainText('DIP-A1');
    await semViolacaoAxe(page, '/suprimentos/lotes/rastreio');

    // Devolução da saída → o lote volta e o estorno na conta é avisado.
    const link = page.locator('[data-testid="ras-paciente"] li').last();
    const doc = /(\d+) \((\d{2})\/(\d{4})\)\s*$/.exec((await link.textContent()) ?? '');
    expect(doc).not.toBeNull();
    await page.goto('/suprimentos/devolucoes');
    await page.getByTestId('dev-ano').fill(doc![3]!);
    await page.getByTestId('dev-mes').fill(String(Number(doc![2])));
    await page.getByTestId('dev-doc').fill(doc![1]!);
    await page.getByTestId('dev-abrir').click();
    await expect(page.getByText('o item volta e é estornado da conta')).toBeVisible();
    await page.getByTestId('dev-qtde-5003').fill('1');
    await page.getByTestId('dev-lote-5003-DIP-A1').fill('1');
    await semViolacaoAxe(page, '/suprimentos/devolucoes');
    await page.getByTestId('dev-gravar').click();
    await expect(page.getByTestId('dev-mensagem')).toContainText('Devolução registrada');

    // Recusa: saída maior que o saldo (5006 tem 4 no central), em português e antes de gravar.
    await page.goto('/suprimentos/saidas');
    await escolher(page, 'saida-destino', '2');
    await escolher(page, 'saida-local', '10');
    await escolher(page, 'saida-cc', '101');
    await incluirItem(page, 'saida-itens-busca', 5006);
    await page.getByTestId('saida-itens-qtde-5006').fill('50');
    await page.getByTestId('saida-gravar').click();
    await expect(page.getByTestId('recusa-suprimentos')).toContainText(/saldo/i);

    // As demais telas do almoxarife abrem sem violação séria de acessibilidade.
    for (const [rota, tela] of [
      ['/suprimentos/itens', 'tela-suprimentos-itens'],
      ['/suprimentos/locais', 'tela-suprimentos-locais'],
      ['/suprimentos/movimento-direto', 'tela-suprimentos-movimento'],
      ['/suprimentos/kits', 'tela-suprimentos-kits'],
      ['/suprimentos/inventarios', 'tela-suprimentos-inventarios'],
      ['/suprimentos/consumo', 'tela-suprimentos-consumo'],
      ['/suprimentos/fechamentos', 'tela-suprimentos-fechamentos'],
      ['/suprimentos/recalculos', 'tela-suprimentos-recalculos'],
    ] as const) {
      await page.goto(rota);
      await expect(page.getByTestId(tela)).toBeVisible();
      await semViolacaoAxe(page, rota);
    }
    // O texto das telas não cita o sistema antigo.
    await expect(page.locator('body')).not.toContainText(/SPDATA|legado|sistema atual/i);
    expect(externas).toEqual([]);
  });

  test('cotação com rateio → aprovação por alçada → vencedor; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    const ano = new Date().getFullYear();
    await entrar(page, 'SINT.COMPRADOR');
    await page.goto('/suprimentos/pedidos');
    await expect(page.getByTestId('tela-suprimentos-pedidos')).toBeVisible();
    await semViolacaoAxe(page, '/suprimentos/pedidos');
    await page.getByTestId(`ped-cotacao-${ano}-1`).click();
    await expect(page.getByTestId('tela-suprimentos-cotacao')).toBeVisible();
    // Rateio do item 5001 entre os dois fornecedores (justificativa exigida).
    await page.getByTestId('cot-escolher-5001-7001').check();
    await page.getByTestId('cot-escolher-5001-7002').check();
    await page
      .getByTestId('cot-justificativa-5001')
      .fill('Rateio entre os dois fornecedores por prazo de entrega');
    await semViolacaoAxe(page, `/suprimentos/pedidos/${ano}/1/cotacao`);
    await page.getByTestId('cot-definir-5001').click();
    await expect(page.getByTestId('cot-mensagem')).toContainText('Vencedor definido');
    await expect(page.getByTestId('cot-item-5001')).toContainText('SINT.COMPRADOR');
    await expect(page.getByTestId('cot-item-5001')).toContainText('rateio');
    for (const [rota, tela] of [
      ['/suprimentos/historico-compras', 'tela-suprimentos-historico'],
      ['/suprimentos/sugestao-compra', 'tela-suprimentos-sugestao'],
      ['/suprimentos/fornecedores', 'tela-suprimentos-fornecedores'],
      ['/suprimentos/cotacao', 'tela-suprimentos-pedidos'],
    ] as const) {
      await page.goto(rota);
      await expect(page.getByTestId(tela)).toBeVisible();
      await semViolacaoAxe(page, rota);
    }

    // O supervisor aprova pela alçada.
    await entrar(page, 'SINT.SUPERVISOR.ESTOQUE');
    await page.goto('/suprimentos/aprovacoes');
    await expect(page.getByTestId(`apr-${ano}-1`)).toBeVisible();
    await semViolacaoAxe(page, '/suprimentos/aprovacoes');
    await page.getByTestId('apr-aprovar-1').click();
    await expect(page.getByTestId('apr-mensagem')).toBeVisible();
    // O vencedor e a aprovação no mapa.
    await page.goto(`/suprimentos/pedidos/${ano}/1/cotacao`);
    await expect(page.getByTestId('cot-proposta-7001').first()).toContainText('Sim');
    await expect(page.getByTestId('cot-proposta-7002').first()).toContainText('Sim');
    for (const [rota, tela] of [['/suprimentos/usuarios-locais', 'tela-suprimentos-usuarios']] as const) {
      await page.goto(rota);
      await expect(page.getByTestId(tela)).toBeVisible();
      await semViolacaoAxe(page, rota);
    }
    // Parâmetros e numeração: consulta de quem tem a leitura dos parâmetros (o administrador).
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/suprimentos/parametros');
    await expect(page.getByTestId('tela-suprimentos-parametros')).toBeVisible();
    await semViolacaoAxe(page, '/suprimentos/parametros');
    expect(externas).toEqual([]);
  });
});
