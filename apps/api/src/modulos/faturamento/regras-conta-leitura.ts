// F8 (06-FAT linha 13): leitura das regras de criação e quebra de conta do estabelecimento (com as exceções ativas).
// Arquivo próprio, sem dependência de operacoes.ts nem de conta-entrada.ts: é lido pela abertura da conta da entrada
// e pela rotina de quebra (quebra-conta.ts) e pelo cadastro e simulação (regras-comerciais-propria.ts), sem formar
// ciclo de imports entre eles.
import type { RegraCriacaoConta } from '@sgh/dominio-faturamento';
import type { Leitor } from '@sgh/nucleo';

type Linha = Record<string, unknown>;
type Consulta = Pick<Leitor, 'consultar' | 'uma'>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown) => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown) => v === true || v === 1 || v === '1';
const p2 = (x: number) => String(x).padStart(2, '0');
function dia(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return `${v.getFullYear()}-${p2(v.getMonth() + 1)}-${p2(v.getDate())}`;
  return String(v).slice(0, 10);
}
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');

const comoCriterios = (r: Linha) => ({
  categoriaAtendimento: nn(r['categoria_atendimento_id']),
  origemEntrada: nn(r['origem_entrada_atendimento_id']),
  grupo: nn(r['grupo_faturamento_id']),
  item: nn(r['item_faturavel_id']),
});

/** As regras de criação e quebra de conta do estabelecimento, por prioridade, com as exceções ativas. */
export async function regrasContaDo(
  l: Consulta,
  est: number,
): Promise<(RegraCriacaoConta & { versao: number })[]> {
  const rs = await l.consultar<Linha>(
    `SELECT * FROM regra_criacao_conta WHERE estabelecimento_id = ? ORDER BY prioridade, id`,
    [est],
    { teto: 2000 },
  );
  const ex = rs.length
    ? await l.consultar<Linha>(
        `SELECT * FROM regra_criacao_conta_excecao WHERE regra_criacao_conta_id IN (${lista(rs.length)})
            AND ativo = 1 ORDER BY id`,
        rs.map((r) => r['id']),
        { teto: 10000 },
      )
    : [];
  return rs.map((r) => ({
    id: n(r['id']),
    versao: n(r['versao']),
    acao: String(r['acao']) as RegraCriacaoConta['acao'],
    categoriaAtendimento: nn(r['categoria_atendimento_id']),
    origemEntrada: nn(r['origem_entrada_atendimento_id']),
    categoriaAcomodacao: nn(r['categoria_acomodacao_id']),
    setor: nn(r['setor_funcional_id']),
    grupo: nn(r['grupo_faturamento_id']),
    item: nn(r['item_faturavel_id']),
    horarioEspecial: r['horario_especial'] === null ? null : bool(r['horario_especial']),
    fonteOrigem: nn(r['fonte_pagadora_origem_id']),
    planoOrigem: nn(r['plano_origem_id']),
    fonteDestino: nn(r['fonte_pagadora_destino_id']),
    planoDestino: nn(r['plano_destino_id']),
    periodicidade: (txt(r['periodicidade']) as RegraCriacaoConta['periodicidade']) ?? null,
    prioridade: n(r['prioridade']),
    vigenciaInicio: dia(r['vigencia_inicio']) ?? '',
    ativo: bool(r['ativo']),
    excecoes: ex.filter((x) => n(x['regra_criacao_conta_id']) === n(r['id'])).map(comoCriterios),
  }));
}
