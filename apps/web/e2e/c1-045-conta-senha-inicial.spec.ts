// E2E @C1-045 (01-ADM L57, ficha F3.9): a conta nasce com a senha inicial numa gravação só.
//  1) Criar o usuário devolve a senha provisória de troca obrigatória na mesma tela, e a ficha da conta criada já mostra
//     a senha definida (a credencial nasceu na mesma transação da conta; nada de conta "sem senha" à espera da ficha).
//  2) A ficha não devolve a senha; a lista mostra a conta com acesso livre.
//  3) Primeiro acesso pela tela: a pessoa entra com o login novo e a provisória, cai na troca obrigatória, a nova senha
//     é aceita e segue para o início (a sessão sintética reconhece a credencial inicial gravada na criação).
// O que fica no banco (conta, vínculo, perfil, credencial de troca obrigatória, histórico na forma "criacao", e o
// primeiro acesso pela provisória no login real) é provado no contrato de efeito operacoes-usuario-propria.int.spec.ts.
// Sessão real sobre a fonte sintética de dev; nenhum dado real.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const NOVO = 'SINT.E2E.C1045';

async function preencherEntrada(page: Page, login: string, senha: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(senha);
  await page.getByTestId('botao-entrar').click();
}

async function entrar(page: Page, login: string): Promise<void> {
  await preencherEntrada(page, login, SENHA);
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Conta criada já com a senha inicial @C1-045 @fase3', () => {
  test.setTimeout(120_000);

  test('criar devolve a provisória de troca obrigatória e a ficha já mostra a senha definida; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/usuarios');
    await expect(page.getByTestId('tabela-usuarios')).toBeVisible();
    await page.getByTestId('novo-usuario').click();
    const form = page.getByTestId('form-novo-usuario');
    await form.getByLabel('Login').fill(NOVO);
    await form.getByLabel('Nome completo').fill('Usuaria E2E Credencial Inicial');
    await escolher(page.getByTestId('novo-grupo'), 'SAME');
    await page.getByTestId('novo-senha').fill(SENHA);
    const criacao = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/api/administracao/acesso/usuarios'),
    );
    await page.getByTestId('criar-usuario').click();
    const resposta = await criacao;
    expect(resposta.status()).toBe(201);
    expect(resposta.headers()['cache-control']).toBe('no-store');
    const corpo = (await resposta.json()) as {
      senhaProvisoria?: string;
      trocaObrigatoria?: boolean;
      senhaPendente?: string;
    };
    expect(corpo.senhaPendente).toBeUndefined();
    expect(corpo.trocaObrigatoria).toBe(true);
    expect((corpo.senhaProvisoria ?? '').length).toBeGreaterThanOrEqual(12);
    await expect(page.getByTestId('senha-provisoria-valor')).toHaveText(corpo.senhaProvisoria ?? '');
    await semViolacaoAxe(page, 'senha inicial da conta criada');

    // A ficha da conta criada: senha definida, sem a pílula "sem senha", e a senha não volta na resposta.
    const ficha = page.waitForResponse((r) => r.url().includes(`/api/administracao/acesso/usuarios/${NOVO}`));
    await page.getByTestId('senha-provisoria-ficha').click();
    await expect(page).toHaveURL(new RegExp(`/administracao/acesso/usuarios/${NOVO.replace(/\./g, '\\.')}$`));
    const corpoFicha = await (await ficha).text();
    expect(corpoFicha).not.toContain(corpo.senhaProvisoria ?? 'x');
    expect(JSON.parse(corpoFicha).usuario?.senhaDefinida).toBe(true);
    await expect(page.getByTestId('ficha-sem-senha')).toHaveCount(0);
    await expect(page.getByTestId('ficha-ir-senhas')).toHaveCount(0);
    await semViolacaoAxe(page, 'ficha da conta criada com senha');

    // (3) Primeiro acesso da pessoa com a provisória: troca obrigatória, nova senha aceita e o início.
    const provisoria = corpo.senhaProvisoria ?? '';
    await page.context().clearCookies();
    await preencherEntrada(page, NOVO, `${provisoria}x`);
    await expect(page.getByTestId('erro-entrar')).toBeVisible();
    await expect(page).toHaveURL(/\/entrar/);
    await preencherEntrada(page, NOVO, provisoria);
    await expect(page).toHaveURL(/\/senha$/);
    await expect(page.getByTestId('form-senha')).toBeVisible();
    await expect(page.getByTestId('senha-indisponivel')).toHaveCount(0);
    // A sessão aberta pela provisória é de troca obrigatória.
    const antes = (await (await page.request.get('/api/sessao')).json()) as { trocaSenha?: string | null };
    expect(antes.trocaSenha).toBeTruthy();
    await semViolacaoAxe(page, 'troca obrigatória no primeiro acesso');
    const nova = `Nova#C1045x${Date.now() % 100000}`;
    await page.getByTestId('senha-atual').fill(provisoria);
    await page.getByTestId('senha-nova').fill(nova);
    await page.getByTestId('senha-confirmacao').fill(nova);
    await page.getByTestId('senha-trocar').click();
    await expect(page.getByTestId('senha-trocada')).toBeVisible({ timeout: 15_000 });
    const continuar = page.getByTestId('senha-continuar');
    if (await continuar.isVisible().catch(() => false)) await continuar.click();
    await expect(page).toHaveURL(/\/inicio/, { timeout: 15_000 });
    expect(externas).toEqual([]);
  });
});
