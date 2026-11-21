// Tipos de negócio do faturamento SUS próprio (M51): o que a porta lê e grava no banco do cliente, sem nada do sistema
// de origem (sem S/N, hora de quatro dígitos, sentinela nem código antigo). Datas em ISO (AAAA-MM-DD), competência AAAAMM, ids
// numéricos do banco próprio, booleanos. O que só vai ao arquivo do gestor (nome, endereço, CNS) nunca vai à tela, à
// trilha nem ao log.
// Melhoria: os erros de gravação da porta são de negócio (ErroSus, ErroAih), com o código da recusa; a porta própria
// traduz a violação de restrição do banco em recusa (nunca a mensagem crua do banco).
/**
 * A linha da trilha de uma gravação do faturamento SUS: o evento auditável, a operação, o alvo (tabela e id) e a
 * diferença (só nomes de campo, ids, contagens e hash; nunca nome, documento nem texto clínico). Na porta própria vai
 * à trilha da operação, na mesma transação; na memória, ao registrador da API.
 */
export interface LinhaTrilhaSus {
  readonly rede: string;
  readonly hospital: string;
  /** O login de quem fez. */
  readonly usuario: string;
  readonly evento: string;
  readonly recurso: string;
  readonly operacao: string;
  readonly tabelaAlvo: string | null;
  readonly idAlvo: string | null;
  readonly chaveNaturalAlvo: string | null;
  readonly resultado: string;
  readonly estacao: string | null;
  readonly correlacao: string;
  readonly diferenca?: string | null;
  /** O estabelecimento e o usuário da sessão no banco do cliente (a porta própria usa; a memória ignora). */
  readonly estabelecimento?: number | null;
  readonly usuarioId?: number | null;
}

export type InstrumentoSusPorta = 'ciha' | 'bpa' | 'apac' | 'aih';

export type CodigoErroSus =
  | 'competencia-ja-aberta'
  | 'competencia-nao-aberta'
  | 'competencia-ja-fechada'
  | 'competencia-nao-fechada'
  | 'versao-alterada'
  | 'equivalencia-alterada'
  | 'nao-encontrado'
  | 'critica-nao-justificavel'
  | 'apac-alterada'
  | 'apac-numero-duplicado';

export class ErroSus extends Error {
  override readonly name = 'ErroSus';
  readonly codigo: CodigoErroSus;
  constructor(codigo: CodigoErroSus, mensagem: string) {
    super(mensagem);
    this.codigo = codigo;
  }
}

export type CodigoErroAih = 'versao-alterada' | 'nao-encontrado' | 'numero-em-uso' | 'faixa-sobreposta' | 'aih-ja-registrada';

export class ErroAih extends Error {
  override readonly name = 'ErroAih';
  readonly codigo: CodigoErroAih;
  constructor(codigo: CodigoErroAih, mensagem: string) {
    super(mensagem);
    this.codigo = codigo;
  }
}

// ── Dados da montagem (conta, itens e catálogos) ──────────────────────────────────────────────────────────

/** O paciente do atendimento: só para o arquivo do gestor (nunca vai à tela, à trilha nem à auditoria). */
export interface PacienteDoArquivo {
  readonly cns: string | null;
  readonly cpf: string | null;
  readonly sexo: string | null;
  readonly nascimento: string | null;
  readonly municipio: number | null;
  readonly nome: string | null;
  readonly logradouro: string | null;
  readonly numero: string | null;
  readonly complemento: string | null;
  readonly cep: string | null;
}

export interface ContaCiha {
  readonly conta: number;
  readonly modalidade: 'internacao' | 'ambulatorial';
  /** O atendimento que agrupa as contas parciais. */
  readonly registro: number;
  readonly atendimento: number | null;
  readonly convenio: number;
  readonly entrada: string | null;
  readonly saida: string | null;
  readonly cidPrincipal: string | null;
  readonly cidSecundario: string | null;
  readonly paciente: PacienteDoArquivo & {
    readonly uf: string | null;
    readonly prontuario: number | null;
    readonly declaracaoObito: string | null;
  };
  /** O motivo de saída da internação na tabela do gestor; null no ambulatorial. */
  readonly motivoAlta: number | null;
  /** A carteira do beneficiário e a guia (só para a fonte plano privado). */
  readonly beneficiario: string | null;
  readonly guiaTiss: string | null;
  /** O registro na ANS e o CNPJ da operadora da conta. */
  readonly operadora: { readonly regAns: number | null; readonly cnpj: string | null };
}

