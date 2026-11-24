// Tela "Carga e sincronismo" (obra carga-painel), unidade: só o ator da plataforma passa; a senha da origem vai só ao
// cofre e nunca volta; a decisão completa/diferencial/retomar; as ações pelo estado; o progresso do motor; o log com
// proteção de caminho; a ponte do testar-origem só com agregados.
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { CargaController } from './carga.controller.js';
import { PonteConectorScript } from './ponte-script.js';
import { ErroOnboarding } from './porta.js';
import {
  acoesDaCarga,
  batimentoAtrasado,
  caminhoDoLog,
  type CofreCarga,
  decidirCarga,
  decidirRetomada,
  type LinhaExecucaoCarga,
  percentualDaCarga,
  progressoDosContadores,
  type RepositorioCarga,
  ServicoCarga,
  type SituacaoCarga,
} from './servico-carga.js';

const req = (usuario: Record<string, unknown> | null) =>
  ({ sgh: usuario ? { sessao: { usuario } } : undefined }) as unknown as RequisicaoAutorizada;
const PLAT = req({ id: 'plataforma:7', login: 'plataforma:adm', ator: 'plataforma' });
const SENHA = 'segredo-de-teste-123';

const tmp = mkdtempSync(join(tmpdir(), 'carga-spec-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function linha(p: Partial<LinhaExecucaoCarga> = {}): LinhaExecucaoCarga {
  return {
    id: 5,
    tipo: 'importar',
    estado: 'gravando',
    etapa: 'gravando',
    percentual: 10,
    contadores: {},
    motivoFalha: null,
    solicitadoEm: null,
    iniciadoEm: null,
    concluidoEm: null,
    batimentoEm: null,
    pausaSolicitadaEm: null,
    modo: 'completa',
    arquivoLog: null,
    origemId: 3,
    segundosSemBatimento: 5,
    ...p,
  };
}

function montar(
  o: {
    cofreDisponivel?: boolean;
    execucao?: LinhaExecucaoCarga | null;
    pastaLogs?: string | null;
    falhaOrigem?: 'conflito' | 'depois';
  } = {},
) {
  const chamadas: string[] = [];
  const cofreValores = new Map<string, string>();
  const cofre: CofreCarga = {
    disponivel: o.cofreDisponivel ?? true,
    existe: async (r) => cofreValores.has(r),
    ler: async (r) => cofreValores.get(r) ?? null,
    gravar: async (r, v) => {
      cofreValores.set(r, v);
    },
  };
  const sit: SituacaoCarga = {
    origemId: 3,
    importacaoConcluida: false,
    ultimaImportacao: null,
    ultima: null,
  };
  const repo: RepositorioCarga = {
    listarConectores: async () => [
      {
        codigo: 'exemplo',
        nome: 'Exemplo',
        origem: {
          tipo: 'firebird_servidor',
          nomeExibicao: 'Servidor',
          caminhoRelativo: null,
          host: 'fb-exemplo',
          porta: 3050,
          banco: 'base',
          senhaReferencia: 'cofre:conector/exemplo/firebird-senha',
        },
        ultimaExecucao: linha({ arquivoLog: 'exemplo/execucao-5.log' }),
      },
      { codigo: 'outro', nome: 'Outro', origem: null, ultimaExecucao: null },
    ],
    origemDoCliente: async (c) => ({
      existe: c !== 'nenhum',
      tipo: c === 'arquivo' ? 'firebird_arquivo' : 'firebird_servidor',
    }),
    gravarOrigemServidor: async (c, d, ref, a, antesDeConfirmar) => {
      // Como o repositório real: a carga ativa recusa antes de tudo; a falha 'depois' simula o commit que não fecha.
      if (o.falhaOrigem === 'conflito')
        throw new ErroOnboarding('conflito', 'Há uma carga em andamento: pause ou aguarde antes de trocar a origem.');
      if (antesDeConfirmar) await antesDeConfirmar();
      if (o.falhaOrigem === 'depois') throw new Error('transação falhou');
      chamadas.push(`origem ${c} ${JSON.stringify(d)} ${ref} ${a}`);
      return { origemId: 3, nova: true };
    },
    cargaDoCliente: async (c) => (c === 'nenhum' ? null : { origemId: 3, execucao: o.execucao ?? null }),
    enfileirarCarga: async (c, decidir, a) => {
      const plano = decidir(sit);
      chamadas.push(`enfileirar ${c} ${plano.tipo} ${plano.modo} ${a}`);
      return { id: 9, plano };
    },
    pedirPausa: async (c, a) => {
      chamadas.push(`pausar ${c} ${a}`);
      return 5;
    },
    arquivoLog: async (_c, id) => (id === 5 ? 'exemplo/execucao-5.log' : id === 6 ? null : undefined),
  };
  const ponte = {
    testarOrigem: async (c: string) => {
      chamadas.push(`testar ${c}`);
      return { ok: true, versaoServidor: 'WI-V3.0', ods: '12.0', tabelas: 10, mensagem: 'ok' };
    },
  };
  const s = new ServicoCarga(repo, ponte, cofre, o.pastaLogs === undefined ? tmp : o.pastaLogs);
  return { c: new CargaController(s), s, chamadas, cofreValores };
}

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroProblema) return e.getStatus();
    throw e;
  }
  return 200;
}

