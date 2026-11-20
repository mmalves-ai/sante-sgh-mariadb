// E2E @M58.1 (ficha do M58, seção 7; etapa 1, inventário do desligamento): o gestor da migração abre a aba
// "Desligamento" da migração gradual (faixa do padrão da DP-6, os três passos bloqueados com os motivos, as pessoas
// pela tabela de conexões e pela medida diária, o inventário de 12 itens e as contas técnicas), registra um item com a
// senha de novo (o item passa a resolvido), vê a recusa do substituto inexistente e abre o cartão "Plataforma do banco"
// na verificação de schema. axe em cada tela; nenhum texto cita o outro sistema pelo nome.
// Sessão real sobre a fonte sintética de dev e as portas EM MEMÓRIA (contas sintéticas; nada vai à cópia).
import { expect, test, type Page } from '@playwright/test';
import { FACHADA_TOKEN_E2E } from './ambiente.js';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Prontidão do desligamento por hospital @M58.1 @fase7', () => {
  test.setTimeout(180_000);

  test('aba Desligamento: passos, pessoas, inventário com registro do item e o cartão da plataforma; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ONDA5');
    await page.goto('/administracao/coexistencia/migracao');
    await page.getByTestId('aba-migracao-desligamento').click();
    await expect(page).toHaveURL(/\/administracao\/coexistencia\/desligamento$/);
    await expect(page.getByTestId('tela-desligamento')).toBeVisible();
    await expect(page.getByTestId('desligamento-padrao')).toContainText('continua ligado');
    // Os três passos bloqueados (DP-6 no padrão), cada um com o que falta.
    for (const p of ['desligamento', 'firebird5', 'utf8'])
      await expect(page.getByTestId(`passo-${p}`).getByTestId('situacao')).toHaveText('Bloqueado');
    await expect(page.getByTestId('passo-desligamento')).toContainText('nas duas últimas semanas');
    // Regra 3: a tabela sintética tem uso na janela, e a medida diária não tem os 14 dias.
    await expect(page.getByTestId('sessoes-pessoas')).toHaveText('23 pessoa(s) com uso na janela');
    await expect(page.getByTestId('sessoes-medida')).toContainText('0 de 14');
    await expect(page.getByTestId('sessoes-criterio')).toContainText('Critério não cumprido');
    await expect(page.getByTestId('sessoes-serie')).toBeVisible();
    await expect(page.locator('[data-testid^="item-"]')).toHaveCount(12);
    await expect(page.locator('[data-testid^="conta-"]')).toHaveCount(28);
    await expect(page.locator('body')).not.toContainText(/SPDATA|legado|sistema atual/i);
    await semViolacaoAxe(page, '/administracao/coexistencia/desligamento');

    // Regra 2: o aceite da área para o aplicativo de atendimento (sem substituto), com a senha de novo.
    const sac = page.getByTestId('item-servico-sac-movel');
    await expect(sac.getByTestId('situacao')).toContainText('Pendente');
    await page.getByTestId('registrar-servico-sac-movel').click();
    const form = page.getByTestId('form-desligamento');
    await expect(form).toBeVisible();
    // Marcar "substituto em uso" num item sem substituto é recusado pelo servidor.
    await escolher(form.getByTestId('desligamento-situacao'), 'substituto-em-uso');
    await escolher(form.getByTestId('desligamento-contingencia'), 'nenhuma');
    await form.getByLabel('Papel de quem aceitou').fill('atendimento ao cliente');
    await form.getByLabel(/^Evidência/).fill('ata sintética do comitê');
    await form.getByTestId('desligamento-senha').fill(SENHA);
    await form.getByTestId('desligamento-gravar').click();
    await expect(page.getByTestId('desligamento-recusa')).toContainText('não tem substituto');
    await escolher(form.getByTestId('desligamento-situacao'), 'aceito-como-perdido');
    await form.getByTestId('desligamento-senha').fill(SENHA);
    await form.getByTestId('desligamento-gravar').click();
    await expect(page.getByTestId('desligamento-mensagem')).toContainText('Registro gravado');
    await expect(sac.getByTestId('situacao')).toContainText('Aceito como perdido pela área');
    await expect(sac.getByTestId('situacao')).toContainText('atendimento ao cliente');
    await expect(sac.getByTestId('contingencia')).toHaveText('Nenhuma volta');
    await expect(sac.getByTestId('pendencias')).toHaveText('—');
    await semViolacaoAxe(page, '/administracao/coexistencia/desligamento (registrado)');

    // O cartão "Plataforma do banco" na verificação de schema.
    await page.getByTestId('ir-plataforma').click();
    await expect(page).toHaveURL(/\/administracao\/coexistencia\/schema$/);
    const cartao = page.getByTestId('cartao-plataforma');
    await expect(cartao.getByTestId('plataforma-versao')).toHaveText('3.0.14');
    await expect(cartao.getByTestId('plataforma-charset-banco')).toHaveText('NONE');
    await expect(cartao.getByTestId('plataforma-charset-parametro')).toHaveText('CP1252');
    await expect(cartao.getByTestId('plataforma-confere')).toContainText('conferem');
    await expect(cartao.getByTestId('plataforma-entrada')).toContainText('restrita');
    await expect(cartao.getByTestId('plataforma-pendentes')).toContainText(
      'LTRIM, RTRIM, STRLEN, SUBSTR, VLR_MED',
    );
    await expect(page.locator('body')).not.toContainText(/SPDATA|legado|sistema atual/i);
    await semViolacaoAxe(page, '/administracao/coexistencia/schema (plataforma)');
    expect(externas).toEqual([]);
  });
});