export interface ItemContaSigtap {
  readonly conta: number;
  readonly item: number;
  readonly sigtap: number | null;
  readonly quantidade: number;
  /** O item faturável do hospital (a chave da equivalência). */
  readonly procedimento: number | null;
}

export interface ProcedimentoSigtapRegra {
  readonly id: number;
  readonly codigo: string;
  readonly competenciaInicial: number;
  readonly competenciaFinal: number;
  readonly idadeMinima: number | null;
  readonly idadeMaxima: number | null;
  readonly sexo: string | null;
  readonly quantidadeMaxima: number | null;
  readonly permanencia: number | null;
  readonly complexidade: string | null;
}

export interface HistoricoSigtap {
  readonly id: number;
  readonly competencia: number;
  readonly idadeMinima: number | null;
  readonly idadeMaxima: number | null;
  readonly sexo: string | null;
  readonly quantidadeMaxima: number | null;
  readonly permanencia: number | null;
  readonly complexidade: string | null;
}

export interface RegistroSigtap {
  readonly id: number;
  readonly registro: string;
  readonly competenciaInicial: number;
  readonly competenciaFinal: number;
}

/** O item faturável do hospital (procedimento da tabela de preço) que a equivalência liga à SIGTAP. */
export interface ProcedimentoHospital {
  readonly id: number;
  readonly codigo: number;
  readonly nome: string;
  readonly tabela: string;
}

export interface InternacaoAih {
  readonly registro: number;
  readonly prontuario: number | null;
  readonly atendimento: number | null;
  /** A primeira conta SUS da internação (sem conta SUS, a primeira de qualquer convênio; null sem conta). */
  readonly conta: number | null;
  readonly contasSus: readonly number[];
  readonly convenio: number;
  readonly entrada: string | null;
  readonly alta: string | null;
  readonly motivoSaida: number | null;
  /** Caráter da internação: '1' eletivo, '2' urgência (a montagem traduz para a tabela do SIH). */
  readonly carater: string | null;
  readonly especialidadeLeito: number | null;
  readonly cidPrincipal: string | null;
  readonly cidSecundario: string | null;
  readonly paciente: PacienteDoArquivo & { readonly raca: number | null };
}

export interface ItemContaAih {
  readonly conta: number;
  readonly item: number;
  readonly tipo: number;
  readonly sigtap: number | null;
  readonly quantidade: number;
  readonly procedimento: number | null;
  readonly cbo: string | null;
}

export interface PassagemLeito {
  readonly registro: number;
  readonly entrada: string;
  readonly saida: string | null;
  readonly acomodacao: number;
}

export interface LoteSaida {
  readonly item: number;
  readonly nome: string;
  readonly quantidade: number;
  readonly lote: string;
}

export interface ValorSigtap {
  readonly id: number;
  readonly data: string;
  readonly servicoHospitalar: number;
  readonly servicoProfissional: number;
  readonly sadt: number;
  readonly ambulatorial: number;
}

export interface AtendimentoLaudoApacDados {
  readonly registro: number;
  readonly atendimento: number | null;
  readonly pacienteId: number | null;
  readonly prontuario: number | null;
  readonly data: string | null;
  readonly convenio: number | null;
  /** Só para a conferência do dígito no servidor. */
  readonly cns: string | null;
  readonly cidPrincipal: string | null;
}

export interface ValorDominioApac {
  readonly id: number;
  readonly nome: string;
}

export interface DominiosApacDados {
  readonly caracteristicaTratamento: readonly ValorDominioApac[];
  readonly contraindicacaoTransplante: readonly ValorDominioApac[];
  readonly situacaoTransplante: readonly ValorDominioApac[];
  readonly acessoVascular: readonly ValorDominioApac[];
}

