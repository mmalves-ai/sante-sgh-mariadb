// Comunicação com o paciente pela Hal-AI (F3.9, linha 08-INTG L133): modelos por finalidade e canal, regras de envio por
// tipo de aviso (gatilho, antecedência, janela do dia, limite por paciente, consentimento), o pedido de envio registrado
// e os retornos (entrega, leitura, resposta, falha, descadastro). Tudo puro: a porta grava, o domínio decide.
// O sistema não tem canal próprio (regra 15a): o pedido vai à Hal-AI, que devolve os retornos.

export const FINALIDADES_MODELO = [
  'confirmacao',
  'lembrete',
  'aviso',
  'resultado_disponivel',
  'cancelamento',
  'comprovante',
  'pesquisa_satisfacao',
  'outro',
] as const;
export type FinalidadeModelo = (typeof FINALIDADES_MODELO)[number];

export const CANAIS_MENSAGEM = ['whatsapp', 'sms', 'email', 'push'] as const;
export type CanalMensagem = (typeof CANAIS_MENSAGEM)[number];

export const GATILHOS_ENVIO = [
  'agendamento_criado',
  'lembrete_agendamento',
  'confirmacao_agendamento',
  'resultado_liberado',
  'alta',
  'aniversario',
  'pesquisa_satisfacao',
  'cobranca',
  'manual',
] as const;
export type GatilhoEnvio = (typeof GATILHOS_ENVIO)[number];

export const MOTIVOS_ENVIO = [
  'agendamento',
  'lembrete',
  'confirmacao',
  'resultado',
  'alta',
  'pesquisa',
  'cobranca',
  'campanha',
  'avulso',
] as const;
export type MotivoEnvio = (typeof MOTIVOS_ENVIO)[number];

export const SITUACOES_PEDIDO = [
  'pendente',
  'enviado',
  'entregue',
  'lido',
  'respondido',
  'falha',
  'cancelado',
] as const;
export type SituacaoPedido = (typeof SITUACOES_PEDIDO)[number];

export const TIPOS_RETORNO = ['entrega', 'leitura', 'resposta', 'falha', 'descadastro'] as const;
export type TipoRetorno = (typeof TIPOS_RETORNO)[number];

export type RespostaInterpretada = 'confirmado' | 'cancelado' | 'reagendar' | 'outro';

/** As variáveis que um modelo pode usar (preenchidas pelo sistema no pedido). */
export const VARIAVEIS_MODELO = [
  'paciente_nome',
  'data',
  'hora',
  'profissional',
  'estabelecimento',
  'local',
  'servico',
  'link',
] as const;

/** Que finalidade de modelo cada gatilho aceita (a regra não manda lembrete com modelo de cobrança). */
export const FINALIDADES_DO_GATILHO: Readonly<Record<GatilhoEnvio, readonly FinalidadeModelo[]>> = {
  agendamento_criado: ['aviso', 'comprovante', 'confirmacao'],
  lembrete_agendamento: ['lembrete'],
  confirmacao_agendamento: ['confirmacao'],
  resultado_liberado: ['resultado_disponivel', 'aviso'],
  alta: ['aviso', 'pesquisa_satisfacao'],
  aniversario: ['aviso', 'outro'],
  pesquisa_satisfacao: ['pesquisa_satisfacao'],
  cobranca: ['aviso', 'outro'],
  manual: FINALIDADES_MODELO,
};

/** O motivo do pedido que cada gatilho gera. */
export const MOTIVO_DO_GATILHO: Readonly<Record<GatilhoEnvio, MotivoEnvio>> = {
  agendamento_criado: 'agendamento',
  lembrete_agendamento: 'lembrete',
  confirmacao_agendamento: 'confirmacao',
  resultado_liberado: 'resultado',
  alta: 'alta',
  aniversario: 'campanha',
  pesquisa_satisfacao: 'pesquisa',
  cobranca: 'cobranca',
  manual: 'avulso',
};

export interface ErroMensagem {
  readonly campo: string;
  readonly codigo: string;
  readonly mensagem: string;
}

const erro = (campo: string, codigo: string, mensagem: string): ErroMensagem => ({ campo, codigo, mensagem });

/** HH:MM (ou HH:MM:SS) em minutos do dia; null se inválido. */
export function minutosDoDia(h: string | null | undefined): number | null {
  if (!h) return null;
  const m = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(h);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  return hh < 24 && mm < 60 ? hh * 60 + mm : null;
}

