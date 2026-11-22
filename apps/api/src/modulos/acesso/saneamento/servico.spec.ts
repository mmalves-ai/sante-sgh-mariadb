// Serviço do saneamento dos grupos (M59-F4; regra 8): painel, usuários com a sugestão, simulador, plano (decidir,
// aprovar pela área, descartar) e a aplicação pelas receitas do M10 (executor falso). Porta em memória, dados sintéticos.
import { ErroOperacao } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import { PortaSaneamentoMemoria } from './porta-memoria.js';
import {
  type AtorSaneamento,
  ErroSaneamento,
  type ExecutorSaneamento,
  OPERACOES_SANEAMENTO,
  ServicoSaneamento,
  chaveDoLote,
} from './servico.js';

const AGORA = Date.UTC(2026, 9, 29, 15, 0, 0);
const gestor: AtorSaneamento = {
  rede: 'rede-teste',
  hospital: 'pc',
  login: 'SINT.GESTOR',
  estacao: 'est-1',
  correlacao: 'c-1',
};
const area: AtorSaneamento = { ...gestor, login: 'SINT.AREA' };

const u = (login: string, grupo: string | null, ultimoAcesso: string | null = '2026-10-20', extra = {}) => ({
  login,
  idUsuario: 100 + login.length,
  nome: `Pessoa ${login}`,
  grupo,
  ativo: true,
  bloqueado: false,
  ultimoAcesso,
  ...extra,
});

function montar(opcoes: { maximo?: number; executor?: Partial<ExecutorSaneamento> | null } = {}) {
  const porta = new PortaSaneamentoMemoria(() => AGORA)
    .comGrupo('MASTER', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    .comGrupo('MASTER_SEM_FINANCEIRO', [1, 2, 3, 4, 5, 6])
    .comGrupo('SEM GRUPO', [1])
    .comGrupo('FATURAMENTO', [1, 2, 3])
    .comGrupo('FINANCEIRO', [7, 8, 9])
    .comGrupo('TI', [1, 2], false)
    .comUsuario(u('SINT.A', 'MASTER'), { 2: 5, 7: 3 })
    .comUsuario(u('SINT.B', 'MASTER'), { 1: 1, 2: 1 })
    .comUsuario(u('SINT.C', 'MASTER', '2026-01-10'))
    .comUsuario(u('SINT.D', null, null))
    .comUsuario(u('SINT.GESTOR', 'MASTER'))
    .comUsuario(u('SINT.AREA', 'FATURAMENTO'));
  const chamadas: { nome: string; entrada: unknown; chave: string }[] = [];
  const invalidados: (string | null)[] = [];
  const executor: ExecutorSaneamento | null =
    opcoes.executor === null
      ? null
      : {
          receita: () => ({ ligada: true, motivo: null }),
          executar: async (nome, _h, entrada, ctx) => {
            chamadas.push({ nome, entrada, chave: ctx.chaveIdempotencia });
          },
          ...opcoes.executor,
        };
  const s = new ServicoSaneamento({
    porta,
    executor,
    administradoresMaximo: async () => opcoes.maximo ?? 2,
    invalidar: async (_r, _h, login) => {
      invalidados.push(login);
    },
    agora: () => AGORA,
  });
  return { s, porta, chamadas, invalidados };
}

async function recusa(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroSaneamento) return e.codigo;
    throw e;
  }
  throw new Error('esperava recusa');
}

