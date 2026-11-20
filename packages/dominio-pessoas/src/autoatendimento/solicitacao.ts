// W0-06, parte 6 (programa CRUD completo, M3 de mercado): as regras puras das solicitações do autoatendimento do
// colaborador (férias, abono, ajuste de ponto, alteração cadastral e atestado), antes de gravar. A API relê o estado na
// transação e o banco confere de novo (CHECKs do script 1067). O "hoje" vem de quem chama.
//   - férias: aqui só a forma do pedido (dias de gozo 5 a 30, abono até 10, início não no passado); na aprovação a
//     programação passa pela conferência completa da CLT (art. 134: até três frações, uma de 14 dias ou mais, nenhuma
//     com menos de 5, sem começar nos dois dias antes do descanso; art. 143: abono de até 1/3), `conferirProgramacao`;
//   - abono e atestado: o intervalo vira um ajuste `justificativa` por dia no ponto (D-W006-SOLIC-EFEITO), com teto;
//     o atestado acima de 15 dias avisa o RH do afastamento pelo INSS (Lei 8.213, art. 60, §3º), sem gerá-lo sozinho;
//   - ajuste de ponto: um dia já vivido (não se ajusta o futuro);
//   - alteração cadastral: só o que o cadastro do colaborador guarda aqui (D-W006-SOLIC-CADASTRO);
//   - decisão: de outra pessoa (o gestor), nunca de quem pediu; desistência: só de quem pediu; as duas só da pendente.
import {
  CAMPOS_ALTERACAO_CADASTRAL_PESSOA,
  type SituacaoSolicitacaoPessoaContrato,
  type TipoSolicitacaoPessoaContrato,
} from '@sgh/contratos';
import { diaUtc, diasEntre } from '../datas.js';
import { type RecusaSesmt, recusaSesmt } from '../sesmt/recusa.js';

export type TipoSolicitacaoPessoa = TipoSolicitacaoPessoaContrato;
export type SituacaoSolicitacaoPessoa = SituacaoSolicitacaoPessoaContrato;

/** Campos que o colaborador pode pedir para corrigir (o que o cadastro do colaborador guarda neste sistema). */
export const CAMPOS_ALTERACAO_CADASTRAL: readonly string[] = Object.keys(CAMPOS_ALTERACAO_CADASTRAL_PESSOA);

/** Teto de dias do abono numa solicitação (um ajuste por dia no ponto). */
export const DIAS_MAXIMOS_ABONO = 31;
/** Teto de dias do atestado (CHECK do banco: 1 a 365). */
export const DIAS_MAXIMOS_ATESTADO = 365;
/** A partir daqui o afastamento é do INSS (Lei 8.213/1991, art. 60, §3º: a empresa paga os primeiros 15 dias). */
export const DIAS_ATESTADO_EMPRESA = 15;
/** Quanto tempo depois do dia o ajuste ou o abono ainda pode ser pedido (o fechamento do ponto decide o resto). */
export const DIAS_RETROATIVOS_MAXIMOS = 90;

export interface PedidoSolicitacao {
  readonly tipo: TipoSolicitacaoPessoa;
  readonly inicio: string | null;
  readonly fim: string | null;
  readonly diasGozo: number | null;
  readonly diasAbono: number | null;
  readonly campo: string | null;
  readonly valorNovo: string | null;
  /** Só no atestado. */
  readonly atestado: { readonly emitidoEm: string; readonly dias: number } | null;
}

export type AvisoSolicitacao = 'atestado-acima-de-15-dias';

export interface SolicitacaoConferida {
  readonly recusas: readonly RecusaSesmt[];
  readonly avisos: readonly AvisoSolicitacao[];
  /** Os dias que viram ajuste `justificativa` no ponto (abono e atestado), em ordem. */
  readonly dias: readonly string[];
}

function maisDias(dia: string, n: number): string {
  return new Date((diaUtc(dia) + n) * 86_400_000).toISOString().slice(0, 10);
}

/** Os dias de `inicio` a `fim`, inclusive (vazio se `fim` vier antes). */
export function diasDaSolicitacao(inicio: string, fim: string): string[] {
  const n = diasEntre(inicio, fim);
  return n < 0 ? [] : Array.from({ length: n + 1 }, (_, i) => maisDias(inicio, i));
}

const R = recusaSesmt;

