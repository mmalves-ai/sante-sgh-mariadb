// Movimentos do bem patrimonial (M54, etapa 6; ficha, regra 13): a transferência entre setores fica pendente até o
// aceite de quem recebe (quem pediu não aceita o próprio pedido; pode cancelar); o empréstimo e o comodato a terceiro
// tiram o bem de uso (situação `emprestado`) até a devolução; a baixa é definitiva e exige o termo. O bem baixado não se
// movimenta; com transferência pendente, nada mais se registra até a decisão.
// D-BAIXA-DEPREC-546: a baixa não pode cair numa competência que já tem cota do bem (o bem deprecia até o mês anterior
// ao da baixa; a cota gravada não se desfaz).
import type { RegistrarMovimento, SituacaoBem, SituacaoMovimentoBem, TipoMovimentoBem } from '@sgh/contratos';
import { competenciaDe } from './origem.js';

export interface BemParaMovimento {
  readonly id: number;
  readonly situacao: SituacaoBem;
  readonly centro: number;
  readonly dataAquisicao: string;
  readonly versao: number;
  /** A última competência com cota gravada do bem (null: nenhuma). */
  readonly ultimaCompetencia: string | null;
  readonly movimentoPendente: { readonly id: number } | null;
}

export interface ProblemaMovimento {
  readonly codigo: string;
  readonly mensagem: string;
}

export interface ContextoMovimento {
  readonly hoje: string;
  readonly centrosAtivos: ReadonlySet<number>;
}

/** Problemas do registro (vazio: pode gravar). */
export function problemasDoMovimento(
  b: BemParaMovimento,
  x: RegistrarMovimento,
  c: ContextoMovimento,
): ProblemaMovimento[] {
  const p: ProblemaMovimento[] = [];
  const add = (codigo: string, mensagem: string) => p.push({ codigo, mensagem });
  if (x.versao !== b.versao)
    add('desatualizado', 'O bem mudou depois que você abriu (outra pessoa gravou). Abra de novo.');
  if (b.situacao === 'baixado') add('baixado', 'O bem já foi baixado: não se movimenta mais.');
  if (b.movimentoPendente)
    add('pendente', 'Há uma transferência deste bem aguardando o aceite: decida ou cancele antes.');
  if (x.data > c.hoje) add('data-futura', 'A data do movimento não pode ser futura.');
  if (x.data < b.dataAquisicao) add('data-anterior', 'A data do movimento é anterior à aquisição do bem.');
  switch (x.tipo) {
    case 'transferencia':
      if (b.situacao === 'emprestado')
        add('emprestado', 'O bem está emprestado ou em comodato: registre a devolução antes.');
      if (x.destino === b.centro) add('mesmo-centro', 'O bem já está neste setor.');
      if (!c.centrosAtivos.has(x.destino)) add('destino', 'Setor de destino desconhecido ou inativo.');
      break;
    case 'emprestimo':
    case 'comodato':
      if (b.situacao === 'emprestado') add('emprestado', 'O bem já está emprestado ou em comodato.');
      if (x.retornoPrevisto !== null && x.retornoPrevisto < x.data)
        add('retorno', 'O retorno previsto é anterior à saída.');
      break;
    case 'devolucao':
      if (b.situacao !== 'emprestado') add('nao-emprestado', 'O bem não está emprestado nem em comodato.');
      break;
    case 'baixa':
      if (b.situacao === 'emprestado')
        add('emprestado', 'O bem está emprestado ou em comodato: registre a devolução antes da baixa.');
      if (b.ultimaCompetencia !== null && competenciaDe(x.data) <= b.ultimaCompetencia)
        add(
          'baixa-depreciada',
          `A depreciação de ${b.ultimaCompetencia} já tem a cota deste bem: a baixa tem de ser de uma competência posterior.`,
        );
      break;
  }
  return p;
}

export interface EfeitoMovimento {
  /** A situação do movimento gravado. */
  readonly situacaoMovimento: SituacaoMovimentoBem;
  /** O que muda no bem agora (null: nada até o aceite). */
  readonly bem: {
    readonly situacao: SituacaoBem;
    readonly centro: number;
    readonly baixadoEm: string | null;
  } | null;
}

