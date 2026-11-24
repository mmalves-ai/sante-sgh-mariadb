// Gasto de sala do ato cirúrgico (F3.4, 04-CC linha 100): regras puras, sem banco.
//   - sugestão: a lista padrão de material por procedimento pré-preenche o gasto. Por procedimento do ato, vale a lista
//     do cirurgião quando ele tem uma; senão, a lista do serviço. A linha específica do tipo de anestesia do ato vale
//     junto com as gerais. O kit é aberto nos seus itens. O mesmo produto em dois procedimentos entra uma vez, com a
//     maior quantidade (a luva do primeiro procedimento serve ao segundo); obrigatório em qualquer lista fica
//     obrigatório.
//   - conferência: quantidade positiva, produto repetido no mesmo lote recusado, implante permanente e OPME (órtese,
//     prótese e material especial, pelo cadastro do produto, nunca pela marca do pedido) com lote, e item obrigatório
//     da lista ausente só com justificativa (motivo de pelo menos 5 letras).
//   - cirurgião da lista: só um cirurgião da equipe viva do ato escolhe a lista do cirurgião; o escolhido fica gravado
//     no gasto e vale para a tela, a gravação e a conferência (o pedido nunca troca a lista por um id de fora).
//   - situação: aberta → conferida → debitada; conferida volta a aberta só com motivo (reabertura); aberta ou
//     conferida pode ser cancelada com motivo; debitada não muda (o estorno é na conta e no estoque). Nada é apagado.

export type SituacaoGastoSala = 'aberta' | 'conferida' | 'debitada' | 'cancelada';
export type AcaoGastoSala = 'editar' | 'conferir' | 'reabrir' | 'debitar' | 'cancelar';

export interface ProblemaGastoSala {
  readonly campo: string;
  readonly mensagem: string;
}

export interface LinhaListaMaterial {
  readonly id: number;
  readonly procedimento: number;
  /** Nulo: lista padrão do serviço. */
  readonly cirurgiao: number | null;
  /** Nulo: vale para qualquer anestesia. */
  readonly tipoAnestesia: number | null;
  readonly insumo: number | null;
  readonly kit: number | null;
  readonly quantidade: number;
  readonly obrigatorio: boolean;
  readonly ativo: boolean;
}

export interface ItemDeKit {
  readonly kit: number;
  readonly insumo: number;
  readonly quantidade: number;
}

export interface ItemSugerido {
  readonly insumo: number;
  readonly quantidade: number;
  readonly obrigatorio: boolean;
  /** As linhas da lista que deram origem (para a justificativa e a memória). */
  readonly linhas: number[];
}

export interface AtoParaSugestao {
  readonly procedimentos: readonly number[];
  readonly cirurgiao: number | null;
  readonly tipoAnestesia: number | null;
}

const arred = (v: number) => Math.round(v * 10000) / 10000;

/** As linhas da lista que valem para um procedimento do ato (a do cirurgião, quando existe, substitui a do serviço). */
export function linhasQueValem(
  lista: readonly LinhaListaMaterial[],
  procedimento: number,
  ato: AtoParaSugestao,
): LinhaListaMaterial[] {
  const doProc = lista.filter(
    (l) =>
      l.ativo &&
      l.procedimento === procedimento &&
      (l.tipoAnestesia === null || l.tipoAnestesia === ato.tipoAnestesia),
  );
  const doCirurgiao = ato.cirurgiao === null ? [] : doProc.filter((l) => l.cirurgiao === ato.cirurgiao);
  return doCirurgiao.length ? doCirurgiao : doProc.filter((l) => l.cirurgiao === null);
}

