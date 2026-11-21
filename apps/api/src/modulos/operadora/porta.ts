// Porta da operadora própria (M56; F2.2 lote 02-10): o que as telas dos catálogos da ANS (F0) e do cadastro de
// operadora, produto, contrato, beneficiário e carteirinha (F1) leem e gravam, independente de onde (a API não escreve
// SQL; fronteira Nx):
//   - `banco`: a porta própria sobre o banco do cliente (porta-propria.ts), pelo @sgh/nucleo; as gravações pelo
//     Executor, com a trilha, o outbox e a idempotência na mesma transação;
//   - `memoria`: a sessão sintética de dev/ci (E2E), com catálogos e cadastros SINTÉTICOS;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
// Os tipos são de negócio, na forma que o contrato da tela (@sgh/contratos, operadora/beneficiarios.ts) usa: códigos
// numéricos do padrão da ANS, datas AAAA-MM-DD, ids numéricos; nada de S/N nem sentinela.
import type { ContextoNucleo } from '@sgh/nucleo';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import { portaIndisponivel } from '../exames/public-api.js';

export const PORTA_OPERADORA = Symbol('PORTA_OPERADORA');

/** O contexto da sessão (cliente, estabelecimento e usuário por id) com a rede e o código do estabelecimento. */
export interface ContextoOperadora extends ContextoNucleo {
  readonly rede: string;
  readonly hospital: string;
}

// ---- catálogos da ANS (F0) ----

export const LIMITE_PAGINA_SIP = 200;
export const LIMITE_PAGINA_OPERADORA = 100;

/** Grupo de eventos do SIP (item assistencial). */
export interface GrupoSip {
  readonly id: number;
  readonly nome: string;
}

export interface ProcedimentoSip {
  readonly procedimento: number;
  /** Nome na terminologia de procedimentos; null quando o código não está nela. */
  readonly nome: string | null;
  readonly grupo: number;
  readonly vigenciaInicial: string | null;
  /** Null: vigente sem fim. */
  readonly vigenciaFinal: string | null;
}

export interface ClassificacaoAns {
  readonly codigo: number;
  readonly nome: string;
}

export interface ChaveSip {
  readonly procedimento: number;
  readonly grupo: number;
  readonly vigenciaInicial: string;
}

export interface FiltroSip {
  readonly grupo?: number;
  readonly procedimento?: number;
  readonly vigentesEm?: string;
  readonly apos?: ChaveSip;
}

export interface FiltroClassificacao {
  readonly apos?: number;
  /** Código exato (só números) ou trecho do nome. */
  readonly busca?: string;
}

// ---- operadora, produto, contrato, beneficiário e carteirinha (F1) ----

export interface DadosOperadora {
  readonly registroAns: string;
  readonly cnpj: string;
  readonly razaoSocial: string;
  readonly nomeFantasia: string | null;
  /** Chave de MODALIDADES_OPERADORA do contrato. */
  readonly modalidade: string;
  /** 'ativa' | 'inativa'. */
  readonly situacao: string;
}

export interface Operadora extends DadosOperadora {
  readonly id: number;
  readonly versao: number;
  readonly alteradoEm: string;
}

export interface CarenciasProduto {
  urgencia: number;
  partos: number;
  demais: number;
  cpt: number;
}

export interface DadosProduto {
  readonly operadora: number;
  readonly codigo: string;
  readonly nome: string;
  readonly natureza: 'plano' | 'cartaoDesconto';
  readonly registroAns: string | null;
  /** 1 individual ou familiar, 2 coletivo empresarial, 3 coletivo por adesão. */
  readonly tipoContratacao: number;
  readonly segmentacao: string | null;
  readonly abrangencia: string | null;
  /** 1 apartamento, 2 enfermaria, 3 ambulatório. */
  readonly acomodacao: number | null;
  /** Tipo 1 nenhuma, 2 percentual, 3 valor fixo. */
  readonly coparticipacao: { readonly tipo: number; readonly valor: number | null };
  /** Prazos em dias. */
  readonly carencias: CarenciasProduto;
  /** Preço mensal das 10 faixas etárias (RN 63); null sem tabela de preço. */
  readonly precos: readonly number[] | null;
  /** Chave de SITUACOES_PRODUTO do contrato. */
  readonly situacao: string;
}

