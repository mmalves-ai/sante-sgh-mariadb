// Ressarcimento ao SUS (M56, etapa 7, F6; Lei 9.656/1998, art. 32): o aviso de beneficiário identificado (ABI) traz os
// atendimentos de beneficiários da operadora no SUS (internação por AIH ou alta complexidade por APAC). A operadora
// analisa cada um na data do atendimento — é beneficiário? o contrato vigia? a carência estava cumprida? o plano cobre o
// atendimento (segmentação)? é cartão de desconto? já foi cobrado em outro aviso? —, decide impugnar (com o motivo) ou
// aceitar dentro do prazo (30 dias corridos do recebimento, parâmetro: D-PRAZO-RESSARC-567), protocola a impugnação
// com o dossiê e registra o resultado e a GRU do que tiver de pagar. A sugestão é só a análise: quem decide é o
// responsável pelos envios.
import {
  type AtendimentoSusEntrada,
  type DecisaoRessarcimento,
  MENSAGENS_ANS,
  type MotivoImpugnacaoSus,
  PARAMETROS_ANS,
  type ParcelaAns,
  type QuadroAns,
  type SegmentacaoProduto,
} from '@sgh/contratos';
import { somarDias } from '../carteirinha.js';
import { avaliarElegibilidade, type DadosElegibilidade } from '../elegibilidade.js';
import { emCentavos, documentoXml, el, opcional, deCentavos, valorNoArquivo } from './comum.js';
import { type CabecalhoAns, cabecalhoXml } from './sib.js';

export const prazoImpugnacao = (
  recebidoEm: string,
  dias: number = PARAMETROS_ANS.diasImpugnacaoRessarcimento,
): string => somarDias(recebidoEm, dias);

export const noPrazo = (recebidoEm: string, hoje: string): boolean => hoje <= prazoImpugnacao(recebidoEm);

export interface BeneficiarioDoAtendimento {
  readonly carteirinha: string;
  readonly dados: DadosElegibilidade;
  readonly segmentacao: SegmentacaoProduto | null;
  readonly coberturaParcial: boolean;
}

const SEM_INTERNACAO: readonly SegmentacaoProduto[] = ['ambulatorial', 'odontologico'];
const SEM_AMBULATORIO: readonly SegmentacaoProduto[] = [
  'hospitalarSemObstetricia',
  'hospitalarComObstetricia',
  'odontologico',
];

/** A sugestão da análise (null: não há o que impugnar; o atendimento deve ser ressarcido). */
export function analisarAtendimentoSus(
  a: Pick<AtendimentoSusEntrada, 'tipo' | 'inicio'>,
  b: BeneficiarioDoAtendimento | null,
  jaCobrado = false,
): MotivoImpugnacaoSus | null {
  if (jaCobrado) return 'duplicidade';
  if (!b) return 'naoBeneficiario';
  if (b.dados.produto.natureza === 'cartaoDesconto') return 'cartaoDesconto';
  const eleg = avaliarElegibilidade(b.carteirinha, b.dados, a.inicio);
  if (eleg.motivos.includes('carteirinha-invalida')) return 'naoBeneficiario';
  if (
    eleg.motivos.some((m) =>
      [
        'beneficiario-excluido',
        'contrato-inativo',
        'contrato-fora-da-vigencia',
        'antes-da-inclusao',
      ].includes(m),
    )
  )
    return 'foraDaVigencia';
  const pendente = (t: string) => eleg.carencias.some((c) => c.tipo === t && !c.cumprida);
  if (pendente('demais')) return 'carencia';
  if (b.coberturaParcial && pendente('cpt')) return 'cpt';
  const s = b.segmentacao;
  if (s && a.tipo === 'AIH' && SEM_INTERNACAO.includes(s)) return 'segmentacao';
  if (s && a.tipo === 'APAC' && SEM_AMBULATORIO.includes(s)) return 'segmentacao';
  return null;
}

/** Problemas do aviso registrado (atendimento repetido, período, atendimento depois do aviso). */
export function problemasDoAviso(
  recebidoEm: string,
  atendimentos: readonly Pick<AtendimentoSusEntrada, 'tipo' | 'numero' | 'inicio' | 'fim'>[],
): string[] {
  const p = new Set<string>();
  const vistos = new Set<string>();
  for (const a of atendimentos) {
    const k = `${a.tipo}${a.numero}`;
    if (vistos.has(k)) p.add('atendimento-repetido');
    vistos.add(k);
    if (a.fim < a.inicio) p.add('periodo-invalido');
    if (a.inicio > recebidoEm) p.add('atendimento-depois-do-aviso');
  }
  return [...p];
}

