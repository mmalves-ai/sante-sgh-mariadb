import { describe, expect, it } from 'vitest';
import {
  acompanhamentoEmDestaque,
  conferirAcompanhamento,
  conferirAntibioticoDoador,
  conferirDestino,
  conferirDoadorOrgao,
  conferirPreservacao,
  conferirReceptor,
  conferirTransicaoDestino,
  conferirTransicaoDoador,
  conferirTransicaoReceptor,
  type DadosDoadorOrgao,
  destinoOcupaOrgao,
  diasDoTransplante,
  pendenciasDoador,
} from './transplante.js';

const AGORA = new Date('2026-11-25T12:00:00Z');
const base: DadosDoadorOrgao = {
  tipo: 'falecido',
  situacao: 'em_avaliacao',
  consentimento: 'pendente',
  consentimentoEm: null,
  responsavelConsentimento: null,
  parentescoId: null,
  morteEncefalicaEm: null,
  captacaoEm: null,
  procedimentoInicioEm: null,
  procedimentoFimEm: null,
  clampeamentoEm: null,
  saturacao: null,
  pesoKg: null,
  alturaCm: null,
  teveParadaCardiaca: false,
  paradaDescricao: null,
};
const codigos = (x: readonly { codigo: string }[]) => x.map((y) => y.codigo);

describe('doador de órgãos', () => {
  it('doador falecido em avaliação sem nada além do básico é aceito', () => {
    expect(conferirDoadorOrgao(base, AGORA)).toEqual([]);
  });

  it('falecido exige a família: sem "não se aplica", com quem respondeu e a data da resposta', () => {
    expect(codigos(conferirDoadorOrgao({ ...base, consentimento: 'nao_se_aplica' }, AGORA))).toEqual([
      'consentimento-familia-obrigatorio',
    ]);
    expect(codigos(conferirDoadorOrgao({ ...base, consentimento: 'autorizado' }, AGORA))).toEqual([
      'responsavel-consentimento',
      'consentimento-sem-data',
    ]);
  });

  it('captação de falecido exige autorização, morte encefálica antes e a data da captação', () => {
    expect(codigos(conferirDoadorOrgao({ ...base, situacao: 'captado' }, AGORA))).toEqual([
      'captacao-sem-data',
      'captacao-sem-consentimento',
      'captacao-sem-morte-encefalica',
    ]);
    const ok: DadosDoadorOrgao = {
      ...base,
      situacao: 'captado',
      consentimento: 'autorizado',
      consentimentoEm: new Date('2026-11-24T10:00:00Z'),
      responsavelConsentimento: 'Familiar sintético',
      parentescoId: 1,
      morteEncefalicaEm: new Date('2026-11-24T08:00:00Z'),
      captacaoEm: new Date('2026-11-24T14:00:00Z'),
      procedimentoInicioEm: new Date('2026-11-24T13:00:00Z'),
      procedimentoFimEm: new Date('2026-11-24T17:00:00Z'),
      clampeamentoEm: new Date('2026-11-24T14:30:00Z'),
    };
    expect(conferirDoadorOrgao(ok, AGORA)).toEqual([]);
    expect(
      codigos(conferirDoadorOrgao({ ...ok, captacaoEm: new Date('2026-11-24T07:00:00Z') }, AGORA)),
    ).toEqual(['captacao-antes-morte-encefalica']);
    expect(
      codigos(conferirDoadorOrgao({ ...ok, clampeamentoEm: new Date('2026-11-24T18:00:00Z') }, AGORA)),
    ).toEqual(['clampeamento-fora-do-procedimento']);
    expect(
      codigos(conferirDoadorOrgao({ ...ok, procedimentoFimEm: new Date('2026-11-24T12:00:00Z') }, AGORA)),
    ).toContain('procedimento-periodo');
  });

  it('doador vivo: autorização própria, sem morte encefálica', () => {
    expect(conferirDoadorOrgao({ ...base, tipo: 'vivo', consentimento: 'nao_se_aplica' }, AGORA)).toEqual([]);
    expect(
      codigos(
        conferirDoadorOrgao(
          { ...base, tipo: 'vivo', consentimento: 'recusado', morteEncefalicaEm: AGORA },
          AGORA,
        ),
      ),
    ).toEqual(['consentimento-doador-vivo', 'morte-encefalica-doador-vivo', 'consentimento-sem-data']);
  });

  it('sinais vitais, parada sem descrição e datas futuras', () => {
    expect(
      codigos(
        conferirDoadorOrgao(
          {
            ...base,
            saturacao: 101,
            pesoKg: 0,
            alturaCm: 300,
            teveParadaCardiaca: true,
            morteEncefalicaEm: new Date('2026-11-26T00:00:00Z'),
          },
          AGORA,
        ),
      ),
    ).toEqual([
      'saturacao-invalida',
      'peso-invalido',
      'altura-invalida',
      'parada-sem-descricao',
      'data-futura',
    ]);
  });

  it('a situação segue os passos e encerra em captado, não captado ou cancelado', () => {
    expect(conferirTransicaoDoador('em_avaliacao', 'apto')).toBeNull();
    expect(conferirTransicaoDoador('apto', 'captado')).toBeNull();
    expect(conferirTransicaoDoador('inapto', 'apto')).toBeNull();
    expect(conferirTransicaoDoador('em_avaliacao', 'captado')?.codigo).toBe('transicao-doador');
    expect(conferirTransicaoDoador('captado', 'apto')?.codigo).toBe('transicao-doador');
    expect(conferirTransicaoDoador('cancelado', 'cancelado')).toBeNull();
  });

  it('pendências: notificar a central e a entrevista familiar', () => {
    expect(
      codigos(
        pendenciasDoador({
          tipo: 'falecido',
          situacao: 'apto',
          consentimento: 'pendente',
          morteEncefalicaEm: AGORA,
          registroCentral: null,
        }),
      ),
    ).toEqual(['notificar-central', 'entrevista-familiar']);
    expect(
      pendenciasDoador({
        tipo: 'falecido',
        situacao: 'captado',
        consentimento: 'autorizado',
        morteEncefalicaEm: AGORA,
        registroCentral: null,
      }),
    ).toEqual([]);
  });
});

