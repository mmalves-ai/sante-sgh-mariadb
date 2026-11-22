// Porta do prontuário ao vivo (M15): o que as telas do prontuário leem, independente de onde (a API não escreve
// SQL; fronteira):
//   - `proprio`: o banco do cliente pelo @sgh/nucleo (porta-propria.ts), só leitura;
//   - `memoria`: a sessão sintética de dev/ci (E2E): registros SINTÉTICOS dos pacientes sintéticos do cadastro;
//   - `indisponivel`: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// Melhoria: tipos de negócio próprios (tipos-pep.ts); nenhum código de convivência.
import type { ContextoPorta } from '../cadastro/porta.js';
import type {
  AcessoLido,
  ConteudoLido,
  ContextoLido,
  DefinicaoFormularioLida,
  EventoDocumentoLido,
  ExcecaoAgregadaLida,
  FiltroAcessos,
  FiltroRegistros,
  FontesLidas,
  RegistroProntuarioLido,
  RepresentacaoGravada,
  RespostaLida,
} from './tipos-pep.js';

export const PORTA_PRONTUARIO = Symbol('PORTA_PRONTUARIO');

/** Contexto da sessão: cliente, estabelecimento e usuário por id, correlação, rede e código do estabelecimento. */
export type ContextoProntuario = ContextoPorta;

export interface ResumoProntuarioLido {
  readonly modelos: { id: number; codigo: string | null; nome: string | null }[];
  readonly profissionais: { id: number; nome: string }[];
  readonly semConteudo: number;
  readonly dataImpossivel: number;
}

export interface PortaProntuario {
  readonly destino: 'proprio' | 'memoria';
  listar(
    c: ContextoProntuario,
    paciente: number,
    filtro: FiltroRegistros,
    pagina: number,
    porPagina: number,
  ): Promise<{ registros: RegistroProntuarioLido[]; haMais: boolean; fontes: Map<number, FontesLidas> }>;
  resumo(c: ContextoProntuario, paciente: number): Promise<ResumoProntuarioLido>;
  /** Exceções do estabelecimento, só contagens por modelo e mês (regra 9). */
  excecoes(c: ContextoProntuario): Promise<ExcecaoAgregadaLida[]>;
  registro(
    c: ContextoProntuario,
    paciente: number,
    registro: number,
  ): Promise<{ registro: RegistroProntuarioLido; fontes: FontesLidas } | null>;
  conteudo(
    c: ContextoProntuario,
    registro: number,
    partes: { rtf: boolean; xml: boolean },
  ): Promise<ConteudoLido | null>;
  eventosDocumento(
    c: ContextoProntuario,
    registro: Pick<RegistroProntuarioLido, 'id' | 'idHtPaciente'>,
  ): Promise<EventoDocumentoLido[]>;
  documentoXml(c: ContextoProntuario, idDocumento: number): Promise<string | null>;
  respostas(c: ContextoProntuario, registro: number): Promise<RespostaLida[]>;
  seloDoModelo(c: ContextoProntuario, modelo: number): Promise<string>;
  representacaoGravada(
    c: ContextoProntuario,
    modelo: number,
    selo: string,
  ): Promise<RepresentacaoGravada | null>;
  definicaoModelo(c: ContextoProntuario, modelo: number): Promise<DefinicaoFormularioLida | null>;
  contexto(c: ContextoProntuario, registro: number): Promise<ContextoLido | null>;
  textos(
    c: ContextoProntuario,
    paciente: number,
    filtro: Pick<FiltroRegistros, 'de' | 'ate'>,
    teto: number,
  ): Promise<{
    registros: {
      id: number;
      dataHora: string | null;
      modelo: string | null;
      cbo: string | null;
      rtf: string | null;
    }[];
    truncado: boolean;
  }>;
  acessos(
    c: ContextoProntuario,
    filtro: FiltroAcessos,
    pagina: number,
    porPagina: number,
  ): Promise<{ itens: AcessoLido[]; haMais: boolean }>;
}
