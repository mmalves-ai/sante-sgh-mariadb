// Rotinas agendadas na Administração (01-SIS L95, ficha F3.9), no banco próprio, pelo Executor (trilha e idempotência
// na mesma transação). Regras no domínio (@sgh/dominio-integracao, rotinas-agendadas.ts); aqui leitura e gravação.
// O worker cadastra as rotinas e grava as execuções (apps/worker/src/rotinas-registro-proprio.ts); esta porta mostra
// e comanda:
// - painel: as rotinas do cliente e do estabelecimento com a última e a próxima execução, o atraso pela tolerância,
//   o resumo da última execução e se há pedido manual pendente;
// - historico: as execuções de uma rotina (mais recentes primeiro) com as etapas e quem disparou;
// - sistema.rotina_acionar: pede a execução à mão (fica "aguardando" com quem pediu; a próxima volta do worker a
//   toma), só pela regra do acionamento manual (ativa, não suspensa, aceita manual, na vigência, sem outra em curso);
// - sistema.rotina_suspender / sistema.rotina_retomar: a suspensa não roda; ao suspender, o pedido manual pendente é
//   cancelado (o histórico fica, nunca apagado).
import {
  conferirAcionamentoManual,
  conferirMudancaExecucao,
  conferirSuspensao,
  MENSAGEM_ROTINA,
  rotinaAtrasada,
  type SituacaoRotina,
} from '@sgh/dominio-integracao';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type Linha,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown): boolean => v === true || Number(v) === 1;
const data = (v: unknown): Date | null => (v instanceof Date ? v : v ? new Date(String(v)) : null);
const iso = (v: unknown): string | null => data(v)?.toISOString() ?? null;

export const esquemaAcionarRotina = z.object({ id: z.number().int().positive() }).strict();
export const esquemaSuspensaoRotina = z
  .object({
    id: z.number().int().positive(),
    versao: z.number().int().positive(),
    acao: z.enum(['suspender', 'retomar']),
  })
  .strict();

export interface NucleoRotinas {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

export interface ContextoRotinas {
  readonly hospital: string;
  readonly login: string;
}
export type ContextoGravacaoRotinas = ContextoRotinas & {
  readonly correlacao: string;
  readonly chaveIdempotencia: string;
  readonly enderecoIp?: string;
};

export interface ResumoExecucao {
  readonly id: number;
  readonly situacao: string;
  readonly disparo: string;
  readonly ocorridoEm: string | null;
  readonly inicioEm: string | null;
  readonly fimEm: string | null;
  readonly lidos: number;
  readonly gravados: number;
  readonly rejeitados: number;
  readonly mensagemErro: string | null;
  readonly usuario: string | null;
}
export interface RotinaLida {
  readonly id: number;
  readonly versao: number;
  readonly codigo: string;
  readonly nome: string;
  readonly descricao: string | null;
  readonly categoria: string;
  readonly situacao: string;
  readonly ativo: boolean;
  readonly permiteAcionamentoManual: boolean;
  readonly intervaloSegundos: number | null;
  readonly toleranciaAtrasoSegundos: number | null;
  readonly ultimaExecucaoEm: string | null;
  readonly proximaExecucaoEm: string | null;
  readonly atrasada: boolean;
  readonly atrasoSegundos: number;
  readonly pedidoPendente: boolean;
  /** O que impede o acionamento manual agora (nulo: pode acionar). */
  readonly impedimentoAcionar: string | null;
  readonly ultima: ResumoExecucao | null;
}
export interface EtapaLida {
  readonly sequencia: number;
  readonly nome: string;
  readonly situacao: string;
  readonly inicioEm: string | null;
  readonly fimEm: string | null;
  readonly lidos: number;
  readonly gravados: number;
  readonly rejeitados: number;
  readonly mensagem: string | null;
}
export interface ExecucaoLida extends ResumoExecucao {
  readonly etapas: EtapaLida[];
}

const recusar = (r: keyof typeof MENSAGEM_ROTINA) => recusa(r, MENSAGEM_ROTINA[r]);
const naoEncontrada = () => new ErroOperacao(404, 'rotina-desconhecida', 'Rotina', 'Rotina não encontrada.');

const SQL_EXECUCAO = `SELECT x.id, x.situacao, x.disparo, x.ocorrido_em, x.inicio_em, x.fim_em, x.registros_lidos,
  x.registros_gravados, x.registros_rejeitados, x.mensagem_erro, u.login
  FROM execucao_rotina x LEFT JOIN usuario u ON u.id = x.usuario_id`;

const resumo = (x: Linha): ResumoExecucao => ({
  id: num(x['id']),
  situacao: String(x['situacao']),
  disparo: String(x['disparo']),
  ocorridoEm: iso(x['ocorrido_em']),
  inicioEm: iso(x['inicio_em']),
  fimEm: iso(x['fim_em']),
  lidos: num(x['registros_lidos']),
  gravados: num(x['registros_gravados']),
  rejeitados: num(x['registros_rejeitados']),
  mensagemErro: txt(x['mensagem_erro']),
  usuario: txt(x['login']),
});

export class RotinasAgendadasPropria {
  private readonly executor: Executor;

