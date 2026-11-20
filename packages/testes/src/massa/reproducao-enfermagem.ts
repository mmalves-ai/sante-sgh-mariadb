// Reprodução dos cenários de assinatura da checagem (M25; ficha, seção 9) pelo EXECUTOR, na transação da captura
// (sempre desfeita). A prescrição de partida é do pep.prescrever (M24) de um médico da cópia, num atendimento aberto
// existente, para o período seguinte (paciente, retratos, login e CBO só em memória, nunca impressos); a checagem é de
// um profissional de enfermagem da cópia (técnico, CBO 3222; sem ele, o enfermeiro, 2235). Os horários previstos são os
// que a prescrição gravou. Nenhum dado de pessoa sai daqui; os textos levam a marca "SINTETICO M25".
import { createHash } from 'node:crypto';
import {
  type CenarioCaptura,
  type ChecagemGravacao,
  ErroOperacao,
  type Escritor,
  FAIXAS_GLICEMIA_REPRODUCAO,
  itemHemoterapiaDaLinha,
  registrarAmostraTransfusionalSgh,
  requisitarTransfusaoSgh,
  somenteSgh,
} from '@sgh/legado';
import {
  atendimentoAberto,
  cadastrosDoCenario,
  gravacaoDe,
  itemDaForma,
  type Prescritor,
  prescritorDaCopia,
} from './reproducao-prescricao.js';

type Executar = (e: Escritor, entrada: unknown) => Promise<{ resultado: Record<string, unknown> }>;
type ExecutarOutra = (
  e: Escritor,
  nome: string,
  entrada: unknown,
  operador: string,
) => Promise<{ resultado: Record<string, unknown> }>;

export const OPERACOES_REPRODUCAO_ENFERMAGEM = new Set(['enfermagem.checarAdministracao']);

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? NaN));
const MARCA = 'SINTETICO M25';
const DOC_MINIMO =
  '<?xml version="1.0" encoding="Windows-1252" standalone="no"?><documento><versaoXML>1</versaoXML></documento>';

async function exigirRecusa(p: Promise<unknown>, codigo: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao && e.problema.codigo === codigo) return;
    throw e;
  }
  throw new Error(`Cenário de recusa: esperava ${codigo}, a operação gravou.`);
}

/** O profissional de enfermagem da cópia (técnico; sem ele, o enfermeiro), diferente do médico. */
export async function enfermagemDaCopia(e: Escritor, exceto?: Prescritor): Promise<Prescritor> {
  try {
    return await prescritorDaCopia(e, '3222', exceto);
  } catch {
    return prescritorDaCopia(e, '2235', exceto);
  }
}

export interface HorarioDaPartida {
  readonly id: number;
  readonly item: number;
  readonly previsto: Date;
  readonly faixa: number | null;
}

/** Os horários gravados pela prescrição de partida (na ordem do previsto). */
export async function horariosDaPrescricao(e: Escritor, prescricao: number): Promise<HorarioDaPartida[]> {
  const ls = await e.consultar(
    `SELECT c.ID, c.ID_PRLANGERAL I, c.DATA_HORA_CHECAR D, c.ID_PRITENSGLICEMIA F, c.ID_PRITENSGERAL K
       FROM PRCHKGERAL c JOIN PRLANGERAL x ON x.ID = c.ID_PRLANGERAL
      WHERE x.ID_PRPRESC = ? ORDER BY c.DATA_HORA_CHECAR, c.ID`,
    [prescricao],
    { teto: 200 },
  );
  return ls
    .filter((x) => x['K'] === null || x['K'] === undefined)
    .map((x) => ({
      id: num(x['ID']),
      item: num(x['I']),
      previsto: x['D'] as Date,
      faixa: x['F'] === null || x['F'] === undefined ? null : num(x['F']),
    }));
}

