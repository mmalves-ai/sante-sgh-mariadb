// Conferência do item da prescrição antes de gravar, por tipo (03-PEP L105): o que a tela já valida na hora e o
// servidor repete. Regra pura, sem banco: a porta própria só traduz a recusa em 422. Ventilação, dieta, solução em
// etapas e "se necessário" têm aqui a sua coerência clínica mínima; o cadastro (existência dos ids) é do adaptador.

export type DetalheGravavel =
  | {
      readonly tipo: 'medicamento';
      readonly dose: number;
      readonly seNecessario: readonly number[];
    }
  | {
      readonly tipo: 'dieta';
      readonly quantidade: number;
      readonly velocidade: number | null;
      readonly unidadeInfusao: number | null;
      readonly caracteristicas: readonly { readonly caracteristica: number; readonly resposta: string }[];
    }
  | {
      readonly tipo: 'solucao';
      readonly componentes: readonly {
        readonly dose: number;
        readonly principal: boolean;
        readonly etapa: number;
      }[];
      readonly etapas: readonly {
        readonly etapa: number;
        readonly inicio: string;
        readonly fim: string;
        readonly velocidade: number;
        readonly volume: number;
      }[];
    }
  | {
      readonly tipo: 'vmi';
      readonly frequenciaRespiratoria: number;
      readonly peep: number;
      readonly volumeCorrente: number;
      readonly fio2: number | null;
    }
  | { readonly tipo: 'vni'; readonly fio2: number | null }
  | { readonly tipo: string };

export type RecusaItemGravavel =
  | 'dose-invalida'
  | 'se-necessario-repetido'
  | 'dieta-quantidade-invalida'
  | 'dieta-velocidade-sem-unidade'
  | 'dieta-caracteristica-repetida'
  | 'solucao-sem-principal'
  | 'solucao-etapa-repetida'
  | 'solucao-componente-sem-etapa'
  | 'solucao-etapa-sem-componente'
  | 'solucao-etapa-fim-antes-inicio'
  | 'solucao-etapa-invalida'
  | 'ventilacao-fio2-fora-da-faixa'
  | 'ventilacao-parametro-invalido';

export const MENSAGENS_ITEM_GRAVAVEL: Readonly<Record<RecusaItemGravavel, string>> = {
  'dose-invalida': 'A dose do medicamento tem de ser maior que zero.',
  'se-necessario-repetido': 'A mesma condição de "se necessário" foi informada duas vezes.',
  'dieta-quantidade-invalida': 'A quantidade da dieta tem de ser maior que zero.',
  'dieta-velocidade-sem-unidade': 'Informe a unidade da velocidade de infusão da dieta.',
  'dieta-caracteristica-repetida': 'A mesma característica da dieta foi informada duas vezes.',
  'solucao-sem-principal': 'A solução precisa de um componente principal (a base, como o soro).',
  'solucao-etapa-repetida': 'O número da etapa da solução se repete.',
  'solucao-componente-sem-etapa': 'Há componente ligado a uma etapa que não foi descrita.',
  'solucao-etapa-sem-componente': 'Há etapa da solução sem nenhum componente.',
  'solucao-etapa-fim-antes-inicio': 'O fim da etapa tem de ser depois do início.',
  'solucao-etapa-invalida': 'Volume, velocidade e dose de cada etapa têm de ser maiores que zero.',
  'ventilacao-fio2-fora-da-faixa': 'A fração inspirada de oxigênio vai de 21% a 100%.',
  'ventilacao-parametro-invalido': 'Frequência, PEEP e volume corrente fora da faixa clínica.',
};

const repetido = (xs: readonly number[]) => new Set(xs).size !== xs.length;
const fio2Ok = (f: number | null) => f === null || (f >= 21 && f <= 100);

/** A primeira incoerência do item (ou null). Datas das etapas em AAAA-MM-DDTHH:MM civil, comparáveis como texto. */
export function conferirItemGravavel(d: DetalheGravavel): RecusaItemGravavel | null {
  switch (d.tipo) {
    case 'medicamento': {
      const m = d as Extract<DetalheGravavel, { tipo: 'medicamento' }>;
      if (!(m.dose > 0)) return 'dose-invalida';
      if (repetido(m.seNecessario)) return 'se-necessario-repetido';
      return null;
    }
    case 'dieta': {
      const x = d as Extract<DetalheGravavel, { tipo: 'dieta' }>;
      if (!(x.quantidade > 0)) return 'dieta-quantidade-invalida';
      if (x.velocidade !== null && x.unidadeInfusao === null) return 'dieta-velocidade-sem-unidade';
      if (repetido(x.caracteristicas.map((c) => c.caracteristica))) return 'dieta-caracteristica-repetida';
      return null;
    }
    case 'solucao': {
      const s = d as Extract<DetalheGravavel, { tipo: 'solucao' }>;
      if (!s.componentes.some((c) => c.principal)) return 'solucao-sem-principal';
      const numeros = s.etapas.map((e) => e.etapa);
      if (repetido(numeros)) return 'solucao-etapa-repetida';
      if (s.componentes.some((c) => !numeros.includes(c.etapa))) return 'solucao-componente-sem-etapa';
      if (numeros.some((n) => !s.componentes.some((c) => c.etapa === n)))
        return 'solucao-etapa-sem-componente';
      if (s.etapas.some((e) => !(e.fim > e.inicio))) return 'solucao-etapa-fim-antes-inicio';
      if (
        s.etapas.some((e) => !(e.volume > 0 && e.velocidade > 0)) ||
        s.componentes.some((c) => !(c.dose > 0))
      )
        return 'solucao-etapa-invalida';
      return null;
    }
    case 'vmi': {
      const v = d as Extract<DetalheGravavel, { tipo: 'vmi' }>;
      if (!fio2Ok(v.fio2)) return 'ventilacao-fio2-fora-da-faixa';
      if (v.frequenciaRespiratoria > 150 || v.peep > 50 || !(v.volumeCorrente > 0))
        return 'ventilacao-parametro-invalido';
      return null;
    }
    case 'vni':
      return fio2Ok((d as Extract<DetalheGravavel, { tipo: 'vni' }>).fio2)
        ? null
        : 'ventilacao-fio2-fora-da-faixa';
    default:
      return null;
  }
}
