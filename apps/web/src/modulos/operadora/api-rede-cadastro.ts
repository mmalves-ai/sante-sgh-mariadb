// Cliente do cadastro complementar do prestador da rede credenciada (08-SGO L101, C2-118): locais de atendimento,
// especialidades atendidas, qualificação divulgada, suspensão e os registros de descredenciamento. Respostas validadas
// aqui; Problem Details viram ErroApi.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const P = '/api/operadora/prestadores';
const C = '/api/operadora/rede-cadastro';
const n = z.number();
const tn = z.string().nullable();
const nn = n.nullable();
const b = z.boolean();
const gravado = z.object({ id: n, versao: n }).passthrough();
export type Gravado = z.infer<typeof gravado>;

export const MOTIVOS_SUSPENSAO = {
  documentacao_vencida: 'Documentação vencida',
  auditoria: 'Auditoria',
  qualidade: 'Qualidade',
  pedido_prestador: 'Pedido do prestador',
  decisao_administrativa: 'Decisão administrativa',
  decisao_judicial: 'Decisão judicial',
  outro: 'Outro',
} as const;
export const SITUACOES_SUSPENSAO = {
  programada: 'Programada',
  ativa: 'Em vigor',
  encerrada: 'Encerrada',
  cancelada: 'Cancelada',
} as const;
export const TIPOS_MOTIVO_DESCREDENCIAMENTO = {
  pedido_prestador: 'Pedido do prestador',
  iniciativa_operadora: 'Iniciativa da operadora',
  qualidade: 'Qualidade',
  fraude: 'Fraude',
  encerramento_atividade: 'Encerramento da atividade',
  outro: 'Outro',
} as const;
export const SITUACOES_DESCREDENCIAMENTO = {
  agendado: 'Agendado',
  efetivado: 'Efetivado',
  cancelado: 'Cancelado',
  reincluido: 'Reincluído',
} as const;

const esquemaLocal = z.object({
  id: n,
  versao: n,
  sequencia: n,
  nome: tn,
  cnes: tn,
  cep: z.string(),
  logradouro: z.string(),
  numero: tn,
  complemento: tn,
  bairro: tn,
  municipioIbge: n,
  latitude: nn,
  longitude: nn,
  telefone: tn,
  email: tn,
  acessivelCadeirante: b,
  estacionamento: b,
  principal: b,
  divulga: b,
  ativo: b,
  desligadoEm: tn,
  motivoDesligamento: tn,
});
const esquemaEspecialidade = z.object({
  id: n,
  versao: n,
  especialidade: n,
  descricao: z.string(),
  local: nn,
  ambulatorio: b,
  internacao: b,
  urgencia: b,
  hospitalDia: b,
  adulto: b,
  pediatrico: b,
  rqe: tn,
  principal: b,
  divulga: b,
  situacao: z.string(),
});
const esquemaQualificacao = z.object({
  id: n,
  versao: n,
  atributo: n,
  codigoAtributo: z.string(),
  descricaoAtributo: z.string(),
  nivel: tn,
  titulo: tn,
  divulga: b,
  vigenciaInicio: z.string(),
  vigenciaFim: tn,
  vigente: b,
});
const esquemaSuspensao = z.object({
  id: n,
  versao: n,
  motivo: z.string(),
  local: nn,
  desde: z.string(),
  reativadoEm: tn,
  situacao: z.enum(['programada', 'ativa', 'encerrada', 'cancelada']),
  observacao: tn,
});
const esquemaDescredenciamento = z.object({
  id: n,
  tipoMotivo: z.string(),
  motivo: z.string(),
  avisoBeneficiariosEm: z.string(),
  efetivoEm: z.string(),
  substituto: nn,
  nomeSubstituto: tn,
  autorizacaoAns: tn,
  situacao: z.string(),
  registradoEm: tn,
});
export const esquemaFichaCadastro = z.object({
  prestador: z.object({ id: n, nome: z.string(), pessoa: z.enum(['F', 'J']), hospitalar: b, credenciado: b }),
  locais: z.array(esquemaLocal),
  especialidades: z.array(esquemaEspecialidade),
  qualificacoes: z.array(esquemaQualificacao),
  suspensoes: z.array(esquemaSuspensao),
  descredenciamentos: z.array(esquemaDescredenciamento),
  suspensoHoje: b,
});
export type FichaCadastro = z.infer<typeof esquemaFichaCadastro>;
export type LocalRede = z.infer<typeof esquemaLocal>;
const esquemaApoio = z.object({
  especialidades: z.array(z.object({ id: n, codigo: z.string(), descricao: z.string() })),
  atributos: z.array(
    z.object({
      id: n,
      codigo: z.string(),
      descricao: z.string(),
      sigla: tn,
      pessoaFisica: b,
      pessoaJuridica: b,
      hospital: b,
    }),
  ),
});
export type ApoioCadastro = z.infer<typeof esquemaApoio>;

