// Construtores das colunas das declarações do CRUD genérico (forma curta e uniforme; os tipos e tamanhos
// vêm do catálogo RDB$ e a conferência é do validarDeclaracao).
import type { ColunaDeclarada, ReferenciaCampo } from '@sgh/contratos';

/** Chave gerada pelo trigger BI (GEN_ID em laço quando a chave vem 0 ou nula): a tela não pede. */
export function chaveGerada(coluna: string, maximo: number): ColunaDeclarada {
  return {
    coluna,
    campo: 'codigo',
    rotulo: 'Código',
    tipo: 'inteiro',
    minimo: 1,
    maximo,
    obrigatorio: false,
    editavel: false,
    naInclusao: false,
    naLista: true,
    codigo: 'generator',
  };
}

/** Chave digitada (o legado não tem generator para a tabela): a tela pede; nunca MAX+1. */
export function chaveManual(coluna: string, maximo: number, minimo = 1): ColunaDeclarada {
  return {
    coluna,
    campo: 'codigo',
    rotulo: 'Código',
    tipo: 'inteiro',
    minimo,
    maximo,
    obrigatorio: true,
    editavel: false,
    naInclusao: true,
    naLista: true,
    codigo: 'manual',
  };
}

/** M10: chave de texto digitada (bloco, clínica, unidade de consumo): exata, nunca alterada. */
export function chaveTexto(coluna: string, maxBytes: number): ColunaDeclarada {
  return {
    coluna,
    campo: 'codigo',
    rotulo: 'Código',
    tipo: 'texto',
    maxBytes,
    obrigatorio: true,
    editavel: false,
    naInclusao: true,
    naLista: true,
    codigo: 'manual',
  };
}

/** M10: data civil (AAAA-MM-DD; DATE do Firebird). O feriado com ano 9999 é recorrente (regra 15). */
export function data(
  coluna: string,
  campo: string,
  rotulo: string,
  o: { readonly editavel?: boolean; readonly obrigatorio?: boolean } = {},
): ColunaDeclarada {
  return {
    coluna,
    campo,
    rotulo,
    tipo: 'data',
    obrigatorio: o.obrigatorio ?? true,
    editavel: o.editavel ?? false,
    naInclusao: true,
    naLista: true,
  };
}

export function texto(
  coluna: string,
  campo: string,
  rotulo: string,
  maxBytes: number,
  o: { readonly editavel?: boolean; readonly obrigatorio?: boolean; readonly naLista?: boolean } = {},
): ColunaDeclarada {
  return {
    coluna,
    campo,
    rotulo,
    tipo: 'texto',
    maxBytes,
    obrigatorio: o.obrigatorio ?? true,
    editavel: o.editavel ?? true,
    naInclusao: true,
    naLista: o.naLista ?? true,
  };
}

/** Inteiro digitado que não é a chave (código do legado que a tela pede e o trigger não deixa mudar). */
export function inteiro(
  coluna: string,
  campo: string,
  rotulo: string,
  minimo: number,
  maximo: number,
  o: { readonly editavel?: boolean; readonly obrigatorio?: boolean; readonly classe?: string } = {},
): ColunaDeclarada {
  return {
    coluna,
    campo,
    rotulo,
    tipo: 'inteiro',
    minimo,
    maximo,
    obrigatorio: o.obrigatorio ?? true,
    editavel: o.editavel ?? false,
    naInclusao: true,
    naLista: true,
    ...(o.classe ? { classe: o.classe } : {}),
  };
}

export function letra(
  coluna: string,
  campo: string,
  rotulo: string,
  valores: readonly { valor: string; rotulo: string }[],
  o: {
    readonly editavel?: boolean;
    readonly naInclusao?: boolean;
    readonly constanteNaInclusao?: string;
    readonly naLista?: boolean;
    readonly classe?: string;
  } = {},
): ColunaDeclarada {
  return {
    coluna,
    campo,
    rotulo,
    tipo: 'letra',
    maxBytes: 1,
    valores,
    obrigatorio: o.naInclusao ?? true,
    editavel: o.editavel ?? false,
    naInclusao: o.naInclusao ?? true,
    naLista: o.naLista ?? true,
    ...(o.constanteNaInclusao !== undefined ? { constanteNaInclusao: o.constanteNaInclusao } : {}),
    ...(o.classe ? { classe: o.classe } : {}),
  };
}

export function referencia(
  coluna: string,
  campo: string,
  rotulo: string,
  ref: ReferenciaCampo,
  maximo: number,
  o: { readonly obrigatorio?: boolean; readonly editavel?: boolean; readonly classe?: string } = {},
): ColunaDeclarada {
  return {
    coluna,
    campo,
    rotulo,
    tipo: 'referencia',
    minimo: 0,
    maximo,
    referencia: ref,
    obrigatorio: o.obrigatorio ?? true,
    editavel: o.editavel ?? true,
    naInclusao: true,
    naLista: true,
    ...(o.classe ? { classe: o.classe } : {}),
  };
}

/** Hora de duração guardada como TIMESTAMP 1899-12-30 HH:MM (TDateTime só de hora do Delphi). */
export function hora(
  coluna: string,
  campo: string,
  rotulo: string,
  o: { readonly editavel?: boolean } = {},
): ColunaDeclarada {
  return {
    coluna,
    campo,
    rotulo,
    tipo: 'hora',
    obrigatorio: true,
    editavel: o.editavel ?? true,
    naInclusao: true,
    naLista: true,
  };
}

/**
 * M10: coluna que a tela não mostra e a inclusão grava com a constante que o perfil mede (ex.: código de
 * faturamento 0, texto em branco), para gravar o que o legado grava.
 */
export function constanteOculta(
  coluna: string,
  campo: string,
  valor: string | number,
  classe: string,
  maxBytes?: number,
): ColunaDeclarada {
  return {
    coluna,
    campo,
    rotulo: campo,
    tipo: typeof valor === 'number' ? 'inteiro' : 'texto',
    ...(typeof valor === 'string' ? { maxBytes: maxBytes ?? Math.max(1, valor.length) } : {}),
    obrigatorio: false,
    editavel: false,
    naInclusao: false,
    naLista: false,
    constanteNaInclusao: valor,
    classe,
  };
}

export const SIM_NAO_TF = [
  { valor: 'T', rotulo: 'Ativo' },
  { valor: 'F', rotulo: 'Inativo' },
] as const;

/** Motivo medido para ID_DIGITAL (integração "Digital" do fornecedor; TBDIGITAL_INTEGRATOR_ITEM). */
export const MOTIVO_ID_DIGITAL =
  'preenchido depois pela integração Digital do fornecedor (TBDIGITAL_INTEGRATOR_ITEM), não pela tela: há linhas sem ele (PRVIAADMIN 2/8, perfil do M08) e nenhuma tela do novo o conhece; a inclusão deixa vazio (conferir no cenário controlado da Fase 4)';

/** Motivo medido para o código digitado (chave manual ou código que o trigger não deixa mudar). */
export const MOTIVO_CODIGO_DIGITADO =
  'código digitado na inclusão: o perfil vê os códigos já usados (estado atual) como domínio, mas a inclusão grava um código novo, livre, conferido na chave';
