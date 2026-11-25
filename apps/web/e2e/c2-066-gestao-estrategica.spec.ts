// E2E @C2-066 (F8, 01-ADM linha 118): gestão estratégica (mapa BSC, iniciativas e reuniões de análise crítica). As rotas
// `/api/qualidade/estrategia*` só existem no banco do cliente (na fonte sintética respondem 503), então este E2E simula
// essas rotas com um estado em memória que segue a regra do servidor. O que fica no banco está no contrato de efeito
// apps/api/src/modulos/qualidade/gestao-estrategica-propria.int.spec.ts. Aqui se prova o fluxo: o mapa com o farol de
// cada objetivo; o objetivo novo com os indicadores ligados e os pesos recusados na hora (indicador repetido, soma
// diferente de 100); a ação da iniciativa fora do período recusada na hora, o apontamento de horas (duração e data
// futura recusadas na hora) com o total e as parcelas por pessoa, e a conclusão da iniciativa; a reunião com presença
// (ausência justificada exige a justificativa), pauta pela análise crítica do indicador, deliberação com prazo validado
// na hora e encerramento só com a ata. Axe na tela. Massa SINTÉTICA.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const TELA = '/qualidade/gestao/estrategia';

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

const desempenho = (farol: string, naMeta: number, foraDaMeta: number, pct: number | null) => ({
  farol,
  percentualNaMeta: pct,
  naMeta,
  foraDaMeta,
  semResultado: 0,
});