// E2E @M58.2 (ficha do M58, seções 5, 7, 8 e 11; etapa 2, ensaio da versão 5 na cópia): o gestor abre a aba "Ensaio da
// versão 5" da migração gradual e vê o relatório versionado do ensaio (docs/marcos/M58/pc/firebird5.json) reavaliado:
// origem 3.0.14 e alvo 5.0.3, as 13 etapas, as medidas da cópia (cópia de segurança, restauração, gatilhos, volta
// atrás e restauração isolada aprovadas), a API da Hal-AI e os parceiros bloqueados com o motivo, a janela estimada e
// as funções externas; o ensaio não é aprovável enquanto há etapa bloqueada; o cartão "Plataforma do banco" da
// verificação de schema leva ao ensaio. axe nas duas telas; nenhum texto cita o outro sistema pelo nome.
test.describe('Ensaio da versão 5 do motor do banco @M58.2 @fase7', () => {
  test.setTimeout(180_000);

  test('aba Ensaio da versão 5: etapas, bloqueios, janela, funções externas e o cartão da plataforma; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ONDA5');
    await page.goto('/administracao/coexistencia/migracao');
    await page.getByTestId('aba-migracao-ensaioFirebird5').click();
    await expect(page).toHaveURL(/\/administracao\/coexistencia\/desligamento\/ensaio-firebird5$/);
    await expect(page.getByTestId('tela-ensaio-firebird5')).toBeVisible();
    await expect(page.getByTestId('ensaio-invalido')).toHaveCount(0);
    await expect(page.getByTestId('ensaio-origem')).toHaveText('3.0.14 (ODS 12.0)');
    await expect(page.getByTestId('ensaio-alvo')).toHaveText('5.0.3 (ODS 13.1)');
    await expect(page.getByTestId('ensaio-etapas').locator('tbody tr')).toHaveCount(13);
    // Regras 4 e 12 e SBIS-13: as medidas da cópia.
    for (const e of [
      'backup',
      'restauracao',
      'contagens',
      'objetos',
      'driver',
      'schema',
      'volta-atras',
      'restauracao-isolada',
    ])
      await expect(page.getByTestId(`situacao-${e}`)).toHaveText('Aprovada');
    // Regra 5: a função do fornecedor sem a biblioteca na cópia bloqueia a etapa das funções externas.
    await expect(page.getByTestId('situacao-funcoes-externas')).toHaveText('Bloqueada');
    // Seção 9: as assinaturas no 5 ficam bloqueadas pela correção de um gatilho do banco (autorização do dono).
    await expect(page.getByTestId('situacao-assinaturas')).toHaveText('Bloqueada');
    await expect(page.getByTestId('etapa-assinaturas')).toContainText('autorização do dono');
    await expect(page.getByTestId('etapa-assinaturas')).toContainText('precisa de correção para a versão 5');
    // Regras 8 e 10: o que depende de fora fica bloqueado, com o motivo.
    await expect(page.getByTestId('situacao-sante-api')).toHaveText('Bloqueada');
    await expect(page.getByTestId('etapa-sante-api')).toContainText('equipe da Hal-AI');
    await expect(page.getByTestId('situacao-parceiros')).toHaveText('Bloqueada');
    await expect(page.getByTestId('etapa-parceiros')).toContainText('TI do hospital');
    await expect(page.getByTestId('ensaio-aprovavel')).toContainText(
      'ainda não pode ser registrado como aprovado',
    );
    await expect(page.getByTestId('ensaio-janela')).toContainText(/\d+ minutos/);
    // Regra 5: as funções externas (as quatro da biblioteca padrão e a do fornecedor).
    for (const f of ['LTRIM', 'RTRIM', 'STRLEN', 'SUBSTR', 'VLR_MED'])
      await expect(page.getByTestId(`funcao-${f}`)).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/SPDATA|legado|sistema atual/i);
    await semViolacaoAxe(page, '/administracao/coexistencia/desligamento/ensaio-firebird5');

    // O cartão "Plataforma do banco" resume o ensaio e leva de volta a ele.
    await page.goto('/administracao/coexistencia/schema');
    const cartao = page.getByTestId('cartao-plataforma');
    await expect(cartao.getByTestId('plataforma-ensaio')).toContainText(/aprovadas \d+ de 13 etapas/);
    await expect(page.locator('body')).not.toContainText(/SPDATA|legado|sistema atual/i);
    await semViolacaoAxe(page, '/administracao/coexistencia/schema (ensaio)');
    await cartao.getByTestId('ir-ensaio-firebird5').click();
    await expect(page).toHaveURL(/\/administracao\/coexistencia\/desligamento\/ensaio-firebird5$/);
    await expect(page.getByTestId('tela-ensaio-firebird5')).toBeVisible();
    expect(externas).toEqual([]);
  });
});