export interface Produto extends DadosProduto {
  readonly id: number;
  readonly versao: number;
  readonly alteradoEm: string;
}

export interface DadosContrato {
  readonly produto: number;
  readonly numero: string;
  /** 1 pessoa física (individual ou familiar), 2 pessoa jurídica (coletivo). */
  readonly tipo: number;
  readonly tipoContratacao: number;
  readonly contratanteNome: string;
  /** Nome do contratante normalizado para a busca pelo início (quem chama normaliza; a memória usa). */
  readonly contratanteBusca: string;
  readonly contratanteDocumento: string;
  readonly formaReajuste: number;
  readonly mesReajuste: number;
  /** 1 prazo determinado, 2 indeterminado. */
  readonly tipoVigencia: number;
  readonly inicio: string;
  readonly fim: string | null;
  readonly diaVencimento: number | null;
  /** Chave de SITUACOES_CONTRATO do contrato. */
  readonly situacao: string;
  readonly motivoSituacao: string | null;
}

export interface Contrato extends Omit<DadosContrato, 'contratanteBusca'> {
  readonly id: number;
  readonly operadora: number;
  readonly produtoNome: string;
  readonly beneficiariosAtivos: number;
  readonly versao: number;
  readonly alteradoEm: string;
}

export interface FiltroContratos {
  readonly operadora: number;
  readonly produto?: number;
  /** Número do contrato (início). */
  readonly numero?: string;
  /** Nome do contratante normalizado (início). */
  readonly nome?: string;
  readonly apos?: number;
}

export interface DadosBeneficiario {
  readonly contrato: number;
  readonly titular: number | null;
  /** 1 titular; 2 a 8 o vínculo do dependente com o titular (VINCULOS_TITULAR do contrato). */
  readonly vinculo: number;
  readonly nome: string;
  /** Nome normalizado para a busca pelo início (quem chama normaliza; a memória usa). */
  readonly nomeBusca: string;
  readonly nomeSocial: string | null;
  readonly cpf: string | null;
  readonly nascimento: string;
  /** 'F' | 'M' | 'I' (SEXOS_BENEFICIARIO do contrato). */
  readonly sexo: string;
  readonly cns: string | null;
  readonly nomeMae: string;
  readonly inclusao: string;
  /** O paciente do hospital que é o mesmo beneficiário (só o id). */
  readonly pacienteHospital: number | null;
}

export interface Beneficiario extends Omit<DadosBeneficiario, 'nomeBusca'> {
  readonly id: number;
  readonly operadora: number;
  readonly contratoNumero: string;
  readonly produtoNome: string;
  readonly carteirinha: string;
  readonly via: number;
  readonly situacao: 'ativo' | 'suspenso' | 'excluido';
  readonly exclusao: string | null;
  readonly motivoBaixa: number | null;
  readonly versao: number;
  readonly alteradoEm: string;
}

export interface FiltroBeneficiarios {
  readonly operadora: number;
  readonly contrato?: number;
  readonly titular?: number;
  readonly carteirinha?: string;
  readonly cpf?: string;
  /** Nome normalizado (início). */
  readonly nome?: string;
  readonly situacao?: string;
  readonly apos?: number;
}

export interface Elegibilidade {
  readonly beneficiario: Beneficiario;
  readonly contrato: { situacao: string; inicio: string; fim: string | null };
  readonly produto: Produto;
}

export interface ViaCarteirinha {
  readonly via: number;
  readonly motivo: number | null;
  readonly validade: string;
  readonly emitidaPor: string;
  readonly emitidaEm: string;
}

export interface DominiosBeneficiario {
  readonly motivosBaixa: { codigo: number; nome: string }[];
  readonly motivosSegundaVia: { codigo: number; nome: string }[];
  readonly diasVencimento: number[];
}

