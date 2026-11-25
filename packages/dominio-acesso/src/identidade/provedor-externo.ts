// LOGIN ÚNICO CORPORATIVO (01-ADM L61): as regras do provedor de identidade do hospital (diretório LDAP ou Active
// Directory, OpenID Connect, SAML), do vínculo da conta local com o identificador externo e da entrada por provedor.
// Regras puras (sem I/O): a API confere a assinatura do token com a chave publicada pelo provedor e grava no banco;
// aqui ficam o que o cadastro exige por protocolo, o que o token tem de trazer (emissor, público, validade, nonce),
// quem pode entrar (vínculo ativo, provedor ativo) e o que continua valendo quando a senha local não é usada:
// o segundo fator e a contagem de tentativas (bloqueio) nunca são dispensados pela entrada externa.

export const PROTOCOLOS_PROVEDOR = ['oidc', 'ldap', 'active_directory', 'saml'] as const;
export type ProtocoloProvedor = (typeof PROTOCOLOS_PROVEDOR)[number];

/** Protocolos com a entrada já ligada na API (os demais ficam cadastráveis, sem botão na tela de entrada). */
export const PROTOCOLOS_COM_ENTRADA: readonly ProtocoloProvedor[] = ['oidc'];

export interface CadastroProvedor {
  readonly codigo: string;
  readonly nome: string;
  readonly protocolo: string;
  readonly urlServidor: string;
  readonly dominio?: string | null;
  readonly basePesquisa?: string | null;
  readonly filtroUsuario?: string | null;
  readonly emissor?: string | null;
  readonly clienteIdentificador?: string | null;
  readonly referenciaCofre?: string | null;
  readonly atributoLogin?: string | null;
  readonly atributoEmail?: string | null;
  readonly atributoGrupo?: string | null;
}

export type FalhaCadastroProvedor =
  | 'codigo-invalido'
  | 'nome-curto'
  | 'protocolo-invalido'
  | 'url-invalida'
  | 'url-sem-tls'
  | 'emissor-obrigatorio'
  | 'emissor-sem-tls'
  | 'cliente-obrigatorio'
  | 'base-pesquisa-obrigatoria'
  | 'dominio-obrigatorio'
  | 'referencia-cofre-invalida'
  | 'segredo-no-cadastro';

const CODIGO = /^[a-z0-9][a-z0-9_-]{1,29}$/;
/** A referência do cofre é uma chave (letras, dígitos, ponto, barra, dois-pontos, hífen); nunca o segredo. */
const REFERENCIA = /^[a-z0-9][a-z0-9._:/-]{2,199}$/;

function url(texto: string | null | undefined): URL | null {
  try {
    return texto ? new URL(texto) : null;
  } catch {
    return null;
  }
}

/** Parece um segredo colado no lugar da referência (longo, com caracteres de senha ou de token). */
function pareceSegredo(v: string): boolean {
  return /[A-Z]/.test(v) && /[0-9]/.test(v) && v.length >= 16 && !/[/:.]/.test(v);
}

/**
 * O que o cadastro exige por protocolo. OpenID: emissor https e identificador do cliente. SAML: emissor (entidade) e o
 * endereço https de entrada. LDAP: base de pesquisa e ldaps:// (o diretório nunca recebe senha em texto aberto); Active
 * Directory: também o domínio. A credencial (segredo do cliente, conta de serviço do diretório) fica no cofre: o
 * cadastro guarda só a referência.
 */
