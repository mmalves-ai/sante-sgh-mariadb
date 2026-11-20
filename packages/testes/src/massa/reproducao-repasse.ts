// Reprodução dos cenários de assinatura do repasse (M33; ficha, seção 9) pelo EXECUTOR, na transação da captura (sempre
// desfeita). O médico (registro e código) e o evento são os de um lançamento recente da cópia (só IDs e códigos, em
// memória; nenhum valor de linha sai); os valores são sintéticos.
//   - lancarEvento: o total do médico na apuração aprovada do novo (a apuração e a memória sintéticas em SGH_, na mesma
//     transação desfeita); o ajuste avulso; o estorno por glosa de um lançamento de partida (criado pelo executor na
//     preparação); a recusa do estorno que passa do original;
//   - lancarEvento/origem-plantao (M52.6): um vínculo sintético de PJ com o registro do médico, a escala publicada, o
//     plantão e o realizado aprovado por outra pessoa (tudo SGH_, na mesma transação desfeita), lançados pela soma.
import {
  type CenarioCaptura,
  decidirRealizadoPesSgh,
  ErroOperacao,
  type Escritor,
  incluirEscalaPesSgh,
  incluirPlantaoPesSgh,
  incluirRealizadoPesSgh,
  incluirVinculoPesSgh,
  publicarEscalaPesSgh,
} from '@sgh/legado';

type Executar = (e: Escritor, entrada: unknown) => Promise<unknown>;
type ExecutarOutra = (e: Escritor, operacao: string, entrada: unknown) => Promise<unknown>;

export const OPERACOES_REPRODUCAO_REPASSE = new Set(['repasse.lancarEvento']);

const num = (v: unknown) => Number(v ?? 0);
const p2 = (n: number) => String(n).padStart(2, '0');
const dia = (v: unknown) =>
  v instanceof Date
    ? `${v.getFullYear()}-${p2(v.getMonth() + 1)}-${p2(v.getDate())}`
    : String(v ?? '').slice(0, 10);

async function exigirRecusa(p: Promise<unknown>, codigo: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao && e.problema.codigo === codigo) return;
    throw e;
  }
  throw new Error(`Cenário de recusa: esperava ${codigo}, a operação gravou.`);
}

/** Médico com lançamento recente vinculado ao registro (TBCBOPRO.COD = o prestador) e o evento desse lançamento. */
const SQL_MEDICO = `SELECT FIRST 1 b.ID, b.COD, e.ID_RPEVENTO FROM RPLANEVE_TBCBOPRO v JOIN TBCBOPRO b ON b.ID = v.ID_TBCBOPRO
  JOIN RPLANEVE e ON e.ID_RPLANEVE = v.ID_RPLANEVE WHERE e.TIPO = 'M' AND e.COD_PRESTADOR = b.COD AND e.DATA >= '2025-06-01'
  AND EXISTS (SELECT 1 FROM RPEVENTO r WHERE r.ID_RPEVENTO = e.ID_RPEVENTO AND COALESCE(r.ATIVO, 'T') <> 'F')
  ORDER BY e.ID_RPLANEVE DESC`;

