// Tipos de negócio da qualidade (M48: notificação de incidentes, CCIH, notificação compulsória, gestão da qualidade e
// revisão de prontuários), usados pelas portas, pela memória de dev/ci e pela porta própria sobre o MariaDB.
// Vocabulário neutro: booleano, data e instante ISO local (`AAAA-MM-DDTHH:mm:ss`), id numérico e número de negócio.
// Os logins (`usuario`, `por`, `registradaPor`...) são o login da conta do cliente; a porta própria resolve o id.
// Melhoria: os tipos são do próprio módulo (antes, os do acesso ao sistema de origem), sem o campo `hospital` (o
// estabelecimento vem do contexto da sessão) e com as tabelas corrigíveis nomeadas pelas tabelas do modelo próprio.
import type {
  ChaveLeito,
  FichaIndicadorQualidade,
  Precaucao,
  RegistroVersionadoQualidade,
} from '@sgh/contratos';
import { type ErroOperacao, recusa } from '@sgh/nucleo';

/** As tabelas da qualidade que se corrigem por versão (o retrato anterior vai à trilha de auditoria). */
export const TABELAS_CORRIGIVEIS = [
  'dispositivo_invasivo_paciente',
  'caso_infeccao',
  'isolamento_paciente',
  'observacao_higiene_maos',
  'auditoria_interna',
  'reuniao_comissao',
  'nao_conformidade_qualidade',
  'manifestacao_ouvidoria',
  'fechamento_vigilancia_iras',
  'comissao_hospitalar',
  'verificacao_bundle',
  'modelo_checklist_qualidade_versao',
  'sorteio_revisao_prontuario',
  'revisao_prontuario',
  'pendencia_prontuario',
] as const;
export type TabelaCorrigivel = (typeof TABELAS_CORRIGIVEIS)[number];

/** A tabela do modelo próprio de cada registro versionado da tela (a chave da rota). */
export const TABELA_DO_REGISTRO: Readonly<Record<RegistroVersionadoQualidade, TabelaCorrigivel>> = {
  dispositivo: 'dispositivo_invasivo_paciente',
  iras: 'caso_infeccao',
  precaucao: 'isolamento_paciente',
  'observacao-maos': 'observacao_higiene_maos',
  auditoria: 'auditoria_interna',
  reuniao: 'reuniao_comissao',
  'nao-conformidade': 'nao_conformidade_qualidade',
  manifestacao: 'manifestacao_ouvidoria',
  competencia: 'fechamento_vigilancia_iras',
  'revisao-prontuario': 'revisao_prontuario',
  'sorteio-revisao': 'sorteio_revisao_prontuario',
  'pendencia-revisao': 'pendencia_prontuario',
  bundle: 'verificacao_bundle',
  comissao: 'comissao_hospitalar',
  'checklist-revisao': 'modelo_checklist_qualidade_versao',
};

/** A linha de notificacao_incidente como a API usa (vocabulários dos contratos; instantes locais). */
export interface NotificacaoRegistrada {
  readonly id: number;
  readonly protocolo: string;
  readonly codigoResumo: string;
  readonly notificadaEm: string;
  readonly ocorridoEm: string;
  readonly atendimento: number | null;
  readonly paciente: number | null;
  readonly unidade: number | null;
  readonly leito: string | null;
  readonly local: string | null;
  readonly tipo: string;
  readonly tipoOutro: string | null;
  readonly chegouAoPaciente: boolean;
  readonly danoPercebido: string;
  readonly classificacao: string;
  readonly dano: string;
  readonly neverEvent: boolean;
  readonly descricao: string;
  readonly anonima: boolean;
  readonly notificador: string | null;
  readonly origemTela: string | null;
  readonly origemSugestao: string | null;
  readonly situacao: string;
  readonly triada: boolean;
  readonly versao: number;
  readonly gestor: string | null;
  readonly unidadeAnalise: number | null;
  readonly prazoAnalise: string | null;
  readonly motivoDescarte: string | null;
  readonly duplicadaDe: string | null;
  readonly notivisaExportadaEm: string | null;
  readonly notivisaNumero: string | null;
  readonly notivisaTranscritaEm: string | null;
  readonly analiseConcluidaEm: string | null;
}

export interface EventoNotificacaoRegistrado {
  readonly tipo: string;
  readonly em: string;
  readonly por: string;
  readonly texto: string | null;
  readonly dados: string | null;
}

/** Um evento da linha do tempo. `por`: o login, ou 'anonimo' no evento "recebida" da anônima. */
export interface EventoNotificacaoNovo {
  readonly tipo:
    | 'recebida'
    | 'triada'
    | 'reclassificada'
    | 'distribuida'
    | 'devolutiva'
    | 'descartada'
    | 'notivisaExportada'
    | 'notivisaTranscrita'
    | 'analiseIniciada'
    | 'analiseConcluida';
  readonly por: string;
  readonly texto?: string | null;
  /** JSON curto do antes e depois (classificação, gestor, prazo); sem dado de pessoa. */
  readonly dados?: Readonly<Record<string, unknown>> | null;
}

