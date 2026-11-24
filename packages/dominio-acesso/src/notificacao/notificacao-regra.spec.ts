import { describe, expect, it } from 'vitest';
import {
  type AvisoPendente,
  camposDaChave,
  conferirEdicaoRegra,
  consolidarAvisos,
  fimDaJanela,
  medirRespostas,
  situacaoInicialEnvio,
  TENTATIVAS_MAXIMAS,
  transicaoEnvio,
  validarRegraAlerta,
  validarRegraConsolidacao,
} from './notificacao-regra.js';

const T0 = new Date('2026-11-24T10:00:00');
const min = (n: number) => new Date(T0.getTime() + n * 60_000);
const aviso = (
  id: number,
  usuario: number,
  minuto: number,
  extra: Partial<AvisoPendente> = {},
): AvisoPendente => ({
  id,
  usuario,
  regra: 1,
  paciente: null,
  atendimento: null,
  entidade: null,
  entidadeId: null,
  assunto: null,
  geradoEm: min(minuto),
  ...extra,
});
const REGRA = { janelaMinutos: 15, campos: ['regra'] as const, limitePorUsuario: null, horarioResumo: null };

describe('regra de consolidação', () => {
  const base = { codigo: 'C1', nome: 'Junta', janelaMinutos: 15, campos: ['regra'], formato: 'lista' };
  it('aceita a regra válida e recusa cada erro', () => {
    expect(validarRegraConsolidacao(base)).toBeNull();
    expect(validarRegraConsolidacao({ ...base, janelaMinutos: 0 })).toBe('janela-invalida');
    expect(validarRegraConsolidacao({ ...base, janelaMinutos: 7 * 24 * 60 + 1 })).toBe('janela-invalida');
    expect(validarRegraConsolidacao({ ...base, campos: [] })).toBe('agrupamento-invalido');
    expect(validarRegraConsolidacao({ ...base, campos: ['regra', 'regra'] })).toBe('agrupamento-invalido');
    expect(validarRegraConsolidacao({ ...base, campos: ['setor'] })).toBe('agrupamento-invalido');
    expect(validarRegraConsolidacao({ ...base, limitePorUsuario: 3 })).toBe('limite-sem-periodo');
    expect(validarRegraConsolidacao({ ...base, limitePorUsuario: 3, periodoLimiteMinutos: 60 })).toBeNull();
    expect(validarRegraConsolidacao({ ...base, horarioResumo: '25:00' })).toBe('horario-invalido');
    expect(validarRegraConsolidacao({ ...base, formato: 'tabela' })).toBe('formato-invalido');
    expect(validarRegraConsolidacao({ ...base, codigo: 'a b' })).toBe('codigo-invalido');
  });
  it('lê os campos gravados na chave', () => {
    expect(camposDaChave('regra, paciente,xx')).toEqual(['regra', 'paciente']);
  });
});

describe('regra de alerta', () => {
  const base = {
    codigo: 'R1',
    nome: 'Regra',
    mensagem: 'Atenção',
    vigenciaInicio: '2026-11-01',
    repeticao: 'sempre',
    ativo: true,
    destinatarios: 1,
  };
  it('valida conteúdo, vigência, repetição e destinatário', () => {
    expect(validarRegraAlerta(base)).toBeNull();
    expect(validarRegraAlerta({ ...base, mensagem: ' ' })).toBe('mensagem-vazia');
    expect(validarRegraAlerta({ ...base, idadeMinima: 10, idadeMaxima: 5 })).toBe('idade-invertida');
    expect(validarRegraAlerta({ ...base, vigenciaFim: '2026-10-01' })).toBe('vigencia-invertida');
    expect(validarRegraAlerta({ ...base, repeticao: 'intervalo' })).toBe('intervalo-sem-minutos');
    expect(validarRegraAlerta({ ...base, destinatarios: 0 })).toBe('regra-sem-destinatario');
    expect(validarRegraAlerta({ ...base, destinatarios: 0, ativo: false })).toBeNull();
  });
  it('regra do produto só ativa ou desativa', () => {
    expect(conferirEdicaoRegra(false, true)).toBe('regra-do-produto');
    expect(conferirEdicaoRegra(false, false)).toBeNull();
    expect(conferirEdicaoRegra(true, true)).toBeNull();
  });
});

