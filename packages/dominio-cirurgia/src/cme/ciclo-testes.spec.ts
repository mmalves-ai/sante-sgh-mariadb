import { describe, expect, it } from 'vitest';
import { desfechoDaLiberacao, desfechoDoCiclo } from './cme.js';
import {
  conferirRecolhimento,
  conferirRejeicao,
  conferirTeste,
  exigeRecolhimento,
  indicadoresDosTestes,
  type RejeicaoEntrada,
  situacaoDaRejeicao,
  type TesteEntrada,
} from './ciclo-testes.js';

const teste = (o: Partial<TesteEntrada> = {}): TesteEntrada => ({
  categoria: 'biologico',
  exigeLote: true,
  exigeControle: true,
  resultado: 'aprovado',
  lote: 'LB-1',
  validade: '2027-01-31',
  diaDoCiclo: '2026-11-26',
  incubacaoInicio: '2026-11-26T08:00',
  leitura: '2026-11-27T08:00',
  controlePositivoOk: true,
  valorMedido: null,
  situacaoCiclo: 'concluido',
  ...o,
});
const campos = (p: { campo: string }[]) => p.map((x) => x.campo);

describe('teste do indicador', () => {
  it('aceita o biológico completo', () => expect(conferirTeste(teste())).toEqual([]));
  it('recusa lote faltando, indicador vencido e leitura antes da incubação', () =>
    expect(
      campos(conferirTeste(teste({ lote: ' ', validade: '2026-11-25', leitura: '2026-11-26T07:00' }))),
    ).toEqual(['lote', 'validade', 'leitura']));
  it('resultado lido sem hora de leitura e biológico sem incubação', () =>
    expect(campos(conferirTeste(teste({ leitura: null, incubacaoInicio: null })))).toEqual([
      'leitura',
      'incubacaoInicio',
    ]));
  it('biológico aprovado sem o controle positivo não vale', () =>
    expect(campos(conferirTeste(teste({ controlePositivoOk: false })))).toEqual(['controlePositivoOk']));
  it('físico lido exige o valor medido; ciclo liberado não recebe teste', () =>
    expect(
      campos(
        conferirTeste(
          teste({ categoria: 'fisico', exigeControle: false, exigeLote: false, situacaoCiclo: 'liberado' }),
        ),
      ),
    ).toEqual(['ciclo', 'valorMedido']));
  it('pendente não pede leitura', () =>
    expect(conferirTeste(teste({ resultado: 'pendente', leitura: null, incubacaoInicio: null }))).toEqual([]));
});

