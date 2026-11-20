// Porta do painel de indicadores de pessoas sobre o núcleo (W0-06, parte 7b-2): só leitura. Cada fonte (cadastro,
// ponto, folha, treinamento, SESMT, censo, dimensionamento) é lida na sua própria transação curta READ ONLY pelas
// leituras de @sgh/legado (só SELECT nas SGH_); a que falha vem vazia e entra em `indisponiveis` com o motivo, sem
// derrubar as outras. Nada se grava (nem SGH_, nem trilha: a leitura do painel é registrada pelo controlador).
// O ponto vem dos fechamentos vigentes: os totais por classe de hora gravados no fechamento viram as horas do painel
// (`horasDoPontoFechado`).
import type { ClasseHora, FonteIndicadorPessoas } from '@sgh/contratos';
import { horasDoFechamento } from '@sgh/dominio-pessoas';
import {
  acidentesIndicadoresPesSgh,
  censoIndicadoresPesSgh,
  dimensionamentoIndicadoresPesSgh,
  folhaHorasExtrasIndicadoresPesSgh,
  type Leitor,
  type NucleoLegado,
  pontoFechadoIndicadoresPesSgh,
  type RecorteIndicadoresPes,
  relogioRecepcao,
  type SetorIndicadorPes,
  setoresIndicadoresPesSgh,
  treinamentoIndicadoresPesSgh,
  vinculosIndicadoresPesSgh,
} from '@sgh/legado';
import type {
  BaseLidaIndicadores,
  ContextoIndicadores,
  PortaIndicadoresPessoas,
  RecorteIndicadores,
} from './porta-indicadores.js';

/** Classes de hora do fechamento (CLASSES_HORA) que compõem cada grandeza do painel. */
export const CLASSES_PAINEL = {
  normais: [1],
  extras: [3, 4, 5, 6],
  ausencia: [2, 7, 8],
  tolerancia: [9],
} as const satisfies Record<string, readonly ClasseHora[]>;

type LinhaPonto = SetorIndicadorPes & { totais: string | null; enfermagem: boolean };
type HorasPonto = SetorIndicadorPes & {
  horasPrevistas: number;
  horasTrabalhadas: number;
  horasAusencia: number;
  horasExtras: number;
  horasEnfermagem: number;
};

/**
 * As horas do painel a partir dos totais (minutos por classe) dos fechamentos, somadas por setor:
 *   - trabalhadas = normais (1) + extras (3 a 6), as horas-homem;
 *   - extras = 3 + 4 + 5 + 6;
 *   - ausência = atrasos e débitos (2) + falta (7) + falta abonada (8): o absenteísmo conta a justificada também;
 *   - previstas = normais (1) + ausência + tolerância (9): a jornada prevista que foi cumprida ou faltou;
 *   - enfermagem = as trabalhadas do vínculo da enfermagem.
 * Fechamento com totais ilegíveis não soma (`ilegiveis` conta quantos).
 */
export function horasDoPontoFechado(linhas: readonly LinhaPonto[]): {
  horas: HorasPonto[];
  ilegiveis: number;
} {
  const porSetor = new Map<string, HorasPonto>();
  let ilegiveis = 0;
  for (const l of linhas) {
    const c = horasDoFechamento(l.totais);
    if (!c) {
      ilegiveis += 1;
      continue;
    }
    const soma = (xs: readonly number[]) => xs.reduce((s, k) => s + (c[String(k)] ?? 0), 0) / 60;
    const normais = soma(CLASSES_PAINEL.normais);
    const extras = soma(CLASSES_PAINEL.extras);
    const ausencia = soma(CLASSES_PAINEL.ausencia);
    const trabalhadas = normais + extras;
    const k = `${l.setor}|${l.nomeSetor}`;
    const a = porSetor.get(k) ?? {
      setor: l.setor,
      nomeSetor: l.nomeSetor,
      horasPrevistas: 0,
      horasTrabalhadas: 0,
      horasAusencia: 0,
      horasExtras: 0,
      horasEnfermagem: 0,
    };
    porSetor.set(k, {
      ...a,
      horasPrevistas: a.horasPrevistas + normais + ausencia + soma(CLASSES_PAINEL.tolerancia),
      horasTrabalhadas: a.horasTrabalhadas + trabalhadas,
      horasAusencia: a.horasAusencia + ausencia,
      horasExtras: a.horasExtras + extras,
      horasEnfermagem: a.horasEnfermagem + (l.enfermagem ? trabalhadas : 0),
    });
  }
  return { horas: [...porSetor.values()], ilegiveis };
}

