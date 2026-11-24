// Contrato de efeito do PEDIDO DE ACESSO no banco próprio (01-ADM L57), no MariaDB real (cliente f22_o2, massa
// sintética "l57p"): pedir grava o pedido numerado e o item do perfil; o 1º nível grava o aprovador do setor; o 2º
// nível, por outra pessoa, aprova, concede o perfil (usuario_perfil) e anota a concessão na mesma transação; a recusa
// e o cancelamento gravam quem fechou e o motivo; o pedido aprovado sem concessão recebe a concessão depois; e as
// recusas (pedido repetido, decidir o próprio, o mesmo aprovador nos dois níveis, cancelar o de outro, setor e perfil
// inexistentes, aprovado não se cancela) não deixam linha. Nada se apaga: as decisões ficam na linha do pedido, com a
// trilha. A migração 02_ADM/97 é aplicada antes (idempotente). Só ids e códigos sintéticos; nenhum dado real.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { fonteGestaoPropria } from './gestao-fonte-propria.js';
import type { FonteGestao } from './gestao-fonte.js';
import type { TrilhaGestao } from './gestao-tipos.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'l57pe';
const SOL = 'teste.l57p.sol';
const G1 = 'teste.l57p.g1';
const G2 = 'teste.l57p.g2';
const PERFIL = 'l57p-perfil';
const PERFIL2 = 'l57p-perfil2';
const PERFIL3 = 'l57p-perfil3';
const BLOCO = 'L57PB';
const RAIZ = resolve(import.meta.dirname, '../../../../..');
const MIGRACOES = [
  'db/migracoes/02_ADM/97_pedido_acesso_dois_niveis_tabelas.sql',
  'db/migracoes/02_ADM/97_pedido_acesso_dois_niveis_chaves.sql',
];
const hoje = (): string => new Date().toISOString().slice(0, 10);
const daqui = (dias: number): string => new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);

const codigo = (p: Promise<unknown>) =>
  p.then(
    () => 'gravou',
    (e: unknown) => (e instanceof ErroOperacao ? String(e.problema.codigo ?? '') : `outro: ${String(e)}`),
  );

