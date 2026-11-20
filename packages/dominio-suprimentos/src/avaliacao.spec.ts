// Regras 7 e 8 (ficha do M29; DP-25): regras automáticas aprovam o baixo risco; a fila humana começa pelo alto risco e
// pelo antimicrobiano; achados (alergia, duplicidade, via, dose) mandam à fila; a decisão; 2, 3 e 4 no outro sistema só
// com a decisão registrada; intervenção e resposta.
import { describe, expect, it } from 'vitest';
import {
  achadosDoItem,
  conferirDecisaoAvaliacao,
  conferirGravacaoNoLegado,
  conferirRespostaIntervencao,
  type ItemParaAvaliar,
  ordenarFilaAvaliacao,
  SITUACAO_DA_DECISAO,
  taxaAceitacao,
  TIPOS_INTERVENCAO,
  triarItem,
} from '@sgh/contratos/regras-suprimentos';

const item = (o: Partial<ItemParaAvaliar> = {}): ItemParaAvaliar => ({
  classe: 'comum',
  alergiaConflitante: false,
  duplicado: false,
  via: 'VO',
  viasDoCadastro: ['VO', 'EV'],
  dose: 500,
  doseMinima: 250,
  doseMaxima: 1000,
  urgente: false,
  ...o,
});

describe('triagem (regra 7)', () => {
  it('baixo risco sem achado: regra automática (o 5 de hoje)', () => {
    const t = triarItem(item());
    expect(t).toEqual({ destino: 'automatica', prioridade: 0, achados: [], regra: 'baixo-risco-sem-achado' });
  });
  it('alto risco e antimicrobiano vão à fila humana; prioridade pela classe e pela urgência', () => {
    const a = triarItem(item({ classe: 'alto-risco' }));
    expect(a.destino).toBe('humana');
    expect(a.regra).toBe('classe:alto-risco');
    expect(a.prioridade).toBe(25);
    expect(triarItem(item({ classe: 'antimicrobiano', urgente: true })).prioridade).toBe(55);
    expect(triarItem(item({ classe: 'controlado' })).destino).toBe('automatica');
    expect(triarItem(item({ classe: 'controlado' }), ['controlado']).destino).toBe('humana');
    // O cadastro do item manda à lista de avaliação (tipo de envio do item).
    expect(triarItem(item({ enviarParaAvaliacao: true }))).toMatchObject({
      destino: 'humana',
      regra: 'cadastro:envio-avaliacao',
    });
  });
  it('achados mandam à fila humana mesmo fora das classes, com o peso de cada um', () => {
    const t = triarItem(item({ alergiaConflitante: true, duplicado: true, via: 'IM', dose: 2000 }));
    expect(t.destino).toBe('humana');
    expect(t.achados).toEqual(['alergia', 'duplicidade', 'via-incompativel', 'dose-acima']);
    expect(t.prioridade).toBe(120);
    expect(t.regra).toBe('achado:alergia,duplicidade,via-incompativel,dose-acima');
    expect(achadosDoItem(item({ dose: 100 }))).toEqual(['dose-abaixo']);
    expect(achadosDoItem(item({ dose: null }))).toEqual([]);
    expect(achadosDoItem(item({ viasDoCadastro: [], via: 'IM' }))).toEqual([]);
    expect(achadosDoItem(item({ via: null }))).toEqual([]);
    expect(achadosDoItem(item({ doseMaxima: null, doseMinima: null, dose: 9999 }))).toEqual([]);
    // O teto da prioridade.
    expect(
      triarItem(
        item({
          classe: 'alto-risco',
          urgente: true,
          alergiaConflitante: true,
          duplicado: true,
          via: 'IM',
          dose: 5000,
        }),
      ).prioridade,
    ).toBe(185);
  });
  it('ordena a fila: prioridade, depois o mais antigo, depois o ID', () => {
    const f = ordenarFilaAvaliacao([
      { id: 3, prioridade: 10, desde: '2026-10-23T08:00' },
      { id: 1, prioridade: 50, desde: '2026-10-23T09:00' },
      { id: 2, prioridade: 10, desde: '2026-10-23T07:00' },
      { id: 4, prioridade: 10, desde: '2026-10-23T07:00' },
    ]);
    expect(f.map((x) => x.id)).toEqual([1, 2, 4, 3]);
  });
});

