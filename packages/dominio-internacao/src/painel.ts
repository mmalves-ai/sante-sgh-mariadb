// Painel de leitos ao vivo (M16; regras 1, 4 e 16): a grade por bloco e acomodação com livre, ocupado e inativo.
// Ocupado = o leito marca uma internação (como o legado), conferido com as internações em aberto: a diferença vira
// AVISO, nunca correção silenciosa. O cartão leva só iniciais, idade, sexo, dias de internação e convênio; a
// terapia intensiva sai destacada pelo tipo do trecho em curso (e, sem trecho, pelo tipo da acomodação).
import type {
  AvisoOcupacao,
  CartaoPaciente,
  InternacaoAbertaLida,
  LeiturasPainel,
  LeitoPainel,
  PainelLeitos,
  SituacaoLeito,
} from '@sgh/contratos';
import { DIA, diaDoInstante, idadeEm, instante } from './tempo.js';

const chave = (bloco: string, acomodacao: string, leito?: string) =>
  leito === undefined
    ? `${bloco.trimEnd()}/${acomodacao.trimEnd()}`
    : `${bloco.trimEnd()}/${acomodacao.trimEnd()}/${leito.trimEnd()}`;

/** Situação do cadastro do leito: 'I' inativo; vazio ou 'A' ativo. */
export function leitoAtivoPainel(status: string | null | undefined): boolean {
  return (status ?? '').trim() !== 'I';
}

interface Totais {
  leitos: number;
  ativos: number;
  inativos: number;
  ocupados: number;
  livres: number;
}

const zero = (): Totais => ({ leitos: 0, ativos: 0, inativos: 0, ocupados: 0, livres: 0 });

function contar(t: Totais, s: SituacaoLeito): void {
  t.leitos++;
  if (s === 'inativo') t.inativos++;
  else {
    t.ativos++;
    if (s === 'ocupado') t.ocupados++;
    else t.livres++;
  }
}

function somarTotais(a: Totais, b: Totais): void {
  a.leitos += b.leitos;
  a.ativos += b.ativos;
  a.inativos += b.inativos;
  a.ocupados += b.ocupados;
  a.livres += b.livres;
}

export interface OpcoesPainel {
  readonly intensivas: readonly number[];
  /** Agora no relógio de parede (ms). */
  readonly agora: number;
  readonly lidoEm: string;
  readonly dadosAte: string;
  readonly destino: 'banco' | 'memoria';
}

function cartao(
  i: InternacaoAbertaLida,
  tipos: ReadonlyMap<number, string>,
  tipoAcomodacao: number | null,
  intensivas: ReadonlySet<number>,
  agora: number,
): CartaoPaciente {
  const tipo = i.tipoTrecho ?? tipoAcomodacao;
  const hoje = new Date(diaDoInstante(agora) * DIA);
  const sexo = (i.sexo ?? '').trim().toUpperCase();
  return {
    internacao: i.reg,
    iniciais: i.iniciais.slice(0, 8),
    idade: idadeEm(i.nascimento, hoje),
    sexo: sexo === 'M' || sexo === 'F' ? sexo : null,
    diasInternacao: Math.max(0, diaDoInstante(agora) - diaDoInstante(instante(i.entrada, null))),
    convenio: i.convenio?.trim() || null,
    tipoTrecho: tipo === null ? null : { id: tipo, nome: tipos.get(tipo) ?? `Tipo ${tipo}` },
    intensivo: tipo !== null && intensivas.has(tipo),
  };
}

