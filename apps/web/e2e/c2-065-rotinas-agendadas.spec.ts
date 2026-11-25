// E2E @C2-065 (F3, 01-SIS linha 95): rotinas agendadas na Administração pelo caminho da tela
// (`/administracao/sistema/rotinas`). O administrador vê as rotinas com a última e a próxima execução, a com falha e a
// atrasada primeiro, filtra só as com problema, abre o histórico na própria linha (etapas por estabelecimento e quem
// disparou), pede a execução à mão (o botão fica desabilitado com o motivo enquanto o pedido está pendente) e retoma a
// suspensa. As rotinas só existem no banco do cliente (na fonte sintética a API responde 503): as respostas são
// simuladas pelo Playwright com massa SINTÉTICA, no contrato do servidor. O efeito no banco está em
// apps/api/src/modulos/administracao/rotinas-agendadas-propria.int.spec.ts e
// apps/worker/src/rotinas-registro-proprio.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

const agora = Date.now();
const iso = (seg: number) => new Date(agora + seg * 1000).toISOString();
const rotina = (id: number, codigo: string, nome: string, extra: Record<string, unknown> = {}) => ({
  id,
  versao: 3,
  codigo,
  nome,
  descricao: `DESCRICAO SINTETICA ${id}`,
  categoria: 'manutencao',
  situacao: 'ociosa',
  ativo: true,
  permiteAcionamentoManual: true,
  permiteSuspensao: true,
  doCliente: true,
  podeGerir: true,
  intervaloSegundos: 60,
  toleranciaAtrasoSegundos: 1800,
  ultimaExecucaoEm: iso(-30),
  proximaExecucaoEm: iso(30),
  atrasada: false,
  atrasoSegundos: 0,
  pedidoPendente: false,
  impedimentoAcionar: null,
  ultima: null,
  ...extra,
});

function simular(page: Page, extraTodas: Record<string, unknown> = {}) {
  const st = { acionados: [] as number[], suspensoes: [] as unknown[] };
  const rotinas = [
    // O envio agendado já manda todo relatório vencido: sem "Executar agora".
    rotina(1, 'relatorio.envio.agendado', 'Envio agendado de relatórios', {
      permiteAcionamentoManual: false,
    }),
    rotina(2, 'internacao.censo.fechamento', 'Fechamento do censo diário', {
      atrasada: true,
      atrasoSegundos: 7200,
      proximaExecucaoEm: iso(-7200),
    }),
    rotina(3, 'integracao.eventos.relay', 'Envio dos eventos às integrações', {
      situacao: 'com_falha',
      permiteAcionamentoManual: false,
      ultima: {
        id: 30,
        situacao: 'falhou',
        disparo: 'agendado',
        ocorridoEm: iso(-60),
        inicioEm: iso(-60),
        fimEm: iso(-59),
        lidos: 4,
        gravados: 0,
        rejeitados: 4,
        mensagemErro: 'Error',
        usuario: null,
      },
    }),
    rotina(4, 'manutencao.vigia.banco', 'Vigia do banco de dados', {
      situacao: 'suspensa',
      permiteAcionamentoManual: false,
      // Vigia da plataforma: não se suspende pelo cliente; a que ficou suspensa de antes só se retoma.
      permiteSuspensao: false,
      impedimentoAcionar: 'A rotina está suspensa; retome-a antes de acionar.',
    }),
  ].map((x) => ({ ...x, ...extraTodas }));
  void page.route('**/api/administracao/rotinas**', (r) => {
    const url = new URL(r.request().url());
    const m = /\/rotinas\/(\d+)\/(acionar|suspensao|execucoes)$/.exec(url.pathname);
    if (!m) return json(r, { agora: new Date(agora).toISOString(), rotinas });
    const id = Number(m[1]);
    const alvo = rotinas.find((x) => x.id === id)!;
    if (m[2] === 'execucoes')
      return json(r, {
        execucoes: [
          {
            id: 21,
            situacao: 'concluida_com_avisos',
            disparo: 'manual',
            ocorridoEm: iso(-600),
            inicioEm: iso(-600),
            fimEm: iso(-598),
            lidos: 12,
            gravados: 10,
            rejeitados: 0,
            mensagemErro: null,
            usuario: 'SINT.ADMIN',
            etapas: [
              {
                sequencia: 1,
                nome: 'HOSP-SINT-A',
                situacao: 'concluida',
                inicioEm: iso(-600),
                fimEm: iso(-599),
                lidos: 12,
                gravados: 10,
                rejeitados: 0,
                mensagem: null,
              },
              {
                sequencia: 2,
                nome: 'HOSP-SINT-B',
                situacao: 'falhou',
                inicioEm: iso(-599),
                fimEm: iso(-598),
                lidos: 0,
                gravados: 0,
                rejeitados: 0,
                mensagem: 'TypeError',
              },
            ],
          },
        ],
      });
    if (m[2] === 'acionar') {
      st.acionados.push(id);
      Object.assign(alvo, {
        pedidoPendente: true,
        impedimentoAcionar: 'Já há uma execução desta rotina em curso; aguarde o fim.',
      });
      return json(r, { resultado: { execucao: 99 }, repetida: false });
    }
    const corpo = r.request().postDataJSON() as { acao: string };
    st.suspensoes.push({ id, ...corpo });
    Object.assign(alvo, {
      situacao: corpo.acao === 'retomar' ? 'ociosa' : 'suspensa',
      impedimentoAcionar: null,
    });
    return json(r, { resultado: { id, situacao: alvo.situacao, cancelados: 0 }, repetida: false });
  });
  return st;
}

