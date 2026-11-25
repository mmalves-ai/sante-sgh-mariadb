// Prescrição digital por plataforma externa (F8, 08-INTG L132): o enviador de prescrição do worker. A API grava o
// envio (`envio_prescricao_plataforma`) e a mensagem JSON na fila de saída; aqui o worker entrega exatamente o que foi
// gravado e grava o retorno no envio (identificador, código e endereço de validação; o cancelamento confirmado).
// - Fora de produção, a plataforma é SEMPRE o simulador da regra do domínio (nenhuma receita sai da VM, regra 15).
// - Em produção, o JSON vai por HTTP ao destino configurado do parceiro (adaptador genérico por plataforma), que
//   responde com a situação, o identificador, o código e o endereço de validação.
// - O documento assinado (PDF ou CMS ICP-Brasil) é lido do armazém de arquivos do cliente na hora da entrega
//   (conferido pelo resumo) e vai ANEXADO ao corpo (base64); sem o arquivo, nada é enviado.
// - O retorno passa pela regra do domínio e é resultado FINAL: a rejeição da plataforma e a aceita incompleta ficam no
//   envio (rejeitada / erro, com a resposta guardada) e a mensagem não volta à fila (a receita recusada não é
//   reenviada). A aceita atrasada de envio cancelado no hospital grava o identificador e põe o pedido de cancelamento
//   na fila da plataforma (a receita não fica valendo lá). O conteúdo nunca vai ao log.
import {
  arquivoDoPedidoPrescricao,
  type ArquivoAssinadoEntrega,
  efeitoDoRetornoPrescricao,
  EVENTO_PRESCRICAO_DIGITAL_CANCELAMENTO,
  EVENTO_PRESCRICAO_DIGITAL_ENVIO,
  lerRetornoPrescricaoDigital,
  montarCorpoEntregaPrescricao,
  montarPedidoPrescricaoDigital,
  type RetornoPrescricaoDigital,
  simularRetornoPrescricaoDigital,
} from '@sgh/dominio-integracao';
import { createHash } from 'node:crypto';
import type { Leitor, TxOperacao } from '@sgh/nucleo';
import { ErroEntrega, type Entregue } from './entrega.js';
import type { EnvioEntrega, ParceiroEntrega } from './porta-propria.js';

export const TABELAS_RETORNO_PRESCRICAO: readonly string[] = [
  'envio_prescricao_plataforma',
  'mensagem_integracao_saida',
];
export const OPERACAO_RETORNO_PRESCRICAO = 'integracao.prescricao_digital.retorno';

export const ehEventoPrescricaoDigital = (tipo: string): boolean =>
  tipo === EVENTO_PRESCRICAO_DIGITAL_ENVIO || tipo === EVENTO_PRESCRICAO_DIGITAL_CANCELAMENTO;

export interface MensagemPrescricao {
  readonly envio: number;
  readonly conteudo: string;
}

/** A mensagem gravada do envio de prescrição deste estabelecimento (null: não é dele ou está sem conteúdo). */
export async function mensagemPrescricao(
  l: Leitor,
  hospital: string,
  saida: string,
): Promise<MensagemPrescricao | null> {
  if (!/^\d{1,15}$/.test(saida)) return null;
  const x = await l.uma(
    `SELECT s.conteudo, s.entidade_id FROM mensagem_integracao_saida s JOIN estabelecimento e ON e.id = s.estabelecimento_id
      WHERE s.id = ? AND e.codigo = ? AND s.entidade = 'envio_prescricao_plataforma' AND s.formato = 'json'
        AND s.tipo_mensagem IN (?, ?) AND s.excluido_em IS NULL`,
    [Number(saida), hospital, EVENTO_PRESCRICAO_DIGITAL_ENVIO, EVENTO_PRESCRICAO_DIGITAL_CANCELAMENTO],
  );
  const c = x?.['conteudo'];
  if (typeof c !== 'string' || !c.startsWith('{') || x?.['entidade_id'] == null) return null;
  return { envio: Number(x['entidade_id']), conteudo: c };
}

