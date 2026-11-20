// E2E @M16 (ficha, seção 10): a coordenação de leitos abre o painel (cartão sem nome; o nome só ao abrir, com o
// cadastro), uma internação SINTÉTICA gravada "por fora" aparece em até 2 s sem recarregar a tela, e o censo do dia
// em aberto; a diretoria abre um indicador, vê a ficha e exporta; o mês corrente aparece como parcial; os painéis
// (o financeiro nas duas réguas). axe sem violação séria. Sessão real sobre a fonte sintética de dev (estabelecimento
// SINTÉTICO em memória; nada vai à cópia).
import { rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const POR_FORA = resolve(import.meta.dirname, '../../../.tmp/e2e-leitos-por-fora.json');

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Painel de leitos, censo e indicadores @M16', () => {
  test.beforeAll(() => rmSync(POR_FORA, { force: true }));
  test.afterAll(() => rmSync(POR_FORA, { force: true }));

  test('coordenação de leitos: painel ao vivo, a internação por fora em até 2 s, o cartão e o censo', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.LEITOS');
    await page.goto('/internacao/leitos/painel');
    await expect(page.getByRole('heading', { level: 1, name: 'Painel de leitos ao vivo' })).toBeVisible();
    await expect(page.getByTestId('painel-totais')).toContainText('leitos ativos');
    await expect(page.getByTestId('painel-atualizado')).toContainText('Atualizado há');
    // O canal de eventos conectado ("Ao vivo").
    await expect(page.getByTestId('painel-atualizado')).toContainText('Ao vivo');
    await semViolacaoAxe(page, '/internacao/leitos/painel');

    // Um leito livre do painel (lido da própria API, como a tela) recebe a internação gravada por fora.
    const painel = (await (await page.request.get('/api/internacao/leitos/painel')).json()) as {
      blocos: {
        bloco: string;
        acomodacoes: { acomodacao: string; leitos: { leito: string; situacao: string }[] }[];
      }[];
    };
    const alvo = painel.blocos
      .flatMap((b) =>
        b.acomodacoes.flatMap((a) => a.leitos.map((l) => ({ b: b.bloco, a: a.acomodacao, ...l }))),
      )
      .find((l) => l.situacao === 'livre');
    expect(alvo).toBeTruthy();
    const cartao = page.getByTestId(`leito-${alvo!.b}-${alvo!.a}-${alvo!.leito}`);
    await expect(cartao).toContainText('Livre');
    const t0 = Date.now();
    writeFileSync(
      POR_FORA,
      JSON.stringify({
        reg: 990_001,
        bloco: alvo!.b,
        acomodacao: alvo!.a,
        leito: alvo!.leito,
        iniciais: 'TPF',
        sexo: 'F',
        nascimento: '1960-05-05',
        convenio: 'CONVÊNIO SINTÉTICO A',
      }),
    );
    await expect(cartao.getByTestId('cartao-iniciais')).toHaveText('TPF', { timeout: 2_000 });
    expect(Date.now() - t0).toBeLessThan(2_000);
    // O cartão não tem o nome; ao abrir, o nome (a coordenação tem o cadastro do paciente).
    await expect(cartao).not.toContainText('PACIENTE');
    await cartao.getByRole('button').click();
    await expect(page.getByTestId('paciente-nome')).toHaveText('PACIENTE SINTÉTICO DO TESTE');
    await semViolacaoAxe(page, 'cartão do leito aberto');
    await page.getByRole('button', { name: 'Fechar' }).first().click();

    // Divergência de cadastro de leitos.
    await page.getByRole('link', { name: 'Divergência de cadastro de leitos' }).click();
    await expect(page.getByTestId('div-tabela')).toBeVisible();
    await semViolacaoAxe(page, '/internacao/leitos/divergencias');

    // Censo do dia em aberto, com o total e a série.
    await page.goto('/internacao/censo');
    await expect(page.getByTestId('censo-situacao')).toContainText('Em aberto');
    await expect(page.getByTestId('censo-total')).toBeVisible();
    await expect(page.getByTestId('serie-tabela')).toBeVisible();
    await semViolacaoAxe(page, '/internacao/censo');
    expect(externas).toEqual([]);
  });

  test('diretoria: indicador com a ficha, o mês parcial, a exportação e os painéis', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.DIRETORIA');
    await page.goto('/relatorios/indicadores');
    await expect(page.getByRole('heading', { level: 1, name: 'Indicadores hospitalares' })).toBeVisible();
    await expect(page.getByTestId('ind-taxaOcupacao')).toBeVisible();
    await semViolacaoAxe(page, '/relatorios/indicadores');
    await page.getByRole('link', { name: /Abrir Taxa de ocupação hospitalar/ }).click();
    await expect(page.getByTestId('ficha-tecnica')).toContainText(
      'paciente-dia ÷ leito-dia operacional × 100',
    );
    await expect(page.getByTestId('ficha-tecnica')).toContainText('Portaria SAS/MS 312/2002');
    // O mês corrente aparece como parcial.
    await expect(page.getByTestId('marca-parcial').first()).toBeVisible();
    await expect(page.getByTestId('indicador-dados-ate')).toContainText('O mês corrente é parcial');
    await semViolacaoAxe(page, '/relatorios/indicadores/taxaOcupacao');
    const download = page.waitForEvent('download');
    await page.getByTestId('indicador-exportar').click();
    expect((await download).suggestedFilename()).toBe('indicador-taxaOcupacao.csv');

    // Painéis: assistencial e o financeiro nas duas réguas.
    await page.goto('/relatorios/paineis/assistencial');
    await expect(page.getByTestId('serie-taxaOcupacao')).toBeVisible();
    await semViolacaoAxe(page, '/relatorios/paineis/assistencial');
    await page.getByTestId('aba-financeiro').click();
    await expect(page.getByTestId('serie-cobrado-competencia')).toContainText('Competência da conta');
    await expect(page.getByTestId('serie-cobrado-data-do-item')).toContainText('Data do item');
    await semViolacaoAxe(page, '/relatorios/paineis/financeiro');
    // A diretoria não abre o nome do paciente no cartão (sem o cadastro).
    expect(externas).toEqual([]);
  });
});
