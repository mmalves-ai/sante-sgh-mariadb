// Regras puras da AIH própria: a linha lida (autorização + última conta) vira a AIH da tela como a porta em memória a
// mostra — o fechamento 0 sem conta, a justificativa da situação certa, o arquivo pelo número e a situação conhecida.
import { describe, expect, it } from 'vitest';
import { aihDaLinha, TABELAS_SUS_AIH } from './porta-propria-aih.js';

const base = {
  id: 7,
  situacao_tela: 'solicitada',
  situacao_autorizacao: 'solicitada',
  internacao_id: 11,
  numero_prontuario: 22,
  conta_hospitalar_id: null,
  atendimento_id: 33,
  procedimento_solicitado: '0303060212',
  procedimento_realizado: null,
  codigo_cid10_principal: 'I21',
  codigo_cid10_secundario: null,
  carater: '01',
  solicitante: '00000000191',
  data_laudo: '2026-03-02',
  justificativa_laudo: 'j',
  faixa_numeracao_aih_id: null,
  numero_aih: null,
  cns_autorizador: null,
  data_autorizacao: null,
  motivo_autorizacao: null,
  conta_aih_id: null,
  numero_fechamento: null,
  situacao_conta: null,
  motivo_conta: null,
  dias_permanencia: null,
  diarias_uti: null,
  diarias_uti_mes_anterior: null,
  competencia_apresentacao: null,
  numero_arquivo: null,
  reapresentacoes: 0,
  registrada_por: 'FATURISTA',
  registrada_em: '2026-03-02T10:00:00.000000Z',
  alterada_por: null,
  alterada_em: null,
  versao: 1,
};

describe('AIH própria: a linha lida vira a AIH da tela', () => {
  it('sem conta: fechamento 0, nada do fechamento e a justificativa da autorização', () => {
    const a = aihDaLinha({
      ...base,
      situacao_tela: 'negada',
      situacao_autorizacao: 'negada',
      motivo_autorizacao: 'm',
    });
    expect(a).toMatchObject({
      id: 7,
      situacao: 'negada',
      registro: 11,
      prontuario: 22,
      conta: null,
      fechamento: 0,
      procedimentoRealizado: null,
      justificativaSituacao: 'm',
      reapresentacoes: 0,
      arquivo: null,
    });
  });

  it('com conta reaberta: a justificativa da conta; fechada: nenhuma; apresentada: competência e arquivo', () => {
    const conta = {
      conta_aih_id: 5,
      numero_fechamento: 2,
      procedimento_realizado: '0303060212',
      dias_permanencia: 4,
    };
    const reaberta = aihDaLinha({
      ...base,
      ...conta,
      situacao_tela: 'autorizada',
      situacao_autorizacao: 'autorizada',
      situacao_conta: 'reaberta',
      motivo_conta: 'r',
      motivo_autorizacao: null,
    });
    expect(reaberta).toMatchObject({
      situacao: 'autorizada',
      fechamento: 2,
      justificativaSituacao: 'r',
      permanencia: 4,
    });
    const fechada = aihDaLinha({
      ...base,
      ...conta,
      situacao_tela: 'fechada',
      situacao_autorizacao: 'autorizada',
      situacao_conta: 'fechada',
    });
    expect(fechada.justificativaSituacao).toBeNull();
    const apresentada = aihDaLinha({
      ...base,
      ...conta,
      situacao_tela: 'apresentada',
      situacao_autorizacao: 'autorizada',
      situacao_conta: 'apresentada',
      competencia_apresentacao: '202603',
      numero_arquivo: '41',
      reapresentacoes: 1,
    });
    expect(apresentada).toMatchObject({ competenciaApresentacao: '202603', arquivo: 41, reapresentacoes: 1 });
  });

  it('cancelada depois de reaberta: a justificativa é a do cancelamento (na autorização), não a da reabertura', () => {
    const a = aihDaLinha({
      ...base,
      conta_aih_id: 5,
      numero_fechamento: 1,
      situacao_tela: 'cancelada',
      situacao_autorizacao: 'cancelada',
      situacao_conta: 'reaberta',
      motivo_conta: 'R',
      motivo_autorizacao: 'C',
    });
    expect(a).toMatchObject({ situacao: 'cancelada', justificativaSituacao: 'C' });
  });

  it('situação desconhecida no banco é erro (nunca vira outra na tela)', () => {
    expect(() => aihDaLinha({ ...base, situacao_tela: 'devolvida' })).toThrow();
  });

  it('a gravação da AIH declara só as tabelas da autorização e da conta', () => {
    expect([...TABELAS_SUS_AIH]).toEqual([
      'autorizacao_internacao_sus',
      'conta_aih',
      'conta_aih_procedimento',
      'conta_aih_opm',
    ]);
  });
});
