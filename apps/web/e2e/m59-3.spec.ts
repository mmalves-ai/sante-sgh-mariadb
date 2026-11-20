// E2E @M59.3 (ficha do M59, etapa 3, F3 imutabilidade clínica no banco e segredos), com axe: a aba "Registros
// clínicos" do painel de contas do banco (quem ainda apaga registro clínico, o plano e as operações); a vista
// "Credenciais guardadas no banco" de Parceiros externos (guardar no cofre a credencial nova com a rotação; com a
// contingência ligada a retirada não aparece e o servidor a recusa); a vista "Senhas secundárias" de Usuários (a
// retirada só depois da contingência: recusada pelo servidor). Sessões reais sobre a fonte sintética e as portas EM
// MEMÓRIA (porta-memoria.ts dos segredos, cofre em memória, contas do banco em memória): nada vai à cópia. Contas
// sintéticas SINT.AUDITOR (auditor), SINT.ADMIN (administrador do sistema) e SINT.GESTOR (gestor de acessos); o valor
// guardado é sintético e nunca volta à tela.
import { expect, test, type Page } from '@playwright/test';
import { ORIGEM, semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const SEM_LEGADO = /SPDATA|legado|sistema atual/i;

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function postar(page: Page, url: string, data: unknown) {
  const csrf = (await page.context().cookies(ORIGEM)).find((c) => c.name === 'sgh_csrf')?.value ?? '';
  return page.request.post(url, {
    data: data as Record<string, unknown>,
    headers: {
      'x-csrf': csrf,
      'idempotency-key': `e2e-m59-3-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
  });
}

test.describe('Imutabilidade clínica e segredos @M59.3 @fase7', () => {
  test.setTimeout(180_000);

  test('aba Registros clínicos do painel de contas do banco: tabelas, plano e operações; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.AUDITOR');
    await page.goto('/administracao/acesso/contas-banco');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Contas do banco de dados e privilégios' }),
    ).toBeVisible();
    await page.getByTestId('contas-aba-imutabilidade').click();
    const painel = page.getByTestId('painel-imutabilidade');
    await expect(painel).toBeVisible();
    await expect(page.getByTestId('imutabilidade-tabelas')).toBeVisible();
    await expect(page.getByTestId('imutabilidade-concessao')).toBeVisible();
    await expect(page.getByTestId('imutabilidade-plano')).toBeVisible();
    await expect(
      page.getByTestId('imutabilidade-titulares').or(page.getByTestId('imutabilidade-titulares-nenhum')),
    ).toBeVisible();
    await expect(
      page.getByTestId('imutabilidade-operacoes').or(page.getByTestId('imutabilidade-operacoes-nenhuma')),
    ).toBeVisible();
    // Só consulta: nenhuma ação de revogar ou aplicar.
    await expect(painel.getByRole('button', { name: /revogar|aplicar|apagar/i })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(SEM_LEGADO);
    await semViolacaoAxe(page, '/administracao/acesso/contas-banco (Registros clínicos, M59.3)');
    // A mesma leitura pelo servidor: o catálogo do Sante não apaga registro clínico.
    const r = await page.request.get('/api/administracao/acesso/contas-banco/imutabilidade');
    expect(r.ok()).toBe(true);
    const corpo = (await r.json()) as {
      operacoesComDelete: unknown[];
      planoComDelete: number;
      tabelasClinicas: { legado: number };
    };
    expect(corpo.operacoesComDelete).toEqual([]);
    expect(corpo.planoComDelete).toBe(0);
    expect(corpo.tabelasClinicas.legado).toBeGreaterThan(0);
    expect(externas).toEqual([]);
  });

  test('credenciais dos parceiros: guardar no cofre com a rotação; retirada recusada na contingência; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/admin/integracoes/parceiros');
    await expect(page.getByTestId('tela-parceiros')).toBeVisible();
    // Pela interface: a escolha da vista.
    await page.getByTestId('parceiros-vista').getByText('Credenciais guardadas no banco').click();
    await expect(page).toHaveURL(/vista=credenciais/);
    await expect(page.getByTestId('segredos-parceiros')).toBeVisible();
    await expect(page.getByTestId('segredos-contingencia')).toContainText('contingência está ligado');
    await expect(page.getByTestId('segredos-resumo')).toBeVisible();
    await expect(page.getByTestId('segredos-resumo-TBCONVEN')).toBeVisible();
    // A exceção registrada (as contas bancárias, lidas pelas rotinas do banco) aparece com rótulo de produto.
    await expect(page.getByTestId('segredos-excecoes')).toBeVisible();
    await semViolacaoAxe(page, '/admin/integracoes/parceiros?vista=credenciais (M59.3)');

    const linha = 'tbconven-cod-901';
    await expect(page.getByTestId(`segredos-linha-${linha}`)).toBeVisible();
    // Com a contingência ligada, a retirada não é oferecida em nenhuma linha.
    await expect(page.locator('[data-testid^="segredos-retirar-"]')).toHaveCount(0);

    // Guardar no cofre a credencial nova (rotação combinada com o parceiro), com a senha de novo.
    await page.getByTestId(`segredos-guardar-${linha}`).click();
    const form = page.getByTestId('form-segredo');
    await expect(form).toBeVisible();
    await page.getByTestId('segredo-valor').fill('valor-sintetico-e2e-m59-3');
    await form.getByText('É nova, já trocada com o parceiro').click();
    await page.getByTestId('segredo-senha').fill(SENHA);
    await semViolacaoAxe(page, '/admin/integracoes/parceiros (guardar no cofre, M59.3)');
    await page.getByTestId('segredo-confirmar').click();
    await expect(form).toHaveCount(0);
    await expect(page.getByTestId(`segredos-situacao-${linha}`)).toContainText(
      'Aguardando o fim do período de contingência',
    );
    await expect(page.getByTestId(`segredos-retirar-${linha}`)).toHaveCount(0);
    // O valor nunca volta à tela nem à resposta.
    await expect(page.locator('body')).not.toContainText('valor-sintetico-e2e-m59-3');
    const lida = await page.request.get('/api/administracao/integracao/segredos-legado');
    expect(lida.ok()).toBe(true);
    expect(await lida.text()).not.toContain('valor-sintetico-e2e-m59-3');
    await expect(page.locator('body')).not.toContainText(SEM_LEGADO);

    // A retirada pelo servidor, com a contingência ligada: recusada (regra 1), nada muda.
    const recusa = await postar(page, '/api/administracao/integracao/segredos-legado/retirar', {
      tabela: 'TBCONVEN',
      chave: 'COD=901',
      senha: SENHA,
    });
    expect(recusa.status()).toBe(409);
    expect(await recusa.text()).toContain('contingencia-ativa');
    await page.reload();
    await expect(page.getByTestId(`segredos-situacao-${linha}`)).toContainText('Aguardando');
    expect(externas).toEqual([]);
  });

  test('senhas secundárias dos usuários: faixas; retirada só depois da contingência; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/usuarios');
    await page.getByTestId('usuarios-vista').getByText('Senhas secundárias').click();
    await expect(page).toHaveURL(/vista=senhas-secundarias/);
    await expect(page.getByTestId('senhas-secundarias')).toBeVisible();
    await expect(page.getByTestId('senhas-sec-resumo')).toBeVisible();
    // Contagem em faixa: abaixo de 5 vem "<5".
    await expect(page.getByTestId('senhas-sec-total')).toHaveText('<5');
    await expect(page.getByTestId('senhas-sec-contingencia')).toBeVisible();
    await expect(page.getByTestId('senhas-sec-linha-SINT.FATURAMENTO')).toBeVisible();
    // Com a contingência ligada, nenhuma retirada é oferecida.
    await expect(page.locator('[data-testid^="senhas-sec-retirar-"]')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(SEM_LEGADO);
    await semViolacaoAxe(page, '/administracao/acesso/usuarios?vista=senhas-secundarias (M59.3)');

    const recusa = await postar(
      page,
      '/api/administracao/acesso/senhas-secundarias/SINT.FATURAMENTO/retirar',
      { senha: SENHA },
    );
    expect(recusa.status()).toBe(409);
    expect(await recusa.text()).toContain('contingencia-ativa');
    await page.reload();
    await expect(page.getByTestId('senhas-sec-linha-SINT.FATURAMENTO')).toBeVisible();
    expect(externas).toEqual([]);
  });
});
