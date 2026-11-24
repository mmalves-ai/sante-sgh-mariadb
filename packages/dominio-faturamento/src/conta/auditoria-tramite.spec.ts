import { describe, expect, it } from 'vitest';
import {
  avaliarParecerItem,
  cnpjValido,
  concluirAuditoria,
  conteudoDoProtocolo,
  podeNoProtocolo,
  situacaoAoResolver,
  situacaoAposConferencia,
  validarAberturaAuditoria,
  validarAnexoGuia,
  validarPendenciaGuia,
  validarProtocolo,
  validarRespostaGuia,
} from './auditoria-tramite.js';

describe('auditoria da conta: parecer do item', () => {
  const base = { quantidadeOriginal: 4, valorOriginal: 100 };
  it('mantido não muda nada', () => {
    expect(avaliarParecerItem({ ...base, decisao: 'mantido' })).toEqual({
      ok: true,
      quantidadeAceita: 4,
      valorAceito: 100,
      valorGlosa: 0,
      mudaValor: false,
    });
  });
  it('alterado: o valor sai do unitário e exige justificativa', () => {
    expect(avaliarParecerItem({ ...base, decisao: 'alterado', quantidadeAceita: 3 })).toMatchObject({
      ok: false,
      erros: { justificativa: expect.any(String) },
    });
    expect(
      avaliarParecerItem({ ...base, decisao: 'alterado', quantidadeAceita: 3, justificativa: 'Usou 3' }),
    ).toMatchObject({ ok: true, quantidadeAceita: 3, valorAceito: 75, valorGlosa: 25, mudaValor: true });
    expect(
      avaliarParecerItem({ ...base, decisao: 'alterado', quantidadeAceita: 4, justificativa: 'x' }),
    ).toMatchObject({ ok: false });
  });
  it('alterado para mais não é glosa', () => {
    const r = avaliarParecerItem({
      ...base,
      decisao: 'alterado',
      quantidadeAceita: 5,
      justificativa: 'faltou 1',
    });
    expect(r).toMatchObject({ ok: true, valorAceito: 125, valorGlosa: 0 });
  });
  it('glosado exige motivo; sem valor, a glosa é total; parcial pelo valor', () => {
    expect(avaliarParecerItem({ ...base, decisao: 'glosado' })).toMatchObject({
      ok: false,
      erros: { motivoGlosaId: expect.any(String) },
    });
    expect(avaliarParecerItem({ ...base, decisao: 'glosado', motivoGlosaId: 7 })).toMatchObject({
      ok: true,
      quantidadeAceita: 0,
      valorAceito: 0,
      valorGlosa: 100,
    });
    expect(
      avaliarParecerItem({ ...base, decisao: 'glosado', motivoGlosaId: 7, valorAceito: 60 }),
    ).toMatchObject({ ok: true, quantidadeAceita: 4, valorAceito: 60, valorGlosa: 40 });
    expect(
      avaliarParecerItem({ ...base, decisao: 'glosado', motivoGlosaId: 7, valorAceito: 100 }),
    ).toMatchObject({ ok: false, erros: { valorAceito: expect.any(String) } });
    expect(
      avaliarParecerItem({ ...base, decisao: 'glosado', motivoGlosaId: 7, quantidadeAceita: 6 }),
    ).toMatchObject({ ok: false });
  });
  it('excluído zera com justificativa', () => {
    expect(avaliarParecerItem({ ...base, decisao: 'excluido' })).toMatchObject({ ok: false });
    expect(avaliarParecerItem({ ...base, decisao: 'excluido', justificativa: 'duplicado' })).toMatchObject({
      ok: true,
      valorAceito: 0,
      valorGlosa: 100,
    });
  });
  it('negativos recusados', () => {
    expect(
      avaliarParecerItem({ ...base, decisao: 'alterado', quantidadeAceita: -1, justificativa: 'x' }),
    ).toMatchObject({ ok: false, erros: { quantidadeAceita: expect.any(String) } });
  });
});

describe('auditoria da conta: conclusão e abertura', () => {
  it('soma o efeito e diz o resultado', () => {
    expect(concluirAuditoria(500, [])).toMatchObject({ valorAuditado: 500, resultado: 'sem_alteracao' });
    expect(
      concluirAuditoria(500, [
        { decisao: 'alterado', valorOriginal: 100, valorAceito: 75, valorGlosa: 25 },
        { decisao: 'mantido', valorOriginal: 50, valorAceito: 50, valorGlosa: 0 },
      ]),
    ).toEqual({ valorAuditado: 475, valorGlosaInterna: 25, resultado: 'com_ajuste', itensMudados: 1 });
    expect(
      concluirAuditoria(500, [
        { decisao: 'glosado', valorOriginal: 100, valorAceito: 0, valorGlosa: 100 },
        { decisao: 'alterado', valorOriginal: 10, valorAceito: 30, valorGlosa: 0 },
      ]),
    ).toMatchObject({ valorAuditado: 420, valorGlosaInterna: 100, resultado: 'com_glosa_interna' });
  });
  it('abertura: uma por vez; operadora com empresa; interna sem', () => {
    const b = { modalidade: 'interna' as const, empresaExternaId: null, auditorProfissionalId: null };
    expect(validarAberturaAuditoria({ ...b, auditoriaEmAndamento: false })).toEqual({});
    expect(validarAberturaAuditoria({ ...b, auditoriaEmAndamento: true })).toHaveProperty('contaId');
    expect(
      validarAberturaAuditoria({ ...b, modalidade: 'operadora', auditoriaEmAndamento: false }),
    ).toHaveProperty('empresaExternaId');
    expect(
      validarAberturaAuditoria({ ...b, empresaExternaId: 3, auditoriaEmAndamento: false }),
    ).toHaveProperty('empresaExternaId');
  });
  it('CNPJ com dígito verificador', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true);
    expect(cnpjValido('11222333000182')).toBe(false);
    expect(cnpjValido('00000000000000')).toBe(false);
  });
});

