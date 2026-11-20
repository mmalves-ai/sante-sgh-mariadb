// W1-08: reprodução dos cenários de assinatura do aprazamento e do estorno da checagem pelo EXECUTOR, na transação da
// captura (sempre desfeita). A prescrição de partida é do pep.prescrever de um médico da cópia; o aprazamento é do
// enfermeiro (CBO 2235) e o estorno da enfermagem da cópia (login e CBO só em memória, nunca impressos). A dose com
// baixa de estoque é um horário checado da cópia que já tem a baixa (PRINTEGRACAOESTOQUE ou GEDISPHOR): só IDs.
import { type CenarioCaptura, ErroOperacao, type Escritor } from '@sgh/legado';
import { enfermagemDaCopia, entradaDaChecagem, horariosDaPrescricao } from './reproducao-enfermagem.js';
import {
  atendimentoAberto,
  cadastrosDoCenario,
  gravacaoDe,
  itemDaForma,
  prescritorDaCopia,
} from './reproducao-prescricao.js';

type Executar = (e: Escritor, entrada: unknown) => Promise<{ resultado: Record<string, unknown> }>;
type ExecutarOutra = (
  e: Escritor,
  nome: string,
  entrada: unknown,
  operador: string,
) => Promise<{ resultado: Record<string, unknown> }>;

export const OPERACOES_REPRODUCAO_W108 = new Set([
  'enfermagem.aprazarHorario',
  'enfermagem.estornarChecagem',
]);

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? NaN));
const MARCA = 'SINTETICO W108';

async function exigirRecusa(p: Promise<unknown>, codigo: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao && e.problema.codigo === codigo) return;
    throw e;
  }
  throw new Error(`Cenário de recusa: esperava ${codigo}, a operação gravou.`);
}

/** A hora da tela ("AAAA-MM-DDTHH:MM", hora local do estabelecimento). */
function horaDaTela(d: Date): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** A prescrição de partida (medicamento com extrato) e o primeiro horário dela. */
async function horarioDePartida(e: Escritor, executarOutra: ExecutarOutra) {
  const medico = await prescritorDaCopia(e, '2251');
  const at = await atendimentoAberto(e);
  const c = await cadastrosDoCenario(e);
  const item = await itemDaForma(e, { tipo: 'medicamento', frequencia: 9, horarios: 3 }, 0, c, []);
  const r = await executarOutra(
    e,
    'pep.prescrever',
    await gravacaoDe(e, at, medico, [item], c),
    medico.login,
  );
  const prescricao = num(r.resultado['prescricao']);
  const alvo = (await horariosDaPrescricao(e, prescricao)).find((h) => h.faixa === null);
  if (!alvo) throw new Error('A prescrição de partida não gravou horário.');
  return { medico, at, prescricao, alvo };
}

/** Um horário checado "A" da cópia com a baixa de estoque da dose, e o paciente dele. */
async function horarioComBaixa(e: Escritor): Promise<{ horario: number; paciente: number }> {
  const [x] = await e.consultar(
    `SELECT FIRST 1 c.ID H, a.ID_RICADPAC PAC FROM PRCHKGERAL c
       JOIN PRLANGERAL l ON l.ID = c.ID_PRLANGERAL JOIN PRPRESC p ON p.ID = l.ID_PRPRESC
       JOIN ATCABECATEND a ON a.ID = p.ID_ATCABECATEND_INTEGRACAO
      WHERE c.SITUACAO_CHECAGEM = 'A'
        AND COALESCE(c.ID_PRPRESCMED, c.ID_PRPRESCDIETA, c.ID_PRITENSESQ, c.ID_PRITENSGERAL) IS NOT NULL
        AND (EXISTS (SELECT 1 FROM PRINTEGRACAOESTOQUE i WHERE i.ID_PRCHKGERAL = c.ID)
          OR EXISTS (SELECT 1 FROM GEDISPHOR g WHERE g.ID_PRCHKGERAL = c.ID))
      ORDER BY c.ID DESC`,
    [],
    { teto: 1, tempoMaximoMs: 120_000 },
  );
  if (!x) throw new Error('Nenhum horário checado com baixa de estoque na cópia.');
  return { horario: num(x['H']), paciente: num(x['PAC']) };
}

