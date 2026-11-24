// Arquivo gerado do faturamento SUS na porta própria (M51; ddl-aplicado-v3, "Número do arquivo"): o número do arquivo
// é a sequência de negócio `arquivo_sus` do estabelecimento, comum aos quatro instrumentos, gravada em
// `remessa_<instrumento>.numero` (UNIQUE por estabelecimento); a leitura `arquivo(id)` procura o número nas quatro
// remessas. O conteúdo fica no disco da máquina pela porta de arquivos (ADR 0004: chave e versão do objeto); o registro
// do núcleo (`arquivo`) guarda o hash, o tamanho, a imutabilidade e a guarda legal de 5 anos e a remessa aponta para ele.
// A geração nova da mesma competência marca as remessas geradas ou conferidas como `substituida`, com a remessa
// substituta (o conteúdo antigo segue guardado). Nenhuma remessa é apagada.
// Linhas: as linhas (registro da CIHA, folha do BPA, produção da APAC e contas da AIH) vêm da montagem própria, que lê
// a produção da competência; o arquivo "sem movimento" só sai quando essa leitura não acha produção.
// Trilha: o número do arquivo (o id da tela) não é o id do registro do núcleo; a trilha com alvo `arquivo` é levada
// ao id real do registro (idArquivoDoNumero), nunca ao número.
import { garantirSequencia, type Leitor, recusa, type TxOperacao } from '@sgh/nucleo';
import type { ArquivoSus, InstrumentoSusPorta, NovoArquivoSus } from './tipos.js';

type Linha = Record<string, unknown>;
const num = (v: unknown): number => (v === null || v === undefined || v === '' ? 0 : Number(v));
const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** A tabela da remessa de cada instrumento. */
export const REMESSA_DO_INSTRUMENTO: Readonly<Record<InstrumentoSusPorta, string>> = {
  ciha: 'remessa_ciha',
  bpa: 'remessa_bpa',
  apac: 'remessa_apac',
  aih: 'remessa_sisaih',
};

/** As tabelas que a gravação do arquivo escreve (entram na operação do faturamento SUS). */
export const TABELAS_ARQUIVO_SUS = [
  'remessa_ciha',
  'remessa_bpa',
  'remessa_apac',
  'remessa_sisaih',
  'arquivo',
  // A primeira geração cria a sequência do número do arquivo no estabelecimento (garantirSequencia).
  'sequencia_negocio',
] as const;

/** O tipo da sequência do número do arquivo (comum aos quatro instrumentos, por estabelecimento). */
export const SEQUENCIA_ARQUIVO_SUS = 'arquivo_sus';
/** Guarda legal do arquivo exportado ao gestor (ficha M51, seção 12). */
export const ANOS_GUARDA_ARQUIVO_SUS = 5;

const SITUACAO_DA_TELA: Readonly<Record<string, ArquivoSus['situacao']>> = {
  gerada: 'gerado',
  conferida: 'conferido',
  enviada: 'enviado',
  exportada: 'enviado',
  processada: 'enviado',
  substituida: 'substituido',
};

const instante = (col: string) => `DATE_FORMAT(${col}, '%Y-%m-%dT%H:%i:%s.%fZ')`;

/** As colunas comuns da leitura de cada remessa, no mesmo formato (para o UNION das quatro). */
function sqlRemessa(i: InstrumentoSusPorta): string {
  const t = REMESSA_DO_INSTRUMENTO[i];
  const registros =
    i === 'ciha'
      ? 'r.quantidade_registro_internacao + r.quantidade_registro_ambulatorial'
      : i === 'bpa'
        ? 'r.quantidade_registros'
        : i === 'apac'
          ? 'r.quantidade_apac'
          : 'r.quantidade_aih';
  return `SELECT '${i}' AS instrumento, r.numero, c.competencia, r.leiaute, r.versao_leiaute,
                 r.conferido_contra_oficial, r.nome_arquivo, r.quantidade_linhas, ${registros} AS registros,
                 r.quantidade_procedimentos, r.sem_movimento, r.hash_sha256, r.tamanho_bytes, r.chave_objeto,
                 r.versao_objeto, r.situacao,
                 (SELECT u.login FROM usuario u WHERE u.id = r.gerador_usuario_id) AS gerado_por,
                 ${instante('r.gerada_em')} AS gerado_em
            FROM ${t} r JOIN competencia_sus c ON c.id = r.competencia_sus_id
           WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL AND r.gerada_em IS NOT NULL`;
}

