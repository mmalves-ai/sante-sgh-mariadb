import { describe, expect, it } from 'vitest';
import {
  CAMPO_DO_ERRO_DEMOGRAFIA,
  type DemografiaConferida,
  errosDemografia,
  errosVulnerabilidade,
  nomeDeTratamento,
  recusaFimVulnerabilidade,
} from './demografia.js';

const base: DemografiaConferida = {
  nome: 'MARIA SINTETICA DA SILVA',
  usaNomeSocial: false,
  nomeSocial: null,
  racaCorExigeEtnia: null,
  temPovoIndigena: false,
  capacidadeExigeResponsavel: null,
  temRepresentanteVigente: false,
};

describe('dados demográficos do paciente', () => {
  it('nada informado e tudo coerente: grava', () => {
    expect(errosDemografia(base)).toEqual([]);
    expect(
      errosDemografia({
        ...base,
        usaNomeSocial: true,
        nomeSocial: 'JOANA SINTETICA',
        racaCorExigeEtnia: true,
        temPovoIndigena: true,
        capacidadeExigeResponsavel: true,
        temRepresentanteVigente: true,
      }),
    ).toEqual([]);
  });

  it('nome social: exigido quando usado; guardado sem uso é aceito; não repete o nome civil', () => {
    expect(errosDemografia({ ...base, usaNomeSocial: true })).toEqual(['nome-social-exigido']);
    expect(errosDemografia({ ...base, usaNomeSocial: true, nomeSocial: '   ' })).toEqual([
      'nome-social-exigido',
    ]);
    expect(errosDemografia({ ...base, nomeSocial: 'JOANA SINTETICA' })).toEqual([]);
    expect(
      errosDemografia({ ...base, usaNomeSocial: true, nomeSocial: ' maria  sintética da silva ' }),
    ).toEqual(['nome-social-igual-ao-nome']);
  });

  it('povo indígena: sempre, e só, com a raça/cor que exige a etnia', () => {
    expect(errosDemografia({ ...base, racaCorExigeEtnia: true })).toEqual(['povo-indigena-exigido']);
    expect(errosDemografia({ ...base, racaCorExigeEtnia: false, temPovoIndigena: true })).toEqual([
      'povo-indigena-indevido',
    ]);
    expect(errosDemografia({ ...base, temPovoIndigena: true })).toEqual(['povo-indigena-indevido']);
    expect(errosDemografia({ ...base, racaCorExigeEtnia: false })).toEqual([]);
  });

  it('capacidade civil que exige responsável legal só com representante vigente', () => {
    expect(errosDemografia({ ...base, capacidadeExigeResponsavel: true })).toEqual([
      'capacidade-sem-responsavel',
    ]);
    expect(
      errosDemografia({ ...base, capacidadeExigeResponsavel: true, temRepresentanteVigente: true }),
    ).toEqual([]);
    expect(errosDemografia({ ...base, capacidadeExigeResponsavel: false })).toEqual([]);
  });

  it('as recusas saem na ordem dos campos e cada uma aponta o campo da tela', () => {
    const erros = errosDemografia({
      ...base,
      usaNomeSocial: true,
      racaCorExigeEtnia: true,
      capacidadeExigeResponsavel: true,
    });
    expect(erros).toEqual(['nome-social-exigido', 'povo-indigena-exigido', 'capacidade-sem-responsavel']);
    expect(erros.map((e) => CAMPO_DO_ERRO_DEMOGRAFIA[e])).toEqual([
      'nomeSocial',
      'povoIndigena',
      'capacidadeCivil',
    ]);
  });

  it('nome de tratamento: o social só quando usado', () => {
    expect(nomeDeTratamento('MARIA', true, 'JOANA')).toBe('JOANA');
    expect(nomeDeTratamento('MARIA', false, 'JOANA')).toBe('MARIA');
    expect(nomeDeTratamento('MARIA', true, ' ')).toBe('MARIA');
  });
});

describe('condição de vulnerabilidade do paciente', () => {
  const nova = { declaradaEm: '2026-11-20', informanteTipo: 'paciente', informanteNome: null };
  const HOJE = '2026-11-24';

  it('declaração: data não futura nem anterior ao nascimento', () => {
    expect(errosVulnerabilidade(nova, '1980-01-01', HOJE, false)).toEqual([]);
    expect(errosVulnerabilidade({ ...nova, declaradaEm: '2026-11-25' }, null, HOJE, false)).toEqual([
      'declaradaEm',
    ]);
    expect(errosVulnerabilidade({ ...nova, declaradaEm: '1979-12-31' }, '1980-01-01', HOJE, false)).toEqual([
      'declaradaEm',
    ]);
    expect(errosVulnerabilidade({ ...nova, declaradaEm: '20/11/2026' }, null, HOJE, false)).toEqual([
      'declaradaEm',
    ]);
  });

  it('informante do vocabulário, com nome quando não é o paciente nem o serviço', () => {
    expect(errosVulnerabilidade({ ...nova, informanteTipo: 'vizinho' }, null, HOJE, false)).toEqual([
      'informanteTipo',
    ]);
    expect(errosVulnerabilidade({ ...nova, informanteTipo: 'familiar' }, null, HOJE, false)).toEqual([
      'informanteNome',
    ]);
    expect(
      errosVulnerabilidade(
        { ...nova, informanteTipo: 'familiar', informanteNome: 'IRMA SINTETICA' },
        null,
        HOJE,
        false,
      ),
    ).toEqual([]);
    expect(errosVulnerabilidade({ ...nova, informanteTipo: 'servico_social' }, null, HOJE, false)).toEqual(
      [],
    );
  });

  it('a mesma condição vigente não é declarada de novo', () => {
    expect(errosVulnerabilidade(nova, null, HOJE, true)).toEqual(['ja-vigente']);
  });

  it('fim: não futuro nem anterior à declaração', () => {
    expect(recusaFimVulnerabilidade('2026-11-20', '2026-11-24', HOJE)).toBeNull();
    expect(recusaFimVulnerabilidade('2026-11-20', '2026-11-20', HOJE)).toBeNull();
    expect(recusaFimVulnerabilidade('2026-11-20', '2026-11-19', HOJE)).toBe('fim');
    expect(recusaFimVulnerabilidade('2026-11-20', '2026-11-25', HOJE)).toBe('fim');
    expect(recusaFimVulnerabilidade('2026-11-20', '', HOJE)).toBe('fim');
  });
});
