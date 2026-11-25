// Tipos de negócio da gestão de pessoas (M52.1), independentes de onde a porta lê: o banco do cliente (MariaDB, pelo
// @sgh/nucleo) ou a memória sintética de dev/ci. Datas em ISO (AAAA-MM-DD), instantes em ISO local do estabelecimento,
// ids numéricos e booleanos; o CPF só como HMAC (filtro exato) ou cifrado (exibição mascarada), nunca em claro.
// Melhoria: o vínculo leva o id do estabelecimento (não o código em texto) e o retrato do conselho não carrega o
// estabelecimento (a porta já filtra pela sessão).
import type { ContextoNucleo } from '@sgh/nucleo';

/** Registro do conselho de um profissional (inscrição no conselho de classe). */
export interface RegistroConselho {
  readonly id: number;
  readonly profissional: number;
  readonly conselho: string | null;
  readonly sigla: string | null;
  readonly numero: number | null;
  readonly uf: string | null;
  readonly cbo: string | null;
  readonly cboDescricao: string | null;
  readonly ativo: boolean;
}

export interface ProfissionalCadastro {
  readonly id: number;
  readonly nome: string;
  readonly nomeSocial: string | null;
  /** Situação do cadastro do profissional ('ativo', 'inativo', 'suspenso', 'afastado'). */
  readonly situacao: string | null;
  readonly registros: readonly RegistroConselho[];
}

export interface ProfissionalDaPessoa {
  readonly id: number;
  readonly nome: string;
  /** Quantos registros de conselho o profissional tem. */
  readonly registros: number;
}

export interface UsuarioDaPessoa {
  readonly id: number;
  readonly login: string;
  readonly bloqueado: boolean;
  readonly ativo: boolean;
  /** Grupo da conta (o login de painel é o de um aparelho: o bloqueio confere antes). */
  readonly grupo: string | null;
}

export interface PessoaPorCpf {
  readonly profissionais: readonly ProfissionalDaPessoa[];
  readonly usuarios: readonly UsuarioDaPessoa[];
}

export interface UnidadeDoRegistro {
  readonly codigo: number;
  readonly nome: string | null;
  readonly ativo: boolean;
}

export interface VinculoColaborador {
  readonly id: number;
  /** Estabelecimento do vínculo (estabelecimento.id; null só na memória sintética sem estabelecimento). */
  readonly estabelecimento: number | null;
  /** Agrupador da pessoa (o colaborador): os vínculos da mesma pessoa têm o mesmo valor. */
  readonly pessoa: number;
  readonly cpfCifrado: string;
  readonly nome: string;
  readonly profissional: number | null;
  readonly usuario: number | null;
  readonly tipo: string;
  readonly matricula: string | null;
  readonly cargo: string;
  /** Cargo do quadro de cargos e salários, quando ligado. */
  readonly idCargo?: number | null;
  readonly funcao: string | null;
  readonly cargaSemanal: number;
  /** Centro de custo do vínculo (null: ainda não lotado). */
  readonly centroCusto: number | null;
  readonly unidade: number | null;
  readonly setor: string | null;
  readonly admissao: string;
  readonly desligamento: string | null;
  readonly tipoRescisao: number | null;
  readonly motivoDesligamento: string | null;
  readonly desligadoPor: string | null;
  readonly versao: number;
  readonly criadoPor: string;
  readonly criadoEm: string;
}

export interface FiltroVinculos {
  readonly termo?: string;
  /** O CPF como filtro exato (HMAC; o CPF em claro nunca chega aqui). Com ele, o termo não se aplica. */
  readonly cpfHmac?: string;
  readonly centroCusto?: number;
  readonly unidade?: number;
  readonly setor?: string;
  readonly tipo?: string;
  readonly estado: 'ativo' | 'desligado' | 'todos';
  readonly depois?: number;
  readonly limite: number;
}

export interface NovoVinculo {
  /** null: a pessoa é nova. */
  readonly pessoa: number | null;
  readonly cpfHmac: string;
  readonly cpfCifrado: string;
  readonly nome: string;
  readonly profissional: number | null;
  readonly usuario: number | null;
  readonly tipo: string;
  readonly matricula: string | null;
  readonly cargo: string;
  readonly funcao: string | null;
  readonly cargaSemanal: number;
  readonly centroCusto: number;
  readonly unidade: number | null;
  readonly setor: string | null;
  readonly admissao: string;
  readonly por: string;
  /** Ficha da admissão (C1-111): o vínculo de trabalho exige na porta própria; a porta em memória não usa. */
  readonly nascimento?: string | null;
  /** Sexo (id do catálogo). */
  readonly sexo?: number | null;
  /** Grau de instrução (código oficial 01 a 12). */
  readonly grauInstrucao?: string | null;
  /** Categoria do trabalhador do eSocial (id do catálogo). */
  readonly categoria?: number | null;
  /** Tipo de vínculo de trabalho (id do catálogo oficial). */
  readonly tipoVinculoTrabalho?: number | null;
  /** Salário-base do contrato. */
  readonly salario?: number | null;
}

