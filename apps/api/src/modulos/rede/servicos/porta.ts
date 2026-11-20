// Porta do registro de serviços compartilhados da Rede (M57, etapa 3; regra 11; DP-14): cada registro mora no banco do
// estabelecimento em que foi feito; a porta lê ou grava (transação SGH_ com a SGH_TRILHA junto) SÓ no banco do
// estabelecimento do contexto. A lista da Rede é a junção, em memória, das listas de cada banco (no serviço).
//   - `legado`: @sgh/legado (só SGH_REDE_SERVICO_COMPART e a trilha);
//   - `memoria`: a sessão sintética de dev/ci (E2E), um registro em memória por estabelecimento;
//   - indisponível: fora de dev/ci sem o núcleo: 503 (falha fechada).
import type {
  FiltroServicosRede,
  LinhaTrilha,
  MudancaServicoParaGravar,
  NovoServicoParaGravar,
  ServicoCompartilhadoLido,
} from '@sgh/legado';

export const PORTA_SERVICOS_REDE = Symbol('PORTA_SERVICOS_REDE');

export interface ContextoServicosRede {
  readonly rede: string;
  readonly hospital: string;
}

export interface PortaServicosRede {
  readonly destino: 'legado' | 'memoria' | 'indisponivel';
  listar(
    c: ContextoServicosRede,
    f: FiltroServicosRede,
  ): Promise<{ itens: ServicoCompartilhadoLido[]; total: number }>;
  ler(c: ContextoServicosRede, id: number): Promise<ServicoCompartilhadoLido | null>;
  /** Grava no banco do contexto, com a linha da trilha na mesma transação (o ID do alvo é o do registro). */
  registrar(
    c: ContextoServicosRede,
    novo: NovoServicoParaGravar,
    por: string,
    trilha: LinhaTrilha,
  ): Promise<ServicoCompartilhadoLido>;
  alterar(
    c: ContextoServicosRede,
    id: number,
    m: MudancaServicoParaGravar,
    por: string,
    trilha: LinhaTrilha,
  ): Promise<{ antes: ServicoCompartilhadoLido; depois: ServicoCompartilhadoLido; mudou: boolean } | null>;
}