describe.skipIf(SEM_BANCO)('pedido de acesso no banco próprio (MariaDB, cliente f22_o2)', () => {
  const nucleo = new NucleoProprio();
  let fonte: FonteGestao;
  const ids = { est: 0, sol: 0 };
  const trilha = (usuario: string): TrilhaGestao => ({
    evento: 'acesso.pedido',
    rede: 'teste',
    hospital: EST,
    usuario,
    estacao: 'teste:l57p',
    correlacao: `teste-l57p-${randomUUID()}`.slice(0, 64),
    recurso: 'acesso.pedido',
    resultado: 'sucesso',
  });
  const ler = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l57p-conferir' }, (l) => l.uma(sql, p));
  const contar = async (sql: string, p: unknown[]) => Number((await ler(sql, p))?.['n'] ?? -1);
  const pedidos = () =>
    contar('SELECT COUNT(*) AS n FROM pedido_acesso WHERE estabelecimento_id = ?', [ids.est]);
  const pedir = (perfil: string, motivo = 'Cobertura do plantão noturno do setor') =>
    fonte.pedirAcesso(
      'teste',
      EST,
      {
        hospital: EST,
        login: SOL,
        perfil,
        setor: BLOCO,
        inicio: hoje(),
        fim: daqui(30),
        motivo,
        hoje: hoje(),
      },
      trilha(SOL),
    );
  const decidir = (
    pedido: string,
    por: string,
    decisao: 'aprovar' | 'recusar',
    conceder = false,
    motivo = '',
  ) =>
    fonte.decidirPedidoAcesso(
      'teste',
      EST,
      { hospital: EST, pedido, decisao, motivo, por },
      trilha(por),
      () => null,
      conceder
        ? {
            concessao: {
              idUsuario: ids.sol,
              login: SOL,
              perfil: PERFIL,
              concedidoPor: por,
              areaAprovou: BLOCO,
              inicio: new Date(`${hoje()}T00:00:00Z`),
              fim: new Date(`${daqui(30)}T00:00:00Z`),
              motivo: `Pedido de acesso ${pedido}`,
            },
            trilhaConcessao: trilha(por),
            trilhaAnotacao: trilha(por),
          }
        : undefined,
    );

  async function limpar() {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-l57p' }, async (e) => {
      const est = await e.uma<{ id: number }>('SELECT id FROM estabelecimento WHERE codigo = ?', [EST]);
      if (!est) return;
      await e.executar(
        'DELETE i FROM pedido_acesso_item i JOIN pedido_acesso pa ON pa.id = i.pedido_acesso_id WHERE pa.estabelecimento_id = ?',
        [est.id],
      );
      await e.executar('DELETE FROM pedido_acesso WHERE estabelecimento_id = ?', [est.id]);
      await e.executar('DELETE FROM usuario_perfil WHERE estabelecimento_id = ?', [est.id]);
      await limparTrilhaDaMassa(e, { codigos: [EST] });
    });
  }

  beforeAll(async () => {
    const banco = (await nucleo.cliente(CLIENTE)).banco;
    for (const m of MIGRACOES)
      execFileSync('sh', [resolve(RAIZ, 'tools/db/sql.sh'), banco], {
        input: readFileSync(resolve(RAIZ, m), 'utf8'),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    await limpar();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-l57p' }, async (e) => {
      const agora = new Date();
      const g = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
        const l = await e.uma<{ id: number }>(sel, p);
        return l ? Number(l.id) : e.inserir(ins, pi);
      };
      ids.est = await g(
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [EST],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [EST, 'Hospital sintético l57p', 'Hospital sintético l57p (fictício)', agora],
      );
      for (const login of [SOL, G1, G2]) {
        const u = await g(
          'SELECT id FROM usuario WHERE login = ?',
          [login],
          'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
          [login, `USUARIO SINTETICO ${login.toUpperCase()}`, agora],
        );
        if (login === SOL) ids.sol = u;
        await g(
          'SELECT id FROM usuario_estabelecimento WHERE usuario_id = ? AND estabelecimento_id = ?',
          [u, ids.est],
          'INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
          [u, ids.est, '2026-01-01', agora],
        );
      }
      for (const p of [PERFIL, PERFIL2, PERFIL3])
        await g(
          'SELECT id FROM perfil_acesso WHERE codigo = ? AND estabelecimento_id = ?',
          [p, ids.est],
          'INSERT INTO perfil_acesso (estabelecimento_id, codigo, nome, criado_em) VALUES (?, ?, ?, ?)',
          [ids.est, p, `Perfil sintético ${p}`, agora],
        );
      await g(
        'SELECT id FROM bloco_internacao WHERE codigo = ? AND estabelecimento_id = ?',
        [BLOCO, ids.est],
        'INSERT INTO bloco_internacao (estabelecimento_id, codigo, nome, criado_em) VALUES (?, ?, ?, ?)',
        [ids.est, BLOCO, 'Bloco sintético l57p', agora],
      );
    });
    fonte = fonteGestaoPropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    await limpar();
    await nucleo.encerrar();
  });

  it('pedir grava o pedido numerado, o item do perfil e o setor; o repetido e os inexistentes são recusados', async () => {
    const { id } = await pedir(PERFIL);
    const x = await ler(
      `SELECT pa.numero, pa.tipo, pa.situacao, pa.usuario_id, pa.solicitante_usuario_id, b.codigo AS bloco,
              i.tipo_item, i.decisao, pf.codigo AS perfil
         FROM pedido_acesso pa JOIN bloco_internacao b ON b.id = pa.bloco_internacao_id
         JOIN pedido_acesso_item i ON i.pedido_acesso_id = pa.id JOIN perfil_acesso pf ON pf.id = i.perfil_acesso_id
        WHERE pa.id = ?`,
      [id],
    );
    expect(x).toMatchObject({
      tipo: 'ampliacao',
      situacao: 'enviado',
      bloco: BLOCO,
      tipo_item: 'perfil',
      decisao: 'pendente',
      perfil: PERFIL,
    });
    expect(String(x?.['numero'])).toMatch(/^PA-\d+$/);
    expect(Number(x?.['usuario_id'])).toBe(ids.sol);
    expect(Number(x?.['solicitante_usuario_id'])).toBe(ids.sol);
    const lido = await fonte.pedidoAcesso('teste', EST, id);
    expect(lido).toMatchObject({
      login: SOL,
      perfil: PERFIL,
      setor: BLOCO,
      situacao: 'pendente',
      inicio: hoje(),
    });
    expect(
      (await fonte.pedidosAcesso('teste', EST, { login: SOL, situacoes: ['pendente'] })).map((p) => p.id),
    ).toContain(id);
    const antes = await pedidos();
    expect(await codigo(pedir(PERFIL))).toBe('pedido-repetido');
    expect(await codigo(pedir('l57p-nao-existe'))).toBe('perfil-inexistente');
    expect(
      await codigo(
        fonte.pedirAcesso(
          'teste',
          EST,
          {
            hospital: EST,
            login: SOL,
            perfil: PERFIL2,
            setor: 'NADA',
            inicio: hoje(),
            fim: daqui(3),
            motivo: 'Motivo suficiente aqui',
            hoje: hoje(),
          },
          trilha(SOL),
        ),
      ),
    ).toBe('setor-inexistente');
    expect(await codigo(pedir(PERFIL2, 'curto'))).toBe('motivo-curto');
    expect(await pedidos()).toBe(antes);
    // A trilha do pedido gravado.
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'pedido_acesso' AND entidade_id = ?",
        [id],
      ),
    ).toBeGreaterThanOrEqual(1);
  });

  it('dois níveis por pessoas diferentes: o 2º aprova, concede o perfil e anota a concessão na mesma transação', async () => {
    const [p] = await fonte.pedidosAcesso('teste', EST, { login: SOL, situacoes: ['pendente'] });
    const id = p!.id;
    expect(await codigo(decidir(id, SOL, 'aprovar'))).toBe('decidir-a-si');
    expect(await decidir(id, G1, 'aprovar')).toMatchObject({
      anterior: 'pendente',
      situacao: 'aprovado-setor',
    });
    expect(await codigo(decidir(id, G1, 'aprovar', true))).toBe('mesmo-aprovador');
    const d = await decidir(id, G2, 'aprovar', true);
    expect(d).toMatchObject({ anterior: 'aprovado-setor', situacao: 'concedido' });
    const x = await ler(
      `SELECT pa.situacao, pa.usuario_perfil_id, pa.executado_em IS NOT NULL AS executado, s.login AS setor_por,
              a.login AS acessos_por, i.decisao, up.usuario_id, up.vigencia_fim
         FROM pedido_acesso pa JOIN usuario s ON s.id = pa.aprovado_setor_por_usuario_id
         JOIN usuario a ON a.id = pa.aprovado_acessos_por_usuario_id
         JOIN pedido_acesso_item i ON i.pedido_acesso_id = pa.id
         JOIN usuario_perfil up ON up.id = pa.usuario_perfil_id WHERE pa.id = ?`,
      [id],
    );
    expect(x).toMatchObject({ situacao: 'executado', setor_por: G1, acessos_por: G2, decisao: 'aprovado' });
    expect(Number(x?.['executado'])).toBe(1);
    expect(String(x?.['usuario_perfil_id'])).toBe(d.concessao);
    expect(Number(x?.['usuario_id'])).toBe(ids.sol);
    expect((await fonte.pedidoAcesso('teste', EST, id))?.situacao).toBe('concedido');
    // Concedido não se decide nem se cancela.
    expect(await codigo(decidir(id, G1, 'aprovar'))).toBe('pedido-fechado');
    expect(
      await codigo(fonte.cancelarPedidoAcesso('teste', EST, id, 'Não preciso mais disso', SOL, trilha(SOL))),
    ).toBe('pedido-fechado');
  });

  it('aprovado sem concessão recebe a concessão depois; aprovado não se cancela', async () => {
    const { id } = await pedir(PERFIL2);
    await decidir(id, G1, 'aprovar');
    expect(await decidir(id, G2, 'aprovar')).toMatchObject({ situacao: 'aprovado', concessao: null });
    expect(
      await codigo(fonte.cancelarPedidoAcesso('teste', EST, id, 'Não preciso mais disso', SOL, trilha(SOL))),
    ).toBe('pedido-aprovado');
    const r = await fonte.concederPedidoAprovado('teste', EST, id, {
      concessao: {
        idUsuario: ids.sol,
        login: SOL,
        perfil: PERFIL2,
        concedidoPor: G2,
        areaAprovou: BLOCO,
        inicio: null,
        fim: null,
        motivo: `Pedido de acesso ${id}`,
      },
      trilhaConcessao: trilha(G2),
      trilhaAnotacao: trilha(G2),
    });
    const x = await ler('SELECT situacao, usuario_perfil_id FROM pedido_acesso WHERE id = ?', [id]);
    expect(x?.['situacao']).toBe('executado');
    expect(String(x?.['usuario_perfil_id'])).toBe(r.concessao);
  });

  it('recusa e cancelamento gravam quem fechou e o motivo; só quem pediu cancela', async () => {
    const { id } = await pedir(PERFIL3);
    expect(await codigo(decidir(id, G1, 'recusar', false, 'curto'))).toBe('motivo-curto');
    expect(await decidir(id, G1, 'recusar', false, 'Perfil incompatível com a função')).toMatchObject({
      situacao: 'recusado',
    });
    const r = await ler(
      `SELECT pa.situacao, f.login AS fechado_por, pa.motivo_fechamento IS NOT NULL AS com_motivo, i.decisao
         FROM pedido_acesso pa JOIN usuario f ON f.id = pa.fechado_por_usuario_id
         JOIN pedido_acesso_item i ON i.pedido_acesso_id = pa.id WHERE pa.id = ?`,
      [id],
    );
    expect(r).toMatchObject({ situacao: 'reprovado', fechado_por: G1, decisao: 'reprovado' });
    expect(Number(r?.['com_motivo'])).toBe(1);
    // Recusado, pode pedir de novo; o novo é cancelado por quem pediu.
    const { id: novo } = await pedir(PERFIL3);
    expect(
      await codigo(
        fonte.cancelarPedidoAcesso('teste', EST, novo, 'Cancelado por outra pessoa', G1, trilha(G1)),
      ),
    ).toBe('cancelar-de-outro');
    expect(
      await fonte.cancelarPedidoAcesso('teste', EST, novo, 'Não preciso mais disso', SOL, trilha(SOL)),
    ).toMatchObject({
      anterior: 'pendente',
    });
    const c = await ler('SELECT situacao, fechado_por_usuario_id FROM pedido_acesso WHERE id = ?', [novo]);
    expect(c?.['situacao']).toBe('cancelado');
    expect(Number(c?.['fechado_por_usuario_id'])).toBe(ids.sol);
    // Nada se apaga: os quatro pedidos da massa seguem no banco.
    expect(await pedidos()).toBe(4);
  });
});
