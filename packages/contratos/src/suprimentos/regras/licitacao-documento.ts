// Documentos do processo formal de compra (ficha do M55, etapa 4; regra 10; cap-07 §7.3): o termo de referência, o
// registro da etapa (os atos até aqui) e a ata do julgamento, montados do detalhe do processo e emitidos em PDF/A
// pelo módulo de documentos do M09 (armazenamento imutável com Object Lock, SHA-256 e QR de validação). Função pura:
// o conteúdo é o do detalhe já filtrado pelo sigilo (o orçamento sigiloso não sai antes do julgamento).
import { z } from 'zod';
import {
  CRITERIOS_JULGAMENTO,
  ETAPAS_LICITACAO,
  type LicitacaoDetalhe,
  MODALIDADES_LICITACAO,
  NATUREZAS_OBJETO_LICITACAO,
  REGIMES_LICITACAO,
  RESULTADOS_ITEM_LICITACAO,
  TIPOS_EVENTO_LICITACAO,
} from '../licitacao.js';

export const TIPOS_DOCUMENTO_LICITACAO = [
  { codigo: 'termo', rotulo: 'Termo de referência', modelo: 'licitacao-termo' },
  { codigo: 'etapa', rotulo: 'Registro da etapa do processo', modelo: 'licitacao-etapa' },
  { codigo: 'ata', rotulo: 'Ata do julgamento', modelo: 'licitacao-ata' },
] as const;
export type TipoDocumentoLicitacao = (typeof TIPOS_DOCUMENTO_LICITACAO)[number]['codigo'];

/** A chave do pedido é aceita (o cliente a manda em todo POST) e não é usada: cada emissão é um documento novo. */
export const esquemaEmitirDocumentoLicitacao = z
  .object({ tipo: z.enum(['termo', 'etapa', 'ata']), chave: z.string().max(80).optional() })
  .strict();
export type EmitirDocumentoLicitacaoEntrada = z.infer<typeof esquemaEmitirDocumentoLicitacao>;

/** Versão do modelo impressa no documento (sobe quando o conteúdo muda). */
export const VERSAO_MODELO_DOCUMENTO_LICITACAO = '2';

/** As etapas em que a ata do julgamento existe. */
const ETAPAS_COM_ATA = ['julgado', 'recurso', 'homologado', 'fracassado', 'deserto'] as const;

export interface CampoDocumentoLicitacao {
  readonly rotulo: string;
  readonly valor: string;
}

export interface DocumentoLicitacao {
  readonly tipo: TipoDocumentoLicitacao;
  readonly modelo: string;
  readonly titulo: string;
  readonly campos: readonly CampoDocumentoLicitacao[];
  readonly nomeArquivo: string;
}

export type DocumentoLicitacaoMontado =
  | { readonly ok: true; readonly documento: DocumentoLicitacao }
  | { readonly ok: false; readonly motivo: string };

const rotulo = (lista: readonly { codigo: string; rotulo: string }[], c: string | null): string =>
  c === null ? 'Não informado' : (lista.find((x) => x.codigo === c)?.rotulo ?? c);

const dinheiro = (v: number | null): string =>
  v === null
    ? 'Não informado'
    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const data = (v: string | null): string =>
  v ? v.slice(0, 10).split('-').reverse().join('/') : 'Não informada';

const numeroQtd = (v: number): string =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 }).format(v);

function cabecalho(d: LicitacaoDetalhe): CampoDocumentoLicitacao[] {
  const p = d.processo;
  return [
    { rotulo: 'Processo', valor: p.numero },
    { rotulo: 'Regime', valor: rotulo(REGIMES_LICITACAO, p.regime) },
    { rotulo: 'Modalidade', valor: rotulo(MODALIDADES_LICITACAO, p.modalidade) },
    { rotulo: 'Critério de julgamento', valor: rotulo(CRITERIOS_JULGAMENTO, p.criterio) },
    { rotulo: 'Objeto', valor: p.objeto },
    { rotulo: 'Etapa', valor: rotulo(ETAPAS_LICITACAO, p.etapa) },
  ];
}

