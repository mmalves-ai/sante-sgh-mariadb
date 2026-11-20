// W0-04: as recusas puras da correção e do cancelamento da gestão da qualidade. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  conferirCancelamentoNaoConformidade,
  conferirCancelamentoReuniao,
  conferirCorrecaoManifestacao,
  MENSAGENS_CORRECAO_GESTAO,
} from './correcao.js';

describe('correção e cancelamento da gestão', () => {
  it('a reunião com ata assinada não se cancela: pede a retificação', () => {
    expect(conferirCancelamentoReuniao({ ataAssinadaEm: '2026-11-10T10:00:00' })).toBe('ata-assinada');
    expect(MENSAGENS_CORRECAO_GESTAO['ata-assinada']).toMatch(/Retifique a ata/);
    expect(conferirCancelamentoReuniao({ canceladaEm: '2026-11-10T10:00:00' })).toBe('registro-cancelado');
    expect(conferirCancelamentoReuniao({})).toBeNull();
    // Revisão do W0-04: retificada depois da assinatura (aguardando nova), continua sem cancelamento.
    expect(
      conferirCancelamentoReuniao({ ataAssinadaEm: null, assinaturaAnteriorEm: '2026-11-10T10:00:00' }),
    ).toBe('ata-assinada');
  });
  it('cancela só a NC aberta; a duplicada aponta para outra ativa', () => {
    const nc = { id: 5, situacao: 'aberta' };
    expect(conferirCancelamentoNaoConformidade(nc, null, null)).toBeNull();
    expect(conferirCancelamentoNaoConformidade({ ...nc, situacao: 'emTratamento' }, null, null)).toBe(
      'nc-em-tratamento',
    );
    expect(conferirCancelamentoNaoConformidade(nc, null, 5)).toBe('duplicada-de-si');
    expect(conferirCancelamentoNaoConformidade(nc, null, 4)).toBe('duplicada-inexistente');
    expect(conferirCancelamentoNaoConformidade(nc, { id: 4, canceladaEm: 'x' }, 4)).toBe(
      'duplicada-inexistente',
    );
    expect(conferirCancelamentoNaoConformidade(nc, { id: 4 }, 4)).toBeNull();
  });
  it('a manifestação se corrige só antes do encaminhamento', () => {
    const m = { situacao: 'aberta', tipo: 'reclamacao', area: 'Recepção', relato: 'Demora no atendimento.' };
    expect(conferirCorrecaoManifestacao(m, { ...m, area: 'Internação' })).toBeNull();
    expect(conferirCorrecaoManifestacao(m, m)).toBe('sem-mudanca');
    expect(conferirCorrecaoManifestacao({ ...m, situacao: 'encaminhada' }, { ...m, tipo: 'sugestao' })).toBe(
      'manifestacao-encaminhada',
    );
    expect(conferirCorrecaoManifestacao({ ...m, canceladaEm: 'x' }, m)).toBe('registro-cancelado');
  });
});