// E2E @M58.3 (ficha do M58, seções 5, 7, 8 e 11; etapa 3, ensaio da conversão para UTF-8 na cópia em versão 5): o gestor
// abre a aba "Ensaio do UTF-8" da migração gradual e vê o relatório versionado do ensaio (docs/marcos/M58/pc/utf8.json)
// reavaliado: base 5.0.3 em NONE e convertido 5.0.3 em UTF8, as 16 etapas, a página do banco convertido, a API da
// Hal-AI bloqueada com o motivo e o ensaio não aprovável enquanto há etapa bloqueada; o cartão "Plataforma do banco" da
// verificação de schema leva ao ensaio. axe nas duas telas; nenhum texto cita o outro sistema pelo nome.
test.describe('Ensaio da conversão do texto para UTF-8 @M58.3 @fase7', () => {
  test.setTimeout(180_000);

  test('aba Ensaio do UTF-8: etapas, bloqueios, página, janela e o cartão da plataforma; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ONDA5');
    await page.goto('/administracao/coexistencia/migracao');
    await page.getByTestId('aba-migracao-ensaioUtf8').click();
    await expect(page).toHaveURL(/\/administracao\/coexistencia\/desligamento\/ensaio-utf8$/);
    await expect(page.getByTestId('tela-ensaio-utf8')).toBeVisible();
    await expect(page.getByTestId('ensaio-invalido')).toHaveCount(0);
    await expect(page.getByTestId('ensaio-origem')).toHaveText('5.0.3 (NONE)');
    await expect(page.getByTestId('ensaio-alvo')).toHaveText('5.0.3 (UTF8)');
    await expect(page.getByTestId('ensaio-etapas').locator('tbody tr')).toHaveCount(16);
    await expect(page.getByTestId('ensaio-pagina')).toContainText('bytes');
    // Regra 8: a API de integração depende da equipe da Hal-AI.
    await expect(page.getByTestId('situacao-sante-api')).toHaveText('Bloqueada');
    await expect(page.getByTestId('etapa-sante-api')).toContainText('equipe da Hal-AI');
    await expect(page.getByTestId('ensaio-aprovavel')).toContainText(
      'ainda não pode ser registrado como aprovado',
    );
    await expect(page.getByTestId('ensaio-janela')).toContainText(/\d+ minutos/);
    await expect(page.getByTestId('ensaio-indices')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/SPDATA|legado|sistema atual/i);
    await semViolacaoAxe(page, '/administracao/coexistencia/desligamento/ensaio-utf8');

    // O cartão "Plataforma do banco" resume o ensaio e leva de volta a ele.
    await page.goto('/administracao/coexistencia/schema');
    const cartao = page.getByTestId('cartao-plataforma');
    await expect(cartao.getByTestId('plataforma-ensaio-utf8')).toContainText(/aprovadas \d+ de 16 etapas/);
    await semViolacaoAxe(page, '/administracao/coexistencia/schema (ensaio do UTF-8)');
    await cartao.getByTestId('ir-ensaio-utf8').click();
    await expect(page).toHaveURL(/\/administracao\/coexistencia\/desligamento\/ensaio-utf8$/);
    await expect(page.getByTestId('tela-ensaio-utf8')).toBeVisible();
    expect(externas).toEqual([]);
  });
});