export interface SolicitanteApacCadastro {
  /** A chave do solicitante no cadastro (a tela recebe só a chave opaca). */
  readonly chave: string;
  readonly nome: string;
  readonly crm: number | null;
  /** Só para a conferência do dígito e o arquivo. */
  readonly cns: string | null;
}

export interface ContaBpa {
  readonly conta: number;
  readonly registro: number;
  readonly atendimento: number | null;
  readonly convenio: number;
  readonly data: string | null;
  readonly cidPrincipal: string | null;
  readonly pacienteId: number | null;
  readonly paciente: PacienteDoArquivo & {
    readonly raca: number | null;
    readonly bairro: string | null;
    readonly mae: string | null;
  };
}

export interface ItemBpa {
  readonly conta: number;
  readonly item: number;
  readonly sigtap: number | null;
  readonly quantidade: number;
  readonly procedimento: number | null;
  readonly executante: { readonly cbo: string | null; readonly cns: string | null; readonly cpf: string | null } | null;
}

export interface CompatibilidadeSigtap {
  readonly id: number;
  readonly codigo: string;
  readonly competenciaInicial: number;
  readonly competenciaFinal: number;
}

export interface MedicoSolicitante {
  readonly id: number;
  readonly conselho: number;
  readonly nome: string;
  readonly uf: string | null;
  readonly cbo: string | null;
  readonly ativo: boolean;
}

/** Os parâmetros do faturamento ambulatorial do cadastro do estabelecimento (consulta). */
export interface ParametrosSusCadastro {
  readonly competenciaAmbulatorio: string | null;
  readonly versao: string | null;
  readonly orgao: string | null;
}

// ── Competência, crítica, arquivo e equivalência ──────────────────────────────────────────────────────────

export interface CompetenciaSusRegistro {
  readonly id: number;
  readonly instrumento: InstrumentoSusPorta;
  readonly competencia: string;
  readonly situacao: 'aberta' | 'fechada';
  readonly cnes: string | null;
  readonly registros: number;
  readonly bloqueantes: number;
  readonly avisos: number;
  readonly criticadaEm: string | null;
  readonly abertaPor: string;
  readonly abertaEm: string;
  readonly fechadaPor: string | null;
  readonly fechadaEm: string | null;
  readonly reabertaPor: string | null;
  readonly reabertaEm: string | null;
  readonly versao: number;
}

export interface NovaCriticaSus {
  readonly chave: string;
  readonly regra: string;
  readonly gravidade: 'bloqueante' | 'aviso';
  readonly conta: number | null;
  readonly convenio: number | null;
  readonly atendimento: number | null;
  readonly item: number | null;
  /** JSON curto, sem dado pessoal (código SIGTAP, CID, campo, competência). */
  readonly detalhe: string;
}

export interface ResultadoGravacaoCriticas {
  readonly novas: number;
  readonly mantidas: number;
  readonly reabertas: number;
  readonly corrigidas: number;
  readonly bloqueantes: number;
  readonly avisos: number;
}

export interface CriticaSus {
  readonly id: number;
  readonly regra: string;
  readonly gravidade: 'bloqueante' | 'aviso';
  readonly situacao: 'aberta' | 'corrigida' | 'justificada';
  readonly conta: number | null;
  readonly atendimento: number | null;
  readonly item: number | null;
  readonly detalhe: string;
  readonly justificativa: string | null;
  readonly versao: number;
}

export interface FiltroCriticasPorta {
  readonly regra?: string;
  readonly gravidade?: 'bloqueante' | 'aviso';
  readonly situacao?: 'aberta' | 'corrigida' | 'justificada';
  /** Escopo por convênio do faturista (null: sem restrição). */
  readonly convenios: readonly number[] | null;
  readonly pagina: number;
  readonly porPagina: number;
}

