// Redação de dado pessoal nos logs (regra 1.7; regra 12 da ficha do M09; cap-09 §9.11): campos com nome de
// dado pessoal (CPF, nome, telefone, e-mail, endereço, CNS, nascimento, texto clínico, e os nomes de coluna do
// legado como MAE, NASC, NOME_GUARDIAO, CPF_GUARDIAO, ALERGIA) viram "[oculto]" em qualquer nível do objeto
// (correspondência por trecho do nome, com exceções revisadas), e números com forma de CPF, CNS, telefone ou e-mail são mascarados também no
// texto livre da mensagem. Regra pura: a API e o worker a ligam no pino (formatters.log e hooks.logMethod).

export const OCULTO = '[oculto]';

/** Nomes inteiros (normalizados: sem _, espaço e hífen, minúsculos) que são dado pessoal. */
const CHAVES = new Set([
  'texto',
  'textoclinico',
  'evolucao',
  'observacao',
  'anamnese',
  'diagnostico',
  'paciente',
  'prontuario',
  'pront',
  'sexo',
  'justificacpf',
]);

/**
 * Trechos que, em qualquer posição do nome, marcam dado pessoal (nomePaciente, pacienteNome,
 * cpfResponsavel, NOME_GUARDIAO, TELEFONE_GUARDIAO, NOMEFNT…): correspondência por trecho, não exata.
 */
const TRECHOS = [
  'cpf',
  'cns',
  'nome',
  'fone',
  'celular',
  'mail',
  'nasc',
  'endereco',
  'logradouro',
  'bairro',
  'guardiao',
  'responsavel',
  'alergia',
  'cirurgia',
  'senha',
  'segredo',
  'token',
];

/** Palavras curtas que só contam como palavra inteira do nome (MAE, MAEFNT, RG, END, CEP; nunca "painel"). */
const PALAVRAS = ['mae', 'maefnt', 'pai', 'rg', 'end', 'cep'];

/**
 * Exceções revisadas: nomes com um trecho pessoal que não guardam dado pessoal (nome de arquivo, de modelo,
 * de tabela…). Normalizados como em CHAVES.
 */
const EXCECOES = new Set([
  'nomeestabelecimento',
  'nomearquivo',
  'nomemodelo',
  'nomeproduto',
  'nomeservico',
  'nomesistema',
  'nometabela',
  'nomecoluna',
  'nometela',
  'nomerota',
  'nomefila',
  'nomeimagem',
  // Nome do estabelecimento (conferência do M02), não de pessoa.
  'nomeconfere',
  'nomeconfigurado',
  'nomehospital',
  'nomenobanco',
  'nomenormalizado',
  'produtonome',
]);

function palavrasDe(chave: string): string[] {
  return chave
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .split(/[_\s.-]+/)
    .map((p) => p.toLowerCase())
    .filter(Boolean);
}

const PADROES: readonly RegExp[] = [
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, // CPF
  /\b[1-9]\d{2} ?\d{4} ?\d{4} ?\d{4}\b/g, // CNS (15 dígitos)
  /\(?\b\d{2}\)? ?9?\d{4}-?\d{4}\b/g, // telefone
  /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, // e-mail
];

export function chavePessoal(chave: string): boolean {
  const palavras = palavrasDe(chave);
  const junto = palavras.join('');
  if (EXCECOES.has(junto)) return false;
  if (CHAVES.has(junto)) return true;
  if (TRECHOS.some((t) => junto.includes(t))) return true;
  return palavras.some((p) => PALAVRAS.includes(p));
}

export function mascararTexto(texto: string): string {
  return PADROES.reduce((s, re) => s.replace(re, OCULTO), texto);
}

/** Cópia do objeto com os campos pessoais ocultos e os textos mascarados (sem ciclos infinitos). */
export function redigir<T>(valor: T, profundidade = 0, vistos: WeakSet<object> = new WeakSet()): T {
  if (typeof valor === 'string') return mascararTexto(valor) as T;
  if (valor === null || typeof valor !== 'object' || profundidade > 8) return valor;
  if (vistos.has(valor)) return '[ciclo]' as T;
  vistos.add(valor);
  if (Array.isArray(valor)) return valor.map((v) => redigir(v, profundidade + 1, vistos)) as T;
  if (valor instanceof Error) return { name: valor.name, message: mascararTexto(valor.message) } as T;
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(valor)) {
    saida[k] =
      chavePessoal(k) && v !== null && v !== undefined ? OCULTO : redigir(v, profundidade + 1, vistos);
  }
  return saida as T;
}

/** Argumento de log redigido (texto mascarado; erro trocado por cópia com mensagem e pilha mascaradas). */
export function redigirArgumentoLog(a: unknown): unknown {
  if (typeof a === 'string') return mascararTexto(a);
  if (a instanceof Error) {
    const copia = new Error(mascararTexto(a.message));
    copia.name = a.name;
    copia.stack = a.stack ? mascararTexto(a.stack) : '';
    return copia;
  }
  return a;
}
