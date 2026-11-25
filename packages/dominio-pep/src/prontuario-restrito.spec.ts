import { describe, expect, it } from 'vitest';
import {
  aposConferencia,
  avaliarAbertura,
  CONFIGURACAO_RESTRITO_PADRAO as PADRAO,
  fimDoAcesso,
  pedidoExpirado,
  podeDecidirPedido,
  senhaBloqueada,
  validarConfiguracaoRestrito,
  validarDecisaoPedido,
  validarPedidoAcesso,
  validarSenhaPaciente,
} from './prontuario-restrito.js';

const pedido = {
  tipo: 'regular' as const,
  justificativa: 'Interconsulta da cardiologia pedida hoje',
  motivoExigeComplemento: false,
  motivoAtivo: true,
  motivoTipo: 'solicitacao',
  jaAutorizado: false,
  pendenteDoMesmo: false,
};
const quem = {
  usuarioId: 2,
  solicitanteUsuarioId: 1,
  ehMedicoResponsavel: false,
  temPapel: false,
  administrador: false,
};

describe('configuração do prontuário restrito', () => {
  it('padrão é válido', () => expect(validarConfiguracaoRestrito(PADRAO)).toEqual({}));
  it('papel exige o papel; validade e limite em faixa; paciente exige senha', () => {
    const e = validarConfiguracaoRestrito({
      ...PADRAO,
      autorizador: 'papel',
      validadeHoras: 0,
      limiteAcessos: 0,
    });
    expect(Object.keys(e).sort()).toEqual(['limiteAcessos', 'papelId', 'validadeHoras']);
    expect(validarConfiguracaoRestrito({ ...PADRAO, autorizador: 'paciente' })).toHaveProperty(
      'exigeSenhaPaciente',
    );
  });
});

describe('pedido de acesso', () => {
  it('aceita o pedido com motivo de solicitação e justificativa', () =>
    expect(validarPedidoAcesso(pedido, PADRAO)).toEqual({}));
  it('recusa justificativa curta, motivo de outro tipo, duplicado e já autorizado', () => {
    expect(validarPedidoAcesso({ ...pedido, justificativa: 'curta' }, PADRAO)).toHaveProperty(
      'justificativa',
    );
    expect(validarPedidoAcesso({ ...pedido, motivoTipo: 'negacao' }, PADRAO)).toHaveProperty('motivo');
    expect(validarPedidoAcesso({ ...pedido, pendenteDoMesmo: true }, PADRAO)['pedido']).toMatch(/pendente/);
    expect(validarPedidoAcesso({ ...pedido, jaAutorizado: true }, PADRAO)['pedido']).toMatch(/vigente/);
  });
  it('sem exigência de motivo, o regular passa sem texto; o emergencial sempre exige', () => {
    const c = { ...PADRAO, exigeMotivo: false };
    expect(validarPedidoAcesso({ ...pedido, justificativa: '' }, c)).toEqual({});
    expect(validarPedidoAcesso({ ...pedido, justificativa: '', tipo: 'emergencial' }, c)).toHaveProperty(
      'justificativa',
    );
  });
});

