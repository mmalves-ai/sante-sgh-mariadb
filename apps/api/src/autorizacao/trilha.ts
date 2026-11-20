// Registro dos eventos auditáveis (ficha do M06, regra 10 e seção 5; cap-08 §8.12): todo evento vai à
// SGH_TRILHA (trilha própria, só inclusão, cadeia de hash) e, quando o Delphi registraria o mesmo evento, à
// TBCABTRILHA/TBLANTRILHASGH como o Delphi grava, NA MESMA TRANSAÇÃO, pela operação do protocolo
// auditoria.registrarEventoLegado (executor do M04). Usuário que o legado não conhece (login falho com nome
// inexistente, ou texto que nem é um login válido do legado: mais de 31 caracteres, espaço no início) fica só
// na trilha própria, como "(desconhecido)": o texto digitado nunca vai à trilha. Em
// dev/ci com a fonte sintética, o registro é em memória (nada grava na cópia).
import { randomUUID } from 'node:crypto';
import { eventoAuditavel, type RegistrarEventoLegadoEntrada } from '@sgh/contratos';
import {
  ErroOperacao,
  type ContextoOperacao,
  type Executor,
  type LinhaTrilha,
  type MarcaComo,
  marcaComoAtual,
  operacao,
} from '@sgh/legado';

export const USUARIO_DESCONHECIDO = '(desconhecido)';
/** Forma de TBUSERS.NOME aceita pelo executor (fora dela, o legado não conhece o usuário). */
const LOGIN_DO_LEGADO = /^\S.{0,30}$/;
/** Recusas do executor que significam "usuário que o legado não conhece". */
const RECUSAS_DE_USUARIO = new Set(['usuario-inexistente', 'contexto-invalido']);
/**
 * M60.3 (ensaio do manual de implantação): a gravação na trilha do sistema anterior é uma operação compatível como
 * outra qualquer; em produção, só grava depois de `liberada` no catálogo e ligada no estabelecimento (M38, §4, passo
 * 5, que vem DEPOIS das primeiras entradas da TI e do comitê). Até lá, o evento fica só na SGH_TRILHA, com o usuário
 * real: a entrada não pode depender de uma gravação no outro sistema ainda não liberada. D-TRILHA-LIBERACAO-60.3.
 */
const RECUSAS_DE_LIBERACAO = new Set(['operacao-nao-liberada', 'operacao-bloqueada']);

export interface EventoParaTrilha {
  /** Código do catálogo de eventos auditáveis (@sgh/contratos, auditoria/eventos.ts). */
  readonly evento: string;
  readonly rede: string;
  readonly hospital: string;
  /** TBUSERS.NOME de quem fez (ou tentou). */
  readonly usuario: string;
  /** "ESTACAO:origem" (MAQUINA_USUARIO do legado; ESTACAO da trilha própria). */
  readonly estacao: string;
  readonly correlacao: string;
  readonly recurso: string;
  readonly resultado: 'sucesso' | 'falha';
  readonly atendimento?: number;
  readonly paciente?: number;
  readonly tabelaAlvo?: string;
  readonly idAlvo?: string;
  /** Chave natural do alvo (sem dado pessoal; ex.: a justificativa da exportação e a contagem). */
  readonly chaveNaturalAlvo?: string;
  /**
   * Correção do M57.2 (D-TRILHA-REMOTA-57): o login vem de OUTRO banco (a leitura cruzada da rede) e não ficou provado
   * que, no banco do evento, ele é a mesma pessoa: nada vai à trilha do legado em nome dele; só a trilha própria, como
   * "(desconhecido)" (quem chama põe o estabelecimento de origem e o login na chave natural).
   */
  readonly usuarioNaoConfirmado?: boolean;
}

export interface RegistroFeito {
  readonly sgh: string | null;
  readonly legado: string | null;
}

export interface RegistradorTrilha {
  registrar(e: EventoParaTrilha): Promise<RegistroFeito>;
}

/** Em memória (dev/ci com fonte sintética e testes): guarda os últimos eventos, sem banco. */
export class RegistradorTrilhaMemoria implements RegistradorTrilha {
  /** `como`: o ator real da sessão "como" (ADR 0021), como a ORIGEM da SGH_TRILHA no banco. */
  readonly eventos: (EventoParaTrilha & {
    readonly id: string;
    readonly legado: boolean;
    readonly como: MarcaComo | null;
    /** M10 e M15: instante do registro (a consulta da trilha e o registro de acesso ao prontuário em memória o mostram). */
    readonly em: string;
  })[] = [];
  private n = 0;
  /** Falha simulada (testes do "sem trilha, sem dado"). */
  falhar = false;