test.describe('@C2-065 rotinas agendadas', () => {
  test('falha e atraso primeiro, histórico na linha, executar agora e retomar a suspensa', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const st = simular(page);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/sistema/rotinas');

    const linhas = page.getByTestId('tabela-rotinas').locator('tbody > tr');
    await expect(linhas.nth(0)).toHaveAttribute('data-testid', 'rotina-integracao.eventos.relay');
    await expect(linhas.nth(1)).toHaveAttribute('data-testid', 'rotina-internacao.censo.fechamento');
    await expect(page.getByTestId('rotina-internacao.censo.fechamento')).toContainText(
      'Atrasada há 2 h 0 min',
    );
    await expect(page.getByTestId('rotina-integracao.eventos.relay')).toContainText('Com falha');
    await expect(page.getByTestId('rotina-integracao.eventos.relay')).toContainText('rejeitados 4');

    // Filtro num clique: só as com problema.
    await page.getByTestId('rotinas-so-problemas').check();
    await expect(page.getByTestId('rotina-relatorio.envio.agendado')).toHaveCount(0);
    await page.getByTestId('rotinas-so-problemas').uncheck();

    // Histórico na própria linha, com as etapas e quem disparou.
    await page.getByTestId('historico-relatorio.envio.agendado').click();
    const hist = page.getByTestId('historico-lista-relatorio.envio.agendado');
    await expect(hist).toContainText('por SINT.ADMIN');
    await hist.locator('summary').first().click();
    await expect(hist).toContainText('HOSP-SINT-B');
    await expect(hist).toContainText('TypeError');

    // Executar agora (só o censo, que recupera os dias sem retrato): o pedido fica pendente e o botão desabilita.
    await expect(page.getByTestId('executar-relatorio.envio.agendado')).toHaveCount(0);
    await page.getByTestId('executar-internacao.censo.fechamento').click();
    await expect(page.getByTestId('rotinas-aviso')).toContainText('Execução pedida');
    expect(st.acionados).toEqual([2]);
    await expect(page.getByTestId('executar-internacao.censo.fechamento')).toBeDisabled();

    // A vigia não aceita acionamento à mão (sem botão) e está suspensa: retomar num clique.
    await expect(page.getByTestId('executar-manutencao.vigia.banco')).toHaveCount(0);
    await page.getByTestId('retomar-manutencao.vigia.banco').click();
    await expect(page.getByTestId('rotinas-aviso')).toHaveText('Feito.');
    expect(st.suspensoes).toEqual([{ id: 4, versao: 3, acao: 'retomar' }]);
    // Retomada, a vigia não oferece "Suspender" (não para pela suspensão do cliente); as outras oferecem.
    await expect(page.getByTestId('retomar-manutencao.vigia.banco')).toHaveCount(0);
    await expect(page.getByTestId('suspender-manutencao.vigia.banco')).toHaveCount(0);
    await expect(page.getByTestId('suspender-relatorio.envio.agendado')).toBeVisible();

    await semViolacaoAxe(page, 'rotinas agendadas');
    expect(externas).toEqual([]);
  });

  test('sem o alcance do cliente, a rotina de todos os estabelecimentos não se aciona nem se suspende', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const st = simular(page, { podeGerir: false, impedimentoAcionar: 'exige o alcance do cliente' });
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/sistema/rotinas');

    const censo = page.getByTestId('rotina-internacao.censo.fechamento');
    await expect(page.getByTestId('sem-alcance-internacao.censo.fechamento')).toContainText(
      'alcance do cliente',
    );
    await expect(censo.getByRole('button', { name: 'Executar agora' })).toHaveCount(0);
    await expect(page.getByTestId('suspender-internacao.censo.fechamento')).toHaveCount(0);
    await expect(page.getByTestId('retomar-manutencao.vigia.banco')).toHaveCount(0);
    // O histórico continua aberto a quem lê.
    await page.getByTestId('historico-internacao.censo.fechamento').click();
    await expect(page.getByTestId('historico-lista-internacao.censo.fechamento')).toContainText(
      'por SINT.ADMIN',
    );
    expect(st.acionados).toEqual([]);
    expect(st.suspensoes).toEqual([]);

    await semViolacaoAxe(page, 'rotinas agendadas sem alcance');
    expect(externas).toEqual([]);
  });
});