/** A entrada da checagem como a API monta (a hora real do ato no relógio do banco, as leituras sintéticas). */
export function entradaDaChecagem(
  o: {
    prescricao: number;
    atendimento: number;
    paciente: number;
    cbo: number;
    horario: HorarioDaPartida;
    situacao: 'A' | 'N';
    quantidade: number;
    justificativa: string | null;
    faixas?: readonly HorarioDaPartida[];
    motivo?: string | null;
    glicemia?: number | null;
    offline?: boolean;
  },
  agora: Date,
): ChecagemGravacao {
  const p2 = (n: number) => String(n).padStart(2, '0');
  const hora = new Date(agora.getTime() - (o.offline ? 25 * 60_000 : 0));
  const horaReal = `${hora.getFullYear()}-${p2(hora.getMonth() + 1)}-${p2(hora.getDate())}T${p2(hora.getHours())}:${p2(hora.getMinutes())}:00`;
  return {
    prescricao: o.prescricao,
    atendimento: o.atendimento,
    paciente: o.paciente,
    cbo: o.cbo,
    marcacoes: [
      {
        horario: o.horario.id,
        item: o.horario.item,
        situacaoLida: 'P',
        situacao: o.situacao,
        quantidade: o.quantidade,
        justificativa: o.justificativa,
        papel: 'principal',
      },
      ...(o.faixas ?? []).map((f) => ({
        horario: f.id,
        item: f.item,
        situacaoLida: 'P',
        situacao: 'N' as const,
        quantidade: 0,
        justificativa: null,
        papel: 'faixa' as const,
      })),
    ],
    sgh: {
      horaReal,
      pulseiraLida: true,
      motivoSemPulseira: null,
      gtin: null,
      lote: null,
      validade: null,
      conferente: null,
      dispositivo: o.offline ? 'tablet-sintetico' : null,
      origemOffline: o.offline ?? false,
      avisos: [],
      motivo: o.motivo ?? null,
      observacao: null,
    },
    glicemia: o.glicemia ?? null,
  };
}