export interface ArquivoSus {
  readonly id: number;
  readonly instrumento: InstrumentoSusPorta;
  readonly competencia: string;
  readonly leiaute: string;
  readonly versaoLeiaute: string;
  readonly conferidoOficial: boolean;
  readonly nome: string;
  readonly linhas: number;
  readonly registros: number;
  readonly procedimentos: number;
  readonly semMovimento: boolean;
  readonly hash: string;
  readonly bytes: number;
  readonly chaveObjeto: string;
  readonly versaoObjeto: string | null;
  readonly situacao: 'gerado' | 'conferido' | 'enviado' | 'substituido';
  readonly geradoPor: string;
  readonly geradoEm: string;
}

export interface NovoArquivoSus {
  readonly id: number;
  readonly competencia: { readonly id: number; readonly instrumento: InstrumentoSusPorta; readonly competencia: string };
  readonly leiaute: string;
  readonly versaoLeiaute: string;
  readonly conferidoOficial: boolean;
  readonly nome: string;
  readonly linhas: number;
  readonly registros: number;
  readonly procedimentos: number;
  readonly semMovimento: boolean;
  readonly hash: string;
  readonly bytes: number;
  readonly chaveObjeto: string;
  readonly versaoObjeto: string | null;
  readonly por: string;
}

export interface RegistroCihaParaGravar {
  readonly modalidade: 'internacao' | 'ambulatorial';
  readonly conta: number;
  readonly atendimento: number | null;
  readonly registro: number | null;
  readonly fonte: string;
  readonly cidPrincipal: string;
  readonly procedimentoPrincipal: string;
  readonly procedimentos: number;
}

export interface EquivalenciaSus {
  readonly id: number;
  /** O item faturável do hospital. */
  readonly procedimento: number;
  /** O código do item faturável, guardado para a tela. */
  readonly codigoProcedimento: number;
  readonly sigtap: number;
  readonly codigo: string;
  readonly ativa: boolean;
  readonly registradaPor: string;
  readonly registradaEm: string;
  readonly versao: number;
}

export interface EquivalenciaSusNomeada extends EquivalenciaSus {
  readonly procedimentoNome: string | null;
  readonly tabela: string | null;
  readonly sigtapNome: string | null;
}

export interface FiltroEquivalenciasPorta {
  readonly termo?: string;
  readonly procedimento?: number;
  readonly inativas: boolean;
  readonly pagina: number;
  readonly porPagina: number;
}

// ── AIH, faixa e retorno ─────────────────────────────────────────────────────────────────────────────────

export interface FaixaAih {
  readonly id: number;
  /** Base de 12 dígitos (sem o dígito), como texto: o número não cabe com folga no número do JavaScript. */
  readonly inicio: string;
  readonly fim: string;
  readonly orgaoEmissor: string;
  readonly dataLiberacao: string;
  readonly situacao: 'ativa' | 'esgotada' | 'cancelada';
  readonly justificativa: string | null;
  readonly usados: number;
  readonly registradaPor: string;
  readonly registradaEm: string;
  readonly versao: number;
}

export type SituacaoAih =
  'solicitada' | 'autorizada' | 'negada' | 'fechada' | 'apresentada' | 'aprovada' | 'rejeitada' | 'cancelada';

export interface AihRegistro {
  readonly id: number;
  readonly situacao: SituacaoAih;
  readonly registro: number;
  readonly prontuario: number | null;
  readonly conta: number | null;
  readonly atendimento: number | null;
  readonly procedimentoSolicitado: string;
  readonly procedimentoRealizado: string | null;
  readonly cidPrincipal: string;
  readonly cidSecundario: string | null;
  readonly carater: string;
  readonly solicitante: string;
  readonly dataLaudo: string;
  readonly justificativa: string;
  readonly faixa: number | null;
  readonly numero: string | null;
  /** Só para o arquivo (o CNS do autorizador do gestor). */
  readonly cnsAutorizador: string | null;
  readonly dataAutorizacao: string | null;
  readonly fechamento: number;
  readonly permanencia: number | null;
  readonly diariasUti: number | null;
  readonly diariasUtiAnterior: number | null;
  readonly competenciaApresentacao: string | null;
  readonly arquivo: number | null;
  readonly reapresentacoes: number;
  readonly justificativaSituacao: string | null;
  readonly registradaPor: string;
  readonly registradaEm: string;
  readonly alteradaPor: string | null;
  readonly alteradaEm: string | null;
  readonly versao: number;
}

