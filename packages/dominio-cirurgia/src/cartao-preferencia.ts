// Cartão de preferência do cirurgião (F8, 04-CC linha 105). Regras puras, sem banco:
//   - um cartão por cirurgião e procedimento; o cartão sem procedimento pode valer para um grupo de procedimentos e,
//     sem grupo, é o geral do cirurgião; vale o do procedimento, depois o do grupo, depois o geral;
//   - vigência opcional (início e fim, datas inclusivas): fora dela o cartão não vale para o ato daquele dia, sem
//     apagar nada; a versão de cada alteração fica na trilha;
//   - o kit padrão (cadastro de kits de material) entra como item de natureza kit; no gasto de sala ele se abre nos
//     produtos do kit, multiplicados pela quantidade do item;
//   - o cartão guarda o que a equipe monta antes de o paciente entrar: posição, sala preferida, tempo habitual,
//     tamanho da luva, preparo da pele, fios e os itens (material, medicamento, fio, instrumental, equipamento);
//   - cada item aponta para o cadastro certo pela natureza (produto do estoque, caixa de instrumental ou equipamento)
//     ou, quando não há cadastro, leva uma descrição livre; item repetido é recusado na hora;
//   - do cartão saem a sugestão para o mapa (sala, tempo e posição) e os produtos para o gasto de sala (somados);
//   - nada se apaga: o cartão sai de uso (ativo = falso) e cada versão anterior fica na trilha.

export const NATUREZAS_ITEM_CARTAO = [
  'material',
  'medicamento',
  'fio',
  'instrumental',
  'equipamento',
  'kit',
  'outro',
] as const;
export type NaturezaItemCartao = (typeof NATUREZAS_ITEM_CARTAO)[number];

export interface ItemCartaoPreferencia {
  readonly natureza: NaturezaItemCartao;
  readonly insumo?: number | null;
  readonly caixaInstrumental?: number | null;
  readonly equipamento?: number | null;
  readonly kit?: number | null;
  readonly descricao?: string | null;
  readonly quantidade: number;
  readonly observacao?: string | null;
}

export interface EntradaCartaoPreferencia {
  readonly cirurgiao: number | null;
  readonly procedimento?: number | null;
  /** Grupo de procedimentos (só no cartão sem procedimento). */
  readonly grupo?: number | null;
  /** Vigência em data ISO (AAAA-MM-DD), inclusiva; vazia = sem limite. */
  readonly vigenciaInicio?: string | null;
  readonly vigenciaFim?: string | null;
  readonly posicao?: number | null;
  readonly sala?: number | null;
  readonly tempoMinutos?: number | null;
  readonly tamanhoLuva?: string | null;
  readonly preparoPele?: string | null;
  readonly fiosSutura?: string | null;
  readonly observacao?: string | null;
  readonly itens: readonly ItemCartaoPreferencia[];
}

export interface CartaoPreferencia extends EntradaCartaoPreferencia {
  readonly id: number;
  readonly ativo: boolean;
}

export interface ProblemaCartao {
  readonly campo: string;
  readonly mensagem: string;
}

export const LIMITE_ITENS_CARTAO = 200;
const LUVA = /^(5([.,]5)?|[6-9]([.,]5)?|10)$/;

const vazio = (s: string | null | undefined) => !s || !s.trim();
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const dataValida = (s: string) =>
  DATA.test(s) &&
  !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
  new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

type Referencia = 'insumo' | 'caixaInstrumental' | 'equipamento' | 'kit';

/** Qual cadastro a natureza aceita (o outro tipo de referência é recusado). */
function referenciaAceita(n: NaturezaItemCartao): Referencia | null {
  if (n === 'material' || n === 'medicamento' || n === 'fio') return 'insumo';
  if (n === 'instrumental') return 'caixaInstrumental';
  if (n === 'equipamento') return 'equipamento';
  if (n === 'kit') return 'kit';
  return null;
}