  registrar(e: EventoParaTrilha): Promise<RegistroFeito> {
    if (this.falhar) return Promise.reject(new Error('trilha indisponível (simulada)'));
    const id = String(++this.n);
    const legado = eventoAuditavel(e.evento)?.legado != null && e.usuarioNaoConfirmado !== true;
    const usuario = e.usuarioNaoConfirmado ? USUARIO_DESCONHECIDO : e.usuario;
    this.eventos.push({ ...e, usuario, id, legado, como: marcaComoAtual(), em: new Date().toISOString() });
    if (this.eventos.length > 5_000) this.eventos.splice(0, this.eventos.length - 5_000);
    return Promise.resolve({ sgh: id, legado: legado ? id : null });
  }
}

export interface NucleoTrilha {
  registrarTrilhaPropria(
    ctx: { rede: string; hospital: string; traceId: string },
    linha: LinhaTrilha,
  ): Promise<{ id: string }>;
}

/** Trilha dupla no banco do estabelecimento (homolog, treino, produção). */
export class RegistradorTrilhaLegado implements RegistradorTrilha {
  constructor(
    private readonly nucleo: NucleoTrilha,
    private readonly executor: Pick<Executor, 'executar'>,
  ) {}

  private linha(e: EventoParaTrilha, usuario: string): LinhaTrilha {
    return {
      rede: e.rede,
      hospital: e.hospital,
      usuario,
      evento: e.evento,
      recurso: e.recurso,
      operacao: 'auditoria.registrarEvento',
      tabelaAlvo: e.tabelaAlvo ?? null,
      idAlvo: e.idAlvo ?? null,
      chaveNaturalAlvo: e.chaveNaturalAlvo?.slice(0, 120) ?? null,
      resultado: e.resultado,
      estacao: e.estacao.slice(0, 80),
      correlacao: e.correlacao.slice(0, 64),
      origem: e.estacao.slice(0, 100),
      idPaciente: e.paciente ?? null,
      atendimento: e.atendimento ?? null,
    };
  }

  async registrar(e: EventoParaTrilha): Promise<RegistroFeito> {
    const ctx = { rede: e.rede, hospital: e.hospital, traceId: e.correlacao.slice(0, 64) };
    const def = eventoAuditavel(e.evento);
    if (e.usuarioNaoConfirmado || (def?.legado && !LOGIN_DO_LEGADO.test(e.usuario))) {
      const t = await this.nucleo.registrarTrilhaPropria(ctx, this.linha(e, USUARIO_DESCONHECIDO));
      return { sgh: t.id, legado: null };
    }
    if (def?.legado) {
      const entrada: RegistrarEventoLegadoEntrada = {
        tipo: def.legado.tipo,
        criticidade: def.legado.criticidade,
        opcao: def.legado.opcao,
        estacao: e.estacao.slice(0, 100),
        evento: e.evento,
        ...(e.atendimento ? { atendimento: e.atendimento } : {}),
        ...(e.paciente ? { alvos: [{ tabelaCampo: 'RICADPAC.ID' as const, id: e.paciente }] } : {}),
      };
      const contexto: ContextoOperacao = {
        ...ctx,
        usuarioLegado: e.usuario,
        idempotencyKey: `trilha-${randomUUID()}`,
        estacao: e.estacao.slice(0, 80),
      };
      try {
        const r = await this.executor.executar(
          operacao('auditoria.registrarEventoLegado'),
          e.hospital,
          entrada,
          contexto,
        );
        return { sgh: r.trilha, legado: String(r.resultado['idTrilha'] ?? '') || null };
      } catch (erro) {
        const codigo = erro instanceof ErroOperacao ? (erro.problema.codigo ?? '') : '';
        // Gravação no outro sistema ainda não liberada (ou recolhida): só a trilha própria, com o usuário real.
        if (RECUSAS_DE_LIBERACAO.has(codigo)) {
          const t = await this.nucleo.registrarTrilhaPropria(ctx, this.linha(e, e.usuario));
          return { sgh: t.id, legado: null };
        }
        // O Delphi só registra usuário conhecido: o resto fica só na trilha própria.
        if (!RECUSAS_DE_USUARIO.has(codigo)) throw erro;
        const t = await this.nucleo.registrarTrilhaPropria(ctx, this.linha(e, USUARIO_DESCONHECIDO));
        return { sgh: t.id, legado: null };
      }
    }
    const t = await this.nucleo.registrarTrilhaPropria(ctx, this.linha(e, e.usuario));
    return { sgh: t.id, legado: null };
  }
}
