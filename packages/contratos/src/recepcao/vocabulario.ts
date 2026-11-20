// Vocabulário da recepção: senhas, guichês, totens e painéis (M19; ficha, seções 5 e 8). As letras são as de
// TBACAOFLUXOSENHA (domínio do legado, M14) e as situações de TBSENHAATEND.SITUACAO; o novo só grava as letras já
// vistas no perfil passivo da cópia (I e F nunca apareceram: recusadas). Perfil da cópia pc (só agregados):
//   - TBSENHAATEND (301.109; 40.120 em 2026): SITUACAO A 126.709, L 100.557, S 73.417, G 399, C 27; PRIORIDADE
//     '2' em 97,9%; MOTIVO '' na emissão; GUICHE 0 até a chamada;
//   - TBFLUXOATEND (555.695): A 231.735, L 154.306, C 93.549, S 73.813, X 1.773, N 458, E 61; nenhum G;
//   - senhas "diversos" (gerador tipo 5) terminam com L e o motivo 'Tipo de atendimento diversos' (54.242 de 54.242
//     desde 2025).
// Nenhum nome de tabela do legado sai daqui para a tela: os rótulos são de produto (ADR 0023).

/** Situação da senha (TBSENHAATEND.SITUACAO), com o rótulo de produto. */
export const SITUACOES_SENHA = [
  { letra: 'G', rotulo: 'Aguardando chamada' },
  { letra: 'C', rotulo: 'Chamada no local' },
  { letra: 'A', rotulo: 'Em atendimento' },
  { letra: 'L', rotulo: 'Liberada' },
  { letra: 'S', rotulo: 'Suspensa' },
] as const;
export type SituacaoSenha = (typeof SITUACOES_SENHA)[number]['letra'];

/** Letras de evento do fluxo (TBACAOFLUXOSENHA) e se o perfil da cópia as mostra (só as vistas gravam). */
export const LETRAS_FLUXO = [
  { letra: 'G', rotulo: 'Retirada de senha', vista: false },
  { letra: 'C', rotulo: 'Chamar', vista: true },
  { letra: 'A', rotulo: 'Atender', vista: true },
  { letra: 'L', rotulo: 'Paciente liberado', vista: true },
  { letra: 'E', rotulo: 'Encaminhar', vista: true },
  { letra: 'N', rotulo: 'Não localizado', vista: true },
  { letra: 'S', rotulo: 'Suspender', vista: true },
  { letra: 'X', rotulo: 'Cancelar chamada', vista: true },
  { letra: 'F', rotulo: 'Finalizar', vista: false },
  { letra: 'I', rotulo: 'Ignorar', vista: false },
] as const;
export type LetraFluxo = (typeof LETRAS_FLUXO)[number]['letra'];

/**
 * Eventos da senha que a tela oferece (recepcao.registrarEventoSenha), com a letra do fluxo e onde acontecem:
 * no guichê da recepção (a senha ainda sem atendimento) ou no local de atendimento (consultório, sala de exame:
 * a senha já com o atendimento aberto). Os do guichê seguem o caminho do perfil: rechamar grava C no local do
 * guichê; liberar (só "diversos") grava L; suspender e não localizado gravam S com o motivo.
 */
