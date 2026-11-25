// Leituras de apoio da redação do laudo de imagem e de métodos gráficos (F3.5, 05-SADT linha 16) no banco do cliente:
// a lista de trabalho (os exames realizados que esperam laudo, o mais antigo primeiro), o texto inteiro de uma versão
// anterior, os laudos anteriores do mesmo exame do paciente, as palavras-chave e a busca de casos por elas, e os
// modelos para a manutenção. Só leitura; a gravação fica em laudo-redacao.ts.
import { type Leitor, recusa } from '@sgh/nucleo';

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const textoOuNulo = (v: unknown) => (v === null || v === undefined ? null : String(v));
const instante = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);

/** Setores que não laudam por aqui (o laboratório e a agência usam o resultado próprio). */
const SEM_LAUDO_SQL = "('laboratorio', 'agencia_transfusional')";
/** Situações do exame em que ele já foi feito. */
const REALIZADO_SQL =
  "(ei.realizado_em IS NOT NULL OR ei.situacao IN ('coletado', 'em_analise', 'resultado_digitado', 'revisado', 'liberado', 'entregue'))";

export interface ExameNaFila {
  readonly item: number;
  readonly exame: string;
  readonly setor: number;
  readonly setorNome: string;
  readonly paciente: string;
  readonly prontuario: string;
  readonly realizadoEm: string | null;
  /** `null` quando ainda não há laudo; senão rascunho ou aguardando revisão. */
  readonly laudo: string | null;
}

/** A lista de trabalho de quem lauda: exames realizados sem laudo assinado, o mais antigo primeiro. */
export async function filaDeLaudos(l: Leitor, est: number, setor: number | null): Promise<ExameNaFila[]> {
  const ls = await l.consultar(
    `SELECT ei.id, ex.nome AS exame, sd.id AS setor, sd.nome AS setor_nome, pf.nome AS paciente, pa.numero_prontuario,
            COALESCE(ei.realizado_em, ei.coletado_em, q.solicitado_em) AS realizado_em, ld.situacao AS laudo
       FROM exame_item ei
       JOIN requisicao_exame q ON q.id = ei.requisicao_exame_id
       JOIN exame ex ON ex.id = ei.exame_id
       JOIN setor_diagnostico sd ON sd.id = COALESCE(ei.setor_diagnostico_id, q.setor_diagnostico_id)
       JOIN paciente pa ON pa.id = q.paciente_id
       JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
       LEFT JOIN laudo_diagnostico ld ON ld.exame_item_id = ei.id AND ld.excluido_em IS NULL
      WHERE q.estabelecimento_id = ? AND ei.excluido_em IS NULL AND q.excluido_em IS NULL
        AND sd.tipo NOT IN ${SEM_LAUDO_SQL} AND ei.situacao NOT IN ('cancelado', 'recusado') AND ${REALIZADO_SQL}
        AND (ld.id IS NULL OR ld.situacao IN ('rascunho', 'aguardando_revisao'))
        ${setor === null ? '' : 'AND sd.id = ?'}
      ORDER BY COALESCE(ei.realizado_em, ei.coletado_em, q.solicitado_em), ei.id`,
    setor === null ? [est] : [est, setor],
    { teto: 300 },
  );
  return ls.map((r) => ({
    item: n(r['id']),
    exame: texto(r['exame']),
    setor: n(r['setor']),
    setorNome: texto(r['setor_nome']),
    paciente: texto(r['paciente']),
    prontuario: texto(r['numero_prontuario']),
    realizadoEm: instante(r['realizado_em']),
    laudo: textoOuNulo(r['laudo']),
  }));
}

/** Os setores que laudam por aqui (para o filtro da lista e o alcance do modelo). */
export async function setoresDeLaudo(l: Leitor, est: number) {
  return (
    await l.consultar(
      `SELECT id, nome FROM setor_diagnostico WHERE estabelecimento_id = ? AND tipo NOT IN ${SEM_LAUDO_SQL} ORDER BY nome`,
      [est],
      { teto: 200 },
    )
  ).map((r) => ({ id: n(r['id']), nome: texto(r['nome']) }));
}