// E2E @M58.4 (ficha do M58, seção 7 e regras 8 e 9; etapa 4, fachada da API de integração da Hal-AI): o administrador
// abre o painel pelo menu (necessidade, estado, prontidão do UTF-8, motor em dois tempos, superfícies e as 78
// operações com filtro); o teste faz as vezes do Squad com a chave sintética: fachada desligada (503), ligada pela tela
// com a senha de novo (senha errada recusada), convênios servidos no contrato da API original, escrita desligada por
// padrão (403), ligada pela tela com o aviso, e a ação em dois tempos (a proposta não grava; a confirmação é de uso
// único). Porta da fachada EM MEMÓRIA (convênios sintéticos; nada vai à cópia). axe em cada estado.
test.describe('Fachada da API de integração da Hal-AI @M58.4 @fase7', () => {
  test.setTimeout(180_000);

  test('painel pelo menu, filtros, configurar com senha e a fachada no contrato da API original; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    // O caminho-base leva o estabelecimento da sessão (na fonte sintética, o do painel; em produção, pc).
    let base = '';
    const chave = { authorization: `Bearer ${FACHADA_TOKEN_E2E}` };
    const squad = async (metodo: 'GET' | 'POST', caminho: string, corpo?: unknown) => {
      const r = await page.request.fetch(`${base}${caminho}`, {
        method: metodo,
        headers: chave,
        ...(corpo === undefined ? {} : { data: corpo }),
      });
      return { status: r.status(), corpo: (await r.json()) as Record<string, unknown> };
    };

    await entrar(page, 'SINT.ONDA5');
    await (await itemDoMenu(page, 'Fachada sante-api para quando o modelo evoluir')).click();
    await expect(page).toHaveURL(/\/administracao\/integracoes\/fachada$/);
    const tela = page.getByTestId('tela-fachada');
    await expect(tela).toBeVisible();
    await expect(page.getByTestId('cartao-necessidade')).toBeVisible();
    const painel = (await (await page.request.get('/api/administracao/integracoes/fachada')).json()) as {
      hospital: string;
    };
    base = `/api/fachada/sante-api/${painel.hospital}`;
    await expect(page.getByTestId('estado-ligada')).toHaveText('Desligada');
    await expect(page.getByTestId('estado-escrita')).toHaveText('Desligada');
    await expect(page.getByTestId('cartao-prontidao')).toBeVisible();
    await expect(page.getByTestId('cartao-motor')).toContainText('15 minutos');
    await expect(page.getByTestId('superficies-total')).toContainText('78');
    await expect(page.getByTestId('filtro-contagem')).toHaveText('Mostrando 78 de 78 operações');
    await expect(tela).not.toContainText(/SPDATA|legado|sistema atual|integracao\.fachada/i);
    await semViolacaoAxe(page, '/administracao/integracoes/fachada');

    // Com a fachada desligada, toda operação aparece desligada (filtro pelo modo).
    await escolher(page.getByTestId('filtro-modo'), 'desligada');
    await expect(page.getByTestId('filtro-contagem')).toHaveText('Mostrando 78 de 78 operações');
    await escolher(page.getByTestId('filtro-modo'), '');

    // O Squad, com a fachada desligada: 503 no envelope da API original; sem chave: 401.
    const desligada = await squad('GET', '/convenios');
    expect(desligada.status).toBe(503);
    expect(desligada.corpo).toMatchObject({ status: 'error', codigo: 'fachada_desligada' });
    expect((await page.request.get(`${base}/convenios`)).status()).toBe(401);

    // Ligar a fachada (crítico: justificativa e senha de novo; a senha errada é recusada).
    const form = page.getByTestId('form-fachada');
    await escolher(form.getByTestId('fachada-parametro'), 'integracao.fachada.ligada');
    await form.getByTestId('fachada-sim').check();
    await form.getByLabel(/^Justificativa/).fill('ensaio sintético da fachada');
    await form.getByTestId('fachada-senha').fill('senha-errada-1');
    await form.getByTestId('fachada-gravar').click();
    await expect(page.getByTestId('recusa-fachada')).toBeVisible();
    await expect(page.getByTestId('estado-ligada')).toHaveText('Desligada');
    await form.getByTestId('fachada-senha').fill(SENHA);
    await form.getByTestId('fachada-gravar').click();
    await expect(page.getByTestId('fachada-gravado')).toContainText('Configuração gravada: Fachada ligada.');
    await expect(page.getByTestId('estado-ligada')).toHaveText('Ligada');
    await semViolacaoAxe(page, '/administracao/integracoes/fachada (ligada)');

    // Servida no contrato da API original (a configuração tem cache curto; espera a leitura nova).
    await expect.poll(async () => (await squad('GET', '/convenios')).status, { timeout: 30_000 }).toBe(200);
    const lista = await squad('GET', '/convenios?q=sintetico');
    expect(JSON.stringify(lista.corpo)).toContain('CONVENIO SINTETICO UM');
    expect((await squad('GET', '/convenios/20')).corpo).toMatchObject({ nome: 'CONVENIO SINTETICO UM' });

    // Escrita desligada por padrão: a ação é recusada (403) sem proposta.
    const fechada = await squad('POST', '/acoes/convenios/situacao', { convenio: 20, operacao: 'suspender' });
    expect(fechada.status).toBe(403);
    expect(fechada.corpo).toMatchObject({ codigo: 'acoes_desabilitadas' });

    // Ligar a escrita mostra o aviso e pede a senha de novo.
    await escolher(form.getByTestId('fachada-parametro'), 'integracao.fachada.escrita');
    await form.getByTestId('fachada-sim').check();
    await expect(page.getByTestId('fachada-aviso-escrita')).toBeVisible();
    await form.getByLabel(/^Justificativa/).fill('ensaio sintético da escrita');
    await form.getByTestId('fachada-senha').fill(SENHA);
    await form.getByTestId('fachada-gravar').click();
    await expect(page.getByTestId('fachada-gravado')).toContainText('Escrita ligada');
    await expect(page.getByTestId('estado-escrita')).toHaveText('Ligada');

    // Filtros (escrita ligada): só as ações servidas (situação do convênio, confirmar e o estado do motor).
    await escolher(page.getByTestId('filtro-superficie'), 'acoes');
    await escolher(page.getByTestId('filtro-modo'), 'servida');
    await expect(page.getByTestId('filtro-contagem')).toHaveText('Mostrando 3 de 78 operações');
    await expect(page.getByTestId('operacao-POST /acoes/convenios/situacao')).toContainText(
      'convenio.alterarSituacao',
    );
    await page.getByLabel('Caminho contém').fill('confirmar');
    await expect(page.getByTestId('filtro-contagem')).toHaveText('Mostrando 1 de 78 operações');
    await page.getByLabel('Caminho contém').fill('');
    await escolher(page.getByTestId('filtro-superficie'), '');
    await escolher(page.getByTestId('filtro-modo'), '');

    // Dois tempos: a proposta não grava; a confirmação grava uma vez; a segunda confirmação é recusada.
    await expect
      .poll(async () => (await squad('GET', '/acoes/status')).corpo['habilitada'], { timeout: 30_000 })
      .toBe(true);
    const proposta = await squad('POST', '/acoes/convenios/situacao', {
      convenio: 20,
      operacao: 'suspender',
    });
    expect(proposta.status).toBe(200);
    expect(proposta.corpo).toMatchObject({ aplicada: false });
    const propostaId = proposta.corpo['propostaId'] as string;
    expect((await squad('GET', '/convenios/20')).corpo).toMatchObject({ ativo: true });
    const confirmada = await squad('POST', '/acoes/confirmar', { propostaId });
    expect(confirmada.status).toBe(200);
    expect(confirmada.corpo).toMatchObject({ aplicada: true, situacaoAtual: 'I' });
    expect((await squad('POST', '/acoes/confirmar', { propostaId })).status).toBeGreaterThanOrEqual(400);

    // O painel mede o uso por operação.
    await page.reload();
    await page.getByLabel('Caminho contém').fill('/acoes/confirmar');
    await expect(page.getByTestId('operacao-POST /acoes/confirmar')).toBeVisible();
    await expect(page.getByTestId('cartao-motor')).toContainText('Propostas pendentes: 0');
    await semViolacaoAxe(page, '/administracao/integracoes/fachada (uso medido)');
    expect(externas).toEqual([]);
  });
});

