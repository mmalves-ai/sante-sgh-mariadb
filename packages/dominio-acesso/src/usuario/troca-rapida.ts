// W1-01 (parte 11b): a regra da TROCA RÁPIDA DE USUÁRIO por PIN curto em estação compartilhada (mercado: "tap-and-go").
// O PIN NÃO substitui o login forte: só vale para quem já entrou com a senha (e o segundo fator, se houver) HOJE e NESTA
// estação; fora disso a troca é recusada e a pessoa entra pelo login normal. O crachá por proximidade (agente local)
// fica atrás do parâmetro acesso.trocaRapida.cracha (desligado; depende do dono). Puro: recebe o que o adaptador leu
// (o último login forte do usuário nesta estação, a situação do PIN, a conta) e devolve se a troca pode seguir, com o
// motivo da recusa. A conferência do PIN (Argon2id) fica no servidor; aqui só a regra (D-W101-36):
// - PIN só de dígitos, de `digitosPin` a 8; recusa o trivial (todos iguais, sequência crescente ou decrescente) e o
//   derivado do login ou da data de nascimento;
// - `tentativasPin` erros seguidos bloqueiam o PIN (só um novo PIN, definido depois de um login forte, o libera);
// - conta inativa ou bloqueada nunca troca; "hoje" é o dia civil do estabelecimento (AAAA-MM-DD, dado pelo adaptador).

export interface ParametrosTrocaRapida {
  /** acesso.trocaRapida.ligada: o PIN liga sozinho (padrão sim). */
  readonly ligada: boolean;
  /** acesso.trocaRapida.cracha: crachá por proximidade pelo agente local (padrão não; depende do dono). */
  readonly cracha: boolean;
  /** acesso.trocaRapida.digitosPin: tamanho mínimo do PIN (4 a 8; padrão 6). */
  readonly digitosPin: number;
  /** acesso.trocaRapida.tentativasPin: erros seguidos que bloqueiam o PIN (1 a 10; padrão 3). */
  readonly tentativasPin: number;
}

/** Padrões (D-W101-36; o dono confirma). */
export const PADRAO_TROCA_RAPIDA: ParametrosTrocaRapida = {
  ligada: true,
  cracha: false,
  digitosPin: 6,
  tentativasPin: 3,
};
export const DIGITOS_PIN_MINIMO = 4;
export const DIGITOS_PIN_MAXIMO = 8;

export interface RecusaTrocaRapida {
  readonly codigo: string;
  readonly mensagem: string;
  readonly campos?: readonly string[];
}

export interface ContextoNovoPin {
  readonly login: string;
  /** Data de nascimento AAAA-MM-DD, quando a ficha trouxer. */
  readonly nascimento?: string | null;
  readonly parametros: ParametrosTrocaRapida;
}

const sequencia = (pin: string, passo: 1 | -1): boolean =>
  [...pin].every((c, i) => i === 0 || (Number(c) - Number(pin[i - 1]) + 10) % 10 === (passo + 10) % 10);

/** Formas da data de nascimento que um PIN não pode conter (ddmmaa, ddmmaaaa, aaaammdd, mmdd, ddmm, aaaa). */
function formasNascimento(n: string | null | undefined): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(n ?? '');
  if (!m) return [];
  const [, a = '', me = '', d = ''] = m;
  return [`${d}${me}${a.slice(2)}`, `${d}${me}${a}`, `${a}${me}${d}`, `${me}${d}`, `${d}${me}`, a];
}

