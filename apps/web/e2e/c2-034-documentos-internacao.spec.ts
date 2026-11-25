// E2E @C2-034 (F3.4, 04-INT linha 69): os documentos da internação conforme o convênio. A partir da internação admitida
// no convênio sintético 901, a tela de impressos lista os documentos configurados para o momento (combo do tema, nada
// de <select> cru), emite o termo do convênio em PDF (endereço blob:) com o aviso das cópias da regra e marca o
// documento como emitido; trocar o momento relê a lista; o atalho abre a configuração dos documentos com a internação
// na prévia. O efeito no banco (linha na trilha com o modelo, o momento e as cópias; o obrigatório emitido lido da
// trilha) é provado no contrato de efeito apps/api/src/modulos/adt/documentos-internacao.int.spec.ts. Sessão real sobre
// a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS; nada vai à cópia). Axe sem violação séria.
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

/** Admite o paciente sintético num leito livre da enfermaria e devolve o número da internação. */
async function admitir(page: Page): Promise<number> {
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
  await page.getByTestId('admissao-gravar').click();
  await expect(page.getByTestId('admissao-feita')).toBeVisible();
  await page.getByTestId('admissao-abrir').click();
  await expect(page).toHaveURL(/\/internacao\/\d+\/guias/);
  return Number(/\/internacao\/(\d+)\//.exec(page.url())?.[1]);
}

test.describe('@C2-034 documentos da internação conforme o convênio', () => {
  test.setTimeout(180_000);

  test('lista do momento, emissão em PDF com as cópias da regra e configuração com a prévia; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.INTERNACAO');
    const reg = await admitir(page);
    expect(reg).toBeGreaterThan(0);

    await page.goto(`/internacao/${reg}/impressos`);
    const tela = page.getByTestId('tela-impressos-internacao');
    await expect(tela).toBeVisible();
    await esperarSemSelectNativo(page);
    await expect(page.locator('[data-testid="tela-impressos-internacao"] select')).toHaveCount(0);

    // Os documentos do momento: a ficha comum e o termo que a regra do convênio 901 manda (2 cópias).
    const lista = page.getByTestId('imp-fichas');
    await expect(lista).toBeVisible();
    await expect(page.getByTestId('imp-ficha-1')).toBeVisible();
    await expect(lista).toContainText('TERMO DO CONVENIO');
    await semViolacaoAxe(page, '/internacao/:reg/impressos');

    // Emite o termo: o PDF abre por blob:, com o aviso das cópias da regra, e o documento fica marcado como emitido.
    await page.getByTestId('imp-ficha-2').click();
    const pdfs = page.getByTestId('imp-pdfs');
    await expect(pdfs).toContainText('TERMO DO CONVENIO');
    await expect(pdfs).toContainText('imprima 2 cópias');
    await expect(pdfs.locator('a').first()).toHaveAttribute('href', /^blob:/);
    await expect(page.getByTestId('imp-emitido-2')).toBeVisible();
    await expect(page.getByTestId('imp-mensagem')).toBeVisible();

    // Outro momento: a lista é relida pelo combo do tema.
    await escolher(page.getByTestId('imp-momento'), 'alta');
    await expect(lista).toBeVisible();

    // A configuração dos documentos abre com a internação na prévia.
    await page.getByTestId('imp-configurar-documentos').click();
    await expect(page).toHaveURL(new RegExp(`/internacao/documentos\\?reg=${reg}$`));
    await expect(page.getByTestId('tela-documentos-internacao')).toBeVisible();
    await esperarSemSelectNativo(page);
    await semViolacaoAxe(page, '/internacao/documentos');

    expect(externas).toEqual([]);
  });
});
