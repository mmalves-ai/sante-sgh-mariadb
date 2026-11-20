// W0-04, mercado M2 e M3: as fichas técnicas dos indicadores de segurança do paciente (RDC 36/2013 e protocolos do
// PNSP) e das linhas de cuidado (protocolos gerenciados de sepse, AVC e dor torácica), e as contas que dão o numerador
// e o denominador de cada um a partir dos registros que já existem no novo:
//   - queda, lesão por pressão, erro de medicação e flebite: as notificações do NSP da competência (data do incidente),
//     sem as descartadas; o tipo é o confirmado na triagem (o NSP reclassifica);
//   - extubação não planejada: a retirada acidental do tubo e ventilação mecânica no registro de dispositivos da CCIH
//     (o mesmo registro da aba de dispositivos do prontuário, M1), sem os cancelados;
//   - denominador: os pacientes-dia do censo diário da competência (a mesma leitura dos denominadores da CCIH);
//   - linhas de cuidado: as inclusões no protocolo gerenciado da competência (sem as descartadas), o tempo da
//     meta-chave desde a referência da definição (chegada ou inclusão) e o alvo (o prazo da meta na versão usada).
// A LPP vem da notificação: a sugestão automática de notificação da LPP adquirida (W0-03, M4) cai no mesmo registro.
// Sem banco nem Nest; toda conta sai com as parcelas impressas.
import type {
  ClassificacaoOms,
  ConteudoGerenciado,
  FichaIndicadorQualidade,
  LinhaDeCuidado,
  TipoIncidente,
} from '@sgh/contratos';
import { msLocal } from '../nsp/prazos.js';
import { duasCasas, numeroBr } from './comum.js';

const NSP = 'Núcleo de segurança do paciente';
const REF_RDC36 =
  'RDC 36/2013 (Anvisa) e protocolos básicos do Programa Nacional de Segurança do Paciente (Portaria 529/2013)';
const FONTE_NOTIF = 'Notificações de incidente do NSP (tipo confirmado na triagem) e censo diário';

const seguranca = (
  codigo: string,
  nome: string,
  numerador: string,
  referencia: string,
  fonte = FONTE_NOTIF,
): FichaIndicadorQualidade => ({
  codigo,
  nome,
  formula: `${numerador.split(' na competência')[0]} ÷ pacientes-dia × 1.000`,
  numerador,
  denominador: 'Pacientes-dia do censo diário na competência',
  fator: 1000,
  unidade: 'densidade',
  fonte,
  periodicidade: 'mensal',
  polaridade: 'menor-melhor',
  responsavel: NSP,
  referencia,
  programas: ['anahp', 'ona'],
  origem: 'seguranca',
});

/** M2: as fichas dos indicadores de segurança do paciente (por 1.000 pacientes-dia). */
export const FICHAS_SEGURANCA_PACIENTE: readonly FichaIndicadorQualidade[] = [
  seguranca(
    'taxaQueda',
    'Taxa de queda por 1.000 pacientes-dia',
    'Quedas notificadas que atingiram o paciente na competência',
    `${REF_RDC36}; Protocolo de prevenção de quedas (Ministério da Saúde e Anvisa, 2013)`,
  ),
  seguranca(
    'incidenciaLpp',
    'Incidência de lesão por pressão por 1.000 pacientes-dia',
    'Lesões por pressão adquiridas na internação e notificadas na competência',
    `${REF_RDC36}; Protocolo para prevenção de úlcera por pressão (Ministério da Saúde e Anvisa, 2013)`,
    'Notificações de lesão por pressão do NSP (inclusive as sugeridas pelo registro de feridas) e censo diário',
  ),
  seguranca(
    'taxaErroMedicacao',
    'Taxa de erro de medicação por 1.000 pacientes-dia',
    'Erros de medicação notificados (inclusive os interceptados) na competência',
    `${REF_RDC36}; Protocolo de segurança na prescrição, uso e administração de medicamentos (2013)`,
  ),
  seguranca(
    'taxaFlebite',
    'Taxa de flebite por 1.000 pacientes-dia',
    'Flebites notificadas na competência',
    `${REF_RDC36}; Anvisa, Medidas de prevenção de infecção relacionada à assistência à saúde (2017), cap. de cateter periférico`,
  ),
  seguranca(
    'taxaExtubacaoNaoPlanejada',
    'Taxa de extubação não planejada por 1.000 pacientes-dia',
    'Retiradas acidentais do tubo e ventilação mecânica na competência',
    `${REF_RDC36}; Anvisa, indicadores de segurança em terapia intensiva (RDC 7/2010, art. 47)`,
    'Registro de dispositivos invasivos (retirada acidental do tubo; o mesmo da aba do prontuário) e censo diário',
  ),
];

