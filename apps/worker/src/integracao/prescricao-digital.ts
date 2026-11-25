// Prescrição digital por plataforma externa (F8, 08-INTG L132): o enviador de prescrição do worker. A API grava o
// envio (`envio_prescricao_plataforma`) e a mensagem JSON na fila de saída; aqui o worker entrega exatamente o que foi
// gravado e grava o retorno no envio (identificador, código e endereço de validação; o cancelamento confirmado).
// - Fora de produção, a plataforma é SEMPRE o simulador da regra do domínio (nenhuma receita sai da VM, regra 15).
// - Em produção, o JSON vai por HTTP ao destino configurado do parceiro (adaptador genérico por plataforma), que
//   responde com a situação, o identificador, o código e o endereço de validação.
// - O retorno passa pela regra do domínio: a aceita incompleta é recusada (vira falha da entrega, com o motivo); o
//   retorno de envio cancelado no hospital é ignorado (nada se sobrescreve). O conteúdo nunca vai ao log.
import {
  efeitoDoRetornoPrescricao,
  EVENTO_PRESCRICAO_DIGITAL_CANCELAMENTO,
  EVENTO_PRESCRICAO_DIGITAL_ENVIO,
  lerRetornoPrescricaoDigital,
  type RetornoPrescricaoDigital,
  simularRetornoPrescricaoDigital,
} from '@sgh/dominio-integracao';
import type { Leitor, TxOperacao } from '@sgh/nucleo';
import { ErroEntrega, type Entregue } from './entrega.js';
import type { EnvioEntrega, ParceiroEntrega } from './porta-propria.js';

export const TABELAS_RETORNO_PRESCRICAO: readonly string[] = ['envio_prescricao_plataforma'];
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
  if (efeito.acao === 'recusar') return `recusado: ${efeito.erro.mensagem}`;
  if (efeito.acao === 'ignorar') return `ignorado: ${efeito.motivo}`;
  const campos: Record<string, unknown> = {
    situacao: efeito.situacao,
    situacao_externa: r.situacaoExterna,
    retorno_em: agora,
    conteudo_retorno: JSON.stringify(r),
  };
  if (efeito.situacao !== 'cancelada') campos['enviado_em'] = agora;
  if (r.identificadorExterno) campos['identificador_externo'] = r.identificadorExterno;
  if (r.codigoValidacao) campos['codigo_validacao'] = r.codigoValidacao;
  if (r.urlValidacao) campos['url_validacao'] = r.urlValidacao;
  await tx.alterar('envio_prescricao_plataforma', envio, Number(x['versao']), campos);
  return efeito.situacao;
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
  let retorno: RetornoPrescricaoDigital | null;
  let resposta: string;
  if (c.ambiente !== 'producao') {
    retorno = simularRetornoPrescricaoDigital(m.conteudo);
    resposta = 'simulador';
  } else {
    const destino = c.destinoApi(p.codigo);
    if (!destino) throw new ErroEntrega('parceiro sem destino configurado', m.conteudo);
    const r = await (c.http ?? fetch)(destino, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': e.chaveEvento.slice(0, 120) },
      body: m.conteudo,
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
  if (r0.situacao === 'rejeitada') {
    await c.gravar(hospital, (tx) => gravarRetornoPrescricao(tx, m.envio, r0, c.agora()), {
      operacao: OPERACAO_RETORNO_PRESCRICAO,
      tabelas: TABELAS_RETORNO_PRESCRICAO,
    });
    throw new ErroEntrega(
      `recusada pela plataforma: ${(r0.motivo ?? 'sem motivo').slice(0, 150)}`,
      m.conteudo,
    );
  }
  const aplicado = await c.gravar(hospital, (tx) => gravarRetornoPrescricao(tx, m.envio, r0, c.agora()), {
    operacao: OPERACAO_RETORNO_PRESCRICAO,
    tabelas: TABELAS_RETORNO_PRESCRICAO,
  });
  if (aplicado.startsWith('recusado: ')) throw new ErroEntrega(aplicado.slice(10, 210), m.conteudo);
  return {
    recibo: (r0.identificadorExterno ?? aplicado).slice(0, 120),
    resposta: `${resposta}: ${aplicado}`.slice(0, 200),
    conteudo: m.conteudo,
  };
}
