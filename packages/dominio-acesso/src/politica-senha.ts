// Política de senha (cap-08 §8.8): as regras de TBCFGLOGIN somadas às mínimas do Sante SGH quando a troca é
// feita pelo novo (8 caracteres, letra e número, sem derivar do login). Regra pura: sem banco, sem HTTP.
import type { FalhaSenha } from '@sgh/contratos';

/** Regras lidas de TBCFGLOGIN (null: coluna vazia no legado). */
export interface PoliticaSenhaLegado {
  readonly minimoCaracteres: number | null;
  readonly exigeLetra: boolean;
  readonly exigeNumero: boolean;
  readonly exigeEspecial: boolean;
  readonly exigeMinuscula: boolean;
  readonly exigeMaiuscula: boolean;
  /** PERIOD_TROCA_SENHA, em dias (null ou 0: não expira). */
  readonly periodoTrocaDias: number | null;
  /** PERIOD_REUTILIZACAO_SENHA, em dias. */
  readonly periodoReutilizacaoDias: number | null;
}

/**
 * W1-01 (parte 5): a política do Sante por estabelecimento (SGH_ACESSO_POLITICA_SENHA, versão vigente). Complementa
 * TBCFGLOGIN: a efetiva é a mais exigente entre as duas (só aperta, nunca afrouxa).
 */
export interface PoliticaSenhaSante {
  readonly versao: number;
  readonly minimoCaracteres: number;
  readonly exigeEspecial: boolean;
  readonly exigeMinuscula: boolean;
  readonly exigeMaiuscula: boolean;
  /** Expiração em dias (0: não expira por aqui). */
  readonly trocaDias: number;
  /** Janela de reuso em dias (0: só a do legado). */
  readonly reusoDias: number;
  readonly recusaNome: boolean;
  readonly recusaNascimento: boolean;
  readonly recusaComuns: boolean;
  /** Lista local de senhas proibidas (além da embutida), já sem espaços nas pontas. */
  readonly senhasProibidas: readonly string[];
}

export interface PoliticaSenha {
  readonly minimoCaracteres: number;
  readonly exigeLetra: boolean;
  readonly exigeNumero: boolean;
  readonly exigeEspecial: boolean;
  readonly exigeMinuscula: boolean;
  readonly exigeMaiuscula: boolean;
  readonly periodoTrocaDias: number;
  readonly periodoReutilizacaoDias: number;
  /** W1-01 (parte 5): recusas do Sante (falsas sem a política do Sante). */
  readonly recusaNome?: boolean;
  readonly recusaNascimento?: boolean;
  readonly recusaComuns?: boolean;
  readonly senhasProibidas?: readonly string[];
}

/** Dados da pessoa para as recusas de senha derivada (W1-01, parte 5). Nascimento em AAAA-MM-DD. */
export interface PessoaDaSenha {
  readonly nome?: string | null;
  readonly nascimento?: string | null;
}

/** Mínimos do novo (cap-08 §8.8). */
export const MINIMO_DO_NOVO = 8;

/** O menor prazo positivo (0: nenhum dos dois expira). */
function menorPrazo(a: number, b: number): number {
  const p = [a, b].filter((x) => x > 0);
  return p.length === 0 ? 0 : Math.min(...p);
}

/**
 * Política efetiva: a mais exigente entre o legado (TBCFGLOGIN), o mínimo do novo e, se houver, a política do Sante
 * do estabelecimento (W1-01, parte 5: tamanho e reuso pelo maior, classes por "ou", expiração pelo menor prazo).
 */
