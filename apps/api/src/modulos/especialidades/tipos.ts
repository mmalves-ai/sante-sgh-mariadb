// Tipos de negócio da porta das especialidades sob demanda e do lactário (M45, etapa 6): o que a porta lê e grava,
// no vocabulário do produto (id da internação, prontuário, booleanos e datas ISO), sem os tipos do sistema de origem.
// Melhoria: a internação e o prontuário pelo nome de negócio (internacao, prontuario), não pela coluna antiga; o autor
// gravado é o usuário da sessão (id, pelo contexto); o `usuario` das gravações é só o login exibido na tela.
import type {
  Bolsa,
  CategoriaMotivoCiclo,
  ClassificacaoVisual,
  DoseCalculada,
  EventoOnco,
  EventoOncoLido,
  AlteracaoHotLida,
  FarmacoProtocolo,
  LadoExame,
  LiquidoAmniotico,
  MetodoPio,
  SexoRn,
  SituacaoCiclo,
  SituacaoOrdemLactario,
} from '@sgh/contratos';

/** O paciente internado a que o registro se refere. */
export interface PacienteInternado {
  /** Id da internação. */
  readonly internacao: number;
  readonly prontuario: number;
  /** Id do paciente. */
  readonly paciente: number;
}

/** Quem registra: o vínculo profissional (id) e o login exibido (a autoria gravada é o usuário da sessão). */
export interface Autoria {
  readonly vinculo: number;
  readonly usuario: string;
}

export interface InternacaoEspecialidadeLida extends PacienteInternado {
  readonly nome: string;
  readonly nascimento: string | null;
  readonly sexo: 'M' | 'F' | 'I';
  readonly bloco: string;
  readonly acomodacao: string;
  readonly leito: string;
  /** "AAAA-MM-DDTHH:MM" da admissão, no fuso do estabelecimento. */
  readonly admissao: string;
  readonly aberta: boolean;
}

export interface CadastrosOftalmologia {
  readonly grupos: { codigo: number; nome: string }[];
  readonly exames: { codigo: number; grupo: number; nome: string }[];
  readonly acuidades: { codigo: number; nome: string; tipo: string | null }[];
  readonly graduacoes: { codigo: number; sigla: string; nome: string }[];
  readonly tiposArquivo: string[];
}

export interface MedidasOlho {
  readonly avSc: number | null;
  readonly avCc: number | null;
  readonly pio: number | null;
  readonly gonio: number | null;
}

export interface ExameOftalmologicoRegistrado {
  readonly id: number;
  readonly internacao: number;
  readonly od: MedidasOlho;
  readonly oe: MedidasOlho;
  readonly metodoPio: string | null;
  readonly classificacao: string;
  readonly alertas: string[];
  readonly conduta: string | null;
  readonly itens: { exame: number; lado: LadoExame; resultado: string }[];
  readonly por: string;
  readonly em: string;
}

export interface NovoExameOftalmologico extends PacienteInternado, Autoria {
  readonly od: MedidasOlho;
  readonly oe: MedidasOlho;
  readonly metodoPio: MetodoPio | null;
  readonly classificacao: ClassificacaoVisual;
  readonly alertas: readonly string[];
  readonly conduta: string | null;
  readonly itens: readonly { exame: number; lado: LadoExame; resultado: string }[];
}

export interface ProtocoloOncologicoRegistrado {
  readonly id: number;
  readonly codigo: string;
  readonly versao: number;
  readonly nome: string;
  readonly tipo: number;
  readonly intervaloDias: number;
  readonly ciclos: number;
  readonly indicacao: string | null;
  readonly referencia: string;
  readonly farmacos: FarmacoProtocolo[];
  readonly hash: string;
  readonly por: string;
  readonly em: string;
}

export interface NovoProtocoloOncologico extends Autoria {
  readonly codigo: string;
  readonly nome: string;
  readonly tipo: number;
  readonly intervaloDias: number;
  readonly ciclos: number;
  readonly indicacao: string | null;
  readonly referencia: string;
  readonly farmacos: readonly FarmacoProtocolo[];
  readonly hash: string;
}

export type AndamentoCicloLido = 'ativo' | 'suspenso' | 'cancelado';

