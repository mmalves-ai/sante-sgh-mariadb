// Contratos da APAC (M51, etapa 3): as entradas do faturamento.registrarApac e do APAC-Mag. Massa sintética.
import { describe, expect, it } from 'vitest';
import {
  esquemaFiltroApacs,
  esquemaGerarApac,
  esquemaRegistrarApac,
  MOTIVOS_ENCERRAMENTO_APAC,
  MOTIVOS_SAIDA_APAC,
} from './sus-apac.js';
import { REGRAS_CRITICA_SUS, GRAVIDADE_DA_REGRA_SUS } from './sus.js';

const laudo = {
  registro: 710025,
  procedimento: '0305010107',
  cidPrincipal: 'n18.0',
  solicitante: 's1_chaveOpacaSinteticaDoSolicitante',
  dataSolicitacao: '2026-09-01',
  justificativa: 'Justificativa clínica sintética do laudo.',
  laudoEspecifico: 'nefrologia',
  nefrologia: {
    caracteristicaTratamento: 1,
    contraindicacaoTransplante: 1,
    situacaoTransplante: 2,
    acessoVascular: 1,
    inicioTratamento: '2026-01-15',
  },
};

describe('contratos da APAC', () => {
  it('o laudo: o CID normalizado, os CIDs opcionais nulos e o laudo de nefrologia coerente', () => {
    const r = esquemaRegistrarApac.parse({ acao: 'laudo', laudo });
    expect(r.acao === 'laudo' && [r.laudo.cidPrincipal, r.laudo.cidSecundario]).toEqual(['N180', null]);
    expect(
      esquemaRegistrarApac.safeParse({ acao: 'laudo', laudo: { ...laudo, nefrologia: null } }).success,
    ).toBe(false);
    expect(
      esquemaRegistrarApac.safeParse({ acao: 'laudo', laudo: { ...laudo, laudoEspecifico: 'nenhum' } })
        .success,
    ).toBe(false);
    expect(
      esquemaRegistrarApac.safeParse({ acao: 'laudo', laudo: { ...laudo, cidPrincipal: 'XX' } }).success,
    ).toBe(false);
    expect(esquemaRegistrarApac.safeParse({ acao: 'laudo', laudo: { ...laudo, extra: 1 } }).success).toBe(
      false,
    );
  });

  it('a autorização: número de 13 dígitos e o CNS do autorizador conferido pelo dígito', () => {
    const base = {
      acao: 'autorizar',
      apac: 1,
      versao: '0000000001',
      numero: '3312600000013',
      tipo: 'inicial',
      autorizador: '700000000000005',
      dataAutorizacao: '2026-09-02',
      competenciaInicial: '202609',
      competenciaFinal: '202611',
    };
    expect(esquemaRegistrarApac.safeParse(base).success).toBe(true);
    expect(esquemaRegistrarApac.safeParse({ ...base, autorizador: '700000000000006' }).success).toBe(false);
    expect(esquemaRegistrarApac.safeParse({ ...base, numero: '33126' }).success).toBe(false);
    expect(esquemaRegistrarApac.safeParse({ ...base, acao: 'outra' }).success).toBe(false);
  });

  it('o encerramento só com motivo de saída (os de permanência ficam fora)', () => {
    expect(MOTIVOS_ENCERRAMENTO_APAC).not.toContain('21');
    expect(MOTIVOS_ENCERRAMENTO_APAC).toContain('12');
    expect(Object.keys(MOTIVOS_SAIDA_APAC)).toContain('21');
    const e = { acao: 'encerrar', apac: 1, versao: '0000000001', dataEncerramento: '2026-10-05' };
    expect(esquemaRegistrarApac.safeParse({ ...e, motivo: '12' }).success).toBe(true);
    expect(esquemaRegistrarApac.safeParse({ ...e, motivo: '21' }).success).toBe(false);
  });

  it('o filtro, a geração e as cinco regras novas da crítica com a gravidade', () => {
    expect(esquemaFiltroApacs.parse({ prontuario: '12' })).toMatchObject({
      prontuario: 12,
      pagina: 0,
      porPagina: 50,
    });
    expect(esquemaGerarApac.safeParse({ competencia: '202609', versao: '0000000001' }).success).toBe(true);
    for (const r of [
      'apac-sem-autorizacao',
      'apac-sem-producao',
      'apac-numero-invalido',
      'autorizador-sem-identificacao',
      'laudo-especifico-ausente',
    ] as const)
      expect(REGRAS_CRITICA_SUS).toContain(r);
    expect(GRAVIDADE_DA_REGRA_SUS['apac-sem-autorizacao']).toBe('aviso');
    expect(GRAVIDADE_DA_REGRA_SUS['laudo-especifico-ausente']).toBe('bloqueante');
  });

  it('a chave do solicitante é opaca: o CPF em claro não é aceito', () => {
    expect(
      esquemaRegistrarApac.safeParse({ acao: 'laudo', laudo: { ...laudo, solicitante: '99900001700' } })
        .success,
    ).toBe(false);
  });

  it('as justificativas só aceitam CP1252 (o banco é charset NONE): "≥" e emoji são recusados com a troca', () => {
    const neg = { acao: 'negar', apac: 1, versao: '0000000001' };
    const r = esquemaRegistrarApac.safeParse({ ...neg, justificativa: 'Valor ≥ ao teto do gestor 😀' });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues ?? [])).toContain('≥');
    expect(
      esquemaRegistrarApac.safeParse({ ...neg, justificativa: 'Negada pelo gestor: ação sem laudo.' })
        .success,
    ).toBe(true);
    expect(
      esquemaRegistrarApac.safeParse({
        acao: 'laudo',
        laudo: { ...laudo, justificativa: 'Paciente com TFG → 10 ml/min' },
      }).success,
    ).toBe(false);
    expect(
      esquemaRegistrarApac.safeParse({
        acao: 'cancelar',
        apac: 1,
        versao: '0000000001',
        justificativa: 'curta',
      }).success,
    ).toBe(false);
  });

  it('a correção do laudo (só o transcrito: o atendimento e o procedimento não mudam)', () => {
    const transcrito: Record<string, unknown> = { ...laudo };
    delete transcrito['registro'];
    delete transcrito['procedimento'];
    const base = { acao: 'corrigir', apac: 1, versao: '0000000001' };
    expect(esquemaRegistrarApac.safeParse({ ...base, laudo: transcrito }).success).toBe(true);
    expect(
      esquemaRegistrarApac.safeParse({ ...base, laudo: { ...transcrito, procedimento: '0305010107' } })
        .success,
    ).toBe(false);
    expect(
      esquemaRegistrarApac.safeParse({ ...base, laudo: { ...transcrito, nefrologia: null } }).success,
    ).toBe(false);
  });
});
