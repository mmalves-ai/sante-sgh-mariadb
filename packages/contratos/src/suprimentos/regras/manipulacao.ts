// Regras da manipulação (ficha do M46, etapa 4; regra 11; cap-06a §6.4, Manipulação e fracionamento): a ordem só a
// partir do item validado pela farmácia (a avaliação farmacêutica do M29: válida pela regra ou pelo farmacêutico), uma
// ordem em curso por item; a capela do cadastro em funcionamento e o grupo dela; o insumo com o lote não vencido; a
// validade da sobra pela regra versionada; a dupla conferência por outra pessoa; a baixa do insumo (a saída do estoque
// do M28) só depois da conferência, com o insumo e a quantidade da ordem. Funções puras: a gravação confere de novo.
import { REGRA_SOBRA_MANIPULACAO, type SituacaoManipulacao } from '../manipulacao.js';
import { recusa, type RecusaSuprimentos } from './recusa.js';

/** A avaliação farmacêutica valida o item (decisão "válido" do farmacêutico ou aprovação automática pela regra). */
export function itemValidadoPelaFarmacia(a: { estado: string; decisao: string | null } | null): boolean {
  return !!a && (a.estado === 'automatico' || (a.estado === 'decidido' && a.decisao === 'valido'));
}

/** O fim (exclusivo) permitido para a validade da sobra: as horas da regra depois do preparo e o fim do dia da validade do lote. */
export function limiteValidadeSobra(preparo: string, validadeInsumo: string): string {
  const p = Date.parse(`${preparo.slice(0, 16)}:00Z`);
  const porRegra = new Date(p + REGRA_SOBRA_MANIPULACAO.horasMaximas * 3_600_000).toISOString().slice(0, 16);
  const fimDoLote = `${validadeInsumo}T23:59`;
  return porRegra < fimDoLote ? porRegra : fimDoLote;
}

export interface AberturaParaConferir {
  readonly avaliacao: { readonly estado: string; readonly decisao: string | null } | null;
  /** Já há ordem aberta ou conferida para o item prescrito. */
  readonly ordemEmCurso: boolean;
  readonly capela: {
    readonly funcionando: boolean;
    readonly grupos: readonly number[];
  } | null;
  readonly grupo: number | null;
  /** O insumo existe no cadastro do estoque. */
  readonly insumoExiste: boolean;
  /** O lote do insumo existe no local (rastreável) ou o item não é rastreado. */
  readonly loteNoLocal: boolean;
  readonly quantidade: number;
  readonly validadeInsumo: string;
  readonly validadeSobra: string | null;
  /** AAAA-MM-DDTHH:mm (o relógio do banco). */
  readonly agora: string;
}

/** Regra 11: a ordem nasce do item validado, com a capela, o insumo e o lote válidos e a sobra dentro da regra. */
export function conferirAberturaManipulacao(a: AberturaParaConferir): RecusaSuprimentos[] {
  const x: RecusaSuprimentos[] = [];
  if (!itemValidadoPelaFarmacia(a.avaliacao))
    x.push(
      recusa(
        'item-nao-validado',
        'O item prescrito ainda não foi validado pela farmácia: a manipulação começa depois da avaliação farmacêutica.',
        ['itemPrescrito'],
      ),
    );
  if (a.ordemEmCurso)
    x.push(
      recusa('ordem-em-curso', 'Já há uma ordem de manipulação em curso para este item prescrito.', [
        'itemPrescrito',
      ]),
    );
  if (!a.capela) x.push(recusa('capela-inexistente', 'A capela não está no cadastro.', ['capela']));
  else {
    if (!a.capela.funcionando)
      x.push(recusa('capela-parada', 'A capela não está em funcionamento no cadastro.', ['capela']));
    if (a.grupo !== null && !a.capela.grupos.includes(a.grupo))
      x.push(recusa('grupo-de-outra-capela', 'O grupo de manipulação não é desta capela.', ['grupo']));
  }
  if (!a.insumoExiste)
    x.push(recusa('insumo-inexistente', 'O insumo não está no cadastro do estoque.', ['insumo']));
  else if (!a.loteNoLocal)
    x.push(
      recusa('lote-fora-do-local', 'O lote do insumo não está no local de estoque escolhido.', [
        'loteInsumo',
      ]),
    );
  if (!(a.quantidade > 0))
    x.push(recusa('quantidade-invalida', 'A quantidade tem de ser maior que zero.', ['quantidade']));
  if (a.validadeInsumo < a.agora.slice(0, 10))
    x.push(recusa('lote-vencido', 'O lote do insumo está vencido.', ['validadeInsumo']));
  if (a.validadeSobra !== null) {
    if (a.validadeSobra <= a.agora.slice(0, 16))
      x.push(
        recusa('sobra-no-passado', 'A validade da sobra tem de ser depois do preparo.', ['validadeSobra']),
      );
    else if (a.validadeSobra > limiteValidadeSobra(a.agora, a.validadeInsumo))
      x.push(
        recusa(
          'sobra-acima-da-regra',
          `A validade da sobra vai no máximo ${REGRA_SOBRA_MANIPULACAO.horasMaximas} horas depois do preparo e nunca depois da validade do lote do insumo.`,
          ['validadeSobra'],
        ),
      );
  }
  return x;
}