describe('indicadores pelos testes: liberação só com indicador aprovado', () => {
  const t = (categoria: 'fisico' | 'quimico' | 'biologico' | 'bowie_dick', resultado: 'aprovado' | 'reprovado' | 'pendente' | 'inconclusivo', liberacaoDepende = true) => ({
    categoria,
    resultado,
    liberacaoDepende,
  });
  it('sem teste fica pendente e a conclusão é recusada', () => {
    const i = indicadoresDosTestes([]);
    expect(i).toEqual({ fisico: 'pendente', quimico: 'pendente', biologico: 'pendente' });
    expect(desfechoDoCiclo(i, false).situacao).toBe('recusa');
  });
  it('físico e químico aprovados liberam a carga sem implante', () =>
    expect(desfechoDoCiclo(indicadoresDosTestes([t('fisico', 'aprovado'), t('quimico', 'aprovado')]), false).situacao).toBe(
      'liberado',
    ));
  it('inconclusivo não libera; reprovado de que a liberação depende reprova', () => {
    expect(indicadoresDosTestes([t('quimico', 'aprovado'), t('quimico', 'inconclusivo')]).quimico).toBe('pendente');
    expect(
      desfechoDoCiclo(indicadoresDosTestes([t('fisico', 'aprovado'), t('quimico', 'reprovado')]), false).situacao,
    ).toBe('reprovado');
  });
  it('o teste repetido depois do inconclusivo e a leitura depois do biológico em incubação valem por tipo', () => {
    expect(indicadoresDosTestes([t('quimico', 'inconclusivo'), t('quimico', 'aprovado')]).quimico).toBe('conforme');
    expect(indicadoresDosTestes([t('biologico', 'pendente'), t('biologico', 'aprovado')]).biologico).toBe('conforme');
    expect(indicadoresDosTestes([t('quimico', 'reprovado'), t('quimico', 'aprovado')]).quimico).toBe('nao_conforme');
    // Dois tipos exigidos na mesma categoria: o último de cada um precisa estar aprovado.
    const q = (tipo: number, resultado: 'aprovado' | 'pendente') => ({ ...t('quimico', resultado), tipo });
    expect(indicadoresDosTestes([q(4, 'aprovado'), q(5, 'pendente')]).quimico).toBe('pendente');
    expect(indicadoresDosTestes([q(4, 'aprovado'), q(5, 'pendente'), q(5, 'aprovado')]).quimico).toBe('conforme');
  });
  it('indicador informativo (não decide a liberação) não reprova', () =>
    expect(indicadoresDosTestes([t('quimico', 'aprovado'), t('quimico', 'reprovado', false)]).quimico).toBe(
      'conforme',
    ));
  it('Bowie-Dick reprovado reprova o físico; aprovado sozinho não basta', () => {
    expect(indicadoresDosTestes([t('fisico', 'aprovado'), t('bowie_dick', 'reprovado')]).fisico).toBe('nao_conforme');
    expect(indicadoresDosTestes([t('bowie_dick', 'aprovado')]).fisico).toBe('pendente');
  });
  it('carga com implante aguarda o biológico e libera com ele aprovado', () => {
    const base = [t('fisico', 'aprovado'), t('quimico', 'aprovado')];
    expect(desfechoDoCiclo(indicadoresDosTestes(base), true).situacao).toBe('concluido');
    expect(desfechoDaLiberacao('concluido', indicadoresDosTestes([...base, t('biologico', 'pendente')]).biologico).situacao).toBe(
      'recusa',
    );
    expect(desfechoDaLiberacao('concluido', indicadoresDosTestes([...base, t('biologico', 'aprovado')]).biologico).situacao).toBe(
      'liberado',
    );
  });
});

describe('rejeição no reprocessamento', () => {
  const r = (o: Partial<RejeicaoEntrada> = {}): RejeicaoEntrada => ({
    objeto: 'pacote',
    situacao: 'esteril',
    motivoAtivo: true,
    faseDoMotivo: null,
    fase: 5,
    retorna: true,
    faseRetorno: 2,
    ordemFase: 5,
    ordemRetorno: 2,
    descricao: null,
    ...o,
  });
  it('aceita o pacote estéril com retorno à limpeza', () => expect(conferirRejeicao(r())).toEqual([]));
  it('recusa pacote usado, motivo inativo, fase errada e retorno para frente', () =>
    expect(
      campos(conferirRejeicao(r({ situacao: 'usado', motivoAtivo: false, faseDoMotivo: 3, ordemRetorno: 7 }))),
    ).toEqual(['pacote', 'motivo', 'fase', 'faseRetorno']));
  it('retorno sem fase; ciclo em andamento e sem descrição', () => {
    expect(campos(conferirRejeicao(r({ faseRetorno: null, ordemRetorno: null })))).toEqual(['faseRetorno']);
    expect(campos(conferirRejeicao(r({ objeto: 'ciclo', situacao: 'em_andamento' })))).toEqual(['ciclo', 'descricao']);
  });
  it('recolhimento: ciclo com distribuído sempre; pacote só se o motivo exige', () => {
    expect(exigeRecolhimento('ciclo', false, 2)).toBe(true);
    expect(exigeRecolhimento('ciclo', true, 0)).toBe(false);
    expect(exigeRecolhimento('pacote', false, 1)).toBe(false);
    expect(exigeRecolhimento('pacote', true, 1)).toBe(true);
    expect(situacaoDaRejeicao(true)).toBe('em_recolhimento');
    expect(situacaoDaRejeicao(false)).toBe('concluida');
  });
  it('recolhe só pacote distribuído de rejeição em recolhimento', () => {
    expect(conferirRecolhimento('em_recolhimento', 'distribuido')).toEqual([]);
    expect(campos(conferirRecolhimento('concluida', 'distribuido'))).toEqual(['rejeicao']);
    expect(campos(conferirRecolhimento('em_recolhimento', 'usado'))).toEqual(['pacote']);
  });
});
