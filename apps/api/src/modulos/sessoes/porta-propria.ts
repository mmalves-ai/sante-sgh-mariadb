// Porta da agenda de sessões sobre o banco do cliente (M50, etapa 6), pelo @sgh/nucleo. A série é o plano de sessões
// (plano_sessao, com número de negócio) e cada sessão, uma sessao_terapeutica; as cadeiras e salas são os recursos
// agendáveis ligados às agendas (recurso_agendavel e agenda_recurso), com a complexidade e a duração aceitas
// (complexidade_sessao e duracao_sessao). Toda leitura filtra o estabelecimento da sessão e os excluídos; as gravações
// vão numa operação do Executor (trilha, outbox e idempotência na mesma transação), com o recurso e o paciente
// travados e a ocupação relida antes de gravar, e a trava otimista pela versão em cada sessão.
// Melhoria: o paciente é do cliente inteiro: a sessão dele em OUTRO estabelecimento também impede o horário (um
// paciente não está em dois lugares); o plano guarda o item agendável, o profissional solicitante e a fonte pagadora
// (o que o faturamento da sessão exige) e recusa sem eles; a sessão realizada guarda o instante e a cancelada, quem e
// quando; o relógio é o do fuso do estabelecimento.
// Pendência de modelo (pedido do lote 02-14): a faixa etária aceita pelo recurso (recurso_agendavel.faixa_inicial/final
// são posições da grade, não idade); até lá, o recurso aceita qualquer idade.
import { randomUUID } from 'node:crypto';
import type { SituacaoSessao, TipoPlanoSessao } from '@sgh/contratos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  garantirSequencia,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { type ContextoPortaM18, portaIndisponivel, type TrilhaDaGravacao } from '../exames/public-api.js';
import {
  type ContextoSessoes,
  type GravadorSessoes,
  METODOS_PORTA_SESSOES,
  type OcupacaoSessaoLida,
  type PacienteSessao,
  type PortaSessoes,
  type RecursoDeSessao,
  type SessaoAgendada,
} from './porta.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoSessoes = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const textoN = (v: unknown) => (v === null || v === undefined ? null : String(v));
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';

const FUSO_PADRAO = 'America/Sao_Paulo';
const SEM_EXECUTOR =
  'A agenda de sessões grava pela gravação direta da porta (sem operação declarada no catálogo).';
/** Teto da grade e da ficha do paciente (o corte é avisado). */
const TETO_PERIODO = 500;
const TETO_PACIENTE = 100;
/** Tipo do recurso no modelo → código numérico da tela. */
const TIPOS_RECURSO = ['sala', 'consultorio', 'equipamento', 'cadeira', 'poltrona', 'leito_dia', 'outro'];
const TABELAS = ['plano_sessao', 'sessao_terapeutica', 'sequencia_negocio'];

/** Relógio civil no fuso ("AAAA-MM-DD" e "AAAA-MM-DDTHH:MM"). */
export function relogioCivil(fuso: string, agora: Date = new Date()): { hoje: string; agora: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: fuso,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(agora)
      .map((x) => [x.type, x.value]),
  );
  const hoje = `${p['year']}-${p['month']}-${p['day']}`;
  return { hoje, agora: `${hoje}T${p['hour']}:${p['minute']}` };
}

/** "AAAA-MM-DDTHH:MM" → DATETIME civil do banco. */
const paraBanco = (iso: string) => `${iso.replace('T', ' ')}:00`;
const MINUTO = (c: string) => `DATE_FORMAT(${c}, '%Y-%m-%dT%H:%i')`;

