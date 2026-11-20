// E2E @W1-01 (programa CRUD completo: acesso — senha, usuário, grupos, política, termo e ciclo de vida dos acessos).
// Revisão (achado 6): cada tela do pacote é exercida no navegador com a API e a web reais (portas do pacote), cobrindo
// incluir, alterar e inativar/bloquear/retirar, com a senha de novo no diálogo. Sessão real sobre a fonte sintética e as
// portas em MEMÓRIA (dados SINTÉTICOS; nada vai à cópia). A gravação é conferida pela tela (aviso, linha da tabela) e,
// quando a lista vem de outra fonte (grupos), pela API da sessão.
import { expect, type Locator, type Page, test } from '@playwright/test';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const marca = Date.now().toString(36).slice(-5).toUpperCase();

/**
 * Entra pela tela com a senha. `noPosto`: mantém o cookie do posto (a mesma máquina; troca rápida por PIN exige que a
 * pessoa tenha entrado com a senha hoje NESTE posto) e descarta só a sessão anterior.
 */
async function entrar(page: Page, login: string, senha = SENHA, noPosto = false): Promise<void> {
  const ctx = page.context();
  const posto = noPosto ? (await ctx.cookies()).filter((c) => c.name.endsWith('sgh_posto')) : [];
  await ctx.clearCookies();
  if (posto.length) await ctx.addCookies(posto);
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(senha);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
  const entendi = page.getByTestId('aviso-entendi');
  await entendi.waitFor({ state: 'visible', timeout: 4_000 }).catch(() => undefined);
  if (await entendi.isVisible()) {
    await entendi.click();
    await expect(entendi).toHaveCount(0);
  }
}

/** O campo de digitar sob o data-testid (no próprio input ou no invólucro do SanteCampoTexto). */
async function campo(page: Page | Locator, id: string): Promise<Locator> {
  const el = page.getByTestId(id).first();
  await expect(el).toBeVisible();
  const tag = await el.evaluate((e) => e.tagName);
  return tag === 'INPUT' || tag === 'TEXTAREA' ? el : el.locator('input, textarea').first();
}

async function preencher(page: Page | Locator, id: string, valor: string): Promise<void> {
  await (await campo(page, id)).fill(valor);
}

/** Requisição pela sessão do navegador (CSRF do cookie e uma Idempotency-Key). */
async function chamar(
  page: Page,
  metodo: 'GET' | 'POST',
  url: string,
  corpo?: unknown,
): Promise<{ status: number; corpo: Record<string, unknown> & unknown[] }> {
  return page.evaluate(
    async ([m, u, c]) => {
      const csrf = /(?:^|;\s*)sgh_csrf=([^;]+)/.exec(document.cookie)?.[1] ?? '';
      const resp = await fetch(u as string, {
        method: m as string,
        headers: {
          accept: 'application/json',
          ...(m === 'POST'
            ? {
                'content-type': 'application/json',
                'x-csrf': csrf,
                'idempotency-key': `e2e.w101.${Math.random().toString(36).slice(2)}`,
              }
            : {}),
        },
        ...(m === 'POST' ? { body: JSON.stringify(c) } : {}),
      });
      return { status: resp.status, corpo: await resp.json().catch(() => ({})) };
    },
    [metodo, url, corpo] as const,
  );
}

