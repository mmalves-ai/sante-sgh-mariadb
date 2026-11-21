// Respostas das telas da recepção (M19; ficha, seção 7). Nenhum nome de tabela do legado; o nome do paciente só
// aparece na tela do guichê com a permissão, e nunca no painel em área comum (iniciais no máximo, regra 6).
import { z } from 'zod';

const txt = z.string();
const n = z.number();
const nul = <T extends z.ZodType>(t: T) => t.nullable();

export const esquemaGravacaoRecepcao = z.object({
  /** A funcionalidade (chave recepcao.senha) está ligada para esta pessoa, setor e guichê? */
  ligada: z.boolean(),
  motivo: nul(txt),
  operacoes: z.record(z.string(), z.object({ pode: z.boolean(), motivo: nul(txt) })),
});
export type GravacaoRecepcao = z.infer<typeof esquemaGravacaoRecepcao>;

export const esquemaResultadoRecepcao = z.object({
  ok: z.literal(true),
  resultado: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])),
  repetida: z.boolean(),
  mensagem: txt,
});
export type ResultadoRecepcao = z.infer<typeof esquemaResultadoRecepcao>;

// ── Estrutura (recepções, locais, geradores, guichês) ───────────────────────────────────────────

export const esquemaGeradorLido = z.object({
  id: n,
  recepcao: n,
  letra: txt,
  nome: txt,
  tipo: txt,
  ativo: z.boolean(),
  prioritaria: z.boolean(),
  limiteDia: n,
  /** Configuração do novo (SGH_REC_FILA_CFG); padrão sem linha. */
  ordem: txt,
  intercalar: n,
  tempoAlvoMinutos: n,
  rotuloTotem: nul(txt),
  noTotem: z.boolean(),
});
export type GeradorLido = z.infer<typeof esquemaGeradorLido>;

export const esquemaLocalRecepcao = z.object({
  id: n,
  cod: n,
  descricao: txt,
  ativo: z.boolean(),
  /** Locais para onde este local encaminha (destinos de encaminhamento do cadastro). */
  encaminha: z.array(n),
});
export type LocalRecepcao = z.infer<typeof esquemaLocalRecepcao>;

export const esquemaRecepcaoLida = z.object({
  id: n,
  descricao: txt,
  locais: z.array(esquemaLocalRecepcao),
  geradores: z.array(esquemaGeradorLido),
  /** Guichês cadastrados (vazio: qualquer número de 1 a 99, como o legado aceita). */
  guiches: z.array(n),
});
export type RecepcaoLida = z.infer<typeof esquemaRecepcaoLida>;

export const esquemaGuicheEmUso = z.object({
  recepcao: n,
  local: n,
  guiche: n,
  /** Quem está no guichê: a própria sessão, outra pessoa (deste ou do outro sistema) ou ninguém. */
  ocupadoPor: z.enum(['voce', 'outro']),
  /** Login de quem ocupa (só para quem pode liberar guichês). */
  usuario: nul(txt),
});
export type GuicheEmUso = z.infer<typeof esquemaGuicheEmUso>;

export const esquemaApoioRecepcao = z.object({
  recepcoes: z.array(esquemaRecepcaoLida),
  guichesEmUso: z.array(esquemaGuicheEmUso),
  /** O guichê aberto por esta sessão, se houver. */
  meuGuiche: nul(z.object({ recepcao: n, local: n, guiche: n })),
  hoje: txt,
  agora: txt,
  motivosSuspensao: z.array(z.object({ codigo: txt, texto: txt })),
});
export type ApoioRecepcao = z.infer<typeof esquemaApoioRecepcao>;

// ── Fila e senhas ────────────────────────────────────────────────────────────────────────────────

export const esquemaSenhaLida = z.object({
  id: n,
  numero: n,
  /** Letra do gerador + número (ex.: "MC 012"): o que o paciente vê no papel e no painel. */
  texto: txt,
  gerador: n,
  servico: txt,
  tipoGerador: txt,
  prioridade: txt,
  grupo: nul(n),
  situacao: txt,
  guiche: n,
  usuario: nul(txt),
  /** Emissão (AAAA-MM-DDTHH:MM:SS, relógio do banco). */
  emitidaEm: txt,
  esperaMinutos: n,
  origem: nul(txt),
  /** Chamadas registradas pelo novo (a primeira e as de novo). */
  chamadas: n,
  chamadaEm: nul(txt),
  /** Tem atendimento aberto (vínculo senha × atendimento). */
  atendida: z.boolean(),
  /** Tem agendamento vinculado (check-in). */
  agendamento: z.boolean(),
  /** Último local do fluxo. */
  ultimoLocal: nul(n),
});
export type SenhaLida = z.infer<typeof esquemaSenhaLida>;