describe('decisão e regra 8', () => {
  it('não aprovado e pendência exigem justificativa; item já decidido é recusado', () => {
    expect(conferirDecisaoAvaliacao({ decisao: 'valido', justificativa: '', estado: 'pendente' })).toBeNull();
    expect(
      conferirDecisaoAvaliacao({ decisao: 'valido', justificativa: '', estado: 'automatico' }),
    ).toBeNull();
    expect(
      conferirDecisaoAvaliacao({ decisao: 'nao-aprovado', justificativa: 'curta', estado: 'pendente' })
        ?.codigo,
    ).toBe('sem-justificativa');
    expect(
      conferirDecisaoAvaliacao({
        decisao: 'pendencia-revisao-medica',
        justificativa: 'rever a dose pelo clearance',
        estado: 'pendente',
      }),
    ).toBeNull();
    expect(
      conferirDecisaoAvaliacao({ decisao: 'valido', justificativa: '', estado: 'decidido' })?.codigo,
    ).toBe('ja-avaliado');
  });
  it('2, 3 e 4 no outro sistema só com a decisão registrada E a conferência (valor nunca visto)', () => {
    expect(SITUACAO_DA_DECISAO).toEqual({ valido: 2, 'nao-aprovado': 3, 'pendencia-revisao-medica': 4 });
    const r = conferirGravacaoNoLegado({
      decisao: 'nao-aprovado',
      decisaoRegistrada: false,
      conferidoNoOutroSistema: true,
    });
    expect(r?.codigo).toBe('valor-nunca-visto');
    expect(r?.mensagem).toMatch(/situação 3/);
    expect(
      conferirGravacaoNoLegado({ decisao: 'valido', decisaoRegistrada: true, conferidoNoOutroSistema: false })
        ?.codigo,
    ).toBe('valor-nunca-visto');
    expect(
      conferirGravacaoNoLegado({ decisao: 'valido', decisaoRegistrada: true, conferidoNoOutroSistema: true }),
    ).toBeNull();
  });
});

describe('intervenção', () => {
  const b = {
    estado: 'aberta' as const,
    resposta: 'aceita' as const,
    justificativa: '',
    respondente: 'MED.SINTETICO',
    autorIntervencao: 'FARM.SINTETICA',
  };
  it('o médico aceita; recusa exige justificativa; o autor não responde; respondida não muda', () => {
    expect(conferirRespostaIntervencao(b)).toBeNull();
    expect(conferirRespostaIntervencao({ ...b, resposta: 'recusada' })?.codigo).toBe('sem-justificativa');
    expect(
      conferirRespostaIntervencao({ ...b, resposta: 'recusada', justificativa: 'a dose segue o protocolo' }),
    ).toBeNull();
    expect(conferirRespostaIntervencao({ ...b, respondente: 'farm.sintetica' })?.codigo).toBe(
      'resposta-do-autor',
    );
    expect(conferirRespostaIntervencao({ ...b, estado: 'respondida' })?.codigo).toBe(
      'intervencao-respondida',
    );
    expect(TIPOS_INTERVENCAO.map((t) => t.id)).toContain('ajuste-dose');
  });
  it('taxa de aceitação (indicador "intervenções aceitas")', () => {
    expect(taxaAceitacao({ aceitas: 3, recusadas: 1 })).toBe(75);
    expect(taxaAceitacao({ aceitas: 0, recusadas: 0 })).toBeNull();
    expect(taxaAceitacao({ aceitas: 1, recusadas: 2 })).toBe(33.3);
  });
});