  private readonly opAcionar = definirOperacao<z.infer<typeof esquemaAcionarRotina>, { execucao: number }>({
    nome: 'sistema.rotina_acionar',
    tabelas: ['execucao_rotina'],
    entrada: esquemaAcionarRotina,
    gravar: (tx, e, ctx) => this.acionarTx(tx, e.id, ctx),
    alvo: (_e, r) => ({ tabela: 'execucao_rotina', id: r.execucao }),
  });

  private readonly opSuspensao = definirOperacao<
    z.infer<typeof esquemaSuspensaoRotina>,
    { id: number; situacao: string; cancelados: number }
  >({
    nome: 'sistema.rotina_suspensao',
    tabelas: ['rotina_agendada', 'execucao_rotina'],
    entrada: esquemaSuspensaoRotina,
    gravar: (tx, e, ctx) => this.suspensaoTx(tx, e, ctx.estabelecimento ?? null),
    alvo: (e) => ({ tabela: 'rotina_agendada', id: e.id }),
  });

  constructor(
    private readonly nucleo: NucleoRotinas,
    private readonly cliente: string,
    private readonly agora: () => Date = () => new Date(),
  ) {
    this.executor = nucleo.criarExecutor();
  }

  private async quem(l: Leitor, c: ContextoRotinas) {
    const e = await l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
      c.hospital,
    ]);
    if (!e)
      throw new ErroOperacao(
        403,
        'estabelecimento-desconhecido',
        'Estabelecimento',
        'O estabelecimento da sessão não existe no cliente.',
      );
    const u = await l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [c.login]);
    return { estabelecimento: num(e['id']), usuario: u ? num(u['id']) : null };
  }

  private async exec<S>(
    op: Parameters<Executor['executar']>[0],
    c: ContextoGravacaoRotinas,
    entrada: unknown,
  ) {
    const q = await this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'administracao.rotina' },
      (l) => this.quem(l, c),
    );
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: q.estabelecimento,
      usuario: q.usuario,
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
    };
    const r = await this.executor.executar(op, this.cliente, entrada, ctx);
    return { resultado: r.resultado as unknown as S, repetida: r.repetida };
  }

  // ── Leitura ─────────────────────────────────────────────────────────────────────────────────────

  painel(c: ContextoRotinas): Promise<{ rotinas: RotinaLida[]; agora: string }> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'administracao.rotinas' },
      async (l) => {
        const { estabelecimento } = await this.quem(l, c);
        const agora = this.agora();
        const linhas = await l.consultar(
          `SELECT r.*,
            (SELECT COUNT(*) FROM execucao_rotina p WHERE p.rotina_agendada_id = r.id AND p.situacao IN ('aguardando','em_execucao')) AS pendentes,
            (SELECT MAX(x.id) FROM execucao_rotina x WHERE x.rotina_agendada_id = r.id AND x.situacao NOT IN ('aguardando','em_execucao')) AS ultima_id
          FROM rotina_agendada r
         WHERE r.estabelecimento_id IS NULL OR r.estabelecimento_id = ?
         ORDER BY r.categoria, r.nome`,
          [estabelecimento],
          { teto: 500 },
        );
        const ids = linhas.map((x) => numOuNull(x['ultima_id'])).filter((x): x is number => x !== null);
        const ultimas = new Map<number, ResumoExecucao>();
        if (ids.length)
          for (const x of await l.consultar(
            `${SQL_EXECUCAO} WHERE x.id IN (${ids.map(() => '?').join(',')})`,
            ids,
            {
              teto: 500,
            },
          ))
            ultimas.set(num(x['id']), resumo(x));
        const rotinas = linhas.map((x): RotinaLida => {
          const situacao = String(x['situacao']) as SituacaoRotina;
          const pendentes = num(x['pendentes']);
          const base = {
            ativo: bool(x['ativo']),
            situacao,
            permiteAcionamentoManual: bool(x['permite_acionamento_manual']),
            vigenciaInicio: data(x['vigencia_inicio']),
            vigenciaFim: data(x['vigencia_fim']),
          };
          const atraso = rotinaAtrasada(
            {
              ativo: base.ativo,
              situacao,
              proximaExecucaoEm: data(x['proxima_execucao_em']),
              toleranciaAtrasoSegundos: numOuNull(x['tolerancia_atraso_segundos']),
            },
            agora,
          );
          const impedimento = conferirAcionamentoManual(base, pendentes > 0, agora);
          const ultimaId = numOuNull(x['ultima_id']);
          return {
            id: num(x['id']),
            versao: num(x['versao']),
            codigo: String(x['codigo']),
            nome: String(x['nome']),
            descricao: txt(x['descricao']),
            categoria: String(x['categoria']),
            situacao,
            ativo: base.ativo,
            permiteAcionamentoManual: base.permiteAcionamentoManual,
            intervaloSegundos: numOuNull(x['intervalo_segundos']),
            toleranciaAtrasoSegundos: numOuNull(x['tolerancia_atraso_segundos']),
            ultimaExecucaoEm: iso(x['ultima_execucao_em']),
            proximaExecucaoEm: iso(x['proxima_execucao_em']),
            atrasada: atraso.atrasada,
            atrasoSegundos: atraso.segundos,
            pedidoPendente: pendentes > 0,
            impedimentoAcionar: impedimento ? MENSAGEM_ROTINA[impedimento] : null,
            ultima: ultimaId !== null ? (ultimas.get(ultimaId) ?? null) : null,
          };
        });
        return { rotinas, agora: agora.toISOString() };
      },
    );
  }

  historico(c: ContextoRotinas, id: number, limite = 50): Promise<{ execucoes: ExecucaoLida[] }> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'administracao.rotinas' },
      async (l) => {
        const { estabelecimento } = await this.quem(l, c);
        const r = await l.uma(
          'SELECT id FROM rotina_agendada WHERE id = ? AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)',
          [id, estabelecimento],
        );
        if (!r) throw naoEncontrada();
        const lim = Math.max(1, Math.min(200, Math.trunc(limite) || 50));
        const ex = await l.consultar(
          `${SQL_EXECUCAO} WHERE x.rotina_agendada_id = ? ORDER BY x.id DESC LIMIT ${lim}`,
          [id],
          {
            teto: 200,
          },
        );
        const etapas = new Map<number, EtapaLida[]>();
        const ids = ex.map((x) => num(x['id']));
        if (ids.length)
          for (const e of await l.consultar(
            `SELECT * FROM execucao_rotina_etapa WHERE execucao_rotina_id IN (${ids.map(() => '?').join(',')}) ORDER BY execucao_rotina_id, sequencia`,
            ids,
            { teto: 20_000 },
          )) {
            const k = num(e['execucao_rotina_id']);
            const lista = etapas.get(k) ?? [];
            lista.push({
              sequencia: num(e['sequencia']),
              nome: String(e['nome']),
              situacao: String(e['situacao']),
              inicioEm: iso(e['inicio_em']),
              fimEm: iso(e['fim_em']),
              lidos: num(e['registros_lidos']),
              gravados: num(e['registros_gravados']),
              rejeitados: num(e['registros_rejeitados']),
              mensagem: txt(e['mensagem']),
            });
            etapas.set(k, lista);
          }
        return { execucoes: ex.map((x) => ({ ...resumo(x), etapas: etapas.get(num(x['id'])) ?? [] })) };
      },
    );
  }

  // ── Gravação ────────────────────────────────────────────────────────────────────────────────────

  acionar(c: ContextoGravacaoRotinas, corpo: unknown) {
    return this.exec<{ execucao: number }>(this.opAcionar, c, corpo);
  }

  suspensao(c: ContextoGravacaoRotinas, corpo: unknown) {
    return this.exec<{ id: number; situacao: string; cancelados: number }>(this.opSuspensao, c, corpo);
  }

  private async rotinaDoEstabelecimento(
    tx: TxOperacao,
    id: number,
    estabelecimento: number | null,
  ): Promise<Linha> {
    const [r] = await tx.consultarParaAtualizar(
      'SELECT * FROM rotina_agendada WHERE id = ? AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)',
      [id, estabelecimento],
      { teto: 1 },
    );
    if (!r) throw naoEncontrada();
    return r;
  }

  private async acionarTx(tx: TxOperacao, id: number, ctx: ContextoOperacao): Promise<{ execucao: number }> {
    const r = await this.rotinaDoEstabelecimento(tx, id, ctx.estabelecimento ?? null);
    const emCurso = await tx.uma(
      "SELECT COUNT(*) AS q FROM execucao_rotina WHERE rotina_agendada_id = ? AND situacao IN ('aguardando','em_execucao')",
      [id],
    );
    const agora = this.agora();
    const imp = conferirAcionamentoManual(
      {
        ativo: bool(r['ativo']),
        situacao: String(r['situacao']) as SituacaoRotina,
        permiteAcionamentoManual: bool(r['permite_acionamento_manual']),
        vigenciaInicio: data(r['vigencia_inicio']),
        vigenciaFim: data(r['vigencia_fim']),
      },
      num(emCurso?.['q']) > 0,
      agora,
    );
    if (imp) throw recusar(imp);
    const execucao = await tx.incluir('execucao_rotina', {
      rotina_agendada_id: id,
      ocorrido_em: agora,
      usuario_id: ctx.usuario ?? null,
      disparo: 'manual',
      tentativa: 1,
      situacao: 'aguardando',
      correlacao: ctx.correlacao.slice(0, 64),
    });
    return { execucao };
  }

  private async suspensaoTx(
    tx: TxOperacao,
    e: z.infer<typeof esquemaSuspensaoRotina>,
    estabelecimento: number | null,
  ): Promise<{ id: number; situacao: string; cancelados: number }> {
    const r = await this.rotinaDoEstabelecimento(tx, e.id, estabelecimento);
    const v = conferirSuspensao(String(r['situacao']) as SituacaoRotina, e.acao);
    if ('recusa' in v) throw recusa(v.recusa, v.mensagem);
    await tx.alterar('rotina_agendada', e.id, e.versao, { situacao: v.situacao });
    let cancelados = 0;
    if (e.acao === 'suspender') {
      const pend = await tx.consultarParaAtualizar(
        "SELECT id, versao FROM execucao_rotina WHERE rotina_agendada_id = ? AND situacao = 'aguardando'",
        [e.id],
        { teto: 100 },
      );
      for (const p of pend) {
        const m = conferirMudancaExecucao({ de: 'aguardando', para: 'cancelada' });
        if (m) throw recusar(m);
        await tx.alterar('execucao_rotina', num(p['id']), num(p['versao']), {
          situacao: 'cancelada',
          fim_em: this.agora(),
        });
        cancelados += 1;
      }
    }
    return { id: e.id, situacao: v.situacao, cancelados };
  }
}