describe('antibiótico e preservação', () => {
  it('antibiótico com período e sem futuro', () => {
    expect(
      conferirAntibioticoDoador({ descricao: 'Cefazolina', inicio: '2026-11-20', fim: null }, '2026-11-25'),
    ).toEqual([]);
    expect(
      codigos(
        conferirAntibioticoDoador({ descricao: ' ', inicio: '2026-11-26', fim: '2026-11-21' }, '2026-11-25'),
      ),
    ).toEqual(['antibiotico-sem-descricao', 'antibiotico-futuro', 'antibiotico-periodo']);
  });

  it('preservação: doador apto ou captado, solução no prazo, depois do início do procedimento', () => {
    const p = {
      situacaoDoador: 'captado' as const,
      aplicadaEm: new Date('2026-11-24T15:00:00Z'),
      validade: '2027-01-01',
      volumeMl: 1000,
      procedimentoInicioEm: new Date('2026-11-24T13:00:00Z'),
      nomeSolucao: 'Solução sintética',
    };
    expect(conferirPreservacao(p, AGORA)).toEqual([]);
    expect(
      codigos(
        conferirPreservacao(
          {
            ...p,
            situacaoDoador: 'em_avaliacao',
            validade: '2026-11-01',
            volumeMl: 0,
            aplicadaEm: new Date('2026-11-24T12:00:00Z'),
          },
          AGORA,
        ),
      ),
    ).toEqual([
      'doador-sem-captacao',
      'volume-invalido',
      'preservacao-antes-procedimento',
      'solucao-vencida',
    ]);
  });
});

