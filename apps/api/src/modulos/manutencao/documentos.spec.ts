// Documentos da manutenção (M55, etapa 1; ficha, seção 10, "Documento: OS e laudo em PDF/A"): o HTML da OS (prazos,
// parada, reparo, a conta dos custos e o histórico) e o do laudo da execução do plano, autocontidos e com o texto
// escapado. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import { htmlLaudoExecucao, htmlOrdemServico } from './documentos.js';
import { LAUDO, OS_ENCERRADA } from './documentos.spec-util.js';

const autocontido = (h: string) => {
  expect(h).not.toMatch(/https?:\/\//);
  expect(h).not.toMatch(/<script|<link|<img/);
};

describe('documento da OS', () => {
  it('traz a OS, os prazos, a parada, a conta dos custos e o histórico, escapa o texto e é autocontido', () => {
    const h = htmlOrdemServico({
      os: OS_ENCERRADA,
      estabelecimento: 'pc',
      emitidoEm: '2026-10-29T12:00:00Z',
      emitidoPor: 'SINT.MANUTENCAO',
    });
    expect(h).toContain('Ordem de serviço nº 2026-000001');
    expect(h).toContain('Corretiva · prioridade Alta · Encerrada');
    expect(h).toContain('EQ-0001 MONITOR &lt;SINTETICO&gt; &amp; CIA (crítico)');
    expect(h).toContain('28/10/2026 11:00 (Cumprido no prazo)');
    expect(h).toContain('de 28/10/2026 09:00 a 28/10/2026 10:45');
    expect(h).toContain('R$ 123,45 + R$ 50,00 + R$ 0,00 = R$ 173,45 (custo total)');
    expect(h).toContain('Aberta → Em atendimento');
    expect(h).toContain('documento nº 900');
    expect(h).toContain('Emitido em 29/10/2026 por SINT.MANUTENCAO');
    autocontido(h);
  });

  it('sem equipamento, sem parada e sem histórico: os traços', () => {
    const h = htmlOrdemServico({
      os: {
        ...OS_ENCERRADA,
        equipamento: null,
        local: 'Corredor B',
        paradaInicio: null,
        laudo: null,
        eventos: [],
      },
      estabelecimento: 'pc',
      emitidoEm: '2026-10-29T12:00:00Z',
      emitidoPor: 'SINT.MANUTENCAO',
    });
    expect(h).toContain('Corredor B');
    expect(h).toContain('<td colspan="4">—</td>');
    expect(h).not.toContain('documento nº');
  });
});

describe('laudo da execução do plano', () => {
  it('traz o equipamento, a atividade, o resultado, o certificado do padrão e a corretiva aberta', () => {
    const h = htmlLaudoExecucao(LAUDO);
    expect(h).toContain('Laudo de teste de segurança elétrica nº 7');
    expect(h).toContain('resultado: Reprovado');
    expect(h).toContain('FABRICANTE · MOD-1 · S-1');
    expect(h).toContain('Classe III (alto risco)');
    expect(h).toContain('a cada 12 meses');
    expect(h).toContain('CERT-PADRAO-1');
    expect(h).toContain('2026-000002');
    expect(h).toContain('Emitido em 29/10/2026 por SINT.MANUTENCAO');
    autocontido(h);
  });
});
