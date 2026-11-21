// Conferência dos dois modelos de leito (ficha do M10, regra 13; cap-06a §6.1, "Atenção"; cap-10 §10.2): o
// cadastro que o novo grava (blocos, acomodações e leitos) e o espelho que os triggers do legado mantêm
// (acomodação × leito e leito). O novo nunca grava o espelho; a conferência mostra, leito a leito pela chave
// textual bloco + acomodação + leito, onde os dois discordam, para a enfermagem e a hotelaria sanearem pela
// tela de cadastro (vale para os dois sistemas). Leito do espelho de atendimento externo (TP_ATENDIMENTO 'E')
// não tem par no cadastro de internação: é contado à parte, não é divergência.
import { chaveAcomodacao, chaveLeito } from './hierarquia.js';

export interface LeitoCadastro {
  readonly bloco: string;
  readonly acomodacao: string;
  readonly leito: string;
  /** Situação do leito 'A' (ou vazio, que o legado trata como ativo). */
  readonly ativo: boolean;
  readonly ramal: number | null;
}

export interface LeitoEspelho {
  readonly bloco: string | null;
  readonly acomodacao: string;
  readonly leito: string;
  /** Tipo de atendimento do espelho: 'I' internação (espelho do cadastro de leitos) ou 'E' externo. */
  readonly tipoAtendimento: 'I' | 'E';
  readonly ativo: boolean;
  readonly ramal: number | null;
}

export interface AcomodacaoCadastro {
  readonly bloco: string;
  readonly acomodacao: string;
  readonly nome: string;
}

export interface AcomodacaoEspelho {
  readonly bloco: string | null;
  readonly acomodacao: string;
  readonly tipoAtendimento: 'I' | 'E';
  readonly nome: string;
}

export type TipoDivergencia =
  | 'leito-sem-espelho'
  | 'espelho-sem-leito'
  | 'situacao-diferente'
  | 'ramal-diferente'
  | 'acomodacao-sem-espelho'
  | 'espelho-sem-acomodacao'
  | 'nome-diferente';

export interface Divergencia {
  readonly tipo: TipoDivergencia;
  readonly chave: string;
  /** O que fazer, em texto de produto (sem citar o sistema antigo). */
  readonly orientacao: string;
}

export interface ResultadoConferencia {
  readonly divergencias: readonly Divergencia[];
  readonly contagens: {
    readonly leitosCadastro: number;
    readonly leitosEspelho: number;
    readonly leitosEspelhoExterno: number;
    readonly acomodacoesCadastro: number;
    readonly acomodacoesEspelho: number;
    readonly acomodacoesEspelhoExterno: number;
    readonly iguais: number;
  };
  readonly porTipo: Readonly<Record<TipoDivergencia, number>>;
}

const ORIENTACAO: Readonly<Record<TipoDivergencia, string>> = {
  'leito-sem-espelho':
    'Leito do cadastro sem o registro de conferência: altere e salve o leito para o registro ser refeito.',
  'espelho-sem-leito':
    'Registro de conferência sem leito no cadastro: inclua o leito no cadastro ou confirme que ele foi desativado.',
  'situacao-diferente':
    'Situação diferente entre o cadastro e a conferência: confirme a situação do leito e salve de novo.',
  'ramal-diferente': 'Ramal diferente: confirme o ramal do leito e salve de novo.',
  'acomodacao-sem-espelho':
    'Acomodação do cadastro sem o registro de conferência: altere e salve a acomodação.',
  'espelho-sem-acomodacao':
    'Registro de conferência de acomodação sem acomodação no cadastro: inclua a acomodação no cadastro.',
  'nome-diferente': 'Nome da acomodação diferente: confirme o nome e salve de novo.',
};

const TIPOS: readonly TipoDivergencia[] = Object.keys(ORIENTACAO) as TipoDivergencia[];

const div = (tipo: TipoDivergencia, chave: string): Divergencia => ({
  tipo,
  chave,
  orientacao: ORIENTACAO[tipo],
});

/** Compara o cadastro com o espelho (só a parte de internação do espelho). */
export function conferirLeitos(
  cadastro: {
    readonly acomodacoes: readonly AcomodacaoCadastro[];
    readonly leitos: readonly LeitoCadastro[];
  },
  espelho: { readonly acomodacoes: readonly AcomodacaoEspelho[]; readonly leitos: readonly LeitoEspelho[] },
): ResultadoConferencia {
  const divergencias: Divergencia[] = [];
  const leitosI = espelho.leitos.filter((l) => l.tipoAtendimento === 'I' && l.bloco !== null);
  const acsI = espelho.acomodacoes.filter((a) => a.tipoAtendimento === 'I' && a.bloco !== null);
  const espelhoPorChave = new Map(
    leitosI.map((l) => [chaveLeito(l.bloco ?? '', l.acomodacao, l.leito), l] as const),
  );
  let iguais = 0;
  const vistas = new Set<string>();
  for (const l of cadastro.leitos) {
    const k = chaveLeito(l.bloco, l.acomodacao, l.leito);
    vistas.add(k);
    const e = espelhoPorChave.get(k);
    if (!e) {
      divergencias.push(div('leito-sem-espelho', k));
      continue;
    }
    let igual = true;
    if (e.ativo !== l.ativo) {
      divergencias.push(div('situacao-diferente', k));
      igual = false;
    }
    if ((e.ramal ?? 0) !== (l.ramal ?? 0)) {
      divergencias.push(div('ramal-diferente', k));
      igual = false;
    }
    if (igual) iguais++;
  }
  for (const k of espelhoPorChave.keys()) if (!vistas.has(k)) divergencias.push(div('espelho-sem-leito', k));
  const acEspelho = new Map(acsI.map((a) => [chaveAcomodacao(a.bloco ?? '', a.acomodacao), a] as const));
  const acVistas = new Set<string>();
  for (const a of cadastro.acomodacoes) {
    const k = chaveAcomodacao(a.bloco, a.acomodacao);
    acVistas.add(k);
    const e = acEspelho.get(k);
    if (!e) divergencias.push(div('acomodacao-sem-espelho', k));
    else if (e.nome.trim() !== a.nome.trim()) divergencias.push(div('nome-diferente', k));
  }
  for (const k of acEspelho.keys()) if (!acVistas.has(k)) divergencias.push(div('espelho-sem-acomodacao', k));
  const porTipo = Object.fromEntries(
    TIPOS.map((t) => [t, divergencias.filter((d) => d.tipo === t).length]),
  ) as Record<TipoDivergencia, number>;
  return {
    divergencias: divergencias.sort((a, b) => a.chave.localeCompare(b.chave) || a.tipo.localeCompare(b.tipo)),
    contagens: {
      leitosCadastro: cadastro.leitos.length,
      leitosEspelho: leitosI.length,
      leitosEspelhoExterno: espelho.leitos.length - leitosI.length,
      acomodacoesCadastro: cadastro.acomodacoes.length,
      acomodacoesEspelho: acsI.length,
      acomodacoesEspelhoExterno: espelho.acomodacoes.length - acsI.length,
      iguais,
    },
    porTipo,
  };
}

/** Situação do leito: 'A' ativo, 'I' inativo; vazio conta como ativo (como o trigger do espelho trata). */
export function leitoAtivo(status: string | null | undefined): boolean {
  return (status ?? '').trim() !== 'I';
}
