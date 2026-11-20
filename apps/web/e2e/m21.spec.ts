// E2E @M21 (ficha, seção 10): admitir pelo mapa → transferir → alta médica (o médico) → saída (a recepção) → a
// solicitação de limpeza nasce na alta → execução no aplicativo do profissional no celular (checklist e foto) →
// inspeção e liberação → o leito livre no mapa; o conflito do leito bloqueado no novo que o outro sistema ocupa; a
// movimentação do SAME pela leitura da etiqueta; axe sem violação séria em cada tela. Sessão real sobre a fonte
// sintética de dev e as portas em MEMÓRIA (internações, leitos, limpezas e movimentos SINTÉTICOS; nada vai à cópia).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { abrirCombo, escolher, esperarValor, fecharCombo } from './combos.js';

const SENHA = 'Sintetico#2026';
const POR_FORA = resolve(import.meta.dirname, '../../../.tmp/e2e-leitos-por-fora.json');
// Um JPEG mínimo (cabeçalho SOI/APP0 e bytes sintéticos): a foto da limpeza.
const JPEG = Buffer.from([
  0xff,
  0xd8,
  0xff,
  0xe0,
  0x00,
  0x10,
  0x4a,
  0x46,
  0x49,
  0x46,
  ...Array.from({ length: 64 }, (_, i) => i),
]);

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}
async function sair(page: Page): Promise<void> {
  await page.context().clearCookies();
}

/** O primeiro leito admissível da acomodação no mapa (a chave "bloco|acomodação|leito"). */
async function leitoLivre(page: Page, acomodacao: string, exceto: string[] = []): Promise<string> {
  const cartoes = page.locator(`[data-testid^="leito-1|${acomodacao}|"][data-situacao="livre"]`);
  await expect(cartoes.first()).toBeVisible();
  for (const id of await cartoes.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? ''))) {
    const chave = id.replace(/^leito-/, '');
    if (!exceto.includes(chave)) return chave;
  }
  throw new Error('Nenhum leito livre no mapa sintético.');
}

