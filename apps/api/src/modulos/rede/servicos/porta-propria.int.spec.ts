// Integração da porta própria dos serviços compartilhados da Rede (M57, etapa 3) contra o MariaDB real, no cliente de
// teste da onda 2 (f22_o2, banco cliente_f22_o2). Massa SINTÉTICA (prefixo F57S; nenhuma pessoa real): dois
// estabelecimentos do mesmo cliente e um usuário de teste, que ficam (a trilha aponta para eles); os registros saem no fim.
// Prova: registrar (com envolvidos e trilha na transação), ler, listar (recorte do estabelecimento, filtros, busca sem
// diferença de maiúsculas, ordem do mais recente, teto `ate`), alterar (só o que mudou; repetir não grava; tirar e
// devolver um envolvido) e a lista da Rede pelo serviço.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { esquemaConsultaServicosRede } from '@sgh/contratos';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaRede } from '../tipos-indice.js';
import { PortaServicosRedePropria } from './porta-propria.js';
import { ServicoServicosRede } from './servico.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const REDE = 'rede-f57s';
const EST_A = 'f57sa';
const EST_B = 'f57sb';
const LOGIN = 'F57S.GESTOR';
const RODADA = Date.now().toString(36);

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: unknown }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

async function limpar(e: Escritor): Promise<void> {
  const ids = (
    await e.consultar<{ id: unknown }>("SELECT id FROM servico_compartilhado_rede WHERE titulo LIKE 'F57S %'")
  ).map((x) => Number(x.id));
  if (ids.length === 0) return;
  const q = ids.map(() => '?').join(', ');
  await e.executar(
    `DELETE FROM servico_compartilhado_rede_estabelecimento WHERE servico_compartilhado_rede_id IN (${q})`,
    ids,
  );
  await e.executar(`DELETE FROM servico_compartilhado_rede WHERE id IN (${q})`, ids);
}

