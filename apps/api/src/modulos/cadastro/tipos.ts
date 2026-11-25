// Tipos de negócio do cadastro (pacientes, profissionais, solicitantes, pessoas, consentimentos e fila de duplicidades):
// o que as portas (própria sobre o MariaDB e memória de dev/ci) entregam às telas, em vocabulário neutro — booleano,
// data ISO (AAAA-MM-DD), instante ISO, id numérico e número de negócio. Nenhum nome de coluna nem código de sistema
// de origem. O mascaramento por permissão é da API (servico.ts), com @sgh/dominio-cadastro.
import type { ContextoOperacao, LinhaTrilha } from '@sgh/nucleo';

// Melhoria: os tipos deixam de depender de um pacote de leitura do sistema antigo e passam a ser do próprio módulo.

/** Paciente na ficha e nas listas (sem mascaramento). */
export interface PacienteFicha {
  readonly id: number;
  readonly prontuario: number;
  readonly prontuarioAnterior: number | null;
  readonly nome: string;
  readonly nomeSocial: string | null;
  readonly nascimento: string | null;
  readonly sexo: 'F' | 'M' | null;
  readonly mae: string | null;
  readonly maeDesconhecida: boolean;
  readonly pai: string | null;
  /** 11 dígitos, ou null. */
  readonly cpf: string | null;
  readonly cns: string | null;
  readonly identidade: string | null;
  readonly estadoCivil: number | null;
  readonly naturalidade: string | null;
  readonly ufNaturalidade: string | null;
  readonly nacionalidade: string | null;
  readonly nacionalidadeCodigo: number | null;
  readonly cep: string | null;
  readonly logradouro: string | null;
  readonly numero: number | null;
  readonly complemento: string | null;
  readonly bairro: string | null;
  readonly cidade: string | null;
  readonly uf: string | null;
  readonly telefone: string | null;
  readonly celular: string | null;
  readonly email: string | null;
  readonly contatoNome: string | null;
  readonly contatoTelefone: string | null;
  readonly racaCor: number | null;
  readonly religiao: number | null;
  readonly responsavelLegal: string | null;
  readonly ativo: boolean;
  /** O cadastro que absorveu este numa unificação (null: não unificado). */
  readonly unificadoEm: number | null;
  readonly obito: string | null;
  /** Número da declaração de óbito emitida no prontuário (02-CAD linha 13), quando houver. */
  readonly obitoDeclaracao?: string | null;
  /** Causa básica (última linha preenchida da parte I da declaração), quando houver. */
  readonly obitoCausa?: string | null;
  readonly cadastradoEm: string | null;
  readonly alteradoEm: string | null;
  readonly alergia: string | null;
  readonly medicamentos: string | null;
  /** Instante da última alteração (ISO), ou null. */
  readonly carimbo: string | null;
  /** Versão opaca do controle otimista (a tela devolve na alteração). */
  readonly versao: string;
}

/** Retrato de uma versão do cadastro (linha do tempo). */
export interface VersaoCadastro {
  readonly id: number;
  readonly em: string | null;
  readonly usuario: string | null;
  /** Campos do retrato, pelo nome do campo da ficha (a API compara e mascara). */
  readonly valores: Readonly<Record<string, unknown>>;
  readonly telefones: readonly { readonly tipo: number; readonly numero: string }[];
}

export interface IdsEncontrados {
  readonly ids: ReadonlySet<number>;
  /** A palavra pegou mais ids que o teto (palavra comum demais: não restringe). */
  readonly truncado: boolean;
}

export type CriterioBuscaDireta =
  | { readonly tipo: 'cpf'; readonly cpf: number }
  | { readonly tipo: 'prontuario'; readonly prontuario: number }
  | { readonly tipo: 'cns'; readonly cns: string }
  | { readonly tipo: 'nascimento'; readonly data: string };

export interface ExtrasFicha {
  readonly carteirinhas: readonly { readonly convenio: number; readonly nome: string }[];
  readonly estadoCivil: string | null;
  readonly racaCor: string | null;
  readonly religiao: string | null;
}

/** Par da fila de duplicidades. */
export interface ParFila {
  readonly id: number;
  readonly a: number;
  readonly b: number;
  readonly escore: number;
  readonly criterios: readonly string[];
  readonly situacao: 'aberto' | 'outra_pessoa' | 'unificado';
  readonly decididoPor: string | null;
  readonly decididoEm: string | null;
}