export const EVENTOS_SENHA = [
  { codigo: 'rechamar', letra: 'C', onde: 'guiche', rotulo: 'Chamar de novo' },
  { codigo: 'retomar', letra: 'C', onde: 'guiche', rotulo: 'Chamar a senha suspensa' },
  { codigo: 'liberar', letra: 'L', onde: 'guiche', rotulo: 'Concluir (serviços diversos)' },
  { codigo: 'suspender', letra: 'S', onde: 'guiche', rotulo: 'Suspender' },
  { codigo: 'naoLocalizado', letra: 'S', onde: 'guiche', rotulo: 'Paciente não localizado' },
  { codigo: 'chamarNoLocal', letra: 'C', onde: 'local', rotulo: 'Chamar ao local' },
  { codigo: 'cancelarChamada', letra: 'X', onde: 'local', rotulo: 'Cancelar a chamada' },
  { codigo: 'naoLocalizadoNoLocal', letra: 'N', onde: 'local', rotulo: 'Não localizado no local' },
  { codigo: 'encaminhar', letra: 'E', onde: 'local', rotulo: 'Encaminhar a outro local' },
  { codigo: 'liberarDoLocal', letra: 'L', onde: 'local', rotulo: 'Liberar do local' },
  { codigo: 'finalizar', letra: 'F', onde: 'local', rotulo: 'Finalizar' },
  { codigo: 'ignorar', letra: 'I', onde: 'local', rotulo: 'Ignorar' },
] as const;
export type EventoSenha = (typeof EVENTOS_SENHA)[number]['codigo'];
export const CODIGOS_EVENTO_SENHA = EVENTOS_SENHA.map((e) => e.codigo) as [EventoSenha, ...EventoSenha[]];

export function eventoSenha(codigo: string): (typeof EVENTOS_SENHA)[number] | undefined {
  return EVENTOS_SENHA.find((e) => e.codigo === codigo);
}

/**
 * Prioridade gravada (TBSENHAATEND.PRIORIDADE, CHAR(1)): o domínio do legado 0/1/2 (TBGRUPOPRIORIDADE 0 acima de 80
 * anos, 1 demais prioridades, 2 normal). Os 7 grupos detalhados (3 a 9) ficam no novo (SGH_REC_SENHA_EXT) até a
 * conferência de que o outro sistema chama na ordem certa (ficha, regra 3).
 */
export const PRIORIDADES_SENHA = [
  { codigo: '0', rotulo: 'Acima de 80 anos' },
  { codigo: '1', rotulo: 'Prioridade legal' },
  { codigo: '2', rotulo: 'Normal' },
] as const;
export type PrioridadeSenha = (typeof PRIORIDADES_SENHA)[number]['codigo'];

/** Grupos legais (TBGRUPOPRIORIDADE, 10 linhas) e a prioridade 0/1/2 que cada um grava hoje. */
export const GRUPOS_PRIORIDADE = [
  { grupo: 0, rotulo: 'Acima de 80 anos', prioridade: '0' },
  { grupo: 1, rotulo: 'Demais prioridades', prioridade: '1' },
  { grupo: 2, rotulo: 'Normal', prioridade: '2' },
  { grupo: 3, rotulo: '60 a 79 anos', prioridade: '1' },
  { grupo: 4, rotulo: 'Gestante', prioridade: '1' },
  { grupo: 5, rotulo: 'Lactante', prioridade: '1' },
  { grupo: 6, rotulo: 'Pessoa com deficiência', prioridade: '1' },
  { grupo: 7, rotulo: 'Pessoa com criança de colo', prioridade: '1' },
  { grupo: 8, rotulo: 'Pessoa com transtorno do espectro autista', prioridade: '1' },
  { grupo: 9, rotulo: 'Pessoa com obesidade', prioridade: '1' },
] as const satisfies readonly { grupo: number; rotulo: string; prioridade: PrioridadeSenha }[];
export type GrupoPrioridade = (typeof GRUPOS_PRIORIDADE)[number]['grupo'];

/** Tipos de gerador (TBGERASENHA.TIPO, Anexo A §A.3): só 0 e 5 têm uso; 1 a 4 existem como colunas vazias. */
export const TIPOS_GERADOR = [
  { codigo: '0', rotulo: 'Recepção (abre atendimento)', usado: true },
  { codigo: '1', rotulo: 'Por unidade', usado: false },
  { codigo: '2', rotulo: 'Por profissional', usado: false },
  { codigo: '3', rotulo: 'Por especialidade', usado: false },
  { codigo: '4', rotulo: 'Por agenda', usado: false },
  { codigo: '5', rotulo: 'Serviços diversos', usado: true },
] as const;
export type TipoGerador = (typeof TIPOS_GERADOR)[number]['codigo'];