/** Recusas do PIN novo (vazio = aceito). O PIN nunca vai a mensagem, log ou trilha. */
export function validarNovoPin(pin: string, c: ContextoNovoPin): RecusaTrocaRapida[] {
  const p = c.parametros;
  if (!p.ligada)
    return [{ codigo: 'troca-rapida-desligada', mensagem: 'A troca rápida de usuário está desligada.' }];
  const min = Math.min(Math.max(p.digitosPin, DIGITOS_PIN_MINIMO), DIGITOS_PIN_MAXIMO);
  if (!/^\d+$/.test(pin) || pin.length < min || pin.length > DIGITOS_PIN_MAXIMO)
    return [
      {
        codigo: 'pin-formato',
        mensagem: `O PIN tem de ter de ${min} a ${DIGITOS_PIN_MAXIMO} dígitos, só números.`,
        campos: ['pin'],
      },
    ];
  const r: RecusaTrocaRapida[] = [];
  if (/^(\d)\1+$/.test(pin) || sequencia(pin, 1) || sequencia(pin, -1))
    r.push({
      codigo: 'pin-trivial',
      mensagem: 'O PIN não pode ser uma sequência nem repetir o mesmo dígito.',
      campos: ['pin'],
    });
  const digitosLogin = c.login.replace(/\D/g, '');
  const derivadoLogin =
    digitosLogin.length >= DIGITOS_PIN_MINIMO && (digitosLogin.includes(pin) || pin.includes(digitosLogin));
  const derivadoNascimento = formasNascimento(c.nascimento).some((f) => pin.includes(f));
  if (derivadoLogin || derivadoNascimento)
    r.push({
      codigo: 'pin-derivado',
      mensagem: 'O PIN não pode vir do login nem da data de nascimento.',
      campos: ['pin'],
    });
  return r;
}

export interface LoginForteNaEstacao {
  /** Dia civil do login forte, AAAA-MM-DD. */
  readonly dia: string;
  /** Identificação da estação (dispositivo) em que o login forte foi feito. */
  readonly estacao: string;
}

export interface SituacaoPin {
  readonly definido: boolean;
  readonly bloqueado: boolean;
}

export interface ContextoTrocaRapida {
  readonly parametros: ParametrosTrocaRapida;
  /** Dia civil de agora no estabelecimento, AAAA-MM-DD. */
  readonly hoje: string;
  /** Estação de onde vem o pedido de troca. */
  readonly estacao: string;
  readonly conta: { readonly ativo: boolean; readonly bloqueado: boolean } | null;
  readonly pin: SituacaoPin;
  /** Os logins fortes do usuário (o adaptador pode mandar só os de hoje). */
  readonly loginsFortes: readonly LoginForteNaEstacao[];
}

/**
 * A troca rápida pode seguir para a conferência do PIN? null = sim. A ordem das recusas não revela se a conta existe
 * antes do PIN: o servidor responde a recusa da conta com a mesma mensagem genérica do PIN errado.
 */
export function avaliarTrocaRapida(c: ContextoTrocaRapida): RecusaTrocaRapida | null {
  if (!c.parametros.ligada)
    return { codigo: 'troca-rapida-desligada', mensagem: 'A troca rápida de usuário está desligada.' };
  if (!c.conta || !c.conta.ativo || c.conta.bloqueado)
    return { codigo: 'conta-indisponivel', mensagem: 'Usuário ou PIN não conferem.' };
  if (!c.pin.definido)
    return {
      codigo: 'sem-pin',
      mensagem: 'Este usuário não tem PIN de troca rápida. Entre com a senha e defina o PIN.',
    };
  if (c.pin.bloqueado)
    return {
      codigo: 'pin-bloqueado',
      mensagem: 'O PIN foi bloqueado depois de erros seguidos. Entre com a senha e defina um PIN novo.',
    };
  const hoje = c.loginsFortes.filter((x) => x.dia === c.hoje);
  if (hoje.length === 0)
    return {
      codigo: 'sem-login-forte-hoje',
      mensagem: 'A troca rápida vale só depois de entrar com a senha hoje. Entre com a senha.',
    };
  if (!hoje.some((x) => x.estacao === c.estacao))
    return {
      codigo: 'outra-estacao',
      mensagem: 'A troca rápida vale só na estação em que você entrou com a senha hoje.',
    };
  return null;
}

/** Depois de um PIN errado: quantos erros seguidos e se o PIN fica bloqueado. */
export function aposFalhaPin(
  falhasAntes: number,
  p: ParametrosTrocaRapida,
): { readonly falhas: number; readonly bloquear: boolean } {
  const falhas = Math.max(0, falhasAntes) + 1;
  return { falhas, bloquear: falhas >= tetoFalhasPin(p) };
}

/** Erros seguidos que bloqueiam o PIN (1 a 10); a gravação conta e bloqueia de forma atômica (revisão, achado 4). */
export function tetoFalhasPin(p: Pick<ParametrosTrocaRapida, 'tentativasPin'>): number {
  return Math.min(Math.max(Math.trunc(p.tentativasPin), 1), 10);
}
