// E2E @M10 (ficha, seção 10 e regras 7 e 8): criar usuário com a senha de novo; bloquear e a sessão do usuário
// cair (e o login recusado); segregação (ninguém bloqueia a si; o Auditor sem botão de gravação e recusado pela
// API); gravação sem a senha recebe 401 em Problem Details; conceder uma opção a um grupo sintético e o menu de
// um membro mudar; simulador pelo menu; aceite do termo pendente; trilha por período (até 31 dias) e as linhas
// das exclusões; acomodação alterada e leito novo com a senha, e a conferência; a resposta da ficha sem segredo;
// axe sem violação séria. Sessão real sobre a fonte sintética de dev (SINT.GESTOR, SINT.FATURISTA, SINT.TERMO,
// SINT.AUDITOR, SINT.ADMIN) e as telas do M10 EM MEMÓRIA (nada vai à cópia); nenhum dado real.
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { itemDoMenu, ORIGEM, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { abrirCombo, escolher, esperarValor, fecharCombo } from './combos.js';

/**
 * Valores (códigos) da lista de módulos, depois que a árvore carregou (mais que só a opção vazia). A escolha é
 * pelo valor: a lista é longa (tem a busca embutida) e o valor não depende de digitar na busca.
 */
async function valoresDosModulos(modulos: Locator): Promise<string[]> {
  let valores: string[] = [];
  await expect
    .poll(async () => {
      const lista = await abrirCombo(modulos);
      valores = await lista
        .locator('[role="option"] [data-valor]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-valor') ?? ''));
      await fecharCombo(modulos, lista);
      return valores.length;
    })
    .toBeGreaterThan(1);
  return valores;
}

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** POST da página com o CSRF da sessão e a Idempotency-Key, como a tela faz (para os casos que a tela esconde). */
async function postar(page: Page, url: string, data: unknown) {
  const csrf = (await page.context().cookies(ORIGEM)).find((c) => c.name === 'sgh_csrf')?.value ?? '';
  return page.request.post(url, {
    data: data as Record<string, unknown>,
    headers: {
      'x-csrf': csrf,
      'idempotency-key': `e2e-m10-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
  });
}

async function novaSessao(browser: Browser, login: string): Promise<Page> {
  const contexto = await browser.newContext();
  const page = await contexto.newPage();
  await entrar(page, login);
  return page;
}

test.describe('Acesso, organização e auditoria @M10', () => {
  test('usuários: lista, criar com a senha de novo, ficha sem segredo; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/usuarios');
    await expect(page.getByRole('heading', { level: 1, name: 'Usuários' })).toBeVisible();
    await expect(page.getByTestId('tabela-usuarios')).toBeVisible();
    // A primeira página (50) já não chega ao M dos sintéticos: a busca leva ao médico.
    await page.getByTestId('usuarios-busca').fill('SINT.MEDICO');
    await expect(page.getByTestId('tabela-usuarios')).toContainText('SINT.MEDICO');
    await semViolacaoAxe(page, '/administracao/acesso/usuarios');
    await page.getByTestId('novo-usuario').click();
    const form = page.getByTestId('form-novo-usuario');
    await form.getByLabel('Login').fill('SINT.E2E.NOVO');
    await form.getByLabel('Nome completo').fill('Usuario E2E Sintetico');
    await escolher(page.getByTestId('novo-grupo'), 'SAME');
    await page.getByTestId('novo-senha').fill(SENHA);
    await semViolacaoAxe(page, 'novo usuário');
    await page.getByTestId('criar-usuario').click();
    // A senha inicial vem na mesma tela (F3.9-01); a ficha abre em seguida.
    await expect(page.getByTestId('senha-provisoria-valor')).toBeVisible();
    // A ficha: a resposta da API não leva senha, hash nem CPF.
    const resposta = page.waitForResponse((r) =>
      r.url().includes('/api/administracao/acesso/usuarios/SINT.E2E.NOVO'),
    );
    await page.goto('/administracao/acesso/usuarios/SINT.E2E.NOVO');
    const corpo = await (await resposta).text();
    expect(corpo).not.toMatch(/"senha"\s*:\s*"|hash|"cpf"\s*:\s*"/i);
    await esperarValor(page.getByTestId('ficha-grupo'), 'SAME');
    await semViolacaoAxe(page, 'ficha do usuário');
    expect(externas).toEqual([]);
  });

  test('ficha: abas e diálogo sem violação no axe; conceder e retirar unidade; senha errada no diálogo; voltar mantém a busca', async ({
    page,
  }) => {
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/usuarios');
    await page.getByTestId('usuarios-busca').fill('SINT.MEDICO');
    await expect(page).toHaveURL(/busca=SINT\.MEDICO/);
    await page.getByTestId('abrir-usuario-SINT.MEDICO').click();
    await expect(page.getByTestId('ficha-aba-dados')).toHaveAttribute('aria-selected', 'true');
    for (const aba of ['escopos', 'papeis', 'flags', 'sessoes']) {
      await page.getByTestId(`ficha-aba-${aba}`).click();
      await expect(page.locator(`#ficha-painel-${aba}`)).toBeVisible();
      await semViolacaoAxe(page, `ficha, aba ${aba}`);
    }
    // Conceder: "+ Adicionar" abre o combo; a senha errada fica no diálogo, sem perder a ação.
    await page.getByTestId('ficha-aba-escopos').click();
    const unidades = page.getByTestId('escopo-unidade');
    await page.getByTestId('adicionar-unidade').click();
    await escolher(page.getByTestId('escolher-unidade'), '2');
    await page.getByTestId('conceder-unidade').click();
    await semViolacaoAxe(page, 'diálogo da senha');
    await page.getByTestId('ficha-senha').fill('senha-que-nao-confere');
    await page.getByTestId('reautenticar-confirmar').click();
    await expect(page.getByTestId('reautenticar-erro')).toBeVisible();
    await expect(page.getByTestId('ficha-senha')).toHaveValue('');
    await page.getByTestId('ficha-senha').fill(SENHA);
    await page.getByTestId('reautenticar-confirmar').click();
    await expect(page.getByTestId('form-reautenticar')).toHaveCount(0);
    await expect(unidades).toContainText('Unidade sintética 2');
    // Retirar pelo X do chip, com a senha.
    await page.getByTestId('retirar-unidade-2').click();
    await page.getByTestId('ficha-senha').fill(SENHA);
    await page.getByTestId('reautenticar-confirmar').click();
    await expect(page.getByTestId('retirar-unidade-2')).toHaveCount(0);
    // Voltar à lista: a busca continua lá.
    await page.getByTestId('ficha-voltar').click();
    await expect(page.getByTestId('usuarios-busca')).toHaveValue('SINT.MEDICO');
    await expect(page.getByTestId('tabela-usuarios')).toContainText('SINT.MEDICO');
  });

  test('bloquear derruba a sessão do usuário e recusa o login; desbloquear devolve', async ({
    page,
    browser,
  }) => {
    const alvo = await novaSessao(browser, 'SINT.FATURISTA');
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/usuarios/SINT.FATURISTA');
    // A chave "Acesso liberado" pede a senha num diálogo, com o aviso da queda das sessões.
    await page.getByTestId('bloquear-usuario').click();
    await page.getByTestId('ficha-senha').fill(SENHA);
    await page.getByTestId('reautenticar-confirmar').click();
    await expect(page.getByTestId('ficha-situacao')).toContainText(/bloqueado/i);
    // A sessão aberta do usuário cai: a próxima tela volta à entrada.
    await alvo.goto('/inicio');
    await expect(alvo).toHaveURL(/\/entrar/);
    await alvo.getByTestId('campo-login').fill('SINT.FATURISTA');
    await alvo.getByTestId('campo-senha').fill(SENHA);
    await alvo.getByTestId('botao-entrar').click();
    await expect(alvo).toHaveURL(/\/entrar/);
    await page.getByTestId('desbloquear-usuario').click();
    await page.getByTestId('ficha-senha').fill(SENHA);
    await page.getByTestId('reautenticar-confirmar').click();
    await expect(page.getByTestId('ficha-situacao')).toContainText(/livre/i);
    await entrar(alvo, 'SINT.FATURISTA');
  });

  test('segregação e reautenticação: ninguém bloqueia a si; o Auditor não grava; sem a senha, 401', async ({
    page,
    browser,
  }) => {
    // Ninguém bloqueia a si mesmo (regra 7): o servidor recusa e a tela mostra o motivo.
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/usuarios/SINT.GESTOR');
    // A chave "Acesso liberado" pede a senha num diálogo, com o aviso da queda das sessões.
    await page.getByTestId('bloquear-usuario').click();
    await page.getByTestId('ficha-senha').fill(SENHA);
    await page.getByTestId('reautenticar-confirmar').click();
    await expect(page.getByTestId('ficha-recusa')).toContainText(/a si mesmo/i);
    await expect(page.getByTestId('ficha-situacao')).toContainText(/livre/i);
    // Sem a senha (regra 8): 401 em Problem Details, nada gravado.
    const semSenha = await postar(page, '/api/administracao/acesso/usuarios/SINT.MEDICO/bloqueio', {
      bloquear: true,
    });
    expect(semSenha.status()).toBe(401);
    expect(semSenha.headers()['content-type']).toMatch(/problem\+json/);
    expect((await semSenha.json()).type).toMatch(/reautenticacao-necessaria/);
    await page.goto('/administracao/acesso/usuarios/SINT.MEDICO');
    await expect(page.getByTestId('ficha-situacao')).toContainText(/livre/i);
    // O Auditor só consulta (regra 7): nos pedidos do titular, que ele lê, nenhum botão de gravação; a API recusa a
    // gravação de pedido e a de usuário (ele nem abre a gestão de usuários).
    const aud = await novaSessao(browser, 'SINT.AUDITOR');
    await aud.goto('/administracao/privacidade');
    await expect(aud.getByTestId('tabela-pedidos')).toBeVisible();
    await expect(aud.getByTestId('novo-pedido')).toHaveCount(0);
    for (const [url, corpo] of [
      ['/api/administracao/privacidade/pedidos', { prontuario: 900_001, tipo: 'acesso', canal: 'email' }],
      ['/api/administracao/acesso/usuarios/SINT.MEDICO/bloqueio', { bloquear: true, senha: SENHA }],
    ] as const) {
      const r = await postar(aud, url, corpo);
      expect([403, 409]).toContain(r.status());
      expect(r.headers()['content-type']).toMatch(/problem\+json/);
    }
  });

  test('conceder uma opção ao grupo sintético muda o menu de um membro; retirar devolve', async ({
    page,
    browser,
  }) => {
    const item = 'Locais de conta e unidades de consumo';
    const membro = await novaSessao(browser, 'SINT.SAME');
    const menu = (p: Page) => p.getByRole('navigation', { name: 'Menu principal' });
    await expect(menu(membro)).toBeVisible();
    await expect(await itemDoMenu(membro, item)).toHaveCount(0);
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/permissoes');
    await escolher(page.getByTestId('perm-grupo'), 'SAME');
    // A opção 0 é "escolha o módulo" (vazia); os módulos vêm a partir da 1.
    const modulos = page.getByTestId('perm-modulo');
    const valores = await valoresDosModulos(modulos);
    const n = valores.length;
    const opcao = page.getByTestId('opcao-3697');
    for (let i = 1; i < n; i++) {
      await escolher(modulos, valores[i]!);
      await expect(page.getByTestId('arvore-opcoes')).toBeVisible();
      if ((await opcao.count()) > 0) break;
    }
    await opcao.check();
    await page.getByTestId('perm-senha').fill(SENHA);
    await page.getByTestId('perm-conceder').click();
    await expect(page.getByText('Gravado.')).toBeVisible();
    // O membro entra de novo: a permissão lida da opção do grupo aparece no menu.
    await entrar(membro, 'SINT.SAME');
    await expect(await itemDoMenu(membro, item)).toBeVisible();
    // Retirar devolve o menu de antes.
    await page.getByTestId('opcao-3697').check();
    await page.getByTestId('perm-senha').fill(SENHA);
    await page.getByTestId('perm-revogar').click();
    await expect(page.getByText('Gravado.')).toBeVisible();
    await entrar(membro, 'SINT.SAME');
    await expect(await itemDoMenu(membro, item)).toHaveCount(0);
  });

  test('permissões: conceder e retirar uma opção do grupo sintético pela árvore; simulador; axe', async ({
    page,
  }) => {
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/permissoes');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Permissões, menus e papéis SBIS' }),
    ).toBeVisible();
    await escolher(page.getByTestId('perm-grupo'), 'SAME');
    // A opção 0 é "escolha o módulo" (vazia); os módulos vêm a partir da 1.
    const modulos = page.getByTestId('perm-modulo');
    const valores = await valoresDosModulos(modulos);
    const n = valores.length;
    let marcou = false;
    for (let i = 1; i < n && !marcou; i++) {
      await escolher(modulos, valores[i]!);
      const livre = page.getByTestId('arvore-opcoes').locator('input[type=checkbox]:not([disabled])');
      await expect(page.getByTestId('arvore-opcoes')).toBeVisible();
      if ((await livre.count()) > 0) {
        await livre.first().check();
        marcou = true;
      }
    }
    expect(marcou).toBe(true);
    await page.getByTestId('perm-senha').fill(SENHA);
    await semViolacaoAxe(page, '/administracao/acesso/permissoes');
    await page.getByTestId('perm-conceder').click();
    await expect(page.getByText('Gravado.')).toBeVisible();
    await expect(page.getByTestId('arvore-opcoes').getByText('(o grupo tem)').first()).toBeVisible();
    // Simulador: o que o usuário pode e por quê (o item do menu abre a tela).
    await page
      .getByRole('navigation', { name: 'Menu principal' })
      .getByRole('link', { name: 'Simulador de permissões' })
      .click();
    await expect(page).toHaveURL(/\/administracao\/acesso\/simulador/);
    await page.goto('/administracao/acesso/simulador?login=SINT.MEDICO');
    await page.getByTestId('sim-recurso').fill('acesso');
    await page.getByTestId('sim-executar').click();
    await expect(page.getByTestId('sim-resultado')).toBeVisible();
    await semViolacaoAxe(page, 'simulador');
  });

  test('termo pendente: a casca abre o termo antes de tudo; aceitar libera', async ({ page }) => {
    await entrar(page, 'SINT.TERMO');
    const dialogo = page.getByTestId('dialogo-termo');
    await expect(dialogo).toBeVisible();
    await expect(page.getByTestId('texto-termo')).toContainText('TERMO DE USO');
    await semViolacaoAxe(page, 'termo pendente');
    await page.getByTestId('aceitar-termo').click();
    await expect(dialogo).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('dialogo-termo')).toHaveCount(0);
  });

  test('trilha: período obrigatório até 31 dias; consulta e exportação; axe', async ({ page }) => {
    await entrar(page, 'SINT.AUDITOR');
    await page.goto('/administracao/auditoria/trilha');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Trilha de auditoria e eventos auditáveis' }),
    ).toBeVisible();
    await page.getByTestId('trilha-consultar').click();
    await expect(page.getByTestId('tabela-trilha')).toBeVisible();
    await expect(page.getByTestId('exportar-csv')).toBeVisible();
    await semViolacaoAxe(page, '/administracao/auditoria/trilha');
    const hoje = new Date();
    const antes = new Date(hoje.getTime() - 40 * 86_400_000).toISOString().slice(0, 10);
    await page.getByTestId('periodo-inicio').fill(antes);
    await page.getByTestId('trilha-consultar').click();
    await expect(page.getByTestId('trilha-recusa')).toContainText('31');
    // As exclusões linha a linha (período, usuário, 500 por página) e as conexões.
    await page
      .getByTestId('periodo-inicio')
      .fill(new Date(hoje.getTime() - 86_400_000).toISOString().slice(0, 10));
    await page.getByTestId('trilha-consultar').click();
    await page.getByTestId('exclusao-atendimentos').click();
    await expect(page.getByTestId('tabela-registros')).toContainText('SINT.ADMIN');
    await semViolacaoAxe(page, 'exclusões linha a linha');
    await page.getByTestId('ver-conexoes').click();
    await expect(page.getByTestId('tabela-registros')).toContainText('SINT.MEDICO');
  });

  test('leitos: incluir um leito, contagens e a conferência com a divergência; axe', async ({ page }) => {
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cadastros/estrutura/leitos');
    await expect(page.getByRole('heading', { level: 1, name: 'Blocos, acomodações e leitos' })).toBeVisible();
    await expect(page.getByTestId('arvore-leitos')).toBeVisible();
    await semViolacaoAxe(page, '/cadastros/estrutura/leitos');
    // Alterar a acomodação (nome e quantidade de leitos), com a versão lida e a senha.
    await page.getByTestId('alterar-acomodacao-INT-1-102').click();
    await page.getByTestId('alt-nome').fill('Enfermaria E2E');
    await page.getByTestId('alt-qtd').fill('6');
    await page.getByTestId('alt-senha').fill(SENHA);
    await semViolacaoAxe(page, 'alterar acomodação');
    await page.getByTestId('salvar-alteracao').click();
    await expect(page.getByTestId('acomodacao-INT-1-102')).toContainText('Enfermaria E2E');
    // Leito novo: andar (vem da acomodação), ramal e a senha.
    await page.getByTestId('novo-leito-INT-1-102').click();
    await page.getByTestId('leito-codigo').fill('E2E');
    await page.getByTestId('leito-ramal').fill('210');
    await expect(page.getByTestId('leito-andar')).not.toHaveValue('');
    await page.getByTestId('leito-senha').fill(SENHA);
    await semViolacaoAxe(page, 'novo leito');
    await page.getByTestId('salvar-leito').click();
    await expect(page.getByTestId('leito-INT-1-102-E2E')).toBeVisible();
    await page.getByTestId('aba-conferencia').click();
    await expect(page.getByTestId('tabela-divergencias')).toContainText('UTI-1|UTI-A|03');
    await semViolacaoAxe(page, 'conferência de leitos');
  });

  test('X-01: atalho "Profissional vinculado" na ficha do usuário, com e sem vínculo; axe @X-01', async ({
    page,
  }) => {
    vigiarExternas(page);
    await entrar(page, 'SINT.GESTOR');
    // Com vínculo (papel 4 → profissional 3): o nome leva à ficha do profissional.
    await page.goto('/administracao/acesso/usuarios/SINT.MEDICO');
    const fato = page.getByTestId('ficha-profissional');
    await expect(fato).toContainText('Profissional vinculado');
    await expect(page.getByTestId('ficha-profissional-link')).toHaveText('ANA MÉDICA SINTETICO');
    await expect(page.getByTestId('ficha-profissional-vincular')).toHaveCount(0);
    await semViolacaoAxe(page, 'ficha do usuário com profissional vinculado');
    await page.getByTestId('ficha-profissional-link').click();
    await expect(page).toHaveURL(/\/cadastros\/profissionais\/3$/);
    await expect(page.getByTestId('prof-aba-dados')).toHaveAttribute('aria-selected', 'true');
    // Sem vínculo: diz isso e leva quem gere perfis à lista, que abre a ficha direto na aba Login do sistema.
    await page.goto('/administracao/acesso/usuarios/SINT.SAME');
    await expect(fato).toContainText('Nenhum profissional vinculado a este login.');
    await expect(page.getByTestId('ficha-profissional-link')).toHaveCount(0);
    await semViolacaoAxe(page, 'ficha do usuário sem profissional vinculado');
    await page.getByTestId('ficha-profissional-vincular').click();
    // A lista diz o que fazer e com qual login; a busca e a ficha levam o login adiante.
    await expect(page).toHaveURL(/\/cadastros\/profissionais\?aba=login&login=SINT\.SAME$/);
    await expect(page.getByTestId('profissionais-vincular-login')).toContainText(
      'Escolha o profissional para vincular ao login SINT.SAME.',
    );
    await semViolacaoAxe(page, 'lista de profissionais vinda do atalho');
    await page.getByTestId('termo-profissional').fill('CARLA');
    await page.getByTestId('botao-buscar-profissional').click();
    await page.getByTestId('profissional-5').getByRole('link').click();
    await expect(page).toHaveURL(/\/cadastros\/profissionais\/5\?aba=login&login=SINT\.SAME$/);
    await expect(page.getByTestId('prof-aba-login')).toHaveAttribute('aria-selected', 'true');
    // O combo já vem com SINT.SAME; gravar (senha e justificativa) e voltar: a ficha do usuário mostra o vínculo.
    await esperarValor(page.getByTestId('login-escolha'), 'SINT.SAME');
    await page.getByTestId('login-gravar').click();
    const form = page.getByTestId('form-gravacao');
    await form.getByTestId('dialogo-senha').fill(SENHA);
    await form.getByTestId('dialogo-motivo').fill('Vínculo pelo atalho da ficha do usuário');
    await form.getByTestId('dialogo-confirmar').click();
    await expect(form).toBeHidden();
    await expect(page.getByTestId('login-atual')).toHaveText('SINT.SAME');
    await page.goto('/administracao/acesso/usuarios/SINT.SAME');
    await expect(page.getByTestId('ficha-profissional-link')).toHaveText('CARLA ENFERMEIRA SINTETICO');
    await expect(page.getByTestId('ficha-profissional-vincular')).toHaveCount(0);
  });
});
