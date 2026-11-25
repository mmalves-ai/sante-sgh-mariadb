// Respostas da API da agenda de consultas (M17, ficha seções 4 e 7), validadas na tela. Vocabulário do novo:
// nenhum nome de tabela ou coluna do banco; horas já em HH:MM; contato e nome do paciente mascarados nas listas
// (cap-08 §8.4), completos só no detalhe da marcação, com a permissão.
import { z } from 'zod';

const n = z.number().int();
const txt = z.string();
const nul = <T extends z.ZodType>(t: T) => t.nullable();

export const esquemaGravacaoAgenda = z.object({
  /** A funcionalidade (chave agenda.consulta) está ligada para esta pessoa e setor? */
  ligada: z.boolean(),
  motivo: nul(txt),
  /** Pode gravar cada operação agora (passo 0 do executor; permissão da sessão). */
  operacoes: z.record(z.string(), z.object({ pode: z.boolean(), motivo: nul(txt) })),
});
export type GravacaoAgenda = z.infer<typeof esquemaGravacaoAgenda>;

export const esquemaOpcaoCodigo = z.object({ codigo: n, nome: txt });
export const esquemaOpcoesAgenda = z.object({
  convenios: z.array(esquemaOpcaoCodigo.extend({ ativo: z.boolean() })),
  especialidades: z.array(esquemaOpcaoCodigo),
  /** Locais de atendimento e unidades (ligação revisada da agenda; busca de vaga por unidade e local). */
  locais: z.array(esquemaOpcaoCodigo),
  unidades: z.array(esquemaOpcaoCodigo),
  /** Grupos de prioridade legal ativos, na ordem do peso (lista de espera e marcação; 02-AGE 48 e 49). */
  gruposPrioridadeLegal: z.array(esquemaOpcaoCodigo).optional(),
  motivosCancelamento: z.array(z.object({ codigo: txt, texto: txt, solicitante: txt })),
  canais: z.array(z.object({ codigo: txt, rotulo: txt, aConfirmar: z.boolean() })),
  motivosBloqueio: z.array(z.object({ codigo: txt, rotulo: txt })),
  resultadosConfirmacao: z.array(z.object({ codigo: txt, rotulo: txt })),
  /** Relógio do banco do estabelecimento. */
  hoje: txt,
  agora: txt,
});
export type OpcoesAgenda = z.infer<typeof esquemaOpcoesAgenda>;

export const esquemaLigacaoAgenda = z.object({
  profissional: nul(z.object({ id: n, nome: txt })),
  especialidade: nul(esquemaOpcaoCodigo),
  local: nul(esquemaOpcaoCodigo),
  /** Unidade da agenda (a do cadastro, ou a da ligação revisada); null = não informada (vale para todas). */
  unidade: nul(esquemaOpcaoCodigo),
  /** 'proposta' (casamento automático pelo nome) ou 'revisada' (confirmada por pessoa). */
  situacao: z.enum(['sem-ligacao', 'proposta', 'revisada']),
});
export type LigacaoAgenda = z.infer<typeof esquemaLigacaoAgenda>;

export const esquemaAgendaResumo = z.object({
  id: n,
  nome: txt,
  crm: n,
  procedimento: txt,
  profissional: nul(txt),
  duracao: txt,
  ativa: z.boolean(),
  vigente: z.boolean(),
  gradeInicio: nul(txt),
  gradeFim: nul(txt),
  teleatendimento: z.boolean(),
  /** Quantos convênios a agenda aceita; 0 = aceita todos (sem restrição). */
  convenios: n,
  especialidades: n,
  ligacao: esquemaLigacaoAgenda,
});
export type AgendaResumo = z.infer<typeof esquemaAgendaResumo>;

export const esquemaListaAgendas = z.object({
  itens: z.array(esquemaAgendaResumo),
  total: n,
  destino: z.enum(['legado', 'memoria']),
});
export type ListaAgendas = z.infer<typeof esquemaListaAgendas>;

export const esquemaLinhaEscalaResposta = z.object({
  semana: n,
  dia: txt,
  duracao: txt,
  inicio: txt,
  fim: txt,
  intervaloInicio: nul(txt),
  intervaloFim: nul(txt),
});
export type LinhaEscalaResposta = z.infer<typeof esquemaLinhaEscalaResposta>;

