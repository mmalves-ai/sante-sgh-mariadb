// Cliente da tela da folha da competência, parte F0 (M53.1): apoio, lotes trocados com a folha externa, geração do lote
// (ou as pendências que a barram), download do arquivo do lote (com o CPF: permissão sensível e trilha no servidor),
// importação do retorno com a conferência e os afastamentos. As gravações vão com o CSRF e a Idempotency-Key (uma por
// intenção); Problem Details viram ErroApi com o código da recusa. As respostas seguem os tipos de @sgh/contratos.
import type {
  AlterarAfastamentoEntrada,
  ApoioFolhaInterface,
  GerarExportacaoFolha,
  ListaAfastamentos,
  ListaLotesFolha,
  RegistrarAfastamentoEntrada,
  ResultadoExportacaoFolha,
  ResultadoFolha,
  ResultadoImportacaoFolha,
} from '@sgh/contratos';
import { z } from 'zod';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { enviar, ler, novaChave, qs } from '../exames/api-exames.js';

const F = '/api/pessoas/folha';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

export const lerApoioFolha = () => ler(`${F}/apoio`, confiar<ApoioFolhaInterface>());
export const lerLotesFolha = (f: { empresa?: number | null; competencia?: string | null }) =>
  ler(`${F}/lotes${qs({ empresa: f.empresa, competencia: f.competencia })}`, confiar<ListaLotesFolha>());
export const gerarLoteFolha = (e: GerarExportacaoFolha) =>
  enviar(`${F}/lotes/exportacao`, e, confiar<ResultadoExportacaoFolha>(), novaChave('m53.lote'));
export const importarRetornoFolha = (lote: number, retorno: unknown) =>
  enviar(
    `${F}/lotes/${lote}/retorno`,
    retorno,
    confiar<ResultadoImportacaoFolha>(),
    novaChave('m53.retorno'),
  );

/** O arquivo do lote (JSON com CPF), recriado e conferido pelo servidor; recusa vira ErroApi. */
export async function baixarLoteFolha(lote: number): Promise<{ nome: string; conteudo: Blob }> {
  const r = await fetch(`${F}/lotes/${lote}/arquivo`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw await erroDaResposta(r);
  const disp = r.headers.get('content-disposition') ?? '';
  const nome = /filename="([^"]+)"/.exec(disp)?.[1] ?? `folha_lote${lote}.json`;
  return { nome, conteudo: await r.blob() };
}

export const lerAfastamentos = (f: { competencia?: string | null; vinculo?: number | null }) =>
  ler(
    `${F}/afastamentos${qs({ competencia: f.competencia, vinculo: f.vinculo })}`,
    confiar<ListaAfastamentos>(),
  );
export const registrarAfastamento = (e: RegistrarAfastamentoEntrada) =>
  enviar(`${F}/afastamentos`, e, confiar<ResultadoFolha>(), novaChave('m53.afastamento'));
export const alterarAfastamento = (id: number, e: AlterarAfastamentoEntrada) =>
  enviar(`${F}/afastamentos/${id}`, e, confiar<ResultadoFolha>(), novaChave(`m53.afastamento.${e.acao}`));