/** O efeito do registro já conferido: a transferência espera; os demais valem na hora. */
export function efeitoDoMovimento(
  b: Pick<BemParaMovimento, 'centro'>,
  x: RegistrarMovimento,
): EfeitoMovimento {
  switch (x.tipo) {
    case 'transferencia':
      return { situacaoMovimento: 'pendente', bem: null };
    case 'emprestimo':
    case 'comodato':
      return {
        situacaoMovimento: 'concluido',
        bem: { situacao: 'emprestado', centro: b.centro, baixadoEm: null },
      };
    case 'devolucao':
      return {
        situacaoMovimento: 'concluido',
        bem: { situacao: 'ativo', centro: b.centro, baixadoEm: null },
      };
    case 'baixa':
      return {
        situacaoMovimento: 'concluido',
        bem: { situacao: 'baixado', centro: b.centro, baixadoEm: x.data },
      };
  }
}

export interface MovimentoParaDecisao {
  readonly tipo: TipoMovimentoBem;
  readonly situacao: SituacaoMovimentoBem;
  readonly versao: number;
  readonly solicitadoPor: string;
  readonly origem: number;
  /** O setor (TBCENCUS.ID) que recebe; só a transferência tem. */
  readonly destino?: number | null;
}

/**
 * Quem decide a transferência: outra pessoa, com o pedido pendente e o bem ainda no setor de origem e em uso, e que
 * RECEBE no setor de destino (regra 13; D-ACEITE-546): `centrosQueRecebe` são os centros de custo do escopo de quem
 * decide (o cadastro de centros de custo do usuário); `null` é o usuário sem centro cadastrado, sem restrição de
 * escopo (a mesma regra de escopo de todo o catálogo, M06 regra 6).
 */
export function problemasDaDecisao(
  m: MovimentoParaDecisao,
  bem: Pick<BemParaMovimento, 'situacao' | 'centro'>,
  quem: string,
  versao: number,
  centrosQueRecebe: ReadonlySet<number> | null = null,
): ProblemaMovimento[] {
  const p: ProblemaMovimento[] = [];
  if (m.tipo !== 'transferencia') p.push({ codigo: 'tipo', mensagem: 'Só a transferência espera aceite.' });
  if (m.situacao !== 'pendente')
    p.push({ codigo: 'decidido', mensagem: 'Este pedido já foi decidido ou cancelado.' });
  if (m.versao !== versao)
    p.push({ codigo: 'desatualizado', mensagem: 'O pedido mudou depois que você abriu. Abra de novo.' });
  if (m.solicitadoPor.toUpperCase() === quem.toUpperCase())
    p.push({
      codigo: 'mesmo-usuario',
      mensagem: 'Quem pediu a transferência não aceita nem recusa o próprio pedido.',
    });
  if (
    centrosQueRecebe !== null &&
    (m.destino === null || m.destino === undefined || !centrosQueRecebe.has(m.destino))
  )
    p.push({
      codigo: 'outro-setor',
      mensagem: 'Só quem responde pelo setor de destino aceita ou recusa a transferência.',
    });
  if (bem.situacao !== 'ativo' || bem.centro !== m.origem)
    p.push({ codigo: 'bem-mudou', mensagem: 'O bem não está mais em uso no setor de origem.' });
  return p;
}

/** Só quem pediu cancela, e só o pedido pendente. */
export function problemasDoCancelamento(
  m: MovimentoParaDecisao,
  quem: string,
  versao: number,
): ProblemaMovimento[] {
  const p: ProblemaMovimento[] = [];
  if (m.tipo !== 'transferencia' || m.situacao !== 'pendente')
    p.push({ codigo: 'decidido', mensagem: 'Só o pedido de transferência pendente se cancela.' });
  if (m.versao !== versao)
    p.push({ codigo: 'desatualizado', mensagem: 'O pedido mudou depois que você abriu. Abra de novo.' });
  if (m.solicitadoPor.toUpperCase() !== quem.toUpperCase())
    p.push({ codigo: 'outro-usuario', mensagem: 'Só quem pediu cancela; quem recebe pode recusar.' });
  return p;
}
