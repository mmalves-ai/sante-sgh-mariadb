// Cliente da promoção da saúde e gestão de crônicos da operadora (08-SGO L115, C2-102; RN ANS 264 e 265/2011):
// programas, critérios de elegibilidade, elegíveis, participantes, agenda de visitas, avaliação de risco, custo do
// crônico e bonificação. Respostas validadas aqui; Problem Details viram ErroApi.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const A = '/api/operadora/programas-saude';
const n = z.number();
const tn = z.string().nullable();
const nn = n.nullable();
const gravado = z.object({ id: n, versao: n }).passthrough();

export const TIPOS_PROGRAMA = {
  promocao_saude: 'Promoção da saúde',
  prevencao_risco: 'Prevenção de riscos',
  gestao_cronicos: 'Gestão de crônicos',
  gestacao: 'Gestação',
  envelhecimento_ativo: 'Envelhecimento ativo',
  saude_mental: 'Saúde mental',
  outro: 'Outro',
} as const;
export const TIPOS_CRITERIO = {
  cid: 'Diagnóstico (CID-10) nas contas',
  procedimento: 'Procedimento (TUSS) nas contas',
  idade: 'Faixa de idade (recorte)',
  internacao: 'Internações na janela',
  pronto_socorro: 'Urgências na janela',
  custo: 'Custo assistencial na janela',
  escore: 'Escore da avaliação de risco',
} as const;
export const TIPOS_CONTATO = {
  telefone: 'Telefone',
  visita_domiciliar: 'Visita domiciliar',
  consulta: 'Consulta',
  teleconsulta: 'Teleconsulta',
  mensagem: 'Mensagem',
  atividade_grupo: 'Atividade em grupo',
} as const;
export const MOTIVOS_SAIDA = {
  alta_programa: 'Alta do programa',
  abandono: 'Abandono',
  obito: 'Óbito',
  exclusao_plano: 'Exclusão do plano',
  transferencia: 'Transferência',
  outro: 'Outro',
} as const;
export const CLASSES_RISCO = {
  baixo: 'Baixo',
  moderado: 'Moderado',
  alto: 'Alto',
  muito_alto: 'Muito alto',
} as const;

const esquemaCriterio = z.object({
  id: n,
  versao: n,
  tipo: z.string(),
  termo: nn,
  grupoPatologia: nn,
  ocorrenciasMinimas: nn,
  periodoMeses: nn,
  idadeMinima: nn,
  idadeMaxima: nn,
  custoMensalMinimo: nn,
  custoPeriodoMinimo: nn,
  escoreMinimo: nn,
  formaAlerta: z.string(),
  ativo: z.boolean(),
});
export type Criterio = z.infer<typeof esquemaCriterio>;
const esquemaBonificacao = z.object({
  id: n,
  versao: n,
  codigo: z.string(),
  descricao: z.string(),
  tipoBeneficio: z.string(),
  percentualDesconto: nn,
  valorBonus: nn,
  adesaoMinimaPercentual: nn,
  vigenciaInicio: z.string(),
  vigenciaFim: tn,
  ativo: z.boolean(),
});
export const esquemaPrograma = z.object({
  id: n,
  versao: n,
  codigo: z.string(),
  nome: z.string(),
  tipo: z.string(),
  objetivo: tn,
  publicoAlvo: tn,
  metas: tn,
  grupoRisco: nn,
  grupoRiscoDescricao: tn,
  registradoAns: z.boolean(),
  numeroRegistroAns: tn,
  isentaCoparticipacao: z.boolean(),
  vigenciaInicio: z.string(),
  vigenciaFim: tn,
  situacao: z.string(),
  participantesAtivos: n,
  criterios: z.array(esquemaCriterio),
  bonificacoes: z.array(esquemaBonificacao),
});
export type Programa = z.infer<typeof esquemaPrograma>;
export const esquemaElegivel = z.object({
  beneficiario: n,
  matricula: z.string(),
  nome: z.string(),
  idade: nn,
  motivos: z.array(z.string()),
  forma: tn,
});
export type Elegivel = z.infer<typeof esquemaElegivel>;
export const esquemaParticipante = z.object({
  id: n,
  versao: n,
  programa: n,
  programaNome: z.string(),
  beneficiario: n,
  matricula: z.string(),
  nome: z.string(),
  grupoRisco: nn,
  grupoRiscoDescricao: tn,
  entrada: z.string(),
  saida: tn,
  motivoSaida: tn,
  situacao: z.string(),
  ultimaClassificacao: tn,
  proximoContato: tn,
});
export type Participante = z.infer<typeof esquemaParticipante>;
export const esquemaContato = z.object({
  id: n,
  versao: n,
  participante: n,
  nome: z.string(),
  programaNome: z.string(),
  tipo: z.string(),
  agendadoPara: tn,
  realizadoEm: tn,
  situacao: z.string(),
  resultado: tn,
  proximoContato: tn,
});
export type Contato = z.infer<typeof esquemaContato>;
const esquemaAgenda = z.object({
  atrasados: z.array(esquemaContato),
  hoje: z.array(esquemaContato),
  proximos: z.array(esquemaContato),
});
export type Agenda = z.infer<typeof esquemaAgenda>;
const esquemaPergunta = z.object({
  id: n,
  sequencia: n,
  enunciado: z.string(),
  tipoResposta: z.string(),
  obrigatoria: z.boolean(),
  opcoes: z.array(z.object({ codigo: z.string(), descricao: z.string(), pontos: n.optional() })),
  respostaIndicativa: tn,
});
export const esquemaQuestionario = z.object({
  id: n,
  codigo: z.string(),
  nome: z.string(),
  numeroVersao: n,
  exigeTodas: z.boolean(),
  perguntas: z.array(esquemaPergunta),
});
export type Questionario = z.infer<typeof esquemaQuestionario>;
const lado = z.object({ total: n, meses: n, media: n });
const esquemaCusto = z.object({
  participantes: z.array(
    z.object({
      participante: n,
      nome: z.string(),
      matricula: z.string(),
      entrada: z.string(),
      situacao: z.string(),
      antes: lado,
      depois: lado,
      variacaoPercentual: nn,
    }),
  ),
  antes: n,
  depois: n,
  variacaoPercentual: nn,
  janela: n,
});
export type Custo = z.infer<typeof esquemaCusto>;
const esquemaBonificacaoApurada = z.object({
  participante: n,
  nome: z.string(),
  matricula: z.string(),
  adesao: z.object({ realizados: n, devidos: n, percentual: nn }),
  bonificacoes: z.array(
    z.object({ codigo: z.string(), descricao: z.string(), direito: z.boolean(), motivo: z.string() }),
  ),
});
export type BonificacaoApurada = z.infer<typeof esquemaBonificacaoApurada>;
const esquemaVisao = z.object({
  participacoes: z.array(esquemaParticipante),
  contatos: z.array(esquemaContato),
  avaliacoes: z.array(
    z.object({
      id: n,
      participante: n,
      aplicadoEm: tn,
      escore: nn,
      classificacao: tn,
      questionario: z.string(),
    }),
  ),
});
export type VisaoBeneficiario = z.infer<typeof esquemaVisao>;
export const esquemaGrupoRisco = z.object({
  id: n,
  versao: n,
  codigo: z.string(),
  descricao: z.string(),
  prioridade: nn,
  ativo: z.boolean(),
});
export type GrupoRisco = z.infer<typeof esquemaGrupoRisco>;

