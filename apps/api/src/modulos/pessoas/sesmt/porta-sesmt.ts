// Porta do SESMT, fatia F5 (M52.5; ficha, seções 4 a 6): o que as telas do SESMT leem e gravam, independente de onde
// (a API não escreve SQL; fronteira Nx). O colaborador vem da porta da gestão de pessoas (vinculo_trabalho); aqui ficam o
// prontuário ocupacional (ASO e exames), as vacinas, os acidentes (comunicação e exposição a material biológico), o mapa
// de riscos, as entregas de EPI e os domínios do eSocial:
//   - `banco`: a porta própria sobre o MariaDB do cliente (porta-sesmt-propria.ts), gravações pelo Executor;
//   - `memoria`: a sessão sintética de dev/ci (E2E), com os domínios sintéticos;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
// Regra 16: nenhuma leitura do PEP passa por aqui, e o PEP não lê nada daqui.
// Melhoria: tipos de negócio do próprio módulo (booleano, data ISO, id numérico), sem estabelecimento em texto: o
// estabelecimento é o da sessão (ContextoNucleo).
import type { ContextoPortaM18, PortaGravacaoM18 } from '../../exames/public-api.js';

export const PORTA_SESMT = Symbol('PORTA_SESMT');

export type ContextoSesmt = ContextoPortaM18;

/** Opção de domínio com código numérico (código público do eSocial ou id do cadastro). */
export interface OpcaoDominioSesmt {
  readonly codigo: number;
  readonly rotulo: string;
}

/** Opção de domínio com código em texto (fator de risco da tabela 24 do eSocial, grupo de risco). */
export interface OpcaoDominioSesmtTexto {
  readonly codigo: string;
  readonly rotulo: string;
}

export interface DominiosSesmt {
  readonly tiposAso: OpcaoDominioSesmt[];
  readonly conclusoesAso: OpcaoDominioSesmt[];
  readonly tiposCat: OpcaoDominioSesmt[];
  readonly iniciativasCat: OpcaoDominioSesmt[];
  readonly partesCorpo: OpcaoDominioSesmt[];
  readonly naturezas: OpcaoDominioSesmt[];
  readonly agentes: OpcaoDominioSesmt[];
  readonly situacoes: OpcaoDominioSesmt[];
  readonly gruposRisco: OpcaoDominioSesmtTexto[];
  readonly eficaciasEpc: OpcaoDominioSesmt[];
  readonly vacinasCadastro: OpcaoDominioSesmt[];
  readonly dosesVacinaCadastro: OpcaoDominioSesmt[];
}

/** ASO ou exame do prontuário ocupacional. */
export interface RegistroOcupacional {
  readonly id: number;
  readonly vinculo: number;
  readonly registro: 'aso' | 'exame';
  readonly aso: number | null;
  readonly tipo: number | null;
  readonly data: string;
  readonly exame: string | null;
  readonly resultadoExame: 'normal' | 'alterado' | null;
  readonly conclusao: number | null;
  readonly restricoes: string | null;
  readonly medico: string | null;
  readonly medicoConselho: string | null;
  readonly proximo: string | null;
  readonly observacao: string | null;
  readonly retifica: number | null;
  readonly motivoRetificacao: string | null;
  readonly criadoPor: string;
  readonly criadoEm: string;
}

/** Dose de vacina (ou anti-HBs) do colaborador. */
export interface DoseVacinaColaborador {
  readonly id: number;
  readonly vinculo: number;
  readonly registro: 'dose' | 'anti-hbs';
  readonly vacina: string;
  readonly dose: string | null;
  readonly data: string;
  readonly lote: string | null;
  readonly validadeLote: string | null;
  readonly antiHbs: number | null;
  readonly observacao: string | null;
  readonly retifica: number | null;
  readonly motivoRetificacao: string | null;
  readonly criadoPor: string;
}

/** Dados da CAT (S-2210) que acompanham o acidente. */
export interface DadosCat {
  readonly horasAntes: string | null;
  readonly lateralidade: number | null;
  readonly comunicouPolicia: boolean;
  readonly dataObito: string | null;
  readonly ultimoDiaTrabalhado: string | null;
  readonly observacao: string | null;
  readonly reciboOrigem: string | null;
  readonly localTipo: number | null;
  readonly logradouro: string | null;
  readonly numero: string | null;
  readonly cep: string | null;
  readonly municipio: string | null;
  readonly uf: string | null;
  readonly atestadoData: string | null;
  readonly atestadoHora: string | null;
  readonly internacao: boolean;
  readonly duracaoDias: number | null;
  readonly complementoLesao: string | null;
  readonly diagnostico: string | null;
  readonly cid: string | null;
  readonly emitenteNome: string | null;
  readonly emitenteConselho: number | null;
  readonly emitenteNumero: string | null;
  readonly emitenteUf: string | null;
}