export const esquemaFilaGuiche = z.object({
  hoje: txt,
  agora: txt,
  recepcao: n,
  local: n,
  guiche: n,
  guicheAberto: z.boolean(),
  /** Aguardando chamada nos geradores escolhidos, na ordem em que serão chamadas. */
  aguardando: z.array(esquemaSenhaLida),
  /** Chamadas por este guichê e ainda não concluídas. */
  noGuiche: z.array(esquemaSenhaLida),
  suspensas: z.array(esquemaSenhaLida),
  /** Senhas da recepção já com atendimento aberto (para o encaminhamento entre locais). */
  emAtendimento: z.array(esquemaSenhaLida),
  total: n,
  cortada: z.boolean(),
});
export type FilaGuiche = z.infer<typeof esquemaFilaGuiche>;

export const esquemaAgendadoDoDia = z.object({
  tipo: z.enum(['consulta', 'exame']),
  marcacao: n,
  hora: txt,
  agenda: txt,
  /**
   * Nome de tratamento mascarado (a tela do guichê confirma pelo detalhe): do nome social quando houver; o paciente
   * sigiloso vem como "Paciente sigiloso", sem letra nenhuma do nome.
   */
  paciente: txt,
  /** O nome mostrado é o nome social (a tela marca). */
  nomeSocial: z.boolean(),
  /** Paciente marcado "sigiloso" no cadastro: mascarado em painel, chamada, guichê e listas. */
  sigiloso: z.boolean(),
  /**
   * Foto do paciente para conferir a identidade no guichê (endereço da imagem do cadastro, componente de foto do
   * W1-02); nulo quando não há foto ou o paciente é sigiloso.
   */
  foto: nul(txt),
  prontuario: n,
  chegou: z.boolean(),
  senha: nul(n),
});
export type AgendadoDoDia = z.infer<typeof esquemaAgendadoDoDia>;

/** Os agendados do dia da busca; `cortada`: passou do teto (200 de cada tipo), a tela pede para refinar. */
export const esquemaAgendadosDoDia = z.object({
  itens: z.array(esquemaAgendadoDoDia),
  cortada: z.boolean(),
});
export type AgendadosDoDia = z.infer<typeof esquemaAgendadosDoDia>;

// ── Painel de chamada (TV) ───────────────────────────────────────────────────────────────────────

export const esquemaChamadaPainel = z.object({
  /** Identificador da chamada (senha + contagem: muda a cada nova chamada da mesma senha). */
  chave: txt,
  senha: n,
  texto: txt,
  destino: txt,
  guiche: n,
  /** Iniciais do paciente quando a configuração do painel pede (nunca o nome completo, LGPD). */
  iniciais: nul(txt),
  prioridade: txt,
  em: txt,
  /** Quem chamou: este sistema ou o outro (pelo vigia de mudanças). */
  origem: z.enum(['novo', 'outro']),
  /** Texto que a voz sintetizada fala. */
  fala: txt,
});
export type ChamadaPainel = z.infer<typeof esquemaChamadaPainel>;

export const esquemaPainelChamadas = z.object({
  nome: txt,
  recepcao: n,
  voz: z.boolean(),
  atual: nul(esquemaChamadaPainel),
  ultimas: z.array(esquemaChamadaPainel),
  /** Momento da última leitura bem-sucedida (o painel mostra em destaque quando a conexão cai). */
  atualizadoEm: txt,
});
export type PainelChamadas = z.infer<typeof esquemaPainelChamadas>;

// ── Totem ───────────────────────────────────────────────────────────────────────────────────────

export const esquemaTotemConfig = z.object({
  nome: txt,
  recepcao: n,
  /** `recepcao`: serviço de recepção (abre atendimento; o único em que a chegada do agendado se registra). */
  servicos: z.array(
    z.object({ gerador: n, rotulo: txt, letra: txt, prioritaria: z.boolean(), recepcao: z.boolean() }),
  ),
  checkin: z.boolean(),
  gruposPrioridade: z.array(z.object({ grupo: n, rotulo: txt, prioridade: txt })),
});
export type TotemConfig = z.infer<typeof esquemaTotemConfig>;

export const esquemaSenhaEmitida = z.object({
  senha: n,
  numero: n,
  texto: txt,
  servico: txt,
  emitidaEm: txt,
  /** Senhas à frente no mesmo serviço. */
  aFrente: n,
  prioridade: txt,
  /** Agendamento vinculado (check-in), com a hora marcada. */
  agendamento: nul(z.object({ tipo: txt, hora: txt })),
});
export type SenhaEmitida = z.infer<typeof esquemaSenhaEmitida>;

