// E2E @M27 @fase2, regra 9 (J10, coexistência livre; cap-10 §10.5; cap-14 §14.2.4): a fila da recepção do novo e o
// outro sistema sobre as mesmas senhas — a prioridade legal, as guias aguardando, e a senha chamada no guichê de lá
// saindo da fila daqui ao vivo, sem recarregar (o vigia de 1 s do E2E e o canal de eventos); e o aviso de colisão
// quando a linha mudou depois da leitura (outra ponta grava primeiro; quem grava depois revê sem perder o digitado).
// Sessão real sobre a fonte sintética de dev e as portas em MEMÓRIA (nada vai à cópia). Sobre o banco, os dois sentidos
// (começado lá e terminado aqui, e vice-versa) e a colisão com o outro sistema estão na integração
// `packages/testes/src/integracao/m27-jornada.int.spec.ts` (J10).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const POR_FORA = resolve(import.meta.dirname, '../../../.tmp/e2e-recepcao-por-fora.json');

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function novaSessao(browser: Browser, login: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await entrar(page, login);
  return page;
}

test.describe('Coexistência na jornada (J10) @M27 @fase2', () => {
  test.setTimeout(120_000);
  test.beforeAll(() => rmSync(POR_FORA, { force: true }));
  test.afterAll(() => rmSync(POR_FORA, { force: true }));

  test('recepção: senhas pela prioridade legal, guias aguardando; a senha chamada no outro sistema sai ao vivo (J10); axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.SENHAS');
    await expect(page.getByTestId('cartao-recepcao')).toBeVisible();
    await expect(page.getByTestId('cartao-medico')).toHaveCount(0);
    await semViolacaoAxe(page, '/inicio (recepção)');
    await page.goto('/inicio/recepcao');
    await expect(page.getByTestId('tela-worklist-recepcao')).toBeVisible();
    // Regra 5: a guia sintética aguardando autorização, com o link do atendimento.
    await expect(page.getByTestId('wl-guia-990001')).toContainText('CONVÊNIO SINTÉTICO');
    const senhas = page.getByTestId('tabela-wl-senhas').locator('tbody tr');
    await expect(senhas.first()).toBeVisible();
    // A ordem da prioridade legal: nenhuma senha normal antes de uma prioritária.
    const textos = await senhas.locator('td:nth-child(2)').allTextContents();
    const pesos = textos.map((x) => (/Acima de 80/.test(x) ? 0 : /Prioridade legal/.test(x) ? 1 : 2));
    expect([...pesos].sort((a, b) => a - b)).toEqual(pesos);
    await semViolacaoAxe(page, '/inicio/recepcao');
    // J10: o guichê do outro sistema chama a senha mais antiga da recepção (por fora); a fila relê pelo canal.
    const antes = await senhas.count();
    mkdirSync(dirname(POR_FORA), { recursive: true });
    writeFileSync(POR_FORA, JSON.stringify({ chamadas: [{ id: `m27-fora-${Date.now()}`, guiche: 9 }] }));
    await expect(senhas).toHaveCount(antes - 1, { timeout: 5_000 });
    rmSync(POR_FORA, { force: true });
    expect(externas).toEqual([]);
  });

  test('aviso de colisão: a outra ponta grava primeiro; quem grava depois revê sem perder o digitado; axe', async ({
    page,
    browser,
  }) => {
    await entrar(page, 'SINT.RECEPCAO');
    const outra = await novaSessao(browser, 'SINT.SAME');
    for (const p of [page, outra]) {
      await p.goto('/cadastros/pacientes/1007');
      await p.getByTestId('botao-editar').click();
      await expect(p.getByTestId('form-paciente')).toBeVisible();
    }
    await outra.getByTestId('campo-telefone').fill('(21) 3333-0027');
    await outra.getByTestId('botao-salvar-paciente').click();
    await expect(outra.getByTestId('mensagem-ficha')).toContainText('Cadastro salvo.');
    await page.getByLabel('Bairro', { exact: true }).fill('BAIRRO SINTETICO M27');
    await page.getByTestId('botao-salvar-paciente').click();
    await expect(page.getByTestId('aviso-colisao')).toBeVisible();
    await semViolacaoAxe(page, 'aviso de colisão (M27)');
    await page.getByTestId('aviso-colisao').getByTestId('rever').click();
    await expect(page.getByLabel('Bairro', { exact: true })).toHaveValue('BAIRRO SINTETICO M27');
    await page.getByTestId('botao-salvar-paciente').click();
    await expect(page.getByTestId('mensagem-ficha')).toContainText('Cadastro salvo.');
    await outra.context().close();
  });
});
