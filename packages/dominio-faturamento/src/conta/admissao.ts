// F3.0 (motores, família conta-admissao): a conta que nasce na entrada do paciente e o lançamento automático de diárias
// e taxas, como regras puras (sem banco). A persistência lê a configuração (regra_diaria, regra_lancamento e
// regra_lancamento_item), os trechos de ocupação e os lançamentos automáticos vigentes, chama `apurarLancamentos` e grava
// o que a apuração devolve, na mesma transação da operação que a disparou (internar, transferir, dar alta, abrir o
// atendimento ou a apuração diária).
//
// Regras (decisões de modelo; a referência de recurso é a prática de mercado das contas hospitalares, ANS/TISS):
// - A natureza da conta sai do tipo base da categoria do atendimento; o tipo de conta é o único ativo da natureza ou, com
//   mais de um, o de menor `ordem` quando ele é único (empate é recusa, nunca "o primeiro por id").
// - A competência é o mês da entrada no fuso do estabelecimento (primeiro dia do mês).
// - Diária por dia de corte: o dia da entrada sempre gera a primeira diária; cada dia seguinte gera uma diária quando o
//   paciente ainda está internado na hora de virada da regra (mais a tolerância). A acomodação cobrada é a ocupada nesse
//   instante (na entrada, a da entrada). A virada de cada dia é a da regra que valeu no dia anterior.
// - A regra de diária vence pela especificidade (plano > fonte pagadora > modalidade > faixa etária) e depois pela menor
//   prioridade; empate é "regra ambígua" (o dia fica sem diária e volta na lista de pendências da apuração).
//   Regra por faixa etária que não substitui a geral soma uma diária adicional; a do acompanhante só vale com
//   acompanhante na internação.
// - Taxas: regra_lancamento ativa, vigente, de ação "incluir" e sem confirmação do faturista. Gatilho
//   "abertura_atendimento": uma vez, no dia da entrada, se o item vale para a natureza da conta; gatilho
//   "diaria_internacao": junto de cada diária (ou só da primeira, quando a regra lança uma vez por conta).
// - Idempotência: cada lançamento automático tem chave (o que é) e dia de referência; a apuração compara o desejado com o
//   vigente e só lança o que falta e estorna o que deixou de valer. A mesma apuração repetida não muda nada.
// - Estorno: o lançamento vigente cujo dia continua devido mas com outro item ou outra acomodação é estornado
//   ("troca_acomodacao" ou "regra_alterada") e o novo é lançado; o dia que deixou de ser devido é estornado ("alta"
//   quando a contagem foi fechada pela alta, "regra_alterada" nos demais casos).

export type NaturezaContaPaciente = 'ambulatorial' | 'pronto_atendimento' | 'externo' | 'internacao' | 'domiciliar';

/** Natureza da conta pelo tipo base da categoria de atendimento; nulo quando a entrada não gera cobrança. */
export function naturezaDaEntrada(tipoBase: string): NaturezaContaPaciente | null {
  switch (tipoBase) {
    case 'ambulatorio':
    case 'telessaude':
      return 'ambulatorial';
    case 'pronto_atendimento':
      return 'pronto_atendimento';
    case 'externo':
      return 'externo';
    case 'internacao':
      return 'internacao';
    case 'domiciliar':
      return 'domiciliar';
    default:
      return null;
  }
}

/** Natureza do tipo de conta (cadastro tipo_conta) que serve à natureza da conta. */
export const NATUREZA_TIPO_CONTA: Readonly<Record<NaturezaContaPaciente, string>> = {
  ambulatorial: 'ambulatorial',
  pronto_atendimento: 'urgencia',
  externo: 'externa',
  internacao: 'internacao',
  domiciliar: 'domiciliar',
};

export type EscolhaTipoConta =
  | { readonly tipo: number }
  | { readonly recusa: 'tipo-conta-inexistente' | 'tipo-conta-ambiguo'; readonly mensagem: string };

