// E-mail do sistema (01-ADM L77): modelo de mensagem, servidor de saída e registro de cada envio.
// Regras puras (sem banco nem rede): a porta própria lê, chama estas funções e grava o que elas decidem.
//
// Modelo: assunto e corpo com marcadores {{nome.do.campo}}; o marcador mal escrito é recusado na gravação (não na
// hora do envio) e a pré-visualização troca os marcadores pelos exemplos. Vale o modelo do estabelecimento sobre o
// padrão do cliente, o de vigência mais recente primeiro.
// Servidor: a senha nunca entra no cadastro, só a referência dela no cofre de segredos; o que parece senha (espaço,
// endereço com credencial, texto fora do formato de chave) é recusado.
// Envio: cada tentativa fica registrada. Fora de produção a mensagem só chega à caixa de captura: "capturado", nunca
// "enviado". O erro guardado é só o tipo e o código de resposta do servidor: nunca endereço nem conteúdo.

export type RecusaEmail =
  | 'codigo-invalido'
  | 'nome-vazio'
  | 'assunto-vazio'
  | 'assunto-com-quebra'
  | 'corpo-vazio'
  | 'marcador-invalido'
  | 'vigencia-invertida'
  | 'sms-sem-texto'
  | 'endereco-invalido'
  | 'host-invalido'
  | 'porta-invalida'
  | 'seguranca-invalida'
  | 'autenticacao-incompleta'
  | 'referencia-cofre-invalida'
  | 'tempo-limite-invalido'
  | 'limite-hora-invalido'
  | 'padrao-inativo';

export const MENSAGEM_EMAIL: Readonly<Record<RecusaEmail, string>> = {
  'codigo-invalido': 'O código usa letras, números, ponto, hífen ou sublinhado (até 30).',
  'nome-vazio': 'Informe o nome.',
  'assunto-vazio': 'Informe o assunto da mensagem.',
  'assunto-com-quebra': 'O assunto fica numa linha só.',
  'corpo-vazio': 'Informe o corpo da mensagem.',
  'marcador-invalido':
    'Marcador mal escrito: use {{nome.do.campo}}, com letras minúsculas, números, ponto ou sublinhado.',
  'vigencia-invertida': 'O fim da vigência não pode ser antes do início.',
  'sms-sem-texto': 'O modelo que também avisa por SMS precisa do texto do SMS.',
  'endereco-invalido': 'Endereço de e-mail inválido.',
  'host-invalido': 'Informe o endereço do servidor (nome ou IP), sem protocolo, usuário ou senha.',
  'porta-invalida': 'A porta vai de 1 a 65535.',
  'seguranca-invalida': 'A segurança da conexão é nenhuma, SSL/TLS ou STARTTLS.',
  'autenticacao-incompleta':
    'O servidor que exige autenticação precisa do usuário e da referência da senha no cofre.',
  'referencia-cofre-invalida':
    'Informe a referência da senha no cofre de segredos (uma chave, como email/saida/principal), nunca a senha.',
  'tempo-limite-invalido': 'O tempo limite vai de 5 a 300 segundos.',
  'limite-hora-invalido': 'O limite de envios por hora é um número inteiro maior que zero.',
  'padrao-inativo': 'O servidor padrão tem de estar ativo.',
};

const CODIGO = /^[A-Za-z0-9._-]{1,30}$/;
const ENDERECO = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})+$/;
const HOST = /^(?=.{1,255}$)[A-Za-z0-9]([A-Za-z0-9-]{0,62})(\.[A-Za-z0-9]([A-Za-z0-9-]{0,62}))*$/;
const REFERENCIA_COFRE = /^[a-z0-9]+([._-][a-z0-9]+)*(\/[a-z0-9]+([._-][a-z0-9]+)*)+$/;
const MARCADOR = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

