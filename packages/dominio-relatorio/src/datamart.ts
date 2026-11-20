// Data mart pseudonimizado (M16; regra 17; cap-07 §7.5.4; ADR 0025): fora do banco de produção, carregado da
// cópia diária, sem nome, CPF, telefone, endereço nem texto clínico. O paciente e a internação viram pseudônimo
// HMAC-SHA-256 com chave do cofre (a mesma chave dá o mesmo pseudônimo entre cargas; sem a chave, ninguém volta ao
// número); o nascimento vira faixa etária. O esquema é declarado aqui e conferido pelo verificador do data mart
// (tools/verificadores/src/datamart.ts): coluna com nome identificador reprova.
import { createHmac } from 'node:crypto';

export type TipoColunaDataMart = 'texto' | 'inteiro' | 'real';

export interface TabelaDataMart {
  readonly nome: string;
  readonly descricao: string;
  readonly colunas: Readonly<Record<string, TipoColunaDataMart>>;
}

/** Esquema do data mart (SQLite; um arquivo por estabelecimento). */
export const ESQUEMA_DATAMART: readonly TabelaDataMart[] = [
  {
    nome: 'fato_internacao_dia',
    descricao: 'Um paciente internado na hora de fechamento de um dia (paciente-dia), pela unidade do trecho',
    colunas: {
      estabelecimento: 'texto',
      data: 'texto',
      mes: 'texto',
      unidade: 'texto',
      tipo_acomodacao: 'texto',
      intensiva: 'inteiro',
      paciente_pseudonimo: 'texto',
      internacao_pseudonimo: 'texto',
      clinica: 'texto',
      faixa_etaria: 'texto',
      sexo: 'texto',
    },
  },
  {
    nome: 'fato_internacao',
    descricao:
      'Uma internação: mês de entrada e de saída, caráter, clínica, grupo do motivo de alta e permanência',
    colunas: {
      estabelecimento: 'texto',
      internacao_pseudonimo: 'texto',
      paciente_pseudonimo: 'texto',
      mes_entrada: 'texto',
      mes_saida: 'texto',
      carater: 'texto',
      clinica: 'texto',
      grupo_motivo_alta: 'texto',
      permanencia_dias: 'real',
      diarias_faturaveis: 'inteiro',
      obito_institucional: 'inteiro',
      faixa_etaria: 'texto',
      sexo: 'texto',
      convenio: 'texto',
    },
  },
  {
    nome: 'fato_atendimento',
    descricao: 'Atendimentos por mês, tipo, convênio e especialidade (contagem)',
    colunas: {
      estabelecimento: 'texto',
      mes: 'texto',
      tipo_atendimento: 'texto',
      convenio: 'texto',
      especialidade: 'texto',
      quantidade: 'inteiro',
    },
  },
  {
    nome: 'fato_item_conta',
    descricao: 'Itens de conta agregados por mês do item, competência, tipo de conta, natureza e convênio',
    colunas: {
      estabelecimento: 'texto',
      mes_item: 'texto',
      mes_competencia: 'texto',
      tipo_conta: 'texto',
      natureza: 'texto',
      convenio: 'texto',
      itens: 'inteiro',
      cobrado: 'real',
      pago: 'real',
      cobrado_baixado: 'real',
      pago_baixado: 'real',
    },
  },
  {
    nome: 'fato_dispensacao',
    descricao: 'Dispensações por mês (quantidade de registros e soma das quantidades)',
    colunas: { estabelecimento: 'texto', mes: 'texto', registros: 'inteiro', quantidade: 'real' },
  },
  {
    nome: 'carga',
    descricao:
      'Metadados de cada carga (estabelecimento, data da cópia, versão do esquema, o modo do pseudônimo do paciente e a impressão da chave do pseudônimo; sem dado de pessoa)',
    colunas: {
      estabelecimento: 'texto',
      carregado_em: 'texto',
      dados_ate: 'texto',
      versao_esquema: 'inteiro',
      modo_pseudonimo: 'texto',
      chave_impressao: 'texto',
    },
  },
];