export function politicaEfetiva(l: PoliticaSenhaLegado, sante?: PoliticaSenhaSante | null): PoliticaSenha {
  const base = {
    minimoCaracteres: Math.max(MINIMO_DO_NOVO, l.minimoCaracteres ?? 0),
    exigeLetra: true,
    exigeNumero: true,
    exigeEspecial: l.exigeEspecial,
    exigeMinuscula: l.exigeMinuscula,
    exigeMaiuscula: l.exigeMaiuscula,
    periodoTrocaDias: Math.max(0, l.periodoTrocaDias ?? 0),
    periodoReutilizacaoDias: Math.max(0, l.periodoReutilizacaoDias ?? 0),
  };
  if (!sante) return base;
  return {
    minimoCaracteres: Math.max(base.minimoCaracteres, sante.minimoCaracteres),
    exigeLetra: true,
    exigeNumero: true,
    exigeEspecial: base.exigeEspecial || sante.exigeEspecial,
    exigeMinuscula: base.exigeMinuscula || sante.exigeMinuscula,
    exigeMaiuscula: base.exigeMaiuscula || sante.exigeMaiuscula,
    periodoTrocaDias: menorPrazo(base.periodoTrocaDias, Math.max(0, sante.trocaDias)),
    periodoReutilizacaoDias: Math.max(base.periodoReutilizacaoDias, sante.reusoDias),
    recusaNome: sante.recusaNome,
    recusaNascimento: sante.recusaNascimento,
    recusaComuns: sante.recusaComuns,
    senhasProibidas: sante.senhasProibidas,
  };
}

/**
 * Lista embutida de senhas comuns/vazadas (W1-01, parte 5), já reduzidas (`reduzir`). Comparada com a senha reduzida
 * e com ela sem os dígitos do fim ("Brasil@2024" → "brasil"). A lista local do estabelecimento soma-se a esta.
 */
export const SENHAS_COMUNS: readonly string[] = [
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
  '111111',
  '000000',
  '654321',
  '123123',
  '112233',
  'senha',
  'senha123',
  'minhasenha',
  'mudar',
  'mudar123',
  'trocar',
  'acesso',
  'entrar',
  'bemvindo',
  'bemvinda',
  'password',
  'passw0rd',
  'qwerty',
  'qwerty123',
  'abc123',
  'abcd1234',
  'asdf',
  'asdfgh',
  'admin',
  'administrador',
  'root',
  'usuario',
  'teste',
  'teste123',
  'brasil',
  'deus',
  'deusefiel',
  'jesus',
  'jesuscristo',
  'amor',
  'amorvida',
  'flamengo',
  'corinthians',
  'palmeiras',
  'saopaulo',
  'vasco',
  'gremio',
  'cruzeiro',
  'santos',
  'hospital',
  'saude',
  'medico',
  'enfermagem',
  'enfermeira',
  'sante',
  'iloveyou',
  'princesa',
  'familia',
  'gabriel',
  'lucas',
  'maria',
];

const COMUNS = new Set(SENHAS_COMUNS);

/** A senha é comum ou proibida (lista embutida, se `embutida`, mais a lista local). */
export function senhaComum(senha: string, local: readonly string[], embutida: boolean): boolean {
  const r = reduzir(senha);
  if (r.length === 0) return false;
  const semFim = r.replace(/[0-9]+$/, '');
  const proibidas = new Set(local.map(reduzir).filter((x) => x.length > 0));
  const bate = (x: string) => x.length > 0 && ((embutida && COMUNS.has(x)) || proibidas.has(x));
  return bate(r) || bate(semFim);
}

/** A senha contém um pedaço do nome (palavra de 3 letras ou mais, sem acento; as preposições não contam). */
export function derivaDoNome(senha: string, nome: string | null | undefined): boolean {
  if (!nome) return false;
  const s = reduzir(senha);
  const ignorar = new Set(['das', 'dos', 'del', 'van', 'von']);
  return nome
    .split(/\s+/)
    .map(reduzir)
    .filter((p) => p.length >= 3 && !ignorar.has(p))
    .some((p) => s.includes(p));
}

/** A senha contém a data de nascimento (DDMMAAAA, AAAAMMDD, DDMMAA, AAMMDD ou MMDDAAAA). */
export function derivaDoNascimento(senha: string, nascimento: string | null | undefined): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(nascimento ?? '');
  if (!m) return false;
  const [, a, me, d] = m as unknown as [string, string, string, string];
  const digitos = senha.replace(/\D/g, '');
  const aa = a.slice(2);
  return [d + me + a, a + me + d, d + me + aa, aa + me + d, me + d + a].some((f) => digitos.includes(f));
}