const motivoDe = (e: unknown): string =>
  `Não foi possível ler esta fonte agora (${e instanceof Error ? e.message : String(e)}).`.slice(0, 300);

/** Lê as fontes do recorte, cada uma isolada: a que falha vem vazia e com o motivo. */
export async function lerBaseIndicadores(
  ler: <T>(fn: (l: Leitor) => Promise<T>) => Promise<T>,
  hospital: string,
  r: RecorteIndicadores,
): Promise<BaseLidaIndicadores> {
  const recorte: RecorteIndicadoresPes = { hospital, inicio: r.inicio, fim: r.fim, setor: r.setor };
  const indisponiveis: { fonte: FonteIndicadorPessoas; motivo: string }[] = [];
  const h = { hospital };
  const fonte = async <T>(nome: FonteIndicadorPessoas, fn: (l: Leitor) => Promise<T[]>): Promise<T[]> => {
    try {
      return await ler(fn);
    } catch (e) {
      indisponiveis.push({ fonte: nome, motivo: motivoDe(e) });
      return [];
    }
  };
  const [vinculos, ponto, folha, treinamento, acidentes, censo, dimensionamento] = await Promise.all([
    fonte('cadastro', (l) => vinculosIndicadoresPesSgh(l, recorte)),
    fonte('ponto', (l) => pontoFechadoIndicadoresPesSgh(l, recorte)),
    fonte('folha', (l) => folhaHorasExtrasIndicadoresPesSgh(l, recorte)),
    fonte('treinamento', (l) => treinamentoIndicadoresPesSgh(l, recorte)),
    fonte('sesmt', (l) => acidentesIndicadoresPesSgh(l, recorte)),
    fonte('censo', (l) => censoIndicadoresPesSgh(l, recorte)),
    fonte('dimensionamento', (l) => dimensionamentoIndicadoresPesSgh(l, recorte)),
  ]);
  const { horas, ilegiveis } = horasDoPontoFechado(ponto);
  if (ilegiveis > 0)
    indisponiveis.push({
      fonte: 'ponto',
      motivo: `${ilegiveis} fechamento(s) do ponto com os totais ilegíveis ficaram fora da soma.`,
    });
  const ordem = Object.fromEntries(
    ['cadastro', 'ponto', 'folha', 'treinamento', 'sesmt', 'censo', 'dimensionamento'].map((f, i) => [f, i]),
  );
  return {
    base: {
      inicio: r.inicio,
      fim: r.fim,
      vinculos: vinculos.map((x) => ({ ...h, ...x })),
      ponto: horas.map((x) => ({ ...h, ...x })),
      folhaHorasExtras: folha.map((x) => ({ ...h, ...x })),
      treinamento: treinamento.map((x) => ({ ...h, ...x })),
      acidentes: acidentes.map((x) => ({ ...h, ...x })),
      censo: censo.map((x) => ({ ...h, ...x })),
      dimensionamento: dimensionamento.map((x) => ({ ...h, ...x })),
    },
    indisponiveis: indisponiveis.sort((a, b) => (ordem[a.fonte] ?? 0) - (ordem[b.fonte] ?? 0)),
  };
}

export function portaIndicadoresPessoasLegado(
  nucleo: Pick<NucleoLegado, 'lerSomente'>,
): PortaIndicadoresPessoas {
  const ctx = (c: ContextoIndicadores) => ({
    rede: c.rede,
    hospital: c.hospital,
    traceId: 'indicadores-pessoas',
  });
  return {
    destino: 'legado',
    hoje: (c) => nucleo.lerSomente(ctx(c), async (l) => (await relogioRecepcao(l)).hoje),
    setores: (c) => nucleo.lerSomente(ctx(c), (l) => setoresIndicadoresPesSgh(l, c.hospital)),
    base: (c, r) => lerBaseIndicadores((fn) => nucleo.lerSomente(ctx(c), fn), c.hospital, r),
  };
}