/** Cenário de captura da checagem. */
export function cenarioEnfermagem(
  nome: string,
  cenario: string,
  base: Pick<CenarioCaptura, 'operacao' | 'cenario' | 'tabelas'>,
  executar: Executar,
  executarOutra: ExecutarOutra,
  definirOperador: (login: string) => void,
): CenarioCaptura {
  if (!OPERACOES_REPRODUCAO_ENFERMAGEM.has(nome))
    throw new Error(`Operação ${nome} sem reprodução da enfermagem.`);
  let entrada: unknown = null;
  let recusaEsperada: string | null = null;
  const alvos: Record<string, Record<string, unknown>[]> = {};
  return {
    ...base,
    chavesAlvo: () => alvos,
    async preparar(e) {
      const medico = await prescritorDaCopia(e, '2251');
      const enf = await enfermagemDaCopia(e, medico);
      const at = await atendimentoAberto(e);
      const c = await cadastrosDoCenario(e);
      const hemo = cenario.startsWith('hemocomponente-');
      const forma = hemo
        ? { tipo: 'hemoterapia' as const, frequencia: 3, horarios: 1 }
        : cenario === 'procedimento'
          ? { tipo: 'procedimento' as const, frequencia: 11, horarios: 4 }
          : cenario === 'glicemia'
            ? { tipo: 'glicemia' as const, frequencia: 11, horarios: 4, faixas: FAIXAS_GLICEMIA_REPRODUCAO }
            : cenario === 'se-necessario'
              ? { tipo: 'medicamento' as const, frequencia: 11, horarios: 4, seNecessario: 1 }
              : { tipo: 'medicamento' as const, frequencia: 9, horarios: 3 };
      const item = await itemDaForma(e, forma, 0, c, []);
      const g = await gravacaoDe(e, at, medico, [item], c);
      const r = await executarOutra(e, 'pep.prescrever', g, medico.login);
      const prescricao = num(r.resultado['prescricao']);
      const hs = await horariosDaPrescricao(e, prescricao);
      const principais = hs.filter((h) => h.faixa === null);
      const alvo = principais[0];
      if (!alvo) throw new Error('A prescrição de partida não gravou horário.');
      const faixas =
        cenario === 'glicemia' ? hs.filter((h) => h.faixa !== null && +h.previsto === +alvo.previsto) : [];
      alvos['PRCHKGERAL'] = [alvo, ...faixas].map((h) => ({ ID: h.id }));
      definirOperador(enf.login);
      const [ag] = await e.consultar('SELECT CURRENT_TIMESTAMP T FROM RDB$DATABASE', [], { teto: 1 });
      const agora = ag?.['T'] as Date;
      const dose = cenario === 'procedimento' || cenario === 'glicemia' ? 0 : 1;
      // M47: a requisição transfusional e a amostra de partida no novo (na mesma transação desfeita).
      const requisicao = hemo
        ? await requisicaoDePartida(e, {
            item: alvo.item,
            prescricao,
            atendimento: at.id,
            paciente: at.paciente,
            agora,
          })
        : 0;
      const comum = {
        prescricao,
        atendimento: at.id,
        paciente: at.paciente,
        cbo: enf.cbo,
        horario: alvo,
      };
      switch (cenario) {
        case 'administrado':
        case 'procedimento':
        case 'offline':
        case 'recusa-suspenso':
        case 'recusa-ja-checado':
          entrada = entradaDaChecagem(
            {
              ...comum,
              situacao: 'A',
              quantidade: dose,
              justificativa: null,
              offline: cenario === 'offline',
            },
            agora,
          );
          break;
        case 'nao-administrado':
          entrada = entradaDaChecagem(
            {
              ...comum,
              situacao: 'N',
              quantidade: 0,
              justificativa: `Paciente em jejum ${MARCA}`,
              motivo: 'jejum',
            },
            agora,
          );
          break;
        case 'se-necessario':
          entrada = entradaDaChecagem(
            { ...comum, situacao: 'A', quantidade: dose, justificativa: `Dor 7 de 10 ${MARCA}` },
            agora,
          );
          break;
        case 'glicemia':
          entrada = entradaDaChecagem(
            { ...comum, situacao: 'A', quantidade: 0, justificativa: null, faixas, glicemia: 132 },
            agora,
          );
          break;
        case 'recusa-nunca-vista': {
          const x = entradaDaChecagem(
            { ...comum, situacao: 'A', quantidade: dose, justificativa: null },
            agora,
          );
          entrada = { ...x, marcacoes: x.marcacoes.map((m) => ({ ...m, situacao: 'E' })) };
          recusaEsperada = 'entrada-invalida';
          break;
        }
        case 'hemocomponente-dupla-checagem':
        case 'hemocomponente-recusa': {
          const x = entradaDaChecagem(
            { ...comum, situacao: 'A', quantidade: dose, justificativa: null },
            agora,
          );
          const conferente =
            cenario === 'hemocomponente-recusa' ? null : (await enfermagemDaCopia(e, enf)).login;
          entrada = {
            ...x,
            sgh: { ...x.sgh, conferente },
            hemocomponente: blocoHemo(requisicao, enf.login, conferente ?? enf.login, x.sgh.horaReal),
          };
          if (cenario === 'hemocomponente-recusa') recusaEsperada = 'entrada-invalida';
          break;
        }
        case 'recusa-sem-motivo':
          entrada = entradaDaChecagem({ ...comum, situacao: 'N', quantidade: 0, justificativa: null }, agora);
          recusaEsperada = 'motivo-obrigatorio';
          break;
        default:
          throw new Error(`Cenário ${cenario} sem reprodução.`);
      }
      if (cenario === 'recusa-suspenso') {
        // A suspensão do item pelo médico (neste ou no outro sistema) depois que a tela da enfermagem leu "P".
        await executarOutra(
          e,
          'pep.suspenderItem',
          {
            prescricao,
            item: alvo.item,
            paciente: at.paciente,
            atendimento: at.id,
            cbo: medico.cbo,
            justificativa: `Suspensao ${MARCA} por troca de conduta`,
            correcao: null,
            documento: DOC_MINIMO,
            hashConteudo: createHash('sha256').update(`${MARCA}:${prescricao}`).digest('hex'),
            comoSuporte: false,
          },
          medico.login,
        );
        recusaEsperada = 'horario-suspenso';
      }
      if (cenario === 'recusa-ja-checado') {
        // A checagem do mesmo horário feita em outro terminal depois da leitura.
        await executarOutra(e, 'enfermagem.checarAdministracao', entrada, enf.login);
        recusaEsperada = 'horario-ja-checado';
      }
    },
    async executar(e) {
      if (recusaEsperada) return exigirRecusa(executar(e, entrada), recusaEsperada);
      await executar(e, entrada);
    },
  };
}