describe('quem decide', () => {
  it('nunca o próprio solicitante, nem o administrador', () => {
    const r = podeDecidirPedido({ ...quem, usuarioId: 1, administrador: true }, PADRAO);
    expect(r.ok).toBe(false);
  });
  it('médico responsável pela configuração padrão', () => {
    expect(podeDecidirPedido(quem, PADRAO).ok).toBe(false);
    expect(podeDecidirPedido({ ...quem, ehMedicoResponsavel: true }, PADRAO)).toEqual({
      ok: true,
      concedidaPor: 'equipe_responsavel',
    });
  });
  it('papel, diretoria, paciente e administrador', () => {
    const papel = { ...PADRAO, autorizador: 'papel' as const, papelId: 9 };
    expect(podeDecidirPedido(quem, papel).ok).toBe(false);
    expect(podeDecidirPedido({ ...quem, temPapel: true }, papel).ok).toBe(true);
    expect(podeDecidirPedido(quem, { ...PADRAO, autorizador: 'diretoria_clinica' }).ok).toBe(true);
    expect(podeDecidirPedido(quem, { ...PADRAO, autorizador: 'paciente' }).ok).toBe(false);
    expect(podeDecidirPedido({ ...quem, administrador: true }, PADRAO)).toEqual({
      ok: true,
      concedidaPor: 'administrador',
    });
  });
  it('decisão: só pendente; negar exige motivo', () => {
    expect(validarDecisaoPedido({ situacao: 'aprovado', aprovar: true, motivoDecisao: '' })).toHaveProperty(
      'situacao',
    );
    expect(validarDecisaoPedido({ situacao: 'pendente', aprovar: false, motivoDecisao: '' })).toHaveProperty(
      'motivoDecisao',
    );
    expect(validarDecisaoPedido({ situacao: 'pendente', aprovar: true, motivoDecisao: '' })).toEqual({});
  });
  it('prazo do acesso e expiração do pedido pela validade', () => {
    expect(fimDoAcesso('2026-11-25T10:00:00', PADRAO)).toBe('2026-11-26T10:00:00');
    expect(pedidoExpirado('2026-11-25T10:00:00', '2026-11-26T09:59:59', PADRAO)).toBe(false);
    expect(pedidoExpirado('2026-11-25T10:00:00', '2026-11-26T10:00:00', PADRAO)).toBe(true);
  });
});

describe('senha do paciente', () => {
  it('só números, de 6 a 12, sem repetição nem sequência', () => {
    expect(validarSenhaPaciente('482915')).toEqual({});
    for (const s of ['12345', '1234567890123', 'abc123', '111111', '123456', '987654'])
      expect(validarSenhaPaciente(s)).toHaveProperty('senha');
  });
  it('cinco erros bloqueiam por 30 minutos; acerto zera', () => {
    let s = { tentativasFalhas: 0, bloqueadaAte: null as string | null };
    for (let i = 0; i < 4; i++) s = aposConferencia(s, false, '2026-11-25T10:00:00');
    expect(s).toEqual({ tentativasFalhas: 4, bloqueadaAte: null });
    s = aposConferencia(s, false, '2026-11-25T10:00:00');
    expect(s.bloqueadaAte).toBe('2026-11-25T10:30:00');
    expect(senhaBloqueada(s, '2026-11-25T10:29:59')).toBe(true);
    expect(senhaBloqueada(s, '2026-11-25T10:30:00')).toBe(false);
    expect(aposConferencia({ tentativasFalhas: 3, bloqueadaAte: null }, true, '2026-11-25T10:00:00')).toEqual(
      {
        tentativasFalhas: 0,
        bloqueadaAte: null,
      },
    );
  });
});

describe('abertura e contagem de acessos', () => {
  const a = {
    vigenciaInicio: '2026-11-25T08:00:00',
    vigenciaFim: '2026-11-26T08:00:00',
    revogadaEm: null,
    acessosRealizados: 1,
    limiteAcessos: 2,
  };
  it('numera a abertura e mostra quantas restam', () =>
    expect(avaliarAbertura(a, '2026-11-25T09:00:00')).toEqual({ permitido: true, numero: 2, restantes: 0 }));
  it('limite atingido, revogada, fora da vigência e sem autorização', () => {
    const m = (x: ReturnType<typeof avaliarAbertura>) => (x.permitido ? 'ok' : x.motivo);
    expect(m(avaliarAbertura({ ...a, acessosRealizados: 2 }, '2026-11-25T09:00:00'))).toBe('limite-atingido');
    expect(m(avaliarAbertura({ ...a, revogadaEm: '2026-11-25T08:30:00' }, '2026-11-25T09:00:00'))).toBe(
      'revogada',
    );
    expect(m(avaliarAbertura(a, '2026-11-26T08:00:00'))).toBe('fora-da-vigencia');
    expect(m(avaliarAbertura(null, '2026-11-25T09:00:00'))).toBe('sem-autorizacao');
  });
  it('sem limite: restantes nulo', () =>
    expect(
      avaliarAbertura({ ...a, limiteAcessos: null, acessosRealizados: 40 }, '2026-11-25T09:00:00'),
    ).toEqual({
      permitido: true,
      numero: 41,
      restantes: null,
    }));
});