export interface NotificacaoIncidenteNova {
  /** Instante local da notificação (o relógio do servidor). */
  readonly agora: string;
  /** Monta o protocolo pelo ano e pelo sequencial (`formatarProtocolo` do domínio). */
  readonly protocoloDe: (ano: number, sequencial: number) => string;
  /** SHA-256 (hex) do código de acompanhamento; o código não é guardado. */
  readonly codigoResumo: string;
  /** SHA-256 (hex) da chave de idempotência do pedido (gerada ao acaso pelo diálogo), ou null. */
  readonly chaveResumo: string | null;
  readonly ocorridoEm: string;
  readonly atendimento: number | null;
  readonly paciente: number | null;
  readonly unidade: number | null;
  readonly leito: string | null;
  readonly local: string | null;
  readonly tipo: string;
  readonly tipoOutro: string | null;
  readonly chegouAoPaciente: boolean;
  readonly danoPercebido: string;
  /** A proposta de classificação (o NSP confirma ou corrige na triagem). */
  readonly classificacao: string;
  readonly descricao: string;
  readonly anonima: boolean;
  /** O login de quem notificou; ignorado (gravado nulo) quando é anônima. */
  readonly notificador: string;
  readonly origemTela: string | null;
  readonly origemSugestao: string | null;
}

/** Filtros da lista do NSP que o banco aplica (o de prazo é calculado na API sobre a fila de prazos). */
export interface FiltroNotificacoes {
  readonly situacao?: string;
  /** Uma das situações (SITUACAO IN): a lista das análises sem filtro pede as três situações da análise. */
  readonly situacoes?: readonly string[];
  readonly tipo?: string;
  readonly classificacao?: string;
  readonly unidade?: number;
  /** AAAA-MM-DD, pela data da notificação. */
  readonly de?: string;
  readonly ate?: string;
  readonly protocolo?: string;
  /** Só as distribuídas a este gestor da área (o login, em maiúsculas como a distribuição grava; regra 1). */
  readonly gestor?: string;
  readonly ids?: readonly number[];
  readonly pagina: number;
  readonly porPagina: number;
}

export interface ContagemNotificacoes {
  readonly tipo: string;
  readonly classificacao: string;
  readonly dano: string;
  readonly neverEvent: boolean;
  readonly situacao: string;
  readonly anonima: boolean;
  readonly quantidade: number;
}

export interface AnaliseNova {
  readonly notificacao: number;
  /** A versão da notificação travada (a mudança de situação confere de novo no UPDATE). */
  readonly versaoNotificacao: number;
  /** A análise atual (null: INSERT) e a versão dela que a tela leu. */
  readonly atual: { readonly id: number; readonly versao: number } | null;
  readonly metodo: string;
  /** O conteúdo já serializado (JSON conferido pelo esquema; teto de 6.000). */
  readonly conteudo: string;
  readonly causaRaiz: string | null;
  readonly fatores: readonly string[];
  readonly licoes: string | null;
  readonly semAcaoJustificativa: string | null;
  readonly concluir: boolean;
  readonly eventos: readonly ('analiseIniciada' | 'analiseConcluida')[];
  readonly situacaoNotificacao: string | null;
  readonly usuario: string;
  readonly agora: string;
}

/** A linha de analise_incidente (o conteúdo como o JSON gravado; a API confere pelo esquema). */
export interface AnaliseRegistrada {
  readonly id: number;
  readonly notificacao: number;
  readonly metodo: string;
  readonly conteudo: string;
  readonly causaRaiz: string | null;
  readonly fatores: readonly string[];
  readonly licoes: string | null;
  readonly semAcaoJustificativa: string | null;
  readonly situacao: string;
  readonly versao: number;
  readonly registradaPor: string;
  readonly registradaEm: string;
  readonly atualizadaEm: string | null;
  readonly concluidaEm: string | null;
  readonly concluidaPor: string | null;
}

export interface Acao5w2h {
  readonly oQue: string;
  readonly porQue: string;
  readonly onde: string;
  readonly quando: string;
  readonly quem: string;
  readonly como: string;
  readonly quanto: string | null;
}

/** A linha de acao_plano_qualidade. */
export interface AcaoPlanoRegistrada {
  readonly id: number;
  readonly notificacao: number;
  readonly sequencia: number;
  readonly oQue: string;
  readonly porQue: string;
  readonly onde: string;
  readonly quando: string;
  readonly quem: string;
  readonly como: string;
  readonly quanto: string | null;
  readonly situacao: string;
  readonly texto: string | null;
  readonly concluidaEm: string | null;
  readonly eficacia: string | null;
  readonly eficaciaTexto: string | null;
  readonly eficaciaEm: string | null;
  readonly eficaciaPor: string | null;
  readonly versao: number;
  readonly criadaPor: string;
  readonly criadaEm: string;
}

export interface QueixaTecnicaNova {
  readonly area: string;
  readonly tipo: string;
  readonly item: number | null;
  readonly produto: string | null;
  readonly lote: string | null;
  readonly serie: string | null;
  readonly fabricante: string | null;
  readonly registroAnvisa: string | null;
  readonly descricao: string;
  readonly notificacao: number | null;
  readonly alerta: string | null;
  readonly conduta: string;
  readonly usuario: string;
  readonly agora: string;
}

export interface QueixaTecnicaRegistrada {
  readonly id: number;
  readonly area: string;
  readonly tipo: string;
  readonly item: number | null;
  readonly produto: string | null;
  readonly lote: string | null;
  readonly serie: string | null;
  readonly fabricante: string | null;
  readonly registroAnvisa: string | null;
  readonly descricao: string;
  readonly notificacao: number | null;
  readonly alerta: string | null;
  readonly conduta: string;
  readonly situacao: string;
  readonly notivisaNumero: string | null;
  readonly versao: number;
  readonly registradaPor: string;
  readonly registradaEm: string;
  readonly atualizadaEm: string | null;
  readonly encerradaEm: string | null;
}

