// A seção do cliente inteiro exige permissão própria (F3.3, linha 03-PEP L124, correção): quem só administra o
// estabelecimento não muda os outros estabelecimentos do cliente.
import { describe, expect, it } from 'vitest';
import {
  exigirNivelDoCliente,
  gravaNoCliente,
  PERMISSOES_SUMARIO_SECOES,
} from './sumario-alta-secoes.controller.js';

describe('nível do cliente nas seções do sumário de alta', () => {
  const corpo = { doCliente: true, codigo: 'orient', descricao: 'Orientações', tipoConteudo: 'orientacoes' };

  it('recusa 403 a seção do cliente inteiro sem pep.admin.cliente', () => {
    let status = 0;
    try {
      exigirNivelDoCliente(corpo, (c) => c === PERMISSOES_SUMARIO_SECOES.editar);
    } catch (e) {
      status = (e as { status?: number }).status ?? (e as { getStatus?: () => number }).getStatus?.() ?? -1;
    }
    expect(status).toBe(403);
  });

  it('aceita com a permissão do cliente; a seção do estabelecimento só pede a de editar', () => {
    expect(() => exigirNivelDoCliente(corpo, (c) => c === PERMISSOES_SUMARIO_SECOES.cliente)).not.toThrow();
    expect(() => exigirNivelDoCliente({ ...corpo, doCliente: false }, () => false)).not.toThrow();
    expect(gravaNoCliente({ doCliente: 'true' })).toBe(false);
    expect(gravaNoCliente(null)).toBe(false);
  });
});