/** O tipo de conta: o único ativo da natureza ou o de menor ordem quando só um a tem. */
export function escolherTipoConta(
  ativos: readonly { readonly id: number; readonly ordem: number }[],
  natureza: NaturezaContaPaciente,
): EscolhaTipoConta {
  if (ativos.length === 0)
    return {
      recusa: 'tipo-conta-inexistente',
      mensagem: `Não há tipo de conta ativo para a natureza "${NATUREZA_TIPO_CONTA[natureza]}": cadastre-o no faturamento.`,
    };
  if (ativos.length === 1) return { tipo: ativos[0]!.id };
  const menor = Math.min(...ativos.map((t) => t.ordem));
  const primeiros = ativos.filter((t) => t.ordem === menor);
  if (primeiros.length === 1) return { tipo: primeiros[0]!.id };
  return {
    recusa: 'tipo-conta-ambiguo',
    mensagem: `Há mais de um tipo de conta ativo para a natureza "${NATUREZA_TIPO_CONTA[natureza]}" com a mesma ordem: ajuste a ordem no cadastro.`,
  };
}

/** Competência da conta (AAAA-MM-01) pela data local da entrada (AAAA-MM-DD). */
export function competenciaDaConta(diaLocal: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(diaLocal)) throw new Error(`Data inválida: "${diaLocal}".`);
  return `${diaLocal.slice(0, 7)}-01`;
}

/** Número da conta do atendimento: o número do atendimento e a ordem da conta nele (sem sequência própria). */
export function numeroDaConta(numeroAtendimento: string, ordem: number): string {
  const sufixo = `-${ordem}`;
  if (numeroAtendimento.length + sufixo.length > 20)
    throw new Error(`Número do atendimento longo demais para a conta: ${numeroAtendimento.length} caracteres.`);
  return `${numeroAtendimento}${sufixo}`;
}

// ── Diárias e taxas ────────────────────────────────────────────────────────────────────────────────