describe('carga: portão do administrador da plataforma', () => {
  it('usuário do cliente recebe 403 em todas as rotas, sem chamar nada', async () => {
    const { c, chamadas } = montar();
    const u = req({ id: '15', login: 'ana' });
    expect(await status(c.conectores(u))).toBe(403);
    expect(await status(c.origemServidor(u, 'exemplo', {}))).toBe(403);
    expect(await status(c.testar(u, 'exemplo'))).toBe(403);
    expect(await status(c.iniciar(u, 'exemplo', { modo: 'completa' }))).toBe(403);
    expect(await status(c.pausar(u, 'exemplo'))).toBe(403);
    expect(await status(c.retomar(u, 'exemplo'))).toBe(403);
    expect(await status(c.carga(u, 'exemplo'))).toBe(403);
    expect(await status(c.log(u, 'exemplo', '5'))).toBe(403);
    expect(chamadas).toEqual([]);
  });

  it('sem o serviço (sem núcleo), 503', async () => {
    expect(await status(new CargaController(null).conectores(PLAT))).toBe(503);
  });
});

describe('carga: origem do servidor e senha no cofre', () => {
  const corpo = {
    host: 'fb-exemplo',
    porta: 3050,
    banco: 'base',
    usuario: 'LEITOR',
    nomeExibicao: 'Servidor',
  };

  it('a senha vai só ao cofre: não chega ao repositório nem volta na resposta', async () => {
    const { c, chamadas, cofreValores } = montar();
    const r = await c.origemServidor(PLAT, 'exemplo', { ...corpo, senha: SENHA });
    expect(r).toEqual({ ...corpo, senhaDefinida: true });
    expect(JSON.stringify(r)).not.toContain(SENHA);
    expect(cofreValores.get('cofre:conector/exemplo/firebird-senha')).toBe(SENHA);
    expect(chamadas.join('\n')).not.toContain(SENHA);
    expect(chamadas[0]).toContain('cofre:conector/exemplo/firebird-senha 7');
    // alteração sem senha mantém a do cofre
    expect(await status(c.origemServidor(PLAT, 'exemplo', corpo))).toBe(200);
  });

  it('sem senha no cofre exige a senha; cofre indisponível dá 503; entrada inválida dá 400', async () => {
    expect(await status(montar().c.origemServidor(PLAT, 'exemplo', corpo))).toBe(400);
    expect(
      await status(
        montar({ cofreDisponivel: false }).c.origemServidor(PLAT, 'exemplo', { ...corpo, senha: SENHA }),
      ),
    ).toBe(503);
    const { c } = montar();
    expect(await status(c.origemServidor(PLAT, 'exemplo', { ...corpo, porta: 0, senha: SENHA }))).toBe(400);
    expect(await status(c.origemServidor(PLAT, 'exemplo', { ...corpo, host: 'a b', senha: SENHA }))).toBe(
      400,
    );
    expect(await status(c.origemServidor(PLAT, 'exemplo', { ...corpo, senha: SENHA, extra: 1 }))).toBe(400);
    expect(await status(c.origemServidor(PLAT, 'Exemplo!', { ...corpo, senha: SENHA }))).toBe(400);
    expect(await status(c.origemServidor(PLAT, 'nenhum', { ...corpo, senha: SENHA }))).toBe(404);
  });

  it('PUT com carga ativa dá 409 e o cofre fica inalterado; transação que falha devolve a senha anterior', async () => {
    const ref = 'cofre:conector/exemplo/firebird-senha';
    const a = montar({ falhaOrigem: 'conflito' });
    a.cofreValores.set(ref, 'anterior');
    expect(await status(a.c.origemServidor(PLAT, 'exemplo', { ...corpo, senha: SENHA }))).toBe(409);
    expect(a.cofreValores.get(ref)).toBe('anterior');
    const sem = montar({ falhaOrigem: 'conflito' });
    expect(await status(sem.c.origemServidor(PLAT, 'exemplo', { ...corpo, senha: SENHA }))).toBe(409);
    expect(sem.cofreValores.has(ref)).toBe(false);
    const b = montar({ falhaOrigem: 'depois' });
    b.cofreValores.set(ref, 'anterior');
    await expect(b.s.gravarOrigemServidor('exemplo', { ...corpo, senha: SENHA }, 7)).rejects.toThrow('transação falhou');
    expect(b.cofreValores.get(ref)).toBe('anterior');
  });

  it('testar só com origem de servidor configurada', async () => {
    const { c, chamadas } = montar();
    expect((await c.testar(PLAT, 'exemplo')).tabelas).toBe(10);
    expect(await status(c.testar(PLAT, 'arquivo'))).toBe(400);
    expect(chamadas).toEqual(['testar exemplo']);
  });

  it('lista os conectores com endereço legível e a senha só como "definida"', async () => {
    const { s, cofreValores } = montar();
    cofreValores.set('cofre:conector/exemplo/firebird-senha', SENHA);
    const l = await s.listarConectores();
    expect(l[0]?.origem).toEqual({
      tipo: 'firebird_servidor',
      nomeExibicao: 'Servidor',
      endereco: 'fb-exemplo:3050/base',
      senhaDefinida: true,
    });
    expect(l[0]?.ultimaExecucao?.temLog).toBe(true);
    expect(l[1]?.origem).toBeNull();
    expect(JSON.stringify(l)).not.toContain(SENHA);
  });
});

