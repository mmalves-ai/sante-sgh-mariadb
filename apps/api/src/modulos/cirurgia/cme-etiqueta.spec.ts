// A etiqueta do pacote estéril sai do rastreio: completa, o ZPL com o código e o SHA-256 estável; incompleta, 422
// com o que falta (sem ZPL).
import { describe, expect, it } from 'vitest';
import { ErroProblema } from '../../problema.filter.js';
import { etiquetaDoPacote } from './cme-etiqueta.js';
import type { RastreioPacote } from './cme-propria.js';

const rastreio = (faltas: string[] = [], dia: string | null = '2026-11-25'): RastreioPacote => ({
  pacote: {
    id: 1,
    etiqueta: 'PE00100000042',
    caixa: 3,
    produto: 'CAIXA SINTETICA',
    situacao: 'esteril',
    ciclo: 9,
    lote: 'L-1',
    validade: '2026-12-25',
    versao: 1,
    esterilizadoEm: '2026-11-25T10:30:00',
    esterilizadoNoDia: dia,
    preparadoPor: 'tecnico.cme',
    metodo: 'VAPOR',
    faltasEtiqueta: faltas,
  },
  ciclo: null,
  cirurgias: [],
  usos: [],
});

describe('etiquetaDoPacote', () => {
  it('monta o ZPL com as datas em DD/MM/AAAA e o mesmo SHA-256 na reimpressão', () => {
    const a = etiquetaDoPacote(rastreio());
    expect(a.codigo).toBe('PE00100000042');
    expect(a.zpl).toContain('ESTER 25/11/2026  VAL 25/12/2026');
    expect(a.zpl).toContain('^FDPE00100000042^FS');
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(etiquetaDoPacote(rastreio()).sha256).toBe(a.sha256);
  });

  it('imprime o dia da esterilização no fuso do estabelecimento, não o dia UTC gravado', () => {
    // 22h30 de 24/11 em Brasília ficam gravadas como 01h30 de 25/11 em UTC.
    const r = rastreio([], '2026-11-24');
    const a = etiquetaDoPacote({ ...r, pacote: { ...r.pacote, esterilizadoEm: '2026-11-25T01:30:00' } });
    expect(a.zpl).toContain('ESTER 24/11/2026  VAL 25/12/2026');
  });

  it('recusa a etiqueta incompleta com 422 e o que falta', () => {
    try {
      etiquetaDoPacote(rastreio(['lote', 'método']));
      throw new Error('deveria recusar');
    } catch (e) {
      expect(e).toBeInstanceOf(ErroProblema);
      expect((e as ErroProblema).getStatus()).toBe(422);
      expect((e as ErroProblema).detalhe).toContain('lote, método');
    }
  });
});