export const esquemaDetalheAgenda = z.object({
  agenda: esquemaAgendaResumo,
  versao: z.object({ duracaoMinutos: nul(n), ativa: z.boolean(), teleatendimento: z.boolean() }),
  convenios: z.array(
    esquemaOpcaoCodigo.extend({ ativo: z.boolean(), marcadosFuturos: n, particular: z.boolean() }),
  ),
  aceitaTodos: z.boolean(),
  especialidades: z.array(esquemaOpcaoCodigo),
  escala: z.array(esquemaLinhaEscalaResposta),
  /** Profissionais do cadastro para a revisão da ligação (id e nome). */
  profissionais: z.array(z.object({ id: n, nome: txt })),
  destino: z.enum(['legado', 'memoria']),
});
export type DetalheAgenda = z.infer<typeof esquemaDetalheAgenda>;

export const esquemaEscalaPlanejada = z.object({
  id: n,
  vigenteDesde: txt,
  linhas: z.array(esquemaLinhaEscalaResposta),
  autor: txt,
  em: txt,
});
export const esquemaGeracaoResumo = z.object({
  /** ID da geração do novo; null = geração feita no outro sistema (só consulta). */
  id: nul(n),
  inicio: txt,
  fim: txt,
  em: txt,
  autor: txt,
  situacao: z.enum(['criacao', 'exclusao']),
  duracao: nul(txt),
  dias: z.array(txt),
  horarios: nul(n),
  reversivel: z.boolean(),
  revertida: z.boolean(),
});
export type GeracaoResumo = z.infer<typeof esquemaGeracaoResumo>;

export const esquemaEscalaAgenda = z.object({
  agenda: esquemaAgendaResumo,
  escala: z.array(esquemaLinhaEscalaResposta),
  planejadas: z.array(esquemaEscalaPlanejada),
  geracoes: z.array(esquemaGeracaoResumo),
  truncado: z.boolean(),
});
export type EscalaAgenda = z.infer<typeof esquemaEscalaAgenda>;

export const esquemaAlertaAgenda = z.object({ codigo: txt, texto: txt });

export const esquemaPreviaGrade = z.object({
  agenda: esquemaAgendaResumo,
  de: txt,
  ate: txt,
  duracao: txt,
  horarios: n,
  porDia: z.array(z.object({ data: txt, dia: txt, horarios: z.array(txt) })),
  pulados: z.object({
    feriados: z.array(z.object({ data: txt, nome: txt })),
    bloqueados: n,
    existentes: n,
    cortadosHoje: n,
  }),
  escala: z.array(esquemaLinhaEscalaResposta),
  alertas: z.array(esquemaAlertaAgenda),
  /** Impressão da lista (a gravação confere que a lista não mudou). */
  assinatura: txt,
});
export type PreviaGrade = z.infer<typeof esquemaPreviaGrade>;

export const ESTADOS_HORARIO = [
  'vago',
  'bloqueado',
  'ocupado',
  'encaixe',
  'passado',
  'situacao-especial',
] as const;

export const esquemaHorarioGrade = z.object({
  hora: txt,
  estado: z.enum(ESTADOS_HORARIO),
  situacao: txt,
  rotuloSituacao: txt,
  encaixe: z.boolean(),
  /** Nome do paciente mascarado (iniciais) ou vazio. */
  paciente: txt,
  marcacao: nul(n),
});
export const esquemaGradeSemana = z.object({
  agenda: esquemaAgendaResumo,
  inicio: txt,
  fim: txt,
  dias: z.array(z.object({ data: txt, dia: txt, horarios: z.array(esquemaHorarioGrade) })),
  totais: z.object({ horarios: n, vagos: n, ocupados: n, bloqueados: n, encaixes: n }),
});
export type GradeSemana = z.infer<typeof esquemaGradeSemana>;

