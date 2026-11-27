import { describe, expect, it } from 'vitest';
import {
  efeitoDaAprovacaoPortal,
  problemasDoEfeitoPortal,
  avisoDaSolicitacao,
  cartaoDigitalValido,
  criticarExclusaoLote,
  problemasDaContaPortal,
  problemasDaSolicitacaoPortal,
  proximaSituacaoContaPortal,
  proximaSituacaoSolicitacaoPortal,
  situacaoDoLoteCriticado,
  situacaoDoLoteProcessado,
} from './portais-operadora.js';

const codigos = (p: readonly { codigo: string }[]) => p.map((x) => x.codigo);
const fatos = {
  hoje: '2026-11-26',
  situacaoBeneficiario: 'ativo' as const,
  adesao: '2025-01-01',
  repetida: false,
};

describe('conta do portal da operadora', () => {
  it('exige o titular de cada portal, o e-mail e o celular com DDD', () => {
    expect(
      problemasDaContaPortal({
        portal: 'beneficiario',
        login: 'a@b.test',
        email: null,
        celular: null,
        beneficiario: 1,
      }),
    ).toEqual([]);
    expect(
      codigos(problemasDaContaPortal({ portal: 'beneficiario', login: 'x', email: null, celular: '123' })),
    ).toEqual(['email-obrigatorio', 'celular-invalido', 'beneficiario-obrigatorio']);
    expect(
      codigos(
        problemasDaContaPortal({
          portal: 'contratante',
          login: 'g@c.test',
          email: null,
          celular: '(11) 98888-7777',
          contratante: 2,
        }),
      ),
    ).toEqual(['gestor-obrigatorio']);
    expect(
      codigos(
        problemasDaContaPortal({ portal: 'corretor', login: 'c@c.test', email: 'ruim', celular: null }),
      ),
    ).toEqual(['email-invalido', 'corretor-obrigatorio']);
    expect(
      problemasDaContaPortal({
        portal: 'corretor',
        login: 'c@c.test',
        email: null,
        celular: null,
        vendedor: 3,
      }),
    ).toEqual([]);
  });

  it('ativa só a convidada com termos, bloqueia com motivo e encerrada não volta', () => {
    expect(proximaSituacaoContaPortal('convidada', 'ativar', { termosAceitos: true })).toEqual({
      situacao: 'ativa',
    });
    expect(proximaSituacaoContaPortal('convidada', 'ativar')).toMatchObject({
      problema: { codigo: 'termos-nao-aceitos' },
    });
    expect(proximaSituacaoContaPortal('ativa', 'ativar', { termosAceitos: true })).toMatchObject({
      problema: { codigo: 'conta-nao-convidada' },
    });
    expect(proximaSituacaoContaPortal('ativa', 'bloquear')).toMatchObject({
      problema: { codigo: 'motivo-obrigatorio' },
    });
    expect(proximaSituacaoContaPortal('ativa', 'bloquear', { motivo: 'fraude' })).toEqual({
      situacao: 'bloqueada',
    });
    expect(proximaSituacaoContaPortal('bloqueada', 'desbloquear')).toEqual({ situacao: 'ativa' });
    expect(proximaSituacaoContaPortal('ativa', 'desbloquear')).toMatchObject({
      problema: { codigo: 'conta-nao-bloqueada' },
    });
    expect(proximaSituacaoContaPortal('encerrada', 'desbloquear')).toMatchObject({
      problema: { codigo: 'conta-encerrada' },
    });
  });
});

