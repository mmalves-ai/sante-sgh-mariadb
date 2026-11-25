// Regras puras do pós-fechamento no vocabulário do modelo (regras-tiss.ts): conta para o lote, tipo de guia pela
// natureza, situações do protocolo, grupo e tabela TISS do item, estado da glosa e desfecho do recurso.
import { describe, expect, it } from 'vitest';
import {
  caraterTiss,
  codigosDaInternacao,
  indicadorAcidenteGuia,
  conferirGuiaComConta,
  executanteDaGuia,
  reusoDoProtocolo,
  situacaoDaGlosa,
  tipoConsultaTiss,
  tipoFaturamentoTiss,
  unitarioDaGuia,
  conferirContaParaLoteModelo,
  desfechoDoRecurso,
  diaDaCompetencia,
  diasEntre,
  estadoDaGlosa,
  grupoTissDoItem,
  naturezaDoItem,
  numeroDaSituacaoProtocolo,
  situacaoContaNaCompetencia,
  situacaoProtocoloDoNumero,
  tabelaTissDoItem,
  tipoGuiaDoModelo,
  TIPO_GUIA_NO_MODELO,
} from './regras-tiss.js';

const conta = {
  id: 7,
  convenio: 3,
  natureza: 'ambulatorial',
  situacao: 'fechada',
  emLote: false,
  competenciaFechada: false,
};

describe('conta para o lote (modelo)', () => {
  it('a conta fechada, do convênio e com guia compatível entra', () => {
    expect(conferirContaParaLoteModelo(conta, { convenio: 3, tipoGuia: 2 })).toBeNull();
  });
  it('recusas: outro convênio, aberta, em lote, cancelada, tipo de guia e competência fechada', () => {
    const c = (x: Partial<typeof conta>, tipoGuia = 2) =>
      conferirContaParaLoteModelo({ ...conta, ...x }, { convenio: 3, tipoGuia })?.codigo;
    expect(c({ convenio: 4 })).toBe('outro-convenio');
    expect(c({ situacao: 'aberta' })).toBe('conta-aberta');
    expect(c({ situacao: 'faturada' })).toBe('conta-em-lote');
    expect(c({ emLote: true })).toBe('conta-em-lote');
    expect(c({ situacao: 'cancelada' })).toBe('conta-cancelada');
    expect(c({}, 3)).toBe('tipo-guia-incompativel');
    expect(c({ natureza: 'internacao' }, 3)).toBeUndefined();
    expect(c({ natureza: 'internacao' }, 2)).toBe('tipo-guia-incompativel');
    expect(c({ competenciaFechada: true })).toBe('competencia-fechada');
  });
});

describe('vocabulário do modelo', () => {
  it('tipo de guia ida e volta; recurso de glosa é 8', () => {
    for (const [k, v] of Object.entries(TIPO_GUIA_NO_MODELO)) expect(tipoGuiaDoModelo(v)).toBe(Number(k));
    expect(tipoGuiaDoModelo('recurso_glosa')).toBe(8);
    expect(tipoGuiaDoModelo('odontologia')).toBe(0);
  });
  it('situações do protocolo ida e volta; número fora da lista é nulo', () => {
    expect(situacaoProtocoloDoNumero(1)).toBe('recebido');
    expect(numeroDaSituacaoProtocolo('recusado')).toBe(7);
    expect(situacaoProtocoloDoNumero(9)).toBeNull();
    expect(situacaoProtocoloDoNumero(null)).toBeNull();
  });
  it('grupo, natureza e tabela TISS do item', () => {
    expect([grupoTissDoItem('taxa'), grupoTissDoItem('honorario'), grupoTissDoItem('procedimento')]).toEqual([
      1, 2, 3,
    ]);
    expect(grupoTissDoItem('opme')).toBe(4);
    expect(naturezaDoItem('servico')).toBe('procedimento');
    expect(naturezaDoItem('pacote')).toBe('taxa');
    expect([
      tabelaTissDoItem('diaria'),
      tabelaTissDoItem('material'),
      tabelaTissDoItem('medicamento'),
    ]).toEqual(['18', '19', '20']);
    expect(tabelaTissDoItem('procedimento')).toBe('22');
  });
  it('situação da conta na leitura da competência', () => {
    expect(['aberta', 'fechada', 'enviada', 'cancelada'].map(situacaoContaNaCompetencia)).toEqual([
      'N',
      'S',
      'A',
      'outra',
    ]);
  });
  it('datas: competência e dias entre', () => {
    expect(diaDaCompetencia(2026, 3)).toBe('2026-03-01');
    expect(diasEntre('2026-02-27', '2026-03-02')).toBe(3);
  });
});

describe('glosa do item', () => {
  const base = { conciliado: true, glosado: 10, decisao: null, emRecurso: false, retornado: false };
  it('estado pela análise, decisão e recurso', () => {
    expect(estadoDaGlosa({ ...base, conciliado: false })).toBe('nao-conciliado');
    expect(estadoDaGlosa({ ...base, glosado: 0 })).toBe('sem-glosa');
    expect(estadoDaGlosa(base)).toBe('pendente');
    expect(estadoDaGlosa({ ...base, decisao: 'aceitar' })).toBe('aceita');
    expect(estadoDaGlosa({ ...base, decisao: 'recorrer' })).toBe('recorrida');
    expect(estadoDaGlosa({ ...base, emRecurso: true, retornado: true })).toBe('encerrada');
  });
  it('desfecho do recurso pelo recuperado', () => {
    expect(desfechoDoRecurso({ recursado: 10, recuperado: 0, retornado: false })).toBeNull();
    expect(desfechoDoRecurso({ recursado: 10, recuperado: 10, retornado: true })).toBe('acatado');
    expect(desfechoDoRecurso({ recursado: 10, recuperado: 4, retornado: true })).toBe('parcial');
    expect(desfechoDoRecurso({ recursado: 10, recuperado: 0, retornado: true })).toBe('negado');
  });
});