export interface EventoQueixaRegistrado {
  readonly em: string;
  readonly por: string;
  readonly situacao: string;
  readonly conduta: string;
  readonly texto: string | null;
}

export interface VersaoProtocoloGerenciado {
  readonly id: number;
  readonly tipo: string;
  readonly versao: number;
  readonly nome: string;
  readonly notas: string;
  readonly autor: string;
  readonly aprovador: string;
  readonly publicadoEm: string;
  readonly impressao: string;
  readonly conteudo: unknown;
}

export interface ProtocoloDoPaciente {
  readonly id: number;
  readonly cabecalho: string;
  readonly reg: number;
  readonly paciente: number;
  readonly tipo: string;
  readonly gerenciado: number;
  readonly origem: 'enfermeiro' | 'medico' | 'sugerido';
  readonly sugeridoPor: string | null;
  readonly criterios: string[];
  readonly chegadaEm: string;
  readonly incluidoEm: string;
  readonly incluidoPor: string;
  readonly eventos: EventoProtocoloDoPaciente[];
}

export interface EventoProtocoloDoPaciente {
  readonly id: number;
  readonly tipo: 'meta' | 'checklist' | 'encerramento';
  readonly codigo: string;
  readonly situacao: string;
  readonly quando: string | null;
  readonly prazoEm: string | null;
  readonly motivo: string | null;
  readonly por: string;
  readonly em: string;
}

export interface CasoAgravoNovo {
  readonly origem: 'cid' | 'exame' | 'obito' | 'manual';
  /** Chave do gatilho (origem, referência e CID); nula no caso manual. */
  readonly chaveGatilho: string | null;
  readonly atendimento: number | null;
  readonly exame: number | null;
  readonly paciente: number;
  readonly cid: string;
  readonly periodicidade: 'imediata' | 'semanal';
  readonly gatilhoEm: string;
  readonly prazoEm: string;
  readonly fichaModelo: number | null;
  readonly observacao: string | null;
  readonly agora: string;
  readonly usuario: string;
}

export interface CasoAgravoRegistrado {
  readonly id: number;
  readonly origem: string;
  readonly chaveGatilho: string | null;
  readonly atendimento: number | null;
  readonly exame: number | null;
  readonly paciente: number;
  readonly cid: string;
  readonly periodicidade: string;
  readonly gatilhoEm: string;
  readonly prazoEm: string;
  readonly fichaModelo: number | null;
  readonly situacao: string;
  readonly observacao: string | null;
  readonly autoridade: string | null;
  readonly canal: string | null;
  readonly numero: string | null;
  readonly notificadoEm: string | null;
  readonly recebidoPor: string | null;
  readonly observacaoNotificacao: string | null;
  readonly motivoDescarte: string | null;
  readonly justificativa: string | null;
  readonly abertoPor: string;
  readonly abertoEm: string;
  readonly encerradoPor: string | null;
  readonly encerradoEm: string | null;
  readonly versao: number;
}

export interface FiltroCasosAgravo {
  readonly situacao?: string | undefined;
  readonly periodicidade?: string | undefined;
  /** Instantes locais do gatilho (`desde` inclusivo, `ate` exclusivo). */
  readonly desde?: string | undefined;
  readonly ate?: string | undefined;
  readonly pagina: number;
  readonly porPagina: number;
}

export interface GatilhoExameRegistrado {
  readonly id: number;
  readonly padrao: string;
  readonly exceto: string | null;
  readonly cid: string;
  readonly ativo: boolean;
  readonly versao: number;
}

export interface CidNotificavelCadastro {
  readonly cid: string;
  readonly nome: string;
  /** Valor do cadastro: 1 semanal, 2 imediata. */
  readonly codigoCadastro: number;
}

export interface AtendimentoComCid {
  readonly atendimento: number;
  readonly paciente: number;
  readonly unidade: number | null;
  readonly cid: string;
  readonly registradoEm: string;
}

export interface ObitoComCid {
  readonly atendimento: number;
  readonly paciente: number;
  readonly unidade: number | null;
  /** CIDs registrados no atendimento (principal e secundário), notificáveis ou não. */
  readonly cids: readonly string[];
  readonly obitoEm: string;
}

export interface PacienteDoAgravo {
  readonly id: number;
  readonly nome: string;
  readonly prontuario: number | null;
  readonly nascimento: string | null;
  readonly sexo: 'M' | 'F' | null;
  readonly mae: string | null;
  readonly cns: string | null;
}

export interface ResultadoCandidato {
  readonly exame: number;
  readonly atendimento: number;
  readonly paciente: number;
  readonly unidade: number | null;
  readonly nomeExame: string;
  readonly resultado: string;
  readonly liberadoEm: string;
}

export interface UnidadeDoAgravo {
  readonly codigo: number;
  readonly nome: string;
  readonly cnes: string | null;
  readonly cidade: string | null;
  readonly uf: string | null;
}