/** A requisição transfusional e a amostra de partida do cenário de hemocomponente (SGH_, na transação desfeita). */
async function requisicaoDePartida(
  e: Escritor,
  o: { item: number; prescricao: number; atendimento: number; paciente: number; agora: Date },
): Promise<number> {
  const p2 = (n: number) => String(n).padStart(2, '0');
  const iso = (d: Date) =>
    `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const s = somenteSgh(e);
  // O item de hemoterapia (PRPRESCHEMO.ID) da linha do item da prescrição de partida.
  const h = await itemHemoterapiaDaLinha(e, o.item);
  if (h === null) throw new Error('A prescrição de partida não gravou o item de hemoterapia.');
  const r = await requisitarTransfusaoSgh(s, {
    hospital: e.hospital,
    item: h,
    prescricao: o.prescricao,
    atendimento: o.atendimento,
    paciente: o.paciente,
    hemocomponente: 'CH',
    quantidadeBolsas: 1,
    volumeMl: null,
    urgencia: 4,
    programadaPara: null,
    prazo: iso(o.agora),
    indicacao: `Indicacao ${MARCA} do cenario de assinatura`,
    examesDeApoio: null,
    termo: null,
    justificativaUrgencia: `Justificativa ${MARCA} da extrema urgencia`,
    transfusaoAnterior: 'naoSabe',
    reacaoAnterior: 'naoSabe',
    gestacaoAnterior: 'naoSeAplica',
    usuario: 'SGH.ASSINATURA',
    chave: null,
  });
  await registrarAmostraTransfusionalSgh(s, {
    hospital: e.hospital,
    requisicao: r.id,
    pulseiraLida: true,
    motivoSemPulseira: null,
    coletadaEm: iso(new Date(o.agora.getTime() - 60 * 60_000)),
    validaAte: iso(new Date(o.agora.getTime() + 71 * 3_600_000)),
    usuario: 'SGH.ASSINATURA',
    estacao: 'SGH-ASSINATURA:cenario',
    chave: null,
  });
  return r.id;
}

/** O ato transfusional que a API manda junto com a checagem do hemocomponente (bolsa e sinais SINTÉTICOS). */
function blocoHemo(requisicao: number, profissional: string, conferente: string, horaReal: string) {
  const ano = Number(horaReal.slice(0, 4));
  return {
    requisicao,
    bolsa: {
      numero: `SINT${String(requisicao).slice(-10)}`,
      hemocomponente: 'CH',
      abo: 4,
      rh: 2,
      validade: `${ano + 1}-01-31T23:59`,
      volumeMl: 300,
    },
    inicioEm: horaReal.slice(0, 16),
    pulseiraLida: true,
    motivoSemPulseira: null,
    profissional,
    conferente,
    alertas: [],
    justificativaRh: null,
    sinaisAntes: { pas: 120, pad: 80, fc: 80, temperatura: 36.5 },
    sinaisAntesEm: horaReal.slice(0, 16),
    chave: null,
  };
}

/**
 * O estado que o ROLLBACK tem de devolver (só números): as maiores chaves das tabelas da checagem e dos documentos, as
 * contagens das tabelas SGH_ do marco, da trilha e do outbox da checagem e os horários checados recentes.
 */
export async function estadoEnfermagem(l: Pick<Escritor, 'consultar'>): Promise<number[]> {
  const sqls = [
    'SELECT FIRST 1 ID N FROM PRCHKGERAL ORDER BY ID DESC',
    'SELECT COUNT(*) N FROM HTCHKGERAL',
    'SELECT FIRST 1 ID N FROM PREXTRATOITEM_PRCHKGERAL ORDER BY ID DESC',
    'SELECT FIRST 1 ID N FROM PRASSINATURA_DOC ORDER BY ID DESC',
    'SELECT FIRST 1 ID N FROM PRASSINAT_DOC_PRCHKGERAL ORDER BY ID DESC',
    'SELECT COUNT(*) N FROM SGH_PEP_CHECAGEM_EXT',
    'SELECT COUNT(*) N FROM SGH_PEP_SINAL_VITAL',
    'SELECT COUNT(*) N FROM SGH_PEP_CONFLITO_SYNC',
    'SELECT COUNT(*) N FROM SGH_PEP_APRAZAMENTO',
    'SELECT COUNT(*) N FROM SGH_PEP_INFUSAO_EVENTO',
    'SELECT COUNT(*) N FROM SGH_SADT_HEMO_REQ',
    'SELECT COUNT(*) N FROM SGH_SADT_HEMO_ATO',
    "SELECT COUNT(*) N FROM SGH_TRILHA WHERE OPERACAO = 'enfermagem.checarAdministracao'",
    "SELECT COUNT(*) N FROM SGH_OUTBOX WHERE TIPO = 'enfermagem.dose.checada'",
    `SELECT COUNT(*) N FROM PRCHKGERAL WHERE DATA_HORA_CHECAR >= DATEADD(-120 DAY TO CURRENT_DATE)
       AND SITUACAO_CHECAGEM IN ('A', 'N')`,
  ];
  const r: number[] = [];
  for (const s of sqls) {
    const [x] = await l.consultar(s, [], { teto: 1, tempoMaximoMs: 120_000 });
    r.push(num(x?.['N'] ?? 0));
  }
  return r;
}
