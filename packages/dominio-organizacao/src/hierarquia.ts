// Hierarquia da estrutura (ficha do M10, seção 7; cap-06a §6.1): empresa → hospital → unidades e, no cadastro de
// internação, blocos → acomodações → leitos. Os dois lados são montados a partir de listas planas lidas do
// legado, sem banco. Chaves naturais do leito (regra 16): bloco (até 5), acomodação (até 6) e leito (até 5),
// texto exato; código em uso não muda (o legado recusa: e_geral_valor_chave) — para trocar, inativar e criar.

export interface UnidadeLida {
  readonly codigo: number;
  readonly nome: string;
  readonly cnes: number | null;
  readonly ativa: boolean;
}

export interface EstruturaLida {
  readonly empresa: { readonly codigo: number; readonly nome: string; readonly ativa: boolean } | null;
  readonly hospital: { readonly codigo: number; readonly nome: string; readonly cnes: number | null } | null;
  readonly unidades: readonly UnidadeLida[];
}

export interface NoEstrutura {
  readonly tipo: 'empresa' | 'hospital' | 'unidade';
  readonly codigo: string;
  readonly nome: string;
  readonly ativo: boolean;
  readonly cnes: number | null;
  readonly filhos: readonly NoEstrutura[];
}

/** Árvore empresa → hospital → unidades (o legado tem uma empresa e um hospital por banco). */
export function arvoreDaEstrutura(e: EstruturaLida): NoEstrutura[] {
  const unidades: NoEstrutura[] = [...e.unidades]
    .sort((a, b) => a.codigo - b.codigo)
    .map((u) => ({
      tipo: 'unidade',
      codigo: String(u.codigo),
      nome: u.nome,
      ativo: u.ativa,
      cnes: u.cnes && u.cnes > 0 ? u.cnes : null,
      filhos: [],
    }));
  const hospital: NoEstrutura | null = e.hospital
    ? {
        tipo: 'hospital',
        codigo: String(e.hospital.codigo),
        nome: e.hospital.nome,
        ativo: true,
        cnes: e.hospital.cnes && e.hospital.cnes > 0 ? e.hospital.cnes : null,
        filhos: unidades,
      }
    : null;
  if (!e.empresa) return hospital ? [hospital] : unidades;
  return [
    {
      tipo: 'empresa',
      codigo: String(e.empresa.codigo),
      nome: e.empresa.nome,
      ativo: e.empresa.ativa,
      cnes: null,
      filhos: hospital ? [hospital] : unidades,
    },
  ];
}

export interface BlocoLido {
  readonly bloco: string;
  readonly nome: string;
  readonly andares: number | null;
}

export interface AcomodacaoLida {
  readonly bloco: string;
  readonly acomodacao: string;
  readonly nome: string;
  readonly leitosPrevistos: number | null;
  readonly clinica: string | null;
  readonly centroCusto: number | null;
}

export interface LeitoLido {
  readonly id: number;
  readonly bloco: string;
  readonly acomodacao: string;
  readonly leito: string;
  readonly ativo: boolean;
  /** Ocupação (RILEITOS.REG > 0): só leitura no cadastro (regra 14). */
  readonly ocupado: boolean;
  readonly ramal: number | null;
}

export interface NoAcomodacao extends AcomodacaoLida {
  readonly leitos: readonly LeitoLido[];
  readonly ativos: number;
  readonly ocupados: number;
}

export interface NoBloco extends BlocoLido {
  readonly acomodacoes: readonly NoAcomodacao[];
  readonly ativos: number;
  readonly ocupados: number;
}

export interface ArvoreLeitos {
  readonly blocos: readonly NoBloco[];
  /** Leitos cuja acomodação (bloco + acomodação) não existe: aparecem à parte para saneamento. */
  readonly orfaos: readonly LeitoLido[];
  readonly totais: { readonly leitos: number; readonly ativos: number; readonly ocupados: number };
}

const porTexto = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { numeric: true });

/** Chave textual do leito (bloco + acomodação + leito), como o espelho a usa. */
export function chaveLeito(bloco: string, acomodacao: string, leito: string): string {
  return `${bloco.trimEnd()}|${acomodacao.trimEnd()}|${leito.trimEnd()}`;
}

export function chaveAcomodacao(bloco: string, acomodacao: string): string {
  return `${bloco.trimEnd()}|${acomodacao.trimEnd()}`;
}

/** Monta blocos → acomodações → leitos, com os totais de ativos e ocupados. */
export function arvoreDeLeitos(
  blocos: readonly BlocoLido[],
  acomodacoes: readonly AcomodacaoLida[],
  leitos: readonly LeitoLido[],
): ArvoreLeitos {
  const leitosPorAcomodacao = new Map<string, LeitoLido[]>();
  for (const l of leitos) {
    const k = chaveAcomodacao(l.bloco, l.acomodacao);
    leitosPorAcomodacao.set(k, [...(leitosPorAcomodacao.get(k) ?? []), l]);
  }
  const usadas = new Set<string>();
  const nos: NoBloco[] = [...blocos]
    .sort((a, b) => porTexto(a.bloco, b.bloco))
    .map((b) => {
      const acs: NoAcomodacao[] = acomodacoes
        .filter((a) => a.bloco.trimEnd() === b.bloco.trimEnd())
        .sort((x, y) => porTexto(x.acomodacao, y.acomodacao))
        .map((a) => {
          const k = chaveAcomodacao(a.bloco, a.acomodacao);
          usadas.add(k);
          const ls = [...(leitosPorAcomodacao.get(k) ?? [])].sort((x, y) => porTexto(x.leito, y.leito));
          return {
            ...a,
            leitos: ls,
            ativos: ls.filter((l) => l.ativo).length,
            ocupados: ls.filter((l) => l.ocupado).length,
          };
        });
      return {
        ...b,
        acomodacoes: acs,
        ativos: acs.reduce((s, a) => s + a.ativos, 0),
        ocupados: acs.reduce((s, a) => s + a.ocupados, 0),
      };
    });
  const orfaos = leitos.filter((l) => !usadas.has(chaveAcomodacao(l.bloco, l.acomodacao)));
  return {
    blocos: nos,
    orfaos,
    totais: {
      leitos: leitos.length,
      ativos: leitos.filter((l) => l.ativo).length,
      ocupados: leitos.filter((l) => l.ocupado).length,
    },
  };
}

export type FalhaChave = 'vazio' | 'longo' | 'espacos' | 'caractere';

const CARACTERE_CHAVE = /^[A-Za-z0-9 ._/-]+$/;

/** Confere a chave textual digitada (bloco 5, acomodação 6, leito 5 bytes; sem espaços nas pontas). */
export function conferirChave(valor: string, maximo: number): FalhaChave | null {
  if (valor === '') return 'vazio';
  if (valor.length > maximo) return 'longo';
  if (valor.trim() !== valor) return 'espacos';
  if (!CARACTERE_CHAVE.test(valor)) return 'caractere';
  return null;
}

/**
 * Código em uso não muda (regra 16): a alteração que tenta trocar a chave é recusada antes do banco, com a
 * orientação de inativar e criar outro.
 */
export function mudaChave(
  antes: Readonly<Record<string, unknown>>,
  depois: Readonly<Record<string, unknown>>,
  chaves: readonly string[],
): string[] {
  return chaves.filter((c) => c in depois && String(depois[c] ?? '') !== String(antes[c] ?? ''));
}
