import { describe, expect, it } from 'vitest';
import {
  conferirVinculoEstabelecimento,
  MENSAGEM_VINCULO_ESTABELECIMENTO,
  planoEncerramentoVinculo,
} from './vinculo-estabelecimento.js';

describe('vínculo da conta ao estabelecimento (01-ADM L59)', () => {
  it('vincular: conta, situação, vínculo e grupo conferidos nessa ordem', () => {
    const ok = { situacaoConta: 'ativo', jaVinculada: false, grupoAtivo: true };
    expect(conferirVinculoEstabelecimento(ok)).toBeNull();
    expect(conferirVinculoEstabelecimento({ ...ok, situacaoConta: 'dormente' })).toBeNull();
    expect(conferirVinculoEstabelecimento({ ...ok, situacaoConta: null, jaVinculada: true })).toBe(
      'usuario-inexistente',
    );
    expect(conferirVinculoEstabelecimento({ ...ok, situacaoConta: 'bloqueado' })).toBe('conta-sem-acesso');
    expect(conferirVinculoEstabelecimento({ ...ok, situacaoConta: 'inativo' })).toBe('conta-sem-acesso');
    expect(conferirVinculoEstabelecimento({ ...ok, jaVinculada: true, grupoAtivo: null })).toBe(
      'ja-vinculado',
    );
    expect(conferirVinculoEstabelecimento({ ...ok, grupoAtivo: null })).toBe('grupo-inexistente');
    expect(conferirVinculoEstabelecimento({ ...ok, grupoAtivo: false })).toBe('grupo-inativo');
  });

  it('encerrar: fecha a vigência ontem; o vínculo de hoje é anulado sem apagar', () => {
    const f = { inicio: '2026-03-10', hoje: '2026-11-24', proprio: false, outrosVigentes: 1 };
    expect(planoEncerramentoVinculo(f)).toEqual({ modo: 'fechar', fim: '2026-11-23' });
    expect(planoEncerramentoVinculo({ ...f, inicio: '2026-11-24' })).toEqual({ modo: 'anular' });
    expect(planoEncerramentoVinculo({ ...f, hoje: '2026-03-01', inicio: '2026-02-01' })).toEqual({
      modo: 'fechar',
      fim: '2026-02-28',
    });
  });

  it('encerrar: recusa quem não tem vínculo, o próprio vínculo e o único vínculo da conta', () => {
    const f = { inicio: '2026-03-10', hoje: '2026-11-24', proprio: false, outrosVigentes: 1 };
    expect(planoEncerramentoVinculo({ ...f, inicio: null, proprio: true })).toEqual({
      recusa: 'nao-vinculado',
    });
    expect(planoEncerramentoVinculo({ ...f, proprio: true, outrosVigentes: 0 })).toEqual({
      recusa: 'proprio-vinculo',
    });
    expect(planoEncerramentoVinculo({ ...f, outrosVigentes: 0 })).toEqual({ recusa: 'unico-vinculo' });
  });

  it('toda recusa tem mensagem para a pessoa', () => {
    for (const m of Object.values(MENSAGEM_VINCULO_ESTABELECIMENTO)) expect(m.length).toBeGreaterThan(10);
  });
});