const SQL_SESSOES = `
  SELECT s.id, s.plano_sessao_id, s.sequencia, p.total_sessoes, p.agenda_servico_id, s.recurso_agendavel_id,
         p.complexidade_sessao_id, p.duracao_sessao_id, p.paciente_id, pa.numero_prontuario, p.tipo_plano,
         p.motivo AS plano, ${MINUTO('s.inicio_previsto')} AS inicio, ${MINUTO('s.fim_previsto')} AS fim, s.situacao,
         COALESCE(s.observacao, p.observacao) AS observacao, s.motivo, uc.login AS por, s.criado_em,
         ua.login AS alterado_por, s.alterado_em, s.versao
    FROM sessao_terapeutica s
    JOIN plano_sessao p ON p.id = s.plano_sessao_id
    JOIN paciente pa ON pa.id = p.paciente_id
    LEFT JOIN usuario uc ON uc.id = s.criado_por
    LEFT JOIN usuario ua ON ua.id = s.alterado_por
   WHERE p.estabelecimento_id = ? AND s.excluido_em IS NULL AND p.excluido_em IS NULL`;

/** As sessões ativas que cruzam algum dos horários (recurso do estabelecimento, ou o paciente em qualquer um). */
function sqlOcupacoes(alvo: { recurso: number } | { paciente: number }, horarios: number): string {
  const janela = Array.from(
    { length: horarios },
    () => '(s.inicio_previsto < ? AND s.fim_previsto > ?)',
  ).join(' OR ');
  return `
  SELECT s.id, s.plano_sessao_id, ${MINUTO('s.inicio_previsto')} AS inicio, ${MINUTO('s.fim_previsto')} AS fim
    FROM sessao_terapeutica s JOIN plano_sessao p ON p.id = s.plano_sessao_id
   WHERE ${'recurso' in alvo ? 's.recurso_agendavel_id = ? AND p.estabelecimento_id = ?' : 'p.paciente_id = ?'}
     AND s.situacao IN ('agendada', 'realizada') AND s.excluido_em IS NULL AND p.excluido_em IS NULL
     AND (${janela})
   ORDER BY s.inicio_previsto, s.id`;
}

function parametrosOcupacao(
  alvo: { recurso: number } | { paciente: number },
  est: number,
  horarios: readonly { inicio: string; fim: string }[],
): unknown[] {
  return [
    ...('recurso' in alvo ? [alvo.recurso, est] : [alvo.paciente]),
    ...horarios.flatMap((h) => [paraBanco(h.fim), paraBanco(h.inicio)]),
  ];
}