/** O nome e o prontuário do paciente do exame (o cabeçalho da tela). */
export async function pacienteDoExame(l: Leitor, paciente: number) {
  const r = await l.uma(
    `SELECT pf.nome, pa.numero_prontuario FROM paciente pa JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
      WHERE pa.id = ?`,
    [paciente],
  );
  return { nome: texto(r?.['nome']), prontuario: texto(r?.['numero_prontuario']) };
}

/** Os laudos assinados anteriores do mesmo exame do paciente (para comparar), o mais recente primeiro. */
export async function laudosAnteriores(
  l: Leitor,
  est: number,
  paciente: number,
  exame: number,
  item: number,
) {
  return (
    await l.consultar(
      `SELECT ld.exame_item_id, ld.assinado_em, ld.resultado, ld.texto, ld.achado_critico
         FROM laudo_diagnostico ld JOIN exame_item ei ON ei.id = ld.exame_item_id
        WHERE ld.estabelecimento_id = ? AND ld.paciente_id = ? AND ei.exame_id = ? AND ld.exame_item_id <> ?
          AND ld.situacao IN ('assinado', 'emitido', 'retificado') AND ld.excluido_em IS NULL
        ORDER BY ld.assinado_em DESC, ld.id DESC LIMIT 5`,
      [est, paciente, exame, item],
      { teto: 5 },
    )
  ).map((r) => ({
    item: n(r['exame_item_id']),
    assinadoEm: instante(r['assinado_em']),
    resultado: textoOuNulo(r['resultado']),
    achadoCritico: Boolean(r['achado_critico']),
    texto: texto(r['texto']),
  }));
}

/** As palavras-chave ativas do cadastro. */
export async function palavrasAtivas(l: Leitor) {
  return (
    await l.consultar(
      'SELECT id, codigo, descricao FROM palavra_chave_laudo WHERE ativo = TRUE ORDER BY descricao, id',
      [],
      { teto: 1000 },
    )
  ).map((r) => ({ id: n(r['id']), codigo: texto(r['codigo']), descricao: texto(r['descricao']) }));
}

/** As palavras-chave vigentes do laudo (as retiradas ficam no banco, marcadas). */
export async function palavrasDoLaudo(l: Leitor, laudo: number): Promise<number[]> {
  return (
    await l.consultar(
      'SELECT palavra_chave_laudo_id AS p FROM laudo_palavra_chave WHERE laudo_diagnostico_id = ? AND excluido_em IS NULL ORDER BY id',
      [laudo],
      { teto: 100 },
    )
  ).map((r) => n(r['p']));
}

/** Busca de casos: os laudos assinados que têm TODAS as palavras-chave pedidas, o mais recente primeiro. */
export async function buscarPorPalavras(l: Leitor, est: number, palavras: readonly number[]) {
  const unicas = [...new Set(palavras)];
  if (unicas.length === 0) return [];
  const ls = await l.consultar(
    `SELECT ld.exame_item_id, ex.nome AS exame, pf.nome AS paciente, pa.numero_prontuario, ld.assinado_em, ld.resultado
       FROM laudo_diagnostico ld
       JOIN exame_item ei ON ei.id = ld.exame_item_id
       JOIN exame ex ON ex.id = ei.exame_id
       JOIN paciente pa ON pa.id = ld.paciente_id
       JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
      WHERE ld.estabelecimento_id = ? AND ld.excluido_em IS NULL AND ld.situacao IN ('assinado', 'emitido', 'retificado')
        AND (SELECT COUNT(DISTINCT k.palavra_chave_laudo_id) FROM laudo_palavra_chave k
              WHERE k.laudo_diagnostico_id = ld.id AND k.excluido_em IS NULL
                AND k.palavra_chave_laudo_id IN (${unicas.map(() => '?').join(', ')})) = ?
      ORDER BY ld.assinado_em DESC, ld.id DESC`,
    [est, ...unicas, unicas.length],
    { teto: 200 },
  );
  return ls.map((r) => ({
    item: n(r['exame_item_id']),
    exame: texto(r['exame']),
    paciente: texto(r['paciente']),
    prontuario: texto(r['numero_prontuario']),
    assinadoEm: instante(r['assinado_em']),
    resultado: textoOuNulo(r['resultado']),
  }));
}

