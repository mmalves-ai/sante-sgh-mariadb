// Cliente das telas da contabilidade, etapa 3 (M54-F3): as demonstrações (balancete, diário, DRE, balanço), a prévia e
// a apuração do resultado do exercício (crítica: a senha de novo), a exportação em PDF/A ou XLSX (leitura auditada no
// servidor) e o SPED contábil (apoio, arquivos, prévia, gerar, baixar e a situação). As gravações vão com o CSRF e a
// Idempotency-Key (uma por intenção); as respostas são os tipos de @sgh/contratos (ROTAS_CONTABIL_F3), conferidos só na
// forma.
import {
  type SignatariosSped,
  type ApoioDemonstracoes,
  type ApoioSped,
  type ArquivoSpedBaixado,
  type ArquivoSpedListado,
  type ArquivosSped,
  type Balancete,
  type Balanco,
  type Diario,
  type Dre,
  type PreviaApuracao,
  type PreviaSped,
  type ResultadoApuracao,
  type ResultadoSped,
  ROTAS_CONTABIL_F3 as R,
  type TipoArquivoSped,
  type TipoDemonstracao,
} from '@sgh/contratos';
import { z } from 'zod';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { enviar, ler, qs } from '../exames/api-exames.js';
import { novaChave } from './api-contabil.js';
import type { CorpoGerarSped } from './comum-demonstracoes.js';

const A = '/api';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
const url = (r: { caminho: string }) => `${A}/${r.caminho}`;

export const lerApoioDemonstracoes = (empresa: number) =>
  ler(`${url(R.apoio)}${qs({ empresa })}`, confiar<ApoioDemonstracoes>());

export interface FiltroBalanceteTela {
  readonly empresa: number;
  readonly de: string;
  readonly ate: string;
  readonly nivel: number | null;
  readonly incluirZeradas: boolean;
  readonly centroCusto: number | null;
}
export interface FiltroDiarioTela {
  readonly empresa: number;
  readonly de: string;
  readonly ate: string;
  readonly pagina: number;
}
export interface FiltroDreTela {
  readonly empresa: number;
  readonly de: string;
  readonly ate: string;
}
export interface FiltroBalancoTela {
  readonly empresa: number;
  readonly competencia: string;
}

export const lerBalancete = (f: FiltroBalanceteTela) =>
  ler(
    `${url(R.balancete)}${qs({ ...f, incluirZeradas: f.incluirZeradas ? 'true' : null })}`,
    confiar<Balancete>(),
  );
export const lerDiario = (f: FiltroDiarioTela) => ler(`${url(R.diario)}${qs({ ...f })}`, confiar<Diario>());
export const lerDre = (f: FiltroDreTela) => ler(`${url(R.dre)}${qs({ ...f })}`, confiar<Dre>());
export const lerBalanco = (f: FiltroBalancoTela) =>
  ler(`${url(R.balanco)}${qs({ ...f })}`, confiar<Balanco>());

export const lerPreviaApuracao = (empresa: number, exercicio: number) =>
  ler(`${url(R.apuracao)}${qs({ empresa, exercicio })}`, confiar<PreviaApuracao>());

export const apurarResultado = (a: {
  empresa: number;
  exercicio: number;
  contaDestino: string;
  observacao: string | null;
  senha: string;
}) => enviar(url(R.apurar), a, confiar<ResultadoApuracao>(), novaChave('apurar'));

export type FormatoExportacao = 'pdf' | 'xlsx';
export type FiltroExportacao =
  | ({ readonly tipo: 'balancete' } & FiltroBalanceteTela)
  | ({ readonly tipo: 'diario' } & Omit<FiltroDiarioTela, 'pagina'>)
  | ({ readonly tipo: 'dre' } & FiltroDreTela)
  | ({ readonly tipo: 'balanco' } & FiltroBalancoTela);

/** O endereço da exportação (o mesmo filtro da tela; o diário sai inteiro, sem a página). */
export function urlExportacao(f: FiltroExportacao, formato: FormatoExportacao): string {
  const { tipo, ...resto } = f;
  const filtro: Record<string, string | number | null | boolean> = { ...resto };
  if ('incluirZeradas' in filtro)
    filtro['incluirZeradas'] = f.tipo === 'balancete' && f.incluirZeradas ? 'true' : null;
  return `${url(R.exportar)}${qs({ tipo, formato, ...filtro })}`;
}

/** O arquivo exportado (PDF/A ou XLSX); a recusa do servidor vira ErroApi. */
export async function exportarDemonstracao(
  f: FiltroExportacao,
  formato: FormatoExportacao,
): Promise<{ nome: string; conteudo: Blob }> {
  const r = await fetch(urlExportacao(f, formato));
  if (!r.ok) throw await erroDaResposta(r);
  const disp = r.headers.get('content-disposition') ?? '';
  const nome = /filename="([^"]+)"/.exec(disp)?.[1] ?? `${f.tipo as TipoDemonstracao}.${formato}`;
  return { nome, conteudo: await r.blob() };
}

// ── SPED ─────────────────────────────────────────────────────────────────────────────────────────

export const lerApoioSped = (empresa: number) =>
  ler(`${url(R.spedApoio)}${qs({ empresa })}`, confiar<ApoioSped>());
export const lerArquivosSped = (empresa: number) =>
  ler(`${url(R.spedArquivos)}${qs({ empresa })}`, confiar<ArquivosSped>());
export const lerPreviaSped = (f: { empresa: number; tipo: TipoArquivoSped; exercicio: number }) =>
  ler(`${url(R.spedPrevia)}${qs(f)}`, confiar<PreviaSped>());
export const gerarSped = (g: CorpoGerarSped) =>
  enviar(url(R.spedGerar), g, confiar<ResultadoSped>(), novaChave('sped'));
/** O arquivo decifrado (leitura auditada no servidor). */
export const baixarSped = (empresa: number, id: number) =>
  ler(`${url(R.spedBaixar)}${qs({ empresa, id })}`, confiar<ArquivoSpedBaixado>());
export const registrarReciboSped = (r: {
  empresa: number;
  id: number;
  recibo: string;
  transmitidoEm: string;
}) =>
  enviar(
    url(R.spedSituacao),
    { acao: 'recibo', ...r },
    confiar<{ ok: true; mensagem: string; arquivo: ArquivoSpedListado }>(),
    novaChave('sped-recibo'),
  );
export const cancelarSped = (c: { empresa: number; id: number; motivo: string }) =>
  enviar(
    url(R.spedSituacao),
    { acao: 'cancelar', ...c },
    confiar<{ ok: true; mensagem: string; arquivo: ArquivoSpedListado }>(),
    novaChave('sped-cancelar'),
  );

/** Entrega o arquivo ao navegador (o link temporário some logo depois). */
export function salvarArquivo(a: { nome: string; conteudo: Blob }): void {
  const u = URL.createObjectURL(a.conteudo);
  const link = document.createElement('a');
  link.href = u;
  link.download = a.nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(u);
}

/** Os signatários vigentes no cadastro da empresa (para preencher a geração). */
export const lerSignatariosSped = (empresa: number) =>
  ler(`${url(R.spedSignatarios)}${qs({ empresa })}`, confiar<SignatariosSped>());