export const SEGURANCAS_EMAIL = ['nenhuma', 'ssl_tls', 'starttls'] as const;
export type SegurancaEmail = (typeof SEGURANCAS_EMAIL)[number];
export const TENTATIVAS_MAXIMAS_EMAIL = 5;

export function enderecoEmailValido(v: string): boolean {
  return v.length <= 254 && ENDERECO.test(v);
}

// ── Modelo de mensagem ─────────────────────────────────────────────────────────────────────────

/** Os marcadores de um texto, na ordem em que aparecem e sem repetir; `invalido` se algum está mal escrito. */
export function marcadoresDoTexto(texto: string): { marcadores: string[]; invalido: boolean } {
  const marcadores: string[] = [];
  let invalido = false;
  const resto = texto.replace(/\{\{([^{}]*)\}\}/g, (_t, dentro: string) => {
    const nome = dentro.trim();
    if (!MARCADOR.test(nome) || nome.length > 100) invalido = true;
    else if (!marcadores.includes(nome)) marcadores.push(nome);
    return '';
  });
  // Sobrou abre ou fecha de marcador sem par.
  if (/\{\{|\}\}/.test(resto)) invalido = true;
  return { marcadores, invalido };
}

export interface ModeloEmailEntrada {
  readonly codigo: string;
  readonly nome: string;
  readonly assunto: string;
  readonly corpoHtml: string;
  readonly corpoTexto?: string | null;
  readonly remetenteEmail?: string | null;
  readonly responderPara?: string | null;
  readonly enviaSms?: boolean;
  readonly textoSms?: string | null;
  readonly vigenciaInicio?: string | null;
  readonly vigenciaFim?: string | null;
}

export function validarModeloEmail(e: ModeloEmailEntrada): RecusaEmail | null {
  if (!CODIGO.test(e.codigo)) return 'codigo-invalido';
  if (e.nome.trim() === '') return 'nome-vazio';
  if (e.assunto.trim() === '') return 'assunto-vazio';
  if (/[\r\n]/.test(e.assunto)) return 'assunto-com-quebra';
  if (e.corpoHtml.trim() === '') return 'corpo-vazio';
  for (const t of [e.assunto, e.corpoHtml, e.corpoTexto ?? '', e.textoSms ?? ''])
    if (marcadoresDoTexto(t).invalido) return 'marcador-invalido';
  for (const x of [e.remetenteEmail, e.responderPara])
    if (x && !enderecoEmailValido(x)) return 'endereco-invalido';
  if (e.enviaSms && !(e.textoSms ?? '').trim()) return 'sms-sem-texto';
  const [i, f] = [e.vigenciaInicio ?? null, e.vigenciaFim ?? null];
  if ((i && !DIA.test(i)) || (f && !DIA.test(f)) || (i && f && f < i)) return 'vigencia-invertida';
  return null;
}

/** Os marcadores do modelo inteiro (assunto, corpo, texto simples e SMS), sem repetir. */
export function marcadoresDoModelo(
  e: Pick<ModeloEmailEntrada, 'assunto' | 'corpoHtml' | 'corpoTexto' | 'textoSms'>,
): string[] {
  const r: string[] = [];
  for (const t of [e.assunto, e.corpoHtml, e.corpoTexto ?? '', e.textoSms ?? ''])
    for (const m of marcadoresDoTexto(t).marcadores) if (!r.includes(m)) r.push(m);
  return r;
}

/**
 * Troca os marcadores pelos valores. O marcador sem valor fica como está e é devolvido em `faltando` (quem envia
 * decide recusar; a pré-visualização mostra o que falta). `escapar` protege o valor posto em HTML.
 */
export function preencherModelo(
  texto: string,
  valores: Readonly<Record<string, string>>,
  escapar = false,
): { texto: string; faltando: string[] } {
  const faltando: string[] = [];
  const html = (v: string) =>
    v.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
    );
  const saida = texto.replace(/\{\{([^{}]*)\}\}/g, (tudo, dentro: string) => {
    const nome = dentro.trim();
    const v = Object.hasOwn(valores, nome) ? valores[nome] : undefined;
    if (v === undefined) {
      if (!faltando.includes(nome)) faltando.push(nome);
      return tudo;
    }
    return escapar ? html(v) : v;
  });
  return { texto: saida, faltando };
}

