// E2E @C2-060 (gestão da qualidade: documento controlado no banco próprio, com a área escolhida pelo setor). A pessoa
// da qualidade publica o POP escolhendo a área na lista de setores do estabelecimento (nunca texto digitado), dá a
// ciência na revisão vigente e retira o documento com o motivo; a revisão retirada continua legível (nunca apagada).
// Cobre no ramo próprio as gravações publicarDocumento, registrarCiencia e retirarDocumento. axe sem violação séria.
// Sessão real sobre a fonte sintética (dados SINTÉTICOS; nada vai à cópia).
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

test.describe('Qualidade: documento controlado com a área pelo setor, ciência e retirada @C2-060', () => {
  test('publicar com o setor da lista → ciência → retirada com motivo; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.QUALIDADE');
    const codigo = `POP-E2E-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    await page.goto('/qualidade/documentos');
    await expect(page.getByTestId('tela-documentos')).toBeVisible();

    await page.getByTestId('doc-novo').click();
    const form = page.getByTestId('form-documento');
    await expect(form).toBeVisible();
    // A área é o setor do estabelecimento escolhido na lista: o campo de texto livre não aparece.
    await expect(form.getByTestId('doc-setor')).toBeVisible();
    await expect(form.getByTestId('doc-area')).toHaveCount(0);
    await form.getByTestId('doc-codigo').locator('input').fill(codigo);
    await escolher(form.getByTestId('doc-tipo'), 'pop');
    await escolher(form.getByTestId('doc-setor'), { indice: 1 });
    await form.getByTestId('doc-titulo').locator('input').fill('Higienização das mãos (texto sintético)');
    await form
      .getByTestId('doc-conteudo')
      .locator('textarea')
      .fill('1. Retirar adornos. 2. Friccionar por 20 segundos. 3. Secar (texto sintético).');
    await form.getByTestId('doc-elaborado').locator('input').fill('SINT.ENFERMEIRA');
    await semViolacaoAxe(page, '/qualidade/documentos (novo documento com o setor)');
    await form.getByTestId('doc-publicar').click();

    await expect(page.getByTestId('gestao-aviso')).toContainText('revisão 1');
    const doc = page.getByTestId('documento-detalhe');
    await expect(doc.getByTestId('doc-situacao')).toContainText('Vigente');
    await expect(doc.getByTestId('doc-ciencias')).toContainText('0');
    await doc.getByTestId('doc-dar-ciencia').click();
    await expect(doc.getByTestId('doc-ciencias')).toContainText('1');
    await expect(doc.getByTestId('doc-dar-ciencia')).toHaveCount(0);

    // A retirada exige o motivo; a revisão fica retirada e o texto continua legível.
    await doc.getByTestId('doc-retirar').click();
    const ret = page.getByTestId('form-retirada');
    await expect(ret).toBeVisible();
    await ret
      .getByTestId('doc-motivo')
      .locator('textarea')
      .fill('Substituído pelo protocolo institucional novo.');
    await ret.getByTestId('doc-confirmar-retirada').click();
    await expect(doc.getByTestId('doc-situacao')).toContainText('Retirad');
    await expect(doc.getByTestId('doc-conteudo-lido')).toContainText('Friccionar');
    await semViolacaoAxe(page, '/qualidade/documentos (documento retirado)');
    expect(externas).toEqual([]);
  });
});
