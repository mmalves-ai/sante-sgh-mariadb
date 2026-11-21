// Trilha dupla no banco de origem (trilha própria + a do sistema anterior, na mesma transação). Fica FORA do boot
// da F2-L (API_MODULOS): depende do pacote do banco de origem e serve de referência para o conector. O registrador
// em execução sobre o MariaDB do cliente é outro (núcleo próprio).
import { randomUUID } from 'node:crypto';
import { eventoAuditavel, type RegistrarEventoLegadoEntrada } from '@sgh/contratos';
import { ErroOperacao, type ContextoOperacao, type Executor, type LinhaTrilha, operacao } from '@sgh/legado';
import {
  type EventoParaTrilha,
  type RegistradorTrilha,
  type RegistroFeito,
  USUARIO_DESCONHECIDO,
} from './trilha.js';

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