export function arquivoDaLinha(x: Linha): ArquivoSus {
  return {
    id: num(x['numero']),
    instrumento: txt(x['instrumento']) as InstrumentoSusPorta,
    competencia: txt(x['competencia']),
    leiaute: txt(x['leiaute']),
    versaoLeiaute: txt(x['versao_leiaute']),
    conferidoOficial: Boolean(num(x['conferido_contra_oficial'])),
    nome: txt(x['nome_arquivo']),
    linhas: num(x['quantidade_linhas']),
    registros: num(x['registros']),
    procedimentos: num(x['quantidade_procedimentos']),
    semMovimento: Boolean(num(x['sem_movimento'])),
    hash: txt(x['hash_sha256']),
    bytes: num(x['tamanho_bytes']),
    chaveObjeto: txt(x['chave_objeto']),
    versaoObjeto:
      x['versao_objeto'] === null || x['versao_objeto'] === undefined ? null : txt(x['versao_objeto']),
    situacao: SITUACAO_DA_TELA[txt(x['situacao'])] ?? 'gerado',
    geradoPor: txt(x['gerado_por']),
    geradoEm: txt(x['gerado_em']),
  };
}

/** Os arquivos do instrumento (da competência, se dada), do mais novo ao mais antigo, como a porta de memória. */
export async function lerArquivos(
  l: Leitor,
  est: number,
  instrumento: InstrumentoSusPorta,
  competencia: string | null,
): Promise<ArquivoSus[]> {
  const ls = await l.consultar(
    `${sqlRemessa(instrumento)}${competencia ? ' AND c.competencia = ?' : ''}
      ORDER BY CAST(r.numero AS UNSIGNED) DESC`,
    competencia ? [est, competencia] : [est],
    { teto: 2_000 },
  );
  return ls.map(arquivoDaLinha);
}

/** O arquivo pelo número, procurado nas quatro remessas do estabelecimento. */
export async function lerArquivo(l: Leitor, est: number, id: number): Promise<ArquivoSus | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const partes = (Object.keys(REMESSA_DO_INSTRUMENTO) as InstrumentoSusPorta[]).map(
    (i) => `${sqlRemessa(i)} AND r.numero = ?`,
  );
  const x = await l.uma(
    `${partes.join(' UNION ALL ')} LIMIT 1`,
    partes.flatMap(() => [est, String(id)]),
  );
  return x ? arquivoDaLinha(x) : null;
}

/** O próximo número de arquivo do estabelecimento (cria a sequência na primeira geração). */
export async function proximoNumeroArquivo(tx: TxOperacao): Promise<number> {
  await garantirSequencia(
    tx,
    { tipo: SEQUENCIA_ARQUIVO_SUS, estabelecimento: tx.contexto.estabelecimento },
    { usuario: tx.contexto.usuario, agora: new Date() },
  );
  return (await tx.proximoNumero(SEQUENCIA_ARQUIVO_SUS)).valor;
}

/** O id do registro do núcleo (`arquivo`) do arquivo de número dado no estabelecimento (null se não houver). */
export async function idArquivoDoNumero(l: Leitor, est: number, numero: number): Promise<number | null> {
  if (!Number.isSafeInteger(numero) || numero <= 0) return null;
  const partes = Object.values(REMESSA_DO_INSTRUMENTO).map(
    (t) =>
      `SELECT arquivo_id FROM ${t} WHERE estabelecimento_id = ? AND numero = ? AND arquivo_id IS NOT NULL`,
  );
  const x = await l.uma(
    `${partes.join(' UNION ALL ')} LIMIT 1`,
    partes.flatMap(() => [est, String(numero)]),
  );
  return x ? num(x['arquivo_id']) : null;
}

