// Cliente da tela das obrigações legais (M53.8, etapa F7): o apoio, os parâmetros por empresa (vigências), a apuração do
// FGTS Digital da competência, a lista e o detalhe das obrigações geradas, a prévia e a geração, o arquivo para o
// programa oficial (leitura auditada no servidor, com CPF, NIS e nome), a entrega e o cancelamento. As gravações vão com
// o CSRF e a Idempotency-Key (uma por intenção); as respostas seguem os tipos de @sgh/contratos.
import type {
  ApoioObrigacoes,
  ApuracaoFgtsDigital,
  CancelarObrigacaoEntrada,
  FiltroApuracaoFgts,
  FiltroObrigacoes,
  GerarObrigacaoEntrada,
  ListaObrigacoes,
  ListaParametrosObrigacoes,
  ObrigacaoLegal,
  ParametrosObrigacoes,
  RegistrarEntregaObrigacaoEntrada,
  ResultadoGeracaoObrigacao,
} from '@sgh/contratos';
import { z } from 'zod';
import { erroDaResposta } from '../../../casca/erros/problem-details.js';
import { enviar, ler, novaChave, qs } from '../../exames/api-exames.js';

const O = '/api/pessoas/obrigacoes';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

export const lerApoioObrigacoes = () => ler(`${O}/apoio`, confiar<ApoioObrigacoes>());
export const lerParametrosObrigacoes = (empresa: number) =>
  ler(`${O}/parametros${qs({ empresa })}`, confiar<ListaParametrosObrigacoes>());
export const registrarParametrosObrigacoes = (e: ParametrosObrigacoes) =>
  enviar(`${O}/parametros`, e, confiar<ListaParametrosObrigacoes>(), novaChave('m53.obrigacao.parametros'));
export const lerApuracaoFgts = (f: FiltroApuracaoFgts) =>
  ler(
    `${O}/fgts-digital${qs({ empresa: f.empresa, competencia: f.competencia })}`,
    confiar<ApuracaoFgtsDigital>(),
  );
export const lerObrigacoes = (f: FiltroObrigacoes) =>
  ler(
    `${O}${qs({ empresa: f.empresa, tipo: f.tipo, ano: f.ano, situacao: f.situacao })}`,
    confiar<ListaObrigacoes>(),
  );
export const lerObrigacao = (id: number) => ler(`${O}/${id}`, confiar<ObrigacaoLegal>());
export const gerarObrigacao = (e: GerarObrigacaoEntrada) =>
  enviar(
    O,
    e,
    confiar<ResultadoGeracaoObrigacao>(),
    novaChave(e.simular ? 'm53.obrigacao.previa' : 'm53.obrigacao'),
  );
export const registrarEntregaObrigacao = (id: number, e: RegistrarEntregaObrigacaoEntrada) =>
  enviar(`${O}/${id}/entrega`, e, confiar<ObrigacaoLegal>(), novaChave('m53.obrigacao.entrega'));
export const cancelarObrigacao = (id: number, e: CancelarObrigacaoEntrada) =>
  enviar(`${O}/${id}/cancelamento`, e, confiar<ObrigacaoLegal>(), novaChave('m53.obrigacao.cancelamento'));

/** O arquivo para o programa oficial (texto), conferido pelo servidor com a soma de verificação; recusa vira ErroApi. */
export async function baixarArquivoObrigacao(id: number): Promise<{ nome: string; conteudo: Blob }> {
  const r = await fetch(`${O}/${id}/arquivo`, { headers: { accept: 'text/plain' } });
  if (!r.ok) throw await erroDaResposta(r);
  const disp = r.headers.get('content-disposition') ?? '';
  const nome = /filename="([^"]+)"/.exec(disp)?.[1] ?? `obrigacao_${id}.txt`;
  return { nome, conteudo: await r.blob() };
}

/** Entrega o arquivo ao navegador (o link temporário some logo depois). */
export function salvarArquivo(a: { nome: string; conteudo: Blob }): void {
  const url = URL.createObjectURL(a.conteudo);
  const link = document.createElement('a');
  link.href = url;
  link.download = a.nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
