// Cliente da API dos complementos do patrimônio (F8, 07-FIN linha 149; CPC 27 / NBC TG 27): agregação de valor ao
// bem, imobilizado em andamento (obras com a apropriação dos custos e a ativação que gera o bem) e o seguro dos bens
// (apólice com os bens cobertos e o subseguro). O servidor confere a permissão e a regra de novo em cada gravação.
import { z } from 'zod';
import { novaChave } from '../contabil/api-contabil.js';
import { enviar, ler, qs } from '../exames/api-exames.js';

const P = '/api/patrimonio';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

export const TIPOS_AGREGACAO = ['melhoria', 'componente', 'servico', 'outro'] as const;
export type TipoAgregacao = (typeof TIPOS_AGREGACAO)[number];
export const TIPOS_SEGURO = [
  'patrimonial',
  'incendio',
  'roubo',
  'equipamento',
  'veiculo',
  'responsabilidade_civil',
  'empresarial',
  'outro',
] as const;
export type SituacaoObra = 'em_andamento' | 'ativado' | 'cancelado';

export interface ApoioComplementos {
  readonly grupos: {
    readonly id: number;
    readonly codigo: string;
    readonly descricao: string;
    readonly vidaUtilMeses: number | null;
  }[];
  readonly contas: { readonly id: number; readonly codigo: string; readonly descricao: string }[];
  readonly seguradoras: { readonly id: number; readonly nome: string }[];
  readonly origens: { readonly id: number; readonly descricao: string }[];
  readonly centros: { readonly id: number; readonly codigo: string; readonly nome: string }[];
}
export interface AgregacaoLida {
  readonly id: number;
  readonly sequencia: number;
  readonly tipo: TipoAgregacao;
  readonly bemAgregado: { readonly id: number; readonly plaqueta: string; readonly descricao: string } | null;
  readonly numeroDocumento: string | null;
  readonly descricao: string;
  readonly data: string;
  readonly valorCent: number;
  readonly agregaValor: boolean;
  readonly dataDesagregacao: string | null;
  readonly observacao: string | null;
  readonly versao: number;
}
export interface AgregacoesDoBem {
  readonly bem: number;
  readonly versaoBem: number;
  readonly custoCent: number;
  readonly agregadoVigenteCent: number;
  readonly agregacoes: AgregacaoLida[];
}
export interface ApropriacaoLida {
  readonly id: number;
  readonly sequencia: number;
  readonly data: string;
  readonly titulo: number | null;
  readonly nota: number | null;
  readonly conta: number;
  readonly descricao: string | null;
  readonly valorCent: number;
}
export interface ObraLida {
  readonly id: number;
  readonly numero: number;
  readonly descricao: string;
  readonly grupo: { readonly id: number; readonly codigo: string; readonly descricao: string };
  readonly conta: number;
  readonly centro: number | null;
  readonly dataInicio: string;
  readonly dataPrevista: string | null;
  readonly dataAtivacao: string | null;
  readonly orcadoCent: number | null;
  readonly acumuladoCent: number;
  readonly orcamento: {
    readonly percentual: number | null;
    readonly estado: 'sem-orcamento' | 'dentro' | 'alerta' | 'estourado';
  };
  readonly bem: { readonly id: number; readonly plaqueta: string } | null;
  readonly situacao: SituacaoObra;
  readonly observacao: string | null;
  readonly versao: number;
  readonly apropriacoes?: ApropriacaoLida[];
}
export interface BemSeguradoLido {
  readonly id: number;
  readonly bem: number;
  readonly plaqueta: string;
  readonly descricao: string;
  readonly valorSeguradoCent: number;
  readonly valorIndenizadoCent: number;
  readonly inicio: string;
  readonly fim: string | null;
  readonly ativo: boolean;
  readonly valorContabilCent: number;
  readonly cobertura: {
    readonly percentual: number | null;
    readonly subseguro: boolean;
    readonly detalhe: string;
  };
}
export interface ApoliceLida {
  readonly id: number;
  readonly numero: string;
  readonly tipo: string;
  readonly seguradora: { readonly id: number; readonly nome: string };
  readonly corretorNome: string | null;
  readonly corretorTelefone: string | null;
  readonly corretorEmail: string | null;
  readonly cobertura: string | null;
  readonly inicio: string;
  readonly fim: string;
  readonly premioCent: number;
  readonly franquiaCent: number | null;
  readonly totalSeguradoCent: number;
  readonly anterior: number | null;
  readonly situacao: string;
  readonly situacaoVista: 'em_cotacao' | 'vigente' | 'a-vencer' | 'vencida' | 'cancelada' | 'renovada';
  readonly bensCobertos: number;
  readonly versao: number;
  readonly bens?: BemSeguradoLido[];
}

