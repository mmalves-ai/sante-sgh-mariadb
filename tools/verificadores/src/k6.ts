// pnpm k6 -- <cenario> (M09, regra 15; cap-14 §14.2.7; convencoes.md §13): linha de base de carga somada no
// dev (DP-15: indicação, não meta). Sobe a API e o worker locais com telemetria, reproduz a carga do legado na
// cópia (leituras das operações-chave do SPDATA, marcadas como `legado-simulado` no MON$) antes e durante o
// k6, roda o k6 por imagem Docker (tag e digest) contra 127.0.0.1:3300, acompanha pelo coletor MON$ a
// transação mais longa do novo e grava o resumo agregado em docs/marcos/M09/carga-resultado.json.
// Só leitura (nenhuma gravação na cópia); nunca o sante-firebird nem nada externo. Rodar com a trava do E2E.
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  type AncoraCarga,
  ancoraCarga,
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  cargaAbrirFicha,
  cargaListas,
  cargaPainel,
  coletar,
  faixaPacientes,
  lerConfiguracaoNucleo,
  lerConfiguracaoVigia,
  lerEstabelecimentos,
  NucleoLegado,
  PORTAS_OCUPADAS,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { conexaoDoK6, monVazio, PROCESSOS_DO_K6, reprovasMon, somarAmostra } from './k6-mon.ts';

