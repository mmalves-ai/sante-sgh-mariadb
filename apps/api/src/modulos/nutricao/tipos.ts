// Tipos de negócio da nutrição, do mapa de dietas e do serviço social (F2.2): o que a porta lê e grava, com
// vocabulário neutro (ids, datas ISO, booleanos). A internação é `reg` (id da internação) e o paciente é `pront`/
// `paciente` (id do paciente); o usuário é o login da sessão (o id vem do contexto do núcleo na porta própria).
import type {
  AcaoCorrecao,
  AcessoNpt,
  AlteracaoHotLida,
  BaseLegalAcompanhante,
  CorrecaoLida,
  EncaminhamentoSocial,
  InstrumentoTriagem,
  MotivoMetaNaoAtingida,
  OrigemJejum,
  ParecerNpt,
  RedeApoio,
  RegistroCorrigivel,
  RiscoSocial,
  RiscoTriagem,
  TipoBarreiraAlta,
  TipoLinhaMapa,
  TipoRegistroSocial,
  ViaTerapiaNutricional,
  VulnerabilidadeSocial,
} from '@sgh/contratos';

/** Tabela do registro de hotelaria que recebe o log de alteração. */
export type TabelaHotelaria = 'ordem_lactario' | 'plano_refeicao_acompanhante';

interface BaseTerapia {
  readonly reg: number;
  readonly pront: number;
  readonly paciente: number;
  readonly via: ViaTerapiaNutricional;
  readonly vinculo: number;
  readonly usuario: string;
}

export interface TriagemParaGravar {
  readonly reg: number;
  readonly pront: number;
  readonly paciente: number;
  readonly instrumento: InstrumentoTriagem;
  readonly versao: string;
  /** Respostas do instrumento em JSON (objeto pergunta → resposta). */
  readonly respostas: string;
  readonly estado: number | null;
  readonly gravidade: number | null;
  readonly idade: number | null;
  readonly total: number;
  readonly risco: RiscoTriagem;
  readonly conduta: string | null;
  readonly pesoKg: number | null;
  readonly alturaCm: number | null;
  readonly imc: number | null;
  readonly admissao: string;
  readonly horasDesdeAdmissao: number;
  /** Dentro do prazo da triagem (parâmetro do estabelecimento ou da unidade), decidido no serviço, nunca na porta. */
  readonly dentroDoPrazo: boolean;
  readonly reavaliarEm: string | null;
  readonly vinculo: number;
  readonly usuario: string;
}

export interface MetaTerapiaParaGravar extends BaseTerapia {
  readonly itemDieta: number | null;
  readonly dieta: number | null;
  readonly pesoKg: number;
  readonly kcalPorKg: number;
  readonly proteinaGPorKg: number;
  readonly metaKcal: number;
  readonly metaProteinaG: number;
  readonly densidadeKcalMl: number;
  readonly proteinaGL: number;
  readonly metaVolumeMl: number;
  readonly observacao: string | null;
  readonly origemTerapia?: 'prescrita' | 'informada';
}

export interface AcompanhamentoTerapiaParaGravar extends BaseTerapia {
  readonly meta: number;
  readonly data: string;
  readonly volumePrescritoMl: number | null;
  readonly volumeInfundidoMl: number;
  readonly origemVolume: 'checagem' | 'balanco' | 'informado';
  readonly kcalAtingida: number;
  readonly proteinaAtingidaG: number;
  readonly pctKcal: number;
  readonly pctProteina: number;
  readonly motivo: MotivoMetaNaoAtingida | null;
  readonly observacao: string | null;
}

export interface LinhaRetrato {
  readonly reg: number;
  readonly pront: number;
  readonly acomodacao: string;
  readonly leito: string;
  readonly itemDieta: number | null;
  readonly item: number | null;
  readonly dieta: number | null;
  readonly tipo: TipoLinhaMapa;
  readonly nomeDieta: string | null;
  readonly caracteristicas: string | null;
  readonly jejumOrigem: OrigemJejum | null;
  readonly alergias: string | null;
  readonly acompanhante: boolean;
  readonly prescritoEm: string | null;
}

export interface MapaDietaParaGravar {
  readonly unidade: string;
  readonly refeicao: number;
  readonly data: string;
  readonly corteEm: string;
  readonly hash: string;
  readonly linhas: readonly LinhaRetrato[];
  readonly usuario: string;
}

