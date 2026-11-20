// Relay da outbox (ficha do M04, seção 1): ordem de ID, publica e marca; falha para o lote do estabelecimento,
// com espera crescente e `morto` ao esgotar. Dublê de banco.
import { describe, expect, it } from 'vitest';
import { escritorDuble } from '../duble-escritor.spec-util.js';
import { cicloRelay, CONFIGURACAO_RELAY_PADRAO, esperaDaTentativa } from './relay.js';

const pendente = (id: string, tentativas = 0) => ({
  ID: id,
  REDE: 'r',
  HOSPITAL: 'pc',
  TIPO: 't',
  CHAVE_EVENTO: `k${id}`,
  CARGA: '{"id":1}',
  TENTATIVAS: tentativas,
});

function acesso(linhas: Record<string, unknown>[]) {
  const e = escritorDuble((c) => (c.sql.includes('FROM SGH_OUTBOX') ? linhas : 1));
  return {
    e,
    acesso: {
      ler: <T>(fn: (l: typeof e) => Promise<T>) => fn(e),
      escrever: <T>(fn: (w: typeof e) => Promise<T>) => fn(e),
    },
  };
}

describe('relay da outbox', () => {
  it('publica em ordem de ID e marca cada um publicado', async () => {
    const { e, acesso: a } = acesso([pendente('1'), pendente('2')]);
    const vistos: string[] = [];
    const r = await cicloRelay(a, 'pc', async (ev) => {
      vistos.push(ev.id);
    });
    expect(r).toEqual({ lidos: 2, publicados: 2, falhas: 0, mortos: 0 });
    expect(vistos).toEqual(['1', '2']);
    expect(e.comandos.filter((c) => c.sql.includes("SITUACAO = 'publicado'"))).toHaveLength(2);
  });

  it('falha (Valkey parado): marca a nova tentativa e para o lote; esgotada, morto', async () => {
    const { e, acesso: a } = acesso([pendente('1'), pendente('2')]);
    const falha = async () => {
      throw new Error('connect ECONNREFUSED');
    };
    expect(await cicloRelay(a, 'pc', falha)).toEqual({ lidos: 2, publicados: 0, falhas: 1, mortos: 0 });
    const marca = e.comandos.find((c) => c.sql.includes('TENTATIVAS = TENTATIVAS + 1'));
    expect(marca?.parametros).toEqual(['pendente', 'Error: connect ECONNREFUSED', 2, '1']);
    const ultimo = acesso([pendente('1', CONFIGURACAO_RELAY_PADRAO.tentativas - 1)]);
    expect(await cicloRelay(ultimo.acesso, 'pc', () => Promise.reject('x'))).toMatchObject({
      falhas: 1,
      mortos: 1,
    });
  });

  it('dois ciclos: o evento que falhou e está em espera segura os seguintes até a nova tentativa', async () => {
    let ciclo = 0;
    const linhasDoCiclo = () =>
      ciclo === 1
        ? [pendente('1'), pendente('2')]
        : ciclo === 2
          ? [
              { ...pendente('1', 1), EM_ESPERA: 1 },
              { ...pendente('2'), EM_ESPERA: 0 },
            ]
          : [
              { ...pendente('1', 1), EM_ESPERA: 0 },
              { ...pendente('2'), EM_ESPERA: 0 },
            ];
    const e = escritorDuble((c) => (c.sql.includes('FROM SGH_OUTBOX') ? linhasDoCiclo() : 1));
    const a = {
      ler: <T>(fn: (l: typeof e) => Promise<T>) => fn(e),
      escrever: <T>(fn: (w: typeof e) => Promise<T>) => fn(e),
    };
    const vistos: string[] = [];
    let falhar = true;
    const publicar = async (ev: { id: string }) => {
      if (falhar) throw new Error('connect ECONNREFUSED');
      vistos.push(ev.id);
    };
    ciclo = 1;
    expect(await cicloRelay(a, 'pc', publicar)).toMatchObject({ publicados: 0, falhas: 1 });
    falhar = false;
    ciclo = 2;
    expect(await cicloRelay(a, 'pc', publicar)).toEqual({ lidos: 0, publicados: 0, falhas: 0, mortos: 0 });
    ciclo = 3;
    expect(await cicloRelay(a, 'pc', publicar)).toMatchObject({ publicados: 2 });
    expect(vistos).toEqual(['1', '2']);
  });

  it('espera crescente até o teto', () => {
    const cfg = CONFIGURACAO_RELAY_PADRAO;
    expect([0, 1, 2, 20].map((t) => esperaDaTentativa(t, cfg))).toEqual([2, 4, 8, 600]);
    expect(esperaDaTentativa(-1, cfg)).toBe(2);
  });
});