const raiz = resolve(import.meta.dirname, '../../..');
const IMAGEM_K6 = 'grafana/k6:2.3.0@sha256:9c2dee7f8ed74d317e4027c06a10f169b625638189de8d4555d0b3486a5aeb34';
// K6_API_PORTA (M11): outra porta para a API do k6 quando a 3300 é do `pnpm dev` de outra pessoa na VM.
const PORTA_API = Number(process.env['K6_API_PORTA'] ?? 3300);
if (!Number.isInteger(PORTA_API) || PORTA_API < 1024 || PORTA_API > 65535) {
  console.error('K6_API_PORTA: porta de 1024 a 65535.');
  process.exit(2);
}
const API = `http://127.0.0.1:${PORTA_API}`;
const OTLP = 'http://127.0.0.1:3331';
const cenario = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Jornadas (nome no resumo → tag do k6) e arquivo do resultado, por cenário. */
const JORNADAS_DO_CENARIO: Record<string, Record<string, string>> = {
  'carga-somada': {
    login: 'login',
    abrirFicha: 'ficha',
    listas: 'listas',
    paineis: 'painel',
    consultaPesada: 'relatorio',
  },
  // M11: busca de paciente (p95 < 500 ms por jornada, limiar no próprio cenário).
  'cadastro-busca': {
    buscaNome: 'busca-nome',
    buscaMae: 'busca-mae',
    buscaTelefone: 'busca-telefone',
    buscaCpf: 'busca-cpf',
  },
  // M15: prontuário ao vivo (abrir a lista e o registro com o como emitido; p95 < 1,5 s, ficha do M15).
  prontuario: {
    lista: 'prontuario-lista',
    registro: 'prontuario-registro',
    // M23 (regra 19): o cabeçalho fixo e a linha do tempo do prontuário de uso diário.
    cabecalho: 'prontuario-cabecalho',
  },
  // M17: busca de vaga, leituras da marcação e pauta do dia (p95 < 500 ms por jornada; ficha do M17, seção 11).
  agenda: {
    buscaVaga: 'vagas',
    marcacao: 'marcacao',
    pautaDoDia: 'pauta',
  },
  // M50 (etapa 2): o portal do paciente em rajada (horários p95 < 500 ms; meus agendamentos < 500 ms; as leituras da
  // marcação pelo portal < 1 s, a meta proposta pela ficha do M50 para a marcação com a carga somada).
  'portal-agenda': {
    horarios: 'portal-horarios',
    agendamentos: 'portal-agendamentos',
    marcacao: 'portal-marcacao',
  },
  // M24: prescrição (lista do atendimento e a prescrição com itens, horários e prova; p95 < 2 s, cap-14 §14.5).
  prescricao: {
    lista: 'prescricao-lista',
    leitura: 'prescricao-leitura',
    // As verificações de apoio à decisão e os horários previstos que o "Assinar" faz antes de gravar (D-K6-24).
    verificar: 'prescricao-verificar',
    // A busca do item prescritível no índice sem acento do cache (p95 < 200 ms, ficha do M24, seção 4).
    busca: 'prescricao-busca',
  },
  // M25: a beira do leito (turno p95 < 1 s; o tablet < 500 ms; a releitura < 100 ms; o histórico < 300 ms; D-K6-25).
  checagem: {
    turno: 'enfermagem-turno',
    paciente: 'enfermagem-paciente',
    releitura: 'enfermagem-releitura',
    historico: 'enfermagem-historico',
  },
  // M26: as telas do laboratório e o ciclo da vigia dos valores críticos (p95 < 1 s; a vigia < 1 s, D-K6-26).
  sadt: {
    setor: 'sadt-setor',
    coleta: 'sadt-coleta',
    mapa: 'sadt-mapa',
    liberacao: 'sadt-liberacao',
    vigia: 'sadt-vigia',
  },
  // M28: as leituras da tela de saída do estoque (saldo do local, lotes do item, saídas, requisições; p95 < 500 ms a
  // propor, as saídas < 1 s).
  'estoque-saida': {
    saldos: 'estoque-saldos',
    lotes: 'estoque-lotes',
    saidas: 'estoque-saidas',
    requisicoes: 'estoque-requisicoes',
  },
  // M29: as leituras da farmácia (a fila da unidade < 1 s; a entrega < 500 ms; os controlados < 2 s; D-K6-29).
  dispensar: {
    fila: 'farmacia-fila',
    entregas: 'farmacia-entregas',
    controlados: 'farmacia-controlados',
  },
  // M12: consulta de valor vigente e contrato em abas (meta p95 < 500 ms; ficha do M12, seção 11).
  'precos-consulta': {
    valorVigente: 'preco',
    contrato: 'contrato',
  },
  // M16: painel de leitos ao vivo com 1 e com 50 telas escutando o vigia (consultas por ciclo iguais).
  'painel-leitos': {
    painel: 'leitos-painel',
    vigiaUma: 'vigia-uma',
    vigiaCinquenta: 'vigia-cinquenta',
  },
  // M34: o relatório grande do catálogo cancelado pelo limite do adaptador (sem transação parada no banco).
  'consulta-pesada': {
    relatorioPesado: 'relatorio-pesado',
  },
  // M19: fila do guichê, painel do supervisor e estrutura (p95 < 500 ms; o supervisor < 1 s; ficha do M19, seção 11).
  senhas: {
    fila: 'fila',
    supervisor: 'supervisor',
    estrutura: 'estrutura',
  },
  // M27: a carga nominal da Fase 2 (até 400 usuários nos perfis; SLOs do cap-14 §14.5), o pico da recepção e a troca
  // de plantão (ficha do M27, seção 10). A checagem à beira do leito é do M25 (não construído): sem cenário.
  'carga-nominal': {
    login: 'login',
    worklistMedico: 'worklist-medico',
    prontuarioCabecalho: 'prontuario-cabecalho',
    prontuarioRegistro: 'prontuario-registro',
    prescricaoLeitura: 'prescricao-leitura',
    prescricaoVerificar: 'prescricao-verificar',
    worklistRecepcao: 'worklist-recepcao',
    senhasFila: 'senhas-fila',
    agendaPauta: 'agenda-pauta',
    sadtSetor: 'sadt-setor',
    sadtLiberacao: 'sadt-liberacao',
    leitosPainel: 'leitos-painel',
  },
  'pico-recepcao': {
    senhasFila: 'senhas-fila',
    worklistRecepcao: 'worklist-recepcao',
    supervisor: 'senhas-supervisor',
  },
  'troca-plantao': {
    worklistMedico: 'worklist-medico',
    prontuarioLista: 'prontuario-lista',
    prontuarioCabecalho: 'prontuario-cabecalho',
    prescricaoLista: 'prescricao-lista',
  },
};
const RESULTADO_DO_CENARIO: Record<string, readonly [string, string]> = {
  'carga-somada': ['M09', 'carga-resultado.json'],
  'cadastro-busca': ['M11', 'carga-cadastro-busca.json'],
  'precos-consulta': ['M12', 'carga-precos.json'],
  prontuario: ['M15', 'carga-prontuario.json'],
  'painel-leitos': ['M16', 'carga-painel-leitos.json'],
  agenda: ['M17', 'carga-agenda.json'],
  'portal-agenda': ['M50', 'carga-portal-agenda.json'],
  prescricao: ['M24', 'carga-prescricao.json'],
  checagem: ['M25', 'carga-checagem.json'],
  sadt: ['M26', 'carga-sadt.json'],
  'estoque-saida': ['M28', 'carga-estoque-saida.json'],
  dispensar: ['M29', 'carga-dispensar.json'],
  senhas: ['M19', 'carga-senhas.json'],
  'carga-nominal': ['M27', 'carga-nominal.json'],
  'pico-recepcao': ['M27', 'carga-pico-recepcao.json'],
  'troca-plantao': ['M27', 'carga-troca-plantao.json'],
  'consulta-pesada': ['M34', 'carga-consulta-pesada.json'],
};