const DIRETORIA = 'Diretoria clínica e escritório da qualidade';
const REF_LINHA: Readonly<Record<LinhaDeCuidado, string>> = {
  sepse:
    'Instituto Latino-Americano de Sepse (ILAS), protocolo gerenciado de sepse; Ministério da Saúde, sepse no SUS',
  avc: 'Ministério da Saúde, Linha de cuidado do AVC no adulto (Portaria 665/2012) e protocolo clínico de trombólise',
  'dor-toracica':
    'Sociedade Brasileira de Cardiologia, diretriz de síndrome coronariana aguda; Ministério da Saúde, linha de cuidado do IAM',
};

/** M3: as fichas das linhas de cuidado (as duas por protocolo, na ordem do catálogo). */
export function fichasDaLinha(l: {
  readonly tipo: LinhaDeCuidado;
  readonly prefixo: string;
  readonly rotulo: string;
}): FichaIndicadorQualidade[] {
  const comum = {
    fonte: 'Protocolos gerenciados (inclusões, metas e encerramentos registrados no relógio do protocolo)',
    periodicidade: 'mensal' as const,
    responsavel: DIRETORIA,
    referencia: REF_LINHA[l.tipo],
    programas: ['anahp', 'ona'] as const,
    origem: 'linhaCuidado' as const,
  };
  return [
    {
      ...comum,
      codigo: `${l.prefixo}NoAlvo`,
      nome: `${l.rotulo}: pacientes com a meta-chave no alvo`,
      formula: 'Inclusões com a meta-chave cumprida no prazo ÷ inclusões avaliadas × 100',
      numerador: 'Inclusões da competência com a meta-chave cumprida dentro do prazo da definição',
      denominador: 'Inclusões da competência não descartadas cuja definição tem a meta-chave',
      fator: 100,
      unidade: 'percentual',
      polaridade: 'maior-melhor',
    },
    {
      ...comum,
      codigo: `${l.prefixo}Mediana`,
      nome: `${l.rotulo}: mediana do tempo até a meta-chave`,
      formula: 'Mediana dos minutos entre a referência da meta (chegada ou inclusão) e a meta-chave cumprida',
      numerador: 'Mediana, em minutos, dos tempos das metas-chave cumpridas na competência',
      denominador: null,
      fator: 1,
      unidade: 'minutos',
      polaridade: 'menor-melhor',
    },
  ];
}

// ── M2: numeradores ─────────────────────────────────────────────────────────────────────────────────────────────

/** A contagem das notificações da competência por tipo e classificação (sem as descartadas). */
export interface ContagemNotificacoes {
  readonly tipo: TipoIncidente | string;
  readonly classificacao: ClassificacaoOms | string;
  readonly total: number;
}

export interface DispositivoParaSeguranca {
  readonly tipo: string;
  readonly retiradoEm: string | null;
  readonly motivoRetirada: string | null;
  readonly canceladoEm?: string | null;
}