export interface ConferenciaParaConferir {
  readonly situacao: SituacaoManipulacao;
  readonly preparadoPor: string;
  readonly conferente: string;
  readonly resultado: 'aprovada' | 'reprovada';
  readonly observacao: string | null;
}

/** Regra 11: a dupla conferência é de outra pessoa, só na ordem preparada; a reprovação leva o motivo. */
export function conferirConferenciaManipulacao(c: ConferenciaParaConferir): RecusaSuprimentos[] {
  const x: RecusaSuprimentos[] = [];
  if (c.situacao !== 'aberta')
    x.push(recusa('ordem-ja-conferida', 'A ordem de manipulação já foi conferida.', ['ordem']));
  if (c.preparadoPor.trim().toUpperCase() === c.conferente.trim().toUpperCase())
    x.push(
      recusa(
        'mesma-pessoa',
        'A dupla conferência é feita por outro farmacêutico: quem preparou não confere a própria ordem.',
        ['ordem'],
      ),
    );
  if (c.resultado === 'reprovada' && (c.observacao ?? '').trim().length < 10)
    x.push(recusa('sem-motivo', 'Escreva o motivo da reprovação (ao menos 10 caracteres).', ['observacao']));
  return x;
}

export interface BaixaParaConferir {
  readonly situacao: SituacaoManipulacao;
  readonly insumo: number;
  readonly quantidade: number;
  readonly itemSaida: number;
  readonly quantidadeSaida: number;
  /** O lote e a validade do insumo registrados na ordem (a revisão do M46.4: a saída com lote é a deste lote). */
  readonly loteInsumo?: string | null;
  readonly validadeInsumo?: string | null;
  /** Os lotes da saída (vazio quando o insumo não é rastreado por lote). */
  readonly lotesSaida?: readonly {
    readonly lote: string;
    readonly validade: string;
    readonly quantidade: number;
  }[];
}

const mesmoLote = (a: string | null | undefined, b: string) =>
  (a ?? '').trim().toUpperCase() === b.trim().toUpperCase();

/** Regra 11: a baixa do insumo é a saída do estoque do insumo e da quantidade da ordem, depois da conferência. */
export function conferirBaixaManipulacao(b: BaixaParaConferir): RecusaSuprimentos[] {
  const x: RecusaSuprimentos[] = [];
  if (b.situacao !== 'conferida')
    x.push(
      recusa(
        b.situacao === 'baixada' ? 'ordem-ja-baixada' : 'ordem-nao-conferida',
        b.situacao === 'baixada'
          ? 'O insumo desta ordem já foi baixado do estoque.'
          : 'A baixa do insumo vem depois da dupla conferência aprovada.',
        ['ordem'],
      ),
    );
  if (b.itemSaida !== b.insumo || Math.round(b.quantidadeSaida * 1000) !== Math.round(b.quantidade * 1000))
    x.push(
      recusa('saida-diferente-da-ordem', 'A saída do estoque não é do insumo e da quantidade da ordem.', [
        'ordem',
      ]),
    );
  // Regra 11: o rastreio do lote do insumo. A saída com lote baixa um único lote, o da ordem, com a validade dela e a
  // quantidade inteira (D-LOTE-BAIXA-464).
  const ls = b.lotesSaida ?? [];
  if (
    ls.length > 0 &&
    (ls.length !== 1 ||
      !mesmoLote(b.loteInsumo, ls[0]!.lote) ||
      (b.validadeInsumo ?? '') !== ls[0]!.validade ||
      Math.round(ls[0]!.quantidade * 1000) !== Math.round(b.quantidade * 1000))
  )
    x.push(
      recusa(
        'saida-diferente-da-ordem',
        'A saída do estoque não é do lote e da validade do insumo registrados na ordem.',
        ['ordem'],
      ),
    );
  return x;
}

/** A situação depois da conferência. */
export function situacaoDepoisDaConferencia(resultado: 'aprovada' | 'reprovada'): SituacaoManipulacao {
  return resultado === 'aprovada' ? 'conferida' : 'reprovada';
}