describe.skipIf(SEM_BANCO)('porta própria dos serviços compartilhados (cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaServicosRedePropria;
  let m: { estA: number; estB: number; usuario: number };
  let t = Date.UTC(2026, 10, 24, 12, 0, 0);

  const trilha = (est: number, operacao: string): TrilhaRede => ({
    estabelecimento: est,
    usuario: m.usuario,
    acao: 'operacao',
    entidade: 'servico_compartilhado_rede',
    entidadeId: null,
    dadosDepois: { evento: 'teste', recurso: 'rede.servico', operacao },
    correlacao: `teste-f57s-${RODADA}`,
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f57s' }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `Hospital sintético ${codigo}`, `Hospital sintético ${codigo} (fictício)`, agora],
        );
      const estA = await est(EST_A);
      const estB = await est(EST_B);
      const usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [LOGIN],
        'INSERT INTO usuario (login, nome, cpf, criado_em) VALUES (?, ?, ?, ?)',
        [LOGIN, 'Gestor sintético F57S', '90570000191', agora],
      );
      return { estA, estB, usuario };
    });
    porta = new PortaServicosRedePropria(nucleo, CLIENTE, undefined, () => new Date((t += 60_000)));
  }, 120_000);

  afterAll(async () => {
    await nucleo?.escrever({ cliente: CLIENTE, correlacao: 'limpeza-f57s' }, limpar);
    await nucleo?.encerrar();
  });

  const ctxA = { rede: REDE, hospital: EST_A };
  const ctxB = { rede: REDE, hospital: EST_B };

  it('registra com envolvidos e trilha na transação; lê só no estabelecimento do registro', async () => {
    const r = await porta.registrar(
      ctxA,
      {
        area: 'compras',
        titulo: 'F57S Compra conjunta',
        descricao: 'Luvas e Seringas',
        estabelecimentos: [EST_B, EST_A],
      },
      LOGIN,
      trilha(m.estA, 'rede.registrarServicoCompartilhado'),
    );
    expect(r).toMatchObject({
      estabelecimento: EST_A,
      area: 'compras',
      titulo: 'F57S Compra conjunta',
      descricao: 'Luvas e Seringas',
      estabelecimentos: [EST_A, EST_B],
      situacao: 'registrada',
      registradoPor: LOGIN,
      atualizadoPor: null,
      atualizadoEm: null,
    });
    expect(r.registradoEm).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}$/);
    expect(await porta.ler(ctxA, r.id)).toEqual(r);
    expect(await porta.ler(ctxB, r.id)).toBeNull();
    const [tr] = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-f57s' }, (l) =>
      l.consultar<{ n: unknown }>(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'servico_compartilhado_rede' AND entidade_id = ?",
        [r.id],
      ),
    );
    expect(Number(tr?.n)).toBeGreaterThanOrEqual(1);
  });

  it('código de envolvido fora do cliente: 400 e nada gravado; estabelecimento do contexto fora do cliente: 403', async () => {
    await expect(
      porta.registrar(
        ctxA,
        { area: 'outro', titulo: 'F57S Inválido', descricao: null, estabelecimentos: ['naoexiste9'] },
        LOGIN,
        trilha(m.estA, 'x'),
      ),
    ).rejects.toMatchObject({ problema: { status: 400 } });
    await expect(porta.listar({ rede: REDE, hospital: 'naoexiste9' }, { ate: 10 })).rejects.toMatchObject({
      problema: { status: 403 },
    });
    const l = await porta.listar(ctxA, { ate: 50, busca: 'inválido' });
    expect(l.total).toBe(0);
  });

  it('lista: filtros, busca sem diferença de maiúsculas, mais recente primeiro e teto `ate`', async () => {
    await porta.registrar(
      ctxA,
      { area: 'laudos', titulo: 'F57S Laudo central', descricao: null, estabelecimentos: [EST_A] },
      LOGIN,
      trilha(m.estA, 'x'),
    );
    await porta.registrar(
      ctxB,
      { area: 'laudos', titulo: 'F57S Laudo em B', descricao: null, estabelecimentos: [EST_B] },
      LOGIN,
      trilha(m.estB, 'x'),
    );
    const todos = await porta.listar(ctxA, { ate: 50 });
    expect(todos.total).toBe(2);
    expect(todos.itens.map((x) => x.titulo)).toEqual(['F57S Laudo central', 'F57S Compra conjunta']);
    expect((await porta.listar(ctxA, { ate: 1 })).itens).toHaveLength(1);
    expect((await porta.listar(ctxA, { ate: 1 })).total).toBe(2);
    expect((await porta.listar(ctxA, { ate: 50, area: 'laudos' })).itens.map((x) => x.titulo)).toEqual([
      'F57S Laudo central',
    ]);
    expect((await porta.listar(ctxA, { ate: 50, busca: 'SERINGAS' })).itens.map((x) => x.titulo)).toEqual([
      'F57S Compra conjunta',
    ]);
    expect((await porta.listar(ctxA, { ate: 50, busca: '%' })).total).toBe(0);
    expect((await porta.listar(ctxA, { ate: 50, situacao: 'adotada' })).total).toBe(0);
    expect((await porta.listar(ctxB, { ate: 50 })).itens.map((x) => x.titulo)).toEqual(['F57S Laudo em B']);
  });

  it('altera só o que mudou; repetir não grava; tira e devolve um envolvido', async () => {
    const [reg] = (await porta.listar(ctxA, { ate: 50, area: 'compras' })).itens;
    const r1 = await porta.alterar(
      ctxA,
      reg!.id,
      { situacao: 'em_estudo', estabelecimentos: [EST_A] },
      LOGIN,
      trilha(m.estA, 'x'),
    );
    expect(r1?.mudou).toBe(true);
    expect(r1?.antes.estabelecimentos).toEqual([EST_A, EST_B]);
    expect(r1?.depois).toMatchObject({
      situacao: 'em_estudo',
      estabelecimentos: [EST_A],
      atualizadoPor: LOGIN,
    });
    expect(r1?.depois.atualizadoEm).not.toBeNull();
    const r2 = await porta.alterar(
      ctxA,
      reg!.id,
      { situacao: 'em_estudo', estabelecimentos: [EST_A] },
      LOGIN,
      trilha(m.estA, 'x'),
    );
    expect(r2).toMatchObject({ mudou: false });
    expect(r2?.depois).toEqual(r1?.depois);
    const r3 = await porta.alterar(
      ctxA,
      reg!.id,
      { estabelecimentos: [EST_B, EST_A] },
      LOGIN,
      trilha(m.estA, 'x'),
    );
    expect(r3?.depois.estabelecimentos).toEqual([EST_A, EST_B]);
    const [linhas] = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-f57s' }, (l) =>
      l.consultar<{ n: unknown; v: unknown }>(
        'SELECT COUNT(*) AS n, (SELECT versao FROM servico_compartilhado_rede WHERE id = ?) AS v FROM servico_compartilhado_rede_estabelecimento WHERE servico_compartilhado_rede_id = ?',
        [reg!.id, reg!.id],
      ),
    );
    // A linha do envolvido tirado foi reativada (não duplicada); o registro passou por duas alterações.
    expect(Number(linhas?.n)).toBe(2);
    expect(Number(linhas?.v)).toBe(3);
    expect(
      await porta.alterar(ctxB, reg!.id, { situacao: 'adotada' }, LOGIN, trilha(m.estB, 'x')),
    ).toBeNull();
  });

  it('a lista da Rede pelo serviço junta os dois estabelecimentos', async () => {
    const servico = new ServicoServicosRede(porta, {
      redeConfigurada: () => REDE,
      estabelecimentos: () => [
        { codigo: EST_A, nome: 'A' },
        { codigo: EST_B, nome: 'B' },
      ],
    });
    const l = await servico.listar(
      {
        ...ctxA,
        login: LOGIN,
        como: false,
        liberados: new Set([EST_A, EST_B]),
        trilha: () => {
          throw new Error('Nenhuma gravação neste teste.');
        },
      },
      esquemaConsultaServicosRede.parse({}),
    );
    expect(l.total).toBe(3);
    expect(l.foraDoAr).toEqual([]);
    expect(new Set(l.itens.map((x) => x.estabelecimento))).toEqual(new Set([EST_A, EST_B]));
  });
});