describe('montagem da guia: só o que está no cadastro', () => {
  it('executante: conselho, número, UF, CBO e nome; sem um deles, null (nunca um padrão)', () => {
    const ok = { conselho: '06', numero: ' 52 01234 ', uf: '33', cbo: '225125', nome: ' MEDICO SINTETICO ' };
    expect(executanteDaGuia(ok)).toEqual({
      profissional: { conselho: '06', numeroConselho: '5201234', uf: '33', cbos: '225125' },
      nome: 'MEDICO SINTETICO',
      codigo: '',
    });
    expect(executanteDaGuia({ ...ok, numero: '0' })).toBeNull();
    expect(executanteDaGuia({ ...ok, uf: null })).toBeNull();
    expect(executanteDaGuia({ ...ok, cbo: '000000' })).toBeNull();
    expect(executanteDaGuia({ ...ok, conselho: 'CRM' })).toBeNull();
    expect(executanteDaGuia({ ...ok, nome: '' })).toBeNull();
  });
  it('caráter, faturamento e consulta pelos códigos do cadastro', () => {
    expect(caraterTiss('2')).toBe('2');
    expect(caraterTiss('L9')).toBeNull();
    expect(tipoFaturamentoTiss('total')).toBe('4');
    expect(tipoFaturamentoTiss('complementar')).toBe('3');
    expect(tipoFaturamentoTiss('outro')).toBeNull();
    expect(tipoConsultaTiss(null, true)).toBe('2');
    expect(tipoConsultaTiss('4', false)).toBe('4');
    expect(tipoConsultaTiss('', false)).toBe('1');
  });
  it('internação: tipo, regime e motivo de saída obrigatórios', () => {
    expect(codigosDaInternacao({ tipo: '02', regime: '1', motivo: '12' })).toEqual({
      ok: true,
      tipoInternacao: '2',
      regimeInternacao: '1',
      motivoEncerramento: '12',
    });
    const r = codigosDaInternacao({ tipo: null, regime: '9', motivo: '' });
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.faltas).toHaveLength(3);
  });
  it('indicador de acidente: o da guia montada, senão o do atendimento, senão 9', () => {
    expect(indicadorAcidenteGuia('1', '0')).toBe('1');
    expect(indicadorAcidenteGuia(null, '0')).toBe('0');
    expect(indicadorAcidenteGuia('', ' 2 ')).toBe('2');
    expect(indicadorAcidenteGuia('7', null)).toBe('9');
    expect(indicadorAcidenteGuia(undefined, undefined)).toBe('9');
  });
  it('guia confere com a conta: itens e total; divergência recusa', () => {
    expect(unitarioDaGuia(3, 100, 300)).toBe(100);
    expect(unitarioDaGuia(3, 100, 270)).toBe(90);
    const itens = [{ quantidade: 3, valorUnitario: 100 }];
    expect(conferirGuiaComConta({ conta: 'C1', itens, esperados: 1, totalConta: 300 })).toBeNull();
    expect(conferirGuiaComConta({ conta: 'C1', itens, esperados: 1, totalConta: 310 })?.codigo).toBe(
      'guia-divergente',
    );
    expect(conferirGuiaComConta({ conta: 'C1', itens, esperados: 2, totalConta: 300 })?.codigo).toBe(
      'guia-divergente',
    );
    expect(conferirGuiaComConta({ conta: 'C1', itens: [], esperados: 0, totalConta: 0 })?.codigo).toBe(
      'guia-sem-itens',
    );
  });
});

describe('protocolo e glosa', () => {
  it('protocolo: o cancelado do mesmo lote é reativado; o de outro lote ou vivo recusa', () => {
    expect(reusoDoProtocolo(null, 1, 'P')).toBe('incluir');
    expect(reusoDoProtocolo({ lote: 1, situacao: 'cancelado', excluido: false }, 1, 'P')).toBe('reativar');
    expect(reusoDoProtocolo({ lote: 2, situacao: 'cancelado', excluido: false }, 1, 'P')).toMatchObject({
      codigo: 'protocolo-em-uso',
    });
    expect(reusoDoProtocolo({ lote: 1, situacao: 'recebido', excluido: false }, 1, 'P')).toMatchObject({
      codigo: 'protocolo-em-uso',
    });
  });
  it('glosa: situação e valor aceito pelas decisões dos itens', () => {
    expect(situacaoDaGlosa('em_analise', [{ decisao: 'aceitar', valorAceito: 100 }])).toEqual({
      situacao: 'aceita_total',
      valorAceito: 100,
    });
    expect(
      situacaoDaGlosa('em_analise', [
        { decisao: 'aceitar', valorAceito: 40 },
        { decisao: 'recorrer', valorAceito: 0 },
      ]),
    ).toEqual({ situacao: 'aceita_parcial', valorAceito: 40 });
    expect(
      situacaoDaGlosa('em_analise', [
        { decisao: 'aceitar', valorAceito: 40 },
        { decisao: 'pendente', valorAceito: 0 },
      ]).situacao,
    ).toBe('em_analise');
    expect(situacaoDaGlosa('em_recurso', [{ decisao: 'aceitar', valorAceito: 10 }])).toEqual({
      situacao: 'em_recurso',
      valorAceito: 10,
    });
  });
});