export interface NumeradoresSeguranca {
  readonly taxaQueda: number;
  readonly incidenciaLpp: number;
  readonly taxaErroMedicacao: number;
  readonly taxaFlebite: number;
  readonly taxaExtubacaoNaoPlanejada: number;
}

const ATINGIU: readonly string[] = ['incidenteSemDano', 'eventoAdverso'];

/**
 * Os numeradores da competência. Queda, LPP e flebite contam o que atingiu o paciente (incidente sem dano e evento
 * adverso); o erro de medicação conta também o quase erro (o erro aconteceu e foi interceptado); a circunstância
 * notificável (sem incidente) nunca conta. A extubação não planejada é a retirada acidental do tubo na competência.
 */
export function numeradoresSeguranca(e: {
  readonly competencia: string;
  readonly notificacoes: readonly ContagemNotificacoes[];
  readonly dispositivos: readonly DispositivoParaSeguranca[];
}): NumeradoresSeguranca {
  const soma = (tipo: string, conta: (c: string) => boolean) =>
    e.notificacoes.filter((n) => n.tipo === tipo && conta(n.classificacao)).reduce((t, n) => t + n.total, 0);
  const atingiu = (c: string) => ATINGIU.includes(c);
  return {
    taxaQueda: soma('queda', atingiu),
    incidenciaLpp: soma('lesaoPressao', atingiu),
    taxaErroMedicacao: soma('medicacao', (c) => c !== 'circunstanciaNotificavel'),
    taxaFlebite: soma('flebite', atingiu),
    taxaExtubacaoNaoPlanejada: e.dispositivos.filter(
      (d) =>
        d.tipo === 'ventilacaoMecanica' &&
        d.motivoRetirada === 'acidental' &&
        !d.canceladoEm &&
        d.retiradoEm !== null &&
        d.retiradoEm.slice(0, 7) === e.competencia,
    ).length,
  };
}

// ── M3: linhas de cuidado ───────────────────────────────────────────────────────────────────────────────────────

export interface ProtocoloParaLinha {
  readonly tipo: string;
  readonly gerenciado: number;
  readonly chegadaEm: string;
  readonly incluidoEm: string;
  readonly eventos: readonly {
    readonly tipo: string;
    readonly codigo: string;
    readonly situacao: string;
    readonly quando: string | null;
  }[];
}

export interface ResultadoLinha {
  readonly tipo: LinhaDeCuidado;
  readonly metaChave: string;
  /** Inclusões da competência não descartadas cuja definição tem a meta-chave (denominador do % no alvo). */
  readonly avaliadas: number;
  /** Delas, a meta-chave cumprida dentro do prazo (numerador do % no alvo). */
  readonly noAlvo: number;
  /** Os minutos de cada meta-chave cumprida, em ordem crescente (as parcelas da mediana). */
  readonly tempos: readonly number[];
  readonly mediana: number | null;
  /** Inclusões descartadas (critério não confirmado), fora da conta. */
  readonly descartadas: number;
}

/** A mediana (a média dos dois do meio quando a quantidade é par); nula sem valores. */
export function mediana(valores: readonly number[]): number | null {
  if (valores.length === 0) return null;
  const v = [...valores].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m]! : duasCasas((v[m - 1]! + v[m]!) / 2);
}

/**
 * A linha de cuidado na competência: só as inclusões do tipo, sem as descartadas, cuja versão da definição tem a
 * meta-chave. O tempo é contado da referência da meta (`chegada` ou `inclusao`) até a hora em que foi cumprida; no
 * alvo quando o tempo cabe no prazo da meta. Meta perdida ou sem registro conta no denominador e fica fora do alvo.
 */