export interface EntradaPrograma {
  codigo: string;
  nome: string;
  tipo: string;
  objetivo: string | null;
  publicoAlvo: string | null;
  metas: string | null;
  grupoRisco: number | null;
  registradoAns: boolean;
  numeroRegistroAns: string | null;
  isentaCoparticipacao: boolean;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  situacao: string;
}
export type EntradaCriterio = Omit<Criterio, 'id' | 'versao' | 'ativo'>;

export const lerProgramas = () => ler(A, z.array(esquemaPrograma));
export const incluirPrograma = (c: EntradaPrograma) => enviar(A, c, gravado, novaChave('prog-saude'));
export const incluirCriterio = (p: number, c: EntradaCriterio) =>
  enviar(`${A}/${p}/criterios`, c, gravado, novaChave('prog-criterio'));
export const desativarCriterio = (id: number, versao: number) =>
  enviar(`${A}/criterios/${id}/desativacao`, { versao }, gravado, novaChave('prog-criterio-off'));
export const lerElegiveis = (p: number) => ler(`${A}/${p}/elegiveis`, z.array(esquemaElegivel));
export const lerParticipantes = (p: number) => ler(`${A}/${p}/participantes`, z.array(esquemaParticipante));
export const incluirParticipante = (
  p: number,
  c: {
    beneficiario: number;
    entrada: string;
    grupoRisco: number | null;
    responsavel: number | null;
    observacao: string | null;
  },
) => enviar(`${A}/${p}/participantes`, c, gravado, novaChave('prog-participante'));
export const encerrarParticipante = (
  id: number,
  c: { versao: number; saida: string; motivo: string; observacao: string | null },
) => enviar(`${A}/participantes/${id}/saida`, c, gravado, novaChave('prog-saida'));
export const registrarContato = (
  id: number,
  c: {
    tipo: string;
    situacao: 'agendado' | 'realizado';
    agendadoPara: string | null;
    realizadoEm: string | null;
    resultado: string | null;
    proximoContato: string | null;
  },
) => enviar(`${A}/participantes/${id}/contatos`, c, gravado, novaChave('prog-contato'));
export const baixarContato = (
  id: number,
  c: {
    versao: number;
    situacao: string;
    realizadoEm: string | null;
    resultado: string | null;
    proximoContato: string | null;
  },
) => enviar(`${A}/contatos/${id}/baixa`, c, gravado, novaChave('prog-baixa'));
export const aplicarAvaliacao = (
  id: number,
  c: {
    questionario: number;
    canal: string;
    respostas: {
      pergunta: number;
      opcao?: string | null;
      numero?: number | null;
      data?: string | null;
      texto?: string | null;
    }[];
    observacao: string | null;
  },
) =>
  enviar(
    `${A}/participantes/${id}/avaliacoes`,
    c,
    gravado.extend({ escore: n, maximo: n, classificacao: tn }),
    novaChave('prog-avaliacao'),
  );
export const lerAgenda = (p: number | null) =>
  ler(`${A}/agenda${p === null ? '' : `?programa=${p}`}`, esquemaAgenda);
export const lerQuestionarios = () => ler(`${A}/questionarios`, z.array(esquemaQuestionario));
export const lerGruposRisco = () => ler(`${A}/grupos-risco`, z.array(esquemaGrupoRisco));
export const lerCusto = (p: number, janela: number) => ler(`${A}/${p}/custo?janela=${janela}`, esquemaCusto);
export const lerBonificacao = (p: number) => ler(`${A}/${p}/bonificacao`, z.array(esquemaBonificacaoApurada));
export const lerVisaoBeneficiario = (b: number) => ler(`${A}/beneficiarios/${b}`, esquemaVisao);