/** O texto inteiro de uma versão do laudo (a assinada ou a retificada), com quem assinou e a foto das medidas. */
export async function versaoDoLaudo(l: Leitor, est: number, item: number, numero: number) {
  const r = await l.uma(
    `SELECT v.numero_versao, v.situacao, v.ocorrido_em, v.titulo, v.texto, v.dados, v.hash_sha256,
            COALESCE(m.descricao, v.motivo) AS motivo, COALESCE(pr.nome_exibicao, pf.nome, '') AS laudista
       FROM laudo_diagnostico_versao v
       JOIN laudo_diagnostico ld ON ld.id = v.laudo_diagnostico_id
       LEFT JOIN motivo_retificacao_laudo m ON m.id = v.motivo_retificacao_laudo_id
       LEFT JOIN profissional pr ON pr.id = v.laudista_profissional_id
       LEFT JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
      WHERE ld.exame_item_id = ? AND ld.estabelecimento_id = ? AND ld.excluido_em IS NULL AND v.numero_versao = ?`,
    [item, est, numero],
  );
  if (!r) throw recusa('versao-inexistente', 'Esta versão do laudo não existe neste estabelecimento.');
  const d = (typeof r['dados'] === 'string' ? JSON.parse(r['dados']) : (r['dados'] ?? {})) as {
    resultado?: string | null;
    achadoCritico?: boolean;
    achadoCriticoDescricao?: string | null;
    valores?: { grandeza: number; numero: number | null; texto: string | null; fora: boolean }[];
  };
  return {
    numero: n(r['numero_versao']),
    situacao: texto(r['situacao']),
    em: instante(r['ocorrido_em']) ?? '',
    titulo: textoOuNulo(r['titulo']),
    texto: texto(r['texto']),
    motivo: textoOuNulo(r['motivo']),
    laudista: texto(r['laudista']),
    hash: textoOuNulo(r['hash_sha256']),
    resultado: d.resultado ?? null,
    achadoCritico: Boolean(d.achadoCritico),
    achadoCriticoDescricao: d.achadoCriticoDescricao ?? null,
    valores: (d.valores ?? []).map((v) => ({
      grandeza: n(v.grandeza),
      numero: nn(v.numero),
      texto: textoOuNulo(v.texto),
      fora: Boolean(v.fora),
    })),
  };
}

/**
 * Os modelos para a manutenção: os do estabelecimento e os pessoais do médico da sessão (os pessoais de outro médico
 * não aparecem), ativos e inativos, com os exames e os setores que podem ser o alcance do modelo.
 */
export async function modelosParaManutencao(l: Leitor, est: number, profissional: number | null) {
  const itens = (
    await l.consultar(
      `SELECT m.id, m.codigo, m.nome, m.tipo, m.atalho, m.texto, m.ativo, m.exame_id, m.setor_diagnostico_id,
              m.profissional_id, ex.nome AS exame_nome, sd.nome AS setor_nome
         FROM modelo_laudo m LEFT JOIN exame ex ON ex.id = m.exame_id
         LEFT JOIN setor_diagnostico sd ON sd.id = m.setor_diagnostico_id
        WHERE m.estabelecimento_id = ? AND (m.profissional_id IS NULL OR m.profissional_id = ?)
        ORDER BY m.ativo DESC, m.nome, m.id`,
      [est, profissional ?? 0],
      { teto: 1000 },
    )
  ).map((r) => ({
    id: n(r['id']),
    codigo: texto(r['codigo']),
    nome: texto(r['nome']),
    tipo: texto(r['tipo']),
    atalho: textoOuNulo(r['atalho']),
    texto: texto(r['texto']),
    ativo: Boolean(r['ativo']),
    exame: nn(r['exame_id']),
    exameNome: textoOuNulo(r['exame_nome']),
    setor: nn(r['setor_diagnostico_id']),
    setorNome: textoOuNulo(r['setor_nome']),
    pessoal: r['profissional_id'] !== null && r['profissional_id'] !== undefined,
  }));
  const exames = (
    await l.consultar(
      `SELECT DISTINCT ex.id, ex.nome FROM exame ex
        WHERE ex.ativo = TRUE AND ex.tipo_servico <> 'laboratorio' ORDER BY ex.nome LIMIT 1000`,
      [],
      { teto: 1000 },
    )
  ).map((r) => ({ id: n(r['id']), nome: texto(r['nome']) }));
  return { itens, exames, setores: await setoresDeLaudo(l, est), temProfissional: profissional !== null };
}
