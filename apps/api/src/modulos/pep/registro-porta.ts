// Porta dos registros clínicos (M22): o que as telas de registro, rascunho, visualização e administração do PEP
// leem e gravam, independente de onde (a API não escreve SQL; fronteira):
//   - `legado`: leituras READ ONLY pelos repositórios de @sgh/legado e as gravações pelo EXECUTOR (receitas
//     pep.registrarEvolucao, pep.salvarRascunho, pep.descartarRascunho e pep.suspenderEvolucao, com a trilha dupla
//     e as tabelas SGH_ da prova na mesma transação); em dev sobre a cópia compartilhada, as gravações ficam
//     recusadas pelo executor só de leitura (como o cadastro do M11);
//   - `memoria`: a sessão sintética de dev/ci (E2E): modelos, atendimentos, rascunhos e registros SINTÉTICOS em
//     memória, gravados pelo mesmo gravador de @sgh/dominio-pep (as linhas, o RTF e o XML no formato do banco);
//   - `indisponivel`: fora de dev/ci sem o núcleo: 503 (falha fechada).
import type {
  AtendimentoLido,
  CabecalhoDocumentoLido,
  CabecalhoRegistroLido,
  ContextoOperacao,
  DefinicaoFormularioLegado,
  DescarteRascunho,
  GravacaoEvolucao,
  GravacaoRascunho,
  LiberacaoConsultada,
  LinhaRespostaLida,
  ModeloDoRegistro,
  ProfissionalDoRegistro,
  RascunhoLido,
  RetratosAtuais,
  SuspensaoEvolucao,
} from '@sgh/legado';

export const PORTA_REGISTRO = Symbol('PORTA_REGISTRO');

export interface ContextoRegistro {
  readonly rede: string;
  readonly hospital: string;
}

export interface ProvaLida {
  /** Hash das linhas do legado guardado na gravação (null: registro não gravado pelo novo). */
  readonly guardado: string | null;
  readonly hashConteudo: string | null;
  /** O mesmo hash recalculado agora. */
  readonly atual: string | null;
  /** Eventos do documento feitos numa sessão "como" do suporte técnico (ADR 0021, R1). */
  readonly comoSuporte: readonly ('criado' | 'suspenso')[];
}

export interface PortaRegistro {
  readonly destino: 'legado' | 'memoria';
  profissional(c: ContextoRegistro, login: string): Promise<ProfissionalDoRegistro | null>;
  modelos(c: ContextoRegistro): Promise<ModeloDoRegistro[]>;
  definicao(c: ContextoRegistro, modelo: number): Promise<DefinicaoFormularioLegado | null>;
  selo(c: ContextoRegistro, modelo: number): Promise<string>;
  atendimentos(c: ContextoRegistro, paciente: number): Promise<AtendimentoLido[]>;
  retratos(c: ContextoRegistro, atendimento: number, paciente: number): Promise<RetratosAtuais | null>;
  rascunhosDoProfissional(c: ContextoRegistro, cbos: readonly number[]): Promise<RascunhoLido[]>;
  rascunhosDoPaciente(c: ContextoRegistro, paciente: number, modelo: number): Promise<RascunhoLido[]>;
  lerRascunho(
    c: ContextoRegistro,
    id: number,
  ): Promise<{
    rascunho: RascunhoLido;
    linhas: LinhaRespostaLida[];
    aberto: boolean;
    substituido: boolean;
  } | null>;
  ultimoRegistro(
    c: ContextoRegistro,
    paciente: number,
    modelo: number,
  ): Promise<{ registro: number; linhas: LinhaRespostaLida[] } | null>;
  historico(
    c: ContextoRegistro,
    paciente: number,
    modelo: number,
    ordem: string,
  ): Promise<{ registro: number; dataHora: string | null; linhas: LinhaRespostaLida[] }[]>;
  cabecalhoRegistro(c: ContextoRegistro, registro: number): Promise<CabecalhoRegistroLido | null>;
  respostasRegistro(c: ContextoRegistro, registro: number): Promise<LinhaRespostaLida[]>;
  prova(c: ContextoRegistro, registro: number): Promise<ProvaLida>;
  cabecalhoDocumento(
    c: ContextoRegistro,
    retratos: { readonly htPaciente: number; readonly htAtendimento: number },
    cbo: number,
    situacao: number,
  ): Promise<CabecalhoDocumentoLido>;
  modelosImpressao(c: ContextoRegistro): Promise<{
    fichas: { id: number; nome: string | null; tipo: number | null; componente: string | null }[];
    relatorios: { id: number; nome: string | null }[];
  }>;
  /** Relógio do banco do estabelecimento (hora local, AAAA-MM-DDTHH:MM:SS). */
  agora(c: ContextoRegistro): Promise<string>;
  /** O passo 0 do executor (a operação grava agora para este login?), sem gravar. */
  podeGravar(c: ContextoRegistro, operacao: string, login: string): Promise<LiberacaoConsultada>;
  registrar(
    c: ContextoRegistro,
    e: GravacaoEvolucao,
    ctx: ContextoOperacao,
  ): Promise<{ registro: number; trilha: string | null }>;
  salvarRascunho(
    c: ContextoRegistro,
    e: GravacaoRascunho,
    ctx: ContextoOperacao,
  ): Promise<{ rascunho: number; versao: string; trilha: string | null }>;
  descartarRascunho(c: ContextoRegistro, e: DescarteRascunho, ctx: ContextoOperacao): Promise<void>;
  suspender(c: ContextoRegistro, e: SuspensaoEvolucao, ctx: ContextoOperacao): Promise<void>;
}