/** CPF válido sintético (dígitos verificadores calculados), diferente a cada execução. */
function cpfSintetico(): string {
  const base = Array.from({ length: 9 }, (_, i) => ((Date.now() / 10 ** i) % 10) | 0);
  if (new Set(base).size === 1) base[0] = (base[0]! + 1) % 10;
  const dv = (d: number[]) => {
    const r = (d.reduce((a, x, i) => a + x * (d.length + 1 - i), 0) * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(base);
  const d2 = dv([...base, d1]);
  return [...base, d1, d2].join('');
}

/** O diálogo único da gravação da ficha: motivo (quando pedido) e a senha de novo. */
async function gravarNaFicha(page: Page, motivo = 'ajuste pedido pelo setor'): Promise<void> {
  await expect(page.getByTestId('form-reautenticar')).toBeVisible();
  const m = page.getByTestId('dialogo-motivo');
  if (await m.isVisible()) await preencher(page, 'dialogo-motivo', motivo);
  await page.getByTestId('ficha-senha').fill(SENHA);
  await page.getByTestId('reautenticar-confirmar').click();
  await expect(page.getByTestId('form-reautenticar')).toHaveCount(0, { timeout: 15_000 });
}

test.describe('W1-01: telas do acesso com incluir, alterar e inativar @W1-01', () => {
  test('grupos: incluir, descrever e trocar a descrição, renomear, inativar, reativar e excluir pela tela', async ({
    page,
  }) => {
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/grupos');
    const nome = `E2E_${marca}`;
    // Incluir.
    await preencher(page, 'grupos-novo-nome', nome);
    await page.getByTestId('grupos-criar').click();
    await page.getByTestId('grupos-senha').fill(SENHA);
    await page.getByTestId('grupos-confirmar').click();
    await expect(page.getByTestId('grupos-aviso')).toBeVisible();
    await expect(page.getByTestId(`grupo-renomear-${nome}`)).toBeVisible({ timeout: 15_000 });
    // Alterar: descrição (versão 1 e 2) e renomear.
    for (const texto of ['Grupo do teste ponta a ponta', 'Grupo do teste ponta a ponta (revisto)']) {
      await page.getByTestId(`grupo-descrever-${nome}`).click();
      await preencher(page, 'grupos-descricao', texto);
      await preencher(page, 'grupos-descricao-motivo', 'descrição do grupo de teste');
      await page.getByTestId('grupos-senha').fill(SENHA);
      await page.getByTestId('grupos-confirmar').click();
      await expect(page.getByTestId('grupos-aviso')).toBeVisible();
    }
    const descr = await chamar(page, 'GET', `/api/acesso/gestao/grupos/${nome}/descricoes`);
    expect(descr.status).toBe(200);
    expect(JSON.stringify(descr.corpo)).toContain('(revisto)');
    // Inativar e reativar.
    await page.getByTestId(`grupo-desativar-${nome}`).click();
    await page.getByTestId('grupos-senha').fill(SENHA);
    await page.getByTestId('grupos-confirmar').click();
    await expect(page.getByTestId(`grupo-reativar-${nome}`)).toBeVisible({ timeout: 15_000 });
    await page.getByTestId(`grupo-reativar-${nome}`).click();
    await page.getByTestId('grupos-senha').fill(SENHA);
    await page.getByTestId('grupos-confirmar').click();
    await expect(page.getByTestId(`grupo-desativar-${nome}`)).toBeVisible({ timeout: 15_000 });
    // Renomear (nenhum login nem opção usa o grupo novo).
    const novo = `${nome}_R`;
    await page.getByTestId(`grupo-renomear-${nome}`).click();
    await preencher(page, 'grupos-renomear-nome', novo);
    await page.getByTestId('grupos-senha').fill(SENHA);
    await page.getByTestId('grupos-confirmar').click();
    await expect(page.getByTestId('grupos-aviso')).toBeVisible();
    await expect(page.getByTestId(`grupo-renomear-${novo}`)).toBeVisible({ timeout: 15_000 });
    const levada = await chamar(page, 'GET', `/api/acesso/gestao/grupos/${novo}/descricoes`);
    expect(JSON.stringify(levada.corpo)).toContain('(revisto)');
    // Excluir o grupo nunca usado (com motivo).
    await page.getByTestId(`grupo-excluir-${novo}`).click();
    await preencher(page, 'grupos-motivo', 'criado só para o teste');
    await page.getByTestId('grupos-senha').fill(SENHA);
    await page.getByTestId('grupos-confirmar').click();
    await expect(page.getByTestId(`grupo-renomear-${novo}`)).toHaveCount(0, { timeout: 15_000 });
  });

  test('política de senha: publicar (incluir), nova versão (alterar), cancelar a agendada (inativar); limite de sessões incluir, alterar e retirar', async ({
    page,
  }) => {
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/politica-senha');
    for (const [minimo, motivo] of [
      ['10', 'política inicial do teste'],
      ['12', 'aperto do tamanho mínimo'],
    ] as const) {
      await page.getByTestId('politica-senha-publicar').click();
      await page.getByTestId('politica-senha-minimo').fill(minimo);
      await preencher(page, 'politica-senha-motivo', motivo);
      await page.getByTestId('politica-senha-senha').fill(SENHA);
      await page.getByTestId('politica-senha-confirmar').click();
      await expect(page.getByTestId('politica-senha-aviso')).toBeVisible();
    }
    await expect(page.getByTestId('politica-senha-efetiva')).toContainText('12');
    // Uma versão agendada (amanhã) entra pela API da sessão; a tela a cancela com motivo.
    const amanha = new Date(Date.now() + 2 * 86_400_000);
    amanha.setHours(0, 0, 0, 0);
    const ag = await chamar(page, 'POST', '/api/acesso/gestao/politica-senha', {
      minimoCaracteres: 14,
      exigeEspecial: false,
      exigeMinuscula: false,
      exigeMaiuscula: false,
      trocaDias: 0,
      reusoDias: 0,
      recusaNome: false,
      recusaNascimento: false,
      recusaComuns: false,
      senhasProibidas: [],
      vigenteDesde: amanha.toISOString(),
      motivo: 'versão agendada do teste',
      senha: SENHA,
    });
    expect(ag.status, JSON.stringify(ag.corpo)).toBeLessThan(300);
    const versao = Number((ag.corpo as { versao?: number }).versao);
    await page.reload();
    await page.getByTestId(`politica-senha-cancelar-${versao}`).click();
    await preencher(page, 'politica-senha-motivo', 'agendada por engano');
    await page.getByTestId('politica-senha-senha').fill(SENHA);
    await page.getByTestId('politica-senha-confirmar').click();
    await expect(page.getByTestId(`politica-senha-cancelar-${versao}`)).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId(`politica-senha-estado-${versao}`)).toContainText('agendada por engano');

    // Limite de sessões simultâneas por perfil.
    const lim = page.getByTestId('limites-sessao');
    await lim.getByTestId('limites-sessao-incluir').click();
    await escolher(page.getByTestId('limites-sessao-perfil'), 'auditor');
    await page.getByTestId('limites-sessao-limite').fill('2');
    await preencher(page, 'limites-sessao-motivo', 'auditor em uma estação por vez');
    await page.getByTestId('limites-sessao-senha').fill(SENHA);
    await page.getByTestId('limites-sessao-confirmar').click();
    await expect(page.getByTestId('limite-sessao-auditor')).toContainText('2', { timeout: 15_000 });
    await page.getByTestId('limite-sessao-alterar-auditor').click();
    await page.getByTestId('limites-sessao-limite').fill('3');
    await preencher(page, 'limites-sessao-motivo', 'auditoria com notebook');
    await page.getByTestId('limites-sessao-senha').fill(SENHA);
    await page.getByTestId('limites-sessao-confirmar').click();
    await expect(page.getByTestId('limite-sessao-auditor')).toContainText('3', { timeout: 15_000 });
    await page.getByTestId('limite-sessao-retirar-auditor').click();
    await preencher(page, 'limites-sessao-motivo', 'sem limite próprio');
    await page.getByTestId('limites-sessao-senha').fill(SENHA);
    await page.getByTestId('limites-sessao-confirmar').click();
    await expect(page.getByTestId('limite-sessao-auditor')).toHaveCount(0, { timeout: 15_000 });
  });

  test('contas dormentes: exceção justificada incluída, alterada e retirada', async ({ page }) => {
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/contas-dormentes');
    const ate = (dias: number) => new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);
    await page.getByTestId('dormentes-incluir').click();
    await escolher(page.getByTestId('dormentes-login'), 'SINT.MEDICO');
    await page.getByTestId('dormentes-ate').fill(ate(30));
    await preencher(page, 'dormentes-motivo', 'médico em licença de estudo');
    await page.getByTestId('dormentes-senha').fill(SENHA);
    await page.getByTestId('dormentes-confirmar').click();
    await expect(page.getByTestId('dormentes-excecao-SINT.MEDICO')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('dormentes-alterar-SINT.MEDICO').click();
    await page.getByTestId('dormentes-ate').fill(ate(60));
    await preencher(page, 'dormentes-motivo', 'licença prorrogada');
    await page.getByTestId('dormentes-senha').fill(SENHA);
    await page.getByTestId('dormentes-confirmar').click();
    await expect(page.getByTestId('dormentes-excecao-SINT.MEDICO')).toContainText(
      ate(60).split('-').reverse().join('/'),
      { timeout: 15_000 },
    );
    await page.getByTestId('dormentes-retirar-SINT.MEDICO').click();
    await preencher(page, 'dormentes-motivo', 'voltou da licença');
    await page.getByTestId('dormentes-senha').fill(SENHA);
    await page.getByTestId('dormentes-confirmar').click();
    await expect(page.getByTestId('dormentes-excecao-SINT.MEDICO')).toHaveCount(0, { timeout: 15_000 });
  });

  test('senha: a troca da própria senha pela SenhaTela grava (primeiro acesso vai à troca e segue para o sistema)', async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.goto('/entrar');
    await page.getByTestId('campo-login').fill('SINT.TEXTOPURO');
    await page.getByTestId('campo-senha').fill('Textopuro#2026');
    await page.getByTestId('botao-entrar').click();
    await expect(page).toHaveURL(/\/senha$/);
    await expect(page.getByTestId('senha-indisponivel')).toHaveCount(0);
    const nova = `Nova#${marca}x2026`;
    await page.getByTestId('senha-atual').fill('Textopuro#2026');
    await page.getByTestId('senha-nova').fill(nova);
    await page.getByTestId('senha-confirmacao').fill(nova);
    await page.getByTestId('senha-trocar').click();
    await expect(page.getByTestId('senha-trocada')).toBeVisible({ timeout: 15_000 });
    // A troca obrigatória foi cumprida: a sessão segue para o sistema (a nova senha foi gravada pela porta da troca).
    const continuar = page.getByTestId('senha-continuar');
    if (await continuar.isVisible().catch(() => false)) await continuar.click();
    await expect(page).toHaveURL(/\/inicio/, { timeout: 15_000 });
  });

  test('ficha do usuário: troca de CPF com justificativa, flags alteradas, senha provisória, bloquear e desbloquear', async ({
    page,
  }) => {
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/usuarios');
    await page.getByTestId('usuarios-busca').fill('SINT.MEDICO');
    await page.getByTestId('abrir-usuario-SINT.MEDICO').click();
    await expect(page.getByTestId('ficha-aba-dados')).toHaveAttribute('aria-selected', 'true');
    // Alterar o CPF: justificativa obrigatória.
    const cpf = cpfSintetico();
    await preencher(page, 'ficha-cpf-novo', cpf);
    await preencher(page, 'ficha-cpf-justificativa', 'CPF digitado errado no cadastro');
    await page.getByTestId('trocar-cpf').click();
    await gravarNaFicha(page, 'CPF digitado errado no cadastro');
    await expect(page.getByTestId('ficha-aviso')).toBeVisible({ timeout: 15_000 });
    // Alterar as flags: a primeira chave editável muda e é gravada.
    await page.getByTestId('ficha-aba-flags').click();
    const chave = page.locator('#ficha-painel-flags button[role="switch"]:not([disabled])').first();
    await expect(chave).toBeVisible();
    const antes = await chave.getAttribute('aria-checked');
    await chave.click();
    await expect(page.getByTestId('flags-pendentes')).toBeVisible();
    await page.getByTestId('flags-salvar').click();
    await gravarNaFicha(page, 'ajuste da flag pedido pelo setor');
    await expect(page.getByTestId('flags-pendentes')).toHaveCount(0, { timeout: 15_000 });
    await page.reload();
    await page.getByTestId('ficha-aba-flags').click();
    await expect(
      page.locator('#ficha-painel-flags button[role="switch"]:not([disabled])').first(),
    ).not.toHaveAttribute('aria-checked', antes ?? '');
    // Senha provisória pelo gestor (troca obrigatória no próximo acesso); mostrada uma vez.
    await page.getByTestId('ficha-aba-dados').click();
    await page.getByTestId('redefinir-senha').click();
    await gravarNaFicha(page, 'usuário esqueceu a senha');
    await expect(page.getByTestId('senha-provisoria-valor')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('senha-provisoria-fechar').click();
    // Bloquear (a "exclusão" de quem já operou) e desbloquear.
    await page.getByTestId('bloquear-usuario').click();
    await gravarNaFicha(page, 'afastado do serviço');
    await expect(page.getByTestId('desbloquear-usuario')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('desbloquear-usuario').click();
    await gravarNaFicha(page, 'voltou ao serviço');
    await expect(page.getByTestId('bloquear-usuario')).toBeVisible({ timeout: 15_000 });
  });

  test('segurança: PIN da troca rápida definido, trocado e retirado; minhas sessões encerra as outras', async ({
    page,
    browser,
  }) => {
    // Uma segunda sessão do mesmo usuário (outro navegador) para "encerrar as outras".
    const outro = await browser.newContext();
    const p2 = await outro.newPage();
    await entrar(p2, 'SINT.USUARIO');
    await entrar(page, 'SINT.USUARIO');
    await page.goto('/preferencias/seguranca');
    const sessoes = page.getByTestId('minhas-sessoes');
    await expect(sessoes.locator('[data-testid^="sessao-encerrar-"]').first()).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId('sessoes-encerrar-outras').click();
    const confirmar = page.getByRole('dialog').last();
    if (await confirmar.isVisible().catch(() => false)) await confirmar.getByRole('button').last().click();
    await expect(page.getByTestId('sessoes-aviso')).toBeVisible({ timeout: 15_000 });
    await p2.reload();
    await expect(p2).toHaveURL(/\/entrar/, { timeout: 15_000 });
    await outro.close();

    // PIN: incluir, alterar e retirar.
    const pin = page.getByTestId('meu-pin');
    for (const valor of ['384716', '519384']) {
      await pin.getByTestId('pin-definir').click();
      await page.getByTestId('pin-novo').fill(valor);
      await page.getByTestId('pin-confirmacao').fill(valor);
      await page.getByTestId('pin-senha-definir').fill(SENHA);
      await page.getByTestId('pin-gravar').click();
      await expect(page.getByTestId('pin-aviso')).toBeVisible({ timeout: 15_000 });
    }
    await pin.getByTestId('pin-retirar').click();
    await page.getByTestId('pin-senha-retirar').fill(SENHA);
    await page.getByTestId('pin-confirmar-retirar').click();
    await expect(page.getByTestId('pin-aviso')).toBeVisible({ timeout: 15_000 });
    await expect(pin.getByTestId('pin-retirar')).toHaveCount(0);
  });

  test('pedidos de acesso: pedir, aprovar em dois níveis (concedido), recusar e cancelar', async ({
    page,
  }) => {
    test.setTimeout(120_000); // seis entradas de usuários diferentes
    const pedir = async (motivo: string, indice: number): Promise<string> => {
      await page.goto('/preferencias/pedidos-acesso');
      await page.getByTestId('mp-pedir').click();
      await escolher(page.getByTestId('mp-perfil'), { indice });
      await escolher(page.getByTestId('mp-setor'), { indice: 0 });
      await page.getByTestId('mp-fim').fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
      await preencher(page, 'mp-motivo', motivo);
      const s = page.getByTestId('mp-senha');
      if (await s.isVisible().catch(() => false)) await s.fill(SENHA);
      await page.getByTestId('mp-confirmar').click();
      await expect(page.getByTestId('mp-aviso')).toBeVisible({ timeout: 15_000 });
      const linha = page.locator('[data-testid^="mp-pedido-"]').filter({ hasText: motivo }).first();
      await expect(linha).toBeVisible();
      return ((await linha.getAttribute('data-testid')) ?? '').replace('mp-pedido-', '');
    };
    const decidir = async (login: string, id: string, acao: 'aprovar' | 'recusar') => {
      await entrar(page, login);
      await page.goto('/administracao/acesso/pedidos');
      await page.getByTestId(`pg-${acao}-${id}`).click();
      if (acao === 'recusar') await preencher(page, 'pg-motivo', 'perfil não cabe na função');
      await page.getByTestId('pg-senha').fill(SENHA);
      await page.getByTestId('pg-confirmar').click();
      await expect(page.getByTestId('pg-aviso')).toBeVisible({ timeout: 15_000 });
    };
    await entrar(page, 'SINT.USUARIO');
    const a = await pedir(`cobrir o plantão ${marca}`, 0);
    await decidir('SINT.GESTOR', a, 'aprovar');
    await decidir('SINT.VINCULOS', a, 'aprovar');
    await entrar(page, 'SINT.USUARIO');
    await page.goto('/preferencias/pedidos-acesso');
    await expect(page.getByTestId(`mp-pedido-${a}`)).toContainText(/[Cc]oncedido/);
    // Cancelar um pedido em andamento (alterar a situação pelo solicitante).
    await entrar(page, 'SINT.USUARIO');
    const b = await pedir(`auditoria do mês ${marca}`, 1);
    await page.getByTestId(`mp-cancelar-${b}`).click();
    await preencher(page, 'mp-motivo', 'não preciso mais do perfil');
    await page.getByTestId('mp-senha').fill(SENHA);
    await page.getByTestId('mp-confirmar').click();
    await expect(page.getByTestId(`mp-cancelar-${b}`)).toHaveCount(0, { timeout: 15_000 });
    // Recusar (o gestor fecha o pedido com motivo).
    const c = await pedir(`acesso eventual ${marca}`, 2);
    await decidir('SINT.GESTOR', c, 'recusar');
  });

  test('recertificação: abrir campanha, manter e retirar (bloqueio), encerrar', async ({ page }) => {
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/recertificacao');
    await page.getByTestId('recert-abrir').click();
    await escolher(page.getByTestId('recert-escopo'), 'todos');
    await page
      .getByTestId('recert-prazo')
      .fill(new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10));
    await preencher(page, 'recert-motivo', 'recertificação semestral do teste');
    await page.getByTestId('recert-senha').fill(SENHA);
    await page.getByTestId('recert-confirmar').click();
    await expect(page.getByTestId('recert-aviso')).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-testid^="recert-ver-"]').first().click();
    await expect(page.getByTestId('recert-itens')).toBeVisible();
    // Manter.
    await page.getByTestId('recert-manter-SINT.MEDICO').click();
    await preencher(page, 'recert-motivo', 'continua na mesma função');
    await page.getByTestId('recert-senha').fill(SENHA);
    await page.getByTestId('recert-confirmar').click();
    await expect(page.getByTestId('recert-item-SINT.MEDICO')).toContainText(/[Mm]anter|[Mm]antid/, {
      timeout: 15_000,
    });
    // Retirar: o efeito é o bloqueio da conta.
    await page.getByTestId('recert-retirar-SINT.RESIDENTE').click();
    const decisao = page.getByTestId('recert-decisao');
    if (await decisao.isVisible().catch(() => false)) await escolher(decisao, { indice: 0 });
    await preencher(page, 'recert-motivo', 'residência terminou');
    await page.getByTestId('recert-senha').fill(SENHA);
    await page.getByTestId('recert-confirmar').click();
    await expect(page.getByTestId('recert-item-SINT.RESIDENTE')).toContainText(/[Rr]etir/, {
      timeout: 15_000,
    });
    // Encerrar a campanha (as pendentes ficam registradas).
    await page.getByTestId('recert-encerrar').click();
    await preencher(page, 'recert-motivo', 'prazo da campanha encerrado');
    await page.getByTestId('recert-senha').fill(SENHA);
    await page.getByTestId('recert-confirmar').click();
    await expect(page.getByTestId('recert-situacao')).not.toContainText(/[Aa]berta/, { timeout: 15_000 });
  });

  test('RH: mapa cargo -> perfil incluído, trocado e retirado; tarefa de revisão dispensada com motivo', async ({
    page,
  }) => {
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/rh');
    const cargo = 'TECNICO DE ENFERMAGEM';
    for (const indice of [0, 1]) {
      await page.getByTestId(indice === 0 ? 'rh-cargo-incluir' : `rh-cargo-trocar-${cargo}`).click();
      if (indice === 0) await escolher(page.getByTestId('rh-cargo'), cargo);
      await escolher(page.getByTestId('rh-perfil'), { indice });
      await preencher(page, 'rh-motivo', 'perfil padrão do cargo');
      await page.getByTestId('rh-senha').fill(SENHA);
      await page.getByTestId('rh-confirmar').click();
      await expect(page.getByTestId(`rh-cargo-${cargo}`)).toBeVisible({ timeout: 15_000 });
    }
    await page.getByTestId(`rh-cargo-retirar-${cargo}`).click();
    await preencher(page, 'rh-motivo', 'cargo sem perfil padrão');
    await page.getByTestId('rh-senha').fill(SENHA);
    await page.getByTestId('rh-confirmar').click();
    await expect(page.getByTestId(`rh-cargo-${cargo}`)).toHaveCount(0, { timeout: 15_000 });
    // A troca de cargo de quem já tem login gera a revisão; dispensar com motivo.
    const revisar = page.locator('[data-testid^="rh-dispensar-revisar-acesso"]').first();
    await expect(revisar).toBeVisible();
    await revisar.click();
    await preencher(page, 'rh-motivo', 'mesmo perfil no cargo novo');
    await page.getByTestId('rh-senha').fill(SENHA);
    await page.getByTestId('rh-confirmar').click();
    await expect(page.getByTestId('rh-resolvidas')).toContainText('mesmo perfil no cargo novo', {
      timeout: 15_000,
    });
  });

  test('troca rápida: na tela bloqueada outra pessoa entra com o PIN; o gestor retira o PIN pela ficha', async ({
    page,
  }) => {
    // B define o PIN depois de entrar com a senha neste posto (mesmo navegador = mesmo cookie do posto).
    await entrar(page, 'SINT.USUARIO', SENHA, true);
    await page.goto('/preferencias/seguranca');
    const pin = page.getByTestId('meu-pin');
    await pin.getByTestId('pin-definir').click();
    await page.getByTestId('pin-novo').fill('627194');
    await page.getByTestId('pin-confirmacao').fill('627194');
    await page.getByTestId('pin-senha-definir').fill(SENHA);
    await page.getByTestId('pin-gravar').click();
    await expect(page.getByTestId('pin-aviso')).toBeVisible({ timeout: 15_000 });

    // A entra no mesmo posto e bloqueia a tela; B troca de usuário pelo PIN (recusa genérica com PIN errado).
    await entrar(page, 'SINT.GESTOR', SENHA, true);
    await page.getByTestId('menu-usuario').click();
    await page.getByTestId('bloquear').click();
    await expect(page.getByTestId('camada-bloqueio')).toBeVisible();
    await page.getByTestId('abrir-troca-pin').click();
    await page.getByTestId('login-troca-pin').fill('SINT.USUARIO');
    await page.getByTestId('pin-troca').fill('111111');
    await page.getByTestId('confirmar-troca-pin').click();
    await expect(page.getByTestId('erro-troca-pin')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('camada-bloqueio')).toBeVisible();
    await page.getByTestId('login-troca-pin').fill('SINT.USUARIO');
    await page.getByTestId('pin-troca').fill('627194');
    await page.getByTestId('confirmar-troca-pin').click();
    await expect(page.getByTestId('camada-bloqueio')).toHaveCount(0, { timeout: 15_000 });
    const sessao = await chamar(page, 'GET', '/api/sessao');
    expect(sessao.status).toBe(200);
    expect(JSON.stringify(sessao.corpo)).toContain('SINT.USUARIO');

    // O gestor vê o PIN na ficha (aba Sessões) e o retira com motivo e senha.
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/usuarios');
    await page.getByTestId('usuarios-busca').fill('SINT.USUARIO');
    await page.getByTestId('abrir-usuario-SINT.USUARIO').click();
    await page.getByTestId('ficha-aba-sessoes').click();
    const cartao = page.getByTestId('ficha-pin');
    await expect(cartao.getByTestId('ficha-pin-retirar')).toBeVisible({ timeout: 15_000 });
    await cartao.getByTestId('ficha-pin-retirar').click();
    await gravarNaFicha(page, 'PIN anotado em papel na estação');
    await expect(cartao.getByTestId('ficha-pin-retirar')).toHaveCount(0, { timeout: 15_000 });
    await expect(cartao.getByTestId('ficha-pin-situacao')).toBeVisible();
  });

  test('a pessoa na rede: painel pelo login (CPF informado na ficha), bloquear em todos e desbloquear', async ({
    page,
  }) => {
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/usuarios/SINT.COPA');
    await expect(page.getByTestId('ficha-aba-dados')).toHaveAttribute('aria-selected', 'true');
    await preencher(page, 'ficha-cpf-novo', cpfSintetico());
    await preencher(page, 'ficha-cpf-justificativa', 'CPF informado pela pessoa');
    await page.getByTestId('trocar-cpf').click();
    await gravarNaFicha(page, 'CPF informado pela pessoa');
    await expect(page.getByTestId('ficha-aviso')).toBeVisible({ timeout: 15_000 });

    await page.goto('/administracao/acesso/usuarios?vista=cpf&rede=SINT.COPA');
    const rede = page.getByTestId('rede-cpf');
    await expect(rede).toBeVisible({ timeout: 15_000 });
    await rede.getByTestId('rede-cpf-por-login').check();
    await rede.getByTestId('rede-cpf-valor').fill('SINT.COPA');
    await rede.getByTestId('rede-cpf-procurar').click();
    await expect(rede.getByTestId('rede-cpf-resumo')).toBeVisible({ timeout: 15_000 });
    await expect(rede.locator('[data-testid^="rede-cpf-conta-"][data-testid$="-SINT.COPA"]')).toBeVisible();
    await rede.getByTestId('rede-cpf-bloquear').click();
    const form = page.getByTestId('form-gravacao');
    await preencher(form, 'dialogo-motivo', 'Desligamento confirmado pelo RH');
    await form.getByTestId('dialogo-senha').fill(SENHA);
    await form.getByTestId('dialogo-confirmar').click();
    await expect(rede.getByTestId('rede-cpf-resultado')).toBeVisible({ timeout: 15_000 });
    await expect(rede.locator('[data-testid^="rede-cpf-res-"][data-testid$="-SINT.COPA"]')).toBeVisible();

    // A ficha mostra o bloqueio; o gestor desbloqueia (a conta volta).
    await page.goto('/administracao/acesso/usuarios/SINT.COPA');
    await expect(page.getByTestId('ficha-aba-dados')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('desbloquear-usuario').click();
    await gravarNaFicha(page, 'readmitido pelo RH');
    await expect(page.getByTestId('bloquear-usuario')).toBeVisible({ timeout: 15_000 });
  });

  test('registro no conselho: o gestor registra a conferência (situação, dia, fonte) e ela entra no histórico', async ({
    page,
  }) => {
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/usuarios');
    await page.getByTestId('usuarios-busca').fill('SINT.MEDICO');
    await page.getByTestId('abrir-usuario-SINT.MEDICO').click();
    await page.getByTestId('ficha-aba-papeis').click();
    const conselho = page.getByTestId('ficha-conselho');
    await expect(conselho.getByTestId('ficha-conselho-form')).toBeVisible({ timeout: 15_000 });
    await escolher(conselho.getByTestId('ficha-conselho-registro'), { indice: 0 });
    await escolher(conselho.getByTestId('ficha-conselho-situacao'), 'ativo');
    const d = new Date();
    const hoje = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await conselho.getByTestId('ficha-conselho-dia').fill(hoje);
    await escolher(conselho.getByTestId('ficha-conselho-fonte'), 'portal-conselho');
    await conselho.getByTestId('ficha-conselho-observacao').fill(`conferido no portal ${marca}`);
    await conselho.getByTestId('ficha-conselho-conferir').click();
    const form = page.getByTestId('form-gravacao');
    await form.getByTestId('dialogo-senha').fill(SENHA);
    await form.getByTestId('dialogo-confirmar').click();
    await expect(conselho.getByTestId('ficha-conselho-feito')).toBeVisible({ timeout: 15_000 });
    await expect(conselho.getByTestId('ficha-conselho-historico')).toContainText(
      `conferido no portal ${marca}`,
    );
  });

  test('usuário-modelo: aplicar acessos de SINT.RECEPCAO em SINT.SAME mostrando a diferença antes de gravar', async ({
    page,
  }) => {
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/usuarios');
    await page.getByTestId('usuarios-busca').fill('SINT.SAME');
    await page.getByTestId('abrir-usuario-SINT.SAME').click();
    await page.getByTestId('ficha-aba-papeis').click();
    const modelo = page.getByTestId('ficha-modelo');
    await modelo.getByTestId('ficha-modelo-termo').fill('SINT.RECEPCAO');
    await modelo.getByTestId('ficha-modelo-buscar').click();
    await escolher(modelo.getByTestId('ficha-modelo-login'), 'SINT.RECEPCAO');
    await escolher(modelo.getByTestId('ficha-modelo-modo'), 'somar');
    await modelo.getByTestId('ficha-modelo-previa').click();
    await expect(modelo.getByTestId('ficha-modelo-diferenca')).toBeVisible({ timeout: 15_000 });
    await modelo.getByTestId('ficha-modelo-motivo').fill('mesma função da recepção');
    await modelo.getByTestId('ficha-modelo-aplicar').click();
    const form = page.getByTestId('form-gravacao');
    await form.getByTestId('dialogo-senha').fill(SENHA);
    await form.getByTestId('dialogo-confirmar').click();
    await expect(modelo.getByTestId('ficha-modelo-resultado')).toBeVisible({ timeout: 15_000 });
    // Depois de aplicar, a mesma prévia não tem mais nada a somar.
    await modelo.getByTestId('ficha-modelo-previa').click();
    await expect(modelo.getByTestId('ficha-modelo-nada')).toBeVisible({ timeout: 15_000 });
  });
});