export interface CicloOncologicoRegistrado {
  readonly id: number;
  readonly internacao: number;
  readonly paciente: number;
  readonly protocolo: number;
  readonly codigoProtocolo: string;
  readonly numero: number;
  readonly dataPrevista: string;
  readonly pesoKg: number;
  readonly alturaCm: number;
  readonly superficieM2: number;
  readonly creatininaMgDl: number | null;
  readonly clearanceMlMin: number | null;
  readonly reducaoPct: number;
  readonly motivoReducao: string | null;
  readonly justificativaIntervalo: string | null;
  readonly doses: DoseCalculada[];
  readonly situacao: SituacaoCiclo;
  readonly por: string;
  readonly em: string;
  readonly validadoPor: string | null;
  readonly validadoEm: string | null;
  /** O tratamento (curso) do ciclo: o mesmo protocolo recomeça num curso novo, com o motivo. */
  readonly curso: number;
  readonly motivoCurso: string | null;
  /** As prescrições ligadas ao ciclo (ids), em ordem. */
  readonly prescricoes: readonly number[];
  readonly andamento: AndamentoCicloLido;
}

export interface NovoCicloOncologico extends PacienteInternado, Autoria {
  readonly protocolo: number;
  readonly codigoProtocolo: string;
  readonly numero: number;
  readonly dataPrevista: string;
  readonly pesoKg: number;
  readonly alturaCm: number;
  readonly superficieM2: number;
  readonly creatininaMgDl: number | null;
  readonly clearanceMlMin: number | null;
  readonly reducaoPct: number;
  readonly motivoReducao: string | null;
  readonly justificativaIntervalo: string | null;
  readonly doses: readonly DoseCalculada[];
  /** O tratamento (curso) do ciclo; 1 no primeiro; o curso novo leva o motivo. */
  readonly curso?: number;
  readonly motivoCurso?: string | null;
}

export interface VinculoPrescricaoCiclo extends Autoria {
  readonly ciclo: number;
  /** Id da prescrição geral com os medicamentos do ciclo. */
  readonly prescricao: number;
  /** A data prevista em que a prescrição foi escolhida: mudou na transação (ajuste simultâneo), recusa. */
  readonly dataPrevista?: string;
}

export interface ValidacaoCiclo extends Autoria {
  readonly id: number;
  readonly doses: readonly number[];
  readonly observacao: string | null;
}

export interface PrescricaoDoCiclo {
  /** Id da prescrição. */
  readonly id: number;
  readonly inicio: string;
  readonly fim: string | null;
  readonly suspensa: boolean;
  readonly itens: number;
}

export interface MedidasPartograma {
  readonly dilatacaoCm: number | null;
  readonly alturaApresentacao: number | null;
  readonly bcf: number | null;
  readonly contracoes10min: number | null;
  readonly duracaoContracaoS: number | null;
  readonly bolsa: Bolsa | null;
  readonly liquido: LiquidoAmniotico | null;
  readonly paSistolica: number | null;
  readonly paDiastolica: number | null;
  readonly temperatura: number | null;
  readonly ocitocina: number | null;
  readonly observacao: string | null;
}

export interface PontoPartograma extends MedidasPartograma {
  readonly id: number;
  readonly em: string;
  readonly alertas: string[];
  readonly por: string;
  readonly registradoEm: string;
}

export interface NovoPontoPartograma extends PacienteInternado, Autoria, MedidasPartograma {
  readonly em: string;
  readonly alertas: readonly string[];
}

export interface DadosRecemNascido {
  readonly nascimentoEm: string;
  readonly sexo: SexoRn;
  readonly pesoG: number;
  readonly comprimentoCm: number | null;
  readonly perimetroCefalicoCm: number | null;
  readonly apgar1: number;
  readonly apgar5: number;
  readonly apgar10: number | null;
  readonly igSemanas: number;
  readonly igDias: number;
  readonly tipoParto: number;
  readonly reanimacao: boolean;
  readonly classificacaoIg: string;
  readonly classificacaoPeso: string;
  readonly classificacaoApgar: string;
  readonly observacao: string | null;
}

