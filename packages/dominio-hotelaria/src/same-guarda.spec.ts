// SAME pelo volume (04-HOT L126): a regra decide pelo tipo e pelo sentido da operação, nunca pelo código.
import { describe, expect, it } from 'vitest';
import {
  conferirExtravio,
  conferirGuardaExterna,
  conferirMovimentoGuarda,
  type DadosDescarte,
  efeitoNoVolume,
  fimDoPrazoGuarda,
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

  it('o próprio volume não ocupa duas vagas; o extraviado reencontrado confere a vaga do seu local', () => {
    const cheio = { volumes: 10, capacidade: 10 };
    // Emprestado, já contado no local 7: a devolução ao mesmo local (pedida ou não) passa.
    expect(campos(fora, pedido('devolucao', { localDestino: 7, ocupacaoDestino: cheio }))).toEqual([]);
    expect(campos(fora, pedido('devolucao', { ocupacaoDestino: cheio }))).toEqual([]);
    // Para outro local cheio, recusa.
    expect(campos(fora, pedido('devolucao', { localDestino: 8, ocupacaoDestino: cheio }))).toEqual([
      'localDestino',
    ]);
    // O extraviado não está na contagem: volta ao local dele só se houver vaga, mesmo sem local pedido.
    const extraviado: VolumeGuarda = { ...fora, situacao: 'extraviado' };
    expect(campos(extraviado, pedido('devolucao', { ocupacaoDestino: cheio }))).toEqual(['localDestino']);
    expect(
      campos(extraviado, pedido('devolucao', { ocupacaoDestino: { volumes: 9, capacidade: 10 } })),
    ).toEqual([]);
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
    // Só o local de destino não basta: fora do arquivo o volume fica num setor.
    expect(
      campos(
        noArquivo,
        pedido('emprestimo', { localDestino: 8, previsaoRetorno: amanha, responsavel: 'ANA' }),
      ),
    ).toEqual(['setorDestino']);
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

  it('o descarte exige a deliberação da comissão e o prazo de guarda cumprido, só do arquivo, e encerra a guarda', () => {
    const deliberacao = { comissaoDeProntuario: true, reuniaoRealizada: true, cancelada: false };
    const cumprido: DadosDescarte = {
      guardaDesde: new Date('2005-01-10T00:00:00Z'),
      prazoAnos: 20,
      deliberacao,
    };
    const msg = (d: DadosDescarte | null) =>
      conferirMovimentoGuarda(noArquivo, pedido('descarte', { responsavel: 'COMISSAO', descarte: d })).map(
        (e) => e.mensagem,
      );
    expect(campos(noArquivo, pedido('descarte', { responsavel: 'COMISSAO' })).sort()).toEqual([
      'deliberacao',
      'operacao',
    ]);
    expect(msg({ ...cumprido, deliberacao: null })).toEqual([
      expect.stringMatching(/deliberação da comissão/),
    ]);
    expect(msg({ ...cumprido, deliberacao: { ...deliberacao, comissaoDeProntuario: false } })).toEqual([
      expect.stringMatching(/não é da comissão/),
    ]);
    expect(msg({ ...cumprido, deliberacao: { ...deliberacao, reuniaoRealizada: false } })).toEqual([
      expect.stringMatching(/não foi realizada/),
    ]);
    expect(msg({ ...cumprido, deliberacao: { ...deliberacao, cancelada: true } })).toEqual([
      expect.stringMatching(/cancelada/),
    ]);
    // Antes do prazo (20 anos desde 2010-03-01: 2030-03-01) recusa; sem prazo, guarda permanente.
    expect(msg({ ...cumprido, guardaDesde: new Date('2010-03-01T00:00:00Z') })).toEqual([
      expect.stringMatching(/2030-03-01/),
    ]);
    expect(msg({ ...cumprido, prazoAnos: null })).toEqual([expect.stringMatching(/permanente/)]);
    expect(fimDoPrazoGuarda(new Date('2006-11-24T00:00:00Z'), 20)?.toISOString().slice(0, 10)).toBe(
      '2026-11-24',
    );
    const ok = pedido('descarte', { responsavel: 'COMISSAO', descarte: cumprido });
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

  it('a guarda externa: só sai o que está no arquivo, com a empresa e a caixa; fora, nada se movimenta até o retorno', () => {
    const envio = { sentido: 'envio' as const, empresa: 'Guarda Sintética', caixa: 'CX-01' };
    expect(conferirGuardaExterna(noArquivo, envio)).toEqual([]);
    expect(
      conferirGuardaExterna(noArquivo, { sentido: 'envio', empresa: ' a ', caixa: ' ' }).map((e) => e.campo),
    ).toEqual(['empresa', 'caixa']);
    expect(conferirGuardaExterna(fora, envio).map((e) => e.mensagem)).toEqual([
      'Só o volume que está no arquivo vai para a guarda externa: um lugar por vez.',
    ]);
    expect(conferirGuardaExterna({ ...noArquivo, situacao: 'eliminado' }, envio)[0]?.campo).toBe('volume');
    expect(conferirGuardaExterna({ ...noArquivo, situacao: 'extraviado' }, envio)[0]?.campo).toBe('volume');
    const externo: VolumeGuarda = { ...noArquivo, noLocal: false, naGuardaExterna: true };
    expect(conferirGuardaExterna(externo, envio).map((e) => e.mensagem)).toEqual([
      'O volume já está na guarda externa.',
    ]);
    // Na guarda externa nenhuma operação do cadastro vale: nem saída, nem devolução, nem descarte.
    for (const tipo of ['saida', 'devolucao', 'transferencia', 'descarte'])
      expect(campos(externo, pedido(tipo, { setorDestino: 3, previsaoRetorno: amanha }))).toEqual(['volume']);
    const retorno = { sentido: 'retorno' as const, empresa: null, caixa: null };
    expect(conferirGuardaExterna(externo, retorno)).toEqual([]);
    expect(conferirGuardaExterna(noArquivo, retorno).map((e) => e.mensagem)).toEqual([
      'O volume não está na guarda externa.',
    ]);
    expect(conferirGuardaExterna({ ...externo, localArquivo: null }, retorno)[0]?.campo).toBe('localDestino');
  });
});
