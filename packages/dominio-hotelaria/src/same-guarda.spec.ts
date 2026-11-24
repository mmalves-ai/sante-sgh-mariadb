// SAME pelo volume (04-HOT L126): a regra decide pelo tipo e pelo sentido da operação, nunca pelo código.
import { describe, expect, it } from 'vitest';
import {
  conferirExtravio,
  conferirMovimentoGuarda,
  efeitoNoVolume,
  lerMatriculaVolume,
  matriculaVolume,
  OPERACOES_GUARDA_PADRAO,
  type OperacaoGuarda,
  type PedidoGuarda,
  proximoNumeroVolume,
  retornoAtrasado,
  type VolumeGuarda,
} from './same-guarda.js';

const agora = new Date('2026-11-24T12:00:00Z');
const opDo = (tipo: string): OperacaoGuarda => OPERACOES_GUARDA_PADRAO.find((o) => o.tipo === tipo)!;
const novo: VolumeGuarda = {
  situacao: 'aberto',
  noLocal: false,
  localArquivo: null,
  setorAtual: null,
  temMovimento: false,
  ultimoTipo: null,
};
const noArquivo: VolumeGuarda = {
  ...novo,
  situacao: 'arquivado',
  noLocal: true,
  localArquivo: 7,
  temMovimento: true,
  ultimoTipo: 'registro',
};
const fora: VolumeGuarda = {
  ...noArquivo,
  situacao: 'emprestado',
  noLocal: false,
  setorAtual: 3,
  ultimoTipo: 'saida',
};
const pedido = (tipo: string, x: Partial<PedidoGuarda> = {}): PedidoGuarda => ({
  operacao: opDo(tipo),
  setorDestino: null,
  localDestino: null,
  previsaoRetorno: null,
  avalComissao: null,
  responsavel: null,
  agora,
  ...x,
});
const campos = (v: VolumeGuarda, p: PedidoGuarda) => conferirMovimentoGuarda(v, p).map((e) => e.campo);
const amanha = new Date(agora.getTime() + 86_400_000);