describe('protocolo de documentos entre setores', () => {
  it('valida setores, itens e repetição', () => {
    expect(validarProtocolo({ remetente: 1, destinatario: 1, itens: [] })).toMatchObject({
      destinatarioId: expect.any(String),
      itens: expect.any(String),
    });
    expect(
      validarProtocolo({
        remetente: 1,
        destinatario: 2,
        itens: [
          { tipo: 'conta', alvoId: 9 },
          { tipo: 'conta', alvoId: 9 },
          { tipo: 'documento', descricao: ' ' },
          { tipo: 'atendimento' },
        ],
      }),
    ).toEqual({
      'itens.1': expect.any(String),
      'itens.2': expect.any(String),
      'itens.3': expect.any(String),
    });
  });
  it('conteúdo, transições e situação da conferência', () => {
    expect(conteudoDoProtocolo([{ tipo: 'conta', alvoId: 1 }])).toBe('conta');
    expect(conteudoDoProtocolo([{ tipo: 'volume_prontuario', alvoId: 1 }])).toBe('prontuario');
    expect(
      conteudoDoProtocolo([
        { tipo: 'conta', alvoId: 1 },
        { tipo: 'documento', descricao: 'x' },
      ]),
    ).toBe('misto');
    expect(podeNoProtocolo('aberto', 'enviar')).toBeNull();
    expect(podeNoProtocolo('enviado', 'enviar')).not.toBeNull();
    expect(podeNoProtocolo('enviado', 'conferir')).toBeNull();
    expect(podeNoProtocolo('recebido_parcial', 'conferir')).toBeNull();
    expect(podeNoProtocolo('enviado', 'cancelar')).not.toBeNull();
    const i = (recebido: boolean, recusado: boolean) => ({ recebido, recusado });
    expect(situacaoAposConferencia([i(true, false), i(true, false)])).toBe('recebido');
    expect(situacaoAposConferencia([i(true, false), i(false, false)])).toBe('recebido_parcial');
    expect(situacaoAposConferencia([i(true, false), i(false, true)])).toBe('recebido');
    expect(situacaoAposConferencia([i(false, true)])).toBe('recusado');
  });
});

describe('guia do convênio: resposta, pendência e anexo', () => {
  const r = { situacaoAtual: 'em_analise', pendenciasAbertas: 0, hoje: '2026-11-24' };
  it('autorização exige senha e nenhuma pendência; negativa exige motivo', () => {
    expect(validarRespostaGuia({ ...r, resposta: 'autorizada' })).toHaveProperty('senha');
    expect(validarRespostaGuia({ ...r, resposta: 'autorizada', senha: 'A1' })).toEqual({});
    expect(
      validarRespostaGuia({ ...r, resposta: 'autorizada', senha: 'A1', pendenciasAbertas: 1 }),
    ).toHaveProperty('resposta');
    expect(validarRespostaGuia({ ...r, resposta: 'negada' })).toHaveProperty('motivoNegacao');
    expect(
      validarRespostaGuia({ ...r, resposta: 'autorizada', senha: 'A', validadeSenha: '2026-11-01' }),
    ).toHaveProperty('validadeSenha');
    expect(
      validarRespostaGuia({
        ...r,
        resposta: 'autorizada_parcial',
        senha: 'A',
        diasSolicitados: 5,
        diasAutorizados: 6,
      }),
    ).toHaveProperty('diasAutorizados');
    expect(validarRespostaGuia({ ...r, situacaoAtual: 'cancelada', resposta: 'em_analise' })).toHaveProperty(
      'resposta',
    );
  });
  it('pendência: motivo, prazo e guia viva; ao resolver volta à situação anterior', () => {
    const a = '2026-11-24T10:00:00.000Z';
    expect(validarPendenciaGuia({ situacaoAtual: 'em_analise', motivoId: null, agora: a })).toHaveProperty(
      'motivoId',
    );
    expect(
      validarPendenciaGuia({
        situacaoAtual: 'em_analise',
        motivoId: 1,
        prazo: '2026-11-01T00:00:00.000Z',
        agora: a,
      }),
    ).toHaveProperty('prazo');
    expect(validarPendenciaGuia({ situacaoAtual: 'utilizada', motivoId: 1, agora: a })).toHaveProperty(
      'motivoId',
    );
    expect(situacaoAoResolver({ situacaoAntesDaPendencia: 'solicitada', outrasAbertas: 0 })).toEqual({
      situacao: 'solicitada',
    });
    expect(situacaoAoResolver({ situacaoAntesDaPendencia: 'solicitada', outrasAbertas: 1 })).toEqual({
      situacao: null,
    });
    expect(situacaoAoResolver({ situacaoAntesDaPendencia: null, outrasAbertas: 0 })).toEqual({
      situacao: 'em_analise',
    });
  });
  it('anexo: tipo, formato e tamanho', () => {
    const b = {
      situacaoGuia: 'solicitada',
      tipoDocumento: 'laudo',
      tipoMime: 'application/pdf',
      tamanhoBytes: 10,
    };
    expect(validarAnexoGuia(b)).toEqual({});
    expect(validarAnexoGuia({ ...b, tipoMime: 'text/plain' })).toHaveProperty('arquivo');
    expect(validarAnexoGuia({ ...b, tamanhoBytes: 11 * 1024 * 1024 })).toHaveProperty('arquivo');
    expect(validarAnexoGuia({ ...b, tipoDocumento: 'x' })).toHaveProperty('tipoDocumento');
  });
});