describe('solicitação do portal', () => {
  const base = {
    beneficiario: 10,
    motivo: null,
    dataEfeito: null,
    pedidoReembolso: null,
    dados: null,
    observacao: null,
  };
  it('recorta o tipo por portal e pede o que cada tipo precisa', () => {
    expect(
      problemasDaSolicitacaoPortal({ ...base, portal: 'beneficiario', tipo: 'segunda_via_cartao' }, fatos),
    ).toEqual([]);
    expect(
      codigos(
        problemasDaSolicitacaoPortal(
          { ...base, portal: 'beneficiario', tipo: 'inclusao_beneficiario' },
          fatos,
        ),
      ),
    ).toEqual(['tipo-fora-do-portal', 'dados-obrigatorios']);
    expect(
      codigos(
        problemasDaSolicitacaoPortal({ ...base, portal: 'corretor', tipo: 'outro', observacao: 'x' }, fatos),
      ),
    ).toEqual(['tipo-fora-do-portal']);
    expect(
      codigos(problemasDaSolicitacaoPortal({ ...base, portal: 'beneficiario', tipo: 'reembolso' }, fatos)),
    ).toEqual(['reembolso-obrigatorio']);
    expect(
      codigos(
        problemasDaSolicitacaoPortal(
          { ...base, portal: 'contratante', tipo: 'exclusao_beneficiario', dataEfeito: '2024-12-31' },
          fatos,
        ),
      ),
    ).toEqual(['motivo-obrigatorio', 'efeito-antes-da-adesao']);
    expect(
      problemasDaSolicitacaoPortal(
        {
          ...base,
          portal: 'contratante',
          tipo: 'exclusao_beneficiario',
          motivo: 4,
          dataEfeito: '2026-12-01',
        },
        fatos,
      ),
    ).toEqual([]);
    expect(
      codigos(
        problemasDaSolicitacaoPortal(
          { ...base, portal: 'contratante', tipo: 'reativacao_beneficiario', dataEfeito: '2026-12-01' },
          fatos,
        ),
      ),
    ).toEqual(['beneficiario-ativo']);
    expect(
      problemasDaSolicitacaoPortal(
        { ...base, portal: 'contratante', tipo: 'reativacao_beneficiario', dataEfeito: '2026-12-01' },
        { ...fatos, situacaoBeneficiario: 'excluido' },
      ),
    ).toEqual([]);
    expect(
      codigos(
        problemasDaSolicitacaoPortal(
          { ...base, portal: 'beneficiario', tipo: 'segunda_via_cartao' },
          { ...fatos, situacaoBeneficiario: null, repetida: true },
        ),
      ),
    ).toEqual(['beneficiario-fora-da-conta', 'solicitacao-repetida']);
  });

  it('decidida não volta; reprovar e pedir documento exigem o resultado; conclui só a aprovada', () => {
    expect(proximaSituacaoSolicitacaoPortal('aberta', 'analisar', null)).toEqual({ situacao: 'em_analise' });
    expect(proximaSituacaoSolicitacaoPortal('em_analise', 'reprovar', ' ')).toMatchObject({
      problema: { codigo: 'resultado-obrigatorio' },
    });
    expect(proximaSituacaoSolicitacaoPortal('em_analise', 'pedir_documento', 'RG')).toEqual({
      situacao: 'pendente_documento',
    });
    expect(proximaSituacaoSolicitacaoPortal('pendente_documento', 'aprovar', null)).toEqual({
      situacao: 'aprovada',
    });
    expect(proximaSituacaoSolicitacaoPortal('aprovada', 'cancelar', null)).toMatchObject({
      problema: { codigo: 'solicitacao-decidida' },
    });
    expect(proximaSituacaoSolicitacaoPortal('aprovada', 'concluir', null)).toEqual({ situacao: 'concluida' });
    expect(proximaSituacaoSolicitacaoPortal('aberta', 'concluir', null)).toMatchObject({
      problema: { codigo: 'solicitacao-nao-aprovada' },
    });
  });
});