export function linhaDeCuidado(e: {
  readonly tipo: LinhaDeCuidado;
  readonly metaChave: string;
  readonly protocolos: readonly ProtocoloParaLinha[];
  readonly definicoes: ReadonlyMap<number, ConteudoGerenciado>;
}): ResultadoLinha {
  let avaliadas = 0;
  let noAlvo = 0;
  let descartadas = 0;
  const tempos: number[] = [];
  for (const p of e.protocolos) {
    if (p.tipo !== e.tipo) continue;
    if (p.eventos.some((x) => x.tipo === 'encerramento' && x.situacao === 'descartado')) {
      descartadas++;
      continue;
    }
    const meta = e.definicoes.get(p.gerenciado)?.metas.find((m) => m.codigo === e.metaChave);
    if (!meta) continue;
    avaliadas++;
    const ev = p.eventos.find((x) => x.tipo === 'meta' && x.codigo === e.metaChave);
    if (!ev || ev.situacao !== 'cumprida' || !ev.quando) continue;
    const desde = meta.desde === 'chegada' ? p.chegadaEm : p.incluidoEm;
    const minutos = Math.max(0, Math.round((msLocal(ev.quando) - msLocal(desde)) / 60_000));
    tempos.push(minutos);
    if (minutos <= meta.prazoMin) noAlvo++;
  }
  tempos.sort((a, b) => a - b);
  return {
    tipo: e.tipo,
    metaChave: e.metaChave,
    avaliadas,
    noAlvo,
    tempos,
    mediana: mediana(tempos),
    descartadas,
  };
}

/** A conta da mediana com as parcelas impressas (ex.: "mediana de 3 tempos (12, 40 e 75 min) = 40 min"). */
export function contaDaMediana(tempos: readonly number[]): string | null {
  const m = mediana(tempos);
  if (m === null) return null;
  const lista = tempos.map((t) => numeroBr(t, 0));
  const texto = lista.length > 1 ? `${lista.slice(0, -1).join(', ')} e ${lista[lista.length - 1]}` : lista[0];
  const n = tempos.length;
  return `mediana de ${n} ${n === 1 ? 'tempo' : 'tempos'} (${texto ?? ''} min) = ${numeroBr(m)} min`;
}

// ── Exportação das parcelas ─────────────────────────────────────────────────────────────────────────────────────

export interface LinhaExportacaoIndicador {
  readonly ficha: Pick<FichaIndicadorQualidade, 'codigo' | 'nome' | 'fator' | 'unidade' | 'fonte' | 'origem'>;
  readonly competencia: string;
  readonly numerador: number | null;
  readonly denominador: number | null;
  readonly valor: number | null;
  readonly conta: string | null;
  readonly meta: number | null;
  readonly situacaoMeta: string;
  readonly parcial: boolean;
}

const celula = (v: string): string => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const numero = (v: number | null, casas = 2): string =>
  v === null ? '' : numeroBr(v, casas).replace(/\./g, '');

/**
 * A planilha das parcelas (CSV com ponto e vírgula, decimal com vírgula, cabeçalho em português): uma linha por
 * indicador e competência, com o numerador, o denominador, o fator, o valor, a conta, a meta e a situação. Nenhum dado
 * de pessoa: só contagens.
 */
export function csvIndicadores(linhas: readonly LinhaExportacaoIndicador[]): string {
  const cab = [
    'codigo',
    'indicador',
    'origem',
    'competencia',
    'numerador',
    'denominador',
    'fator',
    'valor',
    'unidade',
    'conta',
    'meta',
    'situacao',
    'parcial',
    'fonte',
  ];
  const corpo = linhas.map((l) =>
    [
      l.ficha.codigo,
      l.ficha.nome,
      l.ficha.origem,
      l.competencia,
      numero(l.numerador),
      numero(l.denominador),
      numero(l.ficha.fator, 0),
      numero(l.valor),
      l.ficha.unidade,
      l.conta ?? '',
      numero(l.meta),
      l.situacaoMeta,
      l.parcial ? 'sim' : 'nao',
      l.ficha.fonte,
    ]
      .map(celula)
      .join(';'),
  );
  return `${[cab.join(';'), ...corpo].join('\r\n')}\r\n`;
}