export function validarCadastroProvedor(c: CadastroProvedor): readonly FalhaCadastroProvedor[] {
  const f: FalhaCadastroProvedor[] = [];
  if (!CODIGO.test(c.codigo)) f.push('codigo-invalido');
  if (c.nome.trim().length < 3) f.push('nome-curto');
  const protocolo = c.protocolo as ProtocoloProvedor;
  if (!PROTOCOLOS_PROVEDOR.includes(protocolo)) {
    f.push('protocolo-invalido');
    return f;
  }
  const u = url(c.urlServidor);
  if (!u) f.push('url-invalida');
  else if (protocolo === 'ldap' || protocolo === 'active_directory') {
    if (u.protocol !== 'ldaps:') f.push('url-sem-tls');
  } else if (u.protocol !== 'https:') f.push('url-sem-tls');
  if (protocolo === 'oidc' || protocolo === 'saml') {
    if (!c.emissor?.trim()) f.push('emissor-obrigatorio');
    else if (protocolo === 'oidc' && url(c.emissor)?.protocol !== 'https:') f.push('emissor-sem-tls');
  }
  if (protocolo === 'oidc' && !c.clienteIdentificador?.trim()) f.push('cliente-obrigatorio');
  if ((protocolo === 'ldap' || protocolo === 'active_directory') && !c.basePesquisa?.trim())
    f.push('base-pesquisa-obrigatoria');
  if (protocolo === 'active_directory' && !c.dominio?.trim()) f.push('dominio-obrigatorio');
  const ref = c.referenciaCofre?.trim();
  if (ref) {
    if (pareceSegredo(ref)) f.push('segredo-no-cadastro');
    else if (!REFERENCIA.test(ref)) f.push('referencia-cofre-invalida');
  }
  return f;
}

/** Os valores padrão por protocolo (o atributo do login no diretório, do e-mail e dos grupos no token). */
export function padroesDoProtocolo(protocolo: ProtocoloProvedor): {
  readonly atributoLogin: string;
  readonly atributoEmail: string;
  readonly atributoGrupo: string;
} {
  if (protocolo === 'active_directory')
    return { atributoLogin: 'sAMAccountName', atributoEmail: 'mail', atributoGrupo: 'memberOf' };
  if (protocolo === 'ldap') return { atributoLogin: 'uid', atributoEmail: 'mail', atributoGrupo: 'memberOf' };
  return { atributoLogin: 'sub', atributoEmail: 'email', atributoGrupo: 'groups' };
}

// ---------------------------------------------------------------------------------------------------------------
// Token de identidade do OpenID Connect (as reivindicações; a assinatura é conferida pela API com a chave publicada).

export interface ReivindicacoesOidc {
  readonly iss?: unknown;
  readonly aud?: unknown;
  readonly azp?: unknown;
  readonly sub?: unknown;
  readonly exp?: unknown;
  readonly iat?: unknown;
  readonly nbf?: unknown;
  readonly nonce?: unknown;
}

export type FalhaTokenOidc =
  | 'emissor-diferente'
  | 'publico-diferente'
  | 'parte-autorizada-diferente'
  | 'sem-sujeito'
  | 'expirado'
  | 'ainda-nao-valido'
  | 'emitido-no-futuro'
  | 'nonce-diferente';

/** Tolerância de relógio entre o provedor e o servidor. */
export const TOLERANCIA_RELOGIO_SEGUNDOS = 120;

/**
 * As reivindicações do token de identidade (OpenID Connect Core, 3.1.3.7): o emissor é o cadastrado, o público
 * contém o identificador do cliente (e, com vários públicos, a parte autorizada é ele), o sujeito existe, o token está
 * na validade (com a tolerância do relógio) e o nonce é o desta entrada (impede a repetição de um token antigo).
 */