/** O orçamento sigiloso (art. 24) antes do julgamento: o documento sai sem os valores, seja quem for o emissor. */
const sigilosoAberto = (d: LicitacaoDetalhe): boolean => d.processo.sigiloso && !d.processo.dataJulgamento;

const SIGILO = 'Sigiloso até o julgamento';

function termo(d: LicitacaoDetalhe): CampoDocumentoLicitacao[] {
  const p = d.processo;
  const sigilo = sigilosoAberto(d);
  const campos = [
    ...cabecalho(d),
    { rotulo: 'Natureza do objeto', valor: rotulo(NATUREZAS_OBJETO_LICITACAO, p.natureza) },
    { rotulo: 'Justificativa', valor: p.justificativa },
    { rotulo: 'Fundamento', valor: p.fundamento ?? 'Não informado' },
    { rotulo: 'Agente de contratação', valor: p.agente },
    { rotulo: 'Orçamento', valor: p.sigiloso ? 'Sigiloso até o julgamento' : 'Público' },
  ];
  if (p.pesoTecnica !== null) campos.push({ rotulo: 'Peso da técnica', valor: `${p.pesoTecnica}%` });
  for (const i of d.itensDetalhe)
    campos.push({
      rotulo: `Item ${i.numero}`,
      valor:
        `${i.descricao}: ${numeroQtd(i.quantidade)} ${i.unidade}` +
        (sigilo ? '' : `; valor unitário estimado ${dinheiro(i.valorEstimado)}`),
    });
  campos.push({ rotulo: 'Valor estimado', valor: sigilo ? SIGILO : dinheiro(d.processo.valorEstimado) });
  if (!sigilo) campos.push({ rotulo: 'Conta da estimativa', valor: d.estimativa.conta });
  return campos;
}

function etapa(d: LicitacaoDetalhe): CampoDocumentoLicitacao[] {
  const campos = [...cabecalho(d)];
  campos.push({ rotulo: 'Publicação do aviso', valor: data(d.processo.dataPublicacao) });
  campos.push({ rotulo: 'Abertura da sessão', valor: data(d.processo.dataAbertura) });
  if (d.eventos.length === 0) campos.push({ rotulo: 'Atos', valor: 'Nenhum ato registrado até aqui.' });
  const sigilo = sigilosoAberto(d);
  for (const e of d.eventos) {
    // A saída da pesquisa grava a conta da estimativa na descrição: no sigiloso, fica fora até o julgamento.
    const descricao =
      sigilo && e.tipo === 'etapa' && e.de === 'pesquisa'
        ? `Pesquisa de preços concluída. ${SIGILO}.`
        : e.descricao;
    const mudanca = e.para
      ? ` (${rotulo(ETAPAS_LICITACAO, e.de)} para ${rotulo(ETAPAS_LICITACAO, e.para)})`
      : '';
    campos.push({
      rotulo: `${data(e.criadoEm)} ${rotulo(TIPOS_EVENTO_LICITACAO, e.tipo)}`,
      valor: `${descricao}${mudanca}; por ${e.usuario}`,
    });
  }
  return campos;
}