describe('leituras', () => {
  it('painel: grupos genéricos, administradores, destinos (sem genéricos nem inativos)', async () => {
    const { s } = montar();
    const p = await s.painel(gestor);
    expect(p.grupos.map((g) => g.grupo)).toEqual([
      'MASTER',
      'MASTER_SEM_FINANCEIRO',
      'MASTER_CONSULTA_FINANCEIRO',
      'SEM GRUPO',
    ]);
    expect(p.grupos[0]).toMatchObject({
      ativos: 4,
      opcoes: 10,
      semDecisao: 4,
      inativosNoGrupo: 0,
      dissolvivel: false,
    });
    expect(p.grupos[1]).toMatchObject({ ativos: 0, dissolvivel: true });
    expect(p.grupos[2]).toMatchObject({ existe: false, dissolvivel: false });
    // A conta sem perfil (SINT.D) não entra no "SEM GRUPO": o grupo só tem quem tem o perfil com esse código.
    expect(p.grupos[3]).toMatchObject({ ativos: 0, dissolvivel: true });
    expect(p.destinos).toEqual([
      { grupo: 'FATURAMENTO', opcoes: 3 },
      { grupo: 'FINANCEIRO', opcoes: 3 },
    ]);
    expect(p.administradores).toEqual({ maximo: 2, mantidos: 0, ativosNoMaster: 4, excedido: true });
    expect(p.janelaDias).toBe(180);
  });

  it('usuários com a sugestão pelo uso e os dias sem acesso; grupo não genérico recusa', async () => {
    const { s } = montar();
    const r = await s.usuarios(gestor, 'MASTER');
    expect(r.usoLido).toBe(true);
    const a = r.usuarios.find((x) => x.login === 'SINT.A');
    expect(a?.sugestao).toEqual({ grupo: 'FATURAMENTO', cobertas: 1, usadas: 2 });
    expect(r.usuarios.find((x) => x.login === 'SINT.B')?.sugestao?.grupo).toBe('FATURAMENTO');
    expect(r.usuarios.find((x) => x.login === 'SINT.C')?.diasSemAcesso).toBe(292);
    expect(r.usuarios.find((x) => x.login === 'SINT.C')?.sugestao).toBeNull();
    // A conta sem perfil no estabelecimento (grupo nulo) fica fora do alcance: nenhum grupo a recolhe.
    expect((await s.usuarios(gestor, 'SEM GRUPO')).usuarios).toEqual([]);
    expect(await recusa(s.simular(gestor, 'SINT.D', 'FATURAMENTO'))).toBe('grupo-nao-generico');
    expect(await recusa(s.usuarios(gestor, 'FATURAMENTO'))).toBe('grupo-nao-generico');
  });

  it('uso que não responde: usoLido falso, sem sugestão e sem cache da falha', async () => {
    const { s, porta } = montar();
    const original = porta.uso.bind(porta);
    let falhar = true;
    porta.uso = async (...a) => {
      if (falhar) throw new Error('tempo esgotado');
      return original(...a);
    };
    const r = await s.usuarios(gestor, 'MASTER');
    expect(r.usoLido).toBe(false);
    expect(r.usuarios.every((x) => x.sugestao === null)).toBe(true);
    falhar = false;
    expect((await s.usuarios(gestor, 'MASTER')).usoLido).toBe(true);
  });

  it('simulador: antes, depois, ganhas, perdidas com títulos e usos; destino inválido recusa', async () => {
    const { s } = montar();
    const r = await s.simular(gestor, 'SINT.A', 'FATURAMENTO');
    expect(r).toMatchObject({
      grupoOrigem: 'MASTER',
      antes: 10,
      depois: 3,
      mantidas: 3,
      ganhasTotal: 0,
      perdidasTotal: 7,
      perdidasUsadas: 1,
      exigeAprovacao: true,
      usoLido: true,
    });
    expect(r.perdidas[0]).toEqual({ id: 7, titulo: 'Opção 7', usos: 3 });
    expect(await recusa(s.simular(gestor, 'SINT.A', 'SEM GRUPO'))).toBe('destino-generico');
    expect(await recusa(s.simular(gestor, 'SINT.A', 'NAO-EXISTE'))).toBe('destino-invalido');
    expect(await recusa(s.simular(gestor, 'SINT.AREA', 'FINANCEIRO'))).toBe('grupo-nao-generico');
    expect(await recusa(s.simular(gestor, 'SINT.X', 'FINANCEIRO'))).toBe('usuario-inexistente');
  });

  it('banco sem o script: indisponível (503)', async () => {
    const { s, porta } = montar();
    porta.prontoMem = false;
    await expect(s.painel(gestor)).rejects.toMatchObject({ codigo: 'indisponivel', status: 503 });
    porta.pronto = async () => {
      throw new Error('sem conexão');
    };
    expect(await recusa(s.plano(gestor))).toBe('indisponivel');
  });
});