export interface FiltroAihsPorta {
  readonly situacao?: SituacaoAih;
  readonly numero?: string;
  readonly prontuario?: number;
  readonly registro?: number;
  readonly pagina: number;
  readonly porPagina: number;
}

export interface ItemAihParaGravar {
  readonly tipo: 'principal' | 'secundario' | 'especial' | 'opm' | 'diaria-uti';
  readonly procedimento: string;
  readonly sigtap: number | null;
  readonly quantidade: number;
  readonly cbo: string | null;
  readonly item: number | null;
  readonly tipoUti: number | null;
  readonly opm: {
    readonly cnpjFornecedor: string;
    readonly notaFiscal: string;
    readonly registroAnvisa: string;
    readonly serie: string;
    readonly lote: string;
  } | null;
}

export interface ItemAih extends ItemAihParaGravar {
  readonly sequencia: number;
}

export interface RetornoSus {
  readonly id: number;
  readonly instrumento: 'aih' | 'bpa';
  readonly competencia: string;
  readonly identificacao: string;
  readonly procedimento: string | null;
  readonly aih: number | null;
  readonly linhaBpa: number | null;
  readonly arquivo: number | null;
  readonly situacao: 'aprovada' | 'rejeitada' | 'glosada';
  readonly motivo: string | null;
  readonly valorApresentado: number | null;
  readonly valorAprovado: number | null;
  readonly valorGlosado: number;
  readonly arquivoRetorno: string;
  readonly hashRetorno: string;
  readonly tratamento: 'pendente' | 'reapresentar' | 'aceita';
  readonly justificativa: string | null;
  readonly importadoPor: string;
  readonly importadoEm: string;
  readonly tratadoPor: string | null;
  readonly tratadoEm: string | null;
  readonly versao: number;
}

export interface RetornoSusParaGravar {
  readonly instrumento: 'aih' | 'bpa';
  readonly competencia: string;
  readonly identificacao: string;
  readonly procedimento: string | null;
  readonly aih: number | null;
  readonly linhaBpa: number | null;
  readonly arquivo: number | null;
  readonly situacao: 'aprovada' | 'rejeitada' | 'glosada';
  readonly motivo: string | null;
  readonly valorApresentado: number | null;
  readonly valorAprovado: number | null;
  readonly valorGlosado: number;
  readonly arquivoRetorno: string;
  readonly hashRetorno: string;
  readonly por: string;
}

export interface FiltroRetornosPorta {
  readonly instrumento?: 'aih' | 'bpa';
  readonly competencia?: string;
  readonly situacao?: 'aprovada' | 'rejeitada' | 'glosada';
  readonly tratamento?: 'pendente' | 'reapresentar' | 'aceita';
  readonly pagina: number;
  readonly porPagina: number;
}

// ── APAC ─────────────────────────────────────────────────────────────────────────────────────────────────

export type SituacaoApac = 'solicitada' | 'autorizada' | 'negada' | 'encerrada' | 'cancelada';

export interface LaudoNefrologiaApac {
  readonly caracteristicaTratamento: number;
  readonly contraindicacaoTransplante: number;
  readonly situacaoTransplante: number;
  readonly acessoVascular: number;
  readonly inicioTratamento: string;
}