export interface NovoLocal {
  nome: string | null;
  cnes: string | null;
  cep: string;
  logradouro: string;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  municipioIbge: number;
  latitude: number | null;
  longitude: number | null;
  telefone: string | null;
  email: string | null;
  acessivelCadeirante: boolean;
  estacionamento: boolean;
  principal: boolean;
  divulga: boolean;
}
export interface NovaEspecialidade {
  especialidade: number;
  local: number | null;
  ambulatorio: boolean;
  internacao: boolean;
  urgencia: boolean;
  hospitalDia: boolean;
  adulto: boolean;
  pediatrico: boolean;
  rqe: string | null;
  principal: boolean;
  divulga: boolean;
}
export interface NovaQualificacao {
  atributo: number;
  nivel: string | null;
  titulo: string | null;
  divulga: boolean;
  vigenciaInicio: string;
  vigenciaFim: string | null;
}
export interface NovaSuspensao {
  motivo: keyof typeof MOTIVOS_SUSPENSAO;
  local: number | null;
  desde: string;
  reativacaoPrevista: string | null;
  observacao: string | null;
}

export const lerApoioCadastro = (): Promise<ApoioCadastro> => ler(`${C}/apoio`, esquemaApoio);
export const lerFichaCadastro = (prestador: number): Promise<FichaCadastro> =>
  ler(`${P}/${prestador}/cadastro`, esquemaFichaCadastro);

const post = (url: string, corpo: unknown, rotulo: string) => enviar(url, corpo, gravado, novaChave(rotulo));
export const incluirLocal = (prestador: number, l: NovoLocal) =>
  post(`${P}/${prestador}/locais`, l, 'rede-local');
export const desligarLocal = (id: number, versao: number, desligadoEm: string, motivo: string) =>
  post(`${C}/locais/${id}/desligamento`, { versao, desligadoEm, motivo }, 'rede-local-fim');
export const incluirEspecialidade = (prestador: number, e: NovaEspecialidade) =>
  post(`${P}/${prestador}/especialidades`, e, 'rede-especialidade');
export const encerrarEspecialidade = (id: number, versao: number) =>
  post(`${C}/especialidades/${id}/encerramento`, { versao }, 'rede-especialidade-fim');
export const incluirQualificacao = (prestador: number, q: NovaQualificacao) =>
  post(`${P}/${prestador}/qualificacoes`, q, 'rede-qualificacao');
export const encerrarQualificacao = (id: number, versao: number, vigenciaFim: string) =>
  post(`${C}/qualificacoes/${id}/encerramento`, { versao, vigenciaFim }, 'rede-qualificacao-fim');
export const suspenderPrestador = (prestador: number, s: NovaSuspensao) =>
  post(`${P}/${prestador}/suspensoes`, s, 'rede-suspensao');
export const reativarPrestador = (id: number, versao: number, reativadoEm: string) =>
  post(`${C}/suspensoes/${id}/reativacao`, { versao, reativadoEm }, 'rede-reativacao');