/**
 * Versão 2 (M57, etapa 3): a coluna `estabelecimento` em todo fato (o arquivo da Rede é a união dos arquivos de cada
 * estabelecimento, com a dimensão hospital) e o modo do pseudônimo do paciente na carga. Versão 3 (M57, etapa 3,
 * correção da revisão): a impressão da chave do pseudônimo na carga (as cargas de chaves diferentes não se juntam).
 */
export const VERSAO_ESQUEMA_DATAMART = 3;

/**
 * Nomes de coluna que denunciam dado identificador ou clínico (o verificador reprova). Os pseudônimos têm o
 * sufixo `_pseudonimo` e são a única forma de chegar ao paciente ou à internação.
 */
const PROIBIDAS: readonly RegExp[] = [
  /(^|_)nome($|_)/,
  /cpf|cns|rg($|_)|documento|matricula|carteira/,
  /telefone|fone|celular|email|e_mail/,
  /endereco|logradouro|rua|bairro|cep|numero_casa|complemento/,
  /nascimento|nasc($|_)|data_nasc/,
  /mae|pai($|_)|responsavel/,
  /evolucao|anamnese|texto|observacao|obs($|_)|diagnostico|cid|prescricao|laudo/,
  /(^|_)(paciente|prontuario|internacao|reg|pront)$/,
];

/** Colunas proibidas de um esquema (tabela.coluna). */
export function colunasIdentificadoras(
  esquema: readonly Pick<TabelaDataMart, 'nome' | 'colunas'>[],
): string[] {
  const r: string[] = [];
  for (const t of esquema)
    for (const c of Object.keys(t.colunas)) {
      const n = c.toLowerCase();
      if (n.endsWith('_pseudonimo')) continue;
      if (PROIBIDAS.some((p) => p.test(n))) r.push(`${t.nome}.${c}`);
    }
  return r;
}

/** Pseudônimo HMAC-SHA-256 (20 caracteres hexadecimais) de um identificador, com o escopo no texto. */
export function pseudonimo(chave: string | Buffer, escopo: string, id: number | string): string {
  if ((typeof chave === 'string' ? Buffer.byteLength(chave) : chave.length) < 16)
    throw new Error('Chave do pseudônimo curta demais (mínimo de 16 bytes).');
  return createHmac('sha256', chave).update(`${escopo}:${id}`).digest('hex').slice(0, 20);
}

/**
 * A impressão da chave do pseudônimo (16 caracteres hexadecimais): um HMAC de um texto fixo com a chave, que não
 * devolve a chave e só serve para conferir que duas cargas usaram a MESMA chave (senão, a mesma pessoa da Rede teria
 * pseudônimos diferentes nos dois arquivos, e a junção da Rede misturaria pseudônimos de chaves diferentes).
 */
export function impressaoDaChave(chave: string | Buffer): string {
  return pseudonimo(chave, 'sgh:datamart', 'impressao-da-chave').slice(0, 16);
}

/** Faixa etária (o nascimento nunca vai ao data mart). */
export function faixaEtaria(idade: number | null): string {
  if (idade === null || idade < 0) return 'nao-informada';
  if (idade < 1) return '0';
  if (idade < 5) return '1-4';
  if (idade < 15) return '5-14';
  if (idade < 30) return '15-29';
  if (idade < 45) return '30-44';
  if (idade < 60) return '45-59';
  if (idade < 75) return '60-74';
  return '75+';
}

/** Sexo reduzido a M, F ou "nao-informado". */
export function sexoDoDataMart(sexo: string | null | undefined): string {
  const s = (sexo ?? '').trim().toUpperCase();
  return s === 'M' || s === 'F' ? s : 'nao-informado';
}

