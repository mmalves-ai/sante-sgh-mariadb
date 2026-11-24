import { describe, expect, it } from 'vitest';
import {
  conferirAdendoDescricao,
  conferirAutorDaDescricao,
  conferirGravacaoDescricao,
  conferirIntercorrencia,
  ErroDescricaoCirurgica,
  funcaoDescreveCirurgia,
  pendenciasDaDescricao,
} from './descricao.js';

const ok = {
  descricaoTecnica: 'Incisão mediana, dissecção por planos, hemostasia e síntese por planos.',
  envioAnatomopatologico: false,
  descricaoPecas: null,
  sangramentoMl: 150,
  achados: [{ achado: 1, complemento: null }],
};
const codigo = (f: () => unknown) => {
  try {
    f();
    return null;
  } catch (e) {
    return e instanceof ErroDescricaoCirurgica ? e.recusa.codigo : String(e);
  }
};

describe('descrição cirúrgica', () => {
  it('rascunho aceita texto curto; assinar exige a técnica descrita', () => {
    const curta = { ...ok, descricaoTecnica: 'curta' };
    expect(pendenciasDaDescricao(curta, false)).toEqual([]);
    expect(pendenciasDaDescricao(curta, true)).toEqual(['descricao-tecnica-curta']);
  });
  it('peça enviada sem descrição, sangramento implausível e achado repetido', () => {
    expect(
      pendenciasDaDescricao(
        {
          ...ok,
          envioAnatomopatologico: true,
          sangramentoMl: 99999,
          achados: [
            { achado: 2, complemento: null },
            { achado: 2, complemento: 'x' },
          ],
        },
        false,
      ),
    ).toEqual(['pecas-sem-descricao', 'sangramento-implausivel', 'achado-repetido']);
  });
  it('só o cirurgião ou o auxiliar médico da equipe do ato descreve', () => {
    const cir = (profissional: number) => ({ profissional, funcaoMedica: true, cirurgica: true });
    expect(codigo(() => conferirAutorDaDescricao(null, [cir(1)]))).toBe('sem-profissional');
    expect(codigo(() => conferirAutorDaDescricao(9, [cir(1), cir(2)]))).toBe('fora-da-equipe');
    expect(conferirAutorDaDescricao(2, [cir(1), cir(2)])).toBe(2);
    // Instrumentador (não médico) e anestesista (médico, mas não cirúrgico) na equipe: recusados.
    const instrumentador = { profissional: 3, funcaoMedica: false, cirurgica: false };
    const anestesista = { profissional: 4, funcaoMedica: true, cirurgica: false };
    expect(codigo(() => conferirAutorDaDescricao(3, [cir(1), instrumentador]))).toBe('funcao-nao-descreve');
    expect(codigo(() => conferirAutorDaDescricao(4, [cir(1), anestesista]))).toBe('funcao-nao-descreve');
    // Com duas funções no ato, basta uma que descreva.
    expect(conferirAutorDaDescricao(4, [anestesista, cir(4)])).toBe(4);
  });
  it('função que descreve: médica com grau TISS de cirurgião ou auxiliar', () => {
    expect(funcaoDescreveCirurgia('00', true)).toBe(true);
    expect(funcaoDescreveCirurgia('04', true)).toBe(true);
    expect(funcaoDescreveCirurgia('06', true)).toBe(false);
    expect(funcaoDescreveCirurgia('05', false)).toBe(false);
    expect(funcaoDescreveCirurgia('00', false)).toBe(false);
    expect(funcaoDescreveCirurgia(null, true)).toBe(false);
  });
  it('assinada não muda; outro cirurgião não altera; versão vista', () => {
    const p = { profissional: 5, versao: 1, assinar: false };
    expect(
      codigo(() => conferirGravacaoDescricao({ situacao: 'assinada', cirurgiao: 5, versao: 1 }, p, ok)),
    ).toBe('descricao-assinada');
    expect(
      codigo(() => conferirGravacaoDescricao({ situacao: 'rascunho', cirurgiao: 6, versao: 1 }, p, ok)),
    ).toBe('descricao-de-outro-cirurgiao');
    expect(
      codigo(() => conferirGravacaoDescricao({ situacao: 'rascunho', cirurgiao: 5, versao: 2 }, p, ok)),
    ).toBe('versao-desatualizada');
    expect(
      codigo(() => conferirGravacaoDescricao(null, { ...p, versao: null, assinar: true }, ok)),
    ).toBeNull();
    expect(
      codigo(() =>
        conferirGravacaoDescricao(
          null,
          { ...p, versao: null, assinar: true },
          { ...ok, descricaoTecnica: 'x' },
        ),
      ),
    ).toBe('descricao-tecnica-curta');
  });
  it('adendo só na assinada, pelo autor, com texto e motivo', () => {
    const a = { texto: 'Complemento do achado', motivo: 'Esquecimento' };
    expect(
      codigo(() => conferirAdendoDescricao({ situacao: 'rascunho', cirurgiao: 5, versao: 1 }, 5, a)),
    ).toBe('descricao-nao-assinada');
    expect(
      codigo(() => conferirAdendoDescricao({ situacao: 'assinada', cirurgiao: 5, versao: 1 }, 6, a)),
    ).toBe('descricao-de-outro-cirurgiao');
    expect(
      codigo(() =>
        conferirAdendoDescricao({ situacao: 'retificada', cirurgiao: 5, versao: 2 }, 5, { ...a, motivo: '' }),
      ),
    ).toBe('motivo-obrigatorio');
    expect(
      codigo(() => conferirAdendoDescricao({ situacao: 'assinada', cirurgiao: 5, versao: 1 }, 5, a)),
    ).toBeNull();
  });
});