export interface ModeloEmailVigente {
  readonly id: number;
  /** Nulo: modelo padrão do cliente. */
  readonly estabelecimento: number | null;
  readonly finalidade: number;
  readonly ativo: boolean;
  readonly vigenciaInicio: string | null;
  readonly vigenciaFim: string | null;
}

/** O modelo que vale para a finalidade no dia: o do estabelecimento antes do padrão; o início mais recente antes. */
export function modeloVigente<M extends ModeloEmailVigente>(
  modelos: readonly M[],
  finalidade: number,
  estabelecimento: number | null,
  dia: string,
): M | null {
  const servem = modelos.filter(
    (m) =>
      m.ativo &&
      m.finalidade === finalidade &&
      (m.estabelecimento === null || m.estabelecimento === estabelecimento) &&
      (m.vigenciaInicio === null || m.vigenciaInicio <= dia) &&
      (m.vigenciaFim === null || m.vigenciaFim >= dia),
  );
  servem.sort(
    (a, b) =>
      Number(b.estabelecimento !== null) - Number(a.estabelecimento !== null) ||
      (b.vigenciaInicio ?? '').localeCompare(a.vigenciaInicio ?? '') ||
      b.id - a.id,
  );
  return servem[0] ?? null;
}

// ── Servidor de saída ──────────────────────────────────────────────────────────────────────────

export interface ServidorEmailEntrada {
  readonly codigo: string;
  readonly nome: string;
  readonly host: string;
  readonly porta: number;
  readonly seguranca: string;
  readonly exigeAutenticacao: boolean;
  readonly usuarioAutenticacao?: string | null;
  readonly referenciaCofre?: string | null;
  readonly remetenteEmail: string;
  readonly responderPara?: string | null;
  readonly tempoLimiteSegundos?: number;
  readonly limiteEnvioHora?: number | null;
  readonly padrao?: boolean;
  readonly ativo?: boolean;
}

/** A referência da senha no cofre: uma chave com ao menos dois segmentos (email/saida/principal), nunca a senha. */
export function referenciaCofreValida(v: string): boolean {
  return v.length >= 3 && v.length <= 200 && REFERENCIA_COFRE.test(v);
}

export function validarServidorEmail(e: ServidorEmailEntrada): RecusaEmail | null {
  if (!CODIGO.test(e.codigo)) return 'codigo-invalido';
  if (e.nome.trim() === '') return 'nome-vazio';
  if (!HOST.test(e.host)) return 'host-invalido';
  if (!Number.isInteger(e.porta) || e.porta < 1 || e.porta > 65535) return 'porta-invalida';
  if (!(SEGURANCAS_EMAIL as readonly string[]).includes(e.seguranca)) return 'seguranca-invalida';
  const usuario = (e.usuarioAutenticacao ?? '').trim();
  const referencia = (e.referenciaCofre ?? '').trim();
  if (e.exigeAutenticacao && (!usuario || !referencia)) return 'autenticacao-incompleta';
  if (referencia && !referenciaCofreValida(referencia)) return 'referencia-cofre-invalida';
  if (!enderecoEmailValido(e.remetenteEmail)) return 'endereco-invalido';
  if (e.responderPara && !enderecoEmailValido(e.responderPara)) return 'endereco-invalido';
  const tempo = e.tempoLimiteSegundos ?? 30;
  if (!Number.isInteger(tempo) || tempo < 5 || tempo > 300) return 'tempo-limite-invalido';
  const limite = e.limiteEnvioHora ?? null;
  if (limite !== null && (!Number.isInteger(limite) || limite < 1)) return 'limite-hora-invalido';
  if (e.padrao && e.ativo === false) return 'padrao-inativo';
  return null;
}