describe('SAME pelo volume', () => {
  it('as operações padrão cobrem todos os tipos, com códigos de negócio', () => {
    expect(OPERACOES_GUARDA_PADRAO.map((o) => o.tipo).sort()).toEqual([
      'descarte',
      'devolucao',
      'emprestimo',
      'recebimento',
      'registro',
      'saida',
      'transferencia',
    ]);
    expect(OPERACOES_GUARDA_PADRAO.every((o) => !/^\d+$/.test(o.codigo))).toBe(true);
  });

  it('o registro exige o local e só vale para o volume ainda sem movimento', () => {
    expect(campos(novo, pedido('registro'))).toEqual(['localDestino']);
    expect(campos(novo, pedido('registro', { localDestino: 7 }))).toEqual([]);
    expect(campos(noArquivo, pedido('registro', { localDestino: 7 }))).toEqual(['operacao']);
    expect(efeitoNoVolume(novo, pedido('registro', { localDestino: 7 }))).toEqual({
      situacao: 'arquivado',
      noLocal: true,
      localArquivo: 7,
    });
  });

  it('o local cheio recusa a entrada', () => {
    expect(
      campos(novo, pedido('registro', { localDestino: 7, ocupacaoDestino: { volumes: 10, capacidade: 10 } })),
    ).toEqual(['localDestino']);
  });

  it('a saída pede destino, previsão futura e responsável, e só sai o que está no arquivo', () => {
    expect(campos(noArquivo, pedido('saida')).sort()).toEqual([
      'previsaoRetorno',
      'responsavel',
      'setorDestino',
    ]);
    expect(
      campos(noArquivo, pedido('saida', { setorDestino: 3, previsaoRetorno: agora, responsavel: 'ANA' })),
    ).toEqual(['previsaoRetorno']);
    const ok = pedido('saida', { setorDestino: 3, previsaoRetorno: amanha, responsavel: 'ANA' });
    expect(campos(noArquivo, ok)).toEqual([]);
    expect(campos(fora, ok)).toEqual(['operacao']);
    expect(efeitoNoVolume(noArquivo, ok)).toEqual({
      situacao: 'emprestado',
      noLocal: false,
      localArquivo: 7,
    });
  });

  it('o recebimento confere o setor para onde o volume foi enviado', () => {
    expect(campos(fora, pedido('recebimento', { setorDestino: 3, responsavel: 'BIA' }))).toEqual([]);
    expect(campos(fora, pedido('recebimento', { setorDestino: 9, responsavel: 'BIA' }))).toEqual([
      'setorDestino',
    ]);
    expect(campos(noArquivo, pedido('recebimento', { responsavel: 'BIA' }))).toEqual(['operacao']);
    expect(
      campos({ ...fora, ultimoTipo: 'recebimento' }, pedido('recebimento', { responsavel: 'BIA' })),
    ).toEqual(['operacao']);
  });

  it('a devolução volta ao local de guarda; a que já está no arquivo recusa', () => {
    expect(campos(fora, pedido('devolucao'))).toEqual([]);
    expect(efeitoNoVolume(fora, pedido('devolucao'))).toEqual({
      situacao: 'arquivado',
      noLocal: true,
      localArquivo: 7,
    });
    expect(campos(noArquivo, pedido('devolucao'))).toEqual(['operacao']);
  });

  it('a transferência: outro local no arquivo, outro setor fora dele', () => {
    expect(campos(noArquivo, pedido('transferencia', { localDestino: 7 }))).toEqual(['localDestino']);
    expect(campos(noArquivo, pedido('transferencia', { localDestino: 8 }))).toEqual([]);
    expect(efeitoNoVolume(noArquivo, pedido('transferencia', { localDestino: 8 })).localArquivo).toBe(8);
    expect(campos(fora, pedido('transferencia', { setorDestino: 3 }))).toEqual(['setorDestino']);
    expect(campos(fora, pedido('transferencia', { setorDestino: 4 }))).toEqual([]);
  });

  it('o descarte exige o aval, só do arquivo, e encerra a guarda', () => {
    expect(campos(noArquivo, pedido('descarte', { responsavel: 'COMISSAO' }))).toEqual(['avalComissao']);
    const ok = pedido('descarte', { responsavel: 'COMISSAO', avalComissao: 'ATA 12/2026' });
    expect(campos(noArquivo, ok)).toEqual([]);
    expect(campos(fora, ok)).toEqual(['operacao']);
    expect(efeitoNoVolume(noArquivo, ok).situacao).toBe('eliminado');
    expect(campos({ ...noArquivo, situacao: 'eliminado' }, pedido('devolucao'))).toEqual(['volume']);
  });

  it('o volume sem registro não se movimenta; o extraviado só volta ao arquivo', () => {
    expect(campos(novo, pedido('devolucao'))).toEqual(['operacao']);
    const extraviado: VolumeGuarda = { ...fora, situacao: 'extraviado' };
    expect(
      campos(extraviado, pedido('saida', { setorDestino: 1, previsaoRetorno: amanha, responsavel: 'X' })),
    ).toEqual(['volume']);
    expect(campos(extraviado, pedido('devolucao'))).toEqual([]);
    expect(conferirExtravio(extraviado, 'procurado em todo o setor')).toHaveLength(1);
    expect(conferirExtravio(fora, 'curto')).toEqual([{ campo: 'motivo', mensagem: expect.any(String) }]);
    expect(conferirExtravio(fora, 'não encontrado após a alta')).toEqual([]);
  });

  it('número, matrícula, leitura da etiqueta e atraso do retorno', () => {
    expect(proximoNumeroVolume([])).toBe(1);
    expect(proximoNumeroVolume([1, 3])).toBe(4);
    expect(matriculaVolume(1234, 5, 2)).toBe('1234-5-2');
    expect(lerMatriculaVolume(' 01234-5-02 ')).toBe('1234-5-2');
    expect(lerMatriculaVolume('abc')).toBeNull();
    expect(retornoAtrasado(fora, new Date(agora.getTime() - 1), agora)).toBe(true);
    expect(retornoAtrasado(noArquivo, new Date(agora.getTime() - 1), agora)).toBe(false);
  });
});
