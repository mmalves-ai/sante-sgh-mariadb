// Cliente da rede credenciada da operadora própria (M56, etapa 4, F3): apoio da tela, lista por chave, ficha,
// movimentos do RPS e as quatro gravações, validados pelos contratos. Problem Details viram ErroApi.
import {
  type ApoioRede,
  esquemaApoioRede,
  esquemaMovimentosRps,
  esquemaPrestadorDetalhe,
  esquemaPrestadores,
  esquemaResultadoRede,
  type MovimentosRps,
  type PrestadorDetalhe,
  type Prestadores,
  type ResultadoRede,
} from '@sgh/contratos';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const O = '/api/operadora';

export const lerApoioRede = (): Promise<ApoioRede> => ler(`${O}/rede/apoio`, esquemaApoioRede);

export function lerPrestadores(f: {
  busca?: string | null;
  situacao?: string | null;
  tipo?: number | null;
  apos?: string | null;
}): Promise<Prestadores> {
  const q = new URLSearchParams();
  if (f.busca) q.set('busca', f.busca);
  if (f.situacao) q.set('situacao', f.situacao);
  if (f.tipo !== null && f.tipo !== undefined) q.set('tipo', String(f.tipo));
  if (f.apos) q.set('apos', f.apos);
  const s = q.toString();
  return ler(`${O}/prestadores${s ? `?${s}` : ''}`, esquemaPrestadores);
}

export const lerPrestador = (id: number): Promise<PrestadorDetalhe> =>
  ler(`${O}/prestadores/${id}`, esquemaPrestadorDetalhe);

export function lerMovimentosRps(situacao: string | null, apos: number | null): Promise<MovimentosRps> {
  const q = new URLSearchParams();
  if (situacao) q.set('situacao', situacao);
  if (apos !== null) q.set('apos', String(apos));
  const s = q.toString();
  return ler(`${O}/rede/movimentos${s ? `?${s}` : ''}`, esquemaMovimentosRps);
}

export const credenciarPrestador = (corpo: unknown): Promise<ResultadoRede> =>
  enviar(`${O}/prestadores`, corpo, esquemaResultadoRede, novaChave('rede-credenciar'));
export const alterarPrestador = (id: number, corpo: unknown): Promise<ResultadoRede> =>
  enviar(`${O}/prestadores/${id}/alterar`, corpo, esquemaResultadoRede, novaChave('rede-alterar'));
export const descredenciarPrestador = (id: number, corpo: unknown): Promise<ResultadoRede> =>
  enviar(
    `${O}/prestadores/${id}/descredenciar`,
    corpo,
    esquemaResultadoRede,
    novaChave('rede-descredenciar'),
  );
export const reincluirPrestador = (id: number, corpo: unknown): Promise<ResultadoRede> =>
  enviar(`${O}/prestadores/${id}/reincluir`, corpo, esquemaResultadoRede, novaChave('rede-reincluir'));
