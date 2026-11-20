// M59-F5 (ficha do M59, seções 4, 6 e 7): a porta do pacote de evidências SBIS, do termo das concessões e do backup
// verificado. A do adaptador lê e grava só tabelas SGH_ pelo @sgh/legado (a trilha na mesma transação) e lê a
// identificação do estabelecimento (nome, CNES, CNPJ) e a configuração de login; a de memória serve o dev e o CI.
import type {
  AvaliarItemPedido,
  CodigoConcessao,
  ItemCicloSbis,
  ParecerSbis,
  RegistrarRestauracaoPedido,
  Restauracao,
} from '@sgh/contratos';
import type { CicloLido, ConcessaoLida, TrilhaSbis, VerificacaoDiaLida } from '@sgh/legado';

export const PORTA_SBIS = Symbol('PORTA_SBIS');

export interface IdentificacaoEstabelecimento {
  readonly nome: string | null;
  readonly cnes: string | null;
  readonly cnpj: string | null;
}

export interface ConfigSeguranca {
  readonly limiteTentativas: number | null;
  readonly inatividadeSegundos: number | null;
}

export interface NovoCiclo {
  readonly tipo: string;
  readonly competencia: string;
  readonly versao: string;
  readonly referencia: string;
  readonly avaliador: string | null;
  readonly por: string;
  readonly requisitos: readonly string[];
}

export interface PortaSbis {
  readonly destino: 'legado' | 'memoria';
  /** Tabelas da F5 que faltam (vazio: pronto). */
  faltando(h: string): Promise<string[]>;
  concessoes(h: string): Promise<ConcessaoLida[]>;
  encerrar(
    h: string,
    c: { codigo: CodigoConcessao; evidencia: string; por: string },
    t: TrilhaSbis,
  ): Promise<boolean>;
  reabrir(
    h: string,
    c: { codigo: CodigoConcessao; motivo: string; por: string },
    t: TrilhaSbis,
  ): Promise<boolean>;
  prever(
    h: string,
    c: { codigo: CodigoConcessao; fimPrevisto: string | null; por: string },
    t: TrilhaSbis,
  ): Promise<boolean>;
  ciclos(h: string): Promise<CicloLido[]>;
  ciclo(h: string, id: string): Promise<CicloLido | null>;
  itens(h: string, id: string): Promise<ItemCicloSbis[]>;
  abrir(h: string, n: NovoCiclo, t: TrilhaSbis): Promise<{ id: string } | null>;
  avaliar(
    h: string,
    a: { idCiclo: string; requisito: string; por: string; pedido: AvaliarItemPedido },
    t: TrilhaSbis,
  ): Promise<boolean>;
  corrigir(
    h: string,
    a: { idCiclo: string; requisito: string; por: string; descricao: string },
    t: TrilhaSbis,
  ): Promise<boolean>;
  verificar(
    h: string,
    a: { idCiclo: string; requisito: string; por: string },
    t: TrilhaSbis,
  ): Promise<boolean>;
  concluir(
    h: string,
    c: { id: string; parecer: ParecerSbis; parecerTexto: string; certificado: string | null; por: string },
    t: TrilhaSbis,
  ): Promise<boolean>;
  cancelar(h: string, c: { id: string; motivo: string; por: string }, t: TrilhaSbis): Promise<boolean>;
  restauracoes(h: string): Promise<Restauracao[]>;
  registrarRestauracao(
    h: string,
    r: { por: string; pedido: RegistrarRestauracaoPedido },
    t: TrilhaSbis,
  ): Promise<{ id: string }>;
  identificacao(h: string): Promise<IdentificacaoEstabelecimento>;
  configSeguranca(h: string): Promise<ConfigSeguranca>;
  verificarDias(h: string, dias: readonly string[]): Promise<VerificacaoDiaLida[]>;
}