describe('plano e aplicação', () => {
  it('troca com perda usada: exige a aprovação de outra pessoa; aplica pelo executor; invalida o usuário', async () => {
    const { s, chamadas, invalidados, porta } = montar();
    const i = await s.incluir(gestor, {
      login: 'SINT.A',
      decisao: 'trocar-grupo',
      grupoDestino: 'FATURAMENTO',
      motivo: 'Trabalha no faturamento',
    });
    expect(i).toMatchObject({ situacao: 'proposto', exigeAprovacao: true, perdasUsadas: 1, perdasTotal: 7 });
    expect(await recusa(s.aplicar(gestor, i.id, { chaveIdempotencia: 'chave-0001' }))).toBe(
      'exige-aprovacao',
    );
    expect(await recusa(s.aprovar(gestor, i.id, { area: 'Faturamento', motivo: 'Sem uso' }))).toBe(
      'aprovacao-pelo-proponente',
    );
    const ap = await s.aprovar(area, i.id, { area: 'Faturamento', motivo: 'Opção sem uso na função' });
    expect(ap.aprovacao?.por).toBe('SINT.AREA');
    const r = await s.aplicar(gestor, i.id, { chaveIdempotencia: 'chave-0001', reautenticadoEm: AGORA });
    expect(r).toMatchObject({
      operacao: OPERACOES_SANEAMENTO.trocarGrupo,
      lotes: 1,
      item: { situacao: 'aplicado' },
    });
    expect(chamadas).toEqual([
      {
        nome: OPERACOES_SANEAMENTO.trocarGrupo,
        entrada: { login: 'SINT.A', grupoOrigem: 'MASTER', grupo: 'FATURAMENTO' },
        chave: 'chave-0001',
      },
    ]);
    expect(invalidados).toEqual(['SINT.A']);
    expect(porta.trilhas.map((t) => t.evento)).toEqual([
      'acesso.saneamento.incluido',
      'acesso.saneamento.aprovado',
      'acesso.saneamento.aplicado',
      'acesso.saneamento.aplicado',
    ]);
    // A primeira "aplicado" é a reserva (antes do banco); a segunda, a conclusão.
    expect(porta.trilhas.map((t) => t.operacao).slice(-2)).toEqual(['reservar', 'aplicar']);
    expect(await recusa(s.aplicar(gestor, i.id, { chaveIdempotencia: 'chave-0002' }))).toBe(
      'situacao-nao-permite',
    );
  });

  it('troca sem perda usada: aplica sem aprovação; aprovar recusa', async () => {
    const { s } = montar();
    const i = await s.incluir(gestor, {
      login: 'SINT.B',
      decisao: 'trocar-grupo',
      grupoDestino: 'FATURAMENTO',
      motivo: 'Trabalha no faturamento',
    });
    expect(i.exigeAprovacao).toBe(false);
    expect(await recusa(s.aprovar(area, i.id, { area: 'Faturamento', motivo: 'Desnecessária' }))).toBe(
      'aprovacao-desnecessaria',
    );
    expect((await s.aplicar(gestor, i.id, { chaveIdempotencia: 'chave-0003' })).item.situacao).toBe(
      'aplicado',
    );
  });

  it('uso sem resposta na decisão: exige a aprovação (falha fechada)', async () => {
    const { s, porta } = montar();
    porta.uso = async () => {
      throw new Error('tempo esgotado');
    };
    const i = await s.incluir(gestor, {
      login: 'SINT.B',
      decisao: 'trocar-grupo',
      grupoDestino: 'FATURAMENTO',
      motivo: 'Trabalha no faturamento',
    });
    expect(i.exigeAprovacao).toBe(true);
  });

  it('perdas que aumentaram depois da aprovação recusam', async () => {
    const { s, porta } = montar();
    const i = await s.incluir(gestor, {
      login: 'SINT.A',
      decisao: 'trocar-grupo',
      grupoDestino: 'FATURAMENTO',
      motivo: 'Trabalha no faturamento',
    });
    await s.aprovar(area, i.id, { area: 'Faturamento', motivo: 'Opção sem uso na função' });
    porta.gruposMem.set('FATURAMENTO', { ativo: true, opcoes: new Set([1]) });
    // O cache do uso não muda; a simulação refeita com o destino novo perde a opção 2 (usada).
    expect(await recusa(s.aplicar(gestor, i.id, { chaveIdempotencia: 'chave-0004' }))).toBe(
      'perdas-aumentaram',
    );
  });

  it('usuário que saiu do grupo antes da aplicação: recusa sem gravar', async () => {
    const { s, porta, chamadas } = montar();
    const i = await s.incluir(gestor, {
      login: 'SINT.B',
      decisao: 'trocar-grupo',
      grupoDestino: 'FATURAMENTO',
      motivo: 'Trabalha no faturamento',
    });
    porta.usuariosMem.set('SINT.B', u('SINT.B', 'FINANCEIRO'));
    expect(await recusa(s.aplicar(gestor, i.id, { chaveIdempotencia: 'chave-0005' }))).toBe(
      'usuario-fora-do-grupo',
    );
    expect(chamadas).toHaveLength(0);
  });

  it('administradores: só no MASTER e até o máximo; manter não grava no banco', async () => {
    const { s, chamadas } = montar({ maximo: 1 });
    const i = await s.incluir(gestor, {
      login: 'SINT.B',
      decisao: 'manter-administrador',
      grupoDestino: null,
      motivo: 'Administrador do sistema',
    });
    expect(
      await recusa(
        s.incluir(gestor, {
          login: 'SINT.A',
          decisao: 'manter-administrador',
          grupoDestino: null,
          motivo: 'Administrador também',
        }),
      ),
    ).toBe('administradores-no-limite');
    // Trocar a decisão do mesmo usuário não conta contra o limite.
    await s.incluir(gestor, {
      login: 'SINT.B',
      decisao: 'manter-administrador',
      grupoDestino: null,
      motivo: 'Administrador do sistema',
    });
    expect(
      await recusa(
        s.incluir(gestor, {
          login: 'SINT.D',
          decisao: 'manter-administrador',
          grupoDestino: null,
          motivo: 'Fora do master',
        }),
      ),
    ).toBe('grupo-nao-generico');
    expect((await s.painel(gestor)).administradores).toMatchObject({ maximo: 1, mantidos: 1 });
    const plano = await s.plano(gestor, 'MASTER');
    expect(plano.find((x) => x.id === i.id)?.situacao).toBe('descartado');
    const viva = plano.find((x) => x.situacao === 'proposto');
    const r = await s.aplicar(gestor, viva?.id ?? '', { chaveIdempotencia: 'chave-0006' });
    expect(r).toMatchObject({ operacao: null, lotes: 0, item: { situacao: 'aplicado' } });
    expect(chamadas).toHaveLength(0);
  });

  it('bloqueio só sem uso recente; aplica pela receita do bloqueio', async () => {
    const { s, chamadas } = montar();
    expect(
      await recusa(
        s.incluir(gestor, { login: 'SINT.A', decisao: 'bloquear', grupoDestino: null, motivo: 'Sem uso' }),
      ),
    ).toBe('bloqueio-com-uso-recente');
    const i = await s.incluir(gestor, {
      login: 'SINT.C',
      decisao: 'bloquear',
      grupoDestino: null,
      motivo: 'Sem entrar há meses',
    });
    await s.aplicar(gestor, i.id, { chaveIdempotencia: 'chave-0007' });
    expect(chamadas[0]).toMatchObject({ nome: OPERACOES_SANEAMENTO.bloquear, entrada: { login: 'SINT.C' } });
  });

  it('bloqueio recusado para quem tem perfil em outro estabelecimento (o bloqueio vale na rede toda)', async () => {
    const { s, porta } = montar();
    porta.comUsuario(u('SINT.H', 'MASTER', '2025-01-10', { emOutroEstabelecimento: true }));
    expect(
      await recusa(
        s.incluir(gestor, {
          login: 'SINT.H',
          decisao: 'bloquear',
          grupoDestino: null,
          motivo: 'Sem entrar há meses',
        }),
      ),
    ).toBe('conta-em-outro-estabelecimento');
  });

  it('ninguém decide sobre si; usuário inexistente e decisão inexistente', async () => {
    const { s } = montar();
    expect(
      await recusa(
        s.incluir(gestor, {
          login: 'SINT.GESTOR',
          decisao: 'trocar-grupo',
          grupoDestino: 'FATURAMENTO',
          motivo: 'A si mesmo',
        }),
      ),
    ).toBe('a-si-mesmo');
    expect(
      await recusa(
        s.incluir(gestor, {
          login: 'SINT.X',
          decisao: 'bloquear',
          grupoDestino: null,
          motivo: 'Inexistente',
        }),
      ),
    ).toBe('usuario-inexistente');
    expect(await recusa(s.aplicar(gestor, '999', { chaveIdempotencia: 'chave-0008' }))).toBe(
      'item-inexistente',
    );
    expect(await recusa(s.descartar(gestor, '999'))).toBe('item-inexistente');
  });

  it('descarte e recusas de situação', async () => {
    const { s } = montar();
    const i = await s.incluir(gestor, {
      login: 'SINT.B',
      decisao: 'trocar-grupo',
      grupoDestino: 'FATURAMENTO',
      motivo: 'Trabalha no faturamento',
    });
    expect((await s.descartar(gestor, i.id)).situacao).toBe('descartado');
    expect(await recusa(s.descartar(gestor, i.id))).toBe('situacao-nao-permite');
  });

  it('receita desligada: recusa sem marcar a decisão; erro do executor marca "não aplicada"', async () => {
    const desligada = montar({
      executor: { receita: () => ({ ligada: false, motivo: 'Assinatura pendente' }) },
    });
    const i = await desligada.s.incluir(gestor, {
      login: 'SINT.B',
      decisao: 'trocar-grupo',
      grupoDestino: 'FATURAMENTO',
      motivo: 'Trabalha no faturamento',
    });
    expect(await recusa(desligada.s.aplicar(gestor, i.id, { chaveIdempotencia: 'chave-0009' }))).toBe(
      'operacao-desligada',
    );
    expect((await desligada.s.plano(gestor)).find((x) => x.id === i.id)?.situacao).toBe('proposto');

    const erro = montar({
      executor: {
        executar: async () => {
          throw new ErroOperacao(409, 'grupo-alterado', 'Recusa', 'Grupo alterado');
        },
      },
    });
    const j = await erro.s.incluir(gestor, {
      login: 'SINT.B',
      decisao: 'trocar-grupo',
      grupoDestino: 'FATURAMENTO',
      motivo: 'Trabalha no faturamento',
    });
    await expect(erro.s.aplicar(gestor, j.id, { chaveIdempotencia: 'chave-0010' })).rejects.toBeInstanceOf(
      ErroOperacao,
    );
    expect((await erro.s.plano(gestor)).find((x) => x.id === j.id)).toMatchObject({
      situacao: 'falhou',
      erro: 'grupo-alterado',
    });
    const sem = montar({ executor: null });
    const k = await sem.s.incluir(gestor, {
      login: 'SINT.B',
      decisao: 'trocar-grupo',
      grupoDestino: 'FATURAMENTO',
      motivo: 'Trabalha no faturamento',
    });
    await expect(sem.s.aplicar(gestor, k.id, { chaveIdempotencia: 'chave-0011' })).rejects.toMatchObject({
      status: 503,
    });
  });
});