test.describe('Internação, leitos, higienização e SAME @M21 @fase2', () => {
  test.setTimeout(300_000);
  test.beforeAll(() => rmSync(POR_FORA, { force: true }));
  test.afterAll(() => rmSync(POR_FORA, { force: true }));

  test('admitir → transferir → alta médica → saída → limpeza no celular → inspeção → leito livre; SAME; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.INTERNACAO');

    // Mapa operacional: o leito livre da enfermaria; admitir dele.
    await page.goto('/leitos/mapa');
    await expect(page.getByTestId('tela-mapa-leitos')).toBeVisible();
    await expect(page.getByTestId('mapa-resumo')).toBeVisible();
    await semViolacaoAxe(page, '/leitos/mapa');
    const origem = await leitoLivre(page, 'ENF1');
    await page.getByTestId(`admitir-${origem}`).click();

    // Admissão: o paciente do cadastro, o leito vindo do mapa, convênio, especialidade, médicos, CID e procedimento.
    await expect(page.getByTestId('tela-admissao')).toBeVisible();
    await page.getByTestId('admissao-termo').locator('input').fill('JOSE DA SILVA');
    await page.getByTestId('admissao-buscar').click();
    await page.getByTestId('admissao-paciente-1001').click();
    await expect(page.getByTestId('admissao-paciente-escolhido')).toContainText('JOSÉ DA SILVA');
    await semViolacaoAxe(page, '/internacao/admissao');
    await escolher(page.getByTestId('admissao-leito'), origem);
    await escolher(page.getByTestId('admissao-convenio'), '901');
    await escolher(page.getByTestId('admissao-especialidade'), '11');
    await page.getByTestId('admissao-termo-medico').locator('input').fill('ANA');
    await page.getByTestId('admissao-buscar-medico').click();
    await escolher(page.getByTestId('admissao-assistente'), '7101');
    await escolher(page.getByTestId('admissao-solicitante'), '7101');
    await page.getByTestId('admissao-termo-cid').locator('input').fill('I21');
    await page.getByTestId('admissao-buscar-cid').click();
    await escolher(page.getByTestId('admissao-cid'), '50001');
    await page.getByTestId('admissao-procedimento').locator('input').fill('303010037');
    await page.getByTestId('admissao-gravar').click();
    await expect(page.getByTestId('admissao-feita')).toBeVisible();
    await page.getByTestId('admissao-pulseira').click();
    await expect(page.getByTestId('pulseira-enviada')).toContainText('impressora da estação');
    await page.getByTestId('admissao-abrir').click();
    await expect(page).toHaveURL(/\/internacao\/\d+\/guias/);
    const reg = Number(/\/internacao\/(\d+)\//.exec(page.url())?.[1]);
    expect(reg).toBeGreaterThan(0);
    await expect(page.getByTestId('tela-guias')).toBeVisible();
    await semViolacaoAxe(page, '/internacao/:reg/guias');

    // Transferência para outro leito livre: arrastar o paciente no mapa abre a confirmação com os dois preenchidos.
    await page.goto('/leitos/mapa');
    const destino = await leitoLivre(page, 'ENF1', [origem]);
    // Pega o cartão pelo cabeçalho: o centro dele cai num dos botões do cartão, e arrastar a partir do botão não
    // dispara o dragstart do leito.
    await page.dragAndDrop(`[data-testid="leito-${origem}"]`, `[data-testid="leito-${destino}"]`, {
      sourcePosition: { x: 12, y: 12 },
      targetPosition: { x: 12, y: 12 },
    });
    await expect(page).toHaveURL(/\/leitos\/transferencias\?destino=.*&internacao=\d+/);
    await expect(page.getByTestId('tela-transferencia')).toBeVisible();
    await esperarValor(page.getByTestId('transf-internacao'), String(reg));
    await esperarValor(page.getByTestId('transf-destino'), destino);
    await semViolacaoAxe(page, '/leitos/transferencias');
    await page.getByTestId('transf-gravar').click();
    await expect(page.getByTestId('transf-feita')).toBeVisible();
    await page.goto(`/internacao/${reg}/trocas`);
    await expect(page.getByTestId('tela-trocas')).toBeVisible();
    await semViolacaoAxe(page, '/internacao/:reg/trocas');

    // A recepção não registra a alta médica; a saída espera a decisão do médico.
    await page.goto(`/internacao/${reg}/alta`);
    await expect(page.getByTestId('alta-sem-medica')).toBeVisible();
    await expect(page.getByTestId('alta-medica-gravar')).toHaveCount(0);
    await sair(page);

    // O médico registra a alta médica (ato médico).
    await entrar(page, 'SINT.MEDICO.INT');
    await page.goto(`/internacao/${reg}/alta`);
    await escolher(page.getByTestId('alta-medica-motivo'), '12');
    await escolher(page.getByTestId('alta-medica-destino'), 'domicilio');
    await semViolacaoAxe(page, '/internacao/:reg/alta (médico)');
    await page.getByTestId('alta-medica-gravar').click();
    await expect(page.getByTestId('alta-medica-decidida')).toBeVisible();
    await sair(page);

    // A recepção registra a saída: o leito vai à higienização.
    await entrar(page, 'SINT.INTERNACAO');
    await page.goto(`/internacao/${reg}/alta`);
    await page.getByTestId('alta-saida-gravar').click();
    await expect(page.getByTestId('alta-saida-feita')).toBeVisible();
    await page.goto('/leitos/mapa');
    await expect(page.getByTestId(`leito-${destino}`)).toHaveAttribute('data-situacao', 'higienizacao');
    // O item "Alta hospitalar" do menu acha a internação encerrada (o cancelamento e as consultas depois da saída).
    await page.goto('/internacao?acao=alta');
    await expect(page.getByTestId(`selo-alta-${reg}`)).toBeVisible();
    await page.getByTestId(`int-alta-${reg}`).click();
    await expect(page).toHaveURL(new RegExp(`/internacao/${reg}/alta`));
    await sair(page);

    // O profissional da higienização no celular: assumir, iniciar, checklist, foto, concluir.
    const celular = await browser.newContext({
      viewport: { width: 393, height: 851 },
      isMobile: true,
      hasTouch: true,
    });
    const m = await celular.newPage();
    await entrar(m, 'SINT.HIGIENIZACAO');
    await m.goto('/m/higienizacao');
    await expect(m.getByTestId('tela-app-higienizacao')).toBeVisible();
    // Quem só executa age em seu nome: o profissional vem do login (sem escolher outro).
    await expect(m.getByTestId('app-profissional')).toHaveCount(0);
    await expect(m.getByTestId('app-profissional-sessao')).toBeVisible();
    const cartao = m.locator('[data-testid^="limpeza-"][data-etapa="solicitado"]').first();
    await expect(cartao).toBeVisible();
    const sol = Number((await cartao.getAttribute('data-testid'))?.replace('limpeza-', ''));
    await semViolacaoAxe(m, '/m/higienizacao');
    await m.getByTestId(`etapa-atribuido-${sol}`).click();
    await expect(m.getByTestId(`etapa-emExecucao-${sol}`)).toBeVisible();
    await m.getByTestId(`etapa-emExecucao-${sol}`).click();
    for (const c of ['superficies', 'piso', 'banheiro', 'enxoval', 'residuos'])
      await m.getByTestId(`check-${sol}-${c}`).check();
    await m
      .getByTestId(`foto-${sol}`)
      .setInputFiles({ name: 'limpeza.jpg', mimeType: 'image/jpeg', buffer: JPEG });
    await expect(m.getByTestId('app-mensagem')).toContainText('Foto enviada');
    await m.getByTestId(`etapa-concluido-${sol}`).click();
    await expect(m.getByTestId('app-mensagem')).toContainText('aguardando a inspeção');
    await celular.close();

    // O supervisor inspeciona e libera: o leito volta a admitir.
    await entrar(page, 'SINT.SUPERVISOR.HIG');
    await page.goto('/higienizacao/painel');
    await expect(page.getByTestId('tela-painel-higienizacao')).toBeVisible();
    await semViolacaoAxe(page, '/higienizacao/painel');
    await page.goto('/higienizacao/inspecao');
    await expect(page.getByTestId(`aprovar-${sol}`)).toBeVisible();
    await semViolacaoAxe(page, '/higienizacao/inspecao');
    await page.getByTestId(`aprovar-${sol}`).click();
    await page.getByTestId(`liberar-${sol}`).click();
    await expect(page.getByTestId('insp-mensagem')).toContainText('Leito liberado');
    await page.goto('/leitos/mapa');
    await expect(page.getByTestId(`leito-${destino}`)).toHaveAttribute('data-situacao', 'livre');
    await sair(page);

    // SAME: a etiqueta da conta (o leitor manda o número e o Enter); a saída para o faturamento e o recebimento.
    await entrar(page, 'SINT.ARQUIVO');
    await page.goto('/same/movimentos');
    await expect(page.getByTestId('tela-same')).toBeVisible();
    await page.getByTestId('same-codigo').fill(`${reg}`);
    await page.getByTestId('same-codigo').press('Enter');
    await expect(page.getByTestId('same-local')).toBeVisible();
    await semViolacaoAxe(page, '/same/movimentos');
    await escolher(page.getByTestId('same-operacao'), '2');
    await escolher(page.getByTestId('same-destino'), '5');
    await escolher(page.getByTestId('same-motivo'), '1');
    await page.getByTestId('same-responsavel').locator('input').fill('RESPONSAVEL SINTETICO');
    await page.getByTestId('same-gravar').click();
    await expect(page.getByTestId('same-mensagem')).toContainText('Movimento registrado');
    await expect(page.getByTestId('same-local')).toContainText('FATURAMENTO');
    // O recebimento na auditoria, que não recebeu o envio: recusado; vira a ocorrência registrada.
    await escolher(page.getByTestId('same-operacao'), '6');
    await escolher(page.getByTestId('same-destino'), '9');
    await page.getByTestId('same-gravar').click();
    await expect(page.getByTestId('recusa-adt')).toContainText('não foi enviado');
    await page.getByTestId('same-ocorrencia-texto').locator('input').fill('Chegou sem o envio registrado');
    await page.getByTestId('same-ocorrencia-gravar').click();
    await expect(page.getByTestId('same-mensagem')).toContainText('Ocorrência registrada');
    await expect(page.getByTestId('same-ocorrencias')).toContainText('sem o envio');
    await expect(page.getByTestId('same-atrasadas')).toBeVisible();
    await semViolacaoAxe(page, '/same/movimentos (ocorrência)');
    expect(externas).toEqual([]);
  });

  test('o outro sistema ocupa o leito bloqueado no novo: sem o canal o mapa segue pela releitura; com o canal religado, o conflito chega ao vivo (até 3 s, sem recarregar); axe', async ({
    page,
  }) => {
    await entrar(page, 'SINT.INTERNACAO');
    // O canal de eventos fora do ar (a rede ou o proxy derrubou): o mapa abre e segue pela releitura de reserva.
    const CANAL = '**/api/leitos/eventos';
    await page.route(CANAL, (r) => r.abort());
    await page.goto('/leitos/mapa');
    await expect(page.getByTestId('mapa-canal')).toContainText('15 s');
    const leito = await leitoLivre(page, 'APT1');
    await page.getByTestId(`bloquear-${leito}`).click();
    await escolher(page.getByTestId('bloqueio-motivo'), 'manutencao');
    await page.getByTestId('mapa-confirmar').click();
    await expect(page.getByTestId(`leito-${leito}`)).toHaveAttribute('data-situacao', 'bloqueado');
    const [bloco, acomodacao, numero] = leito.split('|');
    const outroSistemaInterna = () => {
      mkdirSync(dirname(POR_FORA), { recursive: true });
      writeFileSync(
        POR_FORA,
        JSON.stringify({
          reg: 990_021,
          bloco,
          acomodacao,
          leito: numero,
          iniciais: 'S.S.',
          sexo: 'F',
          nascimento: '1970-01-01',
          convenio: 'CONVENIO SINTETICO',
        }),
      );
    };
    outroSistemaInterna();
    // Sem o canal: a releitura de reserva (15 s) traz o conflito sem recarregar; nada se perde.
    await expect(page.getByTestId(`leito-${leito}`)).toHaveAttribute('data-situacao', 'conflito', {
      timeout: 20_000,
    });
    rmSync(POR_FORA, { force: true });
    await expect(page.getByTestId(`leito-${leito}`)).toHaveAttribute('data-situacao', 'bloqueado', {
      timeout: 20_000,
    });
    // O canal volta: o navegador religa sozinho e o mapa fica ao vivo, com o mesmo estado.
    await page.unroute(CANAL);
    await expect(page.getByTestId('mapa-canal')).toContainText('ao vivo', { timeout: 15_000 });
    await expect(page.getByTestId(`leito-${leito}`)).toHaveAttribute('data-situacao', 'bloqueado');
    // Ao vivo: o outro sistema interna no leito bloqueado com a página aberta; o vigia (1 s no E2E) avisa pelo canal e
    // o mapa relê. A ficha pede até 2 s; 3 s de folga.
    outroSistemaInterna();
    await expect(page.getByTestId(`leito-${leito}`)).toHaveAttribute('data-situacao', 'conflito', {
      timeout: 3_000,
    });
    await expect(page.getByRole('alert').filter({ hasText: 'outro sistema' }).first()).toBeVisible();
    await semViolacaoAxe(page, '/leitos/mapa (conflito)');
    rmSync(POR_FORA, { force: true });
    await expect(page.getByTestId(`leito-${leito}`)).toHaveAttribute('data-situacao', 'bloqueado', {
      timeout: 3_000,
    });
    await page.getByTestId(`desbloquear-${leito}`).click();
    await expect(page.getByTestId(`leito-${leito}`)).toHaveAttribute('data-situacao', 'livre');
    // A etiqueta do leito com o QR code da solicitação de limpeza.
    await page.getByTestId(`etiqueta-${leito}`).click();
    await expect(page.getByTestId('mapa-mensagem')).toContainText('Etiqueta do leito');
    // O leito só para pacientes do sexo feminino: na admissão do paciente masculino ele sai da lista, com o motivo.
    await page.getByTestId(`atributos-${leito}`).click();
    await escolher(page.getByTestId('atributo-sexo'), 'F');
    await page.getByTestId('mapa-confirmar').click();
    await expect(page.getByTestId('mapa-mensagem')).toContainText('Atributos');
    await page.goto('/internacao/admissao');
    await page.getByTestId('admissao-termo').locator('input').fill('JOSE DA SILVA');
    await page.getByTestId('admissao-buscar').click();
    await page.getByTestId('admissao-paciente-1001').click();
    await expect(page.getByTestId('admissao-paciente-escolhido')).toBeVisible();
    await expect(page.getByTestId('admissao-incompativeis')).toContainText('feminino');
    const listaLeitos = await abrirCombo(page.getByTestId('admissao-leito'));
    await expect(listaLeitos.getByRole('option').first()).toBeVisible();
    await expect(listaLeitos.locator(`[role="option"]:has([data-valor="${leito}"])`)).toHaveCount(0);
    await fecharCombo(page.getByTestId('admissao-leito'), listaLeitos);
    await page.goto('/leitos/mapa');
    await page.getByTestId(`atributos-${leito}`).click();
    await escolher(page.getByTestId('atributo-sexo'), 'A');
    // W0-07: alterar atributos já definidos pede o motivo (o valor anterior fica no histórico).
    await page.getByTestId('atributo-motivo').locator('input').fill('Leito volta a ser misto');
    await page.getByTestId('mapa-confirmar').click();
    await expect(page.getByTestId('mapa-mensagem')).toContainText('Atributos');
  });

  test('pré-internação, histórico de ocupação e solicitações: telas e axe', async ({ page }) => {
    await entrar(page, 'SINT.INTERNACAO');
    for (const [rota, tela] of [
      ['/internacao/pre', 'tela-pre-internacao'],
      ['/internacao', 'tela-internados'],
      ['/leitos/historico', 'tela-historico-ocupacao'],
      ['/higienizacao/solicitacoes', 'tela-solicitacoes-limpeza'],
    ] as const) {
      await page.goto(rota);
      await expect(page.getByTestId(tela)).toBeVisible();
      await semViolacaoAxe(page, rota);
    }
  });
});