export class PortaSessoesPropria implements PortaSessoes {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoSessoes,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPortaM18, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c), (l) => fn(l, est));
  }

  async podeGravar() {
    return { pode: false, codigo: 'sem-operacao', motivo: SEM_EXECUTOR };
  }

  executar(): Promise<never> {
    return Promise.reject(recusa('sem-operacao', SEM_EXECUTOR));
  }

  async gravarSgh<T>(
    c: ContextoSessoes,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorSessoes) => Promise<T>,
  ): Promise<T> {
    const est = c.estabelecimento;
    if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    let saida: { valor: T } | null = null;
    const linha = () => (typeof trilha === 'function' ? (saida ? trilha(saida.valor) : null) : trilha);
    const op = definirOperacao({
      nome: 'sessoes.gravacao-direta',
      tabelas: TABELAS,
      entrada: z.object({ chave: z.string() }),
      gravar: async (tx) => {
        saida = { valor: await fn(gravador(tx, est)) };
        return {} as ResultadoOperacao;
      },
      alvo: () => {
        const l = linha();
        return { tabela: l?.entidade ?? 'sessao_terapeutica', id: l?.entidadeId ?? null };
      },
      trilha: () => ({ dados: linha()?.dadosDepois ?? null, motivo: linha()?.motivo ?? null }),
    });
    const chave = `direta:${randomUUID()}`;
    const ctx: ContextoOperacao = {
      ...contextoDe(c),
      correlacao: c.correlacao || 'sessoes',
      chaveIdempotencia: chave,
    };
    await this.executor.executar(op, c.cliente, { chave }, ctx);
    if (!saida) throw new Error('Gravação direta sem resultado.');
    return (saida as { valor: T }).valor;
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────

  relogio(c: ContextoSessoes) {
    return this.ler(c, async (l, est) => relogioCivil(await fusoDe(l, est)));
  }

  recursos(c: ContextoSessoes): Promise<RecursoDeSessao[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT r.id, r.descricao, a.id AS agenda, a.nome AS nome_agenda, a.unidade_assistencial_id, r.tipo,
                  ar.prioridade, COALESCE(ar.complexidade_sessao_id, r.complexidade_sessao_id) AS complexidade,
                  COALESCE(ar.duracao_sessao_id, r.duracao_sessao_id) AS duracao, r.ativo AND a.ativo AS ativo
             FROM agenda_recurso ar
             JOIN recurso_agendavel r ON r.id = ar.recurso_agendavel_id
             JOIN agenda_servico a ON a.id = ar.agenda_servico_id
            WHERE r.estabelecimento_id = ? AND a.estabelecimento_id = ? AND ar.excluido_em IS NULL
              AND r.excluido_em IS NULL AND a.excluido_em IS NULL
            ORDER BY a.nome, ar.prioridade, r.descricao, r.id
            LIMIT 500`,
          [est, est],
        )
      ).map((x) => ({
        recurso: n(x['id']),
        identificacao: texto(x['descricao']),
        agenda: n(x['agenda']),
        nomeAgenda: texto(x['nome_agenda']),
        unidade: n(x['unidade_assistencial_id']),
        tipo: TIPOS_RECURSO.indexOf(texto(x['tipo'])) + 1,
        prioridade: n(x['prioridade']),
        complexidade: n(x['complexidade']),
        duracao: n(x['duracao']),
        faixaInicial: null,
        faixaFinal: null,
        ativo: verdadeiro(x['ativo']),
      })),
    );
  }

  dominios(c: ContextoSessoes) {
    // Os domínios de complexidade e duração são do cliente inteiro (não têm estabelecimento).
    return this.ler(c, async (l) => {
      const [comp, dur] = await Promise.all([
        l.consultar('SELECT id, descricao FROM complexidade_sessao WHERE ativo ORDER BY ordem, id'),
        l.consultar('SELECT id, descricao FROM duracao_sessao WHERE ativo ORDER BY minutos_minimo, id'),
      ]);
      const dominio = (xs: Linha[]) => [
        { codigo: 0, nome: 'Todas' },
        ...xs.map((x) => ({ codigo: n(x['id']), nome: texto(x['descricao']) })),
      ];
      return { complexidades: dominio(comp), duracoes: dominio(dur) };
    });
  }

  periodo(c: ContextoSessoes, de: string, ate: string, recursos: readonly number[] | null) {
    return this.ler(c, async (l, est) => {
      if (recursos && recursos.length === 0) return { sessoes: [], cortada: false };
      const filtro = recursos?.length
        ? ` AND s.recurso_agendavel_id IN (${recursos.map(() => '?').join(', ')})`
        : '';
      const linhas = await l.consultar(
        `${SQL_SESSOES} AND s.inicio_previsto >= ? AND s.inicio_previsto < ?${filtro}
          ORDER BY s.inicio_previsto, s.recurso_agendavel_id, s.id LIMIT ${TETO_PERIODO + 1}`,
        [est, `${de} 00:00:00`, `${ate} 00:00:00`, ...(recursos ?? [])],
      );
      return {
        sessoes: await this.comEm(l, est, linhas.slice(0, TETO_PERIODO)),
        cortada: linhas.length > TETO_PERIODO,
      };
    });
  }

  doPaciente(c: ContextoSessoes, paciente: number, desde: string) {
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar(
        `${SQL_SESSOES} AND p.paciente_id = ? AND s.inicio_previsto >= ?
          ORDER BY s.inicio_previsto, s.id LIMIT ${TETO_PACIENTE + 1}`,
        [est, paciente, `${desde} 00:00:00`],
      );
      return {
        sessoes: await this.comEm(l, est, linhas.slice(0, TETO_PACIENTE)),
        cortada: linhas.length > TETO_PACIENTE,
      };
    });
  }

  sessao(c: ContextoSessoes, id: number) {
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar(`${SQL_SESSOES} AND s.id = ?`, [est, id]);
      return (await this.comEm(l, est, linhas))[0] ?? null;
    });
  }

  serie(c: ContextoSessoes, serie: number) {
    return this.ler(c, async (l, est) =>
      this.comEm(l, est, await l.consultar(`${SQL_SESSOES} AND p.id = ? ORDER BY s.sequencia`, [est, serie])),
    );
  }

  ocupacoes(
    c: ContextoSessoes,
    alvo: { readonly recurso: number } | { readonly paciente: number },
    horarios: readonly { readonly inicio: string; readonly fim: string }[],
  ): Promise<OcupacaoSessaoLida[]> {
    if (horarios.length === 0) return Promise.resolve([]);
    return this.ler(c, (l, est) => ocupacoesDe(l, est, alvo, horarios));
  }

  paciente(c: ContextoSessoes, id: number): Promise<PacienteSessao | null> {
    // O paciente é do cliente inteiro (o cadastro não tem estabelecimento).
    return this.ler(c, async (l) => {
      const [p] = await lerPacientes(l, [id]);
      return p ?? null;
    });
  }

  nomes(c: ContextoSessoes, ids: readonly number[]) {
    return this.ler(c, async (l) => {
      const m = new Map<number, string>();
      for (const p of await lerPacientes(l, [...new Set(ids)])) m.set(p.id, p.nome);
      return m;
    });
  }

  /** As sessões com o carimbo da inclusão e da alteração no fuso do estabelecimento. */
  private async comEm(l: Leitor, est: number, linhas: readonly Linha[]): Promise<SessaoAgendada[]> {
    if (linhas.length === 0) return [];
    const fuso = await fusoDe(l, est);
    return linhas.map((x) => sessaoDaLinha(x, fuso));
  }
}

// ── Leituras comuns ────────────────────────────────────────────────────────────────────────────────────────

async function fusoDe(l: Leitor, est: number): Promise<string> {
  const r = await l.uma<{ fuso_horario: string | null }>(
    'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
    [est],
  );
  return r?.fuso_horario || FUSO_PADRAO;
}

async function ocupacoesDe(
  l: Leitor,
  est: number,
  alvo: { readonly recurso: number } | { readonly paciente: number },
  horarios: readonly { readonly inicio: string; readonly fim: string }[],
): Promise<OcupacaoSessaoLida[]> {
  const linhas = await l.consultar(
    sqlOcupacoes(alvo, horarios.length),
    parametrosOcupacao(alvo, est, horarios),
  );
  return linhas.map((x) => ({
    id: n(x['id']),
    serie: n(x['plano_sessao_id']),
    inicio: texto(x['inicio']),
    fim: texto(x['fim']),
  }));
}

async function lerPacientes(l: Leitor, ids: readonly number[]): Promise<PacienteSessao[]> {
  if (ids.length === 0) return [];
  return (
    await l.consultar(
      `SELECT pa.id, pa.numero_prontuario, pa.situacao, ${"DATE_FORMAT(pf.data_nascimento, '%Y-%m-%d')"} AS nascimento,
              CASE WHEN pa.usa_nome_social AND pa.nome_social IS NOT NULL THEN pa.nome_social
                   WHEN pf.usa_nome_social AND pf.nome_social IS NOT NULL THEN pf.nome_social
                   ELSE pf.nome END AS nome
         FROM paciente pa JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
        WHERE pa.id IN (${ids.map(() => '?').join(', ')}) AND pa.excluido_em IS NULL`,
      ids,
    )
  ).map((x) => ({
    id: n(x['id']),
    prontuario: nn(x['numero_prontuario']),
    nome: texto(x['nome']),
    nascimento: textoN(x['nascimento']),
    ativo: !['inativo', 'unificado', 'obito'].includes(texto(x['situacao'])),
  }));
}

function sessaoDaLinha(x: Linha, fuso: string): SessaoAgendada {
  const instante = (v: unknown) => (v instanceof Date ? relogioCivil(fuso, v).agora : null);
  return {
    id: n(x['id']),
    serie: n(x['plano_sessao_id']),
    ordem: n(x['sequencia']),
    total: n(x['total_sessoes']),
    agenda: n(x['agenda_servico_id']),
    recurso: n(x['recurso_agendavel_id']),
    complexidade: n(x['complexidade_sessao_id']),
    duracao: n(x['duracao_sessao_id']),
    paciente: n(x['paciente_id']),
    prontuario: nn(x['numero_prontuario']),
    planoTipo: texto(x['tipo_plano']) as TipoPlanoSessao,
    plano: texto(x['plano']),
    inicio: texto(x['inicio']),
    fim: texto(x['fim']),
    situacao: texto(x['situacao']) as SituacaoSessao,
    observacao: textoN(x['observacao']),
    motivo: textoN(x['motivo']),
    por: texto(x['por']),
    em: instante(x['criado_em']) ?? '',
    alteradoPor: textoN(x['alterado_por']),
    alteradoEm: instante(x['alterado_em']),
    versao: n(x['versao']),
  };
}

// ── Gravador (dentro da operação do Executor) ────────────────────────────────────────────────────────────────

function usuarioDe(tx: TxOperacao): number {
  if (tx.contexto.usuario === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
  return tx.contexto.usuario;
}

const versaoDesatualizada = () =>
  recusa('versao-desatualizada', 'A sessão foi alterada por outra pessoa: atualize a grade.');

function gravador(tx: TxOperacao, est: number): GravadorSessoes {
  const agora = async () => paraBanco(relogioCivil(await fusoDe(tx, est)).agora);

  async function travarSessao(id: number) {
    const [r] = await tx.consultarParaAtualizar(
      `SELECT s.id, s.situacao, s.versao FROM sessao_terapeutica s JOIN plano_sessao p ON p.id = s.plano_sessao_id
        WHERE s.id = ? AND p.estabelecimento_id = ? AND s.excluido_em IS NULL`,
      [id, est],
      { teto: 1 },
    );
    return r ? { id: n(r['id']), situacao: texto(r['situacao']), versao: n(r['versao']) } : null;
  }

  async function mudar(
    id: number,
    versao: number,
    situacao: Exclude<SituacaoSessao, 'agendada'>,
    motivo: string | null,
    quando: string,
    usuario: number,
  ) {
    await tx.alterar('sessao_terapeutica', id, versao, {
      situacao,
      motivo,
      ...(situacao === 'realizada' ? { realizada_em: quando } : {}),
      ...(situacao === 'cancelada' ? { cancelada_em: quando, cancelado_usuario_id: usuario } : {}),
    });
  }

  const g: GravadorSessoes = {
    async agendarSerie(s) {
      const usuario = usuarioDe(tx);
      if (s.sessoes.length === 0) throw recusa('serie-vazia', 'A série precisa de ao menos uma sessão.');
      if (s.itemAgendavel === null || s.solicitante === null || s.fontePagadora === null)
        throw recusa(
          'plano-incompleto',
          'A série precisa do item agendado, do profissional que indicou o tratamento e da fonte pagadora.',
        );
      // As travas do recurso e do paciente: duas séries ao mesmo tempo não ocupam o mesmo horário.
      const [recurso] = await tx.consultarParaAtualizar(
        'SELECT id, ativo FROM recurso_agendavel WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [s.recurso, est],
        { teto: 1 },
      );
      if (!recurso || !verdadeiro(recurso['ativo']))
        throw recusa(
          'recurso-inativo',
          'A cadeira ou sala não existe neste estabelecimento ou está inativa.',
        );
      const [paciente] = await tx.consultarParaAtualizar(
        'SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL',
        [s.paciente],
        { teto: 1 },
      );
      if (!paciente) throw recusa('paciente-inexistente', 'O cadastro do paciente não existe.');
      const ocupadoRecurso = await ocupacoesDe(tx, est, { recurso: s.recurso }, s.sessoes);
      const ocupadoPaciente = await ocupacoesDe(tx, est, { paciente: s.paciente }, s.sessoes);
      const cruza = (o: { inicio: string; fim: string }, x: { inicio: string; fim: string }) =>
        o.inicio < x.fim && x.inicio < o.fim;
      for (const x of s.sessoes) {
        if (ocupadoRecurso.some((o) => cruza(o, x)))
          throw recusa('recurso-ocupado', `A sessão ${x.ordem} acabou de ser ocupada nesta cadeira ou sala.`);
        if (ocupadoPaciente.some((o) => cruza(o, x)))
          throw recusa('paciente-ocupado', `O paciente já tem outra sessão no horário da sessão ${x.ordem}.`);
      }
      await garantirSequencia(
        tx,
        { tipo: 'plano_sessao', estabelecimento: est, prefixo: 'PS-' },
        { usuario, agora: new Date() },
      );
      const numero = await tx.proximoNumero('plano_sessao');
      const datas = s.sessoes.map((x) => x.inicio.slice(0, 10)).sort();
      const serie = await tx.incluir('plano_sessao', {
        estabelecimento_id: est,
        numero: numero.formatado,
        paciente_id: s.paciente,
        tipo_plano: s.planoTipo,
        item_agendavel_id: s.itemAgendavel,
        agenda_servico_id: s.agenda,
        recurso_agendavel_id: s.recurso,
        complexidade_sessao_id: s.complexidade || null,
        duracao_sessao_id: s.duracao || null,
        solicitante_profissional_id: s.solicitante,
        fonte_pagadora_id: s.fontePagadora,
        total_sessoes: s.sessoes.length,
        intervalo_dias: s.intervaloDias,
        pula_fim_semana: s.pularFimDeSemana,
        duracao_minutos: s.duracaoMin,
        data_inicio: datas[0],
        data_fim: datas[datas.length - 1],
        situacao: 'ativo',
        motivo: s.plano,
        observacao: s.observacao,
      });
      const ids: number[] = [];
      for (const x of s.sessoes)
        ids.push(
          await tx.incluir('sessao_terapeutica', {
            plano_sessao_id: serie,
            sequencia: x.ordem,
            recurso_agendavel_id: s.recurso,
            inicio_previsto: paraBanco(x.inicio),
            fim_previsto: paraBanco(x.fim),
            situacao: 'agendada',
          }),
        );
      return { serie, ids };
    },

    async atualizar(a) {
      const usuario = usuarioDe(tx);
      const x = await travarSessao(a.id);
      if (!x || x.versao !== a.versao || x.situacao !== 'agendada') throw versaoDesatualizada();
      await mudar(x.id, x.versao, a.situacao, a.motivo, await agora(), usuario);
    },

    async cancelarRestantes(a) {
      const usuario = usuarioDe(tx);
      await g.atualizar({ id: a.id, situacao: 'cancelada', motivo: a.motivo, versao: a.versao });
      const quando = await agora();
      const restantes = await tx.consultarParaAtualizar(
        `SELECT s.id, s.versao FROM sessao_terapeutica s JOIN plano_sessao p ON p.id = s.plano_sessao_id
          WHERE s.plano_sessao_id = ? AND p.estabelecimento_id = ? AND s.sequencia > ? AND s.situacao = 'agendada'
            AND s.excluido_em IS NULL ORDER BY s.sequencia`,
        [a.serie, est, a.ordem],
      );
      for (const r of restantes)
        await mudar(n(r['id']), n(r['versao']), 'cancelada', a.motivo, quando, usuario);
      return restantes.length + 1;
    },
  };
  return g;
}

function contextoDe(c: ContextoPortaM18): ContextoNucleo {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: c.correlacao.slice(0, 64),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaSessoesIndisponivel(): PortaSessoes {
  return portaIndisponivel<PortaSessoes>(METODOS_PORTA_SESSOES);
}