describe('carga: decisão completa, diferencial e retomar', () => {
  const base: SituacaoCarga = {
    origemId: 3,
    importacaoConcluida: false,
    ultimaImportacao: null,
    ultima: null,
  };

  it('completa é importação nova; sem origem, recusa', () => {
    expect(decidirCarga('completa', base)).toEqual({
      tipo: 'importar',
      modo: 'completa',
      continuarDe: null,
      reprocessarRecusadas: false,
    });
    expect(() => decidirCarga('completa', { ...base, origemId: null })).toThrow(/origem/);
  });

  it('diferencial: sincronizar com importação concluída; senão importação que continua a parada da mesma origem', () => {
    expect(decidirCarga('diferencial', { ...base, importacaoConcluida: true })).toEqual({
      tipo: 'sincronizar',
      modo: 'diferencial',
      continuarDe: null,
      reprocessarRecusadas: true,
    });
    const parada = { id: 4, estado: 'pausada' as const, origemId: 3 };
    expect(decidirCarga('diferencial', { ...base, ultimaImportacao: parada }).continuarDe).toBe(4);
    expect(
      decidirCarga('diferencial', { ...base, ultimaImportacao: { ...parada, estado: 'falhou' } }).continuarDe,
    ).toBe(4);
    expect(
      decidirCarga('diferencial', { ...base, ultimaImportacao: { ...parada, origemId: 2 } }).continuarDe,
    ).toBeNull();
    expect(
      decidirCarga('diferencial', { ...base, ultimaImportacao: { ...parada, estado: 'cancelada' } }),
    ).toEqual({
      tipo: 'importar',
      modo: 'diferencial',
      continuarDe: null,
      reprocessarRecusadas: true,
    });
  });

  it('retomar continua a importação parada com o modo dela; sincronização roda de novo; nada parado, recusa', () => {
    const u = {
      id: 4,
      tipo: 'importar' as const,
      estado: 'pausada' as const,
      origemId: 3,
      modo: 'diferencial' as const,
      reprocessarRecusadas: true,
    };
    expect(decidirRetomada({ ...base, ultima: u })).toEqual({
      tipo: 'importar',
      modo: 'diferencial',
      continuarDe: 4,
      reprocessarRecusadas: true,
    });
    expect(
      decidirRetomada({
        ...base,
        ultima: { ...u, tipo: 'sincronizar', modo: null, reprocessarRecusadas: false },
      }),
    ).toEqual({
      tipo: 'sincronizar',
      modo: 'diferencial',
      continuarDe: null,
      reprocessarRecusadas: false,
    });
    expect(() => decidirRetomada(base)).toThrow(/retomar/);
    expect(() => decidirRetomada({ ...base, ultima: { ...u, estado: 'concluida' } })).toThrow(/retomar/);
    expect(() => decidirRetomada({ ...base, ultima: { ...u, origemId: 2 } })).toThrow(/origem/);
  });

  it('a rota de carga valida o modo e devolve o id; retomar e pausar seguem ao repositório com o administrador', async () => {
    const { c, chamadas } = montar();
    expect(await c.iniciar(PLAT, 'exemplo', { modo: 'completa' })).toEqual({ execucao: 9 });
    expect(await status(c.iniciar(PLAT, 'exemplo', { modo: 'tudo' }))).toBe(400);
    expect(await status(c.retomar(PLAT, 'exemplo'))).toBe(400);
    expect(await c.pausar(PLAT, 'exemplo')).toEqual({ execucao: 5 });
    expect(chamadas).toEqual(['enfileirar exemplo importar completa 7', 'pausar exemplo 7']);
  });
});