/** As variáveis citadas no texto ({{nome}}). */
export function variaveisDoTexto(texto: string): string[] {
  return [...new Set([...texto.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]!))];
}

export interface ModeloMensagem {
  readonly codigo: string;
  readonly descricao: string;
  readonly finalidade: FinalidadeModelo;
  readonly canal: CanalMensagem;
  readonly assunto: string | null;
  readonly corpo: string;
  readonly respostaConfirmacao: string | null;
  readonly respostaRecusa: string | null;
  readonly janelaInicio: string | null;
  readonly janelaFim: string | null;
  readonly vigenciaInicio: string | null;
  readonly vigenciaFim: string | null;
}

/** Conferência do modelo na hora do cadastro (vazio = aceito). */
export function validarModeloMensagem(m: ModeloMensagem): ErroMensagem[] {
  const e: ErroMensagem[] = [];
  if (!m.codigo.trim()) e.push(erro('codigo', 'codigo-obrigatorio', 'Informe o código do modelo.'));
  if (!m.descricao.trim()) e.push(erro('descricao', 'descricao-obrigatoria', 'Informe a descrição.'));
  if (!m.corpo.trim()) e.push(erro('corpo', 'corpo-obrigatorio', 'Escreva o texto da mensagem.'));
  if (m.canal === 'email' && !m.assunto?.trim())
    e.push(erro('assunto', 'assunto-obrigatorio', 'Mensagem por e-mail precisa de assunto.'));
  if (m.canal === 'sms' && m.corpo.length > 480)
    e.push(erro('corpo', 'sms-longo', 'SMS com até 480 caracteres (3 partes).'));
  const desconhecidas = variaveisDoTexto(`${m.assunto ?? ''} ${m.corpo}`).filter(
    (v) => !(VARIAVEIS_MODELO as readonly string[]).includes(v),
  );
  if (desconhecidas.length)
    e.push(
      erro(
        'corpo',
        'variavel-desconhecida',
        `Variável desconhecida: ${desconhecidas.join(', ')}. Use: ${VARIAVEIS_MODELO.join(', ')}.`,
      ),
    );
  if (m.finalidade === 'confirmacao') {
    const s = m.respostaConfirmacao?.trim().toLowerCase();
    const n = m.respostaRecusa?.trim().toLowerCase();
    if (!s || !n)
      e.push(
        erro(
          'respostaConfirmacao',
          'respostas-obrigatorias',
          'Modelo de confirmação precisa da resposta que confirma e da que recusa.',
        ),
      );
    else if (s === n)
      e.push(
        erro(
          'respostaRecusa',
          'respostas-iguais',
          'A resposta que recusa tem de ser diferente da que confirma.',
        ),
      );
  }
  const ji = minutosDoDia(m.janelaInicio);
  const jf = minutosDoDia(m.janelaFim);
  if ((m.janelaInicio && ji === null) || (m.janelaFim && jf === null))
    e.push(erro('janelaInicio', 'janela-invalida', 'Horário da janela no formato HH:MM.'));
  else if (ji !== null && jf !== null && jf <= ji)
    e.push(erro('janelaFim', 'janela-invertida', 'O fim da janela de envio tem de ser depois do início.'));
  if (m.vigenciaInicio && m.vigenciaFim && m.vigenciaFim < m.vigenciaInicio)
    e.push(erro('vigenciaFim', 'vigencia-invertida', 'O fim da vigência não pode ser antes do início.'));
  return e;
}

export interface RegraEnvio {
  readonly codigo: string;
  readonly descricao: string;
  readonly gatilho: GatilhoEnvio;
  readonly canal: CanalMensagem;
  readonly antecedenciaMinutos: number | null;
  readonly horaInicio: string | null;
  readonly horaFim: string | null;
  readonly maximoEnviosPaciente: number | null;
}

