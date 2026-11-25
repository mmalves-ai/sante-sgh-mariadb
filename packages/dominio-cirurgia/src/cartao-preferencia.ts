// Cartão de preferência do cirurgião (F8, 04-CC linha 105). Regras puras, sem banco:
//   - um cartão por cirurgião e procedimento; o cartão sem procedimento é o geral do cirurgião e vale quando não há o
//     do procedimento (o do procedimento sempre ganha);
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
  'outro',
] as const;
export type NaturezaItemCartao = (typeof NATUREZAS_ITEM_CARTAO)[number];

export interface ItemCartaoPreferencia {
  readonly natureza: NaturezaItemCartao;
  readonly insumo?: number | null;
  readonly caixaInstrumental?: number | null;
  readonly equipamento?: number | null;
  readonly descricao?: string | null;
  readonly quantidade: number;
  readonly observacao?: string | null;
}

export interface EntradaCartaoPreferencia {
  readonly cirurgiao: number | null;
  readonly procedimento?: number | null;
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

/** Qual cadastro a natureza aceita (o outro tipo de referência é recusado). */
function referenciaAceita(n: NaturezaItemCartao): 'insumo' | 'caixaInstrumental' | 'equipamento' | null {
  if (n === 'material' || n === 'medicamento' || n === 'fio') return 'insumo';
  if (n === 'instrumental') return 'caixaInstrumental';
  if (n === 'equipamento') return 'equipamento';
  return null;
}

/** A chave que identifica o item no cartão (para recusar repetido). */
export function chaveItemCartao(i: ItemCartaoPreferencia): string {
  if (i.insumo) return `insumo:${i.insumo}`;
  if (i.caixaInstrumental) return `caixa:${i.caixaInstrumental}`;
  if (i.equipamento) return `equipamento:${i.equipamento}`;
  return `${i.natureza}:${(i.descricao ?? '').trim().toLocaleLowerCase('pt-BR')}`;
}

/** Confere o cartão antes de gravar; a tela usa a mesma regra para avisar na hora. */
export function validarCartaoPreferencia(e: EntradaCartaoPreferencia): ProblemaCartao[] {
  const p: ProblemaCartao[] = [];
  if (!e.cirurgiao) p.push({ campo: 'cirurgiao', mensagem: 'Informe o cirurgião dono do cartão.' });
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
    const refs = { insumo: i.insumo, caixaInstrumental: i.caixaInstrumental, equipamento: i.equipamento };
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

/** O cartão que vale para o cirurgião e o procedimento: o do procedimento ou, sem ele, o geral; só os ativos. */
export function cartaoAplicavel<T extends Pick<CartaoPreferencia, 'cirurgiao' | 'procedimento' | 'ativo'>>(
  cartoes: readonly T[],
  cirurgiao: number,
  procedimento: number | null,
): T | null {
  const dele = cartoes.filter((c) => c.ativo && c.cirurgiao === cirurgiao);
  return (
    (procedimento !== null ? dele.find((c) => c.procedimento === procedimento) : undefined) ??
    dele.find((c) => (c.procedimento ?? null) === null) ??
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

/** Os produtos do estoque do cartão para o gasto de sala, somados por produto e na ordem do cartão. */
export function itensParaGasto(
  itens: readonly ItemCartaoPreferencia[],
): { insumo: number; quantidade: number }[] {
  const soma = new Map<number, number>();
  for (const i of itens)
    if (i.insumo && referenciaAceita(i.natureza) === 'insumo')
      soma.set(i.insumo, (soma.get(i.insumo) ?? 0) + i.quantidade);
  return [...soma.entries()].map(([insumo, quantidade]) => ({ insumo, quantidade }));
}