describe('exclusão em lote da contratante', () => {
  const doContratante = [
    {
      id: 1,
      matricula: 'M1',
      nome: 'Titular A',
      situacao: 'ativo' as const,
      adesao: '2025-01-01',
      titular: null,
    },
    {
      id: 2,
      matricula: 'M2',
      nome: 'Titular B',
      situacao: 'excluido' as const,
      adesao: '2025-01-01',
      titular: null,
    },
    {
      id: 3,
      matricula: 'M3',
      nome: 'Dependente C',
      situacao: 'suspenso' as const,
      adesao: '2026-06-01',
      titular: 1,
    },
  ];
  it('critica linha a linha e totaliza', () => {
    const r = criticarExclusaoLote(
      [
        { sequencia: 1, matricula: 'M1', motivo: 7, dataEfeito: '2026-12-01' },
        { sequencia: 2, matricula: 'M1', motivo: 7, dataEfeito: '2026-12-01' },
        { sequencia: 3, matricula: 'M2', motivo: 7, dataEfeito: '2026-12-01' },
        { sequencia: 4, matricula: 'X9', motivo: 7, dataEfeito: '2026-12-01' },
        { sequencia: 5, matricula: 'M3', motivo: 7, dataEfeito: '2026-05-31' },
        { sequencia: 6, matricula: 'M3', motivo: null, dataEfeito: '2026-12-01' },
        { sequencia: 7, matricula: ' ', motivo: 7, dataEfeito: '2026-12-01' },
        { sequencia: 8, matricula: 'F1', motivo: 7, dataEfeito: '2026-12-01' },
      ],
      [...doContratante, { ...doContratante[0]!, matricula: 'F1' }],
    );
    expect(r.linhas.map((x) => x.critica)).toEqual([
      null,
      'linha-repetida',
      'beneficiario-ja-excluido',
      'beneficiario-fora-da-contratante',
      'efeito-antes-da-adesao',
      'linha-repetida',
      'matricula-obrigatoria',
      'linha-repetida',
    ]);
    expect(r.totais).toEqual({ registros: 8, aceitos: 1, rejeitados: 7 });
    expect(situacaoDoLoteCriticado(r.totais)).toBe('criticado');
    expect(situacaoDoLoteCriticado({ aceitos: 0, rejeitados: 2 })).toBe('rejeitado');
    expect(situacaoDoLoteProcessado(r.totais)).toBe('processado_parcial');
    expect(situacaoDoLoteProcessado({ aceitos: 2, rejeitados: 0 })).toBe('processado');
  });
});

describe('cartão digital e mensagens', () => {
  it('vale só ativo na vigência; o aviso fica registrado sem envio (canal desligado)', () => {
    expect(
      cartaoDigitalValido(
        { situacao: 'ativo', inicioVigencia: '2025-01-01', fimVigencia: null },
        '2026-11-26',
      ),
    ).toBe(true);
    expect(
      cartaoDigitalValido(
        { situacao: 'ativo', inicioVigencia: '2025-01-01', fimVigencia: '2026-01-01' },
        '2026-11-26',
      ),
    ).toBe(false);
    expect(
      cartaoDigitalValido(
        { situacao: 'suspenso', inicioVigencia: '2025-01-01', fimVigencia: null },
        '2026-11-26',
      ),
    ).toBe(false);
    expect(
      avisoDaSolicitacao({ recebeNotificacoes: true, celular: '11988887777', email: null }, 'aprovada')
        .motivo,
    ).toBe('canal-desligado');
    expect(
      avisoDaSolicitacao({ recebeNotificacoes: false, celular: '11988887777', email: null }, 'aprovada')
        .motivo,
    ).toBe('sem-notificacao');
    expect(
      avisoDaSolicitacao({ recebeNotificacoes: true, celular: null, email: null }, 'aprovada').motivo,
    ).toBe('sem-contato');
  });
});

describe('efeito da aprovação no cadastro (C3-027)', () => {
  it('só a segunda via e a reativação mexem no cadastro; os demais seguem pela tela própria', () => {
    expect(efeitoDaAprovacaoPortal('segunda_via_cartao')).toBe('segunda_via');
    expect(efeitoDaAprovacaoPortal('reativacao_beneficiario')).toBe('reativacao');
    expect(efeitoDaAprovacaoPortal('inclusao_beneficiario')).toBeNull();
    expect(efeitoDaAprovacaoPortal('reembolso')).toBeNull();
  });
  it('via só ao ativo; reativação só ao excluído sem motivo que a impeça', () => {
    const f = (situacaoBeneficiario: string | null, motivoImpedeReativacao = false) => ({
      situacaoBeneficiario,
      motivoImpedeReativacao,
    });
    expect(problemasDoEfeitoPortal('segunda_via', f(null))[0]?.codigo).toBe('beneficiario-obrigatorio');
    expect(problemasDoEfeitoPortal('segunda_via', f('ativo'))).toEqual([]);
    expect(problemasDoEfeitoPortal('segunda_via', f('excluido'))[0]?.codigo).toBe('beneficiario-inativo');
    expect(problemasDoEfeitoPortal('reativacao', f('ativo'))[0]?.codigo).toBe('beneficiario-ativo');
    expect(problemasDoEfeitoPortal('reativacao', f('excluido'))).toEqual([]);
    expect(problemasDoEfeitoPortal('reativacao', f('excluido', true))[0]?.codigo).toBe(
      'motivo-impede-reativacao',
    );
  });
});
