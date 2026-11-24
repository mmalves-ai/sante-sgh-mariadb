// Porta da prescrição eletrônica (M24): o que as telas da CPOE, da farmácia clínica e da enfermagem leem e gravam,
// independente de onde (a API não escreve SQL; fronteira):
//   - `proprio`: o banco do cliente pelo @sgh/nucleo (leitura pelo Leitor, gravação pelo Executor);
//   - `memoria`: a sessão sintética de dev/ci (E2E): atendimentos, produtos, cadastros e prescrições SINTÉTICOS;
//   - `indisponivel`: fora de dev/ci sem o núcleo: 503 (falha fechada).
// Melhoria: tipos de negócio próprios (tipos-pep.ts); nenhum código de convivência.
import type { ContextoPorta } from '../cadastro/porta.js';
import type { SecaoCadastroPrescricao } from '@sgh/contratos';
import type { ContextoOperacao } from '@sgh/nucleo';
import type { FavoritoNovo, FavoritoPrescritorLido } from './prescricao-propria-favoritos.js';
import type {
  AlergiaLida,
  DadosClinicosLidos,
  ConsultaCadastroLida,
  AtendimentoDaPrescricao,
  AtendimentoLido,
  CabecalhoDocumentoLido,
  DecisaoLida,
  FichaAntigaLida,
  FichaNovaLida,
  FuturaGravadaLida,
  GradeClasseLida,
  GravacaoPrescricao,
  InclusaoItem,
  InteracaoLida,
  ItemDoIndice,
  ItemPrescricaoLido,
  KitMedicamentoLido,
  LiberacaoConsultada,
  OpcaoDominio,
  PrescricaoAVencer,
  PrescricaoCabecalhoLida,
  PrescritorLido,
  ProdutoLido,
  ProtocoloLido,
  ProvaPrescricaoLida,
  ReconciliacaoGravacao,
  ReconciliacaoGravadaLida,
  RegraAlertaLida,
  RegraHorarioLida,
  RetratosAtuais,
  SuspensaoItem,
  SuspensaoPrescricao,
  FuturaProgramada,
  FichaAvulsa,
  NovaVersaoRegra,
  NovaGradeClasse,
} from './tipos-pep.js';

export const PORTA_PRESCRICAO = Symbol('PORTA_PRESCRICAO');

/** Contexto da sessão: cliente, estabelecimento e usuário por id, correlação, rede e código do estabelecimento. */
export type ContextoPrescricao = ContextoPorta;

export interface ParametrosPrescricao {
  readonly consistirDuplicidade: boolean;
  readonly porMedicamento: boolean;
  readonly porPrincipio: boolean;
  readonly calcularVelocidade: boolean;
}

