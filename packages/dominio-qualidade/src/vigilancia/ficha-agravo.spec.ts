// Ficha SINAN pré-preenchida e o ciclo do caso de agravo. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  MENSAGENS_RECUSA_AGRAVO,
  recusaAbertura,
  recusaDescarte,
  recusaNotificacao,
} from './casos-agravo.js';
import { type ContextoFichaAgravo, idadeEmAnos, modeloDaFicha, preencherFicha } from './ficha-agravo.js';

// Nomes como no cadastro de modelos (perfil da cópia pc).
const modelos = [
  'A90/A92',
  'A923',
  'B19',
  'B24',
  'B24/Menor',
  'A169',
  'G039',
  'A509',
  'A719/Tracoma',
  'Padrão/Individual',
  'Epizootia',
  'Surto',
].map((nome, i) => ({ id: i + 1, nome }));
const nome = (cid: string, idade: number | null = 40) =>
  modeloDaFicha(cid, modelos, idade).modelo?.nome ?? null;

describe('modelo da ficha pelo CID', () => {
  it('prefixo mais longo vence; categoria casa com o token mais longo dela', () => {
    expect(nome('A90')).toBe('A90/A92');
    expect(nome('A920')).toBe('A90/A92');
    expect(nome('A923')).toBe('A923');
    expect(nome('A92')).toBe('A90/A92');
    expect(nome('A71')).toBe('A719/Tracoma');
  });
  it('grupos do Sinan: hepatites, tuberculose, HIV, meningites, sífilis congênita', () => {
    expect(nome('B169')).toBe('B19');
    expect(nome('B171')).toBe('B19');
    expect(nome('A150')).toBe('A169');
    expect(nome('B20')).toBe('B24');
    expect(nome('G009')).toBe('G039');
    expect(nome('A39')).toBe('G039');
    expect(nome('A501')).toBe('A509');
  });
  it('aids em menor de 13 anos; sem idade, a ficha geral', () => {
    expect(nome('B24', 12)).toBe('B24/Menor');
    expect(nome('B24', 13)).toBe('B24');
    expect(nome('B24', null)).toBe('B24');
  });
  it('sem modelo próprio, a individual genérica; sem genérica, nenhum', () => {
    expect(modeloDaFicha('A539', modelos, 30)).toEqual({
      modelo: { id: 10, nome: 'Padrão/Individual' },
      generica: true,
    });
    expect(modeloDaFicha('A539', modelos.slice(0, 3), 30)).toEqual({ modelo: null, generica: false });
    // Epizootia e surto nunca são o modelo do caso individual.
    expect(nome('A999')).toBe('Padrão/Individual');
  });
});

describe('preenchimento da ficha', () => {
  const contexto: ContextoFichaAgravo = {
    dataNotificacao: '2026-10-27',
    cid: 'A90',
    nomeCid: 'DENGUE',
    unidadeNotificadora: 'UNIDADE SINTETICA',
    uf: 'RJ',
    municipio: 'CAMPOS DOS GOYTACAZES',
    paciente: {
      nome: 'PACIENTE SINTETICO',
      nascimento: '1990-05-01',
      sexo: 'F',
      idadeAnos: 36,
      nomeMae: null,
      cns: '700000000000000',
    },
    dataPrimeirosSintomas: null,
  };
  const perguntas = [
    [8, 0, 'Nome do paciente'],
    [3, 0, 'Data da notificação'],
    [1, 1, 'Número'],
    [2, 1, 'Agravo/doença'],
    [2, 2, 'Código (CID10)'],
    [4, 0, 'U.F.'],
    [5, 1, 'Município de notificação'],
    [6, 1, 'Unidade de saúde(ou outra fonte notificadora)'],
    [7, 0, 'Data dos primeiros sintomas'],
    [9, 0, 'Data de nascimento'],
    [10, 1, 'Idade'],
    [10, 2, 'Idade unidade'],
    [11, 0, 'Sexo'],
    [14, 0, 'Número do cartão SUS'],
    [15, 0, 'Nome da mãe'],
  ].map(([codigo, subcodigo, texto]) => ({
    codigo: codigo as number,
    subcodigo: subcodigo as number,
    texto: texto as string,
  }));

  it('em ordem de pergunta, com o que o Sante sabe; o resto em branco', () => {
    const f = preencherFicha(perguntas, contexto);
    expect(f.perguntas.map((p) => `${String(p.codigo)}.${String(p.subcodigo)}=${p.valor ?? ''}`)).toEqual([
      '1.1=',
      '2.1=DENGUE',
      '2.2=A90',
      '3.0=27/10/2026',
      '4.0=RJ',
      '5.1=CAMPOS DOS GOYTACAZES',
      '6.1=UNIDADE SINTETICA',
      '7.0=',
      '8.0=PACIENTE SINTETICO',
      '9.0=01/05/1990',
      '10.1=36',
      '10.2=4 - Ano',
      '11.0=F - Feminino',
      '14.0=700000000000000',
      '15.0=',
    ]);
    expect(f.preenchidas).toBe(12);
  });
  it('sexo masculino e ignorado; sem idade, idade e unidade em branco', () => {
    const m = preencherFicha(perguntas, { ...contexto, paciente: { ...contexto.paciente, sexo: 'M' } });
    expect(m.perguntas.find((p) => p.texto === 'Sexo')?.valor).toBe('M - Masculino');
    const i = preencherFicha(perguntas, {
      ...contexto,
      paciente: { ...contexto.paciente, sexo: null, idadeAnos: null, nascimento: null },
    });
    expect(i.perguntas.find((p) => p.texto === 'Sexo')?.valor).toBe('I - Ignorado');
    expect(i.perguntas.find((p) => p.texto === 'Idade')?.valor).toBeNull();
    expect(i.perguntas.find((p) => p.texto === 'Idade unidade')?.valor).toBeNull();
    expect(i.perguntas.find((p) => p.texto === 'Data de nascimento')?.valor).toBeNull();
  });
  it('idade em anos completos', () => {
    expect(idadeEmAnos('1990-05-01', '2026-04-30')).toBe(35);
    expect(idadeEmAnos('1990-05-01', '2026-05-01')).toBe(36);
    expect(idadeEmAnos('2027-01-01', '2026-05-01')).toBeNull();
    expect(idadeEmAnos(null, '2026-05-01')).toBeNull();
    expect(idadeEmAnos('01/05/1990', '2026-05-01')).toBeNull();
  });
});