/** O gasto sugerido para o ato: as listas dos procedimentos com os kits abertos, um item por produto. */
export function sugerirGastoSala(
  lista: readonly LinhaListaMaterial[],
  kits: readonly ItemDeKit[],
  ato: AtoParaSugestao,
): ItemSugerido[] {
  const porInsumo = new Map<number, { quantidade: number; obrigatorio: boolean; linhas: Set<number> }>();
  for (const proc of [...new Set(ato.procedimentos)]) {
    // Dentro do mesmo procedimento as quantidades somam (o kit e o avulso do mesmo produto).
    const doProc = new Map<number, { quantidade: number; obrigatorio: boolean; linhas: Set<number> }>();
    for (const l of linhasQueValem(lista, proc, ato)) {
      const partes: { insumo: number; quantidade: number }[] =
        l.insumo !== null
          ? [{ insumo: l.insumo, quantidade: l.quantidade }]
          : kits
              .filter((k) => k.kit === l.kit)
              .map((k) => ({ insumo: k.insumo, quantidade: arred(k.quantidade * l.quantidade) }));
      for (const p of partes) {
        const a = doProc.get(p.insumo) ?? { quantidade: 0, obrigatorio: false, linhas: new Set<number>() };
        a.quantidade = arred(a.quantidade + p.quantidade);
        a.obrigatorio ||= l.obrigatorio;
        a.linhas.add(l.id);
        doProc.set(p.insumo, a);
      }
    }
    for (const [insumo, v] of doProc) {
      const a = porInsumo.get(insumo);
      if (!a) porInsumo.set(insumo, { ...v, linhas: new Set(v.linhas) });
      else {
        a.quantidade = Math.max(a.quantidade, v.quantidade);
        a.obrigatorio ||= v.obrigatorio;
        for (const x of v.linhas) a.linhas.add(x);
      }
    }
  }
  return [...porInsumo.entries()]
    .map(([insumo, v]) => ({
      insumo,
      quantidade: v.quantidade,
      obrigatorio: v.obrigatorio,
      linhas: [...v.linhas].sort((a, b) => a - b),
    }))
    .sort((a, b) => a.insumo - b.insumo);
}

export interface ItemGastoSala {
  readonly insumo: number;
  readonly quantidade: number;
  readonly lote: number | null;
  readonly implantePermanente: boolean;
  readonly faturar: boolean;
  /** OPME pelo cadastro do produto: exige o lote (rastreio), com ou sem a marca de implante. */
  readonly opme?: boolean;
}

/** Um membro da equipe viva do ato; `cirurgiao` é a função de cirurgião (grau de participação 00). */
export interface MembroEquipeGasto {
  readonly profissional: number;
  readonly cirurgiao: boolean;
}

/**
 * O cirurgião cuja lista vale no gasto: o informado (só se for cirurgião da equipe viva), senão o gravado no gasto
 * (se seguir na equipe), senão o primeiro cirurgião da equipe; sem cirurgião, vale a lista do serviço (null).
 */
export function cirurgiaoDoGasto(
  equipe: readonly MembroEquipeGasto[],
  informado: number | null | undefined,
  gravado: number | null,
): { cirurgiao: number | null } | { problema: ProblemaGastoSala } {
  const cirurgioes = equipe.filter((m) => m.cirurgiao).map((m) => m.profissional);
  if (informado !== null && informado !== undefined) {
    if (!cirurgioes.includes(informado))
      return {
        problema: {
          campo: 'cirurgiao',
          mensagem: 'O cirurgião escolhido não está na equipe do ato com a função de cirurgião.',
        },
      };
    return { cirurgiao: informado };
  }
  if (gravado !== null && cirurgioes.includes(gravado)) return { cirurgiao: gravado };
  return { cirurgiao: cirurgioes[0] ?? null };
}

export interface JustificativaItem {
  readonly insumo: number;
  readonly motivo: string;
}

export const MINIMO_MOTIVO_GASTO_SALA = 5;

const motivoValido = (m: string | null | undefined) => (m ?? '').trim().length >= MINIMO_MOTIVO_GASTO_SALA;

