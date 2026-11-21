// F2-L: a trilha em memória e a marca do "login como" (AsyncLocalStorage da própria API, sem o pacote do banco
// de origem). Dados sintéticos.
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { executarComo, marcaComoAtual } from './como.js';
import { type EventoParaTrilha, RegistradorTrilhaMemoria, USUARIO_DESCONHECIDO } from './trilha.js';

const evento = (extra: Partial<EventoParaTrilha> = {}): EventoParaTrilha => ({
  evento: EVENTOS_AUDITAVEIS.permissaoNegada.codigo,
  rede: 'rede',
  hospital: 'h1',
  usuario: 'usuario.teste',
  estacao: 'ESTACAO:teste',
  correlacao: 'corr-0001',
  recurso: 'recurso',
  resultado: 'falha',
  ...extra,
});

describe('trilha em memória e sessão "como"', () => {
  it('fora do "como", a marca é nula; dentro, a trilha guarda o ator real', async () => {
    const t = new RegistradorTrilhaMemoria();
    expect(marcaComoAtual()).toBeNull();
    await t.registrar(evento());
    const marca = { sessao: '7', acao: null, atorTipo: 'plataforma' as const, idConta: '3', alvo: 'alvo' };
    await executarComo(marca, async () => {
      await Promise.resolve();
      expect(marcaComoAtual()).toEqual(marca);
      await t.registrar(evento());
    });
    expect(marcaComoAtual()).toBeNull();
    expect(t.eventos.map((e) => e.como)).toEqual([null, marca]);
  });

  it('usuário não confirmado vai como desconhecido', async () => {
    const t = new RegistradorTrilhaMemoria();
    await t.registrar(evento({ usuarioNaoConfirmado: true }));
    expect(t.eventos[0]?.usuario).toBe(USUARIO_DESCONHECIDO);
  });

  it('falha simulada rejeita', async () => {
    const t = new RegistradorTrilhaMemoria();
    t.falhar = true;
    await expect(t.registrar(evento())).rejects.toThrow();
  });
});