/** Regra de diária ativa (regra_diaria). Datas AAAA-MM-DD, horas HH:MM. */
export interface RegraDiaria {
  readonly id: number;
  readonly fontePagadora: number | null;
  readonly plano: number | null;
  readonly categoriaAcomodacao: number;
  readonly modalidade: number | null;
  readonly idadeMinima: number | null;
  readonly idadeMaxima: number | null;
  readonly acompanhante: boolean;
  readonly item: number;
  readonly grupo: number | null;
  readonly quantidade: number;
  readonly horaVirada: string;
  readonly toleranciaMinutos: number;
  readonly substituiGeral: boolean;
  readonly prioridade: number;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

/** Item de uma regra de lançamento automático (regra_lancamento + regra_lancamento_item). */
export interface TaxaAutomatica {
  readonly regraLancamento: number;
  readonly regraItem: number;
  readonly gatilho: 'abertura_atendimento' | 'diaria_internacao';
  readonly acao: string;
  readonly exigeConfirmacao: boolean;
  readonly umaVezPorConta: boolean;
  readonly item: number | null;
  readonly grupo: number | null;
  readonly quantidade: number;
  readonly tipoValor: 'tabela' | 'percentual' | 'valor_fixo';
  readonly valor: number | null;
  readonly aplica: Readonly<Record<'internacao' | 'ambulatorial' | 'externo' | 'urgencia' | 'domiciliar', boolean>>;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

/** Trecho de permanência numa acomodação (horários locais "AAAA-MM-DDTHH:MM"; fim nulo = em curso). */
export interface TrechoAcomodacao {
  readonly inicio: string;
  readonly fim: string | null;
  readonly categoriaAcomodacao: number | null;
}

/** Lançamento automático vigente na conta (lancamento_automatico_conta em situação "lancado"). */
export interface LancamentoVigente {
  readonly id: number;
  readonly chave: string;
  readonly dia: string;
  readonly item: number;
  readonly categoriaAcomodacao: number | null;
}

export interface LancamentoDesejado {
  readonly chave: string;
  readonly dia: string;
  /** Hora local do lançamento (a entrada, no primeiro dia; a virada, nos seguintes). */
  readonly hora: string;
  readonly item: number;
  readonly grupo: number | null;
  readonly quantidade: number;
  readonly valorFixo: number | null;
  readonly categoriaAcomodacao: number | null;
  readonly regraDiaria: number | null;
  readonly regraLancamento: number | null;
  readonly regraItem: number | null;
}

export type MotivoEstorno = 'troca_acomodacao' | 'alta' | 'regra_alterada';

export interface EntradaApuracao {
  readonly natureza: NaturezaContaPaciente;
  /** Entrada local "AAAA-MM-DDTHH:MM". */
  readonly entrada: string;
  /** Até onde contar (alta, ou agora com a internação em curso), local "AAAA-MM-DDTHH:MM". */
  readonly limite: string;
  /** Verdadeiro: o limite é a alta (a contagem está fechada). */
  readonly alta: boolean;
  readonly trechos: readonly TrechoAcomodacao[];
  readonly fontePagadora: number;
  readonly plano: number | null;
  readonly modalidade: number | null;
  readonly idadeAnos: number | null;
  readonly acompanhante: boolean;
  readonly regrasDiaria: readonly RegraDiaria[];
  readonly taxas: readonly TaxaAutomatica[];
  readonly vigentes: readonly LancamentoVigente[];
}

export interface ResultadoApuracaoLancamentos {
  readonly lancar: readonly LancamentoDesejado[];
  readonly estornar: readonly { readonly id: number; readonly motivo: MotivoEstorno }[];
  /** Dias de diária sem regra que se aplique (ou com regras empatadas), para a conferência do faturista. */
  readonly pendencias: readonly { readonly dia: string; readonly motivo: 'sem-regra' | 'regra-ambigua' }[];
}

/** Teto de dias apurados numa conta (dez anos), contra laço infinito por dado incoerente. */
export const TETO_DIAS_APURACAO = 3660;

const FORMATO_LOCAL = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;

function exigirLocal(v: string, campo: string): void {
  if (!FORMATO_LOCAL.test(v)) throw new Error(`${campo} inválido: "${v}" (use AAAA-MM-DDTHH:MM).`);
}

export function diaSeguinte(dia: string): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Hora HH:MM somada de minutos, no mesmo dia (a tolerância passa da meia-noite fica em 23:59). */
function horaMais(hora: string, minutos: number): string {
  const [h, m] = hora.split(':').map(Number) as [number, number];
  const total = Math.min(h * 60 + m + minutos, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** A acomodação ocupada no instante local (trecho com início <= t < fim). */
export function acomodacaoNo(trechos: readonly TrechoAcomodacao[], t: string): number | null | undefined {
  let achado: TrechoAcomodacao | undefined;
  for (const x of trechos) if (x.inicio <= t && (x.fim === null || t < x.fim)) achado = x;
  return achado === undefined ? undefined : achado.categoriaAcomodacao;
}

const especificidade = (r: RegraDiaria) =>
  (r.plano !== null ? 8 : 0) +
  (r.fontePagadora !== null ? 4 : 0) +
  (r.modalidade !== null ? 2 : 0) +
  (r.idadeMinima !== null || r.idadeMaxima !== null ? 1 : 0);

function serve(r: RegraDiaria, c: ContextoRegra): boolean {
  if (r.categoriaAcomodacao !== c.categoriaAcomodacao) return false;
  if (r.vigenciaInicio > c.dia || (r.vigenciaFim !== null && r.vigenciaFim < c.dia)) return false;
  if (r.fontePagadora !== null && r.fontePagadora !== c.fontePagadora) return false;
  if (r.plano !== null && r.plano !== c.plano) return false;
  if (r.modalidade !== null && r.modalidade !== c.modalidade) return false;
  if (r.idadeMinima !== null || r.idadeMaxima !== null) {
    if (c.idadeAnos === null) return false;
    if (r.idadeMinima !== null && c.idadeAnos < r.idadeMinima) return false;
    if (r.idadeMaxima !== null && c.idadeAnos > r.idadeMaxima) return false;
  }
  return true;
}

interface ContextoRegra {
  readonly dia: string;
  readonly categoriaAcomodacao: number;
  readonly fontePagadora: number;
  readonly plano: number | null;
  readonly modalidade: number | null;
  readonly idadeAnos: number | null;
}

export type EscolhaRegra = { readonly regra: RegraDiaria } | { readonly falta: 'sem-regra' | 'regra-ambigua' };

function melhor(candidatas: readonly RegraDiaria[]): EscolhaRegra {
  if (candidatas.length === 0) return { falta: 'sem-regra' };
  const ordem = [...candidatas].sort(
    (a, b) => especificidade(b) - especificidade(a) || a.prioridade - b.prioridade,
  );
  const [a, b] = ordem as [RegraDiaria, RegraDiaria | undefined];
  if (b && especificidade(a) === especificidade(b) && a.prioridade === b.prioridade)
    return { falta: 'regra-ambigua' };
  return { regra: a };
}

/** As regras de diária do dia: a principal, as adicionais por faixa etária e a do acompanhante. */
export function regrasDoDia(
  regras: readonly RegraDiaria[],
  c: ContextoRegra & { readonly acompanhante: boolean },
): {
  readonly principal: EscolhaRegra;
  readonly adicionais: readonly RegraDiaria[];
  readonly acompanhante: RegraDiaria | null;
} {
  const doPaciente = regras.filter((r) => !r.acompanhante && serve(r, c));
  const adicional = (r: RegraDiaria) => (r.idadeMinima !== null || r.idadeMaxima !== null) && !r.substituiGeral;
  const principal = melhor(doPaciente.filter((r) => !adicional(r)));
  const adicionais = doPaciente.filter(adicional).sort((a, b) => a.id - b.id);
  let acompanhante: RegraDiaria | null = null;
  if (c.acompanhante) {
    const e = melhor(regras.filter((r) => r.acompanhante && serve(r, c)));
    if ('regra' in e) acompanhante = e.regra;
  }
  return { principal, adicionais, acompanhante };
}

const NATUREZA_APLICA: Readonly<Record<NaturezaContaPaciente, keyof TaxaAutomatica['aplica']>> = {
  internacao: 'internacao',
  ambulatorial: 'ambulatorial',
  externo: 'externo',
  pronto_atendimento: 'urgencia',
  domiciliar: 'domiciliar',
};

function taxaServe(t: TaxaAutomatica, natureza: NaturezaContaPaciente, dia: string): boolean {
  return (
    t.acao === 'incluir' &&
    !t.exigeConfirmacao &&
    t.item !== null &&
    t.tipoValor !== 'percentual' &&
    t.aplica[NATUREZA_APLICA[natureza]] &&
    t.vigenciaInicio <= dia &&
    (t.vigenciaFim === null || t.vigenciaFim >= dia)
  );
}

function desejoDeTaxa(t: TaxaAutomatica, dia: string, hora: string, categoria: number | null): LancamentoDesejado {
  return {
    chave: `taxa:${t.regraItem}`,
    dia,
    hora,
    item: t.item!,
    grupo: t.grupo,
    quantidade: t.quantidade,
    valorFixo: t.tipoValor === 'valor_fixo' ? t.valor : null,
    categoriaAcomodacao: categoria,
    regraDiaria: null,
    regraLancamento: t.regraLancamento,
    regraItem: t.regraItem,
  };
}

function desejoDeDiaria(
  chave: string,
  r: RegraDiaria,
  dia: string,
  hora: string,
  categoria: number,
): LancamentoDesejado {
  return {
    chave,
    dia,
    hora,
    item: r.item,
    grupo: r.grupo,
    quantidade: r.quantidade,
    valorFixo: null,
    categoriaAcomodacao: categoria,
    regraDiaria: r.id,
    regraLancamento: null,
    regraItem: null,
  };
}

/** O que a conta deve ter de lançamentos automáticos até o limite (sem olhar o que já tem). */
export function lancamentosDevidos(e: EntradaApuracao): {
  readonly devidos: readonly LancamentoDesejado[];
  readonly pendencias: ResultadoApuracaoLancamentos['pendencias'];
} {
  exigirLocal(e.entrada, 'Entrada');
  exigirLocal(e.limite, 'Limite');
  const devidos: LancamentoDesejado[] = [];
  const pendencias: { dia: string; motivo: 'sem-regra' | 'regra-ambigua' }[] = [];
  const diaEntrada = e.entrada.slice(0, 10);
  const horaEntrada = e.entrada.slice(11, 16);
  const categoriaEntrada = acomodacaoNo(e.trechos, e.entrada) ?? e.trechos[0]?.categoriaAcomodacao ?? null;
  for (const t of e.taxas)
    if (t.gatilho === 'abertura_atendimento' && taxaServe(t, e.natureza, diaEntrada))
      devidos.push(desejoDeTaxa(t, diaEntrada, horaEntrada, categoriaEntrada));
  if (e.natureza !== 'internacao') return { devidos, pendencias };

  // Diárias por dia de corte.
  let dia = diaEntrada;
  let hora = horaEntrada;
  let categoria: number | null | undefined = categoriaEntrada;
  let virada = '12:00';
  let tolerancia = 0;
  let primeira = true;
  for (let k = 0; k < TETO_DIAS_APURACAO; k++) {
    if (!primeira) {
      const corte = `${dia}T${horaMais(virada, tolerancia)}`;
      if (corte > e.limite) break;
      hora = virada;
      categoria = acomodacaoNo(e.trechos, corte);
      if (categoria === undefined) break; // fora de qualquer trecho de ocupação: não está internado
    }
    if (categoria === null || categoria === undefined) pendencias.push({ dia, motivo: 'sem-regra' });
    else {
      const regras = regrasDoDia(e.regrasDiaria, {
        dia,
        categoriaAcomodacao: categoria,
        fontePagadora: e.fontePagadora,
        plano: e.plano,
        modalidade: e.modalidade,
        idadeAnos: e.idadeAnos,
        acompanhante: e.acompanhante,
      });
      if ('regra' in regras.principal) {
        const r = regras.principal.regra;
        devidos.push(desejoDeDiaria('diaria', r, dia, hora, categoria));
        virada = r.horaVirada;
        tolerancia = r.toleranciaMinutos;
      } else pendencias.push({ dia, motivo: regras.principal.falta });
      for (const r of regras.adicionais) devidos.push(desejoDeDiaria(`diaria:${r.id}`, r, dia, hora, categoria));
      if (regras.acompanhante)
        devidos.push(desejoDeDiaria('diaria-acompanhante', regras.acompanhante, dia, hora, categoria));
      for (const t of e.taxas)
        if (t.gatilho === 'diaria_internacao' && (!t.umaVezPorConta || primeira) && taxaServe(t, e.natureza, dia))
          devidos.push(desejoDeTaxa(t, dia, hora, categoria));
    }
    primeira = false;
    dia = diaSeguinte(dia);
  }
  return { devidos, pendencias };
}

/** A apuração idempotente: o que lançar e o que estornar para a conta ficar com o que é devido. */
export function apurarLancamentos(e: EntradaApuracao): ResultadoApuracaoLancamentos {
  const { devidos, pendencias } = lancamentosDevidos(e);
  const chaveDe = (x: { chave: string; dia: string }) => `${x.chave}|${x.dia}`;
  const desejo = new Map(devidos.map((d) => [chaveDe(d), d]));
  const lancar: LancamentoDesejado[] = [];
  const estornar: { id: number; motivo: MotivoEstorno }[] = [];
  const atendidos = new Set<string>();
  for (const v of [...e.vigentes].sort((a, b) => a.id - b.id)) {
    const k = chaveDe(v);
    const d = desejo.get(k);
    if (!d || atendidos.has(k)) {
      estornar.push({ id: v.id, motivo: !d && e.alta ? 'alta' : 'regra_alterada' });
      continue;
    }
    if (d.item === v.item && d.categoriaAcomodacao === v.categoriaAcomodacao) {
      atendidos.add(k);
      continue;
    }
    estornar.push({
      id: v.id,
      motivo: d.categoriaAcomodacao !== v.categoriaAcomodacao ? 'troca_acomodacao' : 'regra_alterada',
    });
  }
  for (const d of devidos) if (!atendidos.has(chaveDe(d))) lancar.push(d);
  return { lancar, estornar, pendencias };
}