export interface AntimicrobianoPrescrito {
  readonly reg: number;
  readonly prescricao: number;
  /** O item da prescrição (a chave da liberação). */
  readonly itemPrescricao: number;
  /** O item do cadastro de produtos. */
  readonly item: number;
  readonly nome: string;
  readonly prescritoEm: string;
  readonly inicioVigencia: string;
  readonly fimVigencia: string | null;
  /** Suspensão da prescrição ou do item (o que vier primeiro). */
  readonly suspensoEm: string | null;
}

export interface CulturaDoPaciente {
  readonly id: number;
  readonly reg: number;
  readonly exame: string;
  /** Data civil do pedido (ou da coleta). */
  readonly data: string;
  readonly liberado: boolean;
}

export interface InternadoCcih {
  readonly reg: number;
  readonly pront: number;
  readonly paciente: number | null;
  readonly nome: string;
  readonly atendimento: number | null;
  readonly bloco: string;
  readonly acomodacao: string;
  readonly leito: string;
  /** Data civil da entrada. */
  readonly entrada: string;
  readonly aberta: boolean;
}

export interface DispositivoInvasivoNovo {
  readonly reg: number;
  readonly paciente: number | null;
  readonly leito: {
    readonly bloco: string;
    readonly acomodacao: string | null;
    readonly leito: string | null;
  };
  readonly tipo: string;
  readonly sitio: string | null;
  readonly inseridoEm: string;
  readonly itemPrescricao: number | null;
  readonly observacao: string | null;
  /** Revisão do W0-04 (1026): o profissional responsável pela inserção (registro e o nome lido na hora). */
  readonly responsavel?: { readonly registro: number; readonly nome: string } | null;
  readonly usuario: string;
}

export interface DispositivoInvasivoRegistrado {
  readonly id: number;
  readonly reg: number;
  readonly paciente: number | null;
  readonly setor: string;
  readonly acomodacao: string | null;
  readonly leito: string | null;
  readonly tipo: string;
  readonly sitio: string | null;
  readonly inseridoEm: string;
  readonly itemPrescricao: number | null;
  readonly observacao: string | null;
  readonly retiradoEm: string | null;
  readonly motivoRetirada: string | null;
  readonly registradoPor: string;
  readonly versao: number;
  /** W0-04: o cancelamento lógico (lançado errado); o cancelado fica visível como inativo. */
  readonly canceladoEm?: string | null;
  readonly motivoCancelamento?: string | null;
  /** Revisão do W0-04 (1026): o profissional responsável pela inserção. */
  readonly responsavel?: { readonly registro: number; readonly nome: string } | null;
}

export interface IrasNova {
  readonly reg: number;
  readonly paciente: number | null;
  readonly setor: string;
  readonly sitio: string;
  readonly dataInfeccao: string;
  readonly criterios: readonly string[];
  readonly nivelIsc: string | null;
  readonly cirurgia: number | null;
  readonly implante: boolean;
  readonly exame: number | null;
  readonly microrganismo: string | null;
  readonly multirresistente: boolean;
  readonly dispositivo: number | null;
  readonly descricao: string | null;
  readonly usuario: string;
}

export interface IrasRegistrada {
  readonly id: number;
  readonly reg: number;
  readonly paciente: number | null;
  readonly setor: string;
  readonly sitio: string;
  readonly dataInfeccao: string;
  readonly criterios: string[];
  readonly nivelIsc: string | null;
  readonly cirurgia: number | null;
  readonly implante: boolean;
  readonly exame: number | null;
  readonly microrganismo: string | null;
  readonly multirresistente: boolean;
  readonly dispositivo: number | null;
  readonly descricao: string | null;
  readonly situacao: string;
  readonly motivoDescarte: string | null;
  readonly registradoPor: string;
  readonly registradoEm: string;
  readonly versao: number;
}

export interface ItemAntimicrobianoConfigurado {
  readonly item: number;
  readonly restrito: boolean;
  readonly atc: string | null;
  readonly dddGramas: number | null;
  readonly gramasPorUnidade: number | null;
  readonly atualizadoPor: string;
  readonly atualizadoEm: string;
}

export interface LiberacaoAntimicrobianoNova {
  readonly itemPrescricao: number;
  readonly prescricao: number;
  readonly reg: number;
  readonly paciente: number | null;
  readonly item: number;
  readonly ficha: number | null;
  readonly prescritoEm: string;
  readonly inicioTratamento: string;
  readonly decisao: string;
  readonly diasAutorizados: number | null;
  readonly justificativa: string | null;
  readonly noPrazo: boolean;
  readonly agora: string;
  readonly usuario: string;
}

export interface LiberacaoAntimicrobianoRegistrada {
  readonly id: number;
  readonly itemPrescricao: number;
  readonly prescricao: number;
  readonly reg: number;
  readonly paciente: number | null;
  readonly item: number;
  readonly ficha: number | null;
  readonly prescritoEm: string;
  readonly inicioTratamento: string;
  readonly decisao: string;
  readonly diasAutorizados: number | null;
  readonly justificativa: string | null;
  readonly noPrazo: boolean;
  readonly decididoEm: string;
  readonly decididoPor: string;
  readonly revisoes: {
    readonly d3: { em: string; por: string; conduta: string; observacao: string | null } | null;
    readonly d7: { em: string; por: string; conduta: string; observacao: string | null } | null;
  };
  readonly versao: number;
}