export interface RefeicaoAcompanhanteParaGravar {
  readonly reg: number;
  readonly pront: number;
  readonly baseLegal: BaseLegalAcompanhante;
  readonly refeicoes: readonly number[];
  readonly inicio: string;
  readonly fim: string | null;
  readonly observacao: string | null;
  readonly usuario: string;
}

export interface AvaliacaoSocialParaGravar {
  readonly reg: number;
  readonly pront: number;
  readonly paciente: number;
  readonly tipo: TipoRegistroSocial;
  readonly redeApoio: RedeApoio;
  readonly vulnerabilidades: readonly VulnerabilidadeSocial[];
  readonly risco: RiscoSocial;
  readonly encaminhamentos: readonly EncaminhamentoSocial[];
  readonly parecer: string;
  readonly orientacoes: string | null;
  readonly barreira: { readonly descricao: string; readonly responsavel: string; readonly prazo: string } | null;
  readonly vinculo: number;
  readonly usuario: string;
}

export interface CorrecaoParaGravar {
  readonly registro: RegistroCorrigivel;
  readonly id: number;
  readonly reg: number;
  readonly acao: AcaoCorrecao;
  readonly idNovo: number | null;
  readonly motivo: string;
  readonly vinculo: number;
  readonly usuario: string;
}

export interface AvaliacaoNptParaGravar {
  readonly reg: number;
  readonly meta: number;
  readonly parecer: ParecerNpt;
  readonly acesso: AcessoNpt;
  readonly osmolaridade: number;
  readonly estabilidade: boolean;
  readonly compatibilidade: boolean;
  readonly observacao: string | null;
  readonly vinculo: number;
  readonly usuario: string;
}

export interface AdendoSocialParaGravar {
  readonly reg: number;
  readonly de: number;
  readonly texto: string;
  readonly motivo: string;
  readonly vinculo: number;
  readonly usuario: string;
}

export interface AlteracaoHotelaria {
  readonly tabela: TabelaHotelaria;
  readonly id: number;
  readonly evento: 'alterada' | 'cancelada' | 'etiqueta-emitida';
  readonly antes: string | null;
  readonly depois: string | null;
  readonly motivo: string | null;
  readonly usuario: string;
}

export interface AlteracaoRefeicaoAcompanhante {
  readonly id: number;
  readonly dieta: string | null;
  readonly refeicoes: readonly number[];
  readonly fim: string | null;
  readonly observacao: string | null;
}

export interface AcompanhanteAnterior {
  readonly dieta: string | null;
  readonly refeicoes: number[];
  readonly fim: string | null;
  readonly observacao: string | null;
}

export interface CorrecaoRegistrada extends CorrecaoLida {
  readonly registro: RegistroCorrigivel;
  readonly idRegistro: number;
}

export interface AlteracaoHotelariaRegistrada extends AlteracaoHotLida {
  readonly idRegistro: number;
}

export interface InternadoNutricao {
  readonly reg: number;
  readonly pront: number;
  readonly paciente: number;
  readonly atendimento: number | null;
  readonly nome: string;
  readonly nascimento: string | null;
  /** Código da unidade de internação. */
  readonly bloco: string;
  readonly acomodacao: string;
  readonly leito: string;
  /** "AAAA-MM-DDTHH:mm" no fuso do estabelecimento. */
  readonly admissao: string;
  readonly tipoAcomodacaoAtual: number | null;
}

export interface TriagemRegistrada {
  readonly id: number;
  readonly reg: number;
  readonly instrumento: InstrumentoTriagem;
  readonly versao: string;
  readonly total: number;
  readonly estado: number | null;
  readonly gravidade: number | null;
  readonly idade: number | null;
  readonly risco: RiscoTriagem;
  readonly conduta: string | null;
  readonly imc: number | null;
  readonly horasDesdeAdmissao: number;
  readonly reavaliarEm: string | null;
  readonly por: string;
  readonly em: string;
  readonly inativa: boolean;
}

export interface DietaEnteral {
  readonly itemDieta: number;
  readonly item: number;
  readonly prescricao: number;
  readonly plano: number;
  readonly dieta: number | null;
  readonly nomeDieta: string | null;
  readonly quantidade: number | null;
  readonly velocidade: number | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string;
  readonly suspensa: boolean;
  readonly cboLancamento: string | null;
}

