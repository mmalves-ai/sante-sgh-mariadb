// Cliente da tela de favorecidos do repasse e prestadores terceiros (F3.7, 06-FAT linha 46). As gravações vão com o
// CSRF e a Idempotency-Key (uma por intenção de gravar); a recusa de negócio traz o texto do servidor.
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';
import { novaChave } from './api-repasse.js';

const R = '/api/repasse';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
const itens = <X>() => z.object({ itens: z.array(confiar<X>()) }).transform((o) => o.itens);

export type TipoFavorecido =
  'proprio_profissional' | 'pessoa_juridica' | 'cooperativa' | 'terceiro_profissional';

export interface Favorecido {
  id: number;
  profissional: number;
  profissionalNome: string | null;
  fontePagadora: number | null;
  fontePagadoraNome: string | null;
  tipo: TipoFavorecido;
  alvoNome: string | null;
  contaBancaria: number | null;
  percentual: number;
  inicio: string;
  fim: string | null;
  versao: number;
}

export interface PrestadorTerceiro {
  id: number;
  codigo: string;
  nome: string;
  tipoPessoa: 'fisica' | 'juridica';
  cpf: string | null;
  cnpj: string | null;
  cnes: string | null;
  percentualRepasse: number | null;
  baseRepasse: string;
  ativo: boolean;
  inativadoEm: string | null;
  versao: number;
}

export interface AlvoFavorecido {
  id: number;
  nome: string;
  documento: string | null;
}

export interface ContaCredito {
  id: number;
  rotulo: string;
  titular: string;
  documentoFinal: string;
  preferencial: boolean;
}

export const lerFavorecidos = (profissional: number) =>
  ler(`${R}/favorecidos${qs({ profissional })}`, itens<Favorecido>());
export const lerAlvos = (tipo: Exclude<TipoFavorecido, 'proprio_profissional'>, busca: string) =>
  ler(`${R}/favorecidos/alvos${qs({ tipo, busca })}`, itens<AlvoFavorecido>());
export const lerContas = (profissional: number) =>
  ler(`${R}/favorecidos/contas${qs({ profissional })}`, itens<ContaCredito>());
export const incluirFavorecido = (corpo: unknown) =>
  enviar(`${R}/favorecidos`, corpo, confiar<{ id: number; encerrados: number[] }>(), novaChave('favorecido'));
export const encerrarFavorecido = (id: number, versao: number, fim: string) =>
  enviar(`${R}/favorecidos/${id}/encerrar`, { versao, fim }, confiar<{ id: number }>(), novaChave('fav-fim'));

export const lerPrestadoresTerceiros = (busca: string) =>
  ler(`${R}/prestadores-terceiros${qs({ busca })}`, itens<PrestadorTerceiro>());
export const incluirPrestadorTerceiro = (corpo: unknown) =>
  enviar(`${R}/prestadores-terceiros`, corpo, confiar<{ id: number }>(), novaChave('prestador'));
export const alterarPrestadorTerceiro = (id: number, corpo: unknown) =>
  enviar(`${R}/prestadores-terceiros/${id}`, corpo, confiar<{ id: number }>(), novaChave('prest-alt'));
