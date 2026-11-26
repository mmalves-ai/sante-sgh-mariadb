// Respostas da API do centro cirúrgico (M18, ficha seções 4 e 7), validadas na tela. Vocabulário do novo: nenhum
// nome de tabela ou coluna; horas já em HH:MM; o nome do paciente mascarado no mapa e nas listas (completo só no
// detalhe, com a permissão); o sentinela de profissional nunca aparece (equipe sem os "não informado").
import { z } from 'zod';

const n = z.number().int();
const txt = z.string();
const nul = <T extends z.ZodType>(t: T) => t.nullable();

export const esquemaSalaCirurgica = z.object({
  codigo: n,
  nome: txt,
  centroCusto: n,
  usuarios: n,
  /** A pessoa da sessão pode agendar e registrar nesta sala (usuários permitidos da sala, nos dois sistemas). */
  permitida: z.boolean(),
});
export type SalaCirurgica = z.infer<typeof esquemaSalaCirurgica>;

export const esquemaMembroEquipe = z.object({ funcao: txt, rotulo: txt, id: n, nome: txt });

export const ESTADOS_CIRURGIA = [
  'solicitado',
  'confirmado',
  'no-bloco',
  'em-sala',
  'realizado',
  'suspenso',
  'cancelado',
  /** Migrada sem situação na origem: só consulta, cancelar ou reagendar. */
  'nao-informada',
] as const;

export const esquemaAgendamentoCirurgico = z.object({
  /** Id do agendamento na sala; null para a solicitação que ainda não ocupa a sala. */
  id: nul(n),
  /** O registro do novo (estado, motivo, pendências); null para o agendamento feito fora destas telas. */
  estadoId: nul(n),
  sala: n,
  data: txt,
  hora: txt,
  fim: txt,
  duracaoMin: n,
  intervaloMin: n,
  paciente: txt,
  prontuario: n,
  reg: n,
  atendimento: txt,
  convenio: n,
  procedimento: z.object({ codigo: n, nome: txt }),
  especialidade: n,
  anestesia: z.object({ codigo: n, nome: txt }),
  equipe: z.array(esquemaMembroEquipe),
  recursos: z.array(txt),
  observacao: txt,
  estado: z.enum(ESTADOS_CIRURGIA),
  estadoRotulo: txt,
  /** Cruza com outro agendamento da mesma sala (gravado fora destas telas, ou exceção de urgência). */
  sobreposto: z.boolean(),
  /** Data fora de 1990–2099 (erro antigo de digitação): mostrada com alerta, fora da conta. */
  dataImpossivel: z.boolean(),
  excecao: z.boolean(),
  pendencias: n,
  realizada: nul(n),
  /**
   * M50 (etapa 3): o pedido feito pelo médico externo no portal — quem pediu e o paciente como ele informou (mascarado
   * no mapa; completo no detalhe, para a secretaria localizar o cadastro ao confirmar). No detalhe vem também o registro
   * do cirurgião com o código: ele entra nas opções da confirmação mesmo que ainda não tenha atuado no bloco.
   */
  pedidoPortal: nul(
    z.object({
      medico: txt,
      paciente: txt,
      nascimento: nul(txt),
      cirurgiao: nul(z.object({ id: n, cod: n, nome: txt })).optional(),
    }),
  ).optional(),
});
export type AgendamentoCirurgico = z.infer<typeof esquemaAgendamentoCirurgico>;

export const esquemaDiaDoMapa = z.object({
  dia: txt,
  salas: z.array(
    z.object({
      sala: n,
      ocupacao: z.number(),
      agendamentos: z.array(esquemaAgendamentoCirurgico),
    }),
  ),
});

export const esquemaMapaCirurgico = z.object({
  de: txt,
  ate: txt,
  abertura: txt,
  fechamento: txt,
  salas: z.array(esquemaSalaCirurgica),
  dias: z.array(esquemaDiaDoMapa),
  solicitacoes: z.array(esquemaAgendamentoCirurgico),
  sobreposicoes: n,
  datasImpossiveis: n,
  preparoMinimoMin: n,
  destino: z.enum(['banco', 'memoria']),
});
export type MapaCirurgico = z.infer<typeof esquemaMapaCirurgico>;

export const esquemaPendenciaCirurgia = z.object({
  id: n,
  tipo: txt,
  rotulo: txt,
  situacao: txt,
  observacao: nul(txt),
  atualizadoPor: nul(txt),
  atualizadoEm: nul(txt),
});

export const esquemaHistoricoCirurgia = z.object({
  quando: txt,
  usuario: txt,
  operacao: txt,
  salaAnterior: nul(n),
  inicioAnterior: nul(txt),
  sala: nul(n),
  inicio: nul(txt),
  justificativa: nul(txt),
});

