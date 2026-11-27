// Ciência do documento controlado pela DISTRIBUIÇÃO (documento_qualidade_distribuicao): quem o documento alcança, quem
// é obrigado a ler e quem está barrado. Usado pela gravação da ciência (porta-propria-documentos.ts) e pela leitura de
// quem deve ler e ainda não leu (porta-propria-complemento-q2.ts). Nenhum gatilho: a regra é esta.
//
// - O destinatário é a conta (usuario): pela linha de usuário; pelo perfil de acesso vigente no estabelecimento
//   (usuario_perfil); pelo cargo ou pelo setor do vínculo de trabalho ativo no estabelecimento (vinculo_trabalho sem
//   desligamento), pela conta do colaborador.
// - A linha com acesso_negado é exceção: barra quem ela alcança, mesmo que outra linha o alcance.
// - O documento SEM distribuição (nenhuma linha que libera) é aberto: qualquer conta que lê documentos registra a
//   ciência, e ninguém fica pendente (não há público definido).
// - Obrigado a ler: alcançado por uma linha com exige_ciencia, não barrado, no documento que exige ciência.
import type { L } from './apoio-propria.js';
import { n } from './apoio-propria.js';

export type RecusaCiencia = 'fora-da-distribuicao' | null;

/** A conta pode registrar a ciência? (null: pode; o documento sem distribuição é aberto, o barrado nunca). */
export function conferirCiencia(a: {
  readonly distribuido: boolean;
  readonly alcancado: boolean;
  readonly negado: boolean;
}): RecusaCiencia {
  if (a.negado) return 'fora-da-distribuicao';
  return a.distribuido && !a.alcancado ? 'fora-da-distribuicao' : null;
}

/** Quem deve ler: alcançado por linha que exige ciência e não barrado (sem distribuição, ninguém). */
export function obrigadoACiencia(a: { readonly exige: boolean; readonly negado: boolean }): boolean {
  return a.exige && !a.negado;
}

/**
 * As contas alcançadas pela distribuição da ficha (documento_qualidade), com as marcas por conta. Parâmetros, em
 * ordem: ficha, ficha, est, hoje, hoje, ficha, est e, com `porConta`, a conta.
 */
const sqlAlcance = (porConta: boolean) => `
  SELECT x.usuario_id, MAX(x.acesso_negado) AS negado, MAX(NOT x.acesso_negado) AS alcancado,
         MAX(x.exige_ciencia AND NOT x.acesso_negado) AS exige
    FROM (
      SELECT d.usuario_id, d.acesso_negado, d.exige_ciencia
        FROM documento_qualidade_distribuicao d
       WHERE d.documento_qualidade_id = ? AND d.excluido_em IS NULL AND d.tipo_destinatario = 'usuario'
      UNION ALL
      SELECT up.usuario_id, d.acesso_negado, d.exige_ciencia
        FROM documento_qualidade_distribuicao d
        JOIN usuario_perfil up ON up.perfil_acesso_id = d.perfil_acesso_id AND up.estabelecimento_id = ?
         AND up.excluido_em IS NULL AND up.vigencia_inicio <= ? AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= ?)
       WHERE d.documento_qualidade_id = ? AND d.excluido_em IS NULL AND d.tipo_destinatario = 'perfil'
      UNION ALL
      SELECT co.usuario_id, d.acesso_negado, d.exige_ciencia
        FROM documento_qualidade_distribuicao d
        JOIN vinculo_trabalho vt ON vt.estabelecimento_id = ? AND vt.excluido_em IS NULL AND vt.data_desligamento IS NULL
         AND ((d.tipo_destinatario = 'cargo' AND vt.cargo_id = d.cargo_id)
           OR (d.tipo_destinatario = 'setor' AND vt.setor_funcional_id = d.setor_funcional_id))
        JOIN colaborador co ON co.id = vt.colaborador_id AND co.excluido_em IS NULL AND co.usuario_id IS NOT NULL
       WHERE d.documento_qualidade_id = ? AND d.excluido_em IS NULL AND d.tipo_destinatario IN ('cargo', 'setor')
    ) x
   ${porConta ? 'WHERE x.usuario_id = ?' : ''}
   GROUP BY x.usuario_id`;

const paramsAlcance = (ficha: number, est: number, hoje: string) => [
  ficha,
  est,
  hoje,
  hoje,
  ficha,
  est,
  ficha,
];

/** A ficha tem alguma linha de distribuição que libera (não barrada)? */
export async function temDistribuicao(l: L, ficha: number): Promise<boolean> {
  const r = await l.uma(
    `SELECT COUNT(*) AS q FROM documento_qualidade_distribuicao
      WHERE documento_qualidade_id = ? AND excluido_em IS NULL AND acesso_negado = FALSE`,
    [ficha],
  );
  return n(r?.['q']) > 0;
}

/** A conferência da ciência da conta na ficha (`hoje`: AAAA-MM-DD do estabelecimento). */
export async function recusaCienciaPorDistribuicao(
  l: L,
  est: number,
  ficha: number,
  usuario: number,
  hoje: string,
): Promise<RecusaCiencia> {
  const [distribuido, linha] = await Promise.all([
    temDistribuicao(l, ficha),
    l.uma(sqlAlcance(true), [...paramsAlcance(ficha, est, hoje), usuario]),
  ]);
  return conferirCiencia({
    distribuido,
    alcancado: n(linha?.['alcancado']) > 0,
    negado: n(linha?.['negado']) > 0,
  });
}

/**
 * Quem deve ler a revisão (documento_qualidade_versao) e ainda não registrou a ciência: as contas obrigadas pela
 * distribuição, sem ciência na revisão (pela conta ou pelo colaborador dela), em ordem de login. Só a revisão vigente
 * do estabelecimento, no documento que exige ciência; senão, lista vazia.
 */
export async function pendentesDeCiencia(
  l: L,
  est: number,
  revisao: number,
  hoje: string,
): Promise<{ usuario: string; nome: string }[]> {
  const doc = await l.uma(
    `SELECT d.id, d.exige_ciencia FROM documento_qualidade_versao v
       JOIN documento_qualidade d ON d.id = v.documento_qualidade_id
      WHERE v.id = ? AND d.estabelecimento_id = ? AND v.situacao = 'vigente'`,
    [revisao, est],
  );
  if (!doc || !n(doc['exige_ciencia'])) return [];
  const ficha = n(doc['id']);
  const linhas = await l.consultar(
    `SELECT UPPER(u.login) AS usuario, u.nome, a.exige, a.negado
       FROM (${sqlAlcance(false)}) a
       JOIN usuario u ON u.id = a.usuario_id
      WHERE NOT EXISTS (
        SELECT 1 FROM documento_qualidade_ciencia c
          LEFT JOIN colaborador co ON co.id = c.colaborador_id
         WHERE c.documento_qualidade_versao_id = ? AND c.excluido_em IS NULL
           AND (c.usuario_id = a.usuario_id OR co.usuario_id = a.usuario_id))
      ORDER BY u.login`,
    [...paramsAlcance(ficha, est, hoje), revisao],
  );
  return linhas
    .filter((x) => obrigadoACiencia({ exige: n(x['exige']) > 0, negado: n(x['negado']) > 0 }))
    .map((x) => ({ usuario: String(x['usuario']), nome: String(x['nome'] ?? '') }));
}
