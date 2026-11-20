// E2E @M48.2 (ficha do M48, etapa 2: análise e plano de ação, sugestão automática, tecnovigilância e painel do plano de
// segurança; seções 7, 8 regra 4 e 10): a enfermeira abre "Notificar incidente" e o sistema sugere a dose omitida na
// checagem dela (a sugestão preenche o formulário com o atendimento do registro); o NSP faz a triagem e distribui à
// coordenadora de enfermagem, que faz a análise (5 porquês, causa raiz), inclui a ação do plano 5W2H (a responsável é a
// enfermeira, que não analisa e chega a "minhas ações" pelo diálogo global) e conclui a análise (sem ver quem
// notificou); o NSP abre a vigilância do produto ligada à notificação, com os expostos ao lote sob demanda (só números)
// e o andamento; o painel do plano de segurança mostra as parcelas. axe sem violação séria em cada tela.
// Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS; nada vai à cópia).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Análise e plano 5W2H, sugestão automática, vigilância do produto e painel do PSP @M48 @M48.2 @fase5', () => {
  test.setTimeout(300_000);

  test('sugestão → notificar → triagem → distribuição → análise → plano → conclusão → vigilância com expostos → painel; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);

    // A enfermeira abre "Notificar incidente": a dose omitida na checagem dela vem como sugestão.
    await entrar(page, 'SINT.ENFERMEIRO');
    await page.goto('/qualidade/notificar');
    await expect(page.getByTestId('tela-notificar')).toBeVisible();
    const sugestao = page.getByTestId('sugestao-omitida:48201');
    await expect(sugestao).toBeVisible();
    await semViolacaoAxe(page, '/qualidade/notificar (sugestões)');
    await page.getByTestId('sugestao-usar-omitida:48201').click();
    await expect(page.getByTestId('notificar-sugestao')).toBeVisible();
    await expect(page.getByTestId('notificar-paciente')).toContainText('48101');
    await page.locator('input[name="notificar-dano"][value="leve"]').check();
    await semViolacaoAxe(page, '/qualidade/notificar (sugestão escolhida)');
    await page.getByTestId('notificar-enviar').click();
    await expect(page.getByTestId('notificacao-enviada')).toBeVisible();
    const protocolo = (await page.getByTestId('notificacao-protocolo').textContent())!.trim();
    expect(protocolo).toMatch(/^NSP-\d{4}-\d{6}$/);

    // O NSP faz a triagem e distribui à coordenadora de enfermagem.
    await entrar(page, 'SINT.NSP');
    await page.goto('/qualidade/nsp/notificacoes');
    await expect(page.getByTestId(`nsp-linha-${protocolo}`)).toBeVisible();
    await page.getByTestId(`nsp-abrir-${protocolo}`).click();
    await expect(page.getByTestId('tela-nsp-detalhe')).toBeVisible();
    await page.locator('input[name="triagem-classificacao"][value="eventoAdverso"]').check();
    await page.locator('input[name="triagem-dano"][value="leve"]').check();
    await page.getByTestId('triagem-confirmar').click();
    await expect(page.getByTestId('nsp-situacao')).toContainText('Triada');
    const painelDistribuir = page.getByTestId('painel-distribuir');
    await expect(painelDistribuir).toBeVisible();
    await page.getByTestId('distribuir-busca').locator('input').fill('COORD');
    await page.getByTestId('distribuir-buscar').click();
    await escolher(page.getByTestId('distribuir-gestor'), 'SINT.COORD.ENF');
    await escolher(page.getByTestId('distribuir-unidade'), { indice: 1 });
    await page
      .getByTestId('distribuir-orientacao')
      .locator('textarea')
      .fill('Analisar a falta do item na checagem (texto sintético).');
    await semViolacaoAxe(page, '/qualidade/nsp/notificacoes/:id (distribuir)');
    await page.getByTestId('distribuir-enviar').click();
    await expect(page.getByTestId('nsp-situacao')).toContainText('Distribuída');
    await expect(page.getByTestId('nsp-ir-analise')).toBeVisible();

    // A coordenadora analisa (5 porquês), inclui a ação do plano e conclui; não vê quem notificou.
    await entrar(page, 'SINT.COORD.ENF');
    await page.goto('/qualidade/nsp/analises');
    await expect(page.getByTestId('tela-analises')).toBeVisible();
    await expect(page.getByTestId(`analise-linha-${protocolo}`)).toBeVisible();
    await semViolacaoAxe(page, '/qualidade/nsp/analises');
    await page.getByTestId(`analise-abrir-${protocolo}`).click();
    await expect(page.getByTestId('tela-analise')).toBeVisible();
    await expect(page.getByTestId('analise-notificacao')).toBeVisible();
    await expect(page.getByTestId('tela-analise')).not.toContainText('SINT.ENFERMEIRO');
    await page.getByTestId('analise-porque-0').locator('input, textarea').first().fill('A dose não foi dada');
    await page
      .getByTestId('analise-porque-1')
      .locator('input, textarea')
      .first()
      .fill('O item faltou no posto');
    await page.getByTestId('analise-mais-porque').click();
    await page
      .getByTestId('analise-porque-2')
      .locator('input, textarea')
      .first()
      .fill('A reposição do posto não tem conferência diária');
    await page
      .getByTestId('analise-causa-raiz')
      .locator('input, textarea')
      .first()
      .fill('A reposição do posto não tem conferência diária');
    await semViolacaoAxe(page, '/qualidade/nsp/analises/:id (análise)');
    await page.getByTestId('analise-gravar').click();
    await expect(page.getByTestId('analise-feito')).toBeVisible();
    await expect(page.getByTestId('analise-situacao')).toContainText(/em análise/i);

    await page.getByTestId('plano-incluir').click();
    await expect(page.getByTestId('form-plano')).toBeVisible();
    await page
      .getByTestId('plano-oque')
      .locator('input, textarea')
      .first()
      .fill('Conferir a reposição do posto');
    await page
      .getByTestId('plano-porque')
      .locator('input, textarea')
      .first()
      .fill('O item faltou na checagem');
    await page.getByTestId('plano-onde').locator('input, textarea').first().fill('Unidade sintética');
    await page
      .getByTestId('plano-como')
      .locator('input, textarea')
      .first()
      .fill('Lista de conferência no turno');
    const quando = page.getByTestId('plano-quando').locator('input');
    const daqui = new Date(Date.now() + 20 * 86_400_000);
    await quando.fill(
      `${String(daqui.getDate()).padStart(2, '0')}/${String(daqui.getMonth() + 1).padStart(2, '0')}/${String(daqui.getFullYear())}`,
    );
    await quando.blur();
    // O responsável da ação é a enfermeira, que não analisa (sem qualidade.analise.ler).
    await page.getByTestId('plano-busca').locator('input').fill('ENFERMEIRO');
    await page.getByTestId('plano-buscar').click();
    await escolher(page.getByTestId('plano-quem'), 'SINT.ENFERMEIRO');
    await semViolacaoAxe(page, '/qualidade/nsp/analises/:id (plano)');
    await page.getByTestId('plano-gravar').click();
    await expect(page.getByTestId('plano-feito')).toBeVisible();
    await expect(page.getByTestId('acao-1')).toContainText('Conferir a reposição do posto');

    await page.getByTestId('analise-concluir').check();
    await page.getByTestId('analise-gravar').click();
    await expect(page.getByTestId('analise-concluida')).toBeVisible();
    await expect(page.getByTestId('analise-leitura')).toContainText('conferência diária');
    await semViolacaoAxe(page, '/qualidade/nsp/analises/:id (concluída)');

    // A responsável que não analisa chega a "minhas ações" pela interface (o diálogo global "Notificar incidente").
    await entrar(page, 'SINT.ENFERMEIRO');
    await page.getByTestId('notificar-incidente').click();
    await page.getByTestId('notificar-minhas-acoes').click();
    await expect(page).toHaveURL(/\/qualidade\/acoes$/);
    await expect(page.getByTestId('tela-minhas-acoes')).toBeVisible();
    await expect(page.getByTestId('tabela-minhas')).not.toContainText('Abrir a análise');
    await expect(page.getByTestId('tabela-minhas')).toContainText('Conferir a reposição do posto');
    await semViolacaoAxe(page, '/qualidade/acoes');

    // O NSP vê a análise concluída e abre a vigilância do produto ligada à notificação, com os expostos ao lote.
    await entrar(page, 'SINT.NSP');
    await page.goto('/qualidade/nsp/analises');
    await page.getByTestId(`analise-abrir-${protocolo}`).click();
    await expect(page.getByTestId('analise-concluida')).toBeVisible();
    await page.getByTestId('analise-ir-vigilancia').click();
    await expect(page.getByTestId('tela-vigilancia')).toBeVisible();
    const formVig = page.getByTestId('form-vigilancia');
    // A tela abre o formulário sozinha quando vem ligada à notificação; espera o formulário ou o botão (sem corrida).
    await expect(formVig.or(page.getByTestId('vig-novo'))).toBeVisible();
    if (!(await formVig.isVisible())) await page.getByTestId('vig-novo').click();
    await expect(page.getByTestId('vig-ligada')).toContainText(protocolo);
    await escolher(page.getByTestId('vig-tipo'), 'queixaTecnica');
    await page.getByTestId('vig-busca').locator('input').fill('equipo');
    await page.getByTestId('vig-buscar').click();
    await escolher(page.getByTestId('vig-item'), '48201');
    await page.getByTestId('vig-lote').locator('input').fill('LOTE-SINT-1');
    await page
      .getByTestId('vig-descricao')
      .locator('textarea')
      .fill('Equipo sintético com vazamento na conexão (texto sintético).');
    await semViolacaoAxe(page, '/qualidade/nsp/tecnovigilancia (novo)');
    await page.getByTestId('vig-gravar').click();
    await expect(page).toHaveURL(/\/qualidade\/nsp\/tecnovigilancia\/\d+$/);
    await expect(page.getByTestId('tela-vigilancia-detalhe')).toBeVisible();
    await expect(page.getByTestId('vigd-notificacao')).toContainText(protocolo);
    await page.getByTestId('vigd-ver-expostos').click();
    const expostos = page.getByTestId('vigd-tabela-expostos');
    await expect(expostos).toContainText('48101');
    await expect(expostos).toContainText('48102');
    await escolher(page.getByTestId('vigd-nova-situacao'), 'emInvestigacao');
    await escolher(page.getByTestId('vigd-conduta'), 'segregado');
    await page
      .getByTestId('vigd-texto')
      .locator('textarea')
      .fill('Lote segregado para investigação (texto sintético).');
    await semViolacaoAxe(page, '/qualidade/nsp/tecnovigilancia/:id');
    await page.getByTestId('vigd-gravar').click();
    await expect(page.getByTestId('vigd-feito')).toBeVisible();
    await expect(page.getByTestId('vigd-historico')).toContainText('Lote segregado');

    // O painel do plano de segurança: as parcelas impressas (adesão sintética da porta em memória).
    await page.goto('/qualidade/nsp/protocolos');
    await expect(page.getByTestId('tela-painel-seguranca')).toBeVisible();
    await expect(page.getByTestId('painel-notificacoes')).toBeVisible();
    await expect(page.getByTestId('indicador-meta1-pulseira')).toContainText('36 de 40 (90,0%)');
    await expect(page.getByTestId('painel-analises')).toBeVisible();
    await semViolacaoAxe(page, '/qualidade/nsp/protocolos');

    expect(externas).toEqual([]);
  });
});
