// C1-081 (04-INT linha 78): solicitação de vaga à central reguladora com o quadro clínico estruturado e a evolução.
// Em /internacao/controles/regulacao o NIR escolhe a solicitação, vê que o envio é manual (a central opera pelo próprio
// portal), grava o quadro clínico com a validação na hora (quadro curto recusado; saturação baixa sugere condição
// mais grave que a declarada), registra o contato com a central com a data e a hora do envio pelo portal (envio no
// futuro recusado na hora) e a resposta da central que autoriza a vaga; a linha do tempo mostra os quadros e os
// eventos, com o envio. Axe em cada passo.
// Motivo da simulação no primeiro cenário: o E2E roda sobre a fonte sintética, que não tem banco próprio de cliente, e
// a API real responde 503 nestes controles (a porta só existe no banco do cliente). Por isso o primeiro cenário simula
// as respostas no navegador com o formato da porta e prova só a tela e o corpo enviado; ele NÃO prova a ligação com o
// MariaDB. O segundo cenário não simula nada: passa pela API real e prova que as rotas estão registradas, exigem
// sessão, e que sem banco a tela mostra o erro em vez de inventar quadro, evento ou envio, e que a gravação do contato
// com enviadoEm é recusada (503) e não aceita em silêncio. O que fica no banco (quadro com sequência, evento com a
// situação anterior e a nova, enviado_em só no contato com a central, envio no futuro e fora do contato recusados) é
// provado pelo contrato de efeito apps/api/src/modulos/adt/controles-assistenciais-propria.int.spec.ts (MariaDB).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const SOLICITACAO = 55;

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** A API da regulação simulada com o formato das portas (a fonte sintética não tem banco próprio). */
async function simularApi(page: Page) {
  const solicitadoEm = new Date(Date.now() - 2 * 3600_000).toISOString();
  const estado = {
    situacao: 'solicitada',
    versao: 1,
    quadros: [] as Record<string, unknown>[],
    eventos: [] as Record<string, unknown>[],
    corpos: [] as Record<string, unknown>[],
  };
  const corpo = (rota: Parameters<Parameters<Page['route']>[1]>[0], json: unknown, status = 200) =>
    rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });

  await page.route('**/api/nir/regulacao', async (rota) => {
    if (rota.request().method() !== 'GET') return rota.fallback();
    return corpo(rota, {
      solicitacoes: [
        {
          solicitacao: 900,
          paciente: { id: 501, nome: 'PACIENTE SINTETICO REGULACAO' },
          estadoSolicitacao: 'pendente',
          prioridade: 'alta',
          solicitadoEm,
          vigente: {
            id: SOLICITACAO,
            solicitacao: 900,
            central: 'estadual',
            sentido: 'saida',
            numero: 'SIN-2026-0081',
            situacao: 'solicitada',
            origem: 'manual',
            observacao: null,
            anterior: null,
            mensagemHash: null,
            por: 'SINT.ADMIN',
            em: solicitadoEm,
          },
          historico: [],
        },
      ],
      contagens: { solicitada: 1 },
      conector: { ligado: false, motivo: 'Envio manual pelo portal da central', modo: 'desligado' },
      acoes: { registrar: true, motivo: null },
      lidoEm: new Date().toISOString(),
    });
  });

  await page.route('**/api/internacao/controles/regulacao/**', async (rota) => {
    const req = rota.request();
    const caminho = new URL(req.url()).pathname.replace(/.*\/controles\/regulacao/, '');
    if (req.method() === 'GET') {
      if (caminho === '/apoio')
        return corpo(rota, {
          niveisConsciencia: [{ id: 1, descricao: 'Alerta' }],
          suportesOxigenio: [{ id: 2, descricao: 'Cateter nasal sintético', invasivo: false }],
          faixasDiurese: [{ id: 3, descricao: 'Preservada' }],
          germes: [],
        });
      if (caminho === `/${SOLICITACAO}`)
        return corpo(rota, {
          solicitacao: {
            id: SOLICITACAO,
            paciente: 501,
            situacao: estado.situacao,
            numero: 'SIN-2026-0081',
            versao: estado.versao,
            solicitadoEm,
            reguladoEm: estado.situacao === 'autorizada' ? new Date().toISOString() : null,
            encerradoEm: null,
          },
          quadros: estado.quadros,
          eventos: estado.eventos,
          envio: {
            automatico: false,
            motivo: 'O envio à central é manual, pelo portal da central.',
          },
        });
      return rota.fallback();
    }
    const dados = req.postDataJSON() as Record<string, unknown>;
    estado.corpos.push(dados);
    if (caminho === `/${SOLICITACAO}/quadros`) {
      const sequencia = estado.quadros.length + 1;
      estado.quadros.unshift({
        id: 700 + sequencia,
        sequencia,
        registradoEm: new Date().toISOString(),
        enviadoEm: null,
        quadroClinico: String(dados['quadroClinico']),
        condicaoGeral: String(dados['condicaoGeral']),
        consciencia: null,
        suporteOxigenio: null,
        diurese: null,
        saturacao: (dados['saturacao'] as number | null) ?? null,
        frequenciaCardiaca: (dados['frequenciaCardiaca'] as number | null) ?? null,
        usaDrogaVasoativa: false,
        necessitaIsolamento: false,
      });
      estado.eventos.unshift({
        id: 800 + estado.eventos.length,
        tipo: 'evolucao_clinica',
        de: estado.situacao,
        para: estado.situacao,
        observacao: null,
        enviadoEm: null,
        em: new Date().toISOString(),
        por: 'SINT.ADMIN',
      });
      estado.versao += 1;
      return corpo(
        rota,
        {
          tabela: 'quadro_clinico_regulacao',
          id: 700 + sequencia,
          sequencia,
          sugerida: 'grave',
          aviso: null,
        },
        201,
      );
    }
    if (caminho === `/${SOLICITACAO}/eventos`) {
      const de = estado.situacao;
      const para = (dados['situacaoNova'] as string | null) ?? de;
      estado.eventos.unshift({
        id: 800 + estado.eventos.length,
        tipo: String(dados['tipo']),
        de,
        para,
        observacao: (dados['observacao'] as string | null) ?? null,
        enviadoEm: (dados['enviadoEm'] as string | null) ?? null,
        em: new Date().toISOString(),
        por: 'SINT.ADMIN',
      });
      if (para !== de) {
        estado.situacao = para;
        estado.versao += 1;
      }
      return corpo(rota, { tabela: 'evento_regulacao', id: 800, situacao: para }, 201);
    }
    return rota.fallback();
  });
  return estado;
}