export interface ApacRegistro {
  readonly id: number;
  readonly situacao: SituacaoApac;
  readonly paciente: number;
  readonly prontuario: number | null;
  readonly registro: number;
  readonly atendimento: number | null;
  readonly sigtap: number;
  readonly procedimento: string;
  readonly cidPrincipal: string;
  readonly cidSecundario: string | null;
  readonly cidAssociado: string | null;
  readonly solicitante: string;
  readonly dataSolicitacao: string;
  readonly justificativa: string;
  readonly laudoEspecifico: 'nenhum' | 'nefrologia';
  readonly nefrologia: LaudoNefrologiaApac | null;
  readonly numero: string | null;
  readonly tipo: 'inicial' | 'unica' | null;
  readonly autorizador: string | null;
  readonly dataAutorizacao: string | null;
  readonly competenciaInicial: string | null;
  readonly competenciaFinal: string | null;
  readonly ultimaCompetencia: string | null;
  readonly motivoSaida: string | null;
  readonly dataEncerramento: string | null;
  readonly justificativaSituacao: string | null;
  readonly registradaPor: string;
  readonly registradaEm: string;
  readonly alteradaPor: string | null;
  readonly alteradaEm: string | null;
  readonly versao: number;
}

export interface FiltroApacsPorta {
  readonly situacao?: SituacaoApac;
  readonly numero?: string;
  readonly prontuario?: number;
  readonly competencia?: string;
  readonly pagina: number;
  readonly porPagina: number;
}

export interface NovaApac {
  readonly paciente: number;
  readonly prontuario: number | null;
  readonly registro: number;
  readonly atendimento: number | null;
  readonly sigtap: number;
  readonly procedimento: string;
  readonly cidPrincipal: string;
  readonly cidSecundario: string | null;
  readonly cidAssociado: string | null;
  readonly solicitante: string;
  readonly dataSolicitacao: string;
  readonly justificativa: string;
  readonly nefrologia: LaudoNefrologiaApac | null;
  readonly por: string;
}

/** A mudança de uma APAC (o domínio já conferiu a transição): só os campos da ação, na versão lida. */
export type MudancaApac =
  | {
      readonly acao: 'autorizar';
      readonly numero: string;
      readonly tipo: 'inicial' | 'unica';
      readonly autorizador: string;
      readonly dataAutorizacao: string;
      readonly competenciaInicial: string;
      readonly competenciaFinal: string;
    }
  | { readonly acao: 'negar' | 'cancelar'; readonly justificativa: string }
  | { readonly acao: 'continuar'; readonly ultimaCompetencia: string }
  | {
      /** A correção do laudo da solicitada: só o transcrito; atendimento e procedimento ficam. */
      readonly acao: 'corrigir';
      readonly cidPrincipal: string;
      readonly cidSecundario: string | null;
      readonly cidAssociado: string | null;
      readonly solicitante: string;
      readonly dataSolicitacao: string;
      readonly justificativa: string;
      readonly nefrologia: LaudoNefrologiaApac | null;
    }
  | {
      readonly acao: 'encerrar';
      readonly motivo: string;
      readonly dataEncerramento: string;
      readonly ultimaCompetencia: string;
    };

export interface LinhaApacParaGravar {
  readonly apac: number;
  readonly tipoNoArquivo: '1' | '2' | '3';
  readonly procedimento: string;
  readonly principal: boolean;
  readonly cbo: string;
  readonly quantidade: number;
  readonly conta: number | null;
}

export interface LinhaApac extends LinhaApacParaGravar {
  readonly id: number;
  readonly numero: string;
}

// ── BPA ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface LinhaBpaParaGravar {
  readonly tipo: 'c' | 'i';
  readonly folha: number;
  readonly sequencia: number;
  readonly procedimento: string;
  readonly cbo: string;
  readonly idade: number | null;
  readonly quantidade: number;
  /** AAAA-MM-DD (só no individualizado). */
  readonly data: string | null;
  readonly conta: number | null;
  readonly atendimento: number | null;
  readonly registro: number | null;
}

export interface LinhaBpa {
  readonly id: number;
  readonly tipo: 'c' | 'i';
  readonly folha: number;
  readonly sequencia: number;
  readonly procedimento: string;
  readonly cbo: string;
  readonly idade: number | null;
  readonly quantidade: number;
  readonly data: string | null;
  readonly conta: number | null;
  readonly atendimento: number | null;
}

export interface FiltroLinhasBpaPorta {
  readonly arquivo: number;
  readonly tipo?: 'c' | 'i';
  readonly procedimento?: string;
  readonly pagina: number;
  readonly porPagina: number;
}
