// E2E @M44.1 (ficha do M44, seção 10, etapa 1): a diretoria clínica publica o protocolo de teste pelo editor (com o
// simulador e a reautenticação); o paciente que chegou aparece na fila; o técnico registra só os sinais; a enfermeira
// classifica (a regra marca o discriminador pelos sinais, a cor proposta é laranja com o nome escrito) e o quadro do PA
// aberto em outra aba recebe a cor pelo canal de eventos, inclusive depois de a conexão cair e voltar (reconexão sem
// perder o evento); o painel de TV do PA mostra a senha e a cor, nunca o nome; um amarelo com o tempo-alvo estourado sem
// médico entra na lista de reclassificação e é reclassificado com a justificativa em CP1252. axe sem violação séria em
// cada tela. Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS; nada vai à cópia).
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { ORIGEM, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const CP1252 = 'Piora na espera: dor irradiada, sudorese — atenção à pressão (ação nº 2, coração)';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function novaAba(browser: Browser, login: string): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: ORIGEM, timezoneId: 'America/Sao_Paulo' });
  const p = await ctx.newPage();
  await entrar(p, login);
  return p;
}

let sequencia = 0;
async function postar(page: Page, url: string, data: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '';
  return (page.request as APIRequestContext).post(url, {
    headers: { 'x-csrf': csrf, 'idempotency-key': `e2e-m44-${Date.now()}-${++sequencia}` },
    data: data as object,
  });
}

/** Abre um atendimento de PA SINTÉTICO pela recepção (a mesma gravação da tela de abertura do M20). */
async function abrirPa(page: Page, paciente: number): Promise<number> {
  const r = await postar(page, '/api/atendimento', {
    tipo: 'pa',
    paciente,
    convenio: 306,
    profissional: 7101,
    especialidade: 15,
    unidade: 3,
    centroCusto: 300400,
    procedimento: 10101039,
    carater: 'urgencia',
    cidPrincipal: 1,
    matricula: '900000000777',
  });
  expect(r.status(), await r.text()).toBe(201);
  return Number((await r.json()).resultado.reg);
}

/**
 * A diretoria clínica (perfil próprio) publica pelo editor estruturado: parte do protocolo de teste, ajusta pelos campos
 * (nunca pelo JSON), confere a diferença e publica com a senha; o autor da versão é a enfermeira (outro usuário ativo).
 */
async function publicarComoDiretoria(
  browser: Browser,
  ajustar: (p: Page) => Promise<void>,
  notas: string,
): Promise<Page> {
  const dir = await novaAba(browser, 'SINT.DIRETOR.CLINICO');
  await dir.goto('/administracao/pa/protocolos');
  await expect(dir.getByTestId('tela-protocolos-classificacao')).toBeVisible();
  await dir.getByTestId('partir-exemplo').click();
  await expect(dir.getByTestId('editor-estruturado')).toBeVisible();
  await ajustar(dir);
  await expect(dir.getByTestId('protocolo-diferenca')).toBeVisible();
  await dir.getByTestId('protocolo-autor').fill('SINT.ENFERMEIRO.PA');
  await dir.getByTestId('protocolo-notas').fill(notas);
  await dir.getByTestId('protocolo-senha').fill(SENHA);
  await dir.getByTestId('protocolo-publicar').click();
  await expect(dir.getByTestId('protocolo-mensagem')).toContainText('publicada');
  return dir;
}

/** Campo do editor que grava na mudança (change): preenche e sai do campo. */
async function preencher(p: Page, testId: string, valor: string): Promise<void> {
  const c = p.getByTestId(testId);
  await c.fill(valor);
  await c.press('Tab');
}