/** As gravações da F1 numa transação só (o estabelecimento vem do contexto; `por` é o login, mostrado na memória). */
export interface GravadorOperadora {
  gravarOperadora(x: { id: number | null; versao: number | null; dados: DadosOperadora; por: string }): Promise<{
    id: number;
  }>;
  gravarProduto(x: { id: number | null; versao: number | null; dados: DadosProduto; por: string }): Promise<{
    id: number;
  }>;
  gravarContrato(x: {
    operadora: number;
    id: number | null;
    versao: number | null;
    dados: DadosContrato;
    por: string;
  }): Promise<{ id: number }>;
  proximaSequenciaCarteirinha(): Promise<number>;
  incluirBeneficiario(x: {
    operadora: number;
    dados: DadosBeneficiario;
    carteirinha: string;
    validade: string;
    por: string;
  }): Promise<{ id: number }>;
  alterarBeneficiario(x: { id: number; versao: number; dados: DadosBeneficiario; por: string }): Promise<{
    id: number;
  }>;
  baixarBeneficiario(x: {
    id: number;
    versao: number;
    motivo: number;
    data: string;
    por: string;
  }): Promise<{ id: number; dependentes: number }>;
  reativarBeneficiario(x: { id: number; versao: number; por: string }): Promise<{ id: number }>;
  emitirVia(x: { id: number; versao: number; motivo: number | null; validade: string; por: string }): Promise<{
    id: number;
    via: number;
  }>;
}

export interface PortaOperadora {
  readonly destino: 'banco' | 'memoria';
  gruposSip(c: ContextoOperadora): Promise<GrupoSip[]>;
  procedimentosSip(
    c: ContextoOperadora,
    f: FiltroSip,
  ): Promise<{ itens: ProcedimentoSip[]; proxima: ChaveSip | null }>;
  classificacoesAns(
    c: ContextoOperadora,
    f: FiltroClassificacao,
  ): Promise<{ itens: ClassificacaoAns[]; proxima: number | null }>;
  operadoras(c: ContextoOperadora): Promise<Operadora[]>;
  operadora(c: ContextoOperadora, id: number): Promise<Operadora | null>;
  produtos(c: ContextoOperadora, operadora?: number): Promise<Produto[]>;
  produto(c: ContextoOperadora, id: number): Promise<Produto | null>;
  contratos(c: ContextoOperadora, f: FiltroContratos): Promise<{ itens: Contrato[]; proxima: number | null }>;
  contrato(c: ContextoOperadora, id: number): Promise<Contrato | null>;
  beneficiarios(
    c: ContextoOperadora,
    f: FiltroBeneficiarios,
  ): Promise<{ itens: Beneficiario[]; proxima: number | null }>;
  beneficiario(c: ContextoOperadora, id: number): Promise<Beneficiario | null>;
  dependentes(c: ContextoOperadora, titular: number): Promise<Beneficiario[]>;
  vias(c: ContextoOperadora, beneficiario: number): Promise<ViaCarteirinha[]>;
  elegibilidade(c: ContextoOperadora, carteirinha: string): Promise<Elegibilidade | null>;
  contagensDoContrato(
    c: ContextoOperadora,
    x: { contrato: number; cpf: string | null; exceto: number | null },
  ): Promise<{ titularesAtivos: number; cpfNoContrato: number }>;
  /** D-BAIXA-56: beneficiários não excluídos do contrato e contratos não encerrados do produto (0 sem o id). */
  contagensDeUso(
    c: ContextoOperadora,
    x: { contrato: number | null; produto: number | null },
  ): Promise<{ beneficiariosVinculados: number; contratosEmUso: number }>;
  dominiosBeneficiario(c: ContextoOperadora): Promise<DominiosBeneficiario>;
  pacienteExiste(c: ContextoOperadora, id: number): Promise<boolean>;
  /** Uma gravação (uma transação) com a linha da trilha da tela; na memória, a trilha vai ao registrador da API. */
  gravar<T>(
    c: ContextoOperadora,
    trilha: RegistroTrilhaTela | ((r: T) => RegistroTrilhaTela),
    fn: (g: GravadorOperadora) => Promise<T>,
  ): Promise<T>;
}

export const METODOS_PORTA_OPERADORA: ReadonlySet<string> = new Set([
  'gruposSip',
  'procedimentosSip',
  'classificacoesAns',
  'operadoras',
  'operadora',
  'produtos',
  'produto',
  'contratos',
  'contrato',
  'beneficiarios',
  'beneficiario',
  'dependentes',
  'vias',
  'elegibilidade',
  'contagensDoContrato',
  'contagensDeUso',
  'dominiosBeneficiario',
  'pacienteExiste',
  'gravar',
]);

/** Fora de dev/ci sem o núcleo: 503 em tudo (falha fechada). */
export function portaOperadoraIndisponivel(): PortaOperadora {
  return portaIndisponivel<PortaOperadora>(METODOS_PORTA_OPERADORA);
}