/** datetime-local na hora do navegador, deslocado em minutos. */
const localEm = (minutos: number) => {
  const d = new Date(Date.now() + minutos * 60_000);
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

test.describe('internação: solicitação à central reguladora com quadro clínico e envio manual @C1-081', () => {
  test.setTimeout(180_000);

  test('quadro clínico com validação na hora, envio manual com data e hora, resposta da central; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const estado = await simularApi(page);
    await entrar(page, 'SINT.INTERNACAO');
    await page.goto('/internacao/controles/regulacao');
    await expect(page.getByTestId('tela-controles-internacao')).toBeVisible();
    await escolher(page.getByTestId('reg-solicitacao'), String(SOLICITACAO));
    await expect(page.getByTestId('reg-situacao')).toContainText('Solicitada');
    await expect(page.getByTestId('reg-situacao')).toContainText('Envio manual');
    await expect(page.getByTestId('reg-envio-manual')).toContainText('portal');
    await semViolacaoAxe(page, '/internacao/controles/regulacao (abertura)');

    // Quadro curto: recusado na hora, gravar travado.
    await page.getByTestId('reg-quadro-texto').fill('Dispneia');
    await expect(page.getByTestId('reg-quadro-problema')).toContainText('pelo menos 20 caracteres');
    await expect(page.getByTestId('reg-quadro-gravar')).toBeDisabled();
    // Quadro completo com saturação baixa: a condição sugerida é mais grave que a declarada (estável).
    await page
      .getByTestId('reg-quadro-texto')
      .fill('Paciente sintético com dispneia progressiva há dois dias, sem febre.');
    await page.getByTestId('reg-saturacao').fill('88');
    await expect(page.getByTestId('reg-quadro-aviso')).toContainText('mais grave que a declarada');
    await semViolacaoAxe(page, '/internacao/controles/regulacao (quadro com aviso)');
    await page.getByTestId('reg-quadro-gravar').click();
    await expect(page.getByTestId('controles-aviso')).toContainText('Quadro 1 gravado.');
    await expect(page.getByTestId('reg-quadros')).toContainText('dispneia progressiva');

    // Contato com a central: o envio no futuro é recusado na hora; com a hora certa, fica na linha do tempo.
    await escolher(page.getByTestId('reg-evento-tipo'), 'contato_central');
    await page.getByTestId('reg-evento-obs').fill('Pedido enviado pelo portal da central');
    await page.getByTestId('reg-evento-enviado-em').fill(localEm(120));
    await expect(page.getByTestId('reg-evento-problema')).toContainText('não pode ficar no futuro');
    await expect(page.getByTestId('reg-evento-gravar')).toBeDisabled();
    await page.getByTestId('reg-evento-enviado-em').fill(localEm(-10));
    await expect(page.getByTestId('reg-evento-problema')).toHaveCount(0);
    await semViolacaoAxe(page, '/internacao/controles/regulacao (envio manual)');
    await page.getByTestId('reg-evento-gravar').click();
    await expect(page.getByTestId('controles-aviso')).toContainText('Evolução registrada');
    await expect(page.getByTestId('reg-eventos')).toContainText('Contato com a central');
    await expect(page.getByTestId('reg-eventos')).toContainText('enviado à central em');
    const contato = estado.corpos.find((c) => c['tipo'] === 'contato_central');
    expect(contato?.['enviadoEm']).toEqual(expect.any(String));

    // Resposta da central que autoriza a vaga: a data do envio não vai na resposta (campo some).
    await escolher(page.getByTestId('reg-evento-tipo'), 'resposta');
    await expect(page.getByTestId('reg-evento-enviado-em')).toHaveCount(0);
    await escolher(page.getByTestId('reg-evento-situacao'), 'autorizada');
    await page.getByTestId('reg-evento-obs').fill('Vaga liberada no hospital de referência sintético');
    await page.getByTestId('reg-evento-gravar').click();
    await expect(page.getByTestId('reg-situacao')).toContainText('Autorizada');
    await expect(page.getByTestId('reg-eventos')).toContainText('Resposta da central');
    const resposta = estado.corpos.find((c) => c['tipo'] === 'resposta');
    expect(resposta?.['enviadoEm'] ?? null).toBeNull();
    await semViolacaoAxe(page, '/internacao/controles/regulacao (autorizada)');
    expect(externas).toEqual([]);
  });

  test('API real, sem simulação: rotas registradas, sem banco a tela mostra o erro e a gravação é recusada; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    // Sem login, a rota existe e é recusada, nunca 404. Em dev/ci, sem cookie a API resolve a sessão sintética da casca
    // (administrador do sistema e gestor de acessos, resolvedor-sessao.ts), que não tem internacao.regulacao.ler: 403.
    const anonimo = await page.request.get(`/api/internacao/controles/regulacao/${SOLICITACAO}`);
    expect(anonimo.status()).toBe(403);

    await entrar(page, 'SINT.INTERNACAO');
    const apoio = page.waitForResponse((r) => r.url().includes('/api/internacao/controles/regulacao/apoio'));
    await page.goto('/internacao/controles/regulacao');
    await expect(page.getByTestId('tela-controles-internacao')).toBeVisible();
    // A fonte sintética não tem banco próprio: a API real responde 503, e a tela mostra o erro.
    expect((await apoio).status()).toBe(503);
    await expect(page.getByTestId('mensagem-erro').first()).toBeVisible();
    // Nada inventado: sem linha do tempo, não há situação, formulário de quadro, evento nem envio.
    await expect(page.getByTestId('reg-situacao')).toHaveCount(0);
    await expect(page.getByTestId('reg-quadro-gravar')).toHaveCount(0);
    await expect(page.getByTestId('reg-evento-enviado-em')).toHaveCount(0);

    // Leitura e gravação pela API real com a sessão: o contato com a central e o envio são recusados sem banco (503),
    // não aceitos em silêncio.
    const linha = await page.request.get(`/api/internacao/controles/regulacao/${SOLICITACAO}`);
    expect(linha.status()).toBe(503);
    const csrf = (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '';
    const gravar = await page.request.post(`/api/internacao/controles/regulacao/${SOLICITACAO}/eventos`, {
      headers: { 'x-csrf': csrf },
      data: {
        tipo: 'contato_central',
        situacaoNova: null,
        observacao: 'Pedido enviado pelo portal da central',
        enviadoEm: new Date(Date.now() - 10 * 60_000).toISOString(),
        versao: 1,
      },
    });
    expect(gravar.status()).toBe(503);
    await semViolacaoAxe(page, '/internacao/controles/regulacao (sem banco próprio)');
    expect(externas).toEqual([]);
  });
});
