// E2E @F39-2 @C1-079 (01-ADM L82 e L79, ficha F3.9): imprimir documento do prontuário pede por quê. O médico emite um
// atestado, abre o documento e o botão Imprimir só libera com a justificativa no tamanho mínimo (validação na hora,
// com as razões comuns à mão); a 1ª via sai em PDF (via 1). Daí em diante é nova via com um só caminho de motivo: o
// combo do catálogo de reimpressão (o complemento aparece só quando o motivo pede) e a via 2; ao reabrir o documento,
// a tela já sabe que ele foi impresso e pede o motivo de saída. O que fica no banco (registro_reimpressao, evento do
// documento e registro único em exportacao_documento) é provado no contrato de efeito
// documentos-porta-propria.int.spec.ts. Sessão real sobre a fonte sintética de dev; nenhum dado real.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { esperarOpcoes, escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Impressão justificada do documento do prontuário @F39-2 @C1-079 @fase3', () => {
  test.setTimeout(180_000);
  test('1ª via com justificativa, nova via com motivo do catálogo; botão travado até a entrada valer; axe', async ({
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

    const sair = async (n: number) => {
      await expect(imprimir).toBeEnabled();
      const [r] = await Promise.all([
        page.waitForResponse((x) => /\/documentos\/atestado\/\d+\/imprimir$/.test(x.url())),
        imprimir.click(),
      ]);
      expect(r.status()).toBe(200);
      expect(r.headers()['content-disposition']).toMatch(new RegExp(`via${n}\\.pdf`));
      return r;
    };
    await campo.fill('Entrega ao paciente ou ao responsável legal');
    await sair(1);
    // A partir daqui é nova via: nada de texto livre, o motivo vem do catálogo (o botão trava até escolher).
    await expect(aberto.getByTestId('aviso-nova-via')).toBeVisible();
    await expect(campo).toHaveCount(0);
    await expect(imprimir).toBeDisabled();
    const motivo = aberto.getByTestId('motivo-reimpressao');
    await esperarOpcoes(motivo, null);
    await semViolacaoAxe(page, 'nova via com o motivo do catálogo');
    await escolher(motivo, { indice: 1 });
    // Motivo que pede complemento: o campo aparece e o botão só libera com o mínimo.
    const complemento = aberto.getByTestId('complemento-reimpressao');
    if (await complemento.isVisible()) {
      await complemento.fill('abc');
      await expect(imprimir).toBeDisabled();
      await complemento.fill('Pedido do convênio SINTETICO');
    }
    const r2 = await sair(2);
    const corpo = r2.request().postDataJSON() as Record<string, unknown>;
    expect(typeof corpo['motivoReimpressao']).toBe('number');
    expect(corpo['motivo']).toBeUndefined();

    // Reabrir o documento: a tela já sabe que ele saiu antes (rota das vias) e pede o motivo de saída.
    await page.keyboard.press('Escape');
    await linhas.last().getByRole('button', { name: 'Abrir' }).click();
    await expect(page.getByTestId('documento-aberto').getByTestId('aviso-nova-via')).toBeVisible();
    await expect(page.getByTestId('justificativa-impressao')).toHaveCount(0);
    expect(externas).toEqual([]);
  });
});