export interface PrecaucaoNova {
  readonly reg: number;
  readonly paciente: number | null;
  readonly leito: ChaveLeito;
  readonly motivo: string;
  readonly motivoOutro: string | null;
  readonly tipo: Precaucao;
  /** O tipo que o leito passa a mostrar (o mais restritivo das abertas no leito, calculado pela API). */
  readonly tipoDoLeito: Precaucao;
  readonly origem: string;
  readonly exame: number | null;
  readonly multirresistente: boolean;
  /** Os vizinhos livres a bloquear. */
  readonly bloquear: readonly ChaveLeito[];
  /**
   * Os vizinhos já bloqueados por outra precaução aberta do quarto: não abrem bloqueio novo, mas entram na lista desta
   * (o encerramento de uma só libera o leito que nenhuma outra aberta ainda pede).
   */
  readonly compartilhar?: readonly ChaveLeito[];
  readonly observacao: string | null;
  readonly agora: string;
  readonly usuario: string;
}

export interface PrecaucaoRegistrada {
  readonly id: number;
  readonly reg: number;
  readonly paciente: number | null;
  readonly leito: { readonly bloco: string; readonly acomodacao: string; readonly leito: string };
  readonly motivo: string;
  readonly motivoOutro: string | null;
  readonly tipo: string;
  readonly origem: string;
  readonly exame: number | null;
  readonly multirresistente: boolean;
  /** Os leitos vizinhos que esta precaução bloqueou (para liberar no encerramento). */
  readonly bloqueios: { readonly bloco: string; readonly acomodacao: string; readonly leito: string }[];
  readonly observacao: string | null;
  readonly inicioEm: string;
  readonly inicioPor: string;
  readonly fimEm: string | null;
  readonly motivoFim: string | null;
  readonly versao: number;
}

export interface ObservacaoMaosRegistrada {
  readonly id: number;
  readonly unidade: number;
  readonly setor: string | null;
  readonly observadoEm: string;
  readonly categoria: string;
  readonly oportunidades: number;
  readonly conformes: number;
  readonly detalhe: { momento: string; acao: string; luvas: boolean }[];
  readonly registradoPor: string;
  /** W0-04: a correção por versão e o estorno (a estornada fica visível como inativa, fora da adesão). */
  readonly versao?: number;
  readonly observacao?: string | null;
  readonly estornadoEm?: string | null;
  readonly motivoEstorno?: string | null;
}

export interface SurtoRegistrado {
  readonly id: number;
  readonly titulo: string;
  readonly tipoSurto: number | null;
  readonly agente: string | null;
  readonly unidade: number;
  readonly setor: string | null;
  readonly inicio: string;
  readonly casos: number;
  readonly medidas: string | null;
  readonly situacao: string;
  readonly encerradoEm: string | null;
  readonly registradoPor: string;
  readonly versao: number;
}

export interface BundleRegistrado {
  readonly id: number;
  readonly dispositivo: number;
  readonly data: string;
  readonly turno: 'manha' | 'tarde' | 'noite';
  readonly itens: Record<string, boolean>;
  readonly conforme: boolean;
  readonly indicacaoRevisada: boolean;
  readonly observacao: string | null;
  readonly registradoPor: string;
  readonly registradoEm: string;
  /** Revisão do W0-04 (1026): a versão (correção) e o estorno lógico. */
  readonly versao: number;
  readonly estornadoEm: string | null;
  readonly estornadoPor: string | null;
  readonly motivoEstorno: string | null;
}

export interface CompetenciaFechada {
  readonly id: number;
  readonly area: 'ccih';
  readonly competencia: string;
  readonly situacao: 'fechada' | 'reaberta';
  readonly fechadaPor: string;
  readonly fechadaEm: string;
  readonly reabertaPor: string | null;
  readonly reabertaEm: string | null;
  readonly motivoReabertura: string | null;
  readonly versao: number;
}

export interface VersaoRegistro {
  readonly versao: number;
  readonly acao: AcaoVersao;
  readonly motivo: string;
  readonly alteradoPor: string;
  readonly alteradoEm: string;
  /** A linha como estava nesta versão (colunas do banco). */
  readonly dados: Readonly<Record<string, unknown>>;
}

export interface DependentesRegistro {
  readonly grupo: string;
  readonly dependente: string;
  readonly quantidade: number;
  /** Os IDs (até 50) para a tela listar quais. */
  readonly ids: readonly number[];
}

export type AcaoVersao =
  'correcao' | 'cancelamento' | 'estorno' | 'retificacao' | 'reabertura' | 'fechamento';

export interface AnaliseIndicadorNova {
  readonly id: number | null;
  readonly versao: number | null;
  readonly indicador: string;
  readonly competencia: string;
  /** Nulo quando a apuração não tem o numerador (nunca zero no lugar do desconhecido). */
  readonly numerador: number | null;
  readonly denominador: number | null;
  readonly valor: number | null;
  readonly meta: number | null;
  readonly situacaoMeta: 'na-meta' | 'fora-da-meta' | 'sem-meta';
  readonly texto: string;
  readonly causas: string | null;
  readonly plano: string | null;
  readonly responsavel: string | null;
  readonly prazo: string | null;
  readonly agora: string;
  readonly usuario: string;
  /** A ficha do indicador calculado (o banco próprio inclui o indicador do catálogo na primeira análise). */
  readonly ficha?: FichaIndicadorQualidade;
}

