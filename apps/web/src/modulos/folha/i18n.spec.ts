// Textos da folha (M53-F0): todo código que o domínio e o contrato devolvem tem texto (nenhum código cru na tela).
import {
  CODIGOS_PENDENCIA_EXPORTACAO,
  CODIGOS_RECUSA_RETORNO,
  SENTIDOS_LOTE_FOLHA,
  SITUACOES_AFASTAMENTO,
  SITUACOES_LOTE_FOLHA,
} from '@sgh/contratos';
import { CODIGOS_DIVERGENCIA_LOTE } from '@sgh/dominio-pessoas';
import { describe, expect, it } from 'vitest';
import { mensagensFolha } from './i18n.js';

describe('textos da interface com a folha externa', () => {
  it('cada divergência, situação e sentido tem texto', () => {
    for (const c of CODIGOS_DIVERGENCIA_LOTE) expect(mensagensFolha.interface.divergencia[c]).toBeTruthy();
    for (const s of SITUACOES_LOTE_FOLHA) expect(mensagensFolha.interface.situacoes[s]).toBeTruthy();
    for (const s of SENTIDOS_LOTE_FOLHA) expect(mensagensFolha.interface.sentido[s]).toBeTruthy();
  });

  it('cada pendência da exportação, recusa do retorno e situação do afastamento tem texto', () => {
    for (const c of CODIGOS_PENDENCIA_EXPORTACAO) expect(mensagensFolha.interface.pendencia[c]).toBeTruthy();
    for (const c of CODIGOS_RECUSA_RETORNO) expect(mensagensFolha.interface.recusa[c]).toBeTruthy();
    for (const c of Object.keys(SITUACOES_AFASTAMENTO) as (keyof typeof SITUACOES_AFASTAMENTO)[])
      expect(mensagensFolha.afastamento.situacoes[c]).toBeTruthy();
  });
});
