// Consulta de elegibilidade pelo serviço web da operadora (C2-070, 06-FAT linha 26; transação TISS de verificação de
// elegibilidade). Regras puras: quando a consulta sai pelo serviço web e como o retorno (o recibo que o transmissor
// deixa na mensagem de integração) vira a resposta da consulta. O envio real só existe com a chave de produção; fora
// dela o transmissor usa destino falso (regra 6), e o caminho é o mesmo.
import type { RespostaElegibilidade, SituacaoElegibilidade } from './elegibilidade.js';

/** O ponto de integração da saída da consulta (outbox). */
export const PONTO_ELEGIBILIDADE = 'tiss.elegibilidade';

export type SituacaoMensagemElegibilidade = 'pendente' | 'enviada' | 'processada' | 'erro' | 'descartada';

export interface ProblemaTransmissaoElegibilidade {
  readonly campo: string;
  readonly mensagem: string;
}

/**
 * Há transporte que entrega a saída TISS neste ambiente? O transmissor do worker só responde com o transmissor ligado;
 * fora de produção o destino é o falso (regra 6); em produção só com o transporte da operadora configurado. Sem
 * transporte nada vai à outbox: a mensagem ficaria 'enviada' para sempre e a recepção sem retorno (C2-070).
 */
export function transporteTissDisponivel(a: {
  readonly transmissorLigado: boolean;
  readonly producao: boolean;
  readonly transporteProducao: boolean;
}): boolean {
  return a.transmissorLigado && (!a.producao || a.transporteProducao);
}

/** Mensagem única para a recepção quando o serviço web está cadastrado mas o ambiente não tem transporte. */
export const SEM_TRANSPORTE_TISS =
  'O envio pelo serviço web da operadora não está disponível neste ambiente: registre a resposta à mão.';

/**
 * A consulta sai pelo serviço web só pendente, ainda não enviada, com o serviço web cadastrado para a fonte e com
 * transporte disponível no ambiente.
 */
export function conferirTransmissaoElegibilidade(c: {
  readonly situacao: SituacaoElegibilidade;
  readonly jaEnviada: boolean;
  readonly servicoWeb: boolean;
  readonly transporte: boolean;
}): ProblemaTransmissaoElegibilidade[] {
  const p: ProblemaTransmissaoElegibilidade[] = [];
  if (c.situacao !== 'pendente')
    p.push({ campo: 'consulta', mensagem: 'A consulta já tem resposta: faça uma nova consulta.' });
  else if (c.jaEnviada)
    p.push({ campo: 'consulta', mensagem: 'A consulta já foi enviada à operadora: leia o retorno.' });
  if (!c.servicoWeb)
    p.push({
      campo: 'canal',
      mensagem: 'A operadora não tem o serviço web de elegibilidade cadastrado: registre a resposta à mão.',
    });
  else if (!c.transporte) p.push({ campo: 'canal', mensagem: SEM_TRANSPORTE_TISS });
  return p;
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const corta = (v: string) => v.slice(0, 2000);

/**
 * O retorno da mensagem de integração como resposta da consulta:
 *   - pendente ou enviada: ainda na fila (null, nada muda);
 *   - erro ou descartada: a consulta fica 'erro' com o código da falha;
 *   - processada: o recibo (JSON com `elegivel`, `motivo` e `codigoValidacao`). Elegível com o código de validação
 *     (até 20 caracteres); negado com o motivo da operadora; sem recibo, 'sem_resposta'; recibo ilegível, 'erro'.
 */
export function respostaElegibilidadeDoRetorno(e: {
  readonly situacaoMensagem: SituacaoMensagemElegibilidade;
  readonly resposta: string | null;
  readonly erro: string | null;
}): RespostaElegibilidade | null {
  const r = (
    situacao: RespostaElegibilidade['situacao'],
    motivoNegativa: string | null,
    codigoValidacao: string | null = null,
  ): RespostaElegibilidade => ({ situacao, motivoNegativa, motivoGlosa: null, codigoValidacao });
  if (e.situacaoMensagem === 'pendente' || e.situacaoMensagem === 'enviada') return null;
  if (e.situacaoMensagem === 'erro' || e.situacaoMensagem === 'descartada')
    return r('erro', corta(`Falha no envio à operadora${e.erro ? ` (${e.erro.slice(0, 200)})` : ''}.`));
  if (!e.resposta?.trim()) return r('sem_resposta', 'A operadora não devolveu resposta.');
  let recibo: unknown;
  try {
    recibo = JSON.parse(e.resposta);
  } catch {
    return r('erro', 'Retorno da operadora ilegível.');
  }
  if (
    !recibo ||
    typeof recibo !== 'object' ||
    typeof (recibo as Record<string, unknown>)['elegivel'] !== 'boolean'
  )
    return r('erro', 'Retorno da operadora ilegível.');
  const x = recibo as Record<string, unknown>;
  if (x['elegivel'] === false)
    return r('inelegivel', corta(texto(x['motivo']) ?? 'Negada pela operadora sem motivo informado.'));
  const codigo = texto(x['codigoValidacao']);
  if (codigo && codigo.length > 20) return r('erro', 'A operadora devolveu código de validação inválido.');
  return r('elegivel', null, codigo);
}