export interface PortaPrescricao {
  readonly destino: 'proprio' | 'memoria';
  prescritores(c: ContextoPrescricao, login: string): Promise<PrescritorLido[]>;
  atendimentos(c: ContextoPrescricao, paciente: number): Promise<AtendimentoLido[]>;
  atendimento(c: ContextoPrescricao, atendimento: number): Promise<AtendimentoDaPrescricao | null>;
  retratos(c: ContextoPrescricao, atendimento: number, paciente: number): Promise<RetratosAtuais | null>;
  regras(c: ContextoPrescricao): Promise<{
    regras: RegraHorarioLida[];
    porBloco: Map<string, number>;
    porUnidade: Map<number, number>;
  }>;
  relativos(c: ContextoPrescricao): Promise<{ id: number; nome: string; horario: string }[]>;
  horariosDieta(c: ContextoPrescricao): Promise<Map<number, string[]>>;
  dominios(c: ContextoPrescricao): Promise<Record<string, OpcaoDominio[]>>;
  produtos(c: ContextoPrescricao, ids: readonly number[]): Promise<ProdutoLido[]>;
  /** Os itens do cadastro para o índice de busca (nome, padronizado, princípios): o índice fica no cache. */
  itensParaIndice(c: ContextoPrescricao): Promise<ItemDoIndice[]>;
  kits(c: ContextoPrescricao, produto: number): Promise<KitMedicamentoLido[]>;
  /** Cadastros de prescrição em consulta (kits, receitas padrão, itens não padronizados, parâmetros do item). */
  cadastro(
    c: ContextoPrescricao,
    secao: SecaoCadastroPrescricao,
    termo: string | undefined,
  ): Promise<ConsultaCadastroLida>;
  protocolos(c: ContextoPrescricao): Promise<ProtocoloLido[]>;
  /** As especialidades do profissional do login (especialidades médicas das ocupações ativas), para o protocolo da especialidade. */
  especialidadesDoPrescritor(c: ContextoPrescricao, login: string): Promise<number[]>;
  itensDoProtocolo(c: ContextoPrescricao, protocolo: number): Promise<ItemPrescricaoLido[]>;
  prescricoes(c: ContextoPrescricao, atendimento: number): Promise<PrescricaoCabecalhoLida[]>;
  cabecalho(c: ContextoPrescricao, prescricao: number): Promise<PrescricaoCabecalhoLida | null>;
  itens(c: ContextoPrescricao, prescricao: number): Promise<ItemPrescricaoLido[]>;
  alergias(c: ContextoPrescricao, paciente: number): Promise<AlergiaLida[]>;
  /** Peso, altura, sexo, nascimento e a última creatinina do paciente (cálculo de dose e alertas; regra 12). */
  dadosClinicos(c: ContextoPrescricao, paciente: number): Promise<DadosClinicosLidos>;
  produtosAtivos(
    c: ContextoPrescricao,
    atendimento: number,
    inicio: string,
    fim: string,
    exceto: number | null,
  ): Promise<{ item: number; produto: number; plano: number }[]>;
  dietaDeOutro(
    c: ContextoPrescricao,
    atendimento: number,
    inicio: string,
    fim: string,
    cbo: number,
  ): Promise<{ autor: string; prescricao: number; item: number } | null>;
  parametrosPrescricao(c: ContextoPrescricao): Promise<ParametrosPrescricao>;
  regrasAlerta(c: ContextoPrescricao): Promise<RegraAlertaLida[]>;
  interacoes(c: ContextoPrescricao, principios: readonly number[]): Promise<InteracaoLida[] | null>;
  prova(c: ContextoPrescricao, prescricao: number): Promise<ProvaPrescricaoLida>;
  hashAtual(c: ContextoPrescricao, prescricao: number): Promise<string>;
  marcas(
    c: ContextoPrescricao,
    prescricoes: readonly number[],
  ): Promise<Map<number, { feitaNoNovo: boolean; coassinaturaPendente: boolean }>>;
  decisoes(c: ContextoPrescricao, prescricao: number): Promise<DecisaoLida[]>;
  futuras(c: ContextoPrescricao, atendimento: number): Promise<FuturaGravadaLida[]>;
  reconciliacoes(c: ContextoPrescricao, atendimento: number): Promise<ReconciliacaoGravadaLida[]>;
  fichas(c: ContextoPrescricao, paciente: number | null): Promise<FichaNovaLida[]>;
  fichasAntigas(c: ContextoPrescricao, paciente: number): Promise<FichaAntigaLida[]>;
  planejamentosAntigos(
    c: ContextoPrescricao,
    paciente: number,
  ): Promise<{ id: number; inicio: string | null; fim: string | null }[]>;
  grades(c: ContextoPrescricao): Promise<GradeClasseLida[]>;
  /** As que vencem no turno (sem a do período seguinte), com o paciente, a unidade e o leito; filtro por unidade. */
  vencemAte(
    c: ContextoPrescricao,
    agora: string,
    ate: string,
    unidade: number | null,
  ): Promise<PrescricaoAVencer[]>;
  cabecalhoDocumento(
    c: ContextoPrescricao,
    retratos: { readonly htPaciente: number; readonly htAtendimento: number },
    cbo: number,
  ): Promise<CabecalhoDocumentoLido>;
  /** Relógio do banco do estabelecimento (hora local, AAAA-MM-DDTHH:MM:SS). */
  agora(c: ContextoPrescricao): Promise<string>;
  /** O passo 0 do executor (a operação grava agora para este login?), sem gravar. */
  podeGravar(c: ContextoPrescricao, operacao: string, login: string): Promise<LiberacaoConsultada>;
  prescrever(
    c: ContextoPrescricao,
    operacao: 'pep.prescrever' | 'pep.copiarPrescricao' | 'pep.renovarPrescricao',
    e: GravacaoPrescricao,
    ctx: ContextoOperacao,
  ): Promise<{ prescricao: number; horarios: number }>;
  incluirItem(c: ContextoPrescricao, e: InclusaoItem, ctx: ContextoOperacao): Promise<{ item: number }>;
  suspenderItem(
    c: ContextoPrescricao,
    e: SuspensaoItem,
    ctx: ContextoOperacao,
  ): Promise<{ horarios: number }>;
  suspenderPrescricao(
    c: ContextoPrescricao,
    e: SuspensaoPrescricao,
    ctx: ContextoOperacao,
  ): Promise<{ horarios: number }>;
  // Registros do produto (pelo Executor do núcleo).
  coassinar(c: ContextoPrescricao, prescricao: number, usuario: string): Promise<void>;
  gravarRegra(
    c: ContextoPrescricao,
    autor: string,
    r: NovaVersaoRegra,
  ): Promise<{ id: number; versao: number }>;
  programarFutura(c: ContextoPrescricao, usuario: string, f: FuturaProgramada): Promise<number>;
  /** Só a programação do paciente da rota (a de outro paciente é 404) e só enquanto programada (409). */
  cancelarFutura(
    c: ContextoPrescricao,
    usuario: string,
    paciente: number,
    id: number,
    motivo: string,
  ): Promise<void>;
  registrarReconciliacao(c: ContextoPrescricao, usuario: string, r: ReconciliacaoGravacao): Promise<number>;
  registrarFicha(c: ContextoPrescricao, usuario: string, f: FichaAvulsa): Promise<number>;
  gravarGrade(c: ContextoPrescricao, autor: string, g: NovaGradeClasse): Promise<number>;
  /** Favoritos do prescritor da sessão (03-PEP L107). */
  favoritos(c: ContextoPrescricao, usuario: string): Promise<FavoritoPrescritorLido[]>;
  marcarFavorito(c: ContextoPrescricao, usuario: string, f: FavoritoNovo): Promise<number>;
  desmarcarFavorito(c: ContextoPrescricao, usuario: string, id: number): Promise<number>;
}