/** Conferência da regra de envio contra o modelo que ela usa (vazio = aceita). */
export function validarRegraEnvio(
  r: RegraEnvio,
  modelo: { readonly finalidade: FinalidadeModelo; readonly canal: CanalMensagem; readonly ativo: boolean },
): ErroMensagem[] {
  const e: ErroMensagem[] = [];
  if (!r.codigo.trim()) e.push(erro('codigo', 'codigo-obrigatorio', 'Informe o código da regra.'));
  if (!r.descricao.trim()) e.push(erro('descricao', 'descricao-obrigatoria', 'Informe a descrição.'));
  if (!modelo.ativo) e.push(erro('modelo', 'modelo-inativo', 'O modelo escolhido está fora de uso.'));
  if (modelo.canal !== r.canal)
    e.push(
      erro('canal', 'canal-diferente', `O modelo é para ${modelo.canal}; a regra tem de usar o mesmo canal.`),
    );
  if (!FINALIDADES_DO_GATILHO[r.gatilho].includes(modelo.finalidade))
    e.push(
      erro(
        'modelo',
        'finalidade-incompativel',
        `Para este aviso use modelo de: ${FINALIDADES_DO_GATILHO[r.gatilho].join(', ')}.`,
      ),
    );
  const antecipado = r.gatilho === 'lembrete_agendamento' || r.gatilho === 'confirmacao_agendamento';
  if (antecipado && (r.antecedenciaMinutos === null || r.antecedenciaMinutos <= 0))
    e.push(
      erro(
        'antecedenciaMinutos',
        'antecedencia-obrigatoria',
        'Lembrete e confirmação precisam da antecedência.',
      ),
    );
  if (r.antecedenciaMinutos !== null && Math.abs(r.antecedenciaMinutos) > 60 * 24 * 30)
    e.push(erro('antecedenciaMinutos', 'antecedencia-longa', 'Antecedência de no máximo 30 dias.'));
  const hi = minutosDoDia(r.horaInicio);
  const hf = minutosDoDia(r.horaFim);
  if ((r.horaInicio && hi === null) || (r.horaFim && hf === null))
    e.push(erro('horaInicio', 'janela-invalida', 'Horário no formato HH:MM.'));
  else if (hi !== null && hf !== null && hf <= hi)
    e.push(erro('horaFim', 'janela-invertida', 'O fim do horário de envio tem de ser depois do início.'));
  if (r.maximoEnviosPaciente !== null && r.maximoEnviosPaciente < 1)
    e.push(erro('maximoEnviosPaciente', 'maximo-invalido', 'O limite por paciente é de pelo menos 1.'));
  return e;
}

/**
 * Quando enviar: a referência (o horário do agendamento) menos a antecedência, puxada para DENTRO do horário de envio
 * sempre para mais cedo (o aviso nunca chega depois do evento). Horários em minutos locais do dia, datas em UTC
 * deslocadas pelo fuso informado em minutos. Devolve null quando o momento já passou e não cabe mais enviar antes do
 * evento (o pedido não é criado).
 */
export function momentoDoEnvio(p: {
  readonly referencia: Date;
  readonly antecedenciaMinutos: number | null;
  readonly horaInicio: string | null;
  readonly horaFim: string | null;
  readonly agora: Date;
  /** Deslocamento do fuso do estabelecimento em minutos (Brasília: -180). */
  readonly fusoMinutos?: number;
}): Date | null {
  const fuso = p.fusoMinutos ?? -180;
  const MIN = 60_000;
  let alvo = new Date(p.referencia.getTime() - (p.antecedenciaMinutos ?? 0) * MIN);
  const hi = minutosDoDia(p.horaInicio);
  const hf = minutosDoDia(p.horaFim);
  if (hi !== null || hf !== null) {
    const ini = hi ?? 0;
    const fim = hf ?? 24 * 60;
    const local = new Date(alvo.getTime() + fuso * MIN);
    const minuto = local.getUTCHours() * 60 + local.getUTCMinutes();
    const inicioDoDia =
      alvo.getTime() - minuto * MIN - local.getUTCSeconds() * 1000 - local.getUTCMilliseconds();
    if (minuto > fim) alvo = new Date(inicioDoDia + fim * MIN);
    else if (minuto < ini) alvo = new Date(inicioDoDia - 24 * 60 * MIN + fim * MIN);
  }
  if (alvo.getTime() >= p.agora.getTime()) return alvo;
  // Já passou: envia agora se ainda for antes do evento e se agora estiver no horário de envio.
  if (p.agora.getTime() >= p.referencia.getTime()) return null;
  const localAgora = new Date(p.agora.getTime() + fuso * MIN);
  const m = localAgora.getUTCHours() * 60 + localAgora.getUTCMinutes();
  if ((hi !== null && m < hi) || (hf !== null && m > hf)) return null;
  return p.agora;
}

/** Endereço de destino válido para o canal (telefone com DDD; e-mail; push: identificador do aparelho). */
export function destinoMensagemValido(canal: CanalMensagem, destino: string): boolean {
  const d = destino.trim();
  if (canal === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d) && d.length <= 254;
  if (canal === 'push') return d.length >= 8 && d.length <= 254;
  const n = d.replace(/\D/g, '');
  return n.length >= 10 && n.length <= 13;
}