/** A chave que identifica o item no cartão (para recusar repetido). */
export function chaveItemCartao(i: ItemCartaoPreferencia): string {
  if (i.insumo) return `insumo:${i.insumo}`;
  if (i.caixaInstrumental) return `caixa:${i.caixaInstrumental}`;
  if (i.equipamento) return `equipamento:${i.equipamento}`;
  if (i.kit) return `kit:${i.kit}`;
  return `${i.natureza}:${(i.descricao ?? '').trim().toLocaleLowerCase('pt-BR')}`;
}

/** Confere o cartão antes de gravar; a tela usa a mesma regra para avisar na hora. */
export function validarCartaoPreferencia(e: EntradaCartaoPreferencia): ProblemaCartao[] {
  const p: ProblemaCartao[] = [];
  if (!e.cirurgiao) p.push({ campo: 'cirurgiao', mensagem: 'Informe o cirurgião dono do cartão.' });
  if (e.procedimento && e.grupo)
    p.push({
      campo: 'grupo',
      mensagem: 'O cartão é do procedimento ou do grupo de procedimentos: escolha um só.',
    });
  const ini = vazio(e.vigenciaInicio) ? null : e.vigenciaInicio!.trim();
  const fim = vazio(e.vigenciaFim) ? null : e.vigenciaFim!.trim();
  if (ini && !dataValida(ini))
    p.push({ campo: 'vigenciaInicio', mensagem: 'O início da vigência é uma data válida.' });
  if (fim && !dataValida(fim))
    p.push({ campo: 'vigenciaFim', mensagem: 'O fim da vigência é uma data válida.' });
  if (ini && fim && dataValida(ini) && dataValida(fim) && fim < ini)
    p.push({ campo: 'vigenciaFim', mensagem: 'O fim da vigência não pode ser antes do início.' });
  if (e.tempoMinutos !== null && e.tempoMinutos !== undefined) {
    if (!Number.isInteger(e.tempoMinutos) || e.tempoMinutos < 5 || e.tempoMinutos > 1440)
      p.push({ campo: 'tempoMinutos', mensagem: 'O tempo habitual vai de 5 a 1440 minutos.' });
  }
  if (!vazio(e.tamanhoLuva) && !LUVA.test(e.tamanhoLuva!.trim()))
    p.push({ campo: 'tamanhoLuva', mensagem: 'O tamanho da luva vai de 5,5 a 10 (meio número aceito).' });
  if ((e.preparoPele ?? '').length > 300)
    p.push({ campo: 'preparoPele', mensagem: 'O preparo da pele tem até 300 caracteres.' });
  if ((e.fiosSutura ?? '').length > 500)
    p.push({ campo: 'fiosSutura', mensagem: 'Os fios de sutura têm até 500 caracteres.' });
  if (e.itens.length > LIMITE_ITENS_CARTAO)
    p.push({ campo: 'itens', mensagem: `O cartão tem até ${LIMITE_ITENS_CARTAO} itens.` });

  const temConteudo =
    e.itens.length > 0 ||
    !!e.posicao ||
    !!e.sala ||
    !!e.tempoMinutos ||
    !vazio(e.tamanhoLuva) ||
    !vazio(e.preparoPele) ||
    !vazio(e.fiosSutura) ||
    !vazio(e.observacao);
  if (!temConteudo)
    p.push({
      campo: 'itens',
      mensagem: 'O cartão vazio não ajuda a montar a sala: informe a posição, o tempo, a luva ou os itens.',
    });

  const vistos = new Set<string>();
  e.itens.forEach((i, k) => {
    const campo = `itens.${k}`;
    const n = k + 1;
    if (!NATUREZAS_ITEM_CARTAO.includes(i.natureza)) {
      p.push({ campo: `${campo}.natureza`, mensagem: `Item ${n}: natureza desconhecida.` });
      return;
    }
    const aceita = referenciaAceita(i.natureza);
    const refs = {
      insumo: i.insumo,
      caixaInstrumental: i.caixaInstrumental,
      equipamento: i.equipamento,
      kit: i.kit,
    };
    const outras = Object.entries(refs).filter(([k2, v]) => v && k2 !== aceita);
    if (outras.length)
      p.push({
        campo,
        mensagem: `Item ${n}: a natureza ${i.natureza} não aceita esse cadastro; escolha o item certo ou use a descrição.`,
      });
    const temRef = aceita !== null && !!refs[aceita];
    if (!temRef && vazio(i.descricao))
      p.push({
        campo: `${campo}.descricao`,
        mensagem: `Item ${n}: escolha o item do cadastro ou escreva a descrição.`,
      });
    if ((i.descricao ?? '').length > 150)
      p.push({ campo: `${campo}.descricao`, mensagem: `Item ${n}: a descrição tem até 150 caracteres.` });
    if ((i.observacao ?? '').length > 300)
      p.push({ campo: `${campo}.observacao`, mensagem: `Item ${n}: a observação tem até 300 caracteres.` });
    if (!(i.quantidade > 0) || i.quantidade > 99999)
      p.push({ campo: `${campo}.quantidade`, mensagem: `Item ${n}: a quantidade vai de mais de 0 a 99999.` });
    const chave = chaveItemCartao(i);
    if (vistos.has(chave))
      p.push({ campo, mensagem: `Item ${n}: repetido no cartão; ajuste a quantidade do primeiro.` });
    vistos.add(chave);
  });
  return p;
}