describe('carga: ações, batimento e progresso', () => {
  const e = { estado: 'gravando' as const, pausaSolicitada: false, tipo: 'importar' as const, origemId: 3 };

  it('ações pelo estado', () => {
    expect(acoesDaCarga(null, 3)).toEqual({ iniciar: true, pausar: false, retomar: false });
    expect(acoesDaCarga(null, null)).toEqual({ iniciar: false, pausar: false, retomar: false });
    expect(acoesDaCarga(e, 3)).toEqual({ iniciar: false, pausar: true, retomar: false });
    expect(acoesDaCarga({ ...e, pausaSolicitada: true }, 3).pausar).toBe(false);
    expect(acoesDaCarga({ ...e, estado: 'fila' }, 3)).toEqual({
      iniciar: false,
      pausar: false,
      retomar: false,
    });
    expect(acoesDaCarga({ ...e, estado: 'pausando' }, 3)).toEqual({
      iniciar: false,
      pausar: false,
      retomar: false,
    });
    expect(acoesDaCarga({ ...e, estado: 'pausada' }, 3)).toEqual({
      iniciar: true,
      pausar: false,
      retomar: true,
    });
    expect(acoesDaCarga({ ...e, estado: 'pausada' }, 2).retomar).toBe(false);
    expect(acoesDaCarga({ ...e, estado: 'concluida' }, 3)).toEqual({
      iniciar: true,
      pausar: false,
      retomar: false,
    });
  });

  it('batimento atrasado só numa ativa, depois de 3 minutos', () => {
    expect(batimentoAtrasado('gravando', 181)).toBe(true);
    expect(batimentoAtrasado('gravando', 180)).toBe(false);
    expect(batimentoAtrasado('concluida', 9999)).toBe(false);
    expect(batimentoAtrasado('lendo', null)).toBe(false);
  });

  it('progresso do motor (snake_case) vira o contrato; percentual por linhas', () => {
    const p = progressoDosContadores({
      progresso: {
        tabela_atual: 'paciente',
        linhas_total: 200,
        linhas_processadas: 50,
        gravadas: 40,
        puladas_iguais: 5,
        recusadas: 5,
        recusas_por_regra: { restricao_destino_1048: 5 },
        recusas_por_tabela: [{ tabela: 'paciente', recusadas: 5 }],
      },
    });
    expect(p).toMatchObject({ tabelaAtual: 'paciente', linhasTotal: 200, recusadas: 5, tabelasTotal: 0 });
    expect(p?.recusasPorRegra).toEqual({ restricao_destino_1048: 5 });
    expect(percentualDaCarga(p, 99)).toBe(25);
    expect(percentualDaCarga(null, 12.5)).toBe(12.5);
    expect(progressoDosContadores({})).toBeNull();
    expect(progressoDosContadores({ progresso: { gravadas: -1 } })).toBeNull();
  });

  it('a rota de progresso monta execução, progresso, conciliação e ações', async () => {
    const execucao = linha({
      estado: 'gravando',
      segundosSemBatimento: 400,
      arquivoLog: 'x.log',
      contadores: {
        progresso: { linhas_total: 10, linhas_processadas: 10, recusadas: 2 },
        conciliacao_carga: { recusadas: 2, conferido: true },
      },
    });
    const r = await montar({ execucao }).c.carga(PLAT, 'exemplo');
    expect(r.execucao).toMatchObject({
      id: 5,
      estado: 'gravando',
      percentual: 100,
      temLog: true,
      modo: 'completa',
    });
    expect(r.batimentoAtrasado).toBe(true);
    expect(r.conciliacaoCarga).toEqual({ recusadas: 2, conferido: false });
    expect(r.acoes).toEqual({ iniciar: false, pausar: true, retomar: false });
    const vazio = await montar().c.carga(PLAT, 'exemplo');
    expect(vazio).toMatchObject({ execucao: null, progresso: null, acoes: { iniciar: true } });
    expect(await status(montar().c.carga(PLAT, 'nenhum'))).toBe(404);
  });
});

