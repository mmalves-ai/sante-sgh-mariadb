// Cliente das regras de plantão do repasse (C2-100, 06-FAT linha 47): a lista, a inclusão e o encerramento da
// vigência, na API do plantão realizado. As gravações vão com o CSRF e a Idempotency-Key (uma por intenção de gravar).
import type { ApoioRealizado, ListaRegrasPlantao, RegraPlantaoEntrada } from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';
import { novaChave } from './api-repasse.js';

const R = '/api/pessoas/realizado';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

export const lerRegrasPlantao = () => ler(`${R}/regras-plantao`, confiar<ListaRegrasPlantao>());
export const lerApoioPlantao = () => ler(`${R}/apoio`, confiar<ApoioRealizado>());
export const incluirRegraPlantao = (corpo: RegraPlantaoEntrada) =>
  enviar(`${R}/regras-plantao`, corpo, confiar<{ id: number; mensagem: string }>(), novaChave('rp-regra'));
export const encerrarRegraPlantao = (id: number, fim: string) =>
  enviar(
    `${R}/regras-plantao/${id}/encerramento`,
    { fim },
    confiar<{ id: number; mensagem: string }>(),
    novaChave('rp-fim'),
  );