export const esquemaVaga = z.object({
  agenda: n,
  nomeAgenda: txt,
  procedimento: txt,
  profissional: nul(txt),
  data: txt,
  hora: txt,
  turno: z.enum(['manha', 'tarde', 'noite']),
  aceitaConvenio: z.boolean(),
});
export const esquemaBuscaVagas = z.object({
  vagas: z.array(esquemaVaga),
  /** Próximo horário livre por agenda (até 90 dias), quando a janela não tem vaga nela. */
  proximas: z.array(z.object({ agenda: n, nomeAgenda: txt, data: txt, hora: txt })),
  de: txt,
  ate: txt,
  recortada: z.boolean(),
  truncado: z.boolean(),
  /** Convênio fora da lista de alguma agenda: até 8 aceitos e as alternativas. */
  recusasCobertura: z.array(
    z.object({
      agenda: n,
      nomeAgenda: txt,
      aceitos: z.array(esquemaOpcaoCodigo),
      totalAceitos: n,
      alternativas: z.array(txt),
    }),
  ),
});
export type BuscaVagas = z.infer<typeof esquemaBuscaVagas>;

export const ESTADOS_MARCACAO = [
  'marcada',
  'confirmada',
  'chegou',
  'atendida',
  'faltou',
  'transferida',
  'outra',
] as const;

export const esquemaMarcacaoResumo = z.object({
  id: n,
  agenda: n,
  nomeAgenda: txt,
  data: txt,
  hora: txt,
  paciente: txt,
  idPaciente: nul(n),
  prontuario: nul(n),
  convenio: n,
  nomeConvenio: nul(txt),
  retorno: z.boolean(),
  encaixe: z.boolean(),
  estado: z.enum(ESTADOS_MARCACAO),
  rotuloSituacao: txt,
  canal: txt,
  canalAConfirmar: z.boolean(),
  marcadaEm: nul(txt),
  /** 02-AGE 49: grupo de prioridade legal da marcação. */
  prioridadeLegal: nul(txt).optional(),
  /** 02-AGE 42: pré-cadastro pendente da marcação sem prontuário (a tela converte ali mesmo); null sem nada a converter. */
  preCadastroAConverter: nul(n).optional(),
  risco: z.object({ percentual: nul(z.number()), nivel: z.enum(['baixo', 'medio', 'alto', 'desconhecido']) }),
  acoes: z.object({
    cancelar: z.boolean(),
    remarcar: z.boolean(),
    confirmar: z.boolean(),
    registrarFalta: z.boolean(),
    desfazerEncaixe: z.boolean(),
  }),
});
export type MarcacaoResumo = z.infer<typeof esquemaMarcacaoResumo>;

export const esquemaMarcacaoDetalhe = esquemaMarcacaoResumo.extend({
  telefone: txt,
  celular: txt,
  observacao: nul(txt),
  marcadaPor: nul(txt),
  remarcadaDe: nul(n),
  confirmacoes: z.array(z.object({ resultado: txt, rotulo: txt, em: txt, por: txt })),
  temSenha: z.boolean(),
});
export type MarcacaoDetalhe = z.infer<typeof esquemaMarcacaoDetalhe>;

export const esquemaPainelDia = z.object({
  agenda: nul(esquemaAgendaResumo),
  data: txt,
  marcacoes: z.array(esquemaMarcacaoResumo),
  resumo: z.object({ total: n, porEstado: z.record(z.string(), n), riscoAlto: n }),
  candidatosAFalta: z.array(n),
  agora: txt,
});
export type PainelDia = z.infer<typeof esquemaPainelDia>;

export const esquemaMarcacoesPaciente = z.object({
  paciente: n,
  marcacoes: z.array(esquemaMarcacaoResumo),
  truncado: z.boolean(),
  /** Possíveis, a confirmar: marcações sem vínculo com o cadastro, com o mesmo nome (mascarado na lista). */
  possiveis: z.array(esquemaMarcacaoResumo),
  /** Pré-cadastros da agenda sem prontuário com o mesmo nome e nascimento. */
  preCadastros: z.array(z.object({ nomeAgenda: txt, data: nul(txt) })),
});
export type MarcacoesPaciente = z.infer<typeof esquemaMarcacoesPaciente>;

/** Marcações futuras da agenda com um convênio (aviso antes de remover o convênio da cobertura; nome mascarado). */
export const esquemaMarcadosComConvenio = z.object({
  agenda: n,
  convenio: n,
  itens: z.array(esquemaMarcacaoResumo),
  truncado: z.boolean(),
});
export type MarcadosComConvenio = z.infer<typeof esquemaMarcadosComConvenio>;