export const esquemaListaHistoricoCirurgia = z.object({
  itens: z.array(esquemaHistoricoCirurgia.extend({ paciente: txt, reg: nul(n) })),
  truncado: z.boolean(),
});
export type ListaHistoricoCirurgia = z.infer<typeof esquemaListaHistoricoCirurgia>;

export const esquemaDetalheAgendamento = z.object({
  agendamento: esquemaAgendamentoCirurgico,
  pacienteNome: txt,
  idPaciente: nul(n),
  pendencias: z.array(esquemaPendenciaCirurgia),
  historico: z.array(esquemaHistoricoCirurgia),
  motivo: nul(z.object({ codigo: txt, texto: txt, complemento: nul(txt), solicitante: nul(txt) })),
  conflitos: z.array(z.object({ id: n, inicio: txt, duracaoMin: n })),
  procedimentosAdicionais: z.array(z.object({ codigo: n, nome: txt })),
});
export type DetalheAgendamento = z.infer<typeof esquemaDetalheAgendamento>;

export const esquemaCancelamentoCirurgia = z.object({
  id: n,
  sala: n,
  data: txt,
  hora: txt,
  paciente: txt,
  procedimento: n,
  canceladoEm: txt,
  canceladoPor: txt,
  motivo: nul(txt),
});
export const esquemaListaCancelamentosCirurgia = z.object({
  itens: z.array(esquemaCancelamentoCirurgia),
  truncado: z.boolean(),
});
export type ListaCancelamentosCirurgia = z.infer<typeof esquemaListaCancelamentosCirurgia>;

export const esquemaProcedimentoDoRegistro = z.object({
  procedimento: z.object({ codigo: n, nome: txt }),
  especialidade: n,
  tecnica: n,
  equipe: z.array(esquemaMembroEquipe),
});

export const esquemaCirurgiaRealizada = z.object({
  id: n,
  reg: n,
  data: txt,
  sala: n,
  porte: txt,
  potencialContaminacao: txt,
  tipoAnestesia: z.object({ codigo: n, nome: txt }),
  inicio: txt,
  fim: txt,
  duracao: txt,
  paciente: txt,
  procedimentos: z.array(esquemaProcedimentoDoRegistro),
  /** Casamento com o agendamento: registrado pelo novo, ou a sugestão por atendimento, sala e data. */
  ligacao: z.object({
    tipo: z.enum(['registro', 'revisao', 'exato', 'reg-e-dia', 'so-reg', 'ambiguo', 'nenhum']),
    agendamento: nul(n),
    candidatos: z.array(n),
  }),
  extensao: nul(
    z.object({
      entradaSala: nul(txt),
      incisao: nul(txt),
      saidaSala: nul(txt),
      asa: nul(n),
      observacao: nul(txt),
    }),
  ),
});
export type CirurgiaRealizada = z.infer<typeof esquemaCirurgiaRealizada>;

export const esquemaListaRealizadas = z.object({
  itens: z.array(esquemaCirurgiaRealizada),
  truncado: z.boolean(),
  resumo: z.object({ registro: n, revisao: n, exato: n, regEDia: n, soReg: n, ambiguo: n, nenhum: n }),
});
export type ListaRealizadas = z.infer<typeof esquemaListaRealizadas>;

export const esquemaOpcoesCirurgia = z.object({
  salas: z.array(esquemaSalaCirurgica),
  anestesias: z.array(z.object({ codigo: n, nome: txt })),
  caracteres: z.array(z.object({ codigo: n, nome: txt })),
  convenios: z.array(z.object({ codigo: n, nome: txt, ativo: z.boolean() })),
  especialidades: z.array(z.object({ codigo: n, nome: txt })),
  profissionais: z.array(z.object({ id: n, cod: n, nome: txt })),
  motivos: z.array(z.object({ codigo: txt, texto: txt, solicitante: txt })),
  pendencias: z.array(z.object({ codigo: txt, rotulo: txt })),
  recursos: z.array(z.object({ campo: txt, rotulo: txt })),
  preparoMinimoMin: n,
  hoje: txt,
  agora: txt,
});
export type OpcoesCirurgia = z.infer<typeof esquemaOpcoesCirurgia>;

export const esquemaUsuariosDaSala = z.object({
  sala: esquemaSalaCirurgica,
  usuarios: z.array(z.object({ login: txt, nome: txt, ativo: z.boolean() })),
  total: n,
});
export type UsuariosDaSala = z.infer<typeof esquemaUsuariosDaSala>;