/** DDL SQLite do esquema (CREATE TABLE IF NOT EXISTS). */
export function ddlDoDataMart(): string[] {
  const tipo: Record<TipoColunaDataMart, string> = { texto: 'TEXT', inteiro: 'INTEGER', real: 'REAL' };
  return ESQUEMA_DATAMART.map(
    (t) =>
      `CREATE TABLE IF NOT EXISTS ${t.nome} (${Object.entries(t.colunas)
        .map(([c, x]) => `${c} ${tipo[x]}`)
        .join(', ')})`,
  );
}

// ── Pseudônimo da Rede (M57, etapa 3; regra 9; DP-42) ────────────────────────────────────────────────────────────

/**
 * Modo do pseudônimo do paciente: `por-estabelecimento` (padrão; o mesmo paciente tem pseudônimos diferentes em cada
 * estabelecimento, e a reinternação só se conta dentro de cada um) ou `comum` (só com a DP-42 registrada: o paciente
 * ligado no MPI da Rede tem o mesmo pseudônimo em todos, derivado da pessoa da Rede).
 */
export const MODOS_PSEUDONIMO = ['por-estabelecimento', 'comum'] as const;
export type ModoPseudonimo = (typeof MODOS_PSEUDONIMO)[number];

/** Escopo do pseudônimo comum (a pessoa da Rede, nunca o ID do cadastro de um estabelecimento). */
export const ESCOPO_PSEUDONIMO_REDE = 'rede:pessoa';

/**
 * O pseudônimo do paciente na carga de um estabelecimento. No modo `comum`, o paciente com pessoa da Rede (vínculo
 * ativo no MPI) usa o pseudônimo da pessoa; sem vínculo, o do estabelecimento. No modo `por-estabelecimento`, a
 * pessoa da Rede é ignorada.
 */
export function pseudonimoDoPaciente(
  chave: string | Buffer,
  modo: ModoPseudonimo,
  estabelecimento: string,
  idLocal: number,
  pessoaDaRede: string | null,
): string {
  if (modo === 'comum' && pessoaDaRede) return pseudonimo(chave, ESCOPO_PSEUDONIMO_REDE, pessoaDaRede);
  return pseudonimo(chave, `${estabelecimento}:paciente`, idLocal);
}

/** O modo do pseudônimo da carga: `comum` só quando a liberação (DP-42) está ligada em TODOS os estabelecimentos. */
export function modoDoPseudonimo(liberadoEm: readonly boolean[]): ModoPseudonimo {
  return liberadoEm.length > 0 && liberadoEm.every(Boolean) ? 'comum' : 'por-estabelecimento';
}

export interface CargaDoEstabelecimento {
  readonly estabelecimento: string;
  readonly versaoEsquema: number;
  readonly modoPseudonimo: string;
  readonly dadosAte: string;
  /** Quando a carga foi feita (ISO). */
  readonly carregadoEm: string;
  /** A impressão da chave do pseudônimo (impressaoDaChave). */
  readonly chaveImpressao: string;
}

/**
 * Quanto as cargas que se juntam no arquivo da Rede podem distar entre si (horas): as cópias são diárias, então as
 * cargas de um mesmo ciclo ficam dentro de um dia e meio; mais do que isso é carga velha de um estabelecimento junto
 * da nova de outro (recarregar todos com `--hospital=todos`).
 */
export const TOLERANCIA_CARGAS_DA_REDE_HORAS = 36;

export class ErroConsolidacaoDataMart extends Error {
  override readonly name = 'ErroConsolidacaoDataMart';
}

/**
 * Confere as cargas antes de juntar o arquivo da Rede: a versão do esquema atual, um arquivo por estabelecimento, só
 * estabelecimentos da rede e o MESMO modo de pseudônimo em todas (misturar os modos juntaria pacientes que não são a
 * mesma pessoa ou separaria os que são). Devolve o modo do arquivo da Rede.
 */