/** Grava o retorno no envio pela regra do domínio; devolve o efeito aplicado, o motivo de ignorar ou a recusa. */
export async function gravarRetornoPrescricao(
  tx: TxOperacao,
  envio: number,
  r: RetornoPrescricaoDigital,
  agora: Date,
): Promise<string> {
  const [x] = await tx.consultarParaAtualizar(
    'SELECT id, situacao, versao FROM envio_prescricao_plataforma WHERE id = ? AND excluido_em IS NULL',
    [envio],
    { teto: 1 },
  );
  // Sem lançar dentro da transação (o executor traduziria em erro interno): a recusa volta no texto e quem chama lança.
  if (!x) return 'recusado: envio de prescrição não encontrado';
  const efeito = efeitoDoRetornoPrescricao(String(x['situacao']), r);
  if (efeito.acao === 'ignorar') return `ignorado: ${efeito.motivo}`;
  if (efeito.acao === 'cancelar-na-plataforma') {
    // O envio continua cancelado; guarda o identificador e o retorno e põe o cancelamento na fila da plataforma.
    await tx.alterar('envio_prescricao_plataforma', envio, Number(x['versao']), {
      identificador_externo: efeito.identificadorExterno,
      situacao_externa: r.situacaoExterna,
      retorno_em: agora,
      conteudo_retorno: JSON.stringify(r),
    });
    const mensagem = await enfileirarCancelamentoAtrasado(tx, envio, efeito.identificadorExterno);
    return `cancelamento enviado à plataforma (mensagem ${mensagem})`;
  }
  const campos: Record<string, unknown> = {
    situacao: efeito.situacao,
    situacao_externa: r.situacaoExterna,
    retorno_em: agora,
    conteudo_retorno: JSON.stringify(efeito.acao === 'recusar' ? { ...r, recusa: efeito.erro.codigo } : r),
  };
  if (efeito.situacao !== 'cancelada') campos['enviado_em'] = agora;
  if (r.identificadorExterno) campos['identificador_externo'] = r.identificadorExterno;
  // O código e o endereço só da resposta que confere (o incompleto fica só no conteúdo do retorno, nunca na tela).
  if (efeito.acao === 'aplicar' && r.codigoValidacao) campos['codigo_validacao'] = r.codigoValidacao;
  if (efeito.acao === 'aplicar' && r.urlValidacao) campos['url_validacao'] = r.urlValidacao;
  await tx.alterar('envio_prescricao_plataforma', envio, Number(x['versao']), campos);
  return efeito.acao === 'recusar' ? `erro: ${efeito.erro.mensagem}` : efeito.situacao;
}

/**
 * O pedido de cancelamento da receita que a plataforma aceitou depois do cancelamento no hospital: no mesmo ponto da
 * mensagem do envio, com a receita do pedido original (idempotente pela chave do cancelamento do envio).
 */
async function enfileirarCancelamentoAtrasado(
  tx: TxOperacao,
  envio: number,
  identificador: string,
): Promise<number> {
  const [o] = await tx.consultar(
    `SELECT s.id, s.estabelecimento_id, s.ponto_integracao_id, s.sistema_externo_id, s.conteudo, s.tentativas_maximas,
            e.motivo_cancelamento
       FROM envio_prescricao_plataforma e JOIN mensagem_integracao_saida s ON s.id = e.mensagem_integracao_saida_id
      WHERE e.id = ?`,
    [envio],
    { teto: 1 },
  );
  if (!o) return 0;
  const chave = `prescricao-digital:cancelamento:${envio}`;
  const [ja] = await tx.consultar(
    'SELECT id FROM mensagem_integracao_saida WHERE chave_idempotencia = ? AND ponto_integracao_id = ?',
    [chave, Number(o['ponto_integracao_id'])],
    { teto: 1 },
  );
  if (ja) return Number(ja['id']);
  const original = JSON.parse(String(o['conteudo'])) as {
    estabelecimento: string;
    receita: { numero: string; emitidaEm: string; validadeAte: string | null };
  };
  const conteudo = montarPedidoPrescricaoDigital({
    evento: EVENTO_PRESCRICAO_DIGITAL_CANCELAMENTO,
    envio,
    estabelecimento: original.estabelecimento,
    receita: original.receita,
    documento: null,
    identificadorExterno: identificador,
    motivo: String(o['motivo_cancelamento'] ?? 'Cancelada no hospital'),
  });
  return tx.incluir('mensagem_integracao_saida', {
    estabelecimento_id: Number(o['estabelecimento_id']),
    ponto_integracao_id: Number(o['ponto_integracao_id']),
    sistema_externo_id: o['sistema_externo_id'] == null ? null : Number(o['sistema_externo_id']),
    entidade: 'envio_prescricao_plataforma',
    entidade_id: envio,
    chave_idempotencia: chave,
    correlacao: `prescricao-digital.${envio}`.slice(0, 64),
    tipo_mensagem: EVENTO_PRESCRICAO_DIGITAL_CANCELAMENTO,
    formato: 'json',
    conteudo,
    hash_sha256: createHash('sha256').update(conteudo).digest('hex'),
    situacao: 'pendente',
    tentativas: 0,
    tentativas_maximas: Math.max(1, Number(o['tentativas_maximas']) || 5),
  });
}

