import { describe, expect, it } from 'vitest';
import {
  acaoLotePermitida,
  conferirDevolucaoLaudo,
  conferirLaudoEspecial,
  conferirLoteLaudos,
  conferirReenvioLaudo,
  MAXIMO_LAUDOS_POR_LOTE,
  situacaoDoLaudoPelaAutorizacao,
} from './laudo-internacao.js';

const campos = (p: readonly { campo: string }[]) => p.map((x) => x.campo);

describe('laudo de internação SUS (06-SUS linha 57)', () => {
  it('a situação do laudo acompanha a da autorização', () => {
    expect(situacaoDoLaudoPelaAutorizacao('solicitada', false)).toBe('emitido');
    expect(situacaoDoLaudoPelaAutorizacao('solicitada', true)).toBe('enviado');
    expect(situacaoDoLaudoPelaAutorizacao('autorizada', true)).toBe('autorizado');
    expect(situacaoDoLaudoPelaAutorizacao('negada', false)).toBe('negado');
    expect(situacaoDoLaudoPelaAutorizacao('devolvida', true)).toBe('devolvido');
    expect(situacaoDoLaudoPelaAutorizacao('cancelada', false)).toBe('cancelado');
  });

  it('devolução: só da AIH solicitada e com motivo', () => {
    expect(conferirDevolucaoLaudo('solicitada', 'Falta o exame que confirma o diagnóstico')).toEqual([]);
    expect(campos(conferirDevolucaoLaudo('autorizada', 'Motivo suficiente aqui'))).toEqual(['situacao']);
    expect(campos(conferirDevolucaoLaudo('solicitada', ' curto '))).toEqual(['motivo']);
  });

  it('reenvio: só da AIH devolvida, com justificativa e com alguma correção', () => {
    const ok = { justificativa: 'Dor torácica com supra de ST em parede anterior', mudouAlgo: true };
    expect(conferirReenvioLaudo('devolvida', ok)).toEqual([]);
    expect(campos(conferirReenvioLaudo('solicitada', ok))).toEqual(['situacao']);
    expect(campos(conferirReenvioLaudo('devolvida', { ...ok, mudouAlgo: false }))).toEqual(['justificativa']);
    expect(campos(conferirReenvioLaudo('devolvida', { justificativa: 'x', mudouAlgo: true }))).toEqual([
      'justificativa',
    ]);
  });

  it('laudo especial: AIH autorizada, OPM do grupo 07, diária inteira, sem repetir, com justificativa', () => {
    const j = 'Paciente precisa de stent e acompanhante por ser idoso';
    expect(
      conferirLaudoEspecial(
        'autorizada',
        [
          { tipo: 'opm', procedimento: '0702040010', quantidade: 1 },
          { tipo: 'diaria_acompanhante', procedimento: '0802010016', quantidade: 3 },
        ],
        j,
      ),
    ).toEqual([]);
    expect(
      campos(
        conferirLaudoEspecial('fechada', [{ tipo: 'opm', procedimento: '0702040010', quantidade: 1 }], j),
      ),
    ).toEqual(['situacao']);
    expect(campos(conferirLaudoEspecial('autorizada', [], j))).toEqual(['itens']);
    expect(
      campos(
        conferirLaudoEspecial(
          'autorizada',
          [
            { tipo: 'opm', procedimento: '0303060010', quantidade: 1 },
            { tipo: 'diaria_uti', procedimento: '0802010024', quantidade: 1.5 },
            { tipo: 'sangue', procedimento: '0306020010', quantidade: 0 },
            { tipo: 'outro', procedimento: '123', quantidade: 1 },
            { tipo: 'diaria_uti', procedimento: '0802010024', quantidade: 2 },
          ],
          'curto',
        ),
      ),
    ).toEqual([
      'justificativa',
      'itens.0.procedimento',
      'itens.1.quantidade',
      'itens.2.quantidade',
      'itens.3.procedimento',
      'itens.4.procedimento',
    ]);
  });

  it('lote: laudos emitidos, fora de outro lote, sem repetição e até o máximo', () => {
    const achados = [
      { id: 1, situacao: 'emitido' as const, lote: null },
      { id: 2, situacao: 'emitido' as const, lote: 9 },
      { id: 3, situacao: 'autorizado' as const, lote: null },
    ];
    expect(conferirLoteLaudos([1], achados)).toEqual([]);
    expect(conferirLoteLaudos([], achados)).toHaveLength(1);
    expect(conferirLoteLaudos([1, 1], achados)).toHaveLength(1);
    expect(conferirLoteLaudos([2, 3, 4], achados).map((x) => x.mensagem)).toEqual([
      'O laudo 2 já está no lote 9.',
      'O laudo 3 não está emitido (está autorizado).',
      'O laudo 4 não foi encontrado neste estabelecimento.',
    ]);
    const muitos = Array.from({ length: MAXIMO_LAUDOS_POR_LOTE + 1 }, (_, i) => i + 100);
    expect(conferirLoteLaudos(muitos, []).some((x) => x.mensagem.includes('até'))).toBe(true);
  });

  it('lote: enviar do fechado, cancelar antes do envio, retornar do enviado', () => {
    expect(acaoLotePermitida('enviar', 'fechado')).toBe(true);
    expect(acaoLotePermitida('enviar', 'enviado')).toBe(false);
    expect(acaoLotePermitida('cancelar', 'enviado')).toBe(false);
    expect(acaoLotePermitida('cancelar', 'fechado')).toBe(true);
    expect(acaoLotePermitida('retornar', 'enviado')).toBe(true);
  });
});