function sair(msg: string, codigo = 1): never {
  console.error(msg);
  process.exit(codigo);
}

/** Falha dentro da rodada: lançada (nunca process.exit) para o finally encerrar a API, o worker e a cópia. */
class FalhaK6 extends Error {}

if (!/^[a-z0-9-]+$/.test(cenario) || !existsSync(resolve(raiz, 'infra/k6', `${cenario}.js`))) {
  sair(`Uso: pnpm k6 -- <cenario> (infra/k6/<cenario>.js). Cenário "${cenario}" não existe.`, 2);
}

// M39: o pico da recepção COM GRAVAÇÃO grava pelas rotas reais (COMMIT): só em AMBIENTE=homolog, pela TI (DP-15),
// contra a API da homologação (K6_BASE), sem subir API nem simular o outro sistema; recusado no dev, no ci e sobre a
// cópia compartilhada (k6-homologacao.ts). O resto deste arquivo é a linha de base do dev (AMBIENTE=dev).
if (cenario === 'pico-recepcao-gravacao') {
  const { rodarPicoGravacao } = await import('./k6-homologacao-cli.ts');
  process.exit(await rodarPicoGravacao(raiz, IMAGEM_K6));
}

const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
if ((env['AMBIENTE']?.trim() || 'dev') !== 'dev') sair('k6 só em AMBIENTE=dev (DP-15).');
const estabs = lerEstabelecimentos(env);
for (const e of estabs) {
  if (!['127.0.0.1', 'localhost', '::1'].includes(e.host))
    sair(`${e.codigo}: host fora do loopback; recusado.`);
  if (PORTAS_OCUPADAS.includes(e.porta))
    sair(`${e.codigo}: porta ${e.porta} é de outro projeto (nunca o sante-firebird).`);
}
const cod = estabs[0]?.codigo ?? sair('Nenhum estabelecimento configurado.');

function nucleo(extra: Record<string, string>): NucleoLegado {
  const e = { ...env, ...extra };
  return new NucleoLegado({
    env: e,
    driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(e).bibliotecaCliente }),
    pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
  });
}

async function respondendo(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2_000) })).ok;
  } catch {
    return false;
  }
}

