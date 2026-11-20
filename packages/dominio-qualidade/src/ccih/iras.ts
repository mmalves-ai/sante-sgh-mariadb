// Ficha de IRAS (cap-05b §5.11; Anvisa, Critérios diagnósticos de infecção relacionada à assistência à saúde): os
// critérios mínimos de cada sítio, a infecção a partir do 3º dia de internação (antes disso é comunitária, salvo a ISC,
// que pode aparecer até 30 dias depois da cirurgia, 90 com implante) e a associação ao dispositivo (instalado há mais
// de 2 dias no dia do evento, e instalado nesse dia ou retirado na véspera).
import type { CriterioIras, DispositivoInvasivoLido, SitioIras } from '@sgh/contratos';
import { SITIOS_IRAS } from '@sgh/contratos';
import { diferencaDias, diaDe } from './tempo.js';

type Regra = {
  /** Todos estes. */
  readonly todos?: readonly CriterioIras[];
  /** Pelo menos `minimo` de cada grupo. */
  readonly grupos?: readonly { readonly de: readonly CriterioIras[]; readonly minimo: number }[];
  /** Alternativa completa (vale se a principal não fechar). */
  readonly ou?: Regra;
};

const SISTEMICOS_PULMAO: readonly CriterioIras[] = ['febre', 'leucopeniaLeucocitose', 'alteracaoMental'];
const PULMONARES: readonly CriterioIras[] = [
  'secrecaoPurulenta',
  'tosseDispneia',
  'estertores',
  'pioraTrocaGasosa',
];
const PNEUMONIA: Regra = {
  todos: ['imagemPulmonar'],
  grupos: [
    { de: SISTEMICOS_PULMAO, minimo: 1 },
    { de: PULMONARES, minimo: 2 },
  ],
};
const ISC: readonly CriterioIras[] = [
  'drenagemPurulenta',
  'culturaSitio',
  'deiscenciaComSinal',
  'abscessoImagem',
  'diagnosticoMedico',
];

/** O mínimo de cada sítio. */
export const REGRAS_IRAS: Readonly<Record<SitioIras, Regra>> = {
  ipcs: {
    todos: ['hemoculturaPatogeno'],
    ou: {
      todos: ['comensalDuasAmostras'],
      grupos: [{ de: ['febre', 'calafrios', 'hipotensao'], minimo: 1 }],
    },
  },
  pav: PNEUMONIA,
  pneumonia: PNEUMONIA,
  itu: {
    todos: ['uroculturaPositiva'],
    grupos: [{ de: ['febre', 'dorSuprapubica', 'dorLombar', 'disuriaUrgencia'], minimo: 1 }],
  },
  isc: { grupos: [{ de: ISC, minimo: 1 }] },
  outra: { todos: ['diagnosticoMedico'] },
};

function criteriosDa(r: Regra): Set<CriterioIras> {
  const s = new Set<CriterioIras>([...(r.todos ?? []), ...(r.grupos ?? []).flatMap((g) => g.de)]);
  if (r.ou) for (const c of criteriosDa(r.ou)) s.add(c);
  return s;
}

function fecha(r: Regra, marcados: ReadonlySet<CriterioIras>): boolean {
  const principal =
    (r.todos ?? []).every((c) => marcados.has(c)) &&
    (r.grupos ?? []).every((g) => g.de.filter((c) => marcados.has(c)).length >= g.minimo);
  return principal || (r.ou !== undefined && fecha(r.ou, marcados));
}

/** Os critérios marcados fecham o sítio, e nenhum é de outro sítio. */
export function conferirCriterios(
  sitio: SitioIras,
  criterios: readonly CriterioIras[],
): 'criterio-de-outro-sitio' | 'criterios-insuficientes' | null {
  const regra = REGRAS_IRAS[sitio];
  const validos = criteriosDa(regra);
  if (criterios.some((c) => !validos.has(c))) return 'criterio-de-outro-sitio';
  return fecha(regra, new Set(criterios)) ? null : 'criterios-insuficientes';
}

/** Janela da ISC: até 30 dias da cirurgia (90 com implante), nunca antes dela. */
export function conferirJanelaIsc(
  dataCirurgia: string,
  dataInfeccao: string,
  implante: boolean,
): 'antes-da-cirurgia' | 'fora-da-janela-isc' | null {
  const d = diferencaDias(dataCirurgia, dataInfeccao);
  if (d < 0) return 'antes-da-cirurgia';
  return d > (implante ? 90 : 30) ? 'fora-da-janela-isc' : null;
}

/**
 * A data da infecção: não no futuro e, salvo a ISC, a partir do 3º dia da internação (dia da entrada = dia 1;
 * antes disso a infecção é comunitária e não entra na vigilância de IRAS).
 */
export function conferirDataInfeccao(
  sitio: SitioIras,
  dataInfeccao: string,
  entrada: string,
  hoje: string,
): 'data-futura' | 'antes-do-terceiro-dia' | null {
  if (diferencaDias(hoje, dataInfeccao) > 0) return 'data-futura';
  if (sitio !== 'isc' && diferencaDias(entrada, dataInfeccao) < 2) return 'antes-do-terceiro-dia';
  return null;
}

/**
 * O dispositivo a que a IRAS se associa (ipcs → CVC, pav → VM, itu → SVD): instalado há mais de 2 dias no dia do
 * evento (o dia da inserção é o dia 1; o evento no dia 3 ou depois) e instalado nesse dia ou retirado na véspera.
 * Entre vários, o de inserção mais antiga. Null para os sítios sem dispositivo ou quando nenhum fecha.
 */
export function dispositivoAssociado(
  sitio: SitioIras,
  dispositivos: readonly Pick<DispositivoInvasivoLido, 'id' | 'tipo' | 'inseridoEm' | 'retiradoEm'>[],
  dataInfeccao: string,
): number | null {
  const tipo = SITIOS_IRAS.find((s) => s.codigo === sitio)?.dispositivo ?? null;
  if (tipo === null) return null;
  const candidatos = dispositivos
    .filter(
      (d) =>
        d.tipo === tipo &&
        diferencaDias(d.inseridoEm, dataInfeccao) >= 2 &&
        (d.retiradoEm === null || diferencaDias(diaDe(d.retiradoEm), dataInfeccao) <= 1),
    )
    .sort((a, b) => a.inseridoEm.localeCompare(b.inseridoEm));
  return candidatos[0]?.id ?? null;
}