// E2E @M58.5 (ficha do M58, seções 2, 5, 8 a 12; etapa 5, roteiro de produção, verificação e retirada da restrição): o
// gestor abre a aba "Janela em produção" da migração gradual e vê a restrição de entrada ainda restrita com o que falta
// (UTF-8 não autorizado nem executado), o roteiro de cada passo com as fases, os papéis e os comandos sem senha nem
// endereço, a janela estimada pelos tempos do ensaio e a verificação do ensaio do roteiro na cópia (relatório versionado
// docs/marcos/M58/pc/janela.json, reavaliado pelos números) separada da verificação na produção, que ainda não existe.
// axe na tela; nenhum texto cita o outro sistema pelo nome.
test.describe('Janela em produção, verificação e restrição de entrada @M58.5 @fase7', () => {
  test.setTimeout(180_000);

  test('aba Janela em produção: restrição com motivos, roteiro por passo, verificação do ensaio; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ONDA5');
    await page.goto('/administracao/coexistencia/migracao');
    await page.getByTestId('aba-migracao-janela').click();
    await expect(page).toHaveURL(/\/administracao\/coexistencia\/desligamento\/janela$/);
    await expect(page.getByTestId('tela-janela')).toBeVisible();
    await expect(page.getByTestId('janela-relatorio-invalido')).toHaveCount(0);
    // Regra 6: a restrição continua até o UTF-8 executado e verificado na produção.
    await expect(page.getByTestId('retirada-situacao')).toContainText('Restrita');
    await expect(page.getByTestId('motivo-utf8-nao-executado')).toBeVisible();
    await expect(page.getByTestId('ir-funcionalidades')).toHaveCount(0);

    // O passo do desligamento: não para o banco; a verificação da produção ainda não existe; o ensaio do roteiro sim.
    await page.getByTestId('passo-desligamento').click();
    await expect(page.getByTestId('passo-janela')).toHaveText('Este passo não para o banco');
    await expect(page.getByTestId('etapa-retirar-executaveis')).toBeVisible();
    await expect(page.getByTestId('verificacao-producao')).toContainText('Ainda não verificada');
    await expect(page.getByTestId('verificacao-ensaio-resumo')).toContainText(/Aprovada|Reprovada/);
    await expect(page.getByTestId('checagem-ensaio-schema')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/SPDATA|legado|sistema atual/i);
    await semViolacaoAxe(page, '/administracao/coexistencia/desligamento/janela');

    // O passo da versão 5: cópia de segurança, restauração e integridade, com a volta atrás no fim.
    await page.getByTestId('passo-firebird5').click();
    await expect(page.getByTestId('etapa-backup')).toContainText('Cópia de segurança');
    await expect(page.getByTestId('etapa-restaurar')).toBeVisible();
    await expect(page.getByTestId('etapa-restaurar-backup-anterior')).toContainText('Volta atrás');
    // O passo do UTF-8: a conversão e a retirada da restrição na reabertura.
    await page.getByTestId('passo-utf8').click();
    await expect(page.getByTestId('etapa-converter')).toBeVisible();
    await expect(page.getByTestId('etapa-retirar-restricao')).toContainText('Reabertura');
    await expect(page.locator('body')).not.toContainText(/SPDATA|legado|sistema atual|senha/i);
    expect(externas).toEqual([]);
  });
});