export interface AnaliseIndicadorRegistrada {
  readonly id: number;
  readonly versao: number;
  readonly indicador: string;
  readonly competencia: string;
  /** Nulo quando a apuração não tem o numerador (nunca zero no lugar do desconhecido). */
  readonly numerador: number | null;
  readonly denominador: number | null;
  readonly valor: number | null;
  readonly meta: number | null;
  readonly situacaoMeta: string;
  readonly texto: string;
  readonly causas: string | null;
  readonly plano: string | null;
  readonly responsavel: string | null;
  readonly prazo: string | null;
  readonly registradaPor: string;
  readonly registradaEm: string;
  readonly atualizadaPor: string | null;
  readonly atualizadaEm: string | null;
}

export interface AuditoriaRegistrada {
  readonly id: number;
  readonly titulo: string;
  readonly area: string;
  readonly referencial: string;
  readonly realizadaEm: string;
  readonly auditores: string;
  /** O checklist como o JSON gravado (a API confere pelo esquema). */
  readonly itens: string;
  readonly conformes: number;
  readonly parciais: number;
  readonly naoConformes: number;
  readonly naoAplicaveis: number;
  readonly conclusao: string;
  readonly registradaPor: string;
  readonly registradaEm: string;
  /** W0-04: a alteração com versão e o cancelamento lógico (a cancelada fica visível como inativa). */
  readonly versao?: number;
  readonly canceladaEm?: string | null;
  readonly motivoCancelamento?: string | null;
}

export interface ComissaoRegistrada {
  readonly id: number;
  readonly versao: number;
  readonly tipo: string;
  readonly nome: string;
  readonly periodicidade: string;
  /** A composição como o JSON gravado. */
  readonly membros: string;
  readonly ativa: boolean;
  readonly registradaEm: string;
  readonly ultimaOrdinaria: string | null;
  readonly ultimaReuniao: string | null;
}

export interface DocumentoQualidadeNovo {
  readonly codigo: string;
  readonly revisao: number;
  readonly tipo: string;
  readonly titulo: string;
  readonly area: string;
  readonly conteudo: string;
  readonly resumoAlteracao: string | null;
  readonly elaboradoPor: string;
  readonly revisadoPor: string | null;
  readonly vigenciaAte: string;
  readonly exigeCiencia: boolean;
  readonly hash: string;
  /** A revisão vigente substituída (obsoleta na mesma transação), com a versão lida. */
  readonly substitui: { readonly id: number; readonly versao: number } | null;
  readonly agora: string;
  readonly usuario: string;
}

export interface DocumentoQualidadeRegistrado {
  readonly id: number;
  readonly versao: number;
  readonly codigo: string;
  readonly revisao: number;
  readonly tipo: string;
  readonly titulo: string;
  readonly area: string;
  readonly resumoAlteracao: string | null;
  readonly elaboradoPor: string;
  readonly revisadoPor: string | null;
  readonly aprovadoPor: string;
  readonly publicadoEm: string;
  readonly vigenciaAte: string;
  readonly exigeCiencia: boolean;
  readonly hash: string;
  readonly situacao: string;
  readonly motivoRetirada: string | null;
  readonly encerradoEm: string | null;
  /** Só na leitura de um documento (a lista não traz o conteúdo). */
  readonly conteudo: string | null;
}

export interface EnvioRegulatorioRegistrado {
  readonly id: number;
  readonly versao: number;
  readonly tipo: string;
  readonly competencia: string;
  readonly revisao: number;
  readonly arquivo: string;
  readonly hash: string;
  readonly linhas: number;
  /** As contagens como o JSON gravado. */
  readonly resumo: string;
  readonly situacao: string;
  readonly geradoPor: string;
  readonly geradoEm: string;
  readonly transmitidoEm: string | null;
  readonly transmitidoPor: string | null;
  readonly protocolo: string | null;
}

export interface FiltroDocumentos {
  readonly situacao?: string | undefined;
  readonly tipo?: string | undefined;
  /** Código ou título (maiúsculas, sem acento: a busca do banco é por CONTAINING). */
  readonly busca?: string | undefined;
  readonly pagina: number;
  readonly porPagina: number;
}

export interface ManifestacaoNova {
  /** O protocolo pelo número da sequência (a regra do formato é a de @sgh/dominio-qualidade). */
  readonly protocoloDe: (numero: number) => string;
  readonly canal: string;
  readonly tipo: string;
  readonly identificada: boolean;
  readonly paciente: number | null;
  readonly manifestante: string | null;
  readonly contato: string | null;
  readonly area: string;
  readonly relato: string;
  readonly recebidaEm: string;
  readonly prazoEm: string;
  readonly pesquisa: number | null;
  readonly agora: string;
  readonly usuario: string;
}

export interface ManifestacaoRegistrada {
  readonly id: number;
  readonly versao: number;
  readonly protocolo: string;
  readonly canal: string;
  readonly tipo: string;
  readonly identificada: boolean;
  readonly paciente: number | null;
  readonly manifestante: string | null;
  readonly contato: string | null;
  readonly area: string;
  readonly relato: string;
  readonly recebidaEm: string;
  readonly prazoEm: string;
  readonly situacao: string;
  readonly encaminhadaA: string | null;
  readonly observacao: string | null;
  readonly resposta: string | null;
  readonly procedente: boolean | null;
  readonly respondidaPor: string | null;
  readonly respondidaEm: string | null;
  readonly pesquisa: number | null;
  readonly registradaPor: string;
  readonly registradaEm: string;
  /** W0-04: o cancelamento lógico com motivo (a manifestação protocolada não se apaga). */
  readonly canceladaEm?: string | null;
  readonly motivoCancelamento?: string | null;
}

