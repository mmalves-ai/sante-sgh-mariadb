// Etiqueta do pacote estéril (F7, 04-CME linha 118; RDC 15/2012, art. 83): monta o ZPL a partir do rastreio do pacote
// (o mesmo que o leitor de código de barras lê), sempre igual para o mesmo pacote (a reimpressão confere pelo SHA-256).
// Etiqueta incompleta (pacote ainda sem ciclo liberado, sem lote, método ou responsável): 422, com o que falta.
import { createHash } from 'node:crypto';
import { zplEtiquetaPacoteEsteril } from '@sgh/dominio-documento';
import { ErroProblema } from '../../problema.filter.js';
import type { RastreioPacote } from './cme-propria.js';

export interface EtiquetaPacoteEsteril {
  readonly codigo: string;
  readonly zpl: string;
  readonly sha256: string;
}

const diaBr = (v: string): string => `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`;

export function etiquetaDoPacote(r: RastreioPacote): EtiquetaPacoteEsteril {
  const p = r.pacote;
  if (p.faltasEtiqueta.length)
    throw new ErroProblema(
      'entrada-invalida',
      422,
      'Etiqueta incompleta',
      `Falta na etiqueta do pacote: ${p.faltasEtiqueta.join(', ')}.`,
      { recusas: p.faltasEtiqueta },
    );
  const zpl = zplEtiquetaPacoteEsteril({
    codigo: p.etiqueta,
    produto: p.produto,
    lote: p.lote!,
    esterilizadoEm: diaBr(p.esterilizadoEm!),
    validade: diaBr(p.validade!),
    metodo: p.metodo!,
    preparadoPor: p.preparadoPor!,
  });
  return { codigo: p.etiqueta, zpl, sha256: createHash('sha256').update(zpl, 'utf8').digest('hex') };
}
