// Reprodução dos cenários de assinatura da entrega ao setor (M29; ficha, seção 9: `suprimentos.confirmarEntrega`) pelo
// EXECUTOR, na transação da captura (sempre desfeita). A preparação cria o operador sintético (o enfermeiro que recebe,
// acesso.criarUsuarioIntegracao) e escolhe na cópia um documento da dispensação por horário ainda em 7 (a última linha do
// controle) com doses e etiqueta, e, para a recusa, uma linha cuja última situação é 9 (estornado). Só os IDs saem do
// banco, em memória. A dispensação e a devolução da dose ficam desligadas (D-MOTOR-28) e não têm reprodução aqui: a
// referência delas é a de perfil, para o cenário controlado do M36.
import { type CenarioCaptura, ErroOperacao, type Escritor, etiquetasDoDocumento } from '@sgh/legado';

type Executar = (e: Escritor, entrada: unknown) => Promise<{ resultado: Record<string, unknown> }>;

export const OPERACOES_REPRODUCAO_FARMACIA = new Set(['suprimentos.confirmarEntrega']);

const num = (v: unknown) => Number(v ?? 0);

async function exigirRecusa(p: Promise<unknown>, codigo: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao && e.problema.codigo === codigo) return;
    throw e;
  }
  throw new Error(`Cenário de recusa: esperava ${codigo}, a operação gravou.`);
}

/**
 * O outro sistema suspende o horário por fora (a checagem vai a 'S') no meio da dispensação: a escrita que o teste de
 * integração do M29 simula, sempre na transação desfeita da cópia (nunca confirmada), fora do executor.
 */
export async function suspenderHorarioPorFora(e: Escritor, horario: number): Promise<void> {
  await e.executar("UPDATE PRCHKGERAL SET SITUACAO_CHECAGEM = 'S' WHERE ID = ?", [horario]);
}

/**
 * M41: a outra estação com o horário em edição (a linha do horário alterada e ainda não confirmada, como a tela de
 * dispensação do outro sistema segura o registro): sempre na transação desfeita da cópia, fora do executor.
 */
export async function editarHorarioPorFora(e: Escritor, horario: number): Promise<void> {
  await e.executar('UPDATE PRCHKGERAL SET SITUACAO_CHECAGEM = SITUACAO_CHECAGEM WHERE ID = ?', [horario]);
}

/** Um controle em 7 (a última linha do documento) de saída da dispensação por horário, com doses. */
export async function controleDispensado(e: Escritor): Promise<{ controle: number; saida: number }> {
  const [m] = await e.consultar('SELECT MAX(ID) M FROM GECTRLENTREGADOCSAIDA', [], { teto: 1 });
  const ls = await e.consultar(
    `SELECT FIRST 20 c.ID, c.ID_GECADSAI FROM GECTRLENTREGADOCSAIDA c
      WHERE c.ID > ? AND c.ID_TBSITUACAOFARMACIA = 7 AND c.ID_GECADSAI IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM GECTRLENTREGADOCSAIDA x WHERE x.ID_GECADSAI = c.ID_GECADSAI AND x.ID > c.ID)
        AND EXISTS (SELECT 1 FROM GEDISPHOR d WHERE d.ID_GECADSAI = c.ID_GECADSAI)
      ORDER BY c.ID DESC`,
    [num(m?.['M']) - 20_000],
    { teto: 20, tempoMaximoMs: 60_000 },
  );
  const x = ls[0];
  if (!x) throw new Error('Nenhum documento dispensado (7) com dose na cópia.');
  return { controle: num(x['ID']), saida: num(x['ID_GECADSAI']) };
}

/** Uma linha cuja última situação do documento é 9 (estornado). */
async function controleEstornado(e: Escritor): Promise<number> {
  const [x] = await e.consultar(
    `SELECT FIRST 1 c.ID FROM GECTRLENTREGADOCSAIDA c WHERE c.ID_TBSITUACAOFARMACIA = 9
       AND NOT EXISTS (SELECT 1 FROM GECTRLENTREGADOCSAIDA x WHERE x.ID_GELANPAC = c.ID_GELANPAC AND x.ID > c.ID)
     ORDER BY c.ID DESC`,
    [],
    { teto: 1 },
  );
  if (!x) throw new Error('Nenhum controle estornado (9) na cópia.');
  return num(x['ID']);
}

export function cenarioFarmacia(
  nome: string,
  cenario: string,
  base: Pick<CenarioCaptura, 'operacao' | 'cenario' | 'tabelas'>,
  executar: Executar,
  operadorSintetico: (e: Escritor) => Promise<string>,
): CenarioCaptura {
  let entrada: unknown = null;
  let saida = 0;
  let controle = 0;
  const chave = `${nome}/${cenario}`;
  return {
    ...base,
    alvosNasTabelasMedias: true,
    chavesAlvo: () => ({
      GECTRLENTREGADOCSAIDA: saida ? [{ ID_GECADSAI: saida }] : controle ? [{ ID: controle }] : [],
    }),
    async preparar(e) {
      await operadorSintetico(e);
      if (chave === 'suprimentos.confirmarEntrega/dose-estornada') {
        controle = await controleEstornado(e);
        entrada = { controle, modo: 'tablet' };
        return;
      }
      const c = await controleDispensado(e);
      saida = c.saida;
      if (cenario === 'aceite-por-leitura') {
        const etiquetas = await etiquetasDoDocumento(e, c.saida);
        const serie = etiquetas.find((x) => x.startsWith('21D'));
        if (!serie) throw new Error('Documento sem etiqueta de dose.');
        entrada = { controle: c.controle, modo: 'leitura', leitura: serie, dose: Number(serie.slice(3)) };
      } else entrada = { controle: c.controle, modo: 'tablet', dispositivo: 'TABLET SINTETICO' };
    },
    async executar(e) {
      switch (chave) {
        case 'suprimentos.confirmarEntrega/aceite-por-leitura':
        case 'suprimentos.confirmarEntrega/aceite-no-tablet':
          await executar(e, entrada);
          return;
        case 'suprimentos.confirmarEntrega/dose-estornada':
          await exigirRecusa(executar(e, entrada), 'dose-estornada');
          return;
        default:
          throw new Error(`Cenário ${chave} sem reprodução.`);
      }
    },
  };
}