describe('intercorrência do ato', () => {
  const agora = new Date('2026-11-24T15:00:00Z');
  const janela = { entrada: new Date('2026-11-24T10:00:00Z'), saida: new Date('2026-11-24T12:00:00Z') };
  const tipo = { ativo: true, exigeConduta: true, eventoAdverso: false };
  const base = {
    ocorridoEm: new Date('2026-11-24T11:00:00Z'),
    gravidade: 'leve' as const,
    descricao: null,
    conduta: 'Atropina',
  };
  it('aceita dentro da janela e diz se pede notificação', () => {
    expect(conferirIntercorrencia(base, tipo, janela, agora)).toEqual({ pedeNotificacao: false });
    expect(
      conferirIntercorrencia({ ...base, gravidade: 'grave', descricao: 'Bradicardia' }, tipo, janela, agora),
    ).toEqual({ pedeNotificacao: true });
    expect(conferirIntercorrencia(base, { ...tipo, eventoAdverso: true }, janela, agora)).toEqual({
      pedeNotificacao: true,
    });
  });
  it('recusa tipo inativo, futuro, fora da janela, sem conduta e grave sem descrição', () => {
    expect(codigo(() => conferirIntercorrencia(base, { ...tipo, ativo: false }, janela, agora))).toBe(
      'tipo-inexistente',
    );
    expect(
      codigo(() =>
        conferirIntercorrencia(
          { ...base, ocorridoEm: new Date('2026-11-24T16:00:00Z') },
          tipo,
          janela,
          agora,
        ),
      ),
    ).toBe('horario-futuro');
    expect(
      codigo(() =>
        conferirIntercorrencia(
          { ...base, ocorridoEm: new Date('2026-11-24T07:00:00Z') },
          tipo,
          janela,
          agora,
        ),
      ),
    ).toBe('fora-da-janela');
    expect(codigo(() => conferirIntercorrencia({ ...base, conduta: ' ' }, tipo, janela, agora))).toBe(
      'conduta-obrigatoria',
    );
    expect(codigo(() => conferirIntercorrencia({ ...base, gravidade: 'obito' }, tipo, janela, agora))).toBe(
      'descricao-obrigatoria',
    );
  });
});
