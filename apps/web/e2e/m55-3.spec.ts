// E2E @M55.3 (ficha do M55, seção 10, na parte da etapa 3): contrato → aditivo → pedido vinculado → saldo. O comprador
// abre a tela pelo menu (Suprimentos > Compras > Contratos com fornecedores), cadastra o contrato (fornecedor, objeto,
// vigência, valor, reajuste, garantia, gestor e fiscal), registra o termo aditivo de valor, liga um pedido do
// fornecedor e o título da nota desse pedido (com o pedido de origem: não abate de novo) e confere o saldo com as
// parcelas impressas (regra 6: valor + aditivos − pedidos); registra a avaliação
// do fornecedor com a prévia (regra 8). O termo aditivo é da alçada de compras (Autorização dos pedidos), que lê e adita
// mas não cadastra (nem a tela, nem a API). axe sem violação séria em cada tela.
// Sessão real sobre a fonte sintética de dev e a porta dos contratos em MEMÓRIA (fornecedores, pedidos e títulos
// SINTÉTICOS); nenhum dado de pessoa.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
/** A chave de idempotência da tentativa recusada (a alçada não cadastra). */
const CHAVE_RECUSA = ['e2e', 'm553', 'recusa'].join('-');

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

function dia(deslocamento: number): string {
  const d = new Date();
  d.setDate(d.getDate() + deslocamento);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function abrirContrato(page: Page, numero: string): Promise<void> {
  await page.goto('/suprimentos/contratos');
  await page.getByTestId('ctr-f-termo').fill(numero);
  await page.getByTestId('ctr-f-aplicar').click();
  await page.getByRole('button', { name: `Abrir o contrato ${numero}` }).click();
  await expect(page.getByTestId('ctr-det-painel')).toBeVisible();
}

async function escolherUsuario(page: Page, campo: string, login: string): Promise<void> {
  await page.getByTestId(`${campo}-termo`).fill(login);
  await page.getByTestId(`${campo}-buscar`).click();
  await escolher(page.getByTestId(campo), login);
}

test.describe('@M55.3 Contratos com fornecedores', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  test('a alçada de compras lê a lista e não cadastra contrato (nem a tela, nem a API)', async ({ page }) => {
    await entrar(page, 'SINT.GERCOMPRAS');
    expect((await page.request.get('/api/suprimentos/contratos')).status()).toBe(200);
    const recusa = await page.request.post('/api/suprimentos/contratos', {
      headers: { 'Idempotency-Key': CHAVE_RECUSA },
      data: {
        numero: 'CT-E2E-RECUSA',
        fornecedor: 7001,
        tipo: 'fornecimento',
        objeto: 'Recusa sintética',
        inicio: dia(0),
        fim: dia(30),
        valor: 1,
        chave: CHAVE_RECUSA,
      },
    });
    expect(recusa.status()).toBe(403);
    await page.goto('/suprimentos/contratos');
    await expect(page.getByTestId('tela-contratos')).toBeVisible();
    await expect(page.getByTestId('ctr-painel')).toBeVisible();
    await expect(page.getByTestId('ctr-novo')).toBeDisabled();
    await semViolacaoAxe(page, 'contratos em consulta');
  });

  test('contrato → aditivo → pedido vinculado → saldo; avaliação do fornecedor', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.CONTRATOS');
    const menu = page.getByRole('navigation', { name: 'Menu principal' });
    await menu.getByRole('button', { name: /^Suprimentos/ }).click();
    const compras = menu.getByRole('button', { name: /^Compras/ });
    if ((await compras.count()) > 0 && (await compras.first().getAttribute('aria-expanded')) !== 'true')
      await compras.first().click();
    await menu.getByRole('link', { name: 'Contratos com fornecedores' }).click();
    await expect(page).toHaveURL(/\/suprimentos\/contratos$/);
    const tela = page.getByTestId('tela-contratos');
    await expect(tela.getByRole('heading', { level: 1 })).toHaveText('Contratos com fornecedores');
    await expect(page.getByTestId('ctr-painel')).toBeVisible();
    await semViolacaoAxe(page, 'painel dos contratos');

    // 1. Cadastro: fornecedor pela busca, vigência de um ano, R$ 100.000,00, reajuste por índice, garantia, gestor e
    // fiscal diferentes.
    const numero = `CT-E2E-${Date.now() % 1_000_000}`;
    await page.getByTestId('ctr-novo').click();
    const form = page.getByTestId('contrato-formulario');
    await expect(form).toBeVisible();
    await page.getByTestId('ctr-numero').fill(numero);
    await page.getByTestId('ctr-fornecedor-termo').fill('Sint');
    await page.getByTestId('ctr-fornecedor-buscar').click();
    await escolher(page.getByTestId('ctr-fornecedor'), '7001');
    await page.getByTestId('ctr-objeto').fill('Fornecimento sintético de material de consumo (teste)');
    await page.getByTestId('ctr-inicio').fill(dia(-30));
    await page.getByTestId('ctr-fim').fill(dia(335));
    await page.getByTestId('ctr-valor').fill('100.000,00');
    await escolher(page.getByTestId('ctr-indice'), 'ipca');
    await page.getByTestId('ctr-database').fill(dia(-30));
    await escolherUsuario(page, 'ctr-gestor', 'SINT.CONTRATOS');
    await escolherUsuario(page, 'ctr-fiscal', 'SINT.GERCOMPRAS');
    await semViolacaoAxe(page, 'cadastro do contrato');
    await page.getByTestId('ctr-gravar').click();
    const det = page.getByTestId('ctr-det-painel');
    await expect(det).toBeVisible();
    await expect(det.getByRole('heading').first()).toContainText(numero);
    await expect(page.getByTestId('ctr-det-saldo-valor')).toContainText('100.000,00');
    await semViolacaoAxe(page, 'contrato aberto');

    // 2. Termo aditivo de valor pela alçada de compras: + R$ 10.000,00 (10% do inicial, sem o aviso dos 25%). O
    // comprador não vê o aditivo entre os eventos que registra.
    await page.getByTestId('ctr-det-aba-registrar').click();
    const tiposComprador = await (async () => {
      const caixa = page.getByTestId('ctr-det-ev-tipo').getByRole('combobox');
      await caixa.click();
      const nomes = await page.getByRole('option').allTextContents();
      await page.keyboard.press('Escape');
      return nomes;
    })();
    expect(tiposComprador.some((n) => n.includes('Termo aditivo'))).toBe(false);
    await entrar(page, 'SINT.GERCOMPRAS');
    await abrirContrato(page, numero);
    await page.getByTestId('ctr-det-aba-registrar').click();
    await escolher(page.getByTestId('ctr-det-ev-tipo'), 'aditivo');
    await page.getByTestId('ctr-det-ev-termo').fill('TA-1');
    await page.getByTestId('ctr-det-ev-valor').fill('10.000,00');
    await page.getByTestId('ctr-det-ev-desc').fill('Acréscimo sintético de consumo (teste)');
    await semViolacaoAxe(page, 'registrar o aditivo');
    await page.getByTestId('ctr-det-ev-gravar').click();
    await expect(page.getByTestId('ctr-det-mensagem')).toContainText('aditivo');
    await page.getByTestId('ctr-det-aba-eventos').click();
    await expect(page.getByTestId('ctr-det-painel').locator('tr[data-tipo="aditivo"]')).toHaveCount(1);

    // De volta o comprador, que liga o pedido.
    await entrar(page, 'SINT.CONTRATOS');
    await abrirContrato(page, numero);

    // 3. Pedido do fornecedor ligado ao contrato (pedido 901, R$ 12.000,00 nos itens vencedores).
    await page.getByTestId('ctr-det-aba-vinculos').click();
    await page.getByTestId('ctr-det-candidatos').click();
    await expect(page.getByTestId('ctr-det-candidato-pedido-55001')).toBeVisible();
    await semViolacaoAxe(page, 'pedidos e títulos para ligar');
    await page.getByTestId('ctr-det-ligar-pedido-55001').click();
    await expect(det.locator('[data-testid^="ctr-det-vinculo-"]')).toHaveCount(1);

    // 3b. O título da nota do pedido 901 (documento 4401, R$ 6.000,00) ligado com o pedido de origem: não abate de
    // novo (regra 6), o saldo segue 98.000,00.
    await expect(page.getByTestId('ctr-det-candidato-titulo-55101')).toBeVisible();
    await escolher(page.getByTestId('ctr-det-origem'), { rotulo: /2026\/901/ });
    await page.getByTestId('ctr-det-ligar-titulo-55101').click();
    await expect(det.locator('[data-testid^="ctr-det-vinculo-"]')).toHaveCount(3);
    await expect(det.getByText('não (paga um pedido ligado)').first()).toBeVisible();

    // 4. Saldo com as parcelas: 100.000,00 + 10.000,00 − 12.000,00 = 98.000,00.
    await page.getByTestId('ctr-det-aba-resumo').click();
    await expect(page.getByTestId('ctr-det-saldo-valor')).toContainText('98.000,00');
    const conta = page.getByTestId('ctr-det-saldo-conta');
    await expect(conta).toContainText('100.000,00');
    await expect(conta).toContainText('10.000,00');
    await expect(conta).toContainText('12.000,00');
    await expect(conta).toContainText('= 98.000,00');
    await semViolacaoAxe(page, 'saldo do contrato');

    // 5. Avaliação do fornecedor com a prévia (regra 8): todas as notas 5 → qualificado.
    await page.getByTestId('ctr-det-aba-avaliacao').click();
    for (const c of ['qualidade', 'prazo', 'atendimento', 'documentacao'])
      await escolher(page.getByTestId(`ctr-det-av-${c}`), '5');
    await page.getByTestId('ctr-det-av-data').fill(dia(0));
    await expect(page.getByTestId('ctr-det-av-previa')).toContainText('média 5');
    await semViolacaoAxe(page, 'avaliação do fornecedor');
    await page.getByTestId('ctr-det-av-gravar').click();
    await expect(page.getByTestId('ctr-det-mensagem')).toBeVisible();

    // A lista mostra o contrato com o saldo novo.
    await page.getByTestId('ctr-det-fechar').click();
    const lista = page.getByTestId('ctr-lista');
    await expect(lista).toContainText(numero);
    await expect(lista).toContainText('98.000,00');
    expect(externas).toEqual([]);
  });
});