export function problemasDaDecisao(
  d: {
    readonly decisao: 'impugnar' | 'aceitar';
    readonly motivo: MotivoImpugnacaoSus | null;
    readonly justificativa: string | null;
  },
  dentroDoPrazo: boolean,
): string[] {
  if (d.decisao === 'aceitar') return [];
  if (!dentroDoPrazo) return ['prazo-vencido'];
  if (!d.motivo) return ['impugnacao-sem-motivo'];
  if (d.motivo === 'outro' && !d.justificativa?.trim()) return ['impugnacao-sem-justificativa'];
  return [];
}

export interface ItemRessarcimento {
  readonly ordem: number;
  readonly tipo: 'AIH' | 'APAC';
  readonly numero: string;
  readonly identificacao: string;
  readonly inicio: string;
  readonly fim: string;
  readonly procedimento: string;
  readonly valor: number;
  readonly sugestao: MotivoImpugnacaoSus | null;
  readonly decisao: DecisaoRessarcimento;
  readonly motivo: MotivoImpugnacaoSus | null;
  readonly justificativa: string | null;
  /** Retorno da ANS: a impugnação deferida (true), indeferida (false) ou ainda sem resultado (null). */
  readonly deferida: boolean | null;
}

export const todosDecididos = (itens: readonly Pick<ItemRessarcimento, 'decisao'>[]): boolean =>
  itens.length > 0 && itens.every((i) => i.decisao !== 'pendente');

/** O valor a ressarcir: o aceito pela operadora e o impugnado sem deferimento (depois do retorno). */
export function valorDevido(itens: readonly ItemRessarcimento[]): number {
  return deCentavos(
    itens
      .filter((i) => i.decisao === 'aceitar' || (i.decisao === 'impugnar' && i.deferida === false))
      .reduce((a, i) => a + emCentavos(i.valor), 0),
  );
}

export function quadrosRessarcimento(itens: readonly ItemRessarcimento[]): QuadroAns[] {
  const soma = (f: (i: ItemRessarcimento) => boolean) => {
    const xs = itens.filter(f);
    return { c: xs.reduce((a, i) => a + emCentavos(i.valor), 0), q: xs.length };
  };
  const aceitos = soma((i) => i.decisao === 'aceitar');
  const impugnados = soma((i) => i.decisao === 'impugnar');
  const pendentes = soma((i) => i.decisao === 'pendente');
  const total = soma(() => true);
  const parcelas: ParcelaAns[] = [
    { rotulo: 'Aceitos (a ressarcir)', valor: deCentavos(aceitos.c), quantidade: aceitos.q },
    { rotulo: 'Impugnados', valor: deCentavos(impugnados.c), quantidade: impugnados.q },
    { rotulo: 'Sem decisão', valor: deCentavos(pendentes.c), quantidade: pendentes.q },
  ];
  return [
    {
      titulo: 'Atendimentos do aviso',
      parcelas,
      total: { rotulo: 'Total cobrado', valor: deCentavos(total.c), quantidade: total.q },
    },
  ];
}

/** O dossiê da impugnação (o que se protocola na ANS), com a decisão de cada atendimento. */
export function arquivoRessarcimento(
  cab: CabecalhoAns,
  aviso: { readonly numero: string; readonly recebidoEm: string },
  itens: readonly ItemRessarcimento[],
): string {
  return documentoXml(
    el('impugnacaoRessarcimento', [
      cabecalhoXml(cab, itens.length, [el('aviso', aviso.numero), el('recebidoEm', aviso.recebidoEm)]),
      el(
        'atendimentos',
        itens.map((i) =>
          el(
            'atendimento',
            [
              el('tipo', i.tipo),
              el('numero', i.numero),
              el('identificacao', i.identificacao),
              el('inicio', i.inicio),
              el('fim', i.fim),
              el('procedimento', i.procedimento),
              el('valor', valorNoArquivo(i.valor)),
              el('decisao', i.decisao),
              opcional('motivo', i.motivo),
              opcional('fundamento', i.motivo ? MENSAGENS_IMPUGNACAO[i.motivo] : null),
              opcional('justificativa', i.justificativa),
            ],
            { ordem: i.ordem },
          ),
        ),
      ),
    ]),
  );
}

const MENSAGENS_IMPUGNACAO: Readonly<Record<MotivoImpugnacaoSus, string>> = {
  naoBeneficiario: 'Pessoa sem vínculo com a operadora na data do atendimento',
  foraDaVigencia: 'Vínculo encerrado ou ainda não iniciado na data do atendimento',
  carencia: 'Carência contratual não cumprida na data do atendimento',
  cpt: 'Cobertura parcial temporária vigente para doença ou lesão preexistente',
  segmentacao: 'Atendimento fora da segmentação assistencial contratada',
  abrangencia: 'Atendimento fora da área geográfica de abrangência do plano',
  cartaoDesconto: 'Produto sem natureza de plano de saúde',
  duplicidade: 'Atendimento já cobrado em aviso anterior',
  outro: 'Motivo descrito na justificativa',
};

/** O texto da recusa (o mesmo da API e da tela). */
export const mensagemAns = (codigo: string): string => MENSAGENS_ANS[codigo] ?? codigo;
