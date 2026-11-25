import { describe, expect, it } from 'vitest';
import {
  conferirMembro,
  conferirOficina,
  type MembroOficina,
  planejarDecisao,
  planejarOrcamento,
  planejarRemessa,
  planejarRetorno,
} from './oficina-orcamento.js';

const oficina = {
  codigo: 'ENG-CLIN',
  nome: 'Engenharia clínica',
  terceirizada: false,
  fornecedor: null,
  notificaPorEmail: false,
  email: null,
};
const aprovador = (o: Partial<MembroOficina> = {}): MembroOficina => ({
  usuario: 7,
  funcao: 'aprovador',
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  ativo: true,
  alcada: 5000,
  ...o,
});
const decisao = (o: Partial<Parameters<typeof planejarDecisao>[0]> = {}) =>
  planejarDecisao({
    decisao: 'aprovado',
    orcamento: { situacao: 'pendente', valor: 1200, registradoPor: 3, validade: '2026-12-31' },
    quem: 7,
    administrador: false,
    membros: [aprovador()],
    justificativa: null,
    hoje: '2026-11-25',
    ...o,
  });

describe('oficina', () => {
  it('aceita a oficina própria e confere código, nome, fornecedor e e-mail', () => {
    expect(conferirOficina(oficina)).toBeNull();
    expect(conferirOficina({ ...oficina, codigo: 'x' })).toMatchObject({
      recusa: 'codigo-invalido',
      campo: 'codigo',
    });
    expect(conferirOficina({ ...oficina, nome: ' ' })).toMatchObject({ recusa: 'nome-obrigatorio' });
    expect(conferirOficina({ ...oficina, terceirizada: true })).toMatchObject({
      recusa: 'terceirizada-sem-fornecedor',
      campo: 'fornecedor',
    });
    expect(conferirOficina({ ...oficina, terceirizada: true, fornecedor: 4 })).toBeNull();
    expect(conferirOficina({ ...oficina, notificaPorEmail: true })).toMatchObject({
      recusa: 'email-obrigatorio',
    });
    expect(conferirOficina({ ...oficina, email: 'sem-arroba' })).toMatchObject({ recusa: 'email-invalido' });
  });
  it('membro: vigência e alçada só do aprovador', () => {
    expect(conferirMembro(aprovador())).toBeNull();
    expect(conferirMembro(aprovador({ vigenciaFim: '2025-01-01' }))).toMatchObject({
      recusa: 'vigencia-invertida',
    });
    expect(conferirMembro(aprovador({ funcao: 'tecnico' }))).toMatchObject({
      recusa: 'alcada-so-do-aprovador',
    });
    expect(conferirMembro(aprovador({ alcada: 0 }))).toMatchObject({ recusa: 'alcada-invalida' });
    expect(conferirMembro(aprovador({ funcao: 'tecnico', alcada: null }))).toBeNull();
  });
});

describe('orçamento da OS', () => {
  const base = {
    situacaoOs: 'emAtendimento' as const,
    valor: 850.5,
    descricao: 'Troca da fonte',
    validade: null,
    hoje: '2026-11-25',
    haAprovado: false,
  };
  it('registra o orçamento na OS aberta', () => {
    expect(planejarOrcamento(base)).toEqual({ ok: true });
    expect(planejarOrcamento({ ...base, situacaoOs: 'concluida' })).toMatchObject({ recusa: 'os-fechada' });
    expect(planejarOrcamento({ ...base, valor: 0 })).toMatchObject({ recusa: 'valor-invalido' });
    expect(planejarOrcamento({ ...base, valor: 10.555 })).toMatchObject({ recusa: 'valor-invalido' });
    expect(planejarOrcamento({ ...base, descricao: 'x' })).toMatchObject({ recusa: 'descricao-obrigatoria' });
    expect(planejarOrcamento({ ...base, validade: '2026-11-24' })).toMatchObject({
      recusa: 'validade-vencida',
    });
    expect(planejarOrcamento({ ...base, haAprovado: true })).toMatchObject({ recusa: 'ja-aprovado' });
  });
  it('aprovação pelo aprovador vigente dentro da alçada', () => {
    expect(decisao()).toEqual({ ok: true });
    expect(
      decisao({ orcamento: { situacao: 'pendente', valor: 9000, registradoPor: 3, validade: null } }),
    ).toMatchObject({
      recusa: 'acima-da-alcada',
    });
    expect(
      decisao({
        membros: [aprovador({ alcada: null })],
        orcamento: { situacao: 'pendente', valor: 9000, registradoPor: 3, validade: null },
      }),
    ).toEqual({ ok: true });
    expect(decisao({ membros: [aprovador({ funcao: 'tecnico', alcada: null })] })).toMatchObject({
      recusa: 'sem-alcada',
    });
    expect(decisao({ membros: [aprovador({ vigenciaFim: '2026-10-31' })] })).toMatchObject({
      recusa: 'sem-alcada',
    });
    expect(decisao({ quem: 3, membros: [aprovador({ usuario: 3 })] })).toMatchObject({
      recusa: 'mesmo-autor',
    });
    expect(
      decisao({ orcamento: { situacao: 'aprovado', valor: 1, registradoPor: 3, validade: null } }),
    ).toMatchObject({
      recusa: 'orcamento-decidido',
    });
    expect(
      decisao({ orcamento: { situacao: 'pendente', valor: 1, registradoPor: 3, validade: '2026-11-01' } }),
    ).toMatchObject({
      recusa: 'orcamento-vencido',
    });
  });
  it('reprovação exige justificativa; o administrador decide sem alçada', () => {
    expect(decisao({ decisao: 'reprovado', justificativa: 'caro' })).toMatchObject({
      recusa: 'justificativa-curta',
    });
    expect(decisao({ decisao: 'reprovado', justificativa: 'Valor acima do mercado' })).toEqual({ ok: true });
    expect(decisao({ administrador: true, membros: [], quem: 3 })).toEqual({ ok: true });
  });
});

