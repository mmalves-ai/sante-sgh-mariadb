// E2E @F3.6-01 (F3.6, 05-SUP linha 1): cadastro do material e do medicamento numa tela só
// (/suprimentos/itens/cadastro/:id?), pelo atalho da lista de itens. A pessoa escolhe o tipo, o grupo e a unidade, vê
// na hora o que falta (medicamento sem princípio ativo, concentração sem unidade, GTIN com o dígito errado) sem ir ao
// servidor, inclui o princípio ativo pela busca, o código de barras, a apresentação com o registro sanitário (o vencido
// aparece vencido) e a estabilidade com a guarda e o diluente por lista, e grava tudo de uma vez. O servidor recusa o
// código que já existe sem gravar; o item com saldo não troca a unidade nem é inativado; o item sem saldo é inativado
// e reativado com motivo (nunca apagado). As rotas /api/suprimentos/cadastro respondem pela porta em memória da sessão
// sintética, com as regras do domínio (massa SINTÉTICA); só o painel do vínculo com a referência de preço (outra
// função, que exige o banco próprio) é simulado. O efeito no banco está em
// apps/api/src/modulos/suprimentos/cadastro-estoque-porta-propria.int.spec.ts.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher, esperarValor } from './combos.js';

const SENHA = 'Sintetico#2026';
/** GTIN-13 sintético com o dígito verificador certo (o prefixo muda a cada execução: o código é único na base). */
function gtinSintetico(): string {
  const base = `789${String(Date.now()).slice(-9)}`;
  const soma = [...base].reverse().reduce((t, d, i) => t + Number(d) * (i % 2 === 0 ? 3 : 1), 0);
  return `${base}${(10 - (soma % 10)) % 10}`;
}

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Cadastro do material e do medicamento @F3.6-01 @fase3', () => {
  test.setTimeout(240_000);
  test('medicamento inteiro numa gravação, conferência na hora, recusas do servidor, inativar e reativar; axe', async ({
    page,
  }) => {
    const codigo = `E2E-${Date.now()}`;
    const gtin = gtinSintetico();
    const gtinErrado = `${gtin.slice(0, 12)}${(Number(gtin[12]) + 1) % 10}`;
    const gravacoes: string[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET' && /\/api\/suprimentos\/cadastro\/itens/.test(r.url()))
        gravacoes.push(`${r.method()} ${new URL(r.url()).pathname}`);
    });
    // O painel do vínculo com a referência de preço (05-SUP linha 28) exige o banco próprio: aqui, vazio.
    await page.route(/\/api\/suprimentos\/cadastro\/itens\/\d+\/referencias-preco(\?.*)?$/, (rota) =>
      rota.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          hoje: '2026-03-15',
          item: { id: 1, codigo, nome: 'ITEM SINTETICO', unidade: 'AMP' },
          vigentes: [],
          historico: [],
        }),
      }),
    );

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/suprimentos/itens');
    await page.getByTestId('itens-novo').click();
    await expect(page).toHaveURL(/\/suprimentos\/itens\/cadastro$/);
    await expect(page.getByTestId('tela-suprimentos-item-cadastro')).toBeVisible();

    // Identificação: o código já usado por outro item (o servidor é quem sabe).
    await escolher(page.getByTestId('item-tipo'), 'medicamento');
    await page.getByTestId('item-codigo').fill('5001');
    await page.getByTestId('item-nome').fill('DIPIRONA SINTETICA 1 G AMPOLA');
    await escolher(page.getByTestId('item-grupo'), '1');
    await escolher(page.getByTestId('item-unidadeEstoque'), '3');

    // Conferência na hora: medicamento sem princípio ativo não vai ao servidor.
    await page.getByTestId('item-salvar').click();
    await expect(page.getByTestId('item-erro-principio')).toContainText('princípio ativo');
    expect(gravacoes).toHaveLength(0);

    // Princípio ativo pela busca; a concentração sem a unidade é apontada na linha e some ao escolher a unidade.
    await page.getByTestId('item-busca-principio').fill('DIPI');
    await page.getByTestId('item-principio-501').click();
    const concentracao = page.getByTestId('principio-concentracao-0');
    await concentracao.fill('1000');
    await concentracao.press('Tab');
    await expect(page.getByTestId('item-erro-principio')).toContainText('unidade de medida');
    await escolher(page.getByTestId('principio-unidade-0'), '5');
    await expect(page.getByTestId('item-erro-principio')).toHaveCount(0);

    // Código de barras: o GTIN com o dígito errado trava o botão na hora; o certo entra na lista.
    await page.getByTestId('barras-codigo').fill(gtinErrado);
    await expect(page.getByTestId('barras-invalido')).toBeVisible();
    await expect(page.getByTestId('barras-incluir')).toBeDisabled();
    await page.getByTestId('barras-codigo').fill(gtin);
    await expect(page.getByTestId('barras-invalido')).toHaveCount(0);
    await page.getByTestId('barras-incluir').click();
    const form = page.getByTestId('item-form');
    await expect(form).toContainText(gtin);

    // Apresentação com o registro sanitário vencido e a estabilidade da solução diluída (guarda e diluente por lista).
    await page.getByTestId('apr-nome').fill('DIPIRONA ALFA SINTETICA');
    await page.getByTestId('apr-apresentacao').fill('CAIXA COM 50 AMPOLAS');
    await page.getByTestId('apr-quantidade').fill('50');
    await page.getByTestId('apr-registro').fill('123456789');
    await page.getByTestId('apr-validade').fill('2020-01-31');
    await page.getByTestId('apr-incluir').click();
    await expect(form).toContainText('DIPIRONA ALFA SINTETICA');
    await page.getByRole('button', { name: '+ diluido' }).click();
    await escolher(page.getByTestId('estabilidade-guarda-0'), '2');
    await escolher(page.getByTestId('estabilidade-diluente-0'), '1');

    // O servidor recusa o código que já é de outro item, sem gravar (a tela continua na inclusão).
    await page.getByTestId('item-salvar').click();
    await expect(page.getByTestId('recusa-suprimentos')).toContainText('Já existe item com o código 5001');
    await expect(page).toHaveURL(/\/suprimentos\/itens\/cadastro$/);
    expect(gravacoes).toEqual(['POST /api/suprimentos/cadastro/itens']);

    // Com o código livre, uma gravação leva o item inteiro; a ficha relida mostra o registro vencido.
    await page.getByTestId('item-codigo').fill(codigo);
    await page.getByTestId('item-salvar').click();
    await expect(page.getByTestId('item-ok')).toBeVisible();
    await expect(page).toHaveURL(/\/suprimentos\/itens\/cadastro\/\d+$/);
    const url = page.url();
    await page.reload();
    await expect(page.getByTestId('item-codigo')).toHaveValue(codigo);
    await expect(page.getByTestId('item-situacao')).toContainText('Ativo');
    await expect(page.getByTestId('principio-concentracao-0')).toHaveValue('1000');
    await esperarValor(page.getByTestId('principio-unidade-0'), '5');
    await esperarValor(page.getByTestId('estabilidade-guarda-0'), '2');
    await esperarValor(page.getByTestId('estabilidade-diluente-0'), '1');
    await expect(form).toContainText(gtin);
    await expect(form).toContainText('123456789');
    await expect(form).toContainText('vencido');
    await expect(form).toContainText('DIPIRONA SINTETICA');
    await semViolacaoAxe(page, 'cadastro do item gravado');

    // Inativar pede o motivo; com ele, o item fica inativo (nunca apagado) e volta com outro motivo.
    await page.getByTestId('item-situacao-trocar').click();
    await expect(page.getByTestId('recusa-suprimentos')).toContainText('motivo');
    await expect(page.getByTestId('item-situacao')).toContainText('Ativo');
    await page.getByTestId('item-motivo').fill('Saiu da padronização sintética');
    await page.getByTestId('item-situacao-trocar').click();
    await expect(page.getByTestId('item-situacao')).toContainText('Inativo');
    await page.getByTestId('item-motivo').fill('Voltou à padronização sintética');
    await page.getByTestId('item-situacao-trocar').click();
    await expect(page.getByTestId('item-situacao')).toContainText('Ativo');
    expect(page.url()).toBe(url);

    // Item com saldo: a unidade do estoque não muda e a inativação é recusada, com o motivo na tela.
    await page.goto('/suprimentos/itens/cadastro/5003');
    await expect(page.getByTestId('item-nome')).toHaveValue(/DIPIRONA/);
    await expect(page.getByTestId('item-situacao')).toContainText('360');
    await escolher(page.getByTestId('item-unidadeEstoque'), '1');
    await page.getByTestId('item-salvar').click();
    await expect(page.getByTestId('recusa-suprimentos')).toContainText('já tem saldo ou movimento');
    await page.getByTestId('item-motivo').fill('Tentativa sintética de inativar');
    await page.getByTestId('item-situacao-trocar').click();
    await expect(page.getByTestId('recusa-suprimentos')).toContainText('zere o saldo');
    await page.reload();
    await esperarValor(page.getByTestId('item-unidadeEstoque'), '3');
    await expect(page.getByTestId('item-situacao')).toContainText('Ativo');
  });
});
