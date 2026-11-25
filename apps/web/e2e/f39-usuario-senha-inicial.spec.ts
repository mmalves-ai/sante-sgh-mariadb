// E2E @F3.9-01 (01-ADM L57, ficha F3.9): o ciclo de vida da conta em menos cliques.
//  1) Criar o usuário já devolve a senha inicial na mesma tela (uma vez só, sem cache), com o atalho para a ficha: o
//     gestor não precisa mais criar e depois abrir a ficha para "dar a senha".
//  2) A campanha de recertificação por grupo ou por setor só oferece alvo que tem conta para recertificar, com a
//     contagem ao lado; aberta, a campanha traz exatamente aquela quantidade de contas.
// O que fica no banco é provado nos contratos de efeito operacoes-usuario-propria.int.spec.ts e
// recertificacao-propria.int.spec.ts. Sessão real sobre a fonte sintética de dev; nenhum dado real.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, esperarValor, rotulosDoCombo } from './combos.js';

const SENHA = 'Sintetico#2026';
const NOVO = 'SINT.E2E.L57';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Conta do usuário: senha inicial na criação e recertificação por alvo @F3.9-01 @fase3', () => {
  test.setTimeout(180_000);

  test('criar o usuário mostra a senha inicial uma vez, sem cache, e leva à ficha; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/usuarios');
    await expect(page.getByTestId('tabela-usuarios')).toBeVisible();
    await page.getByTestId('novo-usuario').click();
    const form = page.getByTestId('form-novo-usuario');
    await form.getByLabel('Login').fill(NOVO);
    await form.getByLabel('Nome completo').fill('Usuaria E2E Senha Inicial');
    await escolher(page.getByTestId('novo-grupo'), 'SAME');
    await page.getByTestId('novo-senha').fill(SENHA);
    const criacao = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/api/administracao/acesso/usuarios'),
    );
    await page.getByTestId('criar-usuario').click();
    const resposta = await criacao;
    expect(resposta.status()).toBe(201);
    expect(resposta.headers()['cache-control']).toBe('no-store');
    const corpo = (await resposta.json()) as { senhaProvisoria?: string; senhaPendente?: string };
    expect(corpo.senhaPendente).toBeUndefined();
    expect((corpo.senhaProvisoria ?? '').length).toBeGreaterThanOrEqual(12);

    // A senha aparece na mesma tela, a mesma da resposta, com o aviso de que é trocada no primeiro acesso.
    const caixa = page.getByTestId('senha-provisoria');
    await expect(caixa).toBeVisible();
    await expect(page.getByTestId('senha-provisoria-valor')).toHaveText(corpo.senhaProvisoria ?? '');
    await expect(page.getByText(`Usuário ${NOVO} criado.`)).toBeVisible();
    await semViolacaoAxe(page, 'senha inicial do usuário criado');

    // O atalho leva à ficha da conta criada; a senha não fica na tela nem volta na ficha.
    const ficha = page.waitForResponse((r) => r.url().includes(`/api/administracao/acesso/usuarios/${NOVO}`));
    await page.getByTestId('senha-provisoria-ficha').click();
    await expect(page).toHaveURL(new RegExp(`/administracao/acesso/usuarios/${NOVO.replace(/\./g, '\\.')}$`));
    expect(await (await ficha).text()).not.toContain(corpo.senhaProvisoria ?? 'x');
    await esperarValor(page.getByTestId('ficha-grupo'), 'SAME');
    await expect(page.getByTestId('senha-provisoria-valor')).toHaveCount(0);

    // Login repetido: a recusa aparece no formulário e nenhuma senha é mostrada.
    await page.goto('/administracao/acesso/usuarios');
    await page.getByTestId('novo-usuario').click();
    await form.getByLabel('Login').fill(NOVO);
    await form.getByLabel('Nome completo').fill('Usuaria E2E Repetida');
    await escolher(page.getByTestId('novo-grupo'), 'SAME');
    await page.getByTestId('novo-senha').fill(SENHA);
    await page.getByTestId('criar-usuario').click();
    await expect(form.getByRole('alert').first()).toBeVisible();
    await expect(page.getByTestId('senha-provisoria-valor')).toHaveCount(0);
    expect(externas).toEqual([]);
  });

  test('recertificação por grupo: o alvo vem com a contagem e a campanha abre com aquelas contas', async ({
    page,
  }) => {
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/recertificacao');
    await page.getByTestId('recert-abrir').click();
    await escolher(page.getByTestId('recert-escopo'), 'grupo');
    const alvo = page.getByTestId('recert-alvo');
    const rotulos = await rotulosDoCombo(alvo);
    // Só alvos com conta, cada um com a contagem entre parênteses.
    const comContagem = rotulos.filter((r) => /\(\d+\)$/.test(r));
    expect(comContagem.length).toBeGreaterThan(0);
    for (const r of comContagem) expect(Number(/\((\d+)\)$/.exec(r)?.[1])).toBeGreaterThan(0);
    const escolhido = comContagem[0]!;
    const contas = Number(/\((\d+)\)$/.exec(escolhido)?.[1]);
    await escolher(alvo, { indice: rotulos.indexOf(escolhido) });
    await page
      .getByTestId('recert-prazo')
      .fill(new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10));
    const motivo = page.getByTestId('recert-motivo').first();
    await expect(motivo).toBeVisible();
    const direto = ['INPUT', 'TEXTAREA'].includes(await motivo.evaluate((e) => e.tagName));
    await (direto ? motivo : motivo.locator('input, textarea').first()).fill(
      'recertificação do grupo pelo teste',
    );
    await page.getByTestId('recert-senha').fill(SENHA);
    const abertura = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/api/acesso/gestao/recertificacoes'),
    );
    await page.getByTestId('recert-confirmar').click();
    const aberta = await abertura;
    expect(aberta.status()).toBe(200);
    expect(((await aberta.json()) as { itens: number }).itens).toBe(contas);
    await expect(page.getByTestId('recert-aviso')).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-testid^="recert-ver-"]').first().click();
    await expect(page.getByTestId('recert-itens')).toBeVisible();
    await expect(page.locator('[data-testid^="recert-item-"]')).toHaveCount(contas);
    await semViolacaoAxe(page, 'recertificação por grupo');
  });
});