export interface ChecagemDieta {
  readonly item: number;
  readonly previsto: string;
  readonly situacao: string;
  readonly quantidade: number | null;
  readonly situacaoEm: string | null;
}

export interface MetaTerapiaRegistrada {
  readonly id: number;
  readonly via: 'enteral' | 'parenteral' | 'oral';
  readonly itemDieta: number | null;
  readonly pesoKg: number;
  readonly kcalPorKg: number;
  readonly proteinaGPorKg: number;
  readonly metaKcal: number;
  readonly metaProteinaG: number;
  readonly densidadeKcalMl: number;
  readonly proteinaGL: number;
  readonly metaVolumeMl: number;
  readonly por: string;
  readonly em: string;
  readonly origemTerapia: 'prescrita' | 'informada';
  readonly observacao: string | null;
}

export interface AcompanhamentoTerapiaRegistrado {
  readonly id: number;
  readonly meta: number;
  readonly data: string;
  readonly volumePrescritoMl: number | null;
  readonly volumeInfundidoMl: number;
  readonly origemVolume: 'checagem' | 'balanco' | 'informado';
  readonly kcalAtingida: number;
  readonly proteinaAtingidaG: number;
  readonly pctKcal: number;
  readonly pctProteina: number;
  readonly motivo: string | null;
  readonly observacao: string | null;
  readonly por: string;
  readonly em: string;
}

export interface RegistroSocialRegistrado {
  readonly id: number;
  readonly reg: number;
  readonly tipo: TipoRegistroSocial | 'adendo';
  readonly redeApoio: RedeApoio;
  readonly vulnerabilidades: VulnerabilidadeSocial[];
  readonly risco: RiscoSocial;
  readonly encaminhamentos: EncaminhamentoSocial[];
  readonly parecer: string;
  readonly orientacoes: string | null;
  readonly barreira: number | null;
  readonly por: string;
  readonly em: string;
  readonly adendoDe: number | null;
  readonly motivoAdendo: string | null;
}

export interface BarreiraAltaRegistrada {
  readonly id: number;
  readonly reg: number;
  readonly tipo: TipoBarreiraAlta;
  readonly descricao: string;
  readonly responsavel: string;
  readonly prazo: string;
  readonly situacao: 'aberta' | 'resolvida' | 'cancelada';
  readonly criadaPor: string;
  readonly criadaEm: string;
  readonly resolvidaEm: string | null;
}

export interface UnidadeInternacaoNutricao {
  readonly unidade: string;
  readonly nome: string;
  readonly internados: number;
}

export interface RefeicaoDoCadastro {
  readonly codigo: number;
  readonly nome: string;
  /** "HH:mm" ou null. */
  readonly horario: string | null;
}

export interface ItemDietaMapa {
  readonly atendimento: number;
  readonly item: number;
  readonly itemDieta: number;
  readonly prescricao: number;
  readonly plano: number;
  readonly dieta: number | null;
  readonly nomeDieta: string | null;
  readonly quantidade: string | null;
  readonly gravadaEm: string;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string;
  readonly suspensaEm: string | null;
  readonly caracteristicas: { nome: string; resposta: string | null }[];
}

export interface CirurgiaDaJanela {
  readonly agendamento: number;
  readonly reg: number | null;
  readonly pront: number | null;
  readonly sala: number;
  readonly inicio: string;
  readonly duracaoMin: number;
}

export interface ExameDaJanela {
  readonly pront: number;
  readonly inicio: string;
  readonly exame: string;
  readonly agenda: string;
}

export interface RefeicaoAcompanhanteRegistrada {
  readonly id: number;
  readonly reg: number;
  readonly baseLegal: BaseLegalAcompanhante;
  readonly refeicoes: number[];
  readonly inicio: string;
  readonly fim: string | null;
  readonly observacao: string | null;
  readonly situacao: 'ativa' | 'encerrada';
  readonly por: string;
  readonly em: string;
  readonly dieta: string | null;
}

export interface RetratoMapa {
  readonly id: number;
  readonly corteEm: string;
  readonly itens: number;
  readonly jejuns: number;
  readonly hash: string;
  readonly por: string;
  readonly em: string;
  readonly linhas: {
    readonly reg: number;
    readonly acomodacao: string;
    readonly leito: string;
    readonly tipo: TipoLinhaMapa;
    readonly itemDieta: number | null;
    readonly dieta: string | null;
    readonly caracteristicas: string | null;
    readonly jejumOrigem: string | null;
  }[];
}