export const esquemaCancelamento = z.object({
  protocolo: n,
  agenda: txt,
  data: txt,
  hora: txt,
  paciente: txt,
  canceladoEm: txt,
  canceladoPor: nul(txt),
  motivo: txt,
  /** Código padronizado (cancelamentos feitos no novo); null = texto livre do outro sistema. */
  motivoCodigo: nul(txt),
  solicitante: nul(txt),
});
export const esquemaListaCancelamentos = z.object({
  itens: z.array(esquemaCancelamento),
  total: n,
  pagina: n,
  porPagina: n,
  de: txt,
  ate: txt,
  recortada: z.boolean(),
});
export type ListaCancelamentos = z.infer<typeof esquemaListaCancelamentos>;

export const esquemaBloqueio = z.object({
  id: n,
  agenda: n,
  nomeAgenda: txt,
  inicio: txt,
  fim: txt,
  horaInicio: nul(txt),
  horaFim: nul(txt),
  motivo: txt,
  rotuloMotivo: txt,
  complemento: nul(txt),
  previsaoRetorno: nul(txt),
  horarios: n,
  autor: txt,
  em: txt,
  ativo: z.boolean(),
});
export type Bloqueio = z.infer<typeof esquemaBloqueio>;
export const esquemaListaBloqueios = z.object({ itens: z.array(esquemaBloqueio) });

export const esquemaPreviaBloqueio = z.object({
  horariosLivres: z.array(z.object({ data: txt, hora: txt })),
  marcados: z.array(esquemaMarcacaoResumo),
  jaBloqueados: n,
});
export type PreviaBloqueio = z.infer<typeof esquemaPreviaBloqueio>;

export const esquemaItemEspera = z.object({
  id: n,
  paciente: txt,
  idPaciente: n,
  agenda: nul(n),
  nomeAgenda: nul(txt),
  especialidade: nul(esquemaOpcaoCodigo),
  prioridade: z.enum(['normal', 'preferencial', 'urgente']),
  /** Grupo de prioridade legal (o mesmo da senha e da marcação), com o peso que ordena a fila. */
  prioridadeLegal: nul(z.object({ id: n, descricao: txt, peso: n })),
  situacao: z.enum(['aguardando', 'ofertado', 'atendido', 'cancelado']),
  desde: txt,
  observacao: nul(txt),
  oferta: nul(z.object({ agenda: n, data: txt, hora: txt })),
  posicao: nul(n),
});
export type ItemEspera = z.infer<typeof esquemaItemEspera>;
export const esquemaListaEspera = z.object({ itens: z.array(esquemaItemEspera), total: n });
export type ListaEspera = z.infer<typeof esquemaListaEspera>;

export const esquemaIndicadoresAgenda = z.object({
  de: txt,
  ate: txt,
  recortada: z.boolean(),
  funil: z.object({
    horariosOfertados: n,
    nuncaPreenchidos: n,
    marcados: n,
    cancelados: n,
    compareceu: n,
    faltou: n,
    encaixes: n,
    ocupacao: z.number(),
    taxaCancelamento: z.number(),
    absenteismo: z.number(),
    conversaoEmAtendimento: z.number(),
  }),
  ocupacao: z.array(z.object({ chave: txt, horarios: n, ocupados: n, livres: n, ocupacao: z.number() })),
  absenteismoPorAntecedencia: z.array(
    z.object({ chave: txt, marcados: n, compareceu: n, faltou: n, absenteismo: z.number() }),
  ),
  absenteismoPorEspecialidade: z.array(
    z.object({ chave: txt, marcados: n, compareceu: n, faltou: n, absenteismo: z.number() }),
  ),
  porCanal: z.array(z.object({ canal: txt, marcados: n })),
});
export type IndicadoresAgenda = z.infer<typeof esquemaIndicadoresAgenda>;

export const esquemaResultadoAgenda = z.object({
  ok: z.literal(true),
  resultado: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])),
  repetida: z.boolean(),
  mensagem: txt,
});
export type ResultadoAgenda = z.infer<typeof esquemaResultadoAgenda>;

export const esquemaResultadoLote = z.object({
  itens: z.array(z.object({ marcacao: n, ok: z.boolean(), mensagem: txt, nova: nul(n) })),
  feitos: n,
  recusados: n,
});
export type ResultadoLote = z.infer<typeof esquemaResultadoLote>;
