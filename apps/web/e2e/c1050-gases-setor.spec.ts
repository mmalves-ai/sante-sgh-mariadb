// C1-050 (05-SUP linha 30): consumo de gases medicinais por setor. A tela dos gases do paciente leva à do setor por um
// atalho; o registro do consumo do setor sem paciente valida na hora pela mesma regra do domínio que a API aplica (setor,
// gás, fluxo ou volume medido, fim depois do início, volume medido só com o fim); o período invertido é avisado na hora.
// Axe em cada passo. O E2E roda sem banco próprio (fonte sintética): o que fica no banco (consumo do setor, encerrar,
// cancelar sem apagar e a apuração com as parcelas) é provado pelo contrato de efeito gas-setor-propria.int.spec.ts.
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

test.describe('internação: consumo de gases por setor @C1-050', () => {
  test.setTimeout(180_000);

  test('atalho da tela dos gases, validação na hora do consumo do setor e período invertido; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    // C1-074: os gases (do paciente e do setor) são registro da enfermagem (enfermagem.horario.ler), não do administrador.
    await entrar(page, 'SINT.ENF.PLANTAO');
    await page.goto('/internacao/atendimentos/1/gases');
    await expect(page.getByTestId('tela-gases')).toBeVisible();
    await page.getByTestId('gases-ir-setores').click();
    await expect(page).toHaveURL(/\/internacao\/gases\/setores/);
    await expect(page.getByTestId('tela-gases-setor')).toBeVisible();
    await semViolacaoAxe(page, '/internacao/gases/setores (abertura)');

    const gravar = page.getByTestId('gases-setor-gravar');
    const problemas = page.getByTestId('gases-setor-problemas');
    // Vazio: setor, gás e fluxo pedidos na hora; o botão fica travado.
    await expect(problemas).toContainText('Informe o setor do consumo.');
    await expect(problemas).toContainText('Informe o gás.');
    await expect(problemas).toContainText('Informe o fluxo (L/min) ou o volume medido (L).');
    await expect(gravar).toBeDisabled();

    // Fluxo zero é recusado; com fluxo positivo, some o aviso do fluxo.
    await page.getByTestId('gases-setor-fluxo').fill('0');
    await expect(problemas).toContainText('O fluxo deve ser maior que zero.');
    await page.getByTestId('gases-setor-fluxo').fill('2');
    await expect(problemas).not.toContainText('fluxo');

    // Fim antes do início: recusado na hora.
    await page.getByTestId('gases-setor-inicio').fill('2026-11-20T10:00');
    await page.getByTestId('gases-setor-fim').fill('2026-11-20T09:00');
    await expect(problemas).toContainText('O fim do consumo não pode ser antes do início.');
    await page.getByTestId('gases-setor-fim').fill('2026-11-20T11:00');
    await expect(problemas).not.toContainText('fim');

    // Volume medido sem o fim: recusado; com o fim, só faltam setor e gás.
    await escolher(page.getByTestId('gases-setor-modo'), 'volume');
    await page.getByTestId('gases-setor-volume').fill('300');
    await page.getByTestId('gases-setor-fim').fill('');
    await expect(problemas).toContainText('O volume medido exige o fim do consumo.');
    await page.getByTestId('gases-setor-fim').fill('2026-11-20T11:00');
    await expect(problemas).not.toContainText('volume');
    await expect(gravar).toBeDisabled();
    await semViolacaoAxe(page, '/internacao/gases/setores (registro com problemas)');

    // Período invertido: avisado na hora, sem consultar a apuração.
    await page.getByTestId('gases-setor-de').fill('2026-11-20');
    await page.getByTestId('gases-setor-ate').fill('2026-11-10');
    await expect(page.getByTestId('gases-setor-periodo-invalido')).toBeVisible();
    await page.getByTestId('gases-setor-ate').fill('2026-11-25');
    await expect(page.getByTestId('gases-setor-periodo-invalido')).toHaveCount(0);
    expect(externas).toEqual([]);
  });
});
