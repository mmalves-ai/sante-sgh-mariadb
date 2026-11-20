// Regras 8 e 9 (unidade): o consumidor é idempotente pelo identificador do evento (a mesma entrega não cria outra
// mensagem); só o parceiro ativo que assina o tipo recebe; o que o gatilho do legado já envia nunca entra. A entrega:
// por objeto, em ordem; a falha agenda a retentativa crescente; esgotou, fila de mortos; parceiro lento não atrasa
// os outros.
import type { EnvioLidoBanco, ParceiroLidoBanco } from '@sgh/legado';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const banco = vi.hoisted(() => ({
  parceiros: [] as ParceiroLidoBanco[],
  envios: new Map<string, EnvioLidoBanco>(),
  outbox: new Map<string, string>(),
  falhas: [] as { id: string; r: Record<string, unknown> }[],
  enviados: [] as string[],
}));

vi.mock('@sgh/legado', async (original) => ({
  ...(await original<typeof import('@sgh/legado')>()),
  lerParceiros: async () => banco.parceiros,
  idDaOutbox: async (_l: unknown, chave: string) => banco.outbox.get(chave) ?? null,
  registrarEnvio: async (
    _e: unknown,
    _h: string,
    n: { chaveEvento: string; parceiro: string; idOutbox: string; chaveOrdem: string },
  ) => {
    const k = `${n.chaveEvento}|${n.parceiro}`;
    if ([...banco.envios.values()].some((x) => `${x.chaveEvento}|${x.parceiro}` === k)) return false;
    const id = String(banco.envios.size + 1);
    banco.envios.set(
      id,
      envio({ id, chaveEvento: n.chaveEvento, parceiro: n.parceiro, chaveOrdem: n.chaveOrdem }),
    );
    return true;
  },
  filaDeEnvio: async () =>
    [...banco.envios.values()].filter((e) => e.situacao === 'pendente' || e.situacao === 'morto'),
  marcarEnviado: async (_e: unknown, _h: string, id: string) => {
    banco.enviados.push(id);
    banco.envios.set(id, { ...banco.envios.get(id)!, situacao: 'enviado' });
    return 1;
  },
  marcarFalhaEnvio: async (_e: unknown, _h: string, id: string, r: Record<string, unknown>) => {
    banco.falhas.push({ id, r });
    const x = banco.envios.get(id)!;
    banco.envios.set(id, {
      ...x,
      situacao: r['situacao'] as EnvioLidoBanco['situacao'],
      tentativas: r['tentativas'] as number,
      proximaTentativaEm: (r['proximaEm'] as Date) ?? null,
      mortoEm: (r['mortoEm'] as Date) ?? null,
    });
    return 1;
  },
}));

const { distribuirEvento, ordemDoEvento } = await import('./consumidor-idempotente.js');
const { cicloEntrega, ErroEntrega } = await import('./entrega.js');

function envio(x: Partial<EnvioLidoBanco> & Pick<EnvioLidoBanco, 'id'>): EnvioLidoBanco {
  return {
    idOutbox: '1',
    chaveEvento: 'c',
    tipoEvento: 'fato.exame.apoio',
    parceiro: 'lab-a',
    chaveOrdem: 'paciente:1',
    tabelaFato: null,
    idFato: null,
    situacao: 'pendente',
    tentativas: 0,
    proximaTentativaEm: null,
    enviadoEm: null,
    recibo: null,
    resposta: null,
    hashConteudo: null,
    mortoEm: null,
    tratamento: null,
    tratadoPor: null,
    motivoTratamento: null,
    criadoEm: new Date(),
    ...x,
  };
}

function parceiro(x: Partial<ParceiroLidoBanco> & Pick<ParceiroLidoBanco, 'codigo'>): ParceiroLidoBanco {
  return {
    id: '1',
    nome: x.codigo,
    tipo: 'apoio',
    canal: null,
    clienteId: null,
    temSegredo: false,
    escopos: [],
    eventos: ['fato.exame.apoio'],
    limiteTentativas: 3,
    finalidade: 'teste',
    baseLegal: 'tutela-da-saude',
    ativo: true,
    criadoPor: 'T',
    alteradoEm: null,
    ...x,
  };
}

const acesso = {
  ler: <T>(_h: string, fn: (l: never) => Promise<T>) => fn({} as never),
  gravar: <T>(_h: string, fn: (e: never) => Promise<T>) => fn({} as never),
};

beforeEach(() => {
  banco.parceiros = [];
  banco.envios.clear();
  banco.outbox.clear();
  banco.falhas = [];
  banco.enviados = [];
});