export interface ConfiguracaoPrescricao {
  readonly ambiente: string;
  readonly destinoApi: (codigo: string) => string | null;
  readonly ler: <T>(hospital: string, fn: (l: Leitor) => Promise<T>) => Promise<T>;
  readonly agora: () => Date;
  /** A gravação do retorno (operação do executor no estabelecimento). Sem ela, nada é entregue. */
  readonly gravar?: <T>(
    hospital: string,
    fn: (tx: TxOperacao) => Promise<T>,
    opcoes: { readonly operacao: string; readonly tabelas: readonly string[] },
  ) => Promise<T>;
  /** O documento assinado lido do armazém de arquivos do cliente (conferido pelo resumo). Sem ele, nada é enviado. */
  readonly lerArquivo?: (hospital: string, id: number) => Promise<ArquivoAssinadoEntrega>;
  /** Testes: o transporte HTTP de produção. */
  readonly http?: typeof fetch;
}

/** Entrega a mensagem de prescrição (simulador fora de produção) e grava o retorno no envio. */
export async function entregarPrescricaoDigital(
  c: ConfiguracaoPrescricao,
  p: ParceiroEntrega,
  e: EnvioEntrega,
  hospital: string,
): Promise<Entregue> {
  if (!c.gravar) throw new ErroEntrega('gravação do retorno da prescrição não configurada: nada enviado');
  const m = await c.ler(hospital, (l) => mensagemPrescricao(l, hospital, e.id));
  if (!m) throw new ErroEntrega('envio de prescrição sem a mensagem gravada: nada enviado');
  // O documento assinado vai anexado ao corpo (lido do armazém; sem o arquivo, nada sai).
  const idArquivo = arquivoDoPedidoPrescricao(m.conteudo);
  let arquivo: ArquivoAssinadoEntrega | null = null;
  if (idArquivo !== null) {
    if (!c.lerArquivo) throw new ErroEntrega('armazém de arquivos não configurado: nada enviado');
    arquivo = await c.lerArquivo(hospital, idArquivo).catch(() => {
      throw new ErroEntrega('documento assinado indisponível no armazém: nada enviado');
    });
  }
  const montado = montarCorpoEntregaPrescricao(m.conteudo, arquivo);
  if ('erro' in montado) throw new ErroEntrega(montado.erro.mensagem);
  let retorno: RetornoPrescricaoDigital | null;
  let resposta: string;
  if (c.ambiente !== 'producao') {
    retorno = simularRetornoPrescricaoDigital(montado.corpo);
    resposta = 'simulador';
  } else {
    const destino = c.destinoApi(p.codigo);
    if (!destino) throw new ErroEntrega('parceiro sem destino configurado', m.conteudo);
    const r = await (c.http ?? fetch)(destino, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': e.chaveEvento.slice(0, 120) },
      body: montado.corpo,
      signal: AbortSignal.timeout(15_000),
    }).catch((x: unknown) => {
      throw new ErroEntrega(`destino indisponível (${x instanceof Error ? x.name : 'erro'})`, m.conteudo);
    });
    if (!r.ok) throw new ErroEntrega(`HTTP ${r.status}`, m.conteudo);
    retorno = lerRetornoPrescricaoDigital(await r.json().catch(() => null));
    resposta = `HTTP ${r.status}`;
  }
  if (!retorno) throw new ErroEntrega('resposta da plataforma não reconhecida', m.conteudo);
  const r0 = retorno;
  // O retorno é resultado final (a rejeição e a aceita incompleta ficam no envio, sem reenvio da receita).
  const aplicado = await c.gravar(hospital, (tx) => gravarRetornoPrescricao(tx, m.envio, r0, c.agora()), {
    operacao: OPERACAO_RETORNO_PRESCRICAO,
    tabelas: TABELAS_RETORNO_PRESCRICAO,
  });
  if (aplicado.startsWith('recusado: ')) throw new ErroEntrega(aplicado.slice(10, 210), m.conteudo);
  const detalhe =
    r0.situacao === 'rejeitada'
      ? `recusada pela plataforma: ${(r0.motivo ?? 'sem motivo').slice(0, 120)}`
      : aplicado;
  return {
    recibo: (r0.identificadorExterno ?? aplicado).slice(0, 120),
    resposta: `${resposta}: ${detalhe}`.slice(0, 200),
    conteudo: m.conteudo,
  };
}
