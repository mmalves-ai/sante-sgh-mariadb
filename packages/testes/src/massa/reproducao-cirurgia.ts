// Reprodução dos cenários de assinatura do centro cirúrgico (M18; ficha, seção 9) pelo EXECUTOR, na transação da
// captura (sempre desfeita). A preparação (antes do retrato "antes") cria pelo próprio executor o operador e o
// paciente sintéticos, inclui o operador entre os usuários da sala (cirurgia.definirSalaUsuario) e agenda as
// cirurgias de partida (cirurgia.agendarCirurgia) num horário livre da sala daqui a 30 dias; o cenário executa só a
// receita sob teste. Os profissionais da equipe e a internação do registro são linhas existentes da cópia, das quais
// só o ID e o código ficam em memória (nenhum nome, nenhum dado de pessoa).
import { LISTA_CHECKLIST_V1 } from '@sgh/contratos';
import {
  abrirChecklistSgh,
  type CenarioCaptura,
  concluirMomentoChecklistSgh,
  confirmarItensChecklistSgh,
  ErroOperacao,
  type Escritor,
} from '@sgh/legado';
import { cepCompleto, cpfLivre, pacienteSintetico } from './sintetica.js';

type Executar = (e: Escritor, entrada: unknown) => Promise<{ resultado: Record<string, unknown> }>;
type ExecutarOutra = (
  e: Escritor,
  nome: string,
  entrada: unknown,
) => Promise<{ resultado: Record<string, unknown> }>;

export const OPERACOES_REPRODUCAO_CIRURGIA = new Set([
  'cirurgia.agendarCirurgia',
  'cirurgia.cancelarCirurgia',
  'cirurgia.remarcarCirurgia',
  'cirurgia.registrarCirurgia',
  'cirurgia.definirSalaUsuario',
]);

export const MARCA_CC_M18 = 'SINTETICO SGH M18 CC';

async function exigirRecusa(p: Promise<unknown>, codigo: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao && e.problema.codigo === codigo) return;
    throw e;
  }
  throw new Error(`Cenário de recusa: esperava ${codigo}, a operação gravou.`);
}

const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();
const num = (v: unknown) => Number(v ?? 0);
let seq = 0;

const somar = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

export interface ProfissionalDaCopia {
  readonly id: number;
  readonly cod: number;
}

/** Profissionais com código (COD > 0) da cópia: só ID e código em memória. */
export async function profissionais(e: Escritor, n: number): Promise<ProfissionalDaCopia[]> {
  const linhas = await e.consultar(
    `SELECT FIRST ${Math.min(Math.max(n, 1), 20)} ID, COD FROM TBCBOPRO WHERE COD > 0 AND ID NOT IN (1, 488) ORDER BY ID`,
    [],
    { teto: 20 },
  );
  if (linhas.length < n) throw new Error('Profissionais insuficientes na cópia.');
  return linhas.map((x) => ({ id: num(x['ID']), cod: num(x['COD']) }));
}

/** Um dia daqui a 30+ dias em que a sala não tem nenhuma cirurgia (o horário das 06:00 às 12:00 livre). */
export async function diaLivreDaSala(e: Escritor, sala: number): Promise<string> {
  const [r] = await e.consultar('SELECT CAST(CURRENT_DATE AS VARCHAR(10)) H FROM RDB$DATABASE', [], {
    teto: 1,
  });
  const hoje = txt(r?.['H']);
  for (let i = 30; i < 400; i++) {
    const d = somar(hoje, i);
    const [x] = await e.consultar(
      `SELECT COUNT(*) N FROM CCAGENDA WHERE SALA = ? AND DATA_HORA >= CAST(CAST(? AS VARCHAR(10)) || ' 00:00:00' AS TIMESTAMP)
          AND DATA_HORA < CAST(CAST(? AS VARCHAR(10)) || ' 23:59:59' AS TIMESTAMP)`,
      [sala, somar(d, -1), somar(d, 1)],
      { teto: 1 },
    );
    if (num(x?.['N']) === 0) return d;
  }
  throw new Error('Nenhum dia livre na sala.');
}