export function cenarioRepasse(
  nome: string,
  cenario: string,
  base: Pick<CenarioCaptura, 'operacao' | 'cenario' | 'tabelas'>,
  hospital: string,
  executar: Executar,
  executarOutra: ExecutarOutra,
  operadorSintetico: (e: Escritor) => Promise<string>,
): CenarioCaptura {
  const chave = `${nome}/${cenario}`;
  let entrada: Record<string, unknown> = {};
  let original = 0;

  async function base0(e: Escritor): Promise<Record<string, unknown>> {
    const [m] = await e.consultar(SQL_MEDICO, [], { teto: 1, tempoMaximoMs: 120_000 });
    if (!m) throw new Error('Cenário sem médico com lançamento na cópia.');
    const [h] = await e.consultar('SELECT CURRENT_DATE H FROM RDB$DATABASE', [], { teto: 1 });
    const hoje = dia(h?.['H']);
    return {
      origem: 'ajuste',
      empresa: 1,
      competencia: hoje.slice(0, 7),
      data: hoje,
      previsao: null,
      evento: num(m['ID_RPEVENTO']),
      tipo: 'M',
      prestador: num(m['COD']),
      profissional: num(m['ID']),
      valor: 321.45,
      referente: 'SINTETICO M33',
      justificativa: 'Cenário sintético de assinatura do repasse (M33)',
      apuracao: null,
      estornaDe: null,
    };
  }

  /** A competência anterior (AAAA-MM). */
  function competenciaAnterior(c: string): string {
    const [a, m] = c.split('-').map(Number) as [number, number];
    return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
  }

  /** A apuração aprovada do novo (gravada, fora de simulação), sintética, com a memória do médico (SGH_, na transação desfeita). */
  async function apuracaoAprovada(e: Escritor, ent: Record<string, unknown>): Promise<string> {
    const [a] = await e.consultar(
      'SELECT CAST(NEXT VALUE FOR SGH_GEN_REP_APURACAO AS VARCHAR(20)) ID FROM RDB$DATABASE',
      [],
      { teto: 1 },
    );
    const id = String(a?.['ID'] ?? '');
    await e.executar('DELETE FROM SGH_REP_APURACAO WHERE HOSPITAL = ? AND EMPRESA = 1 AND COMPETENCIA = ?', [
      hospital,
      ent['competencia'],
    ]);
    await e.executar(
      `INSERT INTO SGH_REP_APURACAO (ID, HOSPITAL, EMPRESA, COMPETENCIA, ESTADO, SIMULACAO, ITENS, COM_REPASSE, PENDENTES,
         BASE, VALOR, APURADO_POR, CONFERIDO_POR, APROVADO_POR)
       VALUES (CAST(CAST(? AS VARCHAR(20)) AS BIGINT), ?, 1, ?, 'aprovada', 'N', 1, 1, 0, 1737.57, 321.45, 'SINT.REP.APURA',
         'SINT.REP.APURA', 'SINT.REP.SUPERVISOR')`,
      [id, hospital, ent['competencia']],
    );
    const [m] = await e.consultar(
      'SELECT CAST(NEXT VALUE FOR SGH_GEN_REP_MEMORIA_CALCULO AS VARCHAR(20)) ID FROM RDB$DATABASE',
      [],
      { teto: 1 },
    );
    await e.executar(
      `INSERT INTO SGH_REP_MEMORIA_CALCULO (ID, ID_APURACAO, HOSPITAL, ID_FCLANEXT, PRESTADOR, BASE_TIPO, BASE_VALOR,
         PERCENTUAL, VALOR_SEM_ADICIONAL, VALOR) VALUES (CAST(CAST(? AS VARCHAR(20)) AS BIGINT),
         CAST(CAST(? AS VARCHAR(20)) AS BIGINT), ?, 1, ?, 'cobrado', 1737.57, 18.5, 321.45, 321.45)`,
      [String(m?.['ID'] ?? ''), id, hospital, ent['prestador']],
    );
    return id;
  }

  /** M52.6: o realizado aprovado de um plantão sintético do prestador (PJ) com o registro do médico do lançamento. */
  async function plantaoAprovado(e: Escritor, ent: Record<string, unknown>): Promise<number> {
    const [cc] = await e.consultar(
      "SELECT FIRST 1 COD FROM TBCENCUS WHERE COALESCE(SITUACAO, 'A') <> 'I' ORDER BY COD",
      [],
      { teto: 1 },
    );
    const [un] = await e.consultar('SELECT FIRST 1 COD FROM TBUNIDAD WHERE COD > 0 ORDER BY COD', [], {
      teto: 1,
    });
    const competencia = String(ent['competencia']);
    const v = await incluirVinculoPesSgh(e, {
      hospital,
      pessoa: null,
      cpfHmac: 'e'.repeat(63) + '6',
      cpfCifrado: 'SINTETICO-M52.6',
      nome: 'MEDICA SINTETICA DO PLANTAO',
      profissional: null,
      usuario: null,
      tipo: 'pj',
      matricula: null,
      cargo: 'Médica plantonista',
      funcao: null,
      cargaSemanal: 24,
      centroCusto: num(cc?.['COD']),
      unidade: num(un?.['COD']),
      setor: null,
      admissao: `${competencia}-01`,
      por: 'SINT.REP.COORD',
    });
    const escala = await incluirEscalaPesSgh(e, {
      hospital,
      unidade: num(un?.['COD']),
      setor: 'SINTETICO M52.6',
      competencia,
      tipo: 'medica',
      cobertura: { manha: 0, tarde: 0, noite: 0 },
      por: 'SINT.REP.COORD',
    });
    const plantao = await incluirPlantaoPesSgh(e, {
      hospital,
      escala,
      vinculo: v.id,
      pessoa: v.pessoa,
      profissional: null,
      registro: num(ent['profissional']),
      tipo: 'presencial',
      inicio: `${competencia}-01T07:00`,
      fim: `${competencia}-01T19:00`,
      chegadaMin: null,
      alertaConselho: null,
      redeNaoConferida: false,
      motivo: null,
      por: 'SINT.REP.COORD',
    });
    await publicarEscalaPesSgh(e, {
      hospital,
      id: escala,
      versao: 0,
      justificativaFuro: null,
      por: 'SINT.REP.COORD',
    });
    const realizado = await incluirRealizadoPesSgh(e, {
      hospital,
      plantao,
      vinculo: v.id,
      inicio: `${competencia}-01T07:00`,
      fim: `${competencia}-01T19:00`,
      minutos: 720,
      origem: 'informado',
      observacao: null,
      por: 'SINT.REP.COORD',
    });
    await decidirRealizadoPesSgh(e, {
      hospital,
      id: realizado,
      versao: 0,
      situacao: 'aprovado',
      motivo: null,
      tarifa: null,
      valorHora: 100,
      valor: 1200,
      por: 'SINT.REP.APROVA',
    });
    return realizado;
  }

  return {
    ...base,
    async preparar(e) {
      await operadorSintetico(e);
      entrada = await base0(e);
      switch (chave) {
        case 'repasse.lancarEvento/origem-plantao': {
          const realizado = await plantaoAprovado(e, entrada);
          entrada = {
            ...entrada,
            origem: 'plantao',
            valor: 1200,
            plantoes: [realizado],
            referente: 'SINTETICO M52.6',
            justificativa: 'Plantões realizados sintéticos do prestador (M52.6)',
          };
          break;
        }
        case 'repasse.lancarEvento/apuracao-medico-pf':
          entrada = { ...entrada, origem: 'apuracao', apuracao: Number(await apuracaoAprovada(e, entrada)) };
          break;
        case 'repasse.lancarEvento/estorno-glosa':
        case 'repasse.lancarEvento/recusa-ja-estornado': {
          // O original no período anterior: o estorno por glosa entra no período seguinte (D-ESTORNO-33).
          const anterior = competenciaAnterior(String(entrada['competencia']));
          const r = (await executarOutra(e, 'repasse.lancarEvento', {
            ...entrada,
            competencia: anterior,
            data: `${anterior}-15`,
          })) as {
            resultado?: Record<string, unknown>;
          };
          original = num(r.resultado?.['lancamento']);
          entrada = {
            ...entrada,
            origem: 'estorno',
            estornaDe: original,
            valor: cenario === 'estorno-glosa' ? -120.5 : -400,
            referente: 'SINTETICO M33 estorno',
            justificativa: 'Estorno sintético da glosa mantida (M33)',
          };
          break;
        }
        default:
          break;
      }
    },
    async executar(e) {
      if (chave === 'repasse.lancarEvento/recusa-ja-estornado') {
        await exigirRecusa(executar(e, entrada), 'ja-estornado');
        return;
      }
      await executar(e, entrada);
    },
  };
}