/** As colunas próprias de cada instrumento na remessa nova. */
export interface ColunasRemessa {
  readonly [coluna: string]: unknown;
}

/**
 * Grava a remessa gerada do instrumento: o registro do arquivo no núcleo, a remessa com o número, o hash, a chave e
 * as contagens, e a substituição das remessas geradas ou conferidas da mesma competência. Devolve quantas substituiu.
 */
export async function gravarRemessa(
  tx: TxOperacao,
  est: number,
  a: NovoArquivoSus,
  instrumento: InstrumentoSusPorta,
  proprias: ColunasRemessa,
): Promise<{ substituidos: number; remessa: number; arquivoId: number }> {
  if (a.competencia.instrumento !== instrumento)
    throw new Error(`Arquivo de ${a.competencia.instrumento} gravado como ${instrumento}.`);
  if (!/^[0-9a-f]{64}$/.test(a.hash)) throw new Error('Hash SHA-256 do arquivo ilegível.');
  const tabela = REMESSA_DO_INSTRUMENTO[instrumento];
  const comp = await tx.consultarParaAtualizar(
    'SELECT id FROM competencia_sus WHERE id = ? AND estabelecimento_id = ? AND instrumento = ?',
    [a.competencia.id, est, instrumento],
  );
  if (comp.length === 0) throw new Error('Competência do arquivo fora do estabelecimento.');
  const numero = String(a.id);
  const ocupado = await lerArquivo(tx, est, a.id);
  if (ocupado) throw recusa('arquivo-ja-gravado', `O arquivo ${numero} já foi gravado.`);
  const anteriores = await tx.consultarParaAtualizar(
    `SELECT id, versao FROM ${tabela}
      WHERE competencia_sus_id = ? AND estabelecimento_id = ? AND situacao IN ('gerada','conferida')
        AND excluido_em IS NULL`,
    [a.competencia.id, est],
  );
  const agora = new Date();
  const guarda = new Date(agora);
  guarda.setUTCFullYear(guarda.getUTCFullYear() + ANOS_GUARDA_ARQUIVO_SUS);
  const arquivoId = await tx.incluir('arquivo', {
    estabelecimento_id: est,
    entidade: tabela,
    finalidade: 'arquivo_faturamento_sus',
    nome_original: a.nome.slice(0, 255),
    tipo_mime: 'text/plain',
    tamanho_bytes: a.bytes,
    hash_sha256: a.hash,
    chave_armazenamento: a.chaveObjeto.slice(0, 512),
    retencao_ate: guarda.toISOString().slice(0, 10),
    imutavel: true,
  });
  const remessa = await tx.incluir(tabela, {
    estabelecimento_id: est,
    competencia_sus_id: a.competencia.id,
    numero,
    situacao: 'gerada',
    ...(instrumento === 'apac' ? {} : { aberta_em: agora }),
    leiaute: a.leiaute.slice(0, 30),
    versao_leiaute: a.versaoLeiaute.slice(0, 20),
    conferido_contra_oficial: a.conferidoOficial,
    arquivo_id: arquivoId,
    nome_arquivo: a.nome.slice(0, instrumento === 'apac' ? 255 : 100),
    hash_sha256: a.hash,
    tamanho_bytes: a.bytes,
    quantidade_linhas: a.linhas,
    quantidade_procedimentos: a.procedimentos,
    sem_movimento: a.semMovimento,
    chave_objeto: a.chaveObjeto.slice(0, 255),
    versao_objeto: a.versaoObjeto,
    gerada_em: agora,
    gerador_usuario_id: tx.contexto.usuario,
    ...proprias,
  });
  await tx.alterar('arquivo', arquivoId, 1, { entidade_id: remessa });
  const substituta = `substituta_${tabela}_id`;
  for (const x of anteriores)
    await tx.alterar(tabela, num(x['id']), num(x['versao']), {
      situacao: 'substituida',
      [substituta]: remessa,
    });
  return { substituidos: anteriores.length, remessa, arquivoId };
}
