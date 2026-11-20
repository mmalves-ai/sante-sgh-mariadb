// O cadastro de paciente como o MPI da Rede o compara (M57; ficha, seção 4; ref 01 §2.2). A leitura (@sgh/legado,
// grupo `rede`) entrega os campos crus de um estabelecimento; aqui eles viram chaves comparáveis: CPF só quando é CPF de
// verdade (o placeholder '00000000000', sequências repetidas e dígito errado ficam de fora; regra 2), CNS só quando
// passa no algoritmo, nome e mãe normalizados e em chaves fonéticas (que só sugerem; regra 3), nascimento sem a data
// sentinela. Nada daqui é gravado: o índice guarda só identificadores (SGH_REDE_*).
import {
  chaveFonetica,
  cnsValido,
  cpfValido,
  normalizarChave,
  palavrasDoCadastro,
  somenteDigitos,
} from '@sgh/contratos';

/** Os campos do cadastro que o pareamento lê, já no formato dos contratos (datas AAAA-MM-DD). */
export interface CadastroRede {
  /** Código do estabelecimento (ARQ-1): o banco de onde o cadastro foi lido. */
  readonly estabelecimento: string;
  /** ID do cadastro no banco do estabelecimento. */
  readonly id: number;
  readonly prontuario: number;
  readonly nome: string | null;
  readonly mae: string | null;
  readonly nascimento: string | null;
  readonly sexo: string | null;
  /** CPF como veio (número ou texto); o placeholder e o inválido viram ausente. */
  readonly cpf: string | number | null;
  readonly cns: string | null;
  /** Cadastro ativo (o inativo não pareia; o sobrevivente da unificação é quem representa a pessoa). */
  readonly ativo: boolean;
  /** ID do cadastro sobrevivente quando este foi unificado (igual ao próprio ID quando não foi). */
  readonly idUnificado: number | null;
}

/** O cadastro com as chaves de comparação prontas. */
export interface CadastroComparavelRede {
  readonly estabelecimento: string;
  readonly id: number;
  readonly prontuario: number;
  /** 11 dígitos de um CPF válido, ou null (ausente, placeholder, sequência ou dígito errado). */
  readonly cpf: string | null;
  /** 15 dígitos de um CNS válido, ou null. */
  readonly cns: string | null;
  /** Nome normalizado (sem acento, maiúsculas, espaços simples), ou null. */
  readonly nome: string | null;
  /** Chaves fonéticas das palavras do nome com mais de duas letras (sem conectivos). */
  readonly nomeFonetico: readonly string[];
  readonly mae: string | null;
  readonly maeFonetica: readonly string[];
  /** AAAA-MM-DD, ou null (ausente ou sentinela). */
  readonly nascimento: string | null;
  readonly sexo: 'F' | 'M' | null;
  /** Pode parear: ativo e não absorvido por uma unificação. */
  readonly elegivel: boolean;
}

/** Data a partir da qual o nascimento é levado a sério (as sentinelas são 1899-12-30 e 1900-01-01). */
export const NASCIMENTO_MINIMO = '1900-01-02';

/** O CPF útil para parear: 11 dígitos válidos; o placeholder e o inválido nunca pareiam (regra 2). */
export function cpfParaParear(valor: string | number | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  const n = typeof valor === 'number' ? Math.trunc(valor) : Number(somenteDigitos(String(valor)) || '0');
  if (!Number.isFinite(n) || n <= 0 || n > 99_999_999_999) return null;
  const cpf = String(n).padStart(11, '0');
  return cpfValido(cpf) ? cpf : null;
}

/** O CNS útil para parear: 15 dígitos que passam no algoritmo. */
export function cnsParaParear(valor: string | null | undefined): string | null {
  const d = somenteDigitos(String(valor ?? ''));
  return cnsValido(d) ? d : null;
}

/** Chaves fonéticas de um nome (palavras com mais de duas letras, na ordem). */
export function chavesFoneticas(nome: string | null | undefined): string[] {
  return palavrasDoCadastro(nome)
    .filter((p) => p.length > 2)
    .map(chaveFonetica);
}

function nascimentoUtil(valor: string | null): string | null {
  if (!valor || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
  return valor >= NASCIMENTO_MINIMO ? valor : null;
}

function sexoUtil(valor: string | null): 'F' | 'M' | null {
  const s = (valor ?? '').trim().toUpperCase();
  return s === 'F' || s === 'M' ? s : null;
}

export function comparavel(c: CadastroRede): CadastroComparavelRede {
  const nome = normalizarChave(c.nome) || null;
  const mae = normalizarChave(c.mae) || null;
  return {
    estabelecimento: c.estabelecimento,
    id: c.id,
    prontuario: c.prontuario,
    cpf: cpfParaParear(c.cpf),
    cns: cnsParaParear(c.cns),
    nome,
    nomeFonetico: chavesFoneticas(nome),
    mae,
    maeFonetica: chavesFoneticas(mae),
    nascimento: nascimentoUtil(c.nascimento),
    sexo: sexoUtil(c.sexo),
    elegivel: c.ativo && (c.idUnificado === null || c.idUnificado === c.id),
  };
}