describe('consumidor idempotente (regra 8)', () => {
  it('a mesma entrega duas vezes cria uma mensagem por parceiro ativo que assina o tipo', async () => {
    banco.parceiros = [
      parceiro({ codigo: 'lab-a' }),
      parceiro({ codigo: 'lab-b', ativo: false }),
      parceiro({ codigo: 'outro', eventos: ['fato.resultado.liberado'] }),
    ];
    banco.outbox.set('h1', '41');
    const ev = { chave: 'h1', tipo: 'fato.exame.apoio', dados: { hospital: 'pc', exame: 10, paciente: 5 } };
    expect(await distribuirEvento(acesso, ev)).toEqual({ parceiros: 1, incluidas: 1, repetidas: 0 });
    expect(await distribuirEvento(acesso, ev)).toEqual({ parceiros: 1, incluidas: 0, repetidas: 1 });
    expect([...banco.envios.values()].map((e) => [e.parceiro, e.chaveOrdem])).toEqual([
      ['lab-a', 'paciente:5'],
    ]);
  });

  it('evento que não é de integração nova (os dos gatilhos, os alertas) é ignorado', async () => {
    banco.parceiros = [parceiro({ codigo: 'lab-a', eventos: ['adt.admissao'] })];
    banco.outbox.set('h2', '42');
    for (const tipo of ['adt.admissao', 'alerta-emergencia', 'bi.exclusao'])
      expect(await distribuirEvento(acesso, { chave: 'h2', tipo, dados: { hospital: 'pc' } })).toEqual({
        parceiros: 0,
        incluidas: 0,
        repetidas: 0,
      });
  });

  it('o teste vai só ao parceiro pedido; a ordem pelo paciente, a conta, o exame ou o estabelecimento', async () => {
    banco.parceiros = [
      parceiro({ codigo: 'lab-a', eventos: ['integracao.teste'] }),
      parceiro({ codigo: 'lab-b', eventos: ['integracao.teste'] }),
    ];
    banco.outbox.set('h3', '43');
    await distribuirEvento(acesso, {
      chave: 'h3',
      tipo: 'integracao.teste',
      dados: { hospital: 'pc', parceiro: 'lab-b' },
    });
    expect([...banco.envios.values()].map((e) => e.parceiro)).toEqual(['lab-b']);
    expect(ordemDoEvento('pc', { conta: 7 })).toBe('conta:7');
    expect(ordemDoEvento('pc', { exame: 9 })).toBe('exame:9');
    expect(ordemDoEvento('pc', {})).toBe('estabelecimento:pc');
  });
});

describe('entrega (regras 9 e 10)', () => {
  it('em ordem por objeto; a falha agenda a retentativa e, no limite, vai à fila de mortos', async () => {
    banco.parceiros = [parceiro({ codigo: 'lab-a', limiteTentativas: 2 })];
    banco.envios.set('1', envio({ id: '1', chaveOrdem: 'paciente:1' }));
    banco.envios.set('2', envio({ id: '2', chaveOrdem: 'paciente:1' }));
    banco.envios.set('3', envio({ id: '3', chaveOrdem: 'paciente:2' }));
    const enviador = vi.fn(async (_p: ParceiroLidoBanco, e: EnvioLidoBanco) => {
      if (e.id === '1') throw new ErroEntrega('AE: sem de-para');
      return { recibo: `AA-${e.id}`, resposta: 'AA', conteudo: 'MSH|...' };
    });
    const agora = new Date('2026-10-22T12:00:00Z');
    const r1 = await cicloEntrega(acesso, 'pc', enviador, { agora: () => agora, tempoPorParceiroMs: 5_000 });
    // O 2 espera o 1 (mesmo paciente); o 3 (outro paciente) sai.
    expect(r1).toEqual({ prontas: 2, enviadas: 1, falhas: 1, mortas: 0 });
    expect(banco.enviados).toEqual(['3']);
    expect(banco.falhas[0]!.r).toMatchObject({
      situacao: 'pendente',
      tentativas: 1,
      resposta: 'AE: sem de-para',
    });
    expect((banco.falhas[0]!.r['proximaEm'] as Date).toISOString()).toBe('2026-10-22T12:01:00.000Z');
    // Antes da hora, nada sai; depois, a segunda falha esgota o limite (2): fila de mortos, e o 2 continua preso.
    expect(
      (await cicloEntrega(acesso, 'pc', enviador, { agora: () => agora, tempoPorParceiroMs: 5_000 })).prontas,
    ).toBe(0);
    const depois = new Date('2026-10-22T12:02:00Z');
    const r3 = await cicloEntrega(acesso, 'pc', enviador, { agora: () => depois, tempoPorParceiroMs: 5_000 });
    expect(r3.mortas).toBe(1);
    expect(banco.envios.get('1')!.situacao).toBe('morto');
    expect(
      (await cicloEntrega(acesso, 'pc', enviador, { agora: () => depois, tempoPorParceiroMs: 5_000 }))
        .prontas,
    ).toBe(0);
  });

  it('parceiro lento não atrasa os outros (cada um com o seu tempo); parceiro desativado espera', async () => {
    banco.parceiros = [
      parceiro({ codigo: 'lento' }),
      parceiro({ codigo: 'rapido' }),
      parceiro({ codigo: 'parado', ativo: false }),
    ];
    banco.envios.set('1', envio({ id: '1', parceiro: 'lento' }));
    banco.envios.set('2', envio({ id: '2', parceiro: 'rapido' }));
    banco.envios.set('3', envio({ id: '3', parceiro: 'parado' }));
    const enviador = async (p: ParceiroLidoBanco) => {
      if (p.codigo === 'lento') await new Promise((ok) => setTimeout(ok, 400));
      return { recibo: 'ok', resposta: 'AA', conteudo: 'x' };
    };
    const inicio = Date.now();
    const r = await cicloEntrega(acesso, 'pc', enviador, {
      agora: () => new Date(),
      tempoPorParceiroMs: 100,
    });
    expect(Date.now() - inicio).toBeLessThan(380);
    expect(banco.enviados).toEqual(['2']);
    expect(r.falhas).toBe(1);
    expect(banco.falhas[0]).toMatchObject({ id: '1', r: { resposta: 'tempo esgotado' } });
    expect(banco.envios.get('3')!.situacao).toBe('pendente');
  });
});
