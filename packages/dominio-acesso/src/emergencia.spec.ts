import { describe, expect, it } from 'vitest';
import {
  emergenciaVigente,
  fimDaEmergencia,
  JANELA_REAUTENTICACAO_MS,
  prazoEmergencia,
  PRAZO_MAXIMO_MINUTOS,
  PRAZO_PADRAO_MINUTOS,
  recusaDaEmergencia,
  recusaDaRevisao,
} from './emergencia.js';

const agora = 1_000_000_000;
const pedido = {
  permissoes: new Set(['acesso.emergencia.solicitar']),
  temConselho: true,
  motivo: 'intercorrencia-outro-setor',
  justificativa: 'Paciente em parada no corredor do setor B',
  reautenticadoEm: agora - 1_000,
  agora,
};

describe('quebra de vidro (regra 8)', () => {
  it('só perfil assistencial com conselho, motivo da lista, justificativa e reautenticação recente', () => {
    expect(recusaDaEmergencia(pedido)).toBeNull();
    expect(recusaDaEmergencia({ ...pedido, permissoes: new Set() })).toBe('sem-permissao');
    expect(recusaDaEmergencia({ ...pedido, temConselho: false })).toBe('sem-conselho');
    expect(recusaDaEmergencia({ ...pedido, motivo: 'qualquer' })).toBe('motivo-invalido');
    expect(recusaDaEmergencia({ ...pedido, justificativa: 'curta' })).toBe('justificativa-curta');
    expect(recusaDaEmergencia({ ...pedido, justificativa: 'x'.repeat(501) })).toBe('justificativa-longa');
    expect(recusaDaEmergencia({ ...pedido, reautenticadoEm: null })).toBe('reautenticacao-necessaria');
    expect(recusaDaEmergencia({ ...pedido, reautenticadoEm: agora - JANELA_REAUTENTICACAO_MS - 1 })).toBe(
      'reautenticacao-necessaria',
    );
  });

  it('prazo configurável dentro do teto; vigência', () => {
    expect(prazoEmergencia(undefined)).toBe(PRAZO_PADRAO_MINUTOS);
    expect(prazoEmergencia(30)).toBe(30);
    expect(prazoEmergencia(-1)).toBe(PRAZO_PADRAO_MINUTOS);
    expect(prazoEmergencia(10_000)).toBe(PRAZO_MAXIMO_MINUTOS);
    const fim = fimDaEmergencia(new Date(0), 60);
    expect(fim.getTime()).toBe(3_600_000);
    expect(emergenciaVigente(fim, new Date(3_599_999))).toBe(true);
    expect(emergenciaVigente(fim, new Date(3_600_000))).toBe(false);
  });

  it('revisão obrigatória por quem tem a permissão e não pediu o acesso', () => {
    const revisor = { login: 'AUD', permissoes: new Set(['acesso.emergencia.revisar']) };
    expect(recusaDaRevisao(revisor, 'MED')).toBeNull();
    expect(recusaDaRevisao(revisor, 'AUD')).toBe('revisor-e-solicitante');
    expect(recusaDaRevisao({ login: 'X', permissoes: new Set() }, 'MED')).toBe('sem-permissao');
  });
});