/** Confere o gasto lançado contra a sugestão: devolve os problemas (vazio: pode gravar). */
export function conferirGastoSala(
  itens: readonly ItemGastoSala[],
  sugestao: readonly ItemSugerido[],
  justificativas: readonly JustificativaItem[],
): ProblemaGastoSala[] {
  const p: ProblemaGastoSala[] = [];
  const vistos = new Set<string>();
  itens.forEach((it, i) => {
    if (!(it.quantidade > 0))
      p.push({
        campo: `itens.${i}.quantidade`,
        mensagem: `Item ${i + 1}: a quantidade tem de ser maior que zero.`,
      });
    if ((it.implantePermanente || it.opme === true) && it.lote === null)
      p.push({
        campo: `itens.${i}.lote`,
        mensagem: it.implantePermanente
          ? `Item ${i + 1}: implante permanente exige o lote.`
          : `Item ${i + 1}: OPME (órtese, prótese e material especial) exige o lote.`,
      });
    const chave = `${it.insumo}:${it.lote ?? ''}`;
    if (vistos.has(chave))
      p.push({
        campo: `itens.${i}.insumo`,
        mensagem: `Item ${i + 1}: o produto já está no gasto com o mesmo lote; some a quantidade na linha existente.`,
      });
    vistos.add(chave);
  });
  const usados = new Set(itens.map((i) => i.insumo));
  for (const j of justificativas) {
    if (!motivoValido(j.motivo))
      p.push({
        campo: `justificativas.${j.insumo}`,
        mensagem: `A justificativa do produto ${j.insumo} precisa de pelo menos ${MINIMO_MOTIVO_GASTO_SALA} letras.`,
      });
    if (usados.has(j.insumo))
      p.push({
        campo: `justificativas.${j.insumo}`,
        mensagem: `O produto ${j.insumo} está no gasto: a justificativa de não uso não cabe.`,
      });
  }
  for (const s of sugestao.filter((x) => x.obrigatorio && !usados.has(x.insumo)))
    if (!justificativas.some((j) => j.insumo === s.insumo && motivoValido(j.motivo)))
      p.push({
        campo: `justificativas.${s.insumo}`,
        mensagem: `O produto ${s.insumo} é obrigatório na lista do procedimento: lance o uso ou justifique por que não foi usado.`,
      });
  return p;
}

/** Diferença entre o gasto lançado e a sugestão, para a conferência (o que veio a mais, a menos e fora da lista). */
export function diferencasDaSugestao(
  itens: readonly ItemGastoSala[],
  sugestao: readonly ItemSugerido[],
): {
  insumo: number;
  sugerido: number;
  lancado: number;
  tipo: 'a_mais' | 'a_menos' | 'fora_da_lista' | 'nao_usado';
}[] {
  const lancado = new Map<number, number>();
  for (const i of itens) lancado.set(i.insumo, arred((lancado.get(i.insumo) ?? 0) + i.quantidade));
  const r: ReturnType<typeof diferencasDaSugestao> = [];
  for (const s of sugestao) {
    const l = lancado.get(s.insumo) ?? 0;
    if (l === 0) r.push({ insumo: s.insumo, sugerido: s.quantidade, lancado: 0, tipo: 'nao_usado' });
    else if (l > s.quantidade)
      r.push({ insumo: s.insumo, sugerido: s.quantidade, lancado: l, tipo: 'a_mais' });
    else if (l < s.quantidade)
      r.push({ insumo: s.insumo, sugerido: s.quantidade, lancado: l, tipo: 'a_menos' });
  }
  for (const [insumo, l] of lancado)
    if (!sugestao.some((s) => s.insumo === insumo))
      r.push({ insumo, sugerido: 0, lancado: l, tipo: 'fora_da_lista' });
  return r;
}

/** A transição pedida na situação atual: a nova situação, ou o problema. */
export function transicaoGastoSala(
  situacao: SituacaoGastoSala,
  acao: AcaoGastoSala,
  motivo?: string | null,
): { situacao: SituacaoGastoSala } | { problema: ProblemaGastoSala } {
  const recusa = (mensagem: string) => ({ problema: { campo: 'situacao', mensagem } });
  if (situacao === 'debitada')
    return recusa('O gasto já foi debitado na conta: não muda (o estorno é feito na conta e no estoque).');
  if (situacao === 'cancelada') return recusa('O gasto foi cancelado: não muda.');
  switch (acao) {
    case 'editar':
      return situacao === 'aberta'
        ? { situacao }
        : recusa('O gasto conferido não muda: reabra a conferência com o motivo para corrigir.');
    case 'conferir':
      return situacao === 'aberta' ? { situacao: 'conferida' } : recusa('O gasto já está conferido.');
    case 'reabrir':
      if (situacao !== 'conferida') return recusa('Só o gasto conferido pode ser reaberto.');
      return motivoValido(motivo)
        ? { situacao: 'aberta' }
        : {
            problema: { campo: 'motivo', mensagem: 'Informe o motivo da reabertura (pelo menos 5 letras).' },
          };
    case 'debitar':
      return situacao === 'conferida'
        ? { situacao: 'debitada' }
        : recusa('Confira o gasto antes de debitar na conta.');
    case 'cancelar':
      return motivoValido(motivo)
        ? { situacao: 'cancelada' }
        : {
            problema: {
              campo: 'motivo',
              mensagem: 'Informe o motivo do cancelamento (pelo menos 5 letras).',
            },
          };
  }
}