/** Só letras e dígitos, sem acento e em minúsculas (para comparar com o login). */
export function reduzir(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** A senha deriva do login: contém o login (ou o inverso), ou o login contém a senha. */
export function derivaDoLogin(senha: string, login: string): boolean {
  const s = reduzir(senha);
  const l = reduzir(login);
  if (l.length < 3 || s.length === 0) return false;
  const invertido = [...l].reverse().join('');
  return s.includes(l) || s.includes(invertido) || l.includes(s);
}

/**
 * Falhas da senha nova (vazio: cumpre a política). `igual-atual` e `repetida` (histórico) são conferidas
 * pelo adaptador, que é o único a ver as senhas guardadas.
 */
export function avaliarSenhaNova(
  senha: string,
  login: string,
  p: PoliticaSenha,
  pessoa: PessoaDaSenha = {},
): FalhaSenha[] {
  const falhas: FalhaSenha[] = [];
  if ([...senha].length < p.minimoCaracteres) falhas.push('curta');
  if (p.exigeLetra && !/\p{L}/u.test(senha)) falhas.push('sem-letra');
  if (p.exigeNumero && !/\p{Nd}/u.test(senha)) falhas.push('sem-numero');
  if (p.exigeEspecial && !/[^\p{L}\p{Nd}\s]/u.test(senha)) falhas.push('sem-especial');
  if (p.exigeMinuscula && !/\p{Ll}/u.test(senha)) falhas.push('sem-minuscula');
  if (p.exigeMaiuscula && !/\p{Lu}/u.test(senha)) falhas.push('sem-maiuscula');
  if (derivaDoLogin(senha, login)) falhas.push('deriva-do-login');
  if (p.recusaNome && derivaDoNome(senha, pessoa.nome)) falhas.push('deriva-do-nome');
  if (p.recusaNascimento && derivaDoNascimento(senha, pessoa.nascimento)) falhas.push('deriva-do-nascimento');
  if (
    (p.recusaComuns || (p.senhasProibidas?.length ?? 0) > 0) &&
    senhaComum(senha, p.senhasProibidas ?? [], p.recusaComuns ?? false)
  )
    falhas.push('comum');
  return falhas;
}

const DIA_MS = 86_400_000;

/** A senha expirou pelo PERIOD_TROCA_SENHA (0: nunca). Sem data de alteração conhecida: não expira. */
export function senhaExpirada(alteradaEm: Date | null, agora: Date, periodoTrocaDias: number): boolean {
  if (periodoTrocaDias <= 0 || alteradaEm === null) return false;
  return agora.getTime() - alteradaEm.getTime() > periodoTrocaDias * DIA_MS;
}

/** Início da janela de reutilização (TBHISTSENHA dentro dela não pode ser repetida). */
export function inicioJanelaReutilizacao(agora: Date, periodoReutilizacaoDias: number): Date {
  return new Date(agora.getTime() - Math.max(0, periodoReutilizacaoDias) * DIA_MS);
}

/** Tamanho mínimo da senha provisória (W1-01, acesso.redefinirSenha): 12, ou o mínimo da política se maior. */
export const TAMANHO_SENHA_PROVISORIA = 12;

const CLASSES_PROVISORIA = [
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  'abcdefghijkmnpqrstuvwxyz',
  '23456789',
  '#@%+=!',
] as const;

/**
 * Senha provisória (W1-01): uma de cada classe (maiúscula, minúscula, dígito e especial, sem os caracteres que se
 * confundem: I, l, O, 0, 1), embaralhada, com o tamanho da política (mínimo 12). `sortear(n)` devolve um inteiro
 * uniforme em [0, n) (o servidor usa crypto.randomInt; os testes, uma sequência fixa). Recusa a que derivar do login
 * (tenta de novo). Cumpre `avaliarSenhaNova` por construção.
 */
export function gerarSenhaProvisoria(
  p: PoliticaSenha,
  login: string,
  sortear: (n: number) => number,
): string {
  const tamanho = Math.max(TAMANHO_SENHA_PROVISORIA, p.minimoCaracteres);
  const todas = CLASSES_PROVISORIA.join('');
  for (let tentativa = 0; tentativa < 50; tentativa++) {
    const c = CLASSES_PROVISORIA.map((cl) => cl[sortear(cl.length)] as string);
    while (c.length < tamanho) c.push(todas[sortear(todas.length)] as string);
    for (let i = c.length - 1; i > 0; i--) {
      const j = sortear(i + 1);
      [c[i], c[j]] = [c[j] as string, c[i] as string];
    }
    const senha = c.join('');
    if (avaliarSenhaNova(senha, login, p).length === 0) return senha;
  }
  throw new Error('Não foi possível gerar uma senha provisória que cumpra a política.');
}