/** Confere a forma do pedido antes de gravar. Sem recusa, `dias` traz o que vira ajuste no ponto. */
export function conferirSolicitacao(p: PedidoSolicitacao, hoje: string): SolicitacaoConferida {
  const recusas: RecusaSesmt[] = [];
  const avisos: AvisoSolicitacao[] = [];
  let dias: string[] = [];
  const passado = (d: string) => diasEntre(d, hoje) > DIAS_RETROATIVOS_MAXIMOS;
  switch (p.tipo) {
    case 'ferias': {
      if (p.inicio === null)
        recusas.push(R('inicio-obrigatorio', 'Informe o primeiro dia das férias.', 'inicio'));
      else if (diaUtc(p.inicio) < diaUtc(hoje))
        recusas.push(R('inicio-no-passado', 'As férias pedidas começam hoje ou depois.', 'inicio'));
      if (p.diasGozo === null || p.diasGozo < 5 || p.diasGozo > 30)
        recusas.push(R('dias-gozo', 'Os dias de gozo vão de 5 a 30 (CLT, art. 134, §1º).', 'diasGozo'));
      if (p.diasAbono !== null && (p.diasAbono < 0 || p.diasAbono > 10))
        recusas.push(
          R(
            'dias-abono',
            'O abono pecuniário vai até 10 dias, um terço das férias (CLT, art. 143).',
            'diasAbono',
          ),
        );
      break;
    }
    case 'abono':
    case 'atestado': {
      if (p.inicio === null || p.fim === null) {
        recusas.push(R('periodo-obrigatorio', 'Informe o primeiro e o último dia.', 'inicio'));
        break;
      }
      if (diaUtc(p.fim) < diaUtc(p.inicio)) {
        recusas.push(R('fim-antes-do-inicio', 'O último dia vem depois do primeiro.', 'fim'));
        break;
      }
      dias = diasDaSolicitacao(p.inicio, p.fim);
      if (passado(p.inicio))
        recusas.push(
          R(
            'periodo-antigo',
            `O pedido vale para até ${DIAS_RETROATIVOS_MAXIMOS} dias atrás. Fale com o RH.`,
            'inicio',
          ),
        );
      if (p.tipo === 'abono') {
        if (dias.length > DIAS_MAXIMOS_ABONO)
          recusas.push(R('periodo-longo', `O abono vai até ${DIAS_MAXIMOS_ABONO} dias por pedido.`, 'fim'));
        break;
      }
      const a = p.atestado;
      if (a === null) {
        recusas.push(R('atestado-obrigatorio', 'Informe os dados do atestado.', 'atestado'));
        break;
      }
      if (a.dias < 1 || a.dias > DIAS_MAXIMOS_ATESTADO)
        recusas.push(
          R('atestado-dias', `O atestado vai de 1 a ${DIAS_MAXIMOS_ATESTADO} dias.`, 'atestado.dias'),
        );
      if (diaUtc(a.emitidoEm) > diaUtc(hoje))
        recusas.push(
          R(
            'atestado-emissao-futura',
            'A data de emissão não pode ser depois de hoje.',
            'atestado.emitidoEm',
          ),
        );
      if (diaUtc(p.inicio) < diaUtc(a.emitidoEm) - 1)
        recusas.push(
          R('atestado-antes-da-emissao', 'O afastamento começa no dia da emissão ou no anterior.', 'inicio'),
        );
      if (dias.length > a.dias)
        recusas.push(R('periodo-maior-que-atestado', 'O período passa dos dias do atestado.', 'fim'));
      if (a.dias > DIAS_ATESTADO_EMPRESA) avisos.push('atestado-acima-de-15-dias');
      break;
    }
    case 'ajuste_ponto': {
      if (p.inicio === null) recusas.push(R('dia-obrigatorio', 'Informe o dia do ajuste.', 'inicio'));
      else if (diaUtc(p.inicio) > diaUtc(hoje))
        recusas.push(R('ajuste-no-futuro', 'O ajuste é de um dia que já passou ou de hoje.', 'inicio'));
      else if (passado(p.inicio))
        recusas.push(
          R(
            'periodo-antigo',
            `O pedido vale para até ${DIAS_RETROATIVOS_MAXIMOS} dias atrás. Fale com o RH.`,
            'inicio',
          ),
        );
      break;
    }
    case 'alteracao_cadastral': {
      if (p.campo === null || !CAMPOS_ALTERACAO_CADASTRAL.includes(p.campo))
        recusas.push(R('campo-invalido', 'Escolha o dado do cadastro que quer corrigir.', 'campo'));
      if (p.valorNovo === null || p.valorNovo.trim() === '')
        recusas.push(R('valor-obrigatorio', 'Informe o valor correto.', 'valorNovo'));
      break;
    }
  }
  return { recusas, avisos, dias: recusas.length === 0 ? dias : [] };
}

export interface SolicitacaoParaDecidir {
  readonly situacao: SituacaoSolicitacaoPessoa;
  readonly pedidoPor: string;
}

const mesmo = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/** A decisão (aprovar ou recusar) é de outra pessoa e só da pendente. */
export function recusaDecisaoSolicitacao(s: SolicitacaoParaDecidir, login: string): RecusaSesmt | null {
  if (s.situacao !== 'pendente') return R('solicitacao-ja-decidida', 'A solicitação não está mais pendente.');
  if (mesmo(s.pedidoPor, login))
    return R(
      'solicitacao-decisao-pelo-solicitante',
      'Quem pediu não decide a própria solicitação: a aprovação ou a recusa é de outra pessoa (o gestor).',
    );
  return null;
}

/** A desistência é só de quem pediu e só da pendente. */
export function recusaDesistenciaSolicitacao(s: SolicitacaoParaDecidir, login: string): RecusaSesmt | null {
  if (!mesmo(s.pedidoPor, login))
    return R(
      'solicitacao-desistencia-so-do-solicitante',
      'Só quem pediu pode desistir da solicitação. O gestor aprova ou recusa, com o motivo.',
    );
  if (s.situacao !== 'pendente') return R('solicitacao-ja-decidida', 'A solicitação não está mais pendente.');
  return null;
}
