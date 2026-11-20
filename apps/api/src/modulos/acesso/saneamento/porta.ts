// Porta do saneamento dos grupos (M59-F4): as leituras e as gravações SGH_ do plano, sobre o núcleo do legado
// (porta-legado.ts) ou em memória (porta-memoria.ts: unitários e a fonte sintética do dev/ci). Nenhuma gravação em
// tabela do outro sistema passa por aqui: a troca de grupo, o bloqueio e a retirada das opções vão pelo executor.
import type { ItemSaneamento } from '@sgh/contratos';
import type {
  GrupoGenericoLido,
  NovoItemSaneamentoSgh,
  TrilhaSaneamento,
  UsuarioGrupoLido,
} from '@sgh/legado';

export interface GrupoComOpcoes {
  readonly grupo: string;
  readonly ativo: boolean;
  readonly opcoes: readonly number[];
}

export interface PortaSaneamento {
  pronto(hospital: string): Promise<boolean>;
  grupos(hospital: string, nomes: readonly string[]): Promise<GrupoGenericoLido[]>;
  usuarios(hospital: string, grupo: string): Promise<UsuarioGrupoLido[]>;
  usuario(hospital: string, login: string): Promise<UsuarioGrupoLido | null>;
  gruposComOpcoes(hospital: string): Promise<GrupoComOpcoes[]>;
  titulos(hospital: string, ids: readonly number[]): Promise<Map<number, string>>;
  uso(hospital: string, grupo: string, desde: Date): Promise<Map<string, Map<number, number>>>;
  plano(hospital: string, grupo?: string): Promise<ItemSaneamento[]>;
  item(hospital: string, id: string): Promise<ItemSaneamento | null>;
  incluir(hospital: string, n: NovoItemSaneamentoSgh, t: TrilhaSaneamento): Promise<{ id: string }>;
  aprovar(
    hospital: string,
    a: { id: string; area: string; aprovadoPor: string; motivo: string },
    t: TrilhaSaneamento,
  ): Promise<boolean>;
  descartar(hospital: string, d: { id: string; por: string }, t: TrilhaSaneamento): Promise<boolean>;
  /** Reserva o item vivo para a aplicação, antes da gravação no banco (false: outro pedido o reservou ou o mudou). */
  reservar(hospital: string, r: { id: string; por: string }, t: TrilhaSaneamento): Promise<boolean>;
  /** Conclui o item reservado por `por` (aplicado, ou falhou soltando a reserva). */
  concluir(
    hospital: string,
    c: { id: string; por: string; resultado: 'aplicado' | 'falhou'; erro: string | null },
    t: TrilhaSaneamento,
  ): Promise<boolean>;
}