/** Pode registrar o pedido de envio? Confere destino, consentimento, descadastro do canal e limite por paciente. */
export function podePedirEnvio(p: {
  readonly canal: CanalMensagem;
  readonly destino: string;
  readonly exigeConsentimento: boolean;
  readonly temConsentimento: boolean;
  readonly descadastradoNoCanal: boolean;
  readonly maximoEnviosPaciente: number | null;
  readonly enviosDaRegraAoPaciente: number;
  readonly regraAtiva: boolean;
}): ErroMensagem[] {
  const e: ErroMensagem[] = [];
  if (!p.regraAtiva) e.push(erro('regra', 'regra-inativa', 'A regra de envio está fora de uso.'));
  if (!destinoMensagemValido(p.canal, p.destino))
    e.push(erro('destino', 'destino-invalido', `Destino inválido para ${p.canal}.`));
  if (p.exigeConsentimento && !p.temConsentimento)
    e.push(
      erro(
        'paciente',
        'sem-consentimento',
        'O paciente não tem consentimento autorizado para receber mensagens.',
      ),
    );
  if (p.descadastradoNoCanal)
    e.push(erro('paciente', 'descadastrado', `O paciente pediu para não receber mais por ${p.canal}.`));
  if (p.maximoEnviosPaciente !== null && p.enviosDaRegraAoPaciente >= p.maximoEnviosPaciente)
    e.push(
      erro(
        'paciente',
        'limite-atingido',
        `Limite de ${p.maximoEnviosPaciente} envio(s) desta regra ao paciente já atingido.`,
      ),
    );
  return e;
}

/** O texto final com as variáveis preenchidas; as que faltarem são devolvidas (o pedido é recusado). */
export function montarTexto(
  texto: string,
  valores: Readonly<Record<string, string | null | undefined>>,
): { texto: string; faltando: string[] } {
  const faltando: string[] = [];
  const t = texto.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, v: string) => {
    const x = valores[v];
    if (x === undefined || x === null || x === '') {
      faltando.push(v);
      return '';
    }
    return x;
  });
  return { texto: t, faltando: [...new Set(faltando)] };
}

const ORDEM: Readonly<Record<SituacaoPedido, number>> = {
  pendente: 0,
  enviado: 1,
  entregue: 2,
  lido: 3,
  respondido: 4,
  falha: 9,
  cancelado: 9,
};

/**
 * A situação do pedido depois de um retorno. A situação só avança (entrega atrasada depois da leitura não volta); falha
 * e cancelado são finais; o descadastro não muda a situação, mas bloqueia novos envios no canal.
 */
export function situacaoAposRetorno(
  atual: SituacaoPedido,
  tipo: TipoRetorno,
): { situacao: SituacaoPedido; bloqueiaCanal: boolean } {
  if (tipo === 'descadastro') return { situacao: atual, bloqueiaCanal: true };
  if (atual === 'cancelado' || atual === 'falha') return { situacao: atual, bloqueiaCanal: false };
  const nova: SituacaoPedido =
    tipo === 'entrega'
      ? 'entregue'
      : tipo === 'leitura'
        ? 'lido'
        : tipo === 'resposta'
          ? 'respondido'
          : 'falha';
  if (nova === 'falha')
    return { situacao: ORDEM[atual] >= ORDEM.entregue ? atual : 'falha', bloqueiaCanal: false };
  return { situacao: ORDEM[nova] > ORDEM[atual] ? nova : atual, bloqueiaCanal: false };
}

/** A resposta do paciente interpretada pelas respostas do modelo (sem acento, sem caixa). */
export function interpretarResposta(
  texto: string,
  respostaConfirmacao: string | null,
  respostaRecusa: string | null,
): RespostaInterpretada {
  const n = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  const t = n(texto);
  if (respostaConfirmacao && t === n(respostaConfirmacao)) return 'confirmado';
  if (respostaRecusa && t === n(respostaRecusa)) return 'cancelado';
  if (/\b(remarcar|reagendar|outro horario|outra data)\b/.test(t)) return 'reagendar';
  return 'outro';
}

/** Só o pedido ainda não enviado pode ser cancelado (o enviado fica como está, com os retornos). */
export function podeCancelarPedido(situacao: SituacaoPedido): boolean {
  return situacao === 'pendente';
}