describe('dissolução', () => {
  it('grupo vazio: retira as opções em lotes de 200 com a chave por lote; invalida o estabelecimento', async () => {
    const { s, porta, chamadas, invalidados } = montar();
    porta.comGrupo(
      'MASTER_SEM_FINANCEIRO',
      Array.from({ length: 450 }, (_, i) => i + 1),
    );
    const r = await s.dissolver(gestor, 'MASTER_SEM_FINANCEIRO', 'Grupo esvaziado pelo saneamento', {
      chaveIdempotencia: 'chave-dis-01',
    });
    expect(r).toMatchObject({
      operacao: OPERACOES_SANEAMENTO.retirarOpcoes,
      lotes: 3,
      item: { decisao: 'dissolver-grupo', situacao: 'aplicado', perdasTotal: 450 },
    });
    // A chave de cada lote deriva das ações dele: repetir o pedido depois de uma falha retira só o resto.
    const chaves = chamadas.map((c) => c.chave);
    expect(chaves).toEqual(
      [1, 201, 401].map((i) =>
        chaveDoLote(
          'chave-dis-01',
          Array.from({ length: i === 401 ? 50 : 200 }, (_, k) => i + k),
        ),
      ),
    );
    expect(new Set(chaves).size).toBe(3);
    expect(chaves.every((c) => /^chave-dis-01\.[0-9a-f]{16}$/.test(c))).toBe(true);
    expect((chamadas[2]?.entrada as { opcoes: number[] }).opcoes).toHaveLength(50);
    expect(invalidados).toEqual([null]);
  });

  it('recusas: MASTER, grupo com ativos, não genérico, sem opções; lote que falha marca "não aplicada"', async () => {
    const { s, porta } = montar();
    const ctx = { chaveIdempotencia: 'chave-dis-02' };
    expect(await recusa(s.dissolver(gestor, 'MASTER', 'Dissolver o master', ctx))).toBe(
      'master-nao-dissolve',
    );
    porta.comUsuario(u('SINT.F', 'MASTER_SEM_FINANCEIRO'));
    expect(await recusa(s.dissolver(gestor, 'MASTER_SEM_FINANCEIRO', 'Ainda tem ativo', ctx))).toBe(
      'grupo-com-ativos',
    );
    expect(await recusa(s.dissolver(gestor, 'FATURAMENTO', 'Não genérico', ctx))).toBe('grupo-nao-generico');
    expect(await recusa(s.dissolver(gestor, 'MASTER_CONSULTA_FINANCEIRO', 'Não existe', ctx))).toBe(
      'grupo-sem-opcoes',
    );
    let n = 0;
    const erro = montar({
      executor: {
        executar: async () => {
          if (++n === 1) return;
          throw new Error('queda');
        },
      },
    });
    erro.porta.comGrupo(
      'MASTER_SEM_FINANCEIRO',
      Array.from({ length: 300 }, (_, i) => i + 1),
    );
    await expect(erro.s.dissolver(gestor, 'MASTER_SEM_FINANCEIRO', 'Grupo esvaziado', ctx)).rejects.toThrow(
      'queda',
    );
    expect((await erro.s.plano(gestor, 'MASTER_SEM_FINANCEIRO'))[0]).toMatchObject({
      situacao: 'falhou',
      erro: 'erro-inesperado',
    });
  });
});