describe('ciclo do caso', () => {
  const agora = '2026-10-27T12:00';
  it('abertura: futuro (com 5 min de tolerância), antigo (90 dias) e CID fora da lista', () => {
    expect(recusaAbertura({ origem: 'cid', gatilhoEm: '2026-10-27T12:04' }, true, agora)).toBeNull();
    expect(recusaAbertura({ origem: 'cid', gatilhoEm: '2026-10-27T12:06' }, true, agora)).toBe(
      'gatilho-futuro',
    );
    expect(recusaAbertura({ origem: 'cid', gatilhoEm: '2026-07-29T12:00' }, true, agora)).toBeNull();
    expect(recusaAbertura({ origem: 'cid', gatilhoEm: '2026-07-29T11:59' }, true, agora)).toBe(
      'gatilho-antigo',
    );
    expect(recusaAbertura({ origem: 'obito', gatilhoEm: '2026-10-27T10:00' }, false, agora)).toBe(
      'cid-nao-notificavel',
    );
    expect(recusaAbertura({ origem: 'exame', gatilhoEm: '2026-10-27T10:00' }, false, agora)).toBeNull();
    expect(recusaAbertura({ origem: 'manual', gatilhoEm: '2026-10-27T10:00' }, false, agora)).toBeNull();
  });
  const caso = { versao: 2, situacao: 'aberto' as const, gatilhoEm: '2026-10-26T10:00:00' };
  it('notificação: versão, situação, antes do gatilho e futuro', () => {
    expect(recusaNotificacao(caso, { versao: 2, notificadoEm: '2026-10-27T11:00' }, agora)).toBeNull();
    expect(recusaNotificacao(caso, { versao: 1, notificadoEm: '2026-10-27T11:00' }, agora)).toBe(
      'versao-desatualizada',
    );
    expect(
      recusaNotificacao(
        { ...caso, situacao: 'notificado' },
        { versao: 2, notificadoEm: '2026-10-27T11:00' },
        agora,
      ),
    ).toBe('caso-encerrado');
    expect(recusaNotificacao(caso, { versao: 2, notificadoEm: '2026-10-26T09:59' }, agora)).toBe(
      'notificacao-antes-do-gatilho',
    );
    expect(recusaNotificacao(caso, { versao: 2, notificadoEm: '2026-10-27T12:30' }, agora)).toBe(
      'notificacao-futura',
    );
  });
  it('descarte: versão e situação; toda recusa tem mensagem', () => {
    expect(recusaDescarte(caso, { versao: 2 })).toBeNull();
    expect(recusaDescarte(caso, { versao: 3 })).toBe('versao-desatualizada');
    expect(recusaDescarte({ ...caso, situacao: 'descartado' }, { versao: 2 })).toBe('caso-encerrado');
    for (const m of Object.values(MENSAGENS_RECUSA_AGRAVO)) expect(m.length).toBeGreaterThan(10);
  });
});