/** A porta habitual de cada segurança (sugestão da tela; o cadastro aceita outra). */
export function portaSugerida(seguranca: SegurancaEmail): number {
  return seguranca === 'ssl_tls' ? 465 : seguranca === 'starttls' ? 587 : 25;
}

// ── Registro de envio ──────────────────────────────────────────────────────────────────────────

export type SituacaoEnvioEmail = 'pendente' | 'enviando' | 'enviado' | 'falhou' | 'cancelado' | 'capturado';
export type SituacaoDestinatarioEmail = 'pendente' | 'entregue' | 'rejeitado' | 'capturado';

export interface TentativaEnvio {
  /** O servidor aceitou a mensagem. */
  readonly aceito: boolean;
  /** Ambiente de produção (fora dele, a mensagem só chega à caixa de captura). */
  readonly producao: boolean;
  /** Tentativas já registradas deste envio. */
  readonly tentativasAnteriores: number;
}

export interface ResultadoTentativa {
  readonly situacao: SituacaoEnvioEmail;
  readonly situacaoDestinatario: SituacaoDestinatarioEmail;
  readonly tentativas: number;
  /** A fila ainda pode tentar de novo. */
  readonly tentaDeNovo: boolean;
}

/** O que a tentativa deixa no registro do envio. */
export function resultadoDaTentativa(t: TentativaEnvio): ResultadoTentativa {
  const tentativas = t.tentativasAnteriores + 1;
  if (t.aceito)
    return t.producao
      ? { situacao: 'enviado', situacaoDestinatario: 'entregue', tentativas, tentaDeNovo: false }
      : { situacao: 'capturado', situacaoDestinatario: 'capturado', tentativas, tentaDeNovo: false };
  return {
    situacao: 'falhou',
    situacaoDestinatario: 'rejeitado',
    tentativas,
    tentaDeNovo: tentativas < TENTATIVAS_MAXIMAS_EMAIL,
  };
}

/** O envio já concluído não é regravado por uma entrega repetida da fila. */
export function envioConcluido(s: string): boolean {
  return s === 'enviado' || s === 'capturado' || s === 'cancelado';
}

/**
 * O erro que fica guardado: só o tipo e, se houver, o código de resposta do servidor (três dígitos). Endereço, nome
 * de máquina e conteúdo da mensagem nunca entram.
 */
export function resumoDoErro(e: unknown): string {
  const nome = e instanceof Error ? e.name : 'Erro';
  const texto = e instanceof Error ? e.message : '';
  const codigo = /\bresposta (\d{3})\b/.exec(texto)?.[1] ?? /^(\d{3})\b/.exec(texto)?.[1];
  const motivo = /tempo esgotado/i.test(texto)
    ? 'tempo esgotado'
    : /conex[aã]o fechada|ECONNRESET/i.test(texto)
      ? 'conexão fechada'
      : /ECONNREFUSED/i.test(texto)
        ? 'conexão recusada'
        : /ENOTFOUND|EAI_AGAIN/i.test(texto)
          ? 'servidor não encontrado'
          : /inv[aá]lido/i.test(texto)
            ? 'endereço inválido'
            : '';
  return [nome.replace(/[^A-Za-z]/g, '').slice(0, 60) || 'Erro', codigo ? `resposta ${codigo}` : '', motivo]
    .filter(Boolean)
    .join(': ');
}

/** O identificador da mensagem, estável entre as tentativas da mesma entrega da fila (uma por destinatário). */
export function identificadorDaMensagem(chave: string, sequencia: number, dominio: string): string {
  const limpa = chave.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 120) || 'envio';
  const host = dominio.replace(/[^A-Za-z0-9.-]/g, '-').slice(0, 100) || 'local';
  return `<${limpa}.${sequencia}@${host}>`;
}
