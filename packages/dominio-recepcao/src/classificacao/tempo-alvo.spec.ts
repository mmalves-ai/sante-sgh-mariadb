// M44, regra 4: tempos-alvo por versão, prazo e estouro sem atendimento médico (dados SINTÉTICOS).
import { describe, expect, it } from 'vitest';
import {
  chaveAvisoEstouro,
  classificacaoVigente,
  prazoDoAtendimento,
  situacaoDoTempo,
  tempoAlvoDaCor,
} from './tempo-alvo.js';
import { PROTOCOLO_SINTETICO } from './protocolo-sintetico.js';

describe('tempo-alvo', () => {
  it('o da versão; sem versão, o padrão (0, 10, 60, 120, 240)', () => {
    const v = {
      cores: PROTOCOLO_SINTETICO.cores.map((c) => (c.cor === 'amarelo' ? { ...c, tempoAlvoMin: 45 } : c)),
    };
    expect(tempoAlvoDaCor(v, 'amarelo')).toBe(45);
    expect(tempoAlvoDaCor(null, 'vermelho')).toBe(0);
    expect(tempoAlvoDaCor(null, 'azul')).toBe(240);
    expect(tempoAlvoDaCor({ cores: [] }, 'laranja')).toBe(10);
  });

  it('prazo = classificação + tempo-alvo, em UTC', () => {
    expect(prazoDoAtendimento('2026-10-23T10:00:00', 60)).toBe('2026-10-23T11:00:00.000Z');
    expect(prazoDoAtendimento('2026-10-23T10:00:00-03:00', 10)).toBe('2026-10-23T13:10:00.000Z');
  });

  it('minutos restantes, estouro sem médico e o relógio parado no atendimento médico', () => {
    const v = { classificadoEm: '2026-10-23T10:00:00', tempoAlvoMin: 60 };
    expect(situacaoDoTempo(v, '2026-10-23T10:20:00', null)).toMatchObject({
      minutosDecorridos: 20,
      minutosRestantes: 40,
      estourado: false,
      atendido: false,
    });
    expect(situacaoDoTempo(v, '2026-10-23T11:05:00', null)).toMatchObject({
      minutosRestantes: -5,
      estourado: true,
    });
    expect(situacaoDoTempo(v, '2026-10-23T12:00:00', '2026-10-23T10:50:00')).toMatchObject({
      minutosDecorridos: 50,
      minutosRestantes: 10,
      estourado: false,
      atendido: true,
    });
    expect(situacaoDoTempo(v, '2026-10-23T12:00:00', '2026-10-23T11:10:00')).toMatchObject({
      estourado: true,
      atendido: true,
    });
    // atendimento médico de antes da classificação (de um ciclo anterior) não para o relógio
    expect(situacaoDoTempo(v, '2026-10-23T11:30:00', '2026-10-23T08:00:00')).toMatchObject({
      estourado: true,
      atendido: false,
    });
  });

  it('vermelho estoura no primeiro minuto sem médico', () => {
    const v = { classificadoEm: '2026-10-23T10:00:00', tempoAlvoMin: 0 };
    expect(situacaoDoTempo(v, '2026-10-23T10:00:00', null).estourado).toBe(false);
    expect(situacaoDoTempo(v, '2026-10-23T10:00:01', null).estourado).toBe(true);
  });

  it('vigente = a mais recente; o aviso de estouro tem uma chave por classificação', () => {
    const linhas = [
      { id: 2, classificadoEm: '2026-10-23T10:30:00' },
      { id: 1, classificadoEm: '2026-10-23T10:00:00' },
      { id: 3, classificadoEm: '2026-10-23T10:30:00' },
    ];
    expect(classificacaoVigente(linhas)?.id).toBe(3);
    expect(classificacaoVigente([])).toBeNull();
    expect(chaveAvisoEstouro('pc', 3)).toBe('pa.classificacao.estouro:pc:3');
    expect(chaveAvisoEstouro('pc', 3)).toBe(chaveAvisoEstouro('pc', 3));
    expect(chaveAvisoEstouro('pc', 4)).not.toBe(chaveAvisoEstouro('pc', 3));
  });
});