function simular(page: Page) {
  const corpos: { caminho: string; corpo: Record<string, unknown> }[] = [];
  const indicadores = [
    { id: 10, codigo: 'IND-FIC-1', nome: 'INDICADOR FICTICIO UM' },
    { id: 11, codigo: 'IND-FIC-2', nome: 'INDICADOR FICTICIO DOIS' },
  ];
  const perspectivas = [{ id: 1, codigo: 'FIC-FIN', descricao: 'PERSPECTIVA FICTICIA FINANCEIRA', ordem: 1 }];
  const objetivos: Record<string, unknown>[] = [
    {
      id: 100,
      versao: 1,
      perspectiva: 1,
      codigo: 'O1',
      titulo: 'OBJETIVO FICTICIO UM',
      descricao: null,
      responsavel: null,
      ordem: 1,
      indicadores: [
        {
          indicador: 10,
          codigo: 'IND-FIC-1',
          nome: 'INDICADOR FICTICIO UM',
          peso: null,
          situacaoMeta: 'na_meta',
          valor: 95,
          competencia: '2026-03-01',
        },
      ],
      causas: [],
      desempenho: desempenho('verde', 1, 0, 100),
    },
  ];
  const iniciativa = {
    id: 20,
    versao: 2,
    codigo: 'INI-FIC-1',
    titulo: 'INICIATIVA FICTICIA',
    tipo: 'projeto',
    descricao: null,
    prioridade: 'media',
    situacao: 'em_andamento',
    mapa: 1,
    responsavel: 'SINT.ADMIN',
    patrocinador: null,
    inicioPrevisto: '2026-01-01',
    terminoPrevisto: '2030-12-31',
    inicioReal: '2026-01-02',
    terminoReal: null as string | null,
    progresso: 0,
    valorOrcamento: null,
    resultados: null,
    objetivos: [{ id: 100, codigo: 'O1', titulo: 'OBJETIVO FICTICIO UM' }],
    participantes: [{ usuario: 'SINT.ADMIN', papel: 'responsavel' }],
    acoes: [] as Record<string, unknown>[],
    apontamentos: [] as Record<string, unknown>[],
    horas: { total: 0, porPessoa: [] as { pessoa: string; minutos: number }[] },
  };
  const analise = {
    id: 60,
    naPauta: false,
    indicador: 'IND-FIC-2 INDICADOR FICTICIO DOIS',
    competencia: '2026-03-01',
    valor: 40,
    resultado: 'fora_da_meta',
    tendencia: null,
    situacao: 'concluida',
    analise: 'ANALISE FICTICIA',
    acaoProposta: null,
  };
  const reuniao = {
    id: 30,
    versao: 1,
    numero: 'RAC-FIC-1',
    titulo: 'REUNIAO FICTICIA',
    situacao: 'agendada',
    mapa: 1,
    competenciaInicio: '2026-01-01',
    competenciaFim: '2026-03-01',
    inicioPrevisto: '2026-04-10T09:00:00',
    fimPrevisto: null,
    realizadaEm: null as string | null,
    local: null,
    pauta: null,
    ata: null as string | null,
    responsavel: 'SINT.ADMIN',
    participantes: [
      {
        id: 50,
        versao: 1,
        usuario: 'SINT.ADMIN',
        nome: 'PESSOA FICTICIA',
        convidado: null,
        papel: 'coordenador',
        presenca: 'convocado',
        justificativa: null as string | null,
      },
      {
        id: 51,
        versao: 1,
        usuario: null,
        nome: null,
        convidado: 'CONVIDADO FICTICIO',
        papel: 'convidado',
        presenca: 'convocado',
        justificativa: null as string | null,
      },
    ],
    pautaAnalises: [] as (typeof analise)[],
    analisesDisponiveis: [analise],
    deliberacoes: [] as Record<string, unknown>[],
  };
  const ok = (rota: Route, resultado: Record<string, unknown>) =>
    json(rota, { ok: true, mensagem: 'Gravado.', resultado, repetida: false });
  const painel = () => ({
    perspectivas,
    indicadores,
    mapas: [
      {
        id: 1,
        versao: 1,
        nome: 'MAPA FICTICIO 2026',
        vigenciaInicio: '2026-01-01',
        vigenciaFim: '2026-12-31',
        ativo: true,
        objetivos: objetivos.length,
      },
    ],
    iniciativas: [
      {
        id: iniciativa.id,
        versao: iniciativa.versao,
        codigo: iniciativa.codigo,
        titulo: iniciativa.titulo,
        situacao: iniciativa.situacao,
        prioridade: iniciativa.prioridade,
        progresso: iniciativa.progresso,
        inicioPrevisto: iniciativa.inicioPrevisto,
        terminoPrevisto: iniciativa.terminoPrevisto,
        responsavel: iniciativa.responsavel,
      },
    ],
    reunioes: [
      {
        id: reuniao.id,
        versao: reuniao.versao,
        numero: reuniao.numero,
        titulo: reuniao.titulo,
        situacao: reuniao.situacao,
        inicioPrevisto: reuniao.inicioPrevisto,
        competenciaInicio: reuniao.competenciaInicio,
        competenciaFim: reuniao.competenciaFim,
      },
    ],
  });
  return {
    corpos,
    async ligar() {
      await page.route(/\/api\/qualidade\/estrategia(\/|\?|$)/, async (rota) => {
        const req = rota.request();
        const caminho = new URL(req.url()).pathname.replace('/api/qualidade/estrategia', '') || '/';
        if (req.method() === 'GET') {
          if (caminho === '/') return json(rota, painel());
          if (caminho === '/mapas/1')
            return json(rota, {
              id: 1,
              versao: 1,
              nome: 'MAPA FICTICIO 2026',
              descricao: null,
              missao: 'MISSAO FICTICIA',
              visao: null,
              valores: null,
              periodicidade: 'anual',
              vigenciaInicio: '2026-01-01',
              vigenciaFim: '2026-12-31',
              ativo: true,
              objetivos,
            });
          if (caminho === '/iniciativas/20') return json(rota, iniciativa);
          if (caminho === '/reunioes/30') return json(rota, reuniao);
          return json(rota, { title: 'Não encontrado' }, 404);
        }
        const c = req.postDataJSON() as Record<string, unknown>;
        corpos.push({ caminho, corpo: c });
        if (caminho === '/objetivos') {
          const ligados = c['indicadores'] as { indicador: number; peso: number | null }[];
          objetivos.push({
            id: 101,
            versao: 1,
            perspectiva: c['perspectiva'],
            codigo: c['codigo'],
            titulo: c['titulo'],
            descricao: null,
            responsavel: null,
            ordem: 2,
            indicadores: ligados.map((l) => ({
              indicador: l.indicador,
              codigo: indicadores.find((i) => i.id === l.indicador)?.codigo,
              nome: indicadores.find((i) => i.id === l.indicador)?.nome,
              peso: l.peso,
              situacaoMeta: l.indicador === 10 ? 'na_meta' : 'fora_da_meta',
              valor: l.indicador === 10 ? 95 : 40,
              competencia: '2026-03-01',
            })),
            causas: [],
            // Pesos 60 (na meta) e 40 (fora): 60% do peso na meta, farol amarelo pela regra do domínio.
            desempenho: desempenho('amarelo', 1, 1, 60),
          });
          return ok(rota, { id: 101 });
        }
        if (caminho === '/acoes') {
          if (c['id']) {
            const a = iniciativa.acoes.find((x) => x['id'] === c['id'])!;
            Object.assign(a, { situacao: c['situacao'], versao: Number(a['versao']) + 1, progresso: 100 });
            iniciativa.progresso = 100;
            return ok(rota, { id: Number(c['id']), progressoIniciativa: 100 });
          }
          iniciativa.acoes.push({
            id: 40,
            versao: 1,
            sequencia: 1,
            titulo: c['titulo'],
            descricao: null,
            situacao: 'pendente',
            prioridade: 'media',
            progresso: 0,
            inicioPrevisto: c['inicioPrevisto'],
            terminoPrevisto: c['terminoPrevisto'],
            inicioReal: null,
            terminoReal: null,
            duracaoPrevistaMinutos: c['duracaoPrevistaMinutos'],
            responsavel: c['responsavel'],
            minutosApontados: 0,
          });
          return ok(rota, { id: 40, progressoIniciativa: 0 });
        }
        if (caminho === '/horas') {
          const m = Number(c['minutos']);
          iniciativa.apontamentos.push({
            id: 70,
            acao: c['acao'],
            dataTrabalho: c['dataTrabalho'],
            minutos: m,
            classificacao: 'trabalho',
            descricao: null,
            pessoa: 'SINT.ADMIN',
          });
          iniciativa.acoes[0]!['minutosApontados'] = m;
          iniciativa.horas = { total: m, porPessoa: [{ pessoa: 'SINT.ADMIN', minutos: m }] };
          return ok(rota, { id: 70 });
        }
        if (caminho === '/iniciativas/20/situacao') {
          Object.assign(iniciativa, {
            situacao: c['situacao'],
            versao: iniciativa.versao + 1,
            terminoReal: '2026-04-15',
          });
          return ok(rota, { id: 20 });
        }
        if (caminho === '/reunioes/30/presenca') {
          for (const p of c['presencas'] as {
            participante: number;
            presenca: string;
            justificativa: string | null;
          }[]) {
            const alvo = reuniao.participantes.find((x) => x.id === p.participante)!;
            Object.assign(alvo, { presenca: p.presenca, justificativa: p.justificativa });
          }
          return ok(rota, { id: 30 });
        }
        if (caminho === '/reunioes/30/pauta') {
          reuniao.pautaAnalises = [{ ...analise, naPauta: true }];
          reuniao.analisesDisponiveis = [];
          return ok(rota, { id: 30 });
        }
        if (caminho === '/deliberacoes') {
          reuniao.deliberacoes.push({
            id: 80,
            versao: 1,
            sequencia: 1,
            descricao: c['descricao'],
            situacao: 'pendente',
            prazo: c['prazo'],
            concluidaEm: null,
            objetivo: null,
            indicador: c['indicador'],
            iniciativa: null,
            responsavel: c['responsavel'],
          });
          return ok(rota, { id: 80 });
        }
        if (caminho === '/reunioes/30/situacao') {
          Object.assign(reuniao, {
            situacao: c['situacao'],
            versao: reuniao.versao + 1,
            ata: c['situacao'] === 'encerrada' ? c['ata'] : reuniao.ata,
            realizadaEm: c['situacao'] === 'realizada' ? '2026-04-10T09:00:00' : reuniao.realizadaEm,
          });
          return ok(rota, { id: 30 });
        }
        return json(rota, { title: 'Rota não simulada' }, 404);
      });
    },
  };
}