describe('receptor e destino do órgão', () => {
  it('inscrição sem futuro e inaptidão com motivo', () => {
    expect(
      conferirReceptor({ cadastradoEm: '2026-11-01', apto: true, motivoAptidao: null }, '2026-11-25'),
    ).toEqual([]);
    expect(
      codigos(conferirReceptor({ cadastradoEm: '2026-12-01', apto: false, motivoAptidao: '' }, '2026-11-25')),
    ).toEqual(['cadastro-futuro', 'motivo-inaptidao']);
  });

  it('situação do receptor: troca na lista, sai da lista, transplante só pelo destino', () => {
    expect(conferirTransicaoReceptor('ativo', 'suspenso')).toBeNull();
    expect(conferirTransicaoReceptor('suspenso', 'removido')).toBeNull();
    expect(conferirTransicaoReceptor('ativo', 'transplantado')?.codigo).toBe('transplante-pelo-destino');
    expect(conferirTransicaoReceptor('ativo', 'transplantado', true)).toBeNull();
    expect(conferirTransicaoReceptor('obito', 'ativo')?.codigo).toBe('receptor-fora-da-lista');
  });

  it('destino: pessoas diferentes, mesmo órgão, doador apto, receptor na lista, parente só vivo', () => {
    const d = {
      pacienteDoador: 1,
      pacienteReceptor: 2,
      orgao: 7,
      orgaoDoReceptor: 7,
      situacaoDoador: 'apto' as const,
      tipoDoador: 'vivo' as const,
      situacaoReceptor: 'ativo' as const,
      doadorVivoParente: true,
      parentescoId: 3,
    };
    expect(conferirDestino(d)).toEqual([]);
    expect(
      codigos(
        conferirDestino({
          ...d,
          pacienteReceptor: 1,
          orgaoDoReceptor: 8,
          situacaoDoador: 'em_avaliacao',
          tipoDoador: 'falecido',
          situacaoReceptor: 'obito',
          parentescoId: null,
        }),
      ),
    ).toEqual([
      'doador-e-receptor',
      'orgao-diferente-da-inscricao',
      'doador-nao-apto',
      'receptor-fora-da-lista',
      'parente-so-doador-vivo',
      'parentesco-obrigatorio',
    ]);
  });

  it('transição do destino: transplante só do aceito, com o doador captado e o receptor na lista', () => {
    const ok = {
      situacaoDoador: 'captado' as const,
      situacaoReceptor: 'ativo' as const,
      outrosDestinosOcupados: 0,
      quantidadePorDoador: 1,
    };
    expect(conferirTransicaoDestino('aceito', 'transplantado', ok)).toEqual([]);
    expect(codigos(conferirTransicaoDestino('ofertado', 'transplantado', ok))).toEqual(['transicao-destino']);
    expect(
      codigos(
        conferirTransicaoDestino('aceito', 'transplantado', {
          ...ok,
          situacaoDoador: 'apto',
          situacaoReceptor: 'removido',
        }),
      ),
    ).toEqual(['transplante-sem-captacao', 'receptor-fora-da-lista']);
    expect(codigos(conferirTransicaoDestino('recusado', 'aceito', ok))).toEqual(['transicao-destino']);
  });

  it('o mesmo órgão do doador não é aceito nem transplantado em mais receptores que a quantidade do catálogo', () => {
    const ctx = (outros: number, quantidade: number) => ({
      situacaoDoador: 'captado' as const,
      situacaoReceptor: 'ativo' as const,
      outrosDestinosOcupados: outros,
      quantidadePorDoador: quantidade,
    });
    // Órgão único (coração, fígado): um só destino ocupa o órgão.
    expect(codigos(conferirTransicaoDestino('ofertado', 'aceito', ctx(1, 1)))).toEqual([
      'orgao-ja-destinado',
    ]);
    expect(codigos(conferirTransicaoDestino('aceito', 'transplantado', ctx(1, 1)))).toEqual([
      'orgao-ja-destinado',
    ]);
    expect(conferirTransicaoDestino('ofertado', 'aceito', ctx(0, 1))).toEqual([]);
    // Órgão par (rim): dois receptores, o terceiro não.
    expect(conferirTransicaoDestino('ofertado', 'aceito', ctx(1, 2))).toEqual([]);
    expect(codigos(conferirTransicaoDestino('ofertado', 'aceito', ctx(2, 2)))).toEqual([
      'orgao-ja-destinado',
    ]);
    // Quantidade inválida no catálogo vale 1; recusar ou descartar nunca ocupa o órgão.
    expect(codigos(conferirTransicaoDestino('ofertado', 'aceito', ctx(1, 0)))).toEqual([
      'orgao-ja-destinado',
    ]);
    expect(conferirTransicaoDestino('ofertado', 'recusado', ctx(5, 1))).toEqual([]);
    expect(conferirTransicaoDestino('aceito', 'descartado', ctx(5, 1))).toEqual([]);
    expect(destinoOcupaOrgao('aceito') && destinoOcupaOrgao('transplantado')).toBe(true);
    expect(destinoOcupaOrgao('ofertado')).toBe(false);
  });
});

describe('acompanhamento depois do transplante', () => {
  it('só do transplantado, a partir do dia do transplante, sem futuro e com descrição', () => {
    const a = {
      situacaoReceptor: 'transplantado' as const,
      transplantadoEm: '2026-11-10',
      observadoEm: '2026-11-20',
      descricao: 'Febre baixa',
    };
    expect(conferirAcompanhamento(a, '2026-11-25')).toEqual([]);
    expect(codigos(conferirAcompanhamento({ ...a, observadoEm: '2026-11-09' }, '2026-11-25'))).toEqual([
      'antes-do-transplante',
    ]);
    expect(
      codigos(
        conferirAcompanhamento(
          {
            ...a,
            situacaoReceptor: 'ativo',
            transplantadoEm: null,
            observadoEm: '2026-11-30',
            descricao: '',
          },
          '2026-11-25',
        ),
      ),
    ).toEqual(['receptor-sem-transplante', 'observacao-futura', 'acompanhamento-sem-descricao']);
    expect(diasDoTransplante('2026-11-10', '2026-11-20')).toBe(10);
    expect(acompanhamentoEmDestaque('suspeita_rejeicao')).toBe(true);
    expect(acompanhamentoEmDestaque('sintoma')).toBe(false);
  });
});