export const lerApoioComplementos = () => ler(`${P}/complementos/apoio`, confiar<ApoioComplementos>());

// ── Agregação ──
export const lerAgregacoes = (bem: number) => ler(`${P}/bens/${bem}/agregacoes`, confiar<AgregacoesDoBem>());
export const agregar = (
  bem: number,
  x: {
    versao: number;
    tipo: TipoAgregacao;
    bemAgregado: number | null;
    numeroDocumento: string | null;
    descricao: string;
    data: string;
    valorCent: number;
    agregaValor: boolean;
    conta: number | null;
    observacao: string | null;
  },
) => enviar(`${P}/bens/${bem}/agregacoes`, x, confiar<{ id: number }>(), novaChave('pat-agregar'));
export const retirarAgregacao = (id: number, x: { versao: number; data: string; motivo: string }) =>
  enviar(`${P}/agregacoes/${id}/retirada`, x, confiar<{ versao: number }>(), novaChave('pat-desagregar'));

// ── Imobilizado em andamento ──
export const lerObras = (situacao: SituacaoObra | null) =>
  ler(`${P}/obras${qs({ situacao })}`, z.array(confiar<ObraLida>()));
export const lerObra = (id: number) => ler(`${P}/obras/${id}`, confiar<ObraLida>());
export const abrirObra = (x: {
  descricao: string;
  grupo: number;
  conta: number | null;
  centro: number | null;
  dataInicio: string;
  dataPrevista: string | null;
  orcadoCent: number | null;
  observacao: string | null;
}) => enviar(`${P}/obras`, x, confiar<{ id: number; numero: number }>(), novaChave('pat-obra'));
export const apropriar = (
  obra: number,
  x: {
    versao: number;
    data: string;
    titulo: number | null;
    nota: number | null;
    descricao: string | null;
    valorCent: number;
  },
) =>
  enviar(
    `${P}/obras/${obra}/apropriacoes`,
    x,
    confiar<{ id: number; versao: number }>(),
    novaChave('pat-apropriar'),
  );
export const ativarObra = (
  obra: number,
  x: {
    versao: number;
    data: string;
    vidaUtilMeses: number;
    plaqueta: string;
    origem: number;
    centro: number | null;
    residualCent: number;
  },
) => enviar(`${P}/obras/${obra}/ativacao`, x, confiar<{ bem: number }>(), novaChave('pat-ativar'));
export const cancelarObra = (obra: number, x: { versao: number; motivo: string }) =>
  enviar(`${P}/obras/${obra}/cancelamento`, x, confiar<{ versao: number }>(), novaChave('pat-obra-cancelar'));

// ── Seguro ──
export const lerApolices = () => ler(`${P}/apolices`, z.array(confiar<ApoliceLida>()));
export const lerApolice = (id: number) => ler(`${P}/apolices/${id}`, confiar<ApoliceLida>());
export const incluirApolice = (x: {
  numero: string;
  tipo: string;
  seguradora: number | null;
  corretorNome: string | null;
  corretorTelefone: string | null;
  corretorEmail: string | null;
  cobertura: string | null;
  inicio: string;
  fim: string;
  premioCent: number;
  franquiaCent: number | null;
  titulo: number | null;
  anterior: number | null;
}) => enviar(`${P}/apolices`, x, confiar<{ id: number }>(), novaChave('pat-apolice'));
export const segurarBem = (
  apolice: number,
  x: { versao: number; bem: number; valorSeguradoCent: number; inicio: string },
) =>
  enviar(
    `${P}/apolices/${apolice}/bens`,
    x,
    confiar<{ id: number; versao: number }>(),
    novaChave('pat-segurar'),
  );
export const cancelarApolice = (id: number, x: { versao: number; motivo: string }) =>
  enviar(
    `${P}/apolices/${id}/cancelamento`,
    x,
    confiar<{ versao: number }>(),
    novaChave('pat-apolice-cancelar'),
  );
export const retirarBemSegurado = (id: number, x: { data: string; motivo: string }) =>
  enviar(
    `${P}/bens-segurados/${id}/retirada`,
    x,
    confiar<{ versao: number }>(),
    novaChave('pat-segurado-retirar'),
  );