test.describe('@C2-066 gestão estratégica', () => {
  test('mapa com farol e pesos validados na hora, iniciativa com ações e horas, reunião de análise crítica com ata', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const api = simular(page);
    await api.ligar();
    await entrar(page, 'SINT.ADMIN');

    // Mapa: o objetivo O1 com o farol pela última apuração.
    await page.goto(TELA);
    await expect(page.getByTestId('tela-estrategia')).toBeVisible();
    await expect(page.getByTestId('perspectiva-FIC-FIN')).toContainText('PERSPECTIVA FICTICIA FINANCEIRA');
    await expect(page.getByTestId('farol-O1')).toContainText('Verde');
    await expect(page.getByTestId('objetivo-O1')).toContainText('1 de 1 indicadores com resultado na meta');
    await semViolacaoAxe(page, TELA);

    // Objetivo novo: indicador repetido e soma dos pesos diferente de 100 recusados sem ida ao servidor.
    await page.getByTestId('objetivo-novo').click();
    await page.getByTestId('objetivo-codigo').fill('O2');
    await page.getByTestId('objetivo-titulo').fill('OBJETIVO FICTICIO DOIS');
    await page.getByTestId('objetivo-incluir-indicador').click();
    await page.getByTestId('objetivo-incluir-indicador').click();
    await escolher(page.getByTestId('objetivo-indicador-0'), '10');
    await escolher(page.getByTestId('objetivo-indicador-1'), '10');
    await expect(page.getByTestId('objetivo-recusa')).toContainText('aparece mais de uma vez');
    await escolher(page.getByTestId('objetivo-indicador-1'), '11');
    await page.getByTestId('objetivo-peso-0').fill('60');
    await expect(page.getByTestId('objetivo-recusa')).toContainText('peso de todos os indicadores');
    await page.getByTestId('objetivo-peso-1').fill('30');
    await expect(page.getByTestId('objetivo-recusa')).toContainText('precisam somar 100');
    await expect(page.getByTestId('objetivo-gravar')).toBeDisabled();
    expect(api.corpos).toEqual([]);
    await page.getByTestId('objetivo-peso-1').fill('40');
    await expect(page.getByTestId('objetivo-recusa')).toHaveCount(0);
    await page.getByTestId('objetivo-gravar').click();
    await expect(page.getByTestId('estrategia-mensagem')).toContainText('Gravado');
    await expect(page.getByTestId('farol-O2')).toContainText('Amarelo');
    expect(api.corpos.at(-1)).toEqual({
      caminho: '/objetivos',
      corpo: {
        mapa: 1,
        perspectiva: 1,
        codigo: 'O2',
        titulo: 'OBJETIVO FICTICIO DOIS',
        responsavel: null,
        indicadores: [
          { indicador: 10, peso: 60 },
          { indicador: 11, peso: 40 },
        ],
        causas: [],
      },
    });

    // Iniciativa: ação fora do período recusada na hora; apontamento de horas com o total e as parcelas.
    await page.getByTestId('estrategia-aba-iniciativas').click();
    await page.getByTestId('iniciativa-abrir-INI-FIC-1').click();
    await expect(page.getByTestId('iniciativa-detalhe')).toContainText('INICIATIVA FICTICIA');
    await page.getByTestId('acao-titulo').fill('ACAO FICTICIA');
    await page.getByTestId('acao-responsavel').fill('SINT.ADMIN');
    await page.getByTestId('acao-inicio').fill('2025-12-01');
    await page.getByTestId('acao-termino').fill('2026-06-30');
    await expect(page.getByTestId('acao-recusa')).toContainText('caber no período previsto da iniciativa');
    await expect(page.getByTestId('acao-gravar')).toBeDisabled();
    await page.getByTestId('acao-inicio').fill('2026-01-05');
    await page.getByTestId('acao-horas').fill('5');
    await expect(page.getByTestId('acao-recusa')).toHaveCount(0);
    await page.getByTestId('acao-gravar').click();
    await expect(page.getByTestId('acoes-lista')).toContainText('ACAO FICTICIA');
    expect(api.corpos.at(-1)).toEqual({
      caminho: '/acoes',
      corpo: {
        iniciativa: 20,
        titulo: 'ACAO FICTICIA',
        responsavel: 'SINT.ADMIN',
        inicioPrevisto: '2026-01-05',
        terminoPrevisto: '2026-06-30',
        duracaoPrevistaMinutos: 300,
      },
    });

    await escolher(page.getByTestId('horas-acao'), '40');
    const dataHoje = await page.getByTestId('horas-data').inputValue();
    await page.getByTestId('horas-minutos').fill('1500');
    await expect(page.getByTestId('horas-recusa')).toContainText('de 1 minuto a 24 horas');
    await page.getByTestId('horas-minutos').fill('90');
    await page.getByTestId('horas-data').fill('2099-01-01');
    await expect(page.getByTestId('horas-recusa')).toContainText('data futura');
    await expect(page.getByTestId('horas-gravar')).toBeDisabled();
    await page.getByTestId('horas-data').fill(dataHoje);
    await expect(page.getByTestId('horas-recusa')).toHaveCount(0);
    await page.getByTestId('horas-gravar').click();
    await expect(page.getByTestId('iniciativa-horas')).toContainText('Total: 1,5 h (SINT.ADMIN 1,5 h)');
    expect(api.corpos.at(-1)).toEqual({
      caminho: '/horas',
      corpo: { acao: 40, dataTrabalho: dataHoje, minutos: 90 },
    });

    // Conclusão: a ação concluída e depois a iniciativa.
    await page.getByTestId('acao-concluir-1').click();
    await expect(page.getByTestId('acao-concluir-1')).toHaveCount(0);
    await escolher(page.getByTestId('iniciativa-situacao'), 'concluida');
    await page.getByTestId('iniciativa-situacao-gravar').click();
    await expect(page.getByTestId('iniciativa-detalhe')).toContainText('Concluída');
    expect(api.corpos.at(-1)).toEqual({
      caminho: '/iniciativas/20/situacao',
      corpo: { versao: 2, situacao: 'concluida' },
    });
    await semViolacaoAxe(page, TELA);

    // Reunião de análise crítica: presença, pauta, deliberação e encerramento com ata.
    await page.getByTestId('estrategia-aba-reunioes').click();
    await page.getByTestId('reuniao-abrir-RAC-FIC-1').click();
    await expect(page.getByTestId('reuniao-detalhe')).toContainText('REUNIAO FICTICIA');
    await escolher(page.getByTestId('presenca-50'), 'presente');
    await escolher(page.getByTestId('presenca-51'), 'ausencia_justificada');
    await expect(page.getByTestId('reuniao-detalhe')).toContainText(
      'A ausência justificada exige a justificativa.',
    );
    await expect(page.getByTestId('presenca-gravar')).toBeDisabled();
    await page.getByTestId('justificativa-51').fill('COMPROMISSO FICTICIO');
    await page.getByTestId('presenca-gravar').click();
    await expect(page.getByTestId('estrategia-mensagem')).toContainText('Gravado');
    expect(api.corpos.at(-1)).toEqual({
      caminho: '/reunioes/30/presenca',
      corpo: {
        presencas: [
          { participante: 50, presenca: 'presente', justificativa: null },
          { participante: 51, presenca: 'ausencia_justificada', justificativa: 'COMPROMISSO FICTICIO' },
        ],
      },
    });

    await page.getByTestId('pauta-incluir-60').click();
    await expect(page.getByTestId('pauta-lista')).toContainText('IND-FIC-2');
    expect(api.corpos.at(-1)).toEqual({ caminho: '/reunioes/30/pauta', corpo: { analises: [60] } });

    await page.getByTestId('deliberacao-descricao').fill('DELIBERACAO FICTICIA');
    await page.getByTestId('deliberacao-prazo').fill('2026-04-01');
    await expect(page.getByTestId('deliberacao-recusa')).toContainText('antes da data da reunião');
    await expect(page.getByTestId('deliberacao-gravar')).toBeDisabled();
    await page.getByTestId('deliberacao-prazo').fill('2026-05-30');
    await expect(page.getByTestId('deliberacao-recusa')).toHaveCount(0);
    await page.getByTestId('deliberacao-gravar').click();
    await expect(page.getByTestId('deliberacoes-lista')).toContainText('DELIBERACAO FICTICIA');
    expect(api.corpos.at(-1)).toEqual({
      caminho: '/deliberacoes',
      corpo: {
        reuniao: 30,
        descricao: 'DELIBERACAO FICTICIA',
        responsavel: null,
        prazo: '2026-05-30',
        indicador: null,
      },
    });

    await page.getByTestId('reuniao-realizar').click();
    await expect(page.getByTestId('reuniao-encerrar')).toBeDisabled();
    await page.getByTestId('reuniao-ata').fill('ATA FICTICIA DA REUNIAO');
    await page.getByTestId('reuniao-encerrar').click();
    await expect(page.getByTestId('reuniao-ata-lida')).toContainText('ATA FICTICIA DA REUNIAO');
    expect(api.corpos.at(-1)).toEqual({
      caminho: '/reunioes/30/situacao',
      corpo: { versao: 2, situacao: 'encerrada', ata: 'ATA FICTICIA DA REUNIAO' },
    });
    await semViolacaoAxe(page, TELA);
    expect(externas).toEqual([]);
  });
});
