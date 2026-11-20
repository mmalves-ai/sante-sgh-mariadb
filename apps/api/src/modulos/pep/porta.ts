// Porta do prontuário ao vivo (M15): o que as telas do prontuário leem, independente de onde (a API não escreve
// SQL; fronteira):
//   - `legado`: o núcleo do legado (leituras READ ONLY dos repositórios de @sgh/legado; os BLOB materializados
//     na transação curta de cada leitura; nada é gravado em tabela clínica nem de cadastro);
//   - `memoria`: a sessão sintética de dev/ci (E2E): registros SINTÉTICOS dos pacientes sintéticos do cadastro
//     em memória, com o mesmo formato (texto formatado, formulário e documento comprimido); nada vai à cópia;
//   - `indisponivel`: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type {
  AcessoLido,
  ConteudoLido,
  ContextoLido,
  DefinicaoFormularioLegado,
  EventoDocumentoLido,
  ExcecaoAgregadaLida,
  FiltroAcessos,
  FiltroRegistrosLegado,
  FontesLidas,
  RegistroProntuarioLido,
  RepresentacaoGravada,
  RespostaLida,
} from '@sgh/legado';

export const PORTA_PRONTUARIO = Symbol('PORTA_PRONTUARIO');

export interface ContextoProntuario {
  readonly rede: string;
  readonly hospital: string;
}

export interface ResumoProntuarioLido {
  readonly modelos: { id: number; codigo: string | null; nome: string | null }[];
  readonly profissionais: { id: number; nome: string }[];
  readonly semConteudo: number;
  readonly dataImpossivel: number;
}

export interface PortaProntuario {
  readonly destino: 'legado' | 'memoria';
  listar(
    c: ContextoProntuario,
    paciente: number,
    filtro: FiltroRegistrosLegado,
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
  definicaoModelo(c: ContextoProntuario, modelo: number): Promise<DefinicaoFormularioLegado | null>;
  contexto(c: ContextoProntuario, registro: number): Promise<ContextoLido | null>;
  textos(
    c: ContextoProntuario,
    paciente: number,
    filtro: Pick<FiltroRegistrosLegado, 'de' | 'ate'>,
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