function subir(nome: string, arquivo: string, extra: Record<string, string>): ChildProcess {
  const p = spawn(process.execPath, ['--enable-source-maps', arquivo], {
    cwd: raiz,
    env: { ...process.env, ...extra, OTEL_EXPORTER_URL: OTLP, OTEL_INTERVALO_MS: '5000' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  p.stderr?.on('data', (d: Buffer) => {
    const linha = d.toString('utf8').trim();
    if (linha) console.error(`[${nome}] ${linha.slice(0, 300)}`);
  });
  return p;
}

// ---- operações-chave do legado reproduzidas na cópia (até o trace do Delphi pela TI) ----
type Op = 'abrir-paciente' | 'lista-do-dia' | 'painel-ocupacao';
const tempos: Record<'antes' | 'durante', Record<Op, number[]>> = {
  antes: { 'abrir-paciente': [], 'lista-do-dia': [], 'painel-ocupacao': [] },
  durante: { 'abrir-paciente': [], 'lista-do-dia': [], 'painel-ocupacao': [] },
};
/** Linhas devolvidas por operação do legado simulado (0 numa operação = busca vazia: reprova). */
const linhasLegado: Record<Op, number> = { 'abrir-paciente': 0, 'lista-do-dia': 0, 'painel-ocupacao': 0 };
// Revisão do M35: um aquecimento (caches do servidor e páginas do banco) antes da janela "antes", sem registrar
// tempo: a 1ª abertura de paciente a frio puxava o p95 "antes" (191 ms) muito acima do "durante" (12 ms).
let fase: 'aquecimento' | 'antes' | 'durante' | 'fim' = 'aquecimento';
const terminou = (): boolean => fase === 'fim';
const AQUECIMENTO_MS = Number(process.env['K6_AQUECIMENTO_MS'] ?? 20_000);

async function simularLegado(n: NucleoLegado, sessoes: number, ancora: AncoraCarga): Promise<void> {
  const ctx = { rede: n.rede, hospital: cod, traceId: 'legado-simulado' };
  const { min, max } = await n.lerSomente(ctx, (l) => faixaPacientes(l));
  const sessao = async () => {
    while (!terminou()) {
      for (const op of ['abrir-paciente', 'lista-do-dia', 'painel-ocupacao'] as const) {
        if (terminou()) return;
        const t0 = performance.now();
        const achou = await n.lerSomente(ctx, async (l): Promise<number> =>
          op === 'abrir-paciente'
            ? (await cargaAbrirFicha(l, min + Math.floor(Math.random() * (max - min + 1)))).itens
            : op === 'lista-do-dia'
              ? cargaListas(l, ancora)
              : cargaPainel(l, ancora),
        );
        linhasLegado[op] += achou;
        const agora = fase;
        if (agora === 'antes' || agora === 'durante') tempos[agora][op].push(performance.now() - t0);
        await espera(1_000 + Math.random() * 2_000);
      }
    }
  };
  await Promise.all(Array.from({ length: sessoes }, sessao));
}

// ---- coletor MON$ durante a carga ----
// Só as conexões do processo medido (marcas api-k6 e worker-k6) entram no critério; as dos outros processos do
// novo na cópia compartilhada ficam à parte (k6-mon.ts).
const medido = monVazio();
const mon = {
  coletaMaxMs: 0,
  conexoesMax: {} as Record<string, number>,
  /** Maior valor por sistema de travas, esperas por trava, conflitos e comandos parados (MON$). */
  travasMax: {} as Record<string, { travas: number; esperas: number; conflitos: number; parados: number }>,
};
async function vigiar(n: NucleoLegado, limiteMs: number): Promise<void> {
  const ctx = { rede: n.rede, hospital: cod, traceId: 'k6-vigia' };
  while (fase !== 'fim') {
    try {
      const c = await n.lerSomente(ctx, (l) =>
        coletar(l, { estabelecimento: cod, limiteTransacaoMs: limiteMs }),
      );
      if (fase === 'durante') {
        somarAmostra(medido, c, limiteMs);
        mon.coletaMaxMs = Math.max(mon.coletaMaxMs, c.duracaoMs);
        for (const s of c.porSistema) {
          mon.conexoesMax[s.sistema] = Math.max(mon.conexoesMax[s.sistema] ?? 0, s.conexoes);
          const t = (mon.travasMax[s.sistema] ??= { travas: 0, esperas: 0, conflitos: 0, parados: 0 });
          t.travas = Math.max(t.travas, s.travas);
          t.esperas = Math.max(t.esperas, s.esperasPorTrava);
          t.conflitos = Math.max(t.conflitos, s.conflitos);
          t.parados = Math.max(t.parados, s.comandosParados);
        }
      }
    } catch {
      // coleta perdida: segue
    }
    await espera(2_000);
  }
}

/** Espera (até 3 min) nenhuma transação do processo medido aberta acima do limite; registra o que esperou. */
async function aguardarPartida(n: NucleoLegado, limiteMs: number): Promise<void> {
  const ctx = { rede: n.rede, hospital: cod, traceId: 'k6-partida' };
  const inicio = Date.now();
  let ultima = '';
  while (Date.now() - inicio < 180_000) {
    try {
      const c = await n.lerSomente(ctx, (l) =>
        coletar(l, { estabelecimento: cod, limiteTransacaoMs: limiteMs }),
      );
      const longas = c.conexoesDoNovo.filter(
        (x) => conexaoDoK6(x.marca) && x.transacaoMaisLongaMs > limiteMs,
      );
      if (longas.length === 0) {
        if (ultima)
          console.log(
            `▶ partida do processo medido concluída (${Math.round((Date.now() - inicio) / 1000)} s de espera)`,
          );
        return;
      }
      const agora = longas
        .map((x) => `${x.marca.split(':').at(-1)} ${Math.round(x.transacaoMaisLongaMs / 1000)} s`)
        .join(', ');
      if (agora !== ultima) console.log(`▶ aguardando a partida do processo medido: ${agora}`);
      ultima = agora;
    } catch {
      // coleta perdida: segue
    }
    await espera(2_000);
  }
  console.log('▶ a partida do processo medido não terminou em 3 min: o k6 começa assim mesmo');
}

function resumoTempos(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) =>
    s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]!) : null;
  return { n: s.length, p50: q(0.5), p95: q(0.95), max: s.length ? Math.round(s[s.length - 1]!) : null };
}