/** Catálogos da ficha da admissão (C1-111). */
export interface CatalogosAdmissao {
  readonly sexos: readonly { codigo: number; nome: string }[];
  readonly categorias: readonly { codigo: number; nome: string }[];
  readonly tiposVinculo: readonly { codigo: number; nome: string }[];
}

export interface MudancaVinculo {
  readonly id: number;
  readonly versao: number;
  readonly cargo: string;
  readonly funcao: string | null;
  readonly cargaSemanal: number;
  readonly centroCusto: number;
  readonly unidade: number | null;
  readonly setor: string | null;
  readonly por: string;
}

export interface DesligamentoVinculo {
  readonly id: number;
  readonly versao: number;
  readonly data: string;
  readonly tipoRescisao: number;
  readonly motivo: string;
  readonly por: string;
}

export interface EventoHistorico {
  readonly vinculo: number;
  readonly tipo: string;
  readonly vigencia: string;
  readonly antes: string | null;
  readonly depois: string | null;
  readonly motivo: string | null;
  readonly por: string;
}

export interface HistoricoVinculo {
  readonly id: number;
  readonly tipo: string;
  readonly vigencia: string;
  readonly antes: string | null;
  readonly depois: string | null;
  readonly motivo: string | null;
  readonly registradoPor: string;
  readonly registradoEm: string;
}

export interface DadosDependente {
  readonly nome: string;
  readonly nascimento: string;
  readonly parentesco: string;
  readonly cpfHmac: string | null;
  readonly cpfCifrado: string | null;
  readonly dependenteIr: boolean;
  readonly dependenteSalarioFamilia: boolean;
}

export interface DependenteColaborador extends DadosDependente {
  readonly id: number;
  /** De quando vale esta versão (null: desde a inclusão). */
  readonly desde: string | null;
}

export interface NovoDependente extends DadosDependente {
  readonly vinculo: number;
  readonly por: string;
}

export interface FimDependente {
  readonly vinculo: number;
  readonly id: number;
  readonly ate: string;
  readonly motivo: string;
  readonly por: string;
}

export interface VersaoDependente extends DadosDependente {
  readonly vinculo: number;
  /** A versão em vigor que a alteração substitui. */
  readonly anterior: number;
  /** A data a partir da qual a versão nova vale (a anterior acaba na véspera). */
  readonly desde: string;
  readonly motivo: string;
  readonly por: string;
}

export interface HabilitacaoRegistro {
  readonly registro: number;
  readonly numero: number | null;
  readonly conselho: string | null;
  readonly validade: string | null;
  readonly conferidoEm: string;
  readonly conferidoPor: string;
  readonly observacao: string | null;
  readonly versao: number;
}

export interface ConferenciaHabilitacao {
  readonly registro: number;
  readonly numero: number | null;
  readonly conselho: string | null;
  readonly validade: string | null;
  readonly conferidoEm: string;
  readonly observacao: string | null;
  readonly por: string;
  /** A versão do registro que a tela leu (trava otimista); sem ela, a última conferência prevalece. */
  readonly versao?: number;
}

export interface CorrecaoVinculo {
  readonly id: number;
  readonly versao: number;
  readonly nome: string;
  readonly matricula: string | null;
  readonly tipo: string;
  readonly admissao: string;
  readonly por: string;
}

export interface CargoDoVinculo {
  readonly id: number;
  readonly versao: number;
  /** O cargo do quadro (conferido ativo por quem chama); null desliga. */
  readonly cargo: number | null;
  readonly por: string;
}

/** O valor anterior e o novo de uma mudança (só inclusão). */
export interface CorrecaoRegistrada {
  readonly id: number;
  readonly tabela: string;
  readonly registro: number;
  readonly operacao: string;
  readonly antes: Record<string, unknown>;
  readonly depois: Record<string, unknown>;
  readonly motivo: string;
  readonly por: string;
  readonly em: string;
}

export interface RegistroDoColaborador {
  readonly registro: number;
  readonly profissional: number;
  readonly conselho: string | null;
  readonly numero: number | null;
  readonly ativo: boolean | null;
  /** O vínculo ativo de menor id da pessoa (a linha do alerta abre a ficha dele). */
  readonly vinculo: number;
  readonly nome: string;
}

/** Retrato da validade dos registros de conselho dos colaboradores ativos num dia. */
export interface RetratoConselhoDia {
  readonly dia: string;
  readonly janelaDias: number;
  readonly registros: number;
  readonly vencidos: number;
  readonly aVencer: number;
  readonly semValidade: number;
}

/** Chave do estado em memória por estabelecimento (o código da sessão sintética, quando há; senão o id). */
export function chaveMemoria(c: ContextoNucleo): string {
  const h = (c as { readonly hospital?: unknown }).hospital;
  return typeof h === 'string' && h ? h : String(c.estabelecimento ?? '');
}