export interface NaoConformidadeNova {
  readonly id: number | null;
  readonly versao: number | null;
  readonly origem: string;
  readonly idOrigem: number | null;
  readonly descricao: string;
  readonly area: string;
  readonly classificacao: string;
  readonly acaoImediata: string | null;
  readonly causa: string | null;
  readonly plano: string | null;
  readonly responsavel: string | null;
  readonly prazo: string | null;
  readonly situacao: string;
  readonly eficacia: string | null;
  readonly eficaciaTexto: string | null;
  readonly agora: string;
  readonly usuario: string;
}

export interface NaoConformidadeRegistrada {
  readonly id: number;
  readonly versao: number;
  readonly origem: string;
  readonly idOrigem: number | null;
  readonly descricao: string;
  readonly area: string;
  readonly classificacao: string;
  readonly acaoImediata: string | null;
  readonly causa: string | null;
  readonly plano: string | null;
  readonly responsavel: string | null;
  readonly prazo: string | null;
  readonly situacao: string;
  readonly eficacia: string | null;
  readonly eficaciaTexto: string | null;
  readonly registradaPor: string;
  readonly registradaEm: string;
  readonly encerradaPor: string | null;
  readonly encerradaEm: string | null;
  /** W0-04: o cancelamento da duplicada ou aberta por engano (fica visível como inativa). */
  readonly canceladaEm?: string | null;
  readonly motivoCancelamento?: string | null;
  readonly duplicadaDe?: number | null;
}

export interface PaginaGestao<T> {
  readonly itens: T[];
  readonly total: number;
}

/** Uma resposta da pesquisa do portal (sem o nome do paciente; a nota, o comentário e a agenda). */
export interface PesquisaSatisfacaoRespondida {
  readonly id: number;
  readonly paciente: number;
  readonly tipo: string;
  readonly agenda: string;
  readonly dataAtendimento: string;
  readonly nota: number;
  readonly comentario: string | null;
  readonly respondidaEm: string;
  /** A manifestação que nasceu da resposta, quando houver. */
  readonly manifestacao: number | null;
}

export interface ReuniaoComissaoRegistrada {
  readonly id: number;
  readonly comissao: number;
  readonly tipo: string;
  readonly realizadaEm: string;
  readonly pauta: string;
  readonly ata: string;
  /** Os nomes dos presentes como o JSON gravado. */
  readonly presentes: string;
  readonly membrosTotal: number;
  readonly presentesTotal: number;
  readonly convidados: string | null;
  readonly deliberacoes: string | null;
  readonly registradaPor: string;
  readonly registradaEm: string;
  /** W0-04: a ata retificada por versão, a assinatura (aprovação) e o cancelamento da reunião lançada errado. */
  readonly versao?: number;
  readonly ataAssinadaEm?: string | null;
  readonly ataAssinadaPor?: string | null;
  readonly canceladaEm?: string | null;
  readonly motivoCancelamento?: string | null;
  /**
   * Revisão do W0-04 (1026): a assinatura da versão anterior quando a ata assinada foi retificada (o texto novo aguarda
   * nova assinatura; a reunião que já teve ata assinada não se cancela).
   */
  readonly assinaturaAnteriorEm?: string | null;
  readonly assinaturaAnteriorPor?: string | null;
}

/** Um controle do risco na gravação (C2-060): o nome liga ao catálogo de controles do hospital. */
export interface ControleRiscoNovo {
  readonly nome: string;
  readonly tipo: string;
  readonly eficacia: string;
}

/** Um controle do risco gravado: o do catálogo, com a eficácia e a data da avaliação. */
export interface ControleRiscoGravado {
  readonly nome: string;
  readonly tipo: string;
  readonly eficacia: string;
  readonly avaliadoEm: string | null;
}

export interface RiscoNovo {
  readonly id: number | null;
  readonly versao: number | null;
  readonly titulo: string;
  readonly descricao: string;
  readonly area: string;
  readonly categoria: string;
  readonly gravidade: number;
  readonly urgencia: number;
  readonly tendencia: number;
  readonly controles: string | null;
  /** Os controles estruturados; ausente: os vínculos gravados ficam como estão. */
  readonly controlesLista?: readonly ControleRiscoNovo[];
  readonly responsavel: string;
  readonly situacao: string;
  readonly reavaliarEm: string;
  readonly justificativa: string | null;
  readonly agora: string;
  readonly usuario: string;
}

export interface RiscoRegistrado {
  readonly id: number;
  readonly versao: number;
  readonly titulo: string;
  readonly descricao: string;
  readonly area: string;
  readonly categoria: string;
  readonly gravidade: number;
  readonly urgencia: number;
  readonly tendencia: number;
  readonly pontuacao: number;
  readonly controles: string | null;
  readonly controlesLista: readonly ControleRiscoGravado[];
  readonly responsavel: string;
  readonly situacao: string;
  readonly reavaliarEm: string;
  readonly justificativa: string | null;
  readonly registradoPor: string;
  readonly registradoEm: string;
  readonly atualizadoPor: string | null;
  readonly atualizadoEm: string | null;
}

