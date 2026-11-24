// Leitor comum dos dias sem expediente do estabelecimento (F3.1, 02-CAD linha 28), usado pela agenda de consultas e
// pela de exames: os nacionais calculados (fixos e Sexta-feira Santa) e o cadastro único `dia_nao_util` (nacional, da
// UF, do município e do estabelecimento; recorrência anual, data única e móvel; faixa do dia). A tabela `feriado`,
// anterior ao cadastro único, não é mais lida aqui: a migração 05_AGE/90 copiou o que existia para `dia_nao_util`
// (o Calendário controla de fato a agenda: inativar ou mudar a data da cópia vale na hora). A regra de qual vale está
// no domínio (`diasSemExpediente`).
import { type Abrangencia, diasSemExpediente, type Feriado } from '@sgh/dominio-agenda';
import type { Leitor } from '@sgh/nucleo';

const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const t = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const d = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
const b = (v: unknown): boolean => v === true || Number(v) === 1;

/** Dias (e faixas do dia) sem expediente no estabelecimento entre `de` e `ate`. */
export async function lerDiasSemExpediente(
  l: Pick<Leitor, 'uma' | 'consultar'>,
  estabelecimento: number,
  de: string,
  ate: string,
): Promise<Feriado[]> {
  const loc = await l.uma(
    `SELECT s.municipio_ibge_id, m.unidade_federativa_id, u.sigla
       FROM estabelecimento s
       LEFT JOIN municipio_ibge m ON m.id = s.municipio_ibge_id
       LEFT JOIN unidade_federativa u ON u.id = m.unidade_federativa_id
      WHERE s.id = ?`,
    [estabelecimento],
  );
  const dnu = await l.consultar(
    `SELECT descricao, abrangencia, unidade_federativa_id, municipio_ibge_id, estabelecimento_id, recorrencia,
            dia, mes, data, facultativo, hora_inicio, hora_fim
       FROM dia_nao_util
      WHERE ativo AND excluido_em IS NULL AND (recorrencia = 'anual' OR data BETWEEN ? AND ?)`,
    [de, ate],
    { teto: 5000 },
  );
  return diasSemExpediente(
    {
      estabelecimento,
      municipio: n(loc?.['municipio_ibge_id']),
      uf: t(loc?.['sigla']),
      ufId: n(loc?.['unidade_federativa_id']),
    },
    de,
    ate,
    {
      // A tabela anterior ao cadastro único não é lida: a migração 05_AGE/90 copiou as linhas dela para
      // `dia_nao_util`, e o que se inativa ou altera no Calendário vale na hora para a agenda e os exames.
      feriados: [],
      diasNaoUteis: dnu.map((x) => ({
        descricao: String(x['descricao']),
        abrangencia: String(x['abrangencia']) as Abrangencia,
        ufId: n(x['unidade_federativa_id']),
        municipio: n(x['municipio_ibge_id']),
        estabelecimento: n(x['estabelecimento_id']),
        recorrencia: String(x['recorrencia']) as 'anual' | 'data_unica' | 'movel',
        dia: n(x['dia']),
        mes: n(x['mes']),
        data: d(x['data']),
        facultativo: b(x['facultativo']),
        // TIME do banco vem com os segundos: a faixa anda em HH:MM.
        horaInicio: t(x['hora_inicio'])?.slice(0, 5) ?? null,
        horaFim: t(x['hora_fim'])?.slice(0, 5) ?? null,
      })),
    },
  );
}