/** Cenário de captura do aprazamento ou do estorno da checagem. */
export function cenarioW108(
  nome: string,
  cenario: string,
  base: Pick<CenarioCaptura, 'operacao' | 'cenario' | 'tabelas'>,
  executar: Executar,
  executarOutra: ExecutarOutra,
  definirOperador: (login: string) => void,
): CenarioCaptura {
  if (!OPERACOES_REPRODUCAO_W108.has(nome)) throw new Error(`Operação ${nome} sem reprodução do W1-08.`);
  let entrada: unknown = null;
  let recusaEsperada: string | null = null;
  const alvos: Record<string, Record<string, unknown>[]> = {};
  return {
    ...base,
    chavesAlvo: () => alvos,
    async preparar(e) {
      if (nome === 'enfermagem.aprazarHorario') {
        const { medico, at, prescricao, alvo } = await horarioDePartida(e, executarOutra);
        const enf = await prescritorDaCopia(e, '2235', medico);
        alvos['PRCHKGERAL'] = [{ ID: alvo.id }];
        definirOperador(enf.login);
        const comum = { horario: alvo.id, item: alvo.item, prescricao, paciente: at.paciente, cbo: enf.cbo };
        const umaHoraDepois = horaDaTela(new Date(+alvo.previsto + 60 * 60_000));
        switch (cenario) {
          case 'aprazar':
            entrada = { ...comum, acao: 'aprazar', confirmado: horaDaTela(alvo.previsto), motivo: null };
            break;
          case 'reaprazar':
            entrada = {
              ...comum,
              acao: 'reaprazar',
              confirmado: umaHoraDepois,
              motivo: `Paciente no exame ${MARCA}`,
            };
            break;
          case 'suprimir':
            entrada = {
              ...comum,
              acao: 'suprimir',
              confirmado: null,
              motivo: `Jejum para cirurgia ${MARCA}`,
            };
            break;
          case 'recusa-sem-motivo':
            entrada = { ...comum, acao: 'reaprazar', confirmado: umaHoraDepois, motivo: null };
            recusaEsperada = 'motivo-obrigatorio';
            break;
          default:
            throw new Error(`Cenário ${cenario} sem reprodução.`);
        }
        return;
      }
      // enfermagem.estornarChecagem
      if (cenario === 'devolucao-pendente' || cenario === 'recusa-estoque-baixado') {
        const h = await horarioComBaixa(e);
        const enf = await enfermagemDaCopia(e);
        alvos['PRCHKGERAL'] = [{ ID: h.horario }];
        definirOperador(enf.login);
        entrada = {
          ...h,
          cbo: enf.cbo,
          motivo: 'nao-administrado',
          justificativa: `Dose nao administrada ${MARCA}`,
          devolucaoPendente: cenario === 'devolucao-pendente',
        };
        if (cenario === 'recusa-estoque-baixado') recusaEsperada = 'estoque-baixado';
        return;
      }
      const { medico, at, prescricao, alvo } = await horarioDePartida(e, executarOutra);
      const enf = await enfermagemDaCopia(e, medico);
      alvos['PRCHKGERAL'] = [{ ID: alvo.id }];
      definirOperador(enf.login);
      if (cenario !== 'recusa-nao-checado') {
        const [ag] = await e.consultar('SELECT CURRENT_TIMESTAMP T FROM RDB$DATABASE', [], { teto: 1 });
        const checagem = entradaDaChecagem(
          {
            prescricao,
            atendimento: at.id,
            paciente: at.paciente,
            cbo: enf.cbo,
            horario: alvo,
            situacao: 'A',
            quantidade: 1,
            justificativa: null,
          },
          ag?.['T'] as Date,
        );
        await executarOutra(e, 'enfermagem.checarAdministracao', checagem, enf.login);
      }
      const estorno = {
        horario: alvo.id,
        paciente: at.paciente,
        cbo: enf.cbo,
        justificativa: `Checado no horario errado ${MARCA}`,
        devolucaoPendente: false,
      };
      switch (cenario) {
        case 'checado-por-engano':
          entrada = { ...estorno, motivo: 'checado-por-engano' };
          break;
        case 'nao-administrado':
          entrada = {
            ...estorno,
            motivo: 'nao-administrado',
            justificativa: `Dose nao administrada ${MARCA}`,
          };
          break;
        case 'recusa-nao-checado':
          entrada = { ...estorno, motivo: 'checado-por-engano' };
          recusaEsperada = 'horario-nao-checado';
          break;
        default:
          throw new Error(`Cenário ${cenario} sem reprodução.`);
      }
    },
    async executar(e) {
      if (recusaEsperada) return exigirRecusa(executar(e, entrada), recusaEsperada);
      await executar(e, entrada);
    },
  };
}