export interface ChecklistRevisaoRegistrado {
  readonly id: number;
  readonly comissao: number;
  readonly revisao: number;
  readonly itens: string;
  readonly situacao: string;
  readonly motivo: string | null;
  readonly publicadoPor: string;
  readonly publicadoEm: string;
  readonly inativadoPor: string | null;
  readonly inativadoEm: string | null;
  /** Revisão do W0-04 (1026): o motivo da inativação em coluna própria (o `motivo` é o da publicação). */
  readonly motivoInativacao: string | null;
  readonly versao: number;
}

export interface PendenciaRevisaoRegistrada {
  readonly id: number;
  readonly prontuario: number;
  readonly reg: number;
  readonly item: string;
  readonly descricao: string;
  readonly profissionalRegistro: number | null;
  readonly profissionalLogin: string | null;
  readonly profissionalNome: string | null;
  readonly prazo: string;
  readonly situacao: string;
  readonly resposta: string | null;
  readonly resolvidaPor: string | null;
  readonly resolvidaEm: string | null;
  readonly canceladaPor: string | null;
  readonly canceladaEm: string | null;
  readonly motivoCancelamento: string | null;
  readonly criadaEm: string;
  readonly versao: number;
}

export interface ProntuarioRevisaoRegistrado {
  readonly id: number;
  readonly sorteio: number;
  readonly ordem: number;
  readonly reg: number;
  readonly paciente: number | null;
  readonly alta: string;
  readonly clinica: string;
  readonly medicoRegistro: number | null;
  readonly medicoNome: string | null;
  readonly situacao: string;
  readonly respostas: string | null;
  readonly observacao: string | null;
  readonly revisadoPor: string | null;
  readonly revisadoEm: string | null;
  readonly avalPor: string | null;
  readonly avalEm: string | null;
  readonly versao: number;
}

export interface PublicacaoChecklist {
  readonly comissao: number;
  readonly itens: string;
  readonly motivo: string | null;
  readonly vigente: { readonly id: number; readonly versao: number } | null;
  readonly agora: string;
  readonly usuario: string;
}

export interface RevisaoNova {
  readonly id: number;
  readonly versao: number;
  readonly situacao: 'conforme' | 'naoConforme';
  readonly respostas: string;
  readonly observacao: string | null;
  /** Null na primeira revisão; a justificativa na correção (gera a versão anterior em trilha_auditoria). */
  readonly justificativa: string | null;
  readonly pendencias: readonly NovaPendenciaRevisao[];
  readonly profissional: {
    readonly registro: number | null;
    readonly login: string | null;
    readonly nome: string | null;
  };
  readonly agora: string;
  readonly usuario: string;
}

export interface SorteioRevisaoRegistrado {
  readonly id: number;
  readonly comissao: number;
  readonly checklist: number;
  readonly checklistRevisao: number;
  readonly competencia: string;
  readonly semente: string;
  readonly quantidade: number;
  readonly universo: number;
  readonly resumoUniverso: string;
  readonly sorteadoPor: string;
  readonly sorteadoEm: string;
  readonly canceladoEm: string | null;
  readonly canceladoPor: string | null;
  readonly motivoCancelamento: string | null;
  readonly revisados: number;
  readonly versao: number;
}

export interface SorteioNovo {
  readonly comissao: number;
  readonly checklist: number;
  readonly competencia: string;
  readonly semente: string;
  readonly universo: number;
  readonly resumoUniverso: string;
  readonly amostra: readonly AltaParaRevisao[];
  readonly agora: string;
  readonly usuario: string;
}

export interface NovaPendenciaRevisao {
  readonly item: string;
  readonly descricao: string;
  readonly prazo: string;
}

/** O protocolo da manifestação (OUV-AAAA-NNNNNN): a busca igual a ele vai pela chave única (estabelecimento, protocolo). */
export const PROTOCOLO_OUVIDORIA = /^OUV-\d{4}-\d{6}$/;

export const recusaVersaoAgravo = (): ErroOperacao =>
  recusa(
    'versao-desatualizada',
    'O caso mudou desde que você abriu a tela (outra pessoa da vigilância agiu nele): recarregue e confira.',
  );

export const recusaVersaoCcih = (): ErroOperacao =>
  recusa(
    'versao-desatualizada',
    'O registro mudou desde que você abriu a tela (outra pessoa da CCIH agiu nele): recarregue e confira.',
  );

export const recusaVersaoGestao = (o = 'O registro'): ErroOperacao =>
  recusa(
    'versao-desatualizada',
    `${o} mudou desde que você abriu a tela (outra pessoa agiu nele): recarregue e confira.`,
  );

export const recusaVersaoNotificacao = (): ErroOperacao =>
  recusa(
    'versao-desatualizada',
    'A notificação mudou desde que você abriu a tela (outra pessoa do núcleo agiu nela): recarregue e confira.',
  );

export interface AltaParaRevisao {
  readonly reg: number;
  readonly paciente: number | null;
  readonly alta: string;
  readonly clinica: string;
  readonly medicoRegistro: number | null;
  readonly medicoNome: string | null;
}

export interface AtendimentoParaAgravo {
  readonly atendimento: number;
  readonly paciente: number;
  readonly unidade: number | null;
  readonly entrada: string | null;
  readonly cids: readonly string[];
  /** Alta por óbito (instante) ou nulo. */
  readonly obitoEm: string | null;
}

export interface ExameParaAgravo {
  readonly exame: number;
  readonly atendimento: number | null;
  readonly paciente: number | null;
  readonly nomeExame: string;
  readonly liberado: boolean;
  readonly resultados: readonly string[];
}