export function conferirCargasDaRede(
  cargas: readonly CargaDoEstabelecimento[],
  daRede: readonly string[],
): ModoPseudonimo {
  if (cargas.length === 0)
    throw new ErroConsolidacaoDataMart('Nenhuma carga de estabelecimento para juntar.');
  const vistos = new Set<string>();
  for (const c of cargas) {
    if (!daRede.includes(c.estabelecimento))
      throw new ErroConsolidacaoDataMart(
        `A carga de ${c.estabelecimento} não é de um estabelecimento desta rede.`,
      );
    if (vistos.has(c.estabelecimento))
      throw new ErroConsolidacaoDataMart(`Mais de uma carga de ${c.estabelecimento}.`);
    vistos.add(c.estabelecimento);
    if (c.versaoEsquema !== VERSAO_ESQUEMA_DATAMART)
      throw new ErroConsolidacaoDataMart(
        `A carga de ${c.estabelecimento} é do esquema ${c.versaoEsquema}; recarregue (esquema atual: ${VERSAO_ESQUEMA_DATAMART}).`,
      );
    if (!(MODOS_PSEUDONIMO as readonly string[]).includes(c.modoPseudonimo))
      throw new ErroConsolidacaoDataMart(`Modo de pseudônimo desconhecido na carga de ${c.estabelecimento}.`);
    if (!/^[0-9a-f]{16}$/.test(c.chaveImpressao))
      throw new ErroConsolidacaoDataMart(
        `A carga de ${c.estabelecimento} não tem a impressão da chave do pseudônimo; recarregue.`,
      );
    if (Number.isNaN(Date.parse(c.carregadoEm)))
      throw new ErroConsolidacaoDataMart(
        `A carga de ${c.estabelecimento} não tem a data da carga; recarregue.`,
      );
  }
  if (new Set(cargas.map((c) => c.chaveImpressao)).size > 1)
    throw new ErroConsolidacaoDataMart(
      'As cargas usam chaves de pseudônimo diferentes; recarregue todos os estabelecimentos juntos (--hospital=todos) com a mesma chave.',
    );
  const momentos = cargas.map((c) => Date.parse(c.carregadoEm));
  if (Math.max(...momentos) - Math.min(...momentos) > TOLERANCIA_CARGAS_DA_REDE_HORAS * 3_600_000)
    throw new ErroConsolidacaoDataMart(
      `As cargas dos estabelecimentos distam mais de ${TOLERANCIA_CARGAS_DA_REDE_HORAS} horas entre si; recarregue todos os estabelecimentos juntos (--hospital=todos).`,
    );
  const modos = new Set(cargas.map((c) => c.modoPseudonimo));
  if (modos.size > 1)
    throw new ErroConsolidacaoDataMart(
      'As cargas usam modos de pseudônimo diferentes; recarregue todos os estabelecimentos com o mesmo modo.',
    );
  return cargas[0]!.modoPseudonimo as ModoPseudonimo;
}

/**
 * Os avisos das cargas que se juntam (não recusam): os dados de cada estabelecimento vão até dias diferentes (o último
 * movimento de cada banco; a diferença de um dia é a do relógio de cada um).
 */
export function avisosDasCargasDaRede(cargas: readonly CargaDoEstabelecimento[]): string[] {
  const dias = cargas
    .map((c) => ({ est: c.estabelecimento, dia: Date.parse(`${c.dadosAte}T00:00:00Z`) }))
    .filter((x) => !Number.isNaN(x.dia));
  if (dias.length < 2) return [];
  const max = Math.max(...dias.map((x) => x.dia));
  const atrasados = dias.filter((x) => max - x.dia > 86_400_000).map((x) => x.est);
  return atrasados.length > 0
    ? [`Os dados de ${atrasados.join(', ')} vão até uma data anterior à dos demais estabelecimentos.`]
    : [];
}

/** As tabelas de fato (as que o arquivo da Rede junta; a `carga` é refeita com uma linha por estabelecimento). */
export const TABELAS_FATO_DATAMART = ESQUEMA_DATAMART.filter((t) => t.nome.startsWith('fato_')).map(
  (t) => t.nome,
);
