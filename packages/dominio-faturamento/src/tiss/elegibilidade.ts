// Consulta de elegibilidade do beneficiário junto à operadora (F3.9, 08-INTG L128 (31)). Regras puras: sem banco, sem
// HTTP. A porta (apps/api, tiss/elegibilidade-propria) grava a consulta e a resposta; o envio eletrônico é do worker.
//   - A consulta parte da cobertura do paciente (carteira, validade, plano) e guarda a carteira como foi enviada.
//   - A resposta fecha a consulta: elegível (com o código de validação, quando a operadora devolve), inelegível (com o
//     motivo da negativa: o texto ou o código da terminologia), erro ou sem resposta. Respondida, não muda mais.
//   - Menos cliques: a última consulta elegível da mesma carteira e operadora vale no dia (não se consulta de novo).

export type SituacaoElegibilidade = 'pendente' | 'elegivel' | 'inelegivel' | 'erro' | 'sem_resposta';

export interface ProblemaElegibilidade {
  readonly campo: string;
  readonly mensagem: string;
}

/** O pedido: carteira informada, com até 40 caracteres, e não vencida na data da consulta. */
export function conferirPedidoElegibilidade(p: {
  readonly carteira: string | null;
  readonly validadeCarteira: string | null;
  readonly hoje: string;
}): ProblemaElegibilidade[] {
  const r: ProblemaElegibilidade[] = [];
  const c = p.carteira?.trim() ?? '';
  if (!c) r.push({ campo: 'carteira', mensagem: 'A cobertura não tem o número da carteira.' });
  else if (c.length > 40) r.push({ campo: 'carteira', mensagem: 'A carteira tem no máximo 40 caracteres.' });
  if (p.validadeCarteira && p.validadeCarteira < p.hoje)
    r.push({
      campo: 'validadeCarteira',
      mensagem: 'A carteira está vencida: atualize a cobertura antes de consultar.',
    });
  return r;
}

export interface RespostaElegibilidade {
  readonly situacao: Exclude<SituacaoElegibilidade, 'pendente'>;
  readonly motivoNegativa: string | null;
  readonly motivoGlosa: number | null;
  readonly codigoValidacao: string | null;
}

/** A resposta: só sobre a consulta pendente; a negativa exige o motivo; o código de validação só na elegível. */
export function conferirRespostaElegibilidade(
  atual: SituacaoElegibilidade,
  r: RespostaElegibilidade,
): ProblemaElegibilidade[] {
  const p: ProblemaElegibilidade[] = [];
  if (atual !== 'pendente')
    p.push({ campo: 'consulta', mensagem: 'A consulta já tem resposta: faça uma nova consulta.' });
  if (r.situacao === 'inelegivel' && !r.motivoNegativa?.trim() && r.motivoGlosa === null)
    p.push({ campo: 'motivoNegativa', mensagem: 'A negativa da operadora exige o motivo.' });
  if (r.situacao !== 'elegivel' && r.codigoValidacao?.trim())
    p.push({ campo: 'codigoValidacao', mensagem: 'O código de validação só vem na resposta elegível.' });
  if (r.codigoValidacao && r.codigoValidacao.trim().length > 20)
    p.push({ campo: 'codigoValidacao', mensagem: 'O código de validação tem no máximo 20 caracteres.' });
  return p;
}

/** A última consulta elegível da mesma carteira vale no dia civil da consulta (evita consultar de novo). */
export function elegibilidadeDoDia(
  ultima: {
    readonly situacao: SituacaoElegibilidade;
    readonly dia: string;
    readonly carteira: string;
  } | null,
  carteira: string,
  hoje: string,
): boolean {
  return (
    !!ultima && ultima.situacao === 'elegivel' && ultima.dia === hoje && ultima.carteira === carteira.trim()
  );
}
