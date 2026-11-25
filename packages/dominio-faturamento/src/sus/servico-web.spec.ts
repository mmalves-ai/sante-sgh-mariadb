// Regras da troca por serviço web com o SUS (08-INTG linha 131): conteúdo, repetição, envio, resposta e cancelamento.
// Números fictícios: CNS e CNES que passam no algoritmo, sem pessoa real.
import { describe, expect, it } from 'vitest';
import {
  conferirCancelamentoWebSus,
  conferirEnvioRepetidoWebSus,
  conferirEnvioWebSus,
  type DadosCadastroPrestador,
  type DadosRastreamentoCancer,
  efeitoDaRespostaWebSus,
  montarPedidoServicoWebSus,
  TETO_TENTATIVAS_WEB_SUS,
} from './servico-web.js';

const CNS = '199000177110002';
const rastreio: DadosRastreamentoCancer = {
  servico: 'rastreamento_cancer',
  cnes: '9039771',
  linha: 'colo_utero',
  cnsPaciente: CNS,
  exameSituacao: 'solicitado',
  exameCodigo: 'CITO',
  requisicaoNumero: 'R-1',
  sequencia: 1,
  solicitadoEm: '2026-11-20',
};
const prestador: DadosCadastroPrestador = {
  servico: 'cadastro_prestador',
  cnes: '9039771',
  profissionalAtivo: true,
  cnsProfissional: '299000177220009',
  cbo: '225125',
};

describe('conteúdo do envio ao serviço web do SUS', () => {
  it('rastreamento: só CNES, linha, cartão e o exame', () => {
    const p = montarPedidoServicoWebSus(rastreio);
    expect(p).toEqual({
      ok: true,
      cnsInformado: CNS,
      conteudo: {
        servico: 'rastreamento_cancer',
        cnes: '9039771',
        linha: 'colo_utero',
        cnsPaciente: CNS,
        exame: { codigo: 'CITO', requisicao: 'R-1', sequencia: 1, solicitadoEm: '2026-11-20' },
      },
    });
  });

  it('recusa sem CNES, sem cartão, com cartão inválido e com exame cancelado', () => {
    const codigo = (d: Parameters<typeof montarPedidoServicoWebSus>[0]) => {
      const p = montarPedidoServicoWebSus(d);
      return p.ok ? null : p.recusa.codigo;
    };
    expect(codigo({ ...rastreio, cnes: '0000000' })).toBe('cnes-invalido');
    expect(codigo({ ...rastreio, cnes: null })).toBe('cnes-invalido');
    expect(codigo({ ...rastreio, cnsPaciente: null })).toBe('cns-ausente');
    expect(codigo({ ...rastreio, cnsPaciente: '199000177110003' })).toBe('cns-invalido');
    expect(codigo({ ...rastreio, exameSituacao: 'cancelado' })).toBe('exame-cancelado');
    expect(codigo({ ...prestador, profissionalAtivo: false })).toBe('profissional-inativo');
    expect(codigo({ ...prestador, cnsProfissional: null })).toBe('cns-invalido');
  });

  it('cadastro de prestador: CBO inválido vai nulo (o serviço critica)', () => {
    const p = montarPedidoServicoWebSus({ ...prestador, cbo: '12' });
    expect(p.ok && p.conteudo['cbo']).toBeNull();
    const q = montarPedidoServicoWebSus(prestador);
    expect(q.ok && q.conteudo).toEqual({
      servico: 'cadastro_prestador',
      cnes: '9039771',
      cnsProfissional: '299000177220009',
      cbo: '225125',
    });
  });
});

describe('repetição, envio e cancelamento', () => {
  it('o vivo segura o novo; no rastreamento, o aceito também', () => {
    expect(conferirEnvioRepetidoWebSus('rastreamento_cancer', [{ id: 3, situacao: 'aceito' }])?.codigo).toBe(
      'envio-repetido',
    );
    expect(conferirEnvioRepetidoWebSus('cadastro_prestador', [{ id: 3, situacao: 'aceito' }])).toBeNull();
    expect(
      conferirEnvioRepetidoWebSus('cadastro_prestador', [
        { id: 3, situacao: 'rejeitado' },
        { id: 4, situacao: 'cancelado' },
      ]),
    ).toBeNull();
    expect(conferirEnvioRepetidoWebSus('cadastro_prestador', [{ id: 5, situacao: 'erro' }])?.codigo).toBe(
      'envio-repetido',
    );
  });

  it('vai o pendente e o com erro, até o teto de tentativas', () => {
    expect(conferirEnvioWebSus('pendente', 0)).toBeNull();
    expect(conferirEnvioWebSus('erro', 2)).toBeNull();
    expect(conferirEnvioWebSus('aceito', 1)?.codigo).toBe('envio-nao-pendente');
    expect(conferirEnvioWebSus('erro', TETO_TENTATIVAS_WEB_SUS)?.codigo).toBe('tentativas-esgotadas');
  });

  it('cancela só o que não foi aceito, com motivo', () => {
    expect(conferirCancelamentoWebSus('rejeitado', 'dado corrigido')).toBeNull();
    expect(conferirCancelamentoWebSus('aceito', 'dado corrigido')?.codigo).toBe('cancelamento-invalido');
    expect(conferirCancelamentoWebSus('enviado', 'dado corrigido')?.codigo).toBe('cancelamento-invalido');
    expect(conferirCancelamentoWebSus('pendente', ' ab ')?.codigo).toBe('motivo-obrigatorio');
  });
});

describe('efeito da resposta', () => {
  const chegou = (x: Partial<Extract<Parameters<typeof efeitoDaRespostaWebSus>[0], { chegou: true }>>) =>
    efeitoDaRespostaWebSus({
      chegou: true,
      protocolo: 'P1',
      tipoProtocolo: 'recibo',
      cnsConfirmado: CNS,
      criticas: [],
      ...x,
    });

  it('sem crítica: aceito com o protocolo e um retorno de sucesso', () => {
    const e = chegou({});
    expect(e.situacao).toBe('aceito');
    expect(e.protocolo).toBe('P1');
    expect(e.cnsConfirmado).toBe(CNS);
    expect(e.retornos).toEqual([
      { tipo: 'sucesso', codigo: null, campo: null, mensagem: 'Aceito com o protocolo P1.' },
    ]);
  });

  it('só aviso: aceito com crítica; erro: rejeitado', () => {
    const aviso = { tipo: 'aviso' as const, codigo: 'cns-provisorio', campo: 'cnsPaciente', mensagem: 'x' };
    expect(chegou({ criticas: [aviso] }).situacao).toBe('aceito_com_critica');
    const e = chegou({ criticas: [aviso, { ...aviso, tipo: 'erro', codigo: 'cbo-ausente' }] });
    expect(e.situacao).toBe('rejeitado');
    expect(e.retornos.map((r) => r.tipo)).toEqual(['aviso', 'erro']);
  });

  it('aceite sem protocolo e falha de transporte ficam erro', () => {
    expect(chegou({ protocolo: ' ' }).situacao).toBe('erro');
    const t = efeitoDaRespostaWebSus({ chegou: false, mensagem: 'tempo esgotado' });
    expect(t).toMatchObject({ situacao: 'erro', protocolo: null });
    expect(t.retornos).toEqual([
      { tipo: 'erro', codigo: 'transporte', campo: null, mensagem: 'tempo esgotado' },
    ]);
  });
});
