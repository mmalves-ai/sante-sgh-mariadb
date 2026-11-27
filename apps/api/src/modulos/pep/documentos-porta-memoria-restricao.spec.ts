// C2-006 (05-SADT linha 5): o pedido de exame da prescrição na porta EM MEMÓRIA (fonte sintética) passa pela mesma
// decisaoDoPedido do banco do cliente, com restrições sintéticas fixas: o sódio só até 60 anos, sem exceção; o beta
// HCG só para o sexo feminino, com exceção justificada e autorizada. Pacientes SINTÉTICOS 1001 (masculino, 1958) e
// 1003 (feminino, 1990).
import type { ContextoOperacao } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import type { ContextoDocs } from './documentos-porta.js';
import { PortaDocumentosMemoria } from './documentos-porta-memoria.js';
import { cboDe } from './registro-porta-memoria.js';

const c: ContextoDocs = {
  cliente: 'demo',
  estabelecimento: null,
  usuario: null,
  correlacao: 'c2-006-memoria',
  rede: 'REDE',
  hospital: 'HOSP',
};
const LOGIN = 'SINT.MEDICO';
const ctx = { usuario: 1, login: LOGIN } as unknown as ContextoOperacao;

const pedido = (paciente: number, exame: number, extra: Record<string, unknown> = {}) => ({
  paciente,
  atendimento: paciente * 10 + 1,
  cbo: cboDe(LOGIN),
  retratos: { htAtendimento: 1, htPaciente: 1 },
  dataHoraClinica: '2026-11-27T10:00',
  itens: [{ exame, urgente: false }],
  documento: 'x'.repeat(60),
  hashConteudo: 'a'.repeat(64),
  ...extra,
});

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    return (e as { problema?: { codigo?: string } }).problema?.codigo ?? String(e);
  }
}

describe('restrição do exame na porta em memória (C2-006)', () => {
  it('o bloqueio sem exceção recusa (sódio acima de 60 anos); abaixo, grava', async () => {
    const porta = new PortaDocumentosMemoria();
    expect(await codigo(porta.executar(c, 'pep.solicitarExame', pedido(1001, 503), ctx))).toBe(
      'restricao-bloqueio',
    );
    expect(await codigo(porta.executar(c, 'pep.solicitarExame', pedido(1003, 503), ctx))).toBe('gravou');
  });

  it('a regra por sexo pede justificativa e quem autorize; com os dois, grava', async () => {
    const porta = new PortaDocumentosMemoria();
    const exec = (extra: Record<string, unknown>) =>
      codigo(porta.executar(c, 'pep.solicitarExame', pedido(1001, 504, extra), ctx));
    expect(await exec({ confirmado: true })).toBe('restricao-justificativa');
    expect(await exec({ confirmado: true, justificativa: 'Urgencia clinica sintetica' })).toBe(
      'restricao-autorizacao',
    );
    expect(
      await exec({ confirmado: true, justificativa: 'Urgencia clinica sintetica', autorizaExcecao: true }),
    ).toBe('gravou');
    expect(await codigo(porta.executar(c, 'pep.solicitarExame', pedido(1003, 504), ctx))).toBe('gravou');
  });
});