test.describe('Classificação de risco no PA @M44 @M44.1 @fase5', () => {
  test.setTimeout(240_000);

  test('protocolo → fila → técnico → enfermeira classifica laranja → quadro em duas abas (com reconexão) → painel de TV; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ENFERMEIRO.PA');
    // A enfermeira lê os protocolos, mas não publica (o editor é da diretoria clínica).
    await page.goto('/administracao/pa/protocolos');
    await expect(page.getByTestId('protocolos-nenhum')).toBeVisible();
    await expect(page.getByTestId('protocolo-editor')).toHaveCount(0);

    // O editor estruturado da diretoria clínica: a regra por campo, operador e valor; o simulador propõe a cor pela
    // regra; a publicação pede a senha e um autor real diferente de quem publica.
    const dir = await publicarComoDiretoria(
      browser,
      async (d) => {
        await semViolacaoAxe(d, '/administracao/pa/protocolos (editor)');
        await preencher(d, 'ed-nome', 'Protocolo sintético do E2E');
        await escolher(d.getByTestId('ed-fluxo-em-edicao'), 'dor-toracica');
        await expect(d.getByTestId('ed-disc-dor-intensa-cond-0-valor')).toHaveValue('8');
        await escolher(d.getByTestId('simular-fluxograma'), 'dor-toracica');
        await d.getByTestId('sim-dor').fill('9');
        await d.getByTestId('simular').click();
        await expect(d.getByTestId('simulacao-resultado')).toContainText('Laranja');
      },
      'Versão sintética do E2E',
    );
    await expect(dir.getByTestId('protocolo-detalhe')).toContainText('Dor torácica');
    await semViolacaoAxe(dir, '/administracao/pa/protocolos (publicada)');
    await dir.context().close();

    // A fila: quem chegou e não foi classificado.
    await page.goto('/pa/classificacao');
    await expect(page.getByTestId('tela-fila-classificacao')).toBeVisible();
    await expect(page.getByTestId('fila-protocolo')).toContainText('versão 1');
    const item = page
      .getByTestId('fila-aguardando')
      .locator('[data-testid^="fila-"]')
      .filter({ hasText: 'MARIA APARECIDA' });
    await expect(item).toBeVisible();
    const reg = Number((await item.getAttribute('data-testid'))!.replace('fila-', ''));
    await semViolacaoAxe(page, '/pa/classificacao');

    // O técnico registra só os sinais (regra 1).
    const tec = await novaAba(browser, 'SINT.TECNICO.PA');
    await tec.goto(`/pa/classificacao/${reg}`);
    await expect(tec.getByTestId('classificar-motivo')).toContainText('privativa do enfermeiro');
    await expect(tec.getByTestId('classificar-concluir')).toHaveCount(0);
    await tec.getByTestId('cl-pas').fill('132');
    await tec.getByTestId('cl-pad').fill('84');
    await tec.getByTestId('cl-fc').fill('104');
    await tec.getByTestId('cl-saturacao').fill('96');
    await tec.getByTestId('cl-dor').fill('9');
    await tec.getByTestId('classificar-sinais').click();
    await expect(tec.getByTestId('classificar-mensagem')).toContainText('Sinais vitais registrados');
    await tec.context().close();

    // O quadro do PA aberto em outra aba (o médico), que perde a conexão antes da classificação.
    const quadro = await novaAba(browser, 'SINT.MEDICO.PA');
    await quadro.goto('/pa/quadro');
    await expect(quadro.getByTestId(`cartao-${reg}`)).toBeVisible();
    await expect(quadro.getByTestId(`risco-${reg}`)).toHaveCount(0);
    await quadro.context().setOffline(true);

    // A enfermeira classifica: os sinais do técnico vêm preenchidos; a regra marca "Dor de 8 a 10".
    await page.getByTestId(`classificar-${reg}`).click();
    await expect(page.getByTestId('tela-classificar')).toBeVisible();
    await expect(page.getByTestId('cl-dor')).toHaveValue('9');
    await expect(page.getByTestId('classificar-prontuario')).toContainText('só neste sistema');
    await escolher(page.getByTestId('classificar-fluxograma'), 'dor-toracica');
    await expect(page.getByTestId('disc-dor-intensa')).toBeChecked();
    await expect(page.getByTestId('disc-dor-intensa')).toBeDisabled();
    await expect(page.getByTestId('classificar-proposta')).toContainText('Laranja');
    await expect(page.getByTestId('classificar-proposta')).toContainText('Muito urgente');
    await page.getByTestId('cl-queixa').fill('Dor no peito há duas horas, com irradiação');
    await semViolacaoAxe(page, '/pa/classificacao/:reg');
    await page.getByTestId('classificar-concluir').click();
    await expect(page.getByTestId('classificar-mensagem')).toContainText('Classificado: Laranja');
    await expect(page.getByTestId('classificar-avisos')).toContainText('só neste sistema');

    // A conexão volta: o quadro recebe a cor sem recarregar a página.
    await quadro.context().setOffline(false);
    await expect(quadro.getByTestId(`risco-${reg}`)).toContainText('Laranja', { timeout: 30_000 });
    await expect(quadro.getByTestId(`risco-${reg}`)).toContainText('Muito urgente');
    await expect(quadro.getByTestId('quadro-por-cor')).toContainText('Laranja');
    await semViolacaoAxe(quadro, '/pa/quadro (com cor)');
    await quadro.context().close();

    // O painel de TV do PA (token do aparelho): senha e cor com o nome; nunca o nome do paciente.
    const senhas = await novaAba(browser, 'SINT.SENHAS');
    const tv = await postar(senhas, '/api/recepcao/dispositivos', {
      tipo: 'paineltv',
      nome: 'TV do pronto atendimento',
      recepcao: null,
      locais: [],
      geradores: [],
      conteudo: 'pa',
      portalOrdem: null,
      usuarioLegado: null,
      validadeDias: 30,
      voz: false,
    });
    expect(tv.status(), await tv.text()).toBe(201);
    const criado = (await tv.json()) as { endereco: string; token: string };
    await senhas.goto(`${criado.endereco}#token=${criado.token}`);
    await expect(senhas.getByTestId('painel-tv-setor')).toContainText('TV do pronto atendimento');
    await expect(senhas.getByTestId('painel-tv-setor')).toContainText('Laranja — Muito urgente');
    await expect(senhas.getByTestId('painel-tv-setor')).not.toContainText('MARIA');
    await expect(senhas.getByTestId('painel-tv-setor')).not.toContainText('APARECIDA');
    await semViolacaoAxe(senhas, '/paineis/:dispositivo (PA)');
    await senhas.context().close();
    expect(externas).toEqual([]);
  });

  test('estouro de um amarelo sem médico → lista de reclassificação → reclassificado com justificativa em CP1252; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ENFERMEIRO.PA');
    // Versão de teste com o tempo-alvo zero até o amarelo (o estouro acontece na hora), pela tabela de cores do editor.
    const dir = await publicarComoDiretoria(
      browser,
      async (d) => {
        for (const cor of ['vermelho', 'laranja', 'amarelo']) await preencher(d, `ed-cor-${cor}-tempo`, '0');
        await expect(d.getByTestId('protocolo-diferenca')).toContainText('tempo-alvo');
      },
      'Versão de teste: estouro imediato até o amarelo',
    );
    await dir.context().close();
    const recepcao = await novaAba(browser, 'SINT.ATENDIMENTO');
    const reg = await abrirPa(recepcao, 1001);
    await recepcao.context().close();

    await page.goto(`/pa/classificacao/${reg}`);
    await escolher(page.getByTestId('classificar-fluxograma'), 'geral');
    await page.getByTestId('cl-dor').fill('6');
    await expect(page.getByTestId('disc-dor-moderada')).toBeChecked();
    await expect(page.getByTestId('classificar-proposta')).toContainText('Amarelo');
    await page.getByTestId('cl-queixa').fill('Mal-estar e dor abdominal');
    // A propagação "classificação concluída → cartão no quadro" (outra aba com o canal de eventos ligado), medida.
    const quadro = await novaAba(browser, 'SINT.MEDICO.PA');
    await quadro.goto('/pa/quadro');
    await expect(quadro.getByTestId(`cartao-${reg}`)).toBeVisible();
    await quadro.waitForTimeout(1_500);
    await page.getByTestId('classificar-concluir').click();
    const t0 = Date.now();
    await expect(quadro.getByTestId(`risco-${reg}`)).toContainText('Amarelo', { timeout: 30_000 });
    console.log(`[M44] propagação classificação → cartão no quadro: ${Date.now() - t0} ms`);
    await quadro.context().close();
    await expect(page.getByTestId('classificar-mensagem')).toContainText('Classificado: Amarelo');

    // O tempo-alvo (zero) passou sem o atendimento médico: a fila pede a reclassificação.
    await page.waitForTimeout(2_000);
    await page.goto('/pa/classificacao?lista=reclassificar');
    await expect(page.getByTestId(`estourado-${reg}`)).toBeVisible({ timeout: 30_000 });
    await semViolacaoAxe(page, '/pa/classificacao?lista=reclassificar');
    await page.getByTestId(`reclassificar-${reg}`).click();
    await expect(page.getByTestId('tela-reclassificar')).toBeVisible();
    await expect(page.getByTestId('reclassificacao-obrigatoria')).toBeVisible();
    await escolher(page.getByTestId('classificar-fluxograma'), 'geral');
    await page.getByTestId('cl-dor').fill('6');
    await page.getByTestId('cl-queixa').fill('Mal-estar e dor abdominal, pior');
    await escolher(page.getByTestId('classificar-cor-final'), 'laranja');
    await page.getByTestId('cl-justificativa').fill(CP1252);
    await semViolacaoAxe(page, '/pa/classificacao/:reg/reclassificar');
    await page.getByTestId('classificar-concluir').click();
    await expect(page.getByTestId('classificar-mensagem')).toContainText('Reclassificado: Laranja');

    // A reclassificação sai da lista e o histórico do paciente mostra as duas.
    await page.goto(`/pa/classificacao/${reg}`);
    await expect(page.getByTestId('classificar-vigente')).toContainText('Laranja');
    await expect(page.getByTestId('classificar-historico')).toContainText('Amarelo');
    await expect(page.getByTestId('classificar-historico')).toContainText('Laranja');
    await page.goto('/administracao/pa/cores-legado');
    await expect(page.getByTestId('cores-anteriores')).toContainText('MUITO URGENTE');
    await semViolacaoAxe(page, '/administracao/pa/cores-legado');
    await page.goto('/pa/classificacao/indicadores');
    await expect(page.getByTestId('ind-resultado')).toContainText('Reclassificados: 1 de');
    await semViolacaoAxe(page, '/pa/classificacao/indicadores');
    expect(externas).toEqual([]);
  });
});
