// Ocorrência na entrega da refeição (F8, 04-HOT linha 143): registro e resolução.
import { describe, expect, it } from 'vitest';
import {
  type TipoOcorrenciaRefeicao,
  validarOcorrenciaRefeicao,
  validarResolucaoOcorrencia,
} from './ocorrencia-refeicao.js';

const tipo = (x: Partial<TipoOcorrenciaRefeicao> = {}): TipoOcorrenciaRefeicao => ({
  id: 1,
  codigo: 'RECUSA',
  descricao: 'Recusa da refeição',
  geraReposicao: false,
  exigeJustificativa: false,
  ativo: true,
  ...x,
});
const agora = new Date('2026-11-25T15:00:00Z');
const base = {
  tipo: tipo(),
  descricao: null,
  ocorridoEm: new Date('2026-11-25T14:30:00Z'),
  agora,
  dataMapa: '2026-11-25',
  situacaoLinha: 'previsto',
};

describe('validarOcorrenciaRefeicao', () => {
  it('sem exigência, a descrição vazia vira a do tipo', () => {
    const r = validarOcorrenciaRefeicao(base);
    expect(r).toEqual({ ok: true, valor: { descricao: 'Recusa da refeição', reposicao: false } });
  });

  it('o tipo que exige justificativa recusa a curta e aceita a completa', () => {
    const t = tipo({ exigeJustificativa: true });
    const curta = validarOcorrenciaRefeicao({ ...base, tipo: t, descricao: 'curta' });
    expect(curta.ok).toBe(false);
    if (!curta.ok) expect(curta.problemas.map((p) => p.campo)).toEqual(['descricao']);
    const boa = validarOcorrenciaRefeicao({ ...base, tipo: t, descricao: '  Paciente recusou o caldo  ' });
    expect(boa).toEqual({ ok: true, valor: { descricao: 'Paciente recusou o caldo', reposicao: false } });
  });

  it('o tipo que gera reposição avisa', () => {
    const r = validarOcorrenciaRefeicao({ ...base, tipo: tipo({ geraReposicao: true }) });
    expect(r.ok && r.valor.reposicao).toBe(true);
  });

  it('recusa tipo fora de uso, linha cancelada, momento no futuro e antes da véspera', () => {
    const r = validarOcorrenciaRefeicao({
      ...base,
      tipo: tipo({ ativo: false }),
      situacaoLinha: 'cancelado',
      ocorridoEm: new Date('2026-11-25T15:10:00Z'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas.map((p) => p.campo)).toEqual(['tipo', 'internacao', 'ocorridoEm']);
    const antiga = validarOcorrenciaRefeicao({ ...base, ocorridoEm: new Date('2026-11-23T10:00:00Z') });
    expect(antiga.ok).toBe(false);
    const tolerada = validarOcorrenciaRefeicao({ ...base, ocorridoEm: new Date('2026-11-25T15:04:00Z') });
    expect(tolerada.ok).toBe(true);
  });
});

describe('validarResolucaoOcorrencia', () => {
  const r = { resolvida: false, providencia: 'Nova bandeja servida', ocorridoEm: base.ocorridoEm, agora };
  it('aceita a providência', () => expect(validarResolucaoOcorrencia(r)).toEqual([]));
  it('recusa a já resolvida, sem providência e anterior à ocorrência', () => {
    expect(
      validarResolucaoOcorrencia({
        ...r,
        resolvida: true,
        providencia: ' ok ',
        ocorridoEm: new Date('2026-11-25T16:00:00Z'),
      }).map((p) => p.campo),
    ).toEqual(['versao', 'providencia', 'ocorridoEm']);
  });
});
