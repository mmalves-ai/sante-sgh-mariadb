// E2E @C1-045 (01-ADM L57, ficha F3.9): a conta nasce com a senha inicial numa gravação só.
//  1) Criar o usuário devolve a senha provisória de troca obrigatória na mesma tela, e a ficha da conta criada já mostra
//     a senha definida (a credencial nasceu na mesma transação da conta; nada de conta "sem senha" à espera da ficha).
//  2) A ficha não devolve a senha; a lista mostra a conta com acesso livre.
// O que fica no banco (conta, vínculo, perfil, credencial de troca obrigatória, histórico na forma "criacao", e o
// primeiro acesso pela provisória no login real) é provado no contrato de efeito operacoes-usuario-propria.int.spec.ts.
// Sessão real sobre a fonte sintética de dev; nenhum dado real.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const NOVO = 'SINT.E2E.C1045';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
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
    expect(externas).toEqual([]);
  });
});
