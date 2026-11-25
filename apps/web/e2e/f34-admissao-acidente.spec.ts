// E2E @C1-039 (F3.4, 04-INT linha 67): o acidente que motivou a internação informado na própria admissão. O tipo vem
// num combo do tema ("Não é acidente" por padrão); o acidente de trabalho abre os campos do empregador e é conferido
// na hora pela mesma regra do domínio (quando ocorreu, CNPJ que não confere, empregador), e o botão de gravar só libera
// com a regra cumprida; o de trânsito não pede empregador. Nada de <select> cru; axe sem violação séria.
// O efeito no banco (linha em acidente_internacao na mesma transação, recusa sem gravar nada e o indicador de acidente
// da guia TISS no atendimento) é provado no contrato de efeito apps/api/src/modulos/adt/registros-internacao.int.spec.ts.
// Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS; nada vai à cópia).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, esperarSemSelectNativo } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** Preenche a admissão do paciente sintético num leito livre da enfermaria, sem gravar. */
async function preencherAdmissao(page: Page): Promise<void> {
  await page.goto('/leitos/mapa');
  const cartoes = page.locator('[data-testid^="leito-1|ENF1|"][data-situacao="livre"]');
  await expect(cartoes.first()).toBeVisible();
  const origem = ((await cartoes.first().getAttribute('data-testid')) ?? '').replace(/^leito-/, '');
  await page.getByTestId(`admitir-${origem}`).click();
  await expect(page.getByTestId('tela-admissao')).toBeVisible();
  await page.getByTestId('admissao-termo').locator('input').fill('JOSE DA SILVA');
  await page.getByTestId('admissao-buscar').click();
  await page.getByTestId('admissao-paciente-1001').click();
  await escolher(page.getByTestId('admissao-leito'), origem);
  await escolher(page.getByTestId('admissao-convenio'), '901');
  await escolher(page.getByTestId('admissao-especialidade'), '11');
  await page.getByTestId('admissao-termo-medico').locator('input').fill('ANA');
  await page.getByTestId('admissao-buscar-medico').click();
  await escolher(page.getByTestId('admissao-assistente'), '7101');
  await escolher(page.getByTestId('admissao-solicitante'), '7101');
  await page.getByTestId('admissao-termo-cid').locator('input').fill('I21');
  await page.getByTestId('admissao-buscar-cid').click();
  await escolher(page.getByTestId('admissao-cid'), '50001');
  await page.getByTestId('admissao-procedimento').locator('input').fill('303010037');
}

test.describe('@C1-039 acidente informado na admissão', () => {
  test.setTimeout(180_000);

  test('acidente de trabalho conferido na hora; o de trânsito sem empregador; admissão gravada; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.INTERNACAO');
    await preencherAdmissao(page);
    const tela = page.getByTestId('tela-admissao');
    await esperarSemSelectNativo(tela);
    const gravar = page.getByTestId('admissao-gravar');
    // Sem acidente (padrão): nada a conferir, a admissão libera.
    await expect(page.getByTestId('admissao-acidente-conferencia')).toHaveCount(0);
    await expect(gravar).toBeEnabled();

    // Acidente de trabalho: quando ocorreu e o empregador, conferidos na hora; o botão espera a regra.
    await escolher(page.getByTestId('admissao-acidente-tipo'), 'trabalho');
    await expect(page.getByTestId('admissao-acidente-conferencia')).toContainText(
      'quando o acidente de trabalho ocorreu',
    );
    await expect(gravar).toBeDisabled();
    await page.getByTestId('admissao-acidente-ocorrido').fill('2020-01-02T08:30');
    await expect(page.getByTestId('admissao-acidente-conferencia')).toContainText('Informe o empregador');
    await page.getByTestId('admissao-acidente-cnpj').locator('input').fill('11.111.111/1111-11');
    await expect(page.getByTestId('admissao-acidente-conferencia')).toContainText(
      'CNPJ do empregador não confere',
    );
    await page.getByTestId('admissao-acidente-cnpj').locator('input').fill('11.222.333/0001-81');
    await expect(page.getByTestId('admissao-acidente-conferencia')).toHaveCount(0);
    await expect(gravar).toBeEnabled();
    await semViolacaoAxe(page, '/internacao/admissao (acidente)');

    // Trânsito: os campos do empregador somem e nada mais é pedido.
    await escolher(page.getByTestId('admissao-acidente-tipo'), 'transito');
    await expect(page.getByTestId('admissao-acidente-cnpj')).toHaveCount(0);
    await expect(page.getByTestId('admissao-acidente-conferencia')).toHaveCount(0);
    await gravar.click();
    await expect(page.getByTestId('admissao-feita')).toBeVisible();
    expect(externas).toEqual([]);
  });
});