/**
 * O outro sistema grava uma cirurgia direto na tabela (como o Delphi), na transação desfeita: cópia da linha
 * SINTÉTICA `modelo` (agendada pelo executor na mesma transação) para outro início na mesma sala. O banco aceita a
 * sobreposição (a chave única é só SALA + DATA_HORA): é o que o mapa mostra com alerta e o que a gravação nova relê.
 */
export async function legadoOcupaSala(
  e: Escritor,
  modelo: number,
  data: string,
  hora: string,
): Promise<void> {
  const cols = (
    await e.consultar(
      `SELECT TRIM(r.RDB$FIELD_NAME) C FROM RDB$RELATION_FIELDS r JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = r.RDB$FIELD_SOURCE
        WHERE r.RDB$RELATION_NAME = 'CCAGENDA' AND r.RDB$FIELD_NAME NOT IN ('ID', 'DATA_HORA') AND f.RDB$COMPUTED_BLR IS NULL`,
      [],
      { teto: 200 },
    )
  )
    .map((x) => String(x['C']))
    .filter((c) => /^[A-Z][A-Z0-9_]*$/.test(c));
  const n = await e.executar(
    `INSERT INTO CCAGENDA (ID, DATA_HORA, ${cols.join(', ')})
     SELECT 0, CAST(CAST(? AS VARCHAR(10)) || ' ' || CAST(? AS VARCHAR(5)) || ':00' AS TIMESTAMP), ${cols.join(', ')} FROM CCAGENDA WHERE ID = ?`,
    [data, `${hora.slice(0, 2)}:${hora.slice(2, 4)}`, modelo],
  );
  if (n !== 1) throw new Error('Escritor legado simulado: o agendamento modelo não existe.');
}

/** O checklist de cirurgia segura com a entrada e a pausa cirúrgica concluídas (SGH_ só; agendamento SINTÉTICO). */
export async function checklistConcluido(e: Escritor, dia: string): Promise<number> {
  const k = await abrirChecklistSgh(e, {
    hospital: 'pc',
    agendamento: 999_462_901,
    sala: 1,
    dataHora: `${dia}T08:00`,
    reg: 0,
    paciente: null,
    lista: LISTA_CHECKLIST_V1.versao,
    usuario: 'SGH.ASSINATURA',
  });
  let versao = k.versao;
  for (const [momento, hora] of [
    ['inducao', '07:50'],
    ['incisao', '08:00'],
  ] as const) {
    versao = (
      await confirmarItensChecklistSgh(e, {
        hospital: 'pc',
        checklist: k.id,
        versaoVista: versao,
        momento,
        em: `${dia}T${hora}`,
        itens: LISTA_CHECKLIST_V1.itens
          .filter((i) => i.momento === momento)
          .map((i) => ({
            item: i.codigo,
            resposta: i.tipo === 'pergunta' ? ('nao' as const) : ('sim' as const),
            observacao: null,
          })),
        profissional: null,
        usuario: 'SGH.ASSINATURA',
        chave: null,
      })
    ).versao;
    versao = (
      await concluirMomentoChecklistSgh(e, {
        checklist: k.id,
        versaoVista: versao,
        momento,
        em: `${dia}T${hora}`,
        usuario: 'SGH.ASSINATURA',
      })
    ).versao;
  }
  return k.id;
}