describe('remessa e retorno do conserto externo', () => {
  const r = {
    situacaoOs: 'emAtendimento' as const,
    temEquipamento: true,
    remessaAberta: false,
    orcamento: 'aprovado' as const,
    enviadoEm: '2026-11-25T10:00:00',
    previsaoRetorno: '2026-12-05',
    termo: 'Com cabo e sensor',
  };
  it('a saída põe a OS aguardando o fornecedor', () => {
    expect(planejarRemessa(r)).toEqual({ ok: true, para: 'aguardandoTerceiro' });
    expect(planejarRemessa({ ...r, orcamento: null })).toMatchObject({ ok: true });
    expect(planejarRemessa({ ...r, situacaoOs: 'aberta' })).toMatchObject({ recusa: 'situacao-nao-permite' });
    expect(planejarRemessa({ ...r, temEquipamento: false })).toMatchObject({ recusa: 'sem-equipamento' });
    expect(planejarRemessa({ ...r, remessaAberta: true })).toMatchObject({ recusa: 'remessa-aberta' });
    expect(planejarRemessa({ ...r, orcamento: 'pendente' })).toMatchObject({ recusa: 'orcamento-pendente' });
    expect(planejarRemessa({ ...r, orcamento: 'reprovado' })).toMatchObject({
      recusa: 'orcamento-reprovado',
    });
    expect(planejarRemessa({ ...r, previsaoRetorno: '2026-11-24' })).toMatchObject({
      recusa: 'previsao-invertida',
    });
    expect(planejarRemessa({ ...r, termo: '' })).toMatchObject({ recusa: 'termo-obrigatorio' });
  });
  it('o retorno devolve a OS ao atendimento', () => {
    const t = {
      situacaoRemessa: 'enviado' as const,
      enviadoEm: '2026-11-20T10:00:00',
      retornadoEm: '2026-11-25T09:00:00',
      agora: '2026-11-25T10:00:00',
      resultado: 'consertado' as const,
      observacao: null,
    };
    expect(planejarRetorno(t)).toEqual({ ok: true, para: 'emAtendimento' });
    expect(planejarRetorno({ ...t, situacaoRemessa: 'retornado' })).toMatchObject({
      recusa: 'remessa-retornada',
    });
    expect(planejarRetorno({ ...t, retornadoEm: '2026-11-19T10:00:00' })).toMatchObject({
      recusa: 'retorno-antes-da-saida',
    });
    expect(planejarRetorno({ ...t, retornadoEm: '2026-11-26T10:00:00' })).toMatchObject({
      recusa: 'retorno-futuro',
    });
    expect(planejarRetorno({ ...t, resultado: 'sem_conserto' })).toMatchObject({
      recusa: 'justificativa-curta',
    });
    expect(
      planejarRetorno({ ...t, resultado: 'sem_conserto', observacao: 'Peça descontinuada' }),
    ).toMatchObject({ ok: true });
  });
});