/** Par candidato a entrar na fila. */
export interface ParCandidato {
  readonly a: { readonly id: number; readonly pront: number };
  readonly b: { readonly id: number; readonly pront: number };
  readonly escore: number;
  readonly criterios: readonly string[];
}

export interface OpcaoDominio {
  readonly codigo: number;
  readonly rotulo: string;
}

export interface ConsentimentoPaciente {
  readonly id: number;
  readonly finalidade: string;
  readonly versao: string;
  readonly situacao: number;
  readonly signatario: number;
  readonly registradoEm: string;
  readonly registradoPor: string;
  readonly revogadoEm: string | null;
  readonly revogacao: number | null;
}

/** Registro do profissional no conselho. */
export interface RegistroProfissional {
  readonly id: number;
  readonly profissional: number;
  readonly conselho: string | null;
  readonly sigla: string | null;
  readonly numero: number | null;
  readonly uf: string | null;
  readonly cbo: string | null;
  readonly cboDescricao: string | null;
  readonly ativo: boolean | null;
  readonly siglaId?: number | null;
  readonly versao?: string;
}

export interface ProfissionalCadastro {
  readonly id: number;
  readonly nome: string;
  readonly nomeSocial: string | null;
  readonly situacao: string | null;
  readonly registros: readonly RegistroProfissional[];
}

export interface FichaProfissionalCadastro extends ProfissionalCadastro {
  readonly especialidades: readonly { registro: number; codigo: number; nome: string; ativo: boolean }[];
  readonly lotacao: readonly {
    registro: number;
    unidade: number;
    nome: string | null;
    horasAmbulatorio: number;
    horasHospital: number;
    horasOutros: number;
    ativo: boolean;
  }[];
  readonly credenciamentos: readonly { registro: number; convenio: number; nome: string | null }[];
  readonly logins: readonly { login: string; origem: 'complemento' | 'papel' }[];
}

export interface SolicitanteCadastro {
  readonly id: number;
  readonly nome: string;
  readonly conselho: string | null;
  readonly numero: number | null;
  readonly uf: string | null;
  readonly cbo: string | null;
  readonly ativo: boolean | null;
  readonly codigosConvenio: number;
}

export interface PessoaEncontrada {
  readonly id: number;
  readonly tipo: 'F' | 'J' | null;
  readonly documento: string | null;
  readonly profissionais: number;
  readonly pacientes: number;
}

export interface DadosProfissional {
  readonly sexo: string | null;
  readonly nascimento: string | null;
  readonly nomeMae: string | null;
  readonly email: string | null;
  readonly celular: string | null;
  readonly versao: string;
}

export interface OpcoesEdicaoProfissional {
  readonly conselhos: { valor: string; rotulo: string }[];
  readonly siglas: { valor: number; rotulo: string; conselho: string | null }[];
  readonly cbos: { valor: number; rotulo: string }[];
  readonly especialidades: { valor: number; rotulo: string }[];
  readonly unidades: { valor: number; rotulo: string }[];
  readonly convenios: { valor: number; rotulo: string }[];
  readonly ufs: string[];
}

export interface LoginCandidato {
  readonly login: string;
  readonly nome: string | null;
  /** O profissional a que o login já está ligado (null: livre). */
  readonly profissional: number | null;
}

export interface EventoVinculoProfissional {
  readonly evento: string;
  readonly registro: number | null;
  readonly loginAntes: string | null;
  readonly loginDepois: string | null;
  readonly motivo: string | null;
  readonly usuario: string;
  readonly em: string;
}

/** Resposta do passo 0 (a operação grava agora?). */
export interface LiberacaoOperacao {
  readonly pode: boolean;
  readonly codigo: string | null;
  readonly motivo: string | null;
}

/**
 * Contexto de uma gravação pedida pela tela: o ContextoOperacao do núcleo (cliente, estabelecimento e usuário por id,
 * correlação e Idempotency-Key) mais o que a tela mostra (login, código do estabelecimento) e a estação.
 */
export interface ContextoGravacao extends ContextoOperacao {
  readonly rede: string;
  readonly hospital: string;
  /** Login de quem grava (exibição; a trilha usa o id). */
  readonly login: string;
  readonly estacao: string;
}

/** Linha da trilha de uma gravação direta da porta (o instante é o da transação, quando ausente). */
export type RegistroTrilhaTela = Omit<LinhaTrilha, 'ocorridoEm'> & { readonly ocorridoEm?: Date };

/** Onde a porta lê e grava: o banco do cliente (pelo núcleo) ou a memória sintética de dev/ci. */
export type DestinoPorta = 'banco' | 'memoria';