function ata(d: LicitacaoDetalhe): CampoDocumentoLicitacao[] {
  const campos = [...cabecalho(d)];
  campos.push({ rotulo: 'Abertura da sessão', valor: data(d.processo.dataAbertura) });
  campos.push({ rotulo: 'Julgado em', valor: data(d.processo.dataJulgamento) });
  campos.push({ rotulo: 'Julgado por', valor: d.processo.julgadoPor ?? 'Não informado' });
  const nomes = new Map(d.propostas.map((x) => [x.fornecedor, x.fornecedorNome]));
  const j = d.julgamento;
  for (const i of d.itensDetalhe) {
    const ji = j?.itens.find((x) => x.item === i.id) ?? null;
    const resultado = ji?.resultado ?? i.resultado;
    const vencedor = ji?.vencedor ?? i.vencedor;
    const valor = ji?.valorUnitario ?? i.valorAdjudicado;
    const propostas = d.propostas.filter((x) => x.item === i.id).length;
    campos.push({
      rotulo: `Item ${i.numero}`,
      valor:
        `${i.descricao}: ${rotulo(RESULTADOS_ITEM_LICITACAO, resultado)}` +
        (vencedor !== null
          ? `; vencedor ${nomes.get(vencedor) ?? `fornecedor ${vencedor}`} a ${dinheiro(valor)} por ${i.unidade}`
          : '') +
        `; ${propostas} proposta(s)`,
    });
  }
  for (const x of d.propostas.filter((p) => p.situacao !== 'valida'))
    campos.push({
      rotulo: `Proposta de ${x.fornecedorNome}`,
      valor: `${x.situacao === 'inabilitada' ? 'Inabilitada' : 'Desclassificada'}: ${x.motivo ?? 'sem motivo'}`,
    });
  if (j) campos.push({ rotulo: 'Valor total adjudicado', valor: `${dinheiro(j.valorTotal)} (${j.conta})` });
  if (d.prazoRecursoAte) campos.push({ rotulo: 'Prazo de recurso até', valor: data(d.prazoRecursoAte) });
  if (d.processo.homologadoPor)
    campos.push({
      rotulo: 'Homologado',
      valor: `por ${d.processo.homologadoPor} em ${data(d.processo.homologadoEm)}`,
    });
  return campos;
}

/** O documento pedido do processo, ou o motivo de não haver (a ata só existe depois do julgamento). */
export function documentoLicitacao(
  d: LicitacaoDetalhe,
  tipo: TipoDocumentoLicitacao,
): DocumentoLicitacaoMontado {
  const t = TIPOS_DOCUMENTO_LICITACAO.find((x) => x.codigo === tipo)!;
  if (tipo === 'ata' && !(ETAPAS_COM_ATA as readonly string[]).includes(d.processo.etapa))
    return {
      ok: false,
      motivo: 'A ata só existe depois do julgamento (ou do fracasso ou deserção) do processo.',
    };
  const campos = tipo === 'termo' ? termo(d) : tipo === 'etapa' ? etapa(d) : ata(d);
  const seguro = d.processo.numero.replace(/[^A-Za-z0-9-]/g, '-');
  return {
    ok: true,
    documento: {
      tipo,
      modelo: t.modelo,
      titulo: `${t.rotulo} ${d.processo.numero}`,
      campos,
      nomeArquivo: `${t.modelo}-${seguro}${tipo === 'etapa' ? `-${d.processo.etapa}` : ''}.pdf`,
    },
  };
}

/** O documento emitido que fica ligado ao processo (o evento `documento`; regra 10). */
export interface DocumentoEmitidoLicitacao {
  readonly tipo: TipoDocumentoLicitacao;
  /** O número da emissão no serviço de documentos (vai na referência do evento). */
  readonly emissao: string;
  readonly sha256: string;
  readonly identificadorQr: string;
  /** A etapa do processo na emissão (o registro da etapa é desta etapa). */
  readonly etapa: string;
}

/** A descrição do evento `documento`: o que é, de que etapa, o SHA-256 e o código de validação. */
export function descricaoDocumentoLicitacao(d: DocumentoEmitidoLicitacao): string {
  const t = TIPOS_DOCUMENTO_LICITACAO.find((x) => x.codigo === d.tipo)!;
  return `${t.rotulo} em PDF/A (etapa ${rotulo(ETAPAS_LICITACAO, d.etapa)}); SHA-256 ${d.sha256}; código de validação ${d.identificadorQr}`;
}