/**
 * Um horário prescrito dispensável na cópia (integração na cópia, ficha do M29, seção 10): de uma internação com conta
 * de convênio aberta, de prescrição vigente no horário, de medicamento sem lote nem controle, com saldo no local da
 * farmácia central, ainda não dispensado por nenhum dos dois sistemas e não checado. Só os IDs, em memória.
 */
export async function horarioDispensavel(
  e: Pick<Escritor, 'consultar'>,
  o: { local: number; minimo: number; excluir?: readonly number[] },
): Promise<{
  reg: number;
  horario: number;
  item: number;
  lancamento: number;
  lote: { lote: string; validade: string } | null;
}> {
  const internacoes = await e.consultar(
    `SELECT FIRST 80 i.REG, i.ID_ATCABECATEND C FROM RICADINT i JOIN RICONTAS k ON k.REG = i.REG
      WHERE i.ALTA < DATE '1900-01-01' AND k.DATAFIN < DATE '1900-01-01' AND k.DATAINI <= CURRENT_DATE AND k.CONV <> 1
        AND i.ID_ATCABECATEND > 0
      ORDER BY i.REG DESC`,
    [],
    { teto: 80, tempoMaximoMs: 120_000 },
  );
  for (const i of internacoes) {
    const ps = await e.consultar(
      `SELECT FIRST 3 p.ID FROM PRPRESC p WHERE p.ID_ATCABECATEND_INTEGRACAO = ? AND p.DATA_HORA_SUSPENSAO IS NULL
        ORDER BY p.ID DESC`,
      [num(i['C'])],
      { teto: 3 },
    );
    for (const p of ps) {
      const hs = await e.consultar(
        `SELECT FIRST 40 c.ID, c.ID_PRLANGERAL L, m.ID_GEITENS G FROM PRLANGERAL l
           JOIN PRCHKGERAL c ON c.ID_PRLANGERAL = l.ID JOIN PRPRESCMED m ON m.ID = c.ID_PRPRESCMED
           JOIN PRPRESC x ON x.ID = l.ID_PRPRESC
          WHERE l.ID_PRPRESC = ? AND l.DATA_HORA_SUSP_CORRECAO IS NULL
            AND (c.SITUACAO_CHECAGEM IS NULL OR c.SITUACAO_CHECAGEM IN ('', 'P'))
            AND x.DATA_HORA_FINAL_VIGENCIA >= c.DATA_HORA_CHECAR
            AND NOT EXISTS (SELECT 1 FROM GEDISPHOR d WHERE d.ID_PRCHKGERAL = c.ID)
            AND NOT EXISTS (SELECT 1 FROM PRINTEGRACAOESTOQUE g WHERE g.ID_PRCHKGERAL = c.ID
                              AND (g.ID_GEDISPHOR IS NOT NULL OR g.ID_GELANSAI IS NOT NULL OR g.ID_GELANPAC IS NOT NULL))
          ORDER BY c.ID DESC`,
        [num(p['ID'])],
        { teto: 40, tempoMaximoMs: 60_000 },
      );
      for (const h of hs) {
        if ((o.excluir ?? []).includes(num(h['ID']))) continue;
        const [it] = await e.consultar(
          `SELECT i.COD, COALESCE(i.RASTREAR, 0) R FROM GEITENS i LEFT JOIN GEREFER r ON r.COD = i.REF
            WHERE i.COD = ? AND COALESCE(i.PORTARIA, '') = '' AND COALESCE(i.PSICO, 'F') <> 'T'
              AND i.ESTOQUE >= ? AND i.TOTAL > 0 AND COALESCE(r.CONSIG, 'F') <> 'T'
              AND EXISTS (SELECT 1 FROM GEARMLOC a WHERE a.ITEM = i.COD AND a.LOCAL = ? AND a.QTDE >= ?
                            AND a.ANO * 100 + a.MES = (SELECT MAX(b.ANO * 100 + b.MES) FROM GEARMLOC b WHERE b.ITEM = i.COD AND b.LOCAL = ?))`,
          [num(h['G']), o.minimo, o.local, o.minimo, o.local],
          { teto: 1, tempoMaximoMs: 60_000 },
        );
        if (!it) continue;
        let lote: { lote: string; validade: string } | null = null;
        if (num(it['R']) === 1) {
          // O lote que vence primeiro no local, com saldo e ainda válido (o que a tela sugere).
          const [l] = await e.consultar(
            `SELECT FIRST 1 LOTE, CAST(DATA AS VARCHAR(10)) V FROM GEVALMEM
              WHERE ITEM = ? AND LOCAL = ? AND QTDE >= ? AND DATA > CURRENT_DATE ORDER BY DATA, ID`,
            [num(it['COD']), o.local, o.minimo],
            { teto: 1 },
          );
          if (!l) continue;
          lote = { lote: String(l['LOTE'] ?? '').trim(), validade: String(l['V'] ?? '').slice(0, 10) };
          if (!lote.lote) continue;
        }
        return {
          reg: num(i['REG']),
          horario: num(h['ID']),
          item: num(it['COD']),
          lancamento: num(h['L']),
          lote,
        };
      }
    }
  }
  throw new Error('Nenhum horário dispensável na cópia (internação com conta, item com saldo no local).');
}