// Correção da revisão do M59.4 (três achados).
describe('revisão do M59.4', () => {
  it('achado 1: a entrada no MASTER fora do saneamento respeita o máximo (troca, criação e desbloqueio)', async () => {
    const pc = { rede: 'rede-teste', hospital: 'pc' };
    const cheio = montar({ maximo: 4 });
    cheio.porta.comUsuario(u('SINT.E', 'MASTER', null, { bloqueado: true }));
    // 4 ativos no MASTER e máximo 4: mais um recusa.
    expect(await recusa(cheio.s.conferirEntradaNoMaster(pc, 'SINT.AREA', 'MASTER'))).toBe(
      'administradores-no-limite',
    );
    expect(await recusa(cheio.s.conferirEntradaNoMaster(pc, 'SINT.NOVO', 'master'))).toBe(
      'administradores-no-limite',
    );
    expect(await recusa(cheio.s.conferirEntradaNoMaster(pc, 'SINT.E', null))).toBe(
      'administradores-no-limite',
    );
    // Fora do MASTER, quem já conta nele, o bloqueado (não conta) e o desbloqueio fora do MASTER passam.
    await expect(cheio.s.conferirEntradaNoMaster(pc, 'SINT.AREA', 'FINANCEIRO')).resolves.toBeUndefined();
    await expect(cheio.s.conferirEntradaNoMaster(pc, 'SINT.A', 'MASTER')).resolves.toBeUndefined();
    await expect(cheio.s.conferirEntradaNoMaster(pc, 'SINT.E', 'MASTER')).resolves.toBeUndefined();
    await expect(cheio.s.conferirEntradaNoMaster(pc, 'SINT.AREA', null)).resolves.toBeUndefined();
    // Com folga, entra.
    const folga = montar({ maximo: 5 });
    await expect(folga.s.conferirEntradaNoMaster(pc, 'SINT.AREA', 'MASTER')).resolves.toBeUndefined();
  });

  it('achado 2: inativo e bloqueado do MASTER aparecem e saem pela troca de grupo; não ficam como administrador', async () => {
    const { s, porta, chamadas } = montar();
    porta
      .comUsuario(u('SINT.E', 'MASTER', '2025-01-10', { bloqueado: true }))
      .comUsuario(u('SINT.F', 'MASTER', null, { ativo: false }));
    const lista = await s.usuarios(gestor, 'MASTER');
    expect(lista.usuarios.map((x) => x.login).slice(-2)).toEqual(['SINT.E', 'SINT.F']);
    expect((await s.painel(gestor)).grupos[0]).toMatchObject({ ativos: 4, inativosNoGrupo: 2 });
    expect(
      await recusa(
        s.incluir(gestor, {
          login: 'SINT.E',
          decisao: 'manter-administrador',
          grupoDestino: null,
          motivo: 'Fica',
        }),
      ),
    ).toBe('usuario-inativo');
    const i = await s.incluir(gestor, {
      login: 'SINT.E',
      decisao: 'trocar-grupo',
      grupoDestino: 'FATURAMENTO',
      motivo: 'Sai do acesso total',
    });
    expect((await s.aplicar(gestor, i.id, { chaveIdempotencia: 'chave-r2-1' })).item.situacao).toBe(
      'aplicado',
    );
    expect(chamadas.at(-1)).toMatchObject({
      nome: OPERACOES_SANEAMENTO.trocarGrupo,
      entrada: { login: 'SINT.E', grupo: 'FATURAMENTO' },
    });
    const j = await s.incluir(gestor, {
      login: 'SINT.F',
      decisao: 'trocar-grupo',
      grupoDestino: 'FINANCEIRO',
      motivo: 'Sai do acesso total',
    });
    expect(j.situacao).toBe('proposto');
  });

  it('achado 3: o item é reservado antes do banco; descarte e segundo pedido no meio recusam; o plano fica igual ao banco', async () => {
    let dentro: (() => Promise<void>) | null = null;
    const m = montar({
      executor: {
        executar: async () => {
          if (dentro) await dentro();
        },
      },
    });
    const i = await m.s.incluir(gestor, {
      login: 'SINT.B',
      decisao: 'trocar-grupo',
      grupoDestino: 'FATURAMENTO',
      motivo: 'Trabalha no faturamento',
    });
    const recusas: string[] = [];
    dentro = async () => {
      recusas.push(await recusa(m.s.descartar(gestor, i.id)));
      recusas.push(await recusa(m.s.aplicar(gestor, i.id, { chaveIdempotencia: 'chave-r3-2' })));
      // Decidir de novo durante a aplicação não descarta a reservada.
      await m.s.incluir(gestor, {
        login: 'SINT.B',
        decisao: 'trocar-grupo',
        grupoDestino: 'FINANCEIRO',
        motivo: 'Outra ideia',
      });
    };
    const r = await m.s.aplicar(gestor, i.id, { chaveIdempotencia: 'chave-r3-1' });
    expect(recusas).toEqual(['alterado', 'alterado']);
    expect(r.item).toMatchObject({ situacao: 'aplicado', aplicadoPor: 'SINT.GESTOR' });
    expect(m.porta.trilhas.some((t) => t.operacao === 'reservar')).toBe(true);

    // A falha solta a reserva: o item vira "não aplicado" e pode ser descartado.
    const erro = montar({
      executor: {
        executar: async () => {
          throw new ErroOperacao(409, 'mesmo-grupo', 'Recusa', 'Mesmo grupo');
        },
      },
    });
    const j = await erro.s.incluir(gestor, {
      login: 'SINT.B',
      decisao: 'trocar-grupo',
      grupoDestino: 'FATURAMENTO',
      motivo: 'Trabalha no faturamento',
    });
    await expect(erro.s.aplicar(gestor, j.id, { chaveIdempotencia: 'chave-r3-3' })).rejects.toBeInstanceOf(
      ErroOperacao,
    );
    expect((await erro.s.descartar(gestor, j.id)).situacao).toBe('descartado');

    // Dissolução: a conclusão que não muda a linha não responde "aplicado".
    const d = montar();
    d.porta.concluir = async () => false;
    expect(
      await recusa(
        d.s.dissolver(gestor, 'MASTER_SEM_FINANCEIRO', 'Grupo esvaziado', { chaveIdempotencia: 'k-d' }),
      ),
    ).toBe('alterado');
  });
});