export const DADOS_CAT_VAZIOS: DadosCat = {
  horasAntes: null,
  lateralidade: null,
  comunicouPolicia: false,
  dataObito: null,
  ultimoDiaTrabalhado: null,
  observacao: null,
  reciboOrigem: null,
  localTipo: null,
  logradouro: null,
  numero: null,
  cep: null,
  municipio: null,
  uf: null,
  atestadoData: null,
  atestadoHora: null,
  internacao: false,
  duracaoDias: null,
  complementoLesao: null,
  diagnostico: null,
  cid: null,
  emitenteNome: null,
  emitenteConselho: null,
  emitenteNumero: null,
  emitenteUf: null,
};

/** Acidente de trabalho, com a exposição a material biológico, a profilaxia e a CAT. */
export interface AcidenteTrabalho {
  readonly id: number;
  readonly vinculo: number;
  readonly ocorridoEm: string;
  readonly tipo: string;
  readonly unidade: number | null;
  readonly local: string;
  readonly descricao: string;
  readonly biologico: boolean;
  readonly perfurocortante: boolean;
  readonly exposicao: string | null;
  readonly material: string | null;
  readonly fonte: string | null;
  readonly fonteTeste: string | null;
  readonly parteCorpo: number | null;
  readonly natureza: number | null;
  readonly agente: number | null;
  readonly situacao: number | null;
  readonly afastamento: boolean;
  readonly obito: boolean;
  readonly profilaxia: string;
  readonly profilaxiaEm: string | null;
  readonly profilaxiaObs: string | null;
  readonly catPrazo: string;
  readonly tipoCat: number | null;
  readonly iniciativaCat: number | null;
  readonly catNumero: string | null;
  readonly catEmitidaEm: string | null;
  readonly catEmitidaPor: string | null;
  readonly estado: 'aberto' | 'encerrado';
  readonly encerradoEm: string | null;
  readonly encerradoPor?: string | null;
  readonly motivoEncerramento: string | null;
  readonly versao: number;
  readonly criadoPor: string;
  readonly cat: DadosCat;
  readonly anuladoEm: string | null;
  readonly anuladoPor: string | null;
}

/** Marco do acompanhamento sorológico depois do acidente com material biológico. */
export interface SorologiaAcidente {
  readonly id: number;
  readonly acidente: number;
  readonly marco: string;
  readonly prevista: string;
  readonly realizada: string | null;
  readonly resultado: string | null;
  readonly observacao: string | null;
}

/** Linha do mapa de riscos (fator de risco ou EPI exigido da função). */
export interface LinhaRiscoFuncao {
  readonly id: number;
  readonly unidade: number | null;
  readonly setor: string | null;
  readonly funcao: string;
  readonly funcaoChave: string;
  readonly tipo: 'risco' | 'epi';
  readonly fatorRisco: string | null;
  readonly grupoRisco: string | null;
  readonly epc: number | null;
  readonly epi: string | null;
  readonly descricao: string | null;
  readonly inicio: string;
  readonly fim: string | null;
  readonly motivoFim: string | null;
}

/** Entrega de EPI, leitura de dosímetro ou exposição a quimioterápico. */
export interface RegistroProtecao {
  readonly id: number;
  readonly vinculo: number;
  readonly tipo: 'epi' | 'dosimetria' | 'quimio';
  readonly data: string;
  readonly epi: string | null;
  readonly caNumero: string | null;
  readonly caValidade: string | null;
  readonly quantidade: number | null;
  readonly assinatura: 'pendente' | 'assinada' | null;
  readonly assinadaEm: string | null;
  readonly periodoInicio: string | null;
  readonly doseMsv: number | null;
  readonly dosimetro: string | null;
  readonly agente: string | null;
  readonly duracaoMin: number | null;
  readonly observacao: string | null;
  readonly criadoPor: string;
  readonly canceladoEm: string | null;
  readonly canceladoPor: string | null;
  readonly motivoCancelamento: string | null;
}