export function conferirReivindicacoesOidc(
  r: ReivindicacoesOidc,
  esperado: {
    readonly emissor: string;
    readonly cliente: string;
    readonly nonce: string;
    readonly agoraMs: number;
  },
): readonly FalhaTokenOidc[] {
  const f: FalhaTokenOidc[] = [];
  const semBarra = (s: string) => s.replace(/\/+$/, '');
  if (typeof r.iss !== 'string' || semBarra(r.iss) !== semBarra(esperado.emissor))
    f.push('emissor-diferente');
  const aud = Array.isArray(r.aud) ? r.aud : [r.aud];
  if (!aud.includes(esperado.cliente)) f.push('publico-diferente');
  if (aud.length > 1 && r.azp !== esperado.cliente) f.push('parte-autorizada-diferente');
  if (typeof r.sub !== 'string' || r.sub.trim() === '' || r.sub.length > 255) f.push('sem-sujeito');
  const agora = Math.floor(esperado.agoraMs / 1000);
  const t = TOLERANCIA_RELOGIO_SEGUNDOS;
  if (typeof r.exp !== 'number' || r.exp + t < agora) f.push('expirado');
  if (typeof r.nbf === 'number' && r.nbf - t > agora) f.push('ainda-nao-valido');
  if (typeof r.iat === 'number' && r.iat - t > agora) f.push('emitido-no-futuro');
  if (typeof r.nonce !== 'string' || r.nonce !== esperado.nonce) f.push('nonce-diferente');
  return f;
}

/** Os grupos do usuário na reivindicação configurada (lista de textos ou texto separado por vírgula). */
export function gruposDaReivindicacao(valor: unknown): readonly string[] {
  const lista = Array.isArray(valor) ? valor : typeof valor === 'string' ? valor.split(',') : [];
  return [...new Set(lista.filter((g): g is string => typeof g === 'string').map((g) => g.trim()))]
    .filter((g) => g !== '' && g.length <= 300)
    .sort();
}

// ---------------------------------------------------------------------------------------------------------------
// Perfil padrão por grupo do diretório.

export interface MapaGrupoPerfil {
  readonly grupoExterno: string;
  readonly perfil: string;
  /** Nulo: vale para todos os estabelecimentos. */
  readonly estabelecimento: number | null;
  readonly ativo: boolean;
}

/**
 * Os perfis que os grupos do usuário dão no estabelecimento: só os mapas ativos do estabelecimento ou de todos; o nome
 * do grupo compara sem diferença de maiúsculas (o diretório não distingue). Sem grupo mapeado: nenhum perfil.
 */
export function perfisDosGrupos(
  mapa: readonly MapaGrupoPerfil[],
  grupos: readonly string[],
  estabelecimento: number,
): readonly string[] {
  const meus = new Set(grupos.map((g) => g.toLowerCase()));
  return [
    ...new Set(
      mapa
        .filter((m) => m.ativo && (m.estabelecimento === null || m.estabelecimento === estabelecimento))
        .filter((m) => meus.has(m.grupoExterno.toLowerCase()))
        .map((m) => m.perfil),
    ),
  ].sort();
}

/** Marca do motivo dos perfis dados pelo diretório: só esses a sincronização mexe (os do gestor ficam). */
export const MOTIVO_PERFIL_DIRETORIO = 'Grupo do diretório';

export interface PerfilAtualDaConta {
  readonly id: number;
  readonly perfil: string;
  readonly vigenciaInicio: string;
  /** Verdadeiro quando a atribuição veio da sincronização com o diretório. */
  readonly doDiretorio: boolean;
}

export interface SincronizacaoPerfis {
  readonly incluir: readonly string[];
  /** Encerrar a vigência ontem (atribuição de dias anteriores) ou anular (dada hoje, a vigência não volta atrás). */
  readonly encerrar: readonly { readonly id: number; readonly modo: 'fim' | 'anular' }[];
}

/**
 * A sincronização dos perfis na entrada (provedor com sincroniza_perfis ligado): inclui o perfil que um grupo dá e a
 * conta ainda não tem; tira só o perfil que o diretório deu e o grupo deixou de dar. O perfil dado pelo gestor nunca é
 * tirado e a atribuição nunca é apagada: encerra a vigência (histórico preservado). `hoje` no formato AAAA-MM-DD.
 */