describe('carga: log da execução', () => {
  mkdirSync(join(tmp, 'logs', 'exemplo'), { recursive: true });
  writeFileSync(join(tmp, 'logs', 'exemplo', 'execucao-5.log'), 'linha de log\n');
  writeFileSync(join(tmp, 'fora.log'), 'fora\n');
  symlinkSync(join(tmp, 'fora.log'), join(tmp, 'logs', 'exemplo', 'link.log'));
  const pasta = join(tmp, 'logs');

  it('resolve só dentro da pasta de logs (sem absoluto, .., link para fora nem pasta)', () => {
    expect(caminhoDoLog(pasta, 'exemplo/execucao-5.log')).toBe(join(pasta, 'exemplo', 'execucao-5.log'));
    expect(caminhoDoLog(pasta, '../fora.log')).toBeNull();
    expect(caminhoDoLog(pasta, '/etc/passwd')).toBeNull();
    expect(caminhoDoLog(pasta, 'exemplo/link.log')).toBeNull();
    expect(caminhoDoLog(pasta, 'exemplo')).toBeNull();
    expect(caminhoDoLog(pasta, 'exemplo/nao-existe.log')).toBeNull();
    expect(caminhoDoLog(pasta, '')).toBeNull();
  });

  it('a rota devolve o arquivo; 404 sem log ou sem execução; 503 sem a pasta configurada', async () => {
    const { c } = montar({ pastaLogs: pasta });
    expect(await status(c.log(PLAT, 'exemplo', '5'))).toBe(200);
    expect(await status(c.log(PLAT, 'exemplo', '6'))).toBe(404);
    expect(await status(c.log(PLAT, 'exemplo', '7'))).toBe(404);
    expect(await status(c.log(PLAT, 'exemplo', 'x'))).toBe(400);
    expect(await status(montar({ pastaLogs: null }).c.log(PLAT, 'exemplo', '5'))).toBe(503);
  });
});

describe('carga: ponte do testar-origem', () => {
  function raizCom(saida: string, codigo = 0): string {
    const raiz = mkdtempSync(join(tmp, 'raiz-'));
    mkdirSync(join(raiz, 'conector'));
    const script = join(raiz, 'conector', 'conector.sh');
    writeFileSync(script, `#!/bin/sh\necho "aviso qualquer"\ncat <<'FIM'\n${saida}\nFIM\nexit ${codigo}\n`);
    chmodSync(script, 0o755);
    return raiz;
  }

  it('lê o JSON do conector só com agregados', async () => {
    const p = new PonteConectorScript({
      raiz: raizCom(
        '{"ok": true, "versaoServidor": "WI-V3.0.14", "ods": "12.2", "tabelas": 3824, "senha": "x"}',
      ),
      plataforma: 'teste',
    });
    expect(await p.testarOrigem('exemplo')).toEqual({
      ok: true,
      versaoServidor: 'WI-V3.0.14',
      ods: '12.2',
      tabelas: 3824,
      mensagem: 'Conexão aberta.',
    });
  });

  it('falha do conector com JSON vira ok=false com a mensagem; sem JSON, 503', async () => {
    const p = new PonteConectorScript({
      raiz: raizCom('{"ok": false, "mensagem": "conexão recusada"}', 2),
      plataforma: 'teste',
    });
    expect(await p.testarOrigem('exemplo')).toMatchObject({
      ok: false,
      mensagem: 'conexão recusada',
      tabelas: null,
    });
    const q = new PonteConectorScript({ raiz: raizCom('nada', 1), plataforma: 'teste' });
    await expect(q.testarOrigem('exemplo')).rejects.toThrow(/não respondeu/);
  });
});
