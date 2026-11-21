// Registro dos eventos auditáveis (ficha do M06, regra 10 e seção 5): todo evento vai à trilha própria do cliente
// (só inclusão). Usuário não confirmado (login falho com nome inexistente, login vindo de outro banco sem a prova
// de que é a mesma pessoa) fica como "(desconhecido)": o texto digitado nunca vai à trilha. Em dev/ci com a fonte
// sintética e nos testes, o registro é em memória. A trilha dupla com o sistema anterior está em trilha-legado.ts,
// fora do boot da F2-L.
import { eventoAuditavel } from '@sgh/contratos';
import { type MarcaComo, marcaComoAtual } from './como.js';

export const USUARIO_DESCONHECIDO = '(desconhecido)';

export interface EventoParaTrilha {
  /** Código do catálogo de eventos auditáveis (@sgh/contratos, auditoria/eventos.ts). */
  readonly evento: string;
  readonly rede: string;
  readonly hospital: string;
  /** Login de quem fez (ou tentou). */
  readonly usuario: string;
  /** "ESTACAO:origem" da requisição. */
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
   * que, no banco do evento, ele é a mesma pessoa: nada vai à trilha em nome dele; só a trilha própria, como
   * "(desconhecido)" (quem chama põe o estabelecimento de origem e o login na chave natural).
   */
  readonly usuarioNaoConfirmado?: boolean;
}

export interface RegistroFeito {
  /** Id na trilha própria. */
  readonly sgh: string | null;
  /** Id na trilha do sistema anterior (só a trilha dupla de trilha-legado.ts; null na própria). */
  readonly legado: string | null;
}

export interface RegistradorTrilha {
  registrar(e: EventoParaTrilha): Promise<RegistroFeito>;
}

/** Em memória (dev/ci com fonte sintética e testes): guarda os últimos eventos, sem banco. */
export class RegistradorTrilhaMemoria implements RegistradorTrilha {
  /** `como`: o ator real da sessão "como" (ADR 0021), como a origem na trilha própria. */
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