/** O cartão vale na data (AAAA-MM-DD) quando ela está dentro da vigência; sem data, vale o que está ativo. */
export function cartaoVigente(
  c: Pick<EntradaCartaoPreferencia, 'vigenciaInicio' | 'vigenciaFim'>,
  data: string | null | undefined,
): boolean {
  if (!data) return true;
  if (c.vigenciaInicio && data < c.vigenciaInicio) return false;
  if (c.vigenciaFim && data > c.vigenciaFim) return false;
  return true;
}

/**
 * O cartão que vale para o cirurgião e o procedimento, entre os ativos e vigentes na data do ato: o do procedimento,
 * depois o do grupo do procedimento, depois o geral (sem procedimento e sem grupo).
 */
export function cartaoAplicavel<
  T extends Pick<
    CartaoPreferencia,
    'cirurgiao' | 'procedimento' | 'grupo' | 'ativo' | 'vigenciaInicio' | 'vigenciaFim'
  >,
>(
  cartoes: readonly T[],
  cirurgiao: number,
  procedimento: number | null,
  opcoes: { readonly grupo?: number | null; readonly data?: string | null } = {},
): T | null {
  const dele = cartoes.filter((c) => c.ativo && c.cirurgiao === cirurgiao && cartaoVigente(c, opcoes.data));
  const semProc = dele.filter((c) => (c.procedimento ?? null) === null);
  return (
    (procedimento !== null ? dele.find((c) => c.procedimento === procedimento) : undefined) ??
    (opcoes.grupo ? semProc.find((c) => c.grupo === opcoes.grupo) : undefined) ??
    semProc.find((c) => (c.grupo ?? null) === null) ??
    null
  );
}

/** A sugestão do cartão para o agendamento no mapa: sala preferida, tempo habitual e posição. */
export function sugestaoParaMapa(c: Pick<EntradaCartaoPreferencia, 'sala' | 'tempoMinutos' | 'posicao'>) {
  return {
    sala: c.sala ?? null,
    tempoMinutos: c.tempoMinutos ?? null,
    posicao: c.posicao ?? null,
  };
}

/**
 * Os produtos do estoque do cartão para o gasto de sala, somados por produto e na ordem do cartão; o kit padrão se
 * abre nos produtos dele (quantidade do kit vezes a do item).
 */
export function itensParaGasto(
  itens: readonly ItemCartaoPreferencia[],
  kits: ReadonlyMap<number, readonly { insumo: number; quantidade: number }[]> = new Map(),
): { insumo: number; quantidade: number }[] {
  const soma = new Map<number, number>();
  const somar = (insumo: number, q: number) =>
    soma.set(insumo, Math.round(((soma.get(insumo) ?? 0) + q) * 10000) / 10000);
  for (const i of itens) {
    if (i.insumo && referenciaAceita(i.natureza) === 'insumo') somar(i.insumo, i.quantidade);
    if (i.kit && i.natureza === 'kit')
      for (const k of kits.get(i.kit) ?? []) somar(k.insumo, k.quantidade * i.quantidade);
  }
  return [...soma.entries()].map(([insumo, quantidade]) => ({ insumo, quantidade }));
}