export function cenarioCirurgia(
  nome: string,
  cenario: string,
  base: Pick<CenarioCaptura, 'operacao' | 'cenario' | 'tabelas'>,
  executar: Executar,
  executarOutra: ExecutarOutra,
  operadorSintetico: (e: Escritor) => Promise<string>,
  tiposLogradouro: () => ReadonlySet<string>,
): CenarioCaptura {
  let entrada: unknown = null;
  let recusaEsperada: string | null = null;
  let operador = '';
  const SALA = 1;

  const paciente = async (e: Escritor) => {
    const cpf = await cpfLivre(e, (Date.now() + 7307 * ++seq) % 90_000_000);
    const cep = await cepCompleto(e, tiposLogradouro());
    const r = await executarOutra(e, 'cadastro.cadastrarPaciente', pacienteSintetico('com-cep', cpf, cep));
    return num(r.resultado['idPaciente']);
  };
  const entrarNaSala = (e: Escritor, sala = SALA) =>
    executarOutra(e, 'cirurgia.definirSalaUsuario', { sala, usuario: operador, acao: 'incluir' });
  const pedido = (
    pac: number,
    data: string,
    hora: string,
    equipe: Record<string, ProfissionalDaCopia>,
    extra: Record<string, unknown> = {},
  ) => ({
    sala: SALA,
    data,
    hora,
    duracaoMin: 90,
    intervaloMin: 0,
    paciente: pac,
    reg: 0,
    atendimento: 'I',
    especialidade: 33,
    convenio: 306,
    procedimento: 30_101_271,
    anestesia: 1,
    equipe,
    pediatra: null,
    recursos: [],
    procedimentosAdicionais: [],
    carater: 2,
    solicitacao: null,
    excecao: null,
    ...extra,
  });

  const preparar = async (e: Escritor): Promise<void> => {
    operador = await operadorSintetico(e);
    switch (nome) {
      case 'cirurgia.definirSalaUsuario': {
        entrada = { sala: SALA, usuario: operador, acao: cenario === 'remover' ? 'remover' : 'incluir' };
        if (cenario === 'remover') await entrarNaSala(e);
        if (cenario === 'recusa') {
          await entrarNaSala(e);
          recusaEsperada = 'ja-permitido';
        }
        return;
      }
      case 'cirurgia.agendarCirurgia': {
        await entrarNaSala(e);
        const pac = await paciente(e);
        const dia = await diaLivreDaSala(e, SALA);
        const [cir, a1, a2, a3, ins, an, ci, ped] = await profissionais(e, 8);
        if (cenario === 'eletiva-completa') {
          entrada = pedido(
            pac,
            dia,
            '0700',
            {
              cirurgiao: cir!,
              auxiliar1: a1!,
              auxiliar2: a2!,
              auxiliar3: a3!,
              instrumentador: ins!,
              anestesista: an!,
              circulante: ci!,
            },
            { pediatra: ped!.id },
          );
          return;
        }
        if (cenario === 'urgencia-minima') {
          entrada = pedido(
            pac,
            dia,
            '0900',
            { cirurgiao: cir! },
            {
              carater: 1,
              procedimentosAdicionais: [30_101_522],
              observacao: `${MARCA_CC_M18}: urgência`,
            },
          );
          return;
        }
        // Recusa: outra cirurgia já ocupa a sala das 07:00 às 08:30 (agendada pelo executor na preparação).
        await executarOutra(e, 'cirurgia.agendarCirurgia', pedido(pac, dia, '0700', { cirurgiao: cir! }));
        entrada = pedido(pac, dia, '0800', { cirurgiao: cir! });
        recusaEsperada = 'sala-ocupada';
        return;
      }
      case 'cirurgia.cancelarCirurgia': {
        await entrarNaSala(e);
        const pac = await paciente(e);
        const dia = await diaLivreDaSala(e, SALA);
        const [cir] = await profissionais(e, 1);
        const r = await executarOutra(
          e,
          'cirurgia.agendarCirurgia',
          pedido(pac, dia, '0700', { cirurgiao: cir! }, { procedimentosAdicionais: [30_101_522] }),
        );
        entrada = {
          agendamento: num(r.resultado['agendamento']),
          motivo: 'PAC-CLINICO',
          solicitante: 'equipe',
          suspender: false,
        };
        if (cenario === 'recusa') {
          await executarOutra(e, 'cirurgia.definirSalaUsuario', {
            sala: SALA,
            usuario: operador,
            acao: 'remover',
          });
          recusaEsperada = 'sala-nao-permitida';
        }
        return;
      }
      case 'cirurgia.remarcarCirurgia': {
        await entrarNaSala(e);
        const pac = await paciente(e);
        const dia = await diaLivreDaSala(e, SALA);
        const [cir] = await profissionais(e, 1);
        const r = await executarOutra(
          e,
          'cirurgia.agendarCirurgia',
          pedido(pac, dia, '0700', { cirurgiao: cir! }),
        );
        if (cenario === 'recusa')
          await executarOutra(e, 'cirurgia.agendarCirurgia', pedido(pac, dia, '1000', { cirurgiao: cir! }));
        entrada = {
          agendamento: num(r.resultado['agendamento']),
          sala: SALA,
          data: dia,
          hora: cenario === 'recusa' ? '0930' : '1300',
          lido: { sala: SALA, data: dia, hora: '0700' },
          justificativa: `${MARCA_CC_M18}: mudança de horário`,
          excecao: null,
        };
        if (cenario === 'recusa') recusaEsperada = 'sala-ocupada';
        return;
      }
      case 'cirurgia.registrarCirurgia': {
        await entrarNaSala(e);
        const [x] = await e.consultar(
          'SELECT FIRST 1 REG FROM RICADINT WHERE REG > 0 ORDER BY REG DESC',
          [],
          {
            teto: 1,
          },
        );
        if (!x) throw new Error('Nenhuma internação na cópia.');
        const [cir, aux, an] = await profissionais(e, 3);
        // Dois dias atrás: o ato registrado depois do dia (hoje seria o DEFAULT 'today' da coluna).
        const [r] = await e.consultar(
          'SELECT CAST(CURRENT_DATE - 2 AS VARCHAR(10)) H FROM RDB$DATABASE',
          [],
          {
            teto: 1,
          },
        );
        entrada = {
          agendamento: null,
          reg: num(x['REG']),
          data: txt(r?.['H']),
          sala: SALA,
          convenio: 306,
          porte: 'M',
          potencialContaminacao: 'L',
          carater: 2,
          tipoAnestesia: 1,
          inicio: '0800',
          fim: cenario === 'recusa' ? '0730' : '0930',
          inicioAnestesia: '0745',
          fimAnestesia: '0940',
          cid10: 'K80.2',
          pressao: '120x80',
          pulso: 72,
          supuracao: false,
          usos: {
            tubo: { usado: false, descricao: null },
            antimicrobiano: { usado: false, descricao: null },
            sonda: { usado: false, descricao: null },
            cateter: { usado: false, descricao: null },
            puncao: { usado: false, descricao: null },
          },
          procedimentos: [
            {
              procedimento: 30_101_271,
              especialidade: 33,
              tecnica: 0,
              equipe: { cirurgiao: cir!, auxiliar1: aux!, anestesista: an! },
            },
          ],
          extensao: { entradaSala: '0740', incisao: '0805', saidaSala: '0950', asa: 2, observacao: null },
        };
        if (cenario === 'recusa') recusaEsperada = 'tempos-invalidos';
        // M46 (etapa 2): o checklist estruturado concluído no novo antes do retrato (entrada e pausa cirúrgica às 07:50 e
        // 08:00, antes da incisão das 08:05), num agendamento SINTÉTICO só das tabelas SGH_.
        if (cenario === 'com-checklist') await checklistConcluido(e, txt(r?.['H']));
        return;
      }
      default:
        throw new Error(`Operação ${nome} sem reprodução no centro cirúrgico.`);
    }
  };

  return {
    ...base,
    async preparar(e) {
      await preparar(e);
    },
    async executar(e) {
      if (recusaEsperada) await exigirRecusa(executar(e, entrada), recusaEsperada);
      else await executar(e, entrada);
    },
  };
}