/**
 * O recém-nascido lido: peso, Apgar e idade gestacional podem faltar (o banco aceita nulo, por exemplo no nascimento
 * que veio da migração sem esses campos); a classificação correspondente é null quando o valor falta (nunca uma
 * classificação clínica calculada sobre um zero inventado).
 */
export interface RecemNascidoRegistrado
  extends Omit<
    DadosRecemNascido,
    'pesoG' | 'apgar1' | 'apgar5' | 'igSemanas' | 'igDias' | 'classificacaoIg' | 'classificacaoPeso' | 'classificacaoApgar'
  > {
  readonly pesoG: number | null;
  readonly apgar1: number | null;
  readonly apgar5: number | null;
  readonly igSemanas: number | null;
  readonly igDias: number | null;
  readonly classificacaoIg: string | null;
  readonly classificacaoPeso: string | null;
  readonly classificacaoApgar: string | null;
  readonly id: number;
  readonly por: string;
  readonly em: string;
}

export type NovoRecemNascido = PacienteInternado & Autoria & DadosRecemNascido;

export interface ConteudoOrdemLactario {
  readonly formula: string;
  readonly volumeMl: number;
  readonly horarios: readonly string[];
  readonly preparoEm: string;
  readonly validadeEm: string;
  readonly lote: string | null;
  readonly observacao: string | null;
}

export interface OrdemLactarioRegistrada extends PacienteInternado {
  readonly id: number;
  readonly formula: string;
  readonly volumeMl: number;
  readonly horarios: string[];
  readonly preparoEm: string;
  readonly validadeEm: string;
  readonly lote: string | null;
  readonly observacao: string | null;
  readonly situacao: SituacaoOrdemLactario;
  readonly por: string;
  readonly em: string;
  readonly conferidoPor: string | null;
  readonly conferidoEm: string | null;
  readonly canceladaPor: string | null;
  readonly canceladaEm: string | null;
  readonly motivoCancelamento: string | null;
  readonly etiquetaEm: string | null;
}

export interface NovaOrdemLactario extends PacienteInternado, ConteudoOrdemLactario {
  readonly usuario: string;
}

export interface AlteracaoOrdemLactario extends ConteudoOrdemLactario {
  readonly id: number;
}

/** A ordem como estava antes da alteração, relida na transação (com a linha travada). */
export interface OrdemLactarioAnterior extends Omit<ConteudoOrdemLactario, 'horarios'> {
  readonly horarios: string[];
}

export interface NovoEventoOncologico extends Autoria {
  readonly evento: EventoOnco;
  readonly codigoProtocolo: string;
  readonly protocolo: number | null;
  readonly ciclo: number | null;
  readonly prescricao: number | null;
  readonly categoria: CategoriaMotivoCiclo | null;
  readonly ciclosAfetados: number | null;
  /** A versão anterior do ciclo ajustado (data, redução e doses), em JSON. */
  readonly antes: string | null;
  readonly motivo: string;
}

export interface EventoOncologicoRegistrado extends Omit<EventoOncoLido, 'antes'> {
  readonly codigoProtocolo: string;
  readonly protocolo: number | null;
  readonly ciclo: number | null;
  /** A versão anterior do ciclo ajustado em JSON (a API a valida e expõe já lida). */
  readonly antes: string | null;
}

export interface RevogacaoVersaoProtocolo extends Autoria {
  readonly codigoProtocolo: string;
  readonly protocolo: number;
  /** Os ciclos em andamento que a pessoa viu na ciência: mais que isso na transação recusa. */
  readonly emAndamentoCiente: number;
  readonly motivo: string;
}

export interface AjusteCiclo {
  readonly id: number;
  readonly dataPrevista: string;
  readonly reducaoPct: number;
  readonly motivoReducao: string | null;
  readonly justificativaIntervalo: string | null;
  readonly doses: readonly DoseCalculada[];
}

/** Registro do histórico de alteração das ordens do lactário. */
export interface NovaAlteracaoLactario {
  readonly id: number;
  readonly evento: 'alterada' | 'cancelada' | 'etiqueta-emitida';
  readonly antes: string | null;
  readonly depois: string | null;
  readonly motivo: string | null;
  readonly usuario: string;
}

export interface AlteracaoLactarioRegistrada extends AlteracaoHotLida {
  /** Id da ordem alterada. */
  readonly idRegistro: number;
}
