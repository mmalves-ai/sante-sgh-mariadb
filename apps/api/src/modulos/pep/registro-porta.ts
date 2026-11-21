// Porta dos registros clínicos (M22): o que as telas de registro, rascunho, visualização e administração do PEP
// leem e gravam, independente de onde (a API não escreve SQL; fronteira):
//   - `proprio`: o banco do cliente pelo @sgh/nucleo (leitura pelo Leitor, gravação pelo Executor);
//   - `memoria`: a sessão sintética de dev/ci (E2E): modelos, atendimentos, rascunhos e registros SINTÉTICOS;
//   - `indisponivel`: fora de dev/ci sem o núcleo: 503 (falha fechada).
// Melhoria: tipos de negócio próprios (tipos-pep.ts); nenhum código de convivência.
import type { ContextoPorta } from '../cadastro/porta.js';
import type { ContextoOperacao } from '@sgh/nucleo';
import type { AtendimentoLido, CabecalhoDocumentoLido, CabecalhoRegistroLido, DefinicaoFormularioLida, DescarteRascunho, GravacaoEvolucao, GravacaoRascunho, LiberacaoConsultada, LinhaRespostaLida, ModeloDoRegistro, ProfissionalDoRegistro, RascunhoLido, RetratosAtuais, SuspensaoEvolucao } from './tipos-pep.js';

export const PORTA_REGISTRO = Symbol('PORTA_REGISTRO');

/** Contexto da sessão: cliente, estabelecimento e usuário por id, correlação, rede e código do estabelecimento. */
export type ContextoRegistro = ContextoPorta;

export interface ProvaLida {
  /** Hash do conteúdo guardado na gravação (prova de integridade; null: sem prova). */
  readonly guardado: string | null;
  readonly hashConteudo: string | null;
  /** O mesmo hash recalculado agora. */
  readonly atual: string | null;
  /** Eventos do documento feitos numa sessão "como" do suporte técnico (ADR 0021, R1). */
  readonly comoSuporte: readonly ('criado' | 'suspenso')[];
}

export interface PortaRegistro {
  readonly destino: 'proprio' | 'memoria';
  profissional(c: ContextoRegistro, login: string): Promise<ProfissionalDoRegistro | null>;
  modelos(c: ContextoRegistro): Promise<ModeloDoRegistro[]>;
  definicao(c: ContextoRegistro, modelo: number): Promise<DefinicaoFormularioLida | null>;
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
