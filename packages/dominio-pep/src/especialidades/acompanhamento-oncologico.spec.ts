import { describe, expect, it } from 'vitest';
import {
  type AcompanhamentoAtual,
  type AcompanhamentoEntrada,
  conferirAcompanhamentoOnco,
  conferirReacao,
  type ReacaoEntrada,
  tipoEventoAcompanhamento,
} from './acompanhamento-oncologico.js';

const HOJE = '2026-11-25';
const campos = (e: { campo: string }[]) => e.map((x) => x.campo).sort();
const reacao: ReacaoEntrada = {
  categoria: 'hematologica',
  descricao: 'Neutropenia',
  grau: 2,
  evolucao: 'nova',
  avaliadoEm: '2026-11-24T10:00',
  conduta: null,
  doseAjustada: false,
  tratamentoSuspenso: false,
  comTratamento: true,
};
const acomp: AcompanhamentoEntrada = {
  classificacao: 'em_tratamento',
  situacaoTumor: 'presente',
  resposta: null,
  primeiroTratamentoEm: '2026-10-01',
  recidivaEm: null,
  obitoEm: null,
};
const atual: AcompanhamentoAtual = {
  classificacao: 'em_tratamento',
  situacaoTumor: 'presente',
  resposta: null,
  recidivaEm: null,
  obitoEm: null,
};

describe('reação do tratamento oncológico', () => {
  it('aceita a reação leve sem conduta', () => {
    expect(conferirReacao(reacao, HOJE)).toEqual([]);
  });
  it('grau 3 ou mais pede a conduta', () => {
    expect(campos(conferirReacao({ ...reacao, grau: 3 }, HOJE))).toEqual(['conduta']);
    expect(conferirReacao({ ...reacao, grau: 4, conduta: 'Suspender e G-CSF' }, HOJE)).toEqual([]);
  });
  it('recusa grau fora de 1 a 5, categoria e evolução desconhecidas e data futura', () => {
    expect(
      campos(
        conferirReacao(
          { ...reacao, grau: 0, categoria: 'x', evolucao: 'y', avaliadoEm: '2026-11-26T08:00' },
          HOJE,
        ),
      ),
    ).toEqual(['avaliadoEm', 'categoria', 'evolucao', 'grau']);
    expect(campos(conferirReacao({ ...reacao, grau: 2.5 }, HOJE))).toEqual(['grau']);
  });
  it('ajuste de dose ou suspensão pede o tratamento ligado, e não os dois juntos', () => {
    expect(campos(conferirReacao({ ...reacao, doseAjustada: true, comTratamento: false }, HOJE))).toEqual([
      'tratamento',
    ]);
    expect(campos(conferirReacao({ ...reacao, doseAjustada: true, tratamentoSuspenso: true }, HOJE))).toEqual(
      ['doseAjustada'],
    );
  });
  it('grau 5 não melhora nem se resolve', () => {
    expect(
      campos(conferirReacao({ ...reacao, grau: 5, conduta: 'Óbito', evolucao: 'resolvida' }, HOJE)),
    ).toEqual(['evolucao']);
  });
  it('recusa a descrição vazia', () => {
    expect(campos(conferirReacao({ ...reacao, descricao: '  ' }, HOJE))).toEqual(['descricao']);
  });
});

describe('acompanhamento oncológico', () => {
  it('aceita a classificação coerente', () => {
    expect(conferirAcompanhamentoOnco(acomp, null, HOJE, '2026-09-15')).toEqual([]);
  });
  it('recidiva pede a data e o tumor que voltou', () => {
    expect(
      campos(conferirAcompanhamentoOnco({ ...acomp, classificacao: 'recidiva' }, atual, HOJE, null)),
    ).toEqual(['recidivaEm', 'situacaoTumor']);
    expect(
      conferirAcompanhamentoOnco(
        { ...acomp, classificacao: 'recidiva', recidivaEm: '2026-11-20', situacaoTumor: 'metastase' },
        atual,
        HOJE,
        null,
      ),
    ).toEqual([]);
  });
  it('recidiva antes do primeiro tratamento e datas antes do diagnóstico ou no futuro são recusadas', () => {
    expect(
      campos(
        conferirAcompanhamentoOnco(
          { ...acomp, classificacao: 'recidiva', recidivaEm: '2026-09-20', situacaoTumor: 'recidiva_local' },
          atual,
          HOJE,
          '2026-09-15',
        ),
      ),
    ).toEqual(['recidivaEm']);
    expect(
      campos(
        conferirAcompanhamentoOnco(
          { ...acomp, primeiroTratamentoEm: '2026-09-01' },
          null,
          HOJE,
          '2026-09-15',
        ),
      ),
    ).toEqual(['primeiroTratamentoEm']);
    expect(
      campos(conferirAcompanhamentoOnco({ ...acomp, primeiroTratamentoEm: '2026-12-01' }, null, HOJE, null)),
    ).toEqual(['primeiroTratamentoEm']);
  });
  it('remissão e resposta completa pedem tumor sem evidência', () => {
    expect(
      campos(
        conferirAcompanhamentoOnco(
          { ...acomp, classificacao: 'remissao', resposta: 'completa' },
          atual,
          HOJE,
          null,
        ),
      ),
    ).toEqual(['resposta', 'situacaoTumor']);
    expect(
      conferirAcompanhamentoOnco(
        { ...acomp, classificacao: 'remissao', resposta: 'completa', situacaoTumor: 'sem_evidencia' },
        atual,
        HOJE,
        null,
      ),
    ).toEqual([]);
  });
  it('óbito pede a data, a data pede a classificação, e depois do óbito nada muda', () => {
    expect(
      campos(conferirAcompanhamentoOnco({ ...acomp, classificacao: 'obito' }, atual, HOJE, null)),
    ).toEqual(['obitoEm']);
    expect(
      campos(conferirAcompanhamentoOnco({ ...acomp, obitoEm: '2026-11-20T10:00' }, atual, HOJE, null)),
    ).toEqual(['classificacao']);
    expect(
      campos(
        conferirAcompanhamentoOnco(
          acomp,
          { ...atual, classificacao: 'obito', obitoEm: '2026-11-20' },
          HOJE,
          null,
        ),
      ),
    ).toEqual(['classificacao']);
  });
  it('em investigação não tem resposta; classificação desconhecida é recusada', () => {
    expect(
      campos(
        conferirAcompanhamentoOnco(
          { ...acomp, classificacao: 'em_investigacao', resposta: 'parcial' },
          null,
          HOJE,
          null,
        ),
      ),
    ).toEqual(['resposta']);
    expect(campos(conferirAcompanhamentoOnco({ ...acomp, classificacao: 'x' }, null, HOJE, null))).toEqual([
      'classificacao',
    ]);
  });
  it('o tipo do evento: óbito, recidiva, resposta, classificação e observação', () => {
    expect(tipoEventoAcompanhamento({ ...acomp, classificacao: 'obito', obitoEm: '2026-11-20' }, atual)).toBe(
      'obito',
    );
    expect(
      tipoEventoAcompanhamento({ ...acomp, classificacao: 'recidiva', recidivaEm: '2026-11-20' }, atual),
    ).toBe('recidiva');
    expect(tipoEventoAcompanhamento({ ...acomp, resposta: 'parcial' }, atual)).toBe('resposta');
    expect(tipoEventoAcompanhamento({ ...acomp, classificacao: 'paliativo' }, atual)).toBe('classificacao');
    expect(tipoEventoAcompanhamento(acomp, null)).toBe('classificacao');
    expect(tipoEventoAcompanhamento(acomp, atual)).toBe('observacao');
  });
});