/** Monta o painel a partir das leituras ao vivo. */
export function montarPainel(l: LeiturasPainel, op: OpcoesPainel): PainelLeitos {
  const intensivas = new Set(op.intensivas);
  const abertas = new Map(l.abertas.map((i) => [i.reg, i]));
  const avisos: AvisoOcupacao[] = [];
  const regsNosLeitos = new Set<number>();
  const acomodacoes = new Map(l.acomodacoes.map((a) => [chave(a.bloco, a.acomodacao), a]));
  const blocos = new Map<string, PainelLeitos['blocos'][number] & { totais: Totais }>();
  const nomesBloco = new Map(l.blocos.map((b) => [b.bloco.trimEnd(), b.nome]));
  const geral = zero();
  const intensivos = zero();

  for (const b of l.blocos)
    blocos.set(b.bloco.trimEnd(), {
      bloco: b.bloco.trimEnd(),
      nome: b.nome,
      totais: zero(),
      acomodacoes: [],
    });

  const leitosOrdenados = [...l.leitos].sort(
    (a, b) =>
      a.bloco.localeCompare(b.bloco) ||
      a.acomodacao.localeCompare(b.acomodacao) ||
      a.leito.localeCompare(b.leito),
  );
  for (const x of leitosOrdenados) {
    const bk = x.bloco.trimEnd();
    const ak = chave(x.bloco, x.acomodacao);
    let bloco = blocos.get(bk);
    if (!bloco) {
      bloco = { bloco: bk, nome: nomesBloco.get(bk) ?? bk, totais: zero(), acomodacoes: [] };
      blocos.set(bk, bloco);
    }
    let ac = bloco.acomodacoes.find((a) => a.acomodacao === x.acomodacao.trimEnd());
    if (!ac) {
      const cad = acomodacoes.get(ak);
      const tipo = cad?.tipo ?? null;
      ac = {
        acomodacao: x.acomodacao.trimEnd(),
        nome: cad?.nome ?? x.acomodacao.trimEnd(),
        tipo: tipo === null ? null : { id: tipo, nome: l.tipos.get(tipo) ?? `Tipo ${tipo}` },
        intensiva: tipo !== null && intensivas.has(tipo),
        totais: zero(),
        leitos: [],
      };
      bloco.acomodacoes.push(ac);
    }
    const ativo = leitoAtivoPainel(x.status);
    const ocupado = x.reg > 0;
    const k = chave(x.bloco, x.acomodacao, x.leito);
    if (ocupado) regsNosLeitos.add(x.reg);
    const internacao = ocupado ? abertas.get(x.reg) : undefined;
    if (ocupado && !ativo)
      avisos.push({
        tipo: 'leito-inativo-ocupado',
        chave: k,
        mensagem: 'Leito inativo marcado como ocupado: confirme a situação do leito.',
      });
    if (ocupado && !internacao)
      avisos.push({
        tipo: 'leito-ocupado-sem-internacao',
        chave: k,
        mensagem: 'Leito marcado como ocupado sem internação em aberto: confirme a alta ou a transferência.',
      });
    if (internacao && chave(internacao.bloco, internacao.acomodacao, internacao.leito) !== k)
      avisos.push({
        tipo: 'leito-com-outra-internacao',
        chave: k,
        mensagem: 'O leito marca uma internação que está registrada em outro leito: confira a transferência.',
      });
    const situacao: SituacaoLeito = !ativo && !ocupado ? 'inativo' : ocupado ? 'ocupado' : 'livre';
    const leito: LeitoPainel = {
      id: x.id,
      leito: x.leito.trimEnd(),
      situacao,
      ramal: x.ramal,
      cartao: internacao ? cartao(internacao, l.tipos, ac.tipo?.id ?? null, intensivas, op.agora) : null,
    };
    (ac.leitos as LeitoPainel[]).push(leito);
    contar(ac.totais as Totais, situacao);
  }
  for (const i of l.abertas)
    if (!regsNosLeitos.has(i.reg))
      avisos.push({
        tipo: 'internacao-sem-leito-ocupado',
        chave: String(i.reg),
        mensagem: 'Internação em aberto sem leito marcado como ocupado: confira o leito da internação.',
      });

  const lista = [...blocos.values()].filter((b) => b.acomodacoes.length > 0);
  for (const b of lista) {
    for (const a of b.acomodacoes) {
      somarTotais(b.totais, a.totais as Totais);
      if (a.intensiva) somarTotais(intensivos, a.totais as Totais);
    }
    somarTotais(geral, b.totais);
  }
  return {
    lidoEm: op.lidoEm,
    dadosAte: op.dadosAte,
    destino: op.destino,
    totais: {
      ...geral,
      ocupacao: geral.ativos > 0 ? Math.round((geral.ocupados / geral.ativos) * 1000) / 10 : null,
      intensivos,
    },
    blocos: lista,
    avisos,
  };
}