/** Retificação de um registro do SESMT: o valor anterior e o novo, com o motivo (W0-06). */
export interface CorrecaoSesmt {
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

export interface VinculoAtivoSesmt {
  readonly id: number;
  readonly nome: string;
  readonly matricula: string | null;
  readonly cargo: string;
  readonly funcao: string | null;
  readonly unidade: number | null;
  readonly setor: string | null;
  readonly admissao: string;
}

export interface ResumoSesmt {
  readonly vinculos: VinculoAtivoSesmt[];
  readonly asos: RegistroOcupacional[];
  readonly vacinas: DoseVacinaColaborador[];
  readonly epis: RegistroProtecao[];
  readonly acidentes: AcidenteTrabalho[];
  readonly sorologias: SorologiaAcidente[];
}

// ── Entradas das gravações (o estabelecimento e o usuário vêm do contexto; `por` é o login para a memória) ──────

export interface NovoAso {
  readonly vinculo: number;
  readonly tipo: number;
  readonly data: string;
  readonly conclusao: number;
  readonly restricoes: string | null;
  readonly medico: string;
  readonly medicoConselho: string | null;
  readonly proximo: string | null;
  readonly observacao: string | null;
  readonly retifica: number | null;
  readonly motivoRetificacao: string | null;
  readonly por: string;
}

export interface NovoExameOcupacional {
  readonly vinculo: number;
  readonly aso: number;
  readonly exame: string;
  readonly data: string;
  readonly resultado: 'normal' | 'alterado';
  readonly por: string;
}

export interface NovaVacina {
  readonly vinculo: number;
  readonly registro: 'dose' | 'anti-hbs';
  readonly vacina: string;
  /** Vacina do cadastro (dominios.vacinasCadastro) casada pela descrição; null sem casamento único. */
  readonly codigoVacina: number | null;
  readonly dose: string | null;
  readonly codigoDose: number | null;
  readonly data: string;
  readonly lote: string | null;
  readonly validadeLote: string | null;
  readonly antiHbs: number | null;
  readonly observacao: string | null;
  readonly retifica: number | null;
  readonly motivoRetificacao: string | null;
  readonly por: string;
}

export interface NovoAcidente {
  readonly vinculo: number;
  readonly ocorridoEm: string;
  readonly tipo: string;
  readonly unidade: number | null;
  readonly local: string;
  readonly descricao: string;
  readonly biologico: boolean;
  readonly perfurocortante: boolean;
  readonly exposicao: string | null;
  readonly material: string | null;
  readonly fonte: string | null;
  readonly fonteTeste: string | null;
  readonly parteCorpo: number | null;
  readonly natureza: number | null;
  readonly agente: number | null;
  readonly situacao: number | null;
  readonly afastamento: boolean;
  readonly obito: boolean;
  readonly profilaxia: string;
  readonly profilaxiaEm: string | null;
  readonly profilaxiaObs: string | null;
  readonly catPrazo: string;
  readonly por: string;
}

export interface AtualizacaoProfilaxia {
  readonly id: number;
  readonly versao: number;
  readonly profilaxia: string;
  readonly profilaxiaEm: string | null;
  readonly observacao: string | null;
  readonly por: string;
}

export interface RegistroResultadoSorologia {
  readonly acidente: number;
  readonly marco: string;
  readonly realizada: string | null;
  readonly resultado: string;
  readonly observacao: string | null;
  readonly por: string;
}

export interface EmissaoCat {
  readonly id: number;
  readonly versao: number;
  readonly tipoCat: number;
  readonly iniciativa: number | null;
  readonly numero: string;
  readonly emitidaEm: string;
  readonly por: string;
}

export interface EncerramentoAcidente {
  readonly id: number;
  readonly versao: number;
  readonly motivo: string;
  readonly por: string;
}

export interface DadosAcidenteRetificaveis {
  readonly ocorridoEm: string;
  readonly tipo: string;
  readonly local: string;
  readonly descricao: string;
  readonly parteCorpo: number | null;
  readonly natureza: number | null;
  readonly agente: number | null;
  readonly situacao: number | null;
  readonly afastamento: boolean;
  readonly obito: boolean;
  readonly catPrazo: string;
  readonly cat: DadosCat;
}

export interface RetificacaoAcidente extends DadosAcidenteRetificaveis {
  readonly id: number;
  readonly versao: number;
  readonly por: string;
}

export interface AnulacaoAcidente {
  readonly id: number;
  readonly versao: number;
  readonly motivo: string;
  readonly por: string;
}

export interface CancelamentoProtecao {
  readonly id: number;
  readonly motivo: string;
  readonly por: string;
}

export interface NovaLinhaRisco {
  readonly unidade: number | null;
  readonly setor: string | null;
  readonly funcao: string;
  readonly funcaoChave: string;
  readonly tipo: 'risco' | 'epi';
  readonly fatorRisco: string | null;
  readonly grupoRisco: string | null;
  readonly epc: number | null;
  readonly epi: string | null;
  readonly descricao: string | null;
  readonly inicio: string;
  readonly por: string;
}

export interface NovoRegistroProtecao {
  readonly vinculo: number;
  readonly tipo: 'epi' | 'dosimetria' | 'quimio';
  readonly data: string;
  readonly epi: string | null;
  readonly caNumero: string | null;
  readonly caValidade: string | null;
  readonly quantidade: number | null;
  readonly periodoInicio: string | null;
  readonly doseMsv: number | null;
  readonly dosimetro: string | null;
  readonly agente: string | null;
  readonly duracaoMin: number | null;
  readonly observacao: string | null;
  readonly por: string;
}

export interface FiltroAcidentesPorta {
  readonly estado: 'aberto' | 'encerrado' | 'todos';
  readonly vinculo?: number;
  readonly depois?: number;
  readonly limite: number;
}

export interface FiltroRiscosPorta {
  readonly funcaoChave?: string;
  readonly unidade?: number;
  readonly vigentes: boolean;
}

/** As gravações do SESMT numa transação só (operação do Executor), com as releituras dentro dela. */
export interface GravadorSesmt {
  ocupacional(vinculo: number): Promise<RegistroOcupacional[]>;
  vacinas(vinculo: number): Promise<DoseVacinaColaborador[]>;
  acidente(id: number): Promise<AcidenteTrabalho | null>;
  sorologias(acidente: number): Promise<SorologiaAcidente[]>;
  registroEpi(id: number): Promise<RegistroProtecao | null>;
  incluirAso(a: NovoAso): Promise<number>;
  incluirExame(x: NovoExameOcupacional): Promise<number>;
  incluirVacina(v: NovaVacina): Promise<number>;
  incluirAcidente(a: NovoAcidente): Promise<number>;
  incluirSorologia(x: { acidente: number; marco: string; prevista: string }): Promise<number>;
  atualizarProfilaxia(x: AtualizacaoProfilaxia): Promise<void>;
  registrarSorologia(x: RegistroResultadoSorologia): Promise<number>;
  emitirCat(x: EmissaoCat): Promise<void>;
  encerrarAcidente(x: EncerramentoAcidente): Promise<void>;
  incluirLinhaRisco(x: NovaLinhaRisco): Promise<number>;
  encerrarLinhaRisco(x: { id: number; fim: string; motivo: string; por: string }): Promise<void>;
  incluirRegistroEpi(x: NovoRegistroProtecao): Promise<number>;
  assinarEntregaEpi(x: { id: number; por: string }): Promise<void>;
  // W0-06 (1063): retificação e anulação do acidente, cancelamento da entrega, com o valor anterior registrado.
  retificarAcidente(x: RetificacaoAcidente): Promise<void>;
  anularAcidente(x: AnulacaoAcidente): Promise<void>;
  cancelarEntregaEpi(x: CancelamentoProtecao): Promise<void>;
  registrarCorrecao(x: {
    tabela: string;
    registro: number;
    operacao: string;
    antes: Record<string, unknown>;
    depois: Record<string, unknown>;
    motivo: string;
    por: string;
  }): Promise<void>;
}

export interface PortaSesmt extends PortaGravacaoM18<GravadorSesmt> {
  relogio(c: ContextoSesmt): Promise<{ hoje: string; agora: string }>;
  dominios(c: ContextoSesmt): Promise<DominiosSesmt>;
  fatoresRisco(c: ContextoSesmt, termo: string): Promise<OpcaoDominioSesmtTexto[]>;
  fatoresPorCodigo(c: ContextoSesmt, codigos: readonly string[]): Promise<Map<string, string>>;
  ocupacional(c: ContextoSesmt, vinculo: number): Promise<RegistroOcupacional[]>;
  vacinas(c: ContextoSesmt, vinculo: number): Promise<DoseVacinaColaborador[]>;
  acidente(c: ContextoSesmt, id: number): Promise<AcidenteTrabalho | null>;
  listarAcidentes(
    c: ContextoSesmt,
    f: FiltroAcidentesPorta,
  ): Promise<{ itens: AcidenteTrabalho[]; depois: number | null }>;
  sorologias(c: ContextoSesmt, acidentes: readonly number[]): Promise<SorologiaAcidente[]>;
  mapaRiscos(c: ContextoSesmt, f: FiltroRiscosPorta): Promise<LinhaRiscoFuncao[]>;
  registrosEpi(c: ContextoSesmt, vinculo: number): Promise<RegistroProtecao[]>;
  registroEpi(c: ContextoSesmt, id: number): Promise<RegistroProtecao | null>;
  resumo(c: ContextoSesmt, ano: number): Promise<ResumoSesmt>;
  /** W0-06: o histórico de retificações (o valor anterior e o novo) dos registros de uma tabela do SESMT. */
  correcoes(c: ContextoSesmt, tabela: string, registros: readonly number[]): Promise<CorrecaoSesmt[]>;
}

export const METODOS_PORTA_SESMT: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'relogio',
  'dominios',
  'fatoresRisco',
  'fatoresPorCodigo',
  'ocupacional',
  'vacinas',
  'acidente',
  'listarAcidentes',
  'sorologias',
  'mapaRiscos',
  'registrosEpi',
  'registroEpi',
  'resumo',
  'correcoes',
]);