async function principal(): Promise<number> {
  if (await respondendo(`${API}/api/versao`))
    sair(`Já há uma API em ${API}: encerre-a ou use K6_API_PORTA (o k6 sobe a sua).`);
  console.log('▶ build da API e do worker');
  const b = spawnSync('nx', ['run-many', '-t', 'build', '-p', 'api', 'worker', '--outputStyle=stream'], {
    cwd: raiz,
    stdio: 'ignore',
    env: { ...process.env, NX_LOAD_DOT_ENV_FILES: 'false' },
  });
  if (b.status !== 0) sair('Build da API/worker falhou.');
  const filhos: ChildProcess[] = [];
  const sessoes = Number(process.env['LEGADO_SESSOES'] ?? 8);
  if (!Number.isInteger(sessoes) || sessoes < 1 || sessoes > 32) sair('LEGADO_SESSOES: de 1 a 32.');
  const limiteMs = lerConfiguracaoVigia(env).limiteTransacaoMs; // faixa validada (NaN é recusado)
  const legado = nucleo({ SGH_MARCA_CONEXAO: 'legado-simulado:k6', FB_POOL_TETO: String(sessoes) });
  const vigia = nucleo({ SGH_PROCESSO: 'k6-vigia', FB_POOL_TETO: '1' });
  let saida: string | null = null;
  try {
    // M11/M15: o cadastro e o prontuário leem a cópia pelas portas deles (ACESSO_FONTE_DEV=copia: só leitura).
    filhos.push(
      subir('api', 'apps/api/dist/main.js', {
        SGH_PROCESSO: PROCESSOS_DO_K6.api,
        API_PORTA: String(PORTA_API),
        ...(cenario === 'cadastro-busca' ||
        cenario === 'prontuario' ||
        cenario === 'painel-leitos' ||
        cenario === 'prescricao' ||
        cenario === 'sadt' ||
        // M27: as filas da página inicial e os prontuários e prescrições delas leem a cópia (só leitura).
        cenario === 'carga-nominal' ||
        cenario === 'pico-recepcao' ||
        cenario === 'troca-plantao' ||
        cenario === 'estoque-saida' ||
        cenario === 'dispensar'
          ? { ACESSO_FONTE_DEV: 'copia' }
          : {}),
      }),
    );
    filhos.push(
      subir('worker', 'apps/worker/dist/main.js', {
        SGH_PROCESSO: PROCESSOS_DO_K6.worker,
        VIGIA_INTERVALO_MS: '5000',
      }),
    );
    for (let i = 0; i < 90 && !(await respondendo(`${API}/api/carga/login/0`)); i++) await espera(1_000);
    if (!(await respondendo(`${API}/api/carga/login/0`)))
      throw new FalhaK6('A API não respondeu em /api/carga/login.');
    const ancora = await legado.lerSomente({ rede: legado.rede, hospital: cod, traceId: 'k6-ancora' }, (l) =>
      ancoraCarga(l),
    );
    const dia = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
    console.log(
      `▶ âncora das janelas: entrada ${dia(ancora.entrada)}, atendimento ${dia(ancora.atendimento)}`,
    );
    const pool = lerConfiguracaoNucleo(env);
    console.log(
      `▶ API no ar (pool ${pool.tetoPorEstabelecimento} conexões por estabelecimento, espera ${pool.esperaConexaoMs} ms)`,
    );
    console.log(
      `▶ carga do legado simulada (${sessoes} sessões) — ${AQUECIMENTO_MS / 1000} s de aquecimento e 45 s antes do k6`,
    );
    const sim = simularLegado(legado, sessoes, ancora);
    const vig = vigiar(vigia, limiteMs);
    await espera(AQUECIMENTO_MS);
    fase = 'antes';
    await espera(45_000);
    // M34: a partida do processo medido (a conferência do schema do worker e os primeiros ciclos dos serviços, cada um
    // na sua transação de leitura) termina antes de o k6 começar: o critério mede o regime, não a partida.
    await aguardarPartida(vigia, limiteMs);
    fase = 'durante';
    saida = mkdtempSync(join(resolve(raiz, '.tmp'), 'k6-'));
    chmodSync(saida, 0o777);
    console.log(`▶ k6 ${cenario} (imagem ${IMAGEM_K6.split('@')[0]})`);
    const vars = ['USUARIOS', 'SUBIDA', 'PATAMAR', 'PAINEIS'].flatMap((k) =>
      process.env[k] ? ['-e', `${k}=${process.env[k]}`] : [],
    );
    const k6 = await new Promise<number>((ok) => {
      const p = spawn(
        'docker',
        [
          'run',
          '--rm',
          '--name',
          `sgh-k6-${process.pid}`,
          '--network',
          'host',
          '-v',
          `${resolve(raiz, 'infra/k6')}:/scripts:ro`,
          '-v',
          `${saida}:/saida`,
          IMAGEM_K6,
          'run',
          '--quiet',
          '--no-usage-report',
          '-e',
          `BASE=${API}`,
          ...vars,
          `/scripts/${cenario}.js`,
        ],
        { cwd: raiz, stdio: ['ignore', 'inherit', 'inherit'] },
      );
      p.on('exit', (c) => ok(c ?? 1));
    });
    fase = 'fim';
    await Promise.allSettled([sim, vig]);
    const resumo = JSON.parse(readFileSync(join(saida, 'resumo.json'), 'utf8')) as {
      metrics: Record<string, { values: Record<string, number> }>;
    };
    const jornada = (j: string) => {
      const d = resumo.metrics[`http_req_duration{jornada:${j}}`]?.values ?? {};
      const f = resumo.metrics[`http_req_failed{jornada:${j}}`]?.values ?? {};
      return {
        requisicoes: Math.round((f['passes'] ?? 0) + (f['fails'] ?? 0)),
        linhasDevolvidas: Math.round(resumo.metrics[`sgh_linhas{jornada:${j}}`]?.values['count'] ?? 0),
        p50_ms: Math.round(d['p(50)'] ?? d['med'] ?? 0),
        p95_ms: Math.round(d['p(95)'] ?? 0),
        p99_ms: Math.round(d['p(99)'] ?? 0),
        max_ms: Math.round(d['max'] ?? 0),
        falhas: Number(((f['rate'] ?? 0) * 100).toFixed(2)),
      };
    };
    const resultado = {
      cenario,
      data: new Date().toISOString(),
      ambiente: 'dev (indicação; DP-15)',
      estabelecimento: cod,
      ancora: { entrada: dia(ancora.entrada), atendimento: dia(ancora.atendimento) },
      usuarios: Number(
        process.env['USUARIOS'] ??
          (cenario === 'cadastro-busca' ||
          cenario === 'prontuario' ||
          cenario === 'painel-leitos' ||
          cenario === 'agenda' ||
          cenario === 'portal-agenda' ||
          cenario === 'prescricao'
            ? 60
            : cenario === 'dispensar'
              ? 8
              : cenario === 'sadt' || cenario === 'checagem' || cenario === 'estoque-saida'
                ? 20
                : 400),
      ),
      pool: {
        porEstabelecimento: pool.tetoPorEstabelecimento,
        esperaMs: pool.esperaConexaoMs,
        consultaMs: pool.tempoConsultaMs,
      },
      k6: {
        saida: k6,
        iteracoes: Math.round(resumo.metrics['iterations']?.values['count'] ?? 0),
        requisicoes: Math.round(resumo.metrics['http_reqs']?.values['count'] ?? 0),
        vusMax: Math.round(
          resumo.metrics['vus_max']?.values['max'] ?? resumo.metrics['vus_max']?.values['value'] ?? 0,
        ),
        falhasPct: Number(((resumo.metrics['http_req_failed']?.values['rate'] ?? 0) * 100).toFixed(2)),
        jornadas: Object.fromEntries(
          Object.entries(JORNADAS_DO_CENARIO[cenario] ?? {}).map(([nome, tag]) => [nome, jornada(tag)]),
        ),
        // M34 (consulta-pesada): o tempo do executor (com a conexão em mãos) e a espera pelo pool, à parte.
        ...Object.fromEntries(
          (['sgh_executor_ms', 'sgh_espera_pool_ms'] as const)
            .filter((m) => resumo.metrics[m])
            .map((m) => {
              const v = resumo.metrics[m]!.values;
              return [
                m === 'sgh_executor_ms' ? 'executor' : 'esperaPool',
                {
                  p50_ms: Math.round(v['p(50)'] ?? 0),
                  p95_ms: Math.round(v['p(95)'] ?? 0),
                  max_ms: Math.round(v['max'] ?? 0),
                },
              ];
            }),
        ),
      },
      legadoSimulado: {
        sessoes,
        linhasDevolvidas: linhasLegado,
        antes: Object.fromEntries(Object.entries(tempos.antes).map(([k, v]) => [k, resumoTempos(v)])),
        durante: Object.fromEntries(Object.entries(tempos.durante).map(([k, v]) => [k, resumoTempos(v)])),
      },
      mon: {
        amostras: medido.amostras,
        limiteTransacaoMs: limiteMs,
        // Processo medido: a API e o worker que o runner subiu (marcas api-k6 e worker-k6).
        conexoesDoProcessoMedidoMax: medido.conexoesMax,
        transacaoNovoMaisLongaMs: medido.maisLongaMs,
        transacaoNovoMaisLongaProcesso: medido.maisLongaProcesso,
        transacoesNovoAcimaDoLimite: medido.acimaDoLimite,
        transacoesEscritaDoNovoMax: medido.escritaMax,
        // Outros processos marcados como sistema novo na cópia compartilhada (informação; não reprovam).
        outrosProcessosDoNovo: {
          conexoesMax: medido.outrosConexoesMax,
          transacaoMaisLongaMs: medido.outrosMaisLongaMs,
          transacoesAcimaDoLimite: medido.outrosAcimaDoLimite,
          transacoesEscritaMax: medido.outrosEscritaMax,
        },
        coletaMaxMs: mon.coletaMaxMs,
        conexoesMaxPorSistema: mon.conexoesMax,
        travasMaxPorSistema: mon.travasMax,
      },
    };
    const [pastaPadrao, arquivoPadrao] = RESULTADO_DO_CENARIO[cenario] ?? ['M09', `carga-${cenario}.json`];
    // M35: K6_RESULTADO_MARCO=<Mnn> grava o resumo na pasta do marco que reexecuta o cenário (a consolidação da
    // semana), como `carga-<cenario>.json`, sem sobrescrever a linha de base do marco dono.
    const outroMarco = process.env['K6_RESULTADO_MARCO']?.trim();
    if (outroMarco && !/^M\d{2}$/.test(outroMarco)) throw new FalhaK6('K6_RESULTADO_MARCO: Mnn.');
    const pastaMarco = outroMarco || pastaPadrao;
    const arquivoResultado = outroMarco ? `carga-${cenario}.json` : arquivoPadrao;
    const destino = resolve(raiz, 'docs/marcos', pastaMarco, arquivoResultado);
    mkdirSync(resolve(raiz, 'docs/marcos', pastaMarco), { recursive: true });
    writeFileSync(destino, JSON.stringify(resultado, null, 2) + '\n');
    console.log(JSON.stringify(resultado, null, 2));
    console.log(`Resumo gravado em ${destino}`);
    // Critério de aceite (ficha do M09, seção 11): k6 sem limiar reprovado, nenhuma transação de escrita
    // do processo medido (API e worker do k6), nenhuma transação dele acima do limite e nenhuma jornada só com busca vazia.
    const reprovas: string[] = [];
    if (k6 !== 0) reprovas.push(`k6 saiu com ${k6} (limiar reprovado ou erro)`);
    reprovas.push(...reprovasMon(medido, limiteMs));
    for (const [j, v] of Object.entries(resultado.k6.jornadas))
      if (v.linhasDevolvidas === 0) reprovas.push(`jornada ${j} sem linhas`);
    for (const [op, v] of Object.entries(linhasLegado))
      if (v === 0) reprovas.push(`legado simulado ${op} sem linhas`);
    for (const r of reprovas) console.error(`✗ ${r}`);
    return reprovas.length === 0 ? 0 : 1;
  } finally {
    fase = 'fim';
    for (const f of filhos) f.kill('SIGTERM');
    await espera(1_500);
    for (const f of filhos) if (f.exitCode === null) f.kill('SIGKILL');
    await Promise.allSettled([legado.encerrar(), vigia.encerrar()]);
    if (saida) rmSync(saida, { recursive: true, force: true });
  }
}

principal().then(
  (c) => process.exit(c),
  (e: unknown) => sair(`k6 falhou: ${e instanceof Error ? e.message : String(e)}`),
);
