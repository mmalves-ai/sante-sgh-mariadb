// E2E @W0-06 (programa CRUD completo; parte 7d: painel de indicadores de pessoas, M4 de mercado, aceite 10): o RH abre
// o painel, calcula o 1º trimestre de 2026 e confere, contra a base de teste conferida à mão (a mesma do domínio, em
// dominio-pessoas/src/indicadores/indicadores-pessoas.spec.ts, semente da sessão sintética), o valor de cada indicador,
// a conta por extenso, a ficha técnica, as parcelas por setor, os complementos das horas extras e a referência COFEN
// com a razão; recorta pela UTI; o período invertido é recusado no próprio filtro. Só leitura. Axe sem violação séria.
import { expect, test, type Locator, type Page } from '@playwright/test';
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

async function data(campo: Locator, valor: string): Promise<void> {
  const entrada = campo.locator('input');
  await entrada.fill(valor);
  await entrada.press('Tab');
}

async function calcular(page: Page, inicio: string, fim: string): Promise<void> {
  await data(page.getByTestId('indicadores-inicio'), inicio);
  await data(page.getByTestId('indicadores-fim'), fim);
  await page.getByTestId('indicadores-calcular').click();
}

test.describe('W0-06 (parte 7d): painel de indicadores de pessoas com ficha técnica e parcelas @W0-06', () => {
  test.setTimeout(180_000);

  test('trimestre conferido contra a base de teste → fichas e parcelas impressas → recorte da UTI → período inválido; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.RH');
    await page.goto('/pessoas/indicadores');
    await expect(page.getByTestId('tela-indicadores-pessoas')).toBeVisible();
    await expect(page.getByTestId('indicadores-filtro')).toBeVisible({ timeout: 30_000 });

    await calcular(page, '01/01/2026', '31/03/2026');
    await expect(page.getByTestId('indicadores-recorte')).toContainText('01/01/2026');
    await expect(page.getByTestId('indicadores-recorte')).toContainText('31/03/2026');

    // Os seis indicadores, com os números da base conferida à mão.
    const v = (c: string) => page.getByTestId(`indicador-${c}-valor`);
    await expect(v('turnover')).toHaveText('28,57 %');
    await expect(v('absenteismo')).toHaveText('3 %');
    await expect(v('horasExtras')).toHaveText('3,96 %');
    await expect(v('horasEnfermagemPacienteDia')).toHaveText('12,63 h');
    await expect(v('treinamentoPerCapita')).toBeVisible();
    await expect(v('acidentesTrabalho')).toBeVisible();
    await expect(page.getByTestId('indicadores-avisos')).toHaveCount(0);

    // A conta do consolidado é a soma dos numeradores sobre a soma dos denominadores, e as parcelas aparecem por setor.
    await expect(page.getByTestId('indicador-turnover-conta')).toContainText('7');
    await expect(page.getByTestId('indicador-turnover-parcela-10')).toContainText('Clínica');
    await expect(page.getByTestId('indicador-turnover-parcela-20')).toContainText('UTI');
    await expect(page.getByTestId('indicador-absenteismo-parcelas')).toContainText('90');
    await expect(page.getByTestId('indicador-absenteismo-parcelas')).toContainText('3.000');

    // A ficha técnica impressa: definição, fórmula, fontes e norma.
    const ficha = page.getByTestId('indicador-turnover-ficha');
    for (const r of ['Definição', 'Fórmula', 'Numerador', 'Denominador', 'Fontes', 'Norma', 'Interpretação'])
      await expect(ficha).toContainText(r);
    await expect(page.getByTestId('indicador-horasEnfermagemPacienteDia-ficha')).toContainText('COFEN');

    // Complementos das horas extras (horas e valor pago na folha) e a referência da COFEN com a razão.
    await expect(page.getByTestId('indicador-horasExtras')).toContainText('120 h');
    await expect(page.getByTestId('indicador-horasExtras')).toContainText('R$ 2.000,00');
    await expect(page.getByTestId('indicador-horasEnfermagemPacienteDia-referencia')).toContainText('11,16');
    await expect(page.getByTestId('indicador-horasEnfermagemPacienteDia-razao')).not.toBeEmpty();
    await expect(page.getByTestId('indicadores-cofen')).toBeVisible();
    await semViolacaoAxe(page, '/pessoas/indicadores');

    // Recorte da UTI: todas as fontes recortadas.
    await escolher(page.getByTestId('indicadores-setor'), { rotulo: 'UTI' });
    await page.getByTestId('indicadores-calcular').click();
    await expect(page.getByTestId('indicadores-recorte')).toContainText('UTI');
    await expect(v('absenteismo')).toHaveText('2,5 %');
    await expect(page.getByTestId('indicador-turnover-parcela-10')).toHaveCount(0);

    // Período invertido: recusado no filtro, sem consultar.
    await calcular(page, '31/03/2026', '01/01/2026');
    await expect(page.getByTestId('indicadores-erro-filtro')).toBeVisible();

    expect(externas).toEqual([]);
  });
});
