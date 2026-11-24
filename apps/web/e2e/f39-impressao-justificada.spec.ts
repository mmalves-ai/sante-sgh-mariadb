// E2E @F39-2 (01-ADM L82, ficha F3.9): imprimir documento do prontuário pede por quê. O médico emite um atestado,
// abre o documento e o botão Imprimir só libera com a justificativa no tamanho mínimo (validação na hora, com as razões
// comuns à mão); a 1ª via sai em PDF (via 1); o rótulo passa a pedir o motivo da 2ª via, que sai como via 2. O que fica
// no banco (evento do documento e registro único em exportacao_documento) é provado no contrato de efeito
// documentos-porta-propria.int.spec.ts. Sessão real sobre a fonte sintética de dev; nenhum dado real.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Impressão justificada do documento do prontuário @F39-2 @fase3', () => {
  test.setTimeout(180_000);
  test('1ª via com justificativa, 2ª via com motivo; botão travado abaixo do mínimo; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/pep/paciente/1001/atestados');
    await page
      .getByTestId('atestado-texto')
      .fill('Atesto, para os devidos fins, que o paciente esteve em atendimento SINTETICO.');
    await page.getByTestId('atestado-dias').fill('1');
    await page.getByTestId('emitir-atestado').click();
    await expect(page.getByTestId('aba-atestados-conteudo')).toContainText('Documento emitido.');

    const linhas = page.getByTestId('tabela-atestado').locator('tbody tr');
    await linhas.last().getByRole('button', { name: 'Abrir' }).click();
    const aberto = page.getByTestId('documento-aberto');
    await expect(aberto).toBeVisible();
    await expect(aberto).toContainText('Justificativa da impressão');
    const campo = page.getByTestId('justificativa-impressao');
    const imprimir = aberto.getByRole('button', { name: 'Imprimir' });

    // Validação na hora: abaixo de 10 caracteres o botão não libera.
    await campo.fill('curta');
    await expect(imprimir).toBeDisabled();
    await semViolacaoAxe(page, 'documento aberto com a justificativa');

    const via = async (texto: string, n: number) => {
      await campo.fill(texto);
      await expect(imprimir).toBeEnabled();
      const [r] = await Promise.all([
        page.waitForResponse((x) => /\/documentos\/atestado\/\d+\/imprimir$/.test(x.url())),
        imprimir.click(),
      ]);
      expect(r.status()).toBe(200);
      expect(r.headers()['content-disposition']).toMatch(new RegExp(`via${n}\\.pdf`));
    };
    await via('Entrega ao paciente ou ao responsável legal', 1);
    // A partir daqui é nova via: o rótulo pede o motivo (mínimo menor, mas ainda exigido).
    await expect(aberto).toContainText('Motivo da 2ª via');
    await expect(campo).toHaveValue('');
    await expect(imprimir).toBeDisabled();
    await via('Via extraviada pelo setor', 2);
    expect(externas).toEqual([]);
  });
});