describe('consolidação dos avisos', () => {
  it('junta os avisos da mesma janela e deixa a janela aberta aguardando', () => {
    const r = consolidarAvisos(
      [aviso(1, 7, 0), aviso(2, 7, 5), aviso(3, 7, 14), aviso(4, 7, 20), aviso(5, 8, 1)],
      REGRA,
      min(30),
    );
    expect(r.envios.map((e) => [e.usuario, e.avisos])).toEqual([
      [7, [1, 2, 3]],
      [8, [5]],
    ]);
    expect(r.aguardando).toEqual([4]);
    expect(r.retidos).toEqual([]);
  });
  it('separa por campo de agrupamento', () => {
    const r = consolidarAvisos(
      [aviso(1, 7, 0, { paciente: 10 }), aviso(2, 7, 1, { paciente: 11 }), aviso(3, 7, 2, { paciente: 10 })],
      { ...REGRA, campos: ['regra', 'paciente'] },
      min(60),
    );
    expect(r.envios.map((e) => e.avisos)).toEqual([[1, 3], [2]]);
  });
  it('retém o que passa do limite por usuário no período', () => {
    const r = consolidarAvisos(
      [aviso(1, 7, 0, { regra: 1 }), aviso(2, 7, 0, { regra: 2 }), aviso(3, 7, 1, { regra: 3 })],
      { ...REGRA, limitePorUsuario: 2 },
      min(60),
      new Map([[7, 1]]),
    );
    expect(r.envios).toHaveLength(1);
    expect(r.retidos).toEqual([2, 3]);
  });
  it('janela pelo horário do resumo', () => {
    const regra = { ...REGRA, horarioResumo: '18:00' };
    expect(fimDaJanela(min(0), regra).getHours()).toBe(18);
    const depois = new Date('2026-11-24T19:00:00');
    expect(fimDaJanela(depois, regra).getDate()).toBe(25);
    expect(consolidarAvisos([aviso(1, 7, 0)], regra, min(60)).aguardando).toEqual([1]);
  });
});

describe('envio e resposta', () => {
  it('segue as transições e recusa as outras', () => {
    expect(transicaoEnvio('pendente', 'enviar', 0)).toEqual({ nova: 'enviado' });
    expect(transicaoEnvio('enviado', 'ler', 1)).toEqual({ nova: 'lido' });
    expect(transicaoEnvio('capturado', 'ler', 0)).toEqual({ nova: 'lido' });
    expect(transicaoEnvio('lido', 'falhar', 1)).toEqual({ recusa: 'transicao-invalida' });
    expect(transicaoEnvio('falhou', 'repetir', 1)).toEqual({ nova: 'pendente' });
    expect(transicaoEnvio('falhou', 'repetir', TENTATIVAS_MAXIMAS)).toEqual({
      recusa: 'tentativas-esgotadas',
    });
  });
  it('situação inicial: interno entregue, externo fora de produção capturado', () => {
    expect(situacaoInicialEnvio(false, false)).toBe('entregue');
    expect(situacaoInicialEnvio(true, false)).toBe('capturado');
    expect(situacaoInicialEnvio(true, true)).toBe('pendente');
  });
  it('mede a resposta por canal com as parcelas', () => {
    const e = (canal: string, situacao: 'lido' | 'falhou' | 'entregue', ate: number | null) => ({
      canal,
      situacao,
      quantidadeAvisos: 2,
      enviadoEm: T0,
      lidoEm: ate === null ? null : min(ate),
    });
    const [central, email] = medirRespostas([
      e('central', 'lido', 4),
      e('central', 'lido', 10),
      e('central', 'entregue', null),
      e('central', 'falhou', null),
      e('email', 'entregue', null),
    ]);
    expect(central).toEqual({
      canal: 'central',
      envios: 4,
      avisos: 8,
      lidos: 2,
      falhas: 1,
      aguardando: 1,
      taxaLeituraPercentual: 67,
      medianaMinutosAteLeitura: 7,
    });
    expect(email?.taxaLeituraPercentual).toBe(0);
    expect(email?.medianaMinutosAteLeitura).toBeNull();
  });
});