export function sincronizarPerfis(e: {
  readonly desejados: readonly string[];
  readonly atuais: readonly PerfilAtualDaConta[];
  readonly hoje: string;
}): SincronizacaoPerfis {
  const desejados = new Set(e.desejados);
  const tem = new Set(e.atuais.map((a) => a.perfil));
  return {
    incluir: [...desejados].filter((p) => !tem.has(p)).sort(),
    encerrar: e.atuais
      .filter((a) => a.doDiretorio && !desejados.has(a.perfil))
      .map((a) => ({ id: a.id, modo: a.vigenciaInicio < e.hoje ? ('fim' as const) : ('anular' as const) })),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Entrada pelo provedor: quem entra e o vínculo no primeiro acesso.

export interface VinculoExistente {
  readonly id: number;
  readonly usuario: number;
  readonly login: string;
  readonly ativo: boolean;
  readonly validoAte: Date | null;
}

export interface ContaPorEmail {
  readonly usuario: number;
  readonly login: string;
}

export type DecisaoEntradaExterna =
  | { readonly tipo: 'entrar'; readonly vinculo: number; readonly login: string }
  | { readonly tipo: 'vincular'; readonly usuario: number; readonly login: string }
  | {
      readonly tipo: 'recusar';
      readonly motivo: 'provedor-inativo' | 'vinculo-inativo' | 'vinculo-vencido' | 'sem-vinculo';
    };

/**
 * Quem entra pela identidade externa. O provedor inativo recusa tudo. O vínculo ativo e na validade entra; o
 * desligado ou vencido recusa (o gestor religa: nada se cria por cima). Sem vínculo: no primeiro acesso, o provedor que
 * cria a conta automaticamente liga a identidade à ÚNICA conta local com o mesmo e-mail (o e-mail do provedor
 * confirmado); duas contas com o e-mail, ou nenhuma, recusam e o gestor liga pela tela.
 */
export function decidirEntradaExterna(e: {
  readonly provedorAtivo: boolean;
  readonly criaContaAutomatica: boolean;
  readonly vinculo: VinculoExistente | null;
  readonly emailConfirmado: boolean;
  readonly contasComEmail: readonly ContaPorEmail[];
  readonly agora: Date;
}): DecisaoEntradaExterna {
  if (!e.provedorAtivo) return { tipo: 'recusar', motivo: 'provedor-inativo' };
  if (e.vinculo) {
    if (!e.vinculo.ativo) return { tipo: 'recusar', motivo: 'vinculo-inativo' };
    if (e.vinculo.validoAte && e.vinculo.validoAte.getTime() < e.agora.getTime())
      return { tipo: 'recusar', motivo: 'vinculo-vencido' };
    return { tipo: 'entrar', vinculo: e.vinculo.id, login: e.vinculo.login };
  }
  const [unica, ...outras] = e.contasComEmail;
  if (e.criaContaAutomatica && e.emailConfirmado && unica && outras.length === 0)
    return { tipo: 'vincular', usuario: unica.usuario, login: unica.login };
  return { tipo: 'recusar', motivo: 'sem-vinculo' };
}

/**
 * O que continua valendo na entrada externa (regra da L61): o provedor confere só a identidade. A conta local segue
 * as regras dela: bloqueada, inativa ou fora de grupo não entra; o segundo fator da política do perfil é pedido como na
 * senha; e a entrada conta tentativa (o bloqueio por excesso vale também aqui). A troca de senha não é pedida.
 */
export const EXIGENCIAS_ENTRADA_EXTERNA = {
  segundoFator: true,
  contaTentativas: true,
  respeitaBloqueioDaConta: true,
  pedeTrocaDeSenha: false,
} as const;

/** O vínculo novo pelo gestor: a mesma identidade não liga duas contas, e a conta não tem dois vínculos no provedor. */
export function conferirVinculoNovo(e: {
  readonly identificador: string;
  readonly identidadeJaLigada: boolean;
  readonly contaJaLigada: boolean;
}): 'identificador-invalido' | 'identidade-ja-ligada' | 'conta-ja-ligada' | null {
  const id = e.identificador.trim();
  if (id === '' || id.length > 255) return 'identificador-invalido';
  if (e.identidadeJaLigada) return 'identidade-ja-ligada';
  if (e.contaJaLigada) return 'conta-ja-ligada';
  return null;
}