// ── Painel do supervisor e indicadores ──────────────────────────────────────────────────────────

export const esquemaFilaSupervisor = z.object({
  gerador: n,
  recepcao: n,
  servico: txt,
  aguardando: n,
  prioritarias: n,
  esperaMediaMinutos: n,
  maiorEsperaMinutos: n,
  tempoAlvoMinutos: n,
  acimaDaMeta: n,
});

export const esquemaPainelSupervisor = z.object({
  hoje: txt,
  agora: txt,
  filas: z.array(esquemaFilaSupervisor),
  guiches: z.array(esquemaGuicheEmUso.extend({ chamadasHoje: n })),
  maisAntigas: z.array(esquemaSenhaLida),
  totais: z.object({ emitidas: n, aguardando: n, chamadas: n, liberadas: n, suspensas: n, atendidas: n }),
});
export type PainelSupervisor = z.infer<typeof esquemaPainelSupervisor>;

export const esquemaIndicadoresRecepcao = z.object({
  de: txt,
  ate: txt,
  porHora: z.array(z.object({ hora: n, emitidas: n })),
  porDia: z.array(z.object({ data: txt, emitidas: n, liberadas: n, suspensas: n, atendidas: n })),
  porSituacao: z.array(z.object({ situacao: txt, senhas: n })),
  prioridade: z.array(z.object({ prioridade: txt, senhas: n })),
  porServico: z.array(z.object({ gerador: n, servico: txt, senhas: n })),
  /** Esperas medidas pelo novo (chegada → chamada, chamada → fim), em minutos; null sem medida. */
  esperas: z.object({
    medidas: n,
    chegadaChamadaMedia: nul(n),
    chamadaFimMedia: nul(n),
    prioritariasMedia: nul(n),
    normaisMedia: nul(n),
  }),
  /** A espera emissão → chamada pela hora da emissão (as horas com medida). */
  esperaPorHora: z.array(z.object({ hora: n, medidas: n, esperaMedia: nul(n) })),
  /** Por guichê da primeira chamada (os dois sistemas): chamadas, espera até a chamada, chamada → fim. */
  porGuiche: z.array(
    z.object({ recepcao: n, guiche: n, chamadas: n, esperaMedia: nul(n), chamadaFimMedia: nul(n) }),
  ),
  naoLocalizado: n,
  total: n,
});
export type IndicadoresRecepcao = z.infer<typeof esquemaIndicadoresRecepcao>;

// ── Dispositivos (perfil Painel/Totem) ──────────────────────────────────────────────────────────

export const esquemaDispositivoLido = z.object({
  id: n,
  tipo: txt,
  nome: txt,
  recepcao: nul(n),
  locais: z.array(n),
  geradores: z.array(n),
  conteudo: nul(txt),
  portalOrdem: nul(n),
  usuarioLegado: nul(txt),
  voz: z.boolean(),
  criadoEm: txt,
  criadoPor: txt,
  validoAte: txt,
  revogadoEm: nul(txt),
  ultimoUso: nul(txt),
  /** Começo do token (8 caracteres) para conferir na TV; o token inteiro só aparece na criação. */
  prefixo: txt,
  /** M43 (regra 4): o login de TV ou de totem que o aparelho substitui e a conferência no setor. */
  loginSubstituido: nul(txt).default(null),
  conferidoEm: nul(txt).default(null),
  conferidoPor: nul(txt).default(null),
});
export type DispositivoLido = z.infer<typeof esquemaDispositivoLido>;

export const esquemaDispositivoCriado = esquemaDispositivoLido.extend({ token: txt, endereco: txt });
export type DispositivoCriado = z.infer<typeof esquemaDispositivoCriado>;

// ── Painéis de TV de outros setores (leitos, higienização, bloco) ───────────────────────────────

export const esquemaPainelTvLido = z.object({
  id: n,
  ordem: n,
  nome: txt,
  /** O que o painel mostra no novo (o conteúdo de cada painel vem do módulo dono). */
  conteudo: z.enum(['leitos', 'higienizacao', 'bloco', 'senhas', 'outro']),
});
export type PainelTvLido = z.infer<typeof esquemaPainelTvLido>;

export const esquemaTelaPainelTv = z.object({
  nome: txt,
  conteudo: txt,
  atualizadoEm: txt,
  /** Linhas a mostrar (sem nome de paciente). */
  linhas: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))),
  colunas: z.array(z.object({ campo: txt, rotulo: txt })),
  resumo: z.array(z.object({ rotulo: txt, valor: n })),
});
export type TelaPainelTv = z.infer<typeof esquemaTelaPainelTv>;
