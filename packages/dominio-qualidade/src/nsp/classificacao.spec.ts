// Regra 2 do M48: taxonomia da OMS, grau de dano e obrigatoriedade do Notivisa.
import { describe, expect, it } from 'vitest';
import {
  conferirClassificacao,
  ehObito,
  exigeAtencaoImediata,
  notivisaObrigatorio,
  propostaDeClassificacao,
} from './classificacao.js';

describe('proposta a partir do que o notificador respondeu', () => {
  it('não chegou ao paciente: quase erro; chegou sem dano: incidente sem dano; com dano: evento adverso', () => {
    expect(propostaDeClassificacao(false, 'nenhum')).toBe('quaseErro');
    expect(propostaDeClassificacao(true, 'nenhum')).toBe('incidenteSemDano');
    expect(propostaDeClassificacao(true, 'leve')).toBe('eventoAdverso');
    expect(propostaDeClassificacao(true, 'obito')).toBe('eventoAdverso');
  });
});

describe('coerência da classificação com o dano', () => {
  it('aceita as combinações coerentes', () => {
    expect(conferirClassificacao('circunstanciaNotificavel', 'nenhum')).toBeNull();
    expect(conferirClassificacao('quaseErro', 'nenhum')).toBeNull();
    expect(conferirClassificacao('incidenteSemDano', 'nenhum')).toBeNull();
    expect(conferirClassificacao('eventoAdverso', 'moderado')).toBeNull();
  });

  it('recusa dano no que não atingiu, evento adverso sem dano e incidente sem dano com dano', () => {
    expect(conferirClassificacao('quaseErro', 'leve')).toBe('dano-sem-ter-atingido');
    expect(conferirClassificacao('circunstanciaNotificavel', 'grave')).toBe('dano-sem-ter-atingido');
    expect(conferirClassificacao('eventoAdverso', 'nenhum')).toBe('evento-adverso-sem-dano');
    expect(conferirClassificacao('incidenteSemDano', 'leve')).toBe('incidente-sem-dano-com-dano');
  });
});

describe('óbito, Notivisa e atenção imediata', () => {
  it('óbito só no evento adverso com dano óbito; Notivisa obrigatório no evento adverso', () => {
    expect(ehObito('eventoAdverso', 'obito')).toBe(true);
    expect(ehObito('eventoAdverso', 'grave')).toBe(false);
    expect(notivisaObrigatorio('eventoAdverso')).toBe(true);
    expect(notivisaObrigatorio('incidenteSemDano')).toBe(false);
  });

  it('grave, óbito ou never event vão ao topo da triagem', () => {
    expect(exigeAtencaoImediata('grave')).toBe(true);
    expect(exigeAtencaoImediata('obito')).toBe(true);
    expect(exigeAtencaoImediata('moderado')).toBe(false);
    expect(exigeAtencaoImediata('nenhum', true)).toBe(true);
  });
});