/** Motivo que o legado grava na liberação das senhas "diversos" (54.242 de 54.242 desde 2025). */
export const MOTIVO_LIBERACAO_DIVERSOS = 'Tipo de atendimento diversos';

/**
 * Motivos padronizados da suspensão (o legado guarda texto livre de até 50 caracteres em TBSENHAATEND.MOTIVO: 6.137
 * textos distintos desde 2025). O novo grava o texto do motivo e guarda o código em SGH_REC_SENHA_EXT.
 */
export const MOTIVOS_SUSPENSAO = [
  { codigo: 'NAO-LOCALIZADO', texto: 'Paciente não localizado' },
  { codigo: 'DESISTIU', texto: 'Paciente desistiu do atendimento' },
  { codigo: 'SENHA-ERRADA', texto: 'Senha retirada no serviço errado' },
  { codigo: 'DOCUMENTO', texto: 'Aguardando documento do paciente' },
  { codigo: 'AUTORIZACAO', texto: 'Aguardando autorização do convênio' },
  { codigo: 'DUPLICADA', texto: 'Senha duplicada' },
  { codigo: 'OUTRO', texto: 'Outro motivo' },
] as const;
export type MotivoSuspensao = (typeof MOTIVOS_SUSPENSAO)[number]['codigo'];
export const CODIGOS_MOTIVO_SUSPENSAO = MOTIVOS_SUSPENSAO.map((m) => m.codigo) as [
  MotivoSuspensao,
  ...MotivoSuspensao[],
];

/** Texto gravado em TBSENHAATEND.MOTIVO (VARCHAR(50)): o motivo padronizado e, no "outro", o complemento. */
export function textoDoMotivoSuspensao(codigo: string, complemento?: string | null): string {
  const m = MOTIVOS_SUSPENSAO.find((x) => x.codigo === codigo);
  const base = m?.texto ?? 'Outro motivo';
  const extra = (complemento ?? '').replace(/\s+/g, ' ').trim();
  return (extra ? `${base}: ${extra}` : base).slice(0, 50);
}

/** Onde a senha nasceu (SGH_REC_SENHA_EXT.ORIGEM). */
export const ORIGENS_SENHA = ['balcao', 'totem'] as const;
export type OrigemSenha = (typeof ORIGENS_SENHA)[number];

/** Tipo do agendamento no check-in (consulta: agenda ambulatorial; exame: agenda de exames). */
export const TIPOS_CHEGADA = ['consulta', 'exame'] as const;
export type TipoChegada = (typeof TIPOS_CHEGADA)[number];

/** Tipo de dispositivo do perfil Painel/Totem (cap-08 §8.3). */
export const TIPOS_DISPOSITIVO = ['totem', 'painel', 'paineltv'] as const;
export type TipoDispositivo = (typeof TIPOS_DISPOSITIVO)[number];

/** Ordem de chamada da fila (SGH_REC_FILA_CFG.ORDEM): pela prioridade, intercalada ou só pela chegada. */
export const ORDENS_FILA = [
  { codigo: 'prioridade', rotulo: 'Prioritárias primeiro' },
  { codigo: 'intercalada', rotulo: 'Intercalar prioritárias e normais' },
  { codigo: 'chegada', rotulo: 'Só pela ordem de chegada' },
] as const;
export type OrdemFila = (typeof ORDENS_FILA)[number]['codigo'];

/** Teto da fila de um guichê ou local (ficha, seção 4). */
export const TETO_FILA = 300;
/** Últimas chamadas que o painel de TV mostra. */
export const ULTIMAS_CHAMADAS_PAINEL = 6;

/** Texto da senha (letra do gerador + número com 3 dígitos), como o papel do totem e o painel mostram. */
export function textoSenha(letra: string | null | undefined, numero: number): string {
  const l = (letra ?? '').trim().toUpperCase();
  const n = String(Math.max(0, Math.trunc(numero))).padStart(3, '0');
  return l ? `${l} ${n}` : n;
}
