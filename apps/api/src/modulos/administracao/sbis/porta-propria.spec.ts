// Unidade da porta própria da certificação SBIS sobre o banco dublê do núcleo (packages/nucleo, duble-banco): o SQL e os
// parâmetros das gravações de ciclo (que o teste de integração só roda quando o DDL de ciclo_certificacao e
// ciclo_certificacao_item existir), as tabelas declaradas, a trilha e a idempotência na mesma transação, e as recusas:
// a recusa apurada dentro da transação desfaz tudo (nem trilha nem idempotência), o conflito de versão chega com o
// código do núcleo e o reenvio com a mesma Idempotency-Key não grava de novo. Dados sintéticos.
import { REQUISITOS_SBIS } from '@sgh/contratos';
import { ErroOperacao, Executor, lerSomente } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import { BancoDuble, CONFIG_TESTE } from '@sgh/nucleo/duble-banco';
import type { TrilhaSbis } from './porta.js';
import { type NucleoSbis, PortaSbisPropria } from './porta-propria.js';

const EST = 7;
const USU = 3;
const OUTRO = 4;

function montar(usuario = USU) {
  const b = new BancoDuble();
  b.quando(/SELECT e\.id AS est/, [{ est: EST, usuario }]);
  const fonte = b.fonte();
  const nucleo: NucleoSbis = {
    lerSomente: (ctx, fn) => lerSomente(fonte, CONFIG_TESTE, ctx, fn),
    criarExecutor: () => new Executor(b.dependencias()),
  };
  return { b, porta: new PortaSbisPropria(nucleo, fonte.cliente) };
}

const trilha = (operacao: string, chave: string | null = `chave-${operacao}-0001`): TrilhaSbis => ({
  rede: '',
  hospital: 'h1',
  usuario: 'SINT.AUDITOR',
  evento: 'teste.sbis',
  recurso: 'auditoria.sbis',
  operacao,
  resultado: 'sucesso',
  estacao: null,
  correlacao: `unidade-${operacao}`,
  chaveIdempotencia: chave,
});

/** Nada gravado: nenhuma escrita, nem trilha nem idempotência, e a transação desfeita. */
function nadaGravado(b: BancoDuble) {
  expect(b.que(/^\s*(INSERT|UPDATE|DELETE)\b/i)).toEqual([]);
  expect(b.estados).toContain('desfazer');
  expect(b.estados).not.toContain('confirmar');
}

const ITEM = /FROM ciclo_certificacao_item i\s+JOIN ciclo_certificacao c/;
const CICLO = /SELECT id, versao FROM ciclo_certificacao\s/;
const requisitos = REQUISITOS_SBIS.slice(0, 2).map((r) => r.codigo);
const novo = {
  tipo: 'autoavaliacao' as const,
  competencia: '2026-11',
  versao: '1.0.0',
  referencia: 'Manual sintético',
  avaliador: null,
  por: 'SINT.AUDITOR',
  requisitos,
};

describe('PortaSbisPropria sobre o dublê do núcleo', () => {
  it('abrir: ciclo e itens (tabelas declaradas), trilha e idempotência pela chave do pedido, na mesma transação', async () => {
    const { b, porta } = montar();
    const r = await porta.abrir('h1', novo, trilha('abrir'));
    expect(r).toEqual({ id: '100' });
    const [aberto] = b.que(/FROM ciclo_certificacao\s+WHERE estabelecimento_id = \? AND tipo = \?/);
    expect(aberto?.parametros).toEqual([EST, 'autoavaliacao']);
    expect(aberto?.sql).toMatch(/FOR UPDATE/);
    const [ciclo] = b.que(/^INSERT INTO ciclo_certificacao \(/);
    expect(ciclo?.parametros).toEqual(
      expect.arrayContaining([EST, 'autoavaliacao', '2026-11', '1.0.0', 'aberto', USU]),
    );
    const itens = b.que(/^INSERT INTO ciclo_certificacao_item \(/);
    expect(itens).toHaveLength(requisitos.length);
    for (const [n, i] of itens.entries())
      expect(i.parametros).toEqual(expect.arrayContaining([100, requisitos[n], 'pendente']));
    const [t] = b.que(/^INSERT INTO trilha_auditoria/);
    expect(t?.parametros).toEqual(
      expect.arrayContaining([EST, USU, 'ciclo_certificacao', 100, 'unidade-abrir']),
    );
    expect(String(t?.parametros[7])).toContain('"evento":"teste.sbis"');
    const [idem] = b.que(/^INSERT INTO idempotencia_operacao/);
    expect(idem?.parametros.slice(0, 4)).toEqual([
      'auditoria.sbis.abrir-ciclo',
      'chave-abrir-0001',
      EST,
      USU,
    ]);
    expect(b.estados).toContain('confirmar');
  });

  it('abrir com ciclo aberto do tipo: null, sem trilha', async () => {
    const { b, porta } = montar();
    b.quando(/FROM ciclo_certificacao\s+WHERE estabelecimento_id = \? AND tipo = \?/, [{ id: 9 }]);
    expect(await porta.abrir('h1', novo, trilha('abrir'))).toBeNull();
    nadaGravado(b);
  });

  it('avaliar: o item do ciclo aberto do estabelecimento, travado, gravado pela versão', async () => {
    const { b, porta } = montar();
    b.quando(ITEM, [
      { id: 11, versao: 2, resultado: 'pendente', situacao_correcao: null, corrigido_por_usuario_id: null },
    ]);
    const ok = await porta.avaliar(
      'h1',
      {
        idCiclo: '5',
        requisito: 'R1',
        por: 'SINT.AUDITOR',
        pedido: { resultado: 'nao-conforme', severidade: 'bloqueante', origem: 'defeito' },
      },
      trilha('avaliar'),
    );
    expect(ok).toBe(true);
    const [trava] = b.que(ITEM);
    expect(trava?.parametros).toEqual([5, EST, 'R1']);
    expect(trava?.sql).toMatch(/c\.estabelecimento_id = \? AND c\.situacao = 'aberto'/);
    const [u] = b.que(/^UPDATE ciclo_certificacao_item SET/);
    expect(u?.sql).toMatch(/WHERE id = \? AND versao = \?$/);
    expect(u?.parametros.slice(-2)).toEqual([11, 2]);
    expect(u?.parametros).toEqual(
      expect.arrayContaining(['nao_conforme', 'bloqueante', 'defeito', 'aberta', USU]),
    );
    expect(b.que(/^INSERT INTO trilha_auditoria/)).toHaveLength(1);
  });

  it('avaliar: NC sem correção verificada, ou item de outro estabelecimento (não achado), é recusado sem trilha', async () => {
    for (const linhas of [
      [
        {
          id: 11,
          versao: 2,
          resultado: 'nao_conforme',
          situacao_correcao: 'corrigida',
          corrigido_por_usuario_id: USU,
        },
      ],
      [],
    ]) {
      const { b, porta } = montar();
      b.quando(ITEM, linhas);
      expect(
        await porta.avaliar(
          'h1',
          { idCiclo: '5', requisito: 'R1', por: 'x', pedido: { resultado: 'conforme' } },
          trilha('avaliar'),
        ),
      ).toBe(false);
      nadaGravado(b);
    }
  });

  it('avaliar: conflito de versão chega com o código do núcleo e desfaz', async () => {
    const { b, porta } = montar();
    b.quando(ITEM, [
      { id: 11, versao: 2, resultado: 'pendente', situacao_correcao: null, corrigido_por_usuario_id: null },
    ]);
    b.quando(/^UPDATE ciclo_certificacao_item/, { affectedRows: 0, insertId: 0 });
    b.quando(/^SELECT versao FROM ciclo_certificacao_item WHERE id = \?/, [{ versao: 3 }]);
    const e = await porta
      .avaliar(
        'h1',
        { idCiclo: '5', requisito: 'R1', por: 'x', pedido: { resultado: 'conforme' } },
        trilha('avaliar'),
      )
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroOperacao);
    expect((e as ErroOperacao).problema.codigo).toBe('conflito-versao');
    expect(b.que(/^INSERT INTO trilha_auditoria/)).toEqual([]);
    expect(b.estados).toContain('desfazer');
  });

  it('corrigir: só NC com correção aberta; verificar: nunca quem corrigiu', async () => {
    const corr = { idCiclo: '5', requisito: 'R1', por: 'x', descricao: 'Correção sintética' };
    const m1 = montar();
    m1.b.quando(ITEM, [
      {
        id: 11,
        versao: 2,
        resultado: 'nao_conforme',
        situacao_correcao: 'aberta',
        corrigido_por_usuario_id: null,
      },
    ]);
    expect(await m1.porta.corrigir('h1', corr, trilha('corrigir'))).toBe(true);
    expect(m1.b.que(/^UPDATE ciclo_certificacao_item/)[0]?.parametros).toEqual(
      expect.arrayContaining(['corrigida', 'Correção sintética', USU]),
    );
    const m2 = montar();
    m2.b.quando(ITEM, [
      { id: 11, versao: 2, resultado: 'conforme', situacao_correcao: null, corrigido_por_usuario_id: null },
    ]);
    expect(await m2.porta.corrigir('h1', corr, trilha('corrigir'))).toBe(false);
    nadaGravado(m2.b);
    const corrigido = [
      {
        id: 11,
        versao: 3,
        resultado: 'nao_conforme',
        situacao_correcao: 'corrigida',
        corrigido_por_usuario_id: USU,
      },
    ];
    const m3 = montar();
    m3.b.quando(ITEM, corrigido);
    expect(
      await m3.porta.verificar('h1', { idCiclo: '5', requisito: 'R1', por: 'x' }, trilha('verificar')),
    ).toBe(false);
    nadaGravado(m3.b);
    const m4 = montar(OUTRO);
    m4.b.quando(ITEM, corrigido);
    expect(
      await m4.porta.verificar('h1', { idCiclo: '5', requisito: 'R1', por: 'y' }, trilha('verificar')),
    ).toBe(true);
    expect(m4.b.que(/^UPDATE ciclo_certificacao_item/)[0]?.parametros).toEqual(
      expect.arrayContaining(['verificada', OUTRO]),
    );
  });

  it('concluir: pendente ou bloqueante sem verificação recusam sem trilha; senão grava o parecer', async () => {
    const pedido = {
      id: '5',
      parecer: 'apto' as const,
      parecerTexto: 'Parecer sintético',
      certificado: null,
      por: 'x',
    };
    for (const conta of [
      { pendentes: 1, bloqueantes: 0 },
      { pendentes: 0, bloqueantes: 1 },
    ]) {
      const { b, porta } = montar();
      b.quando(CICLO, [{ id: 5, versao: 4 }]);
      b.quando(/SUM\(resultado = 'pendente'\)/, [conta]);
      expect(await porta.concluir('h1', pedido, trilha('concluir'))).toBe(false);
      nadaGravado(b);
    }
    const { b, porta } = montar();
    b.quando(CICLO, [{ id: 5, versao: 4 }]);
    b.quando(/SUM\(resultado = 'pendente'\)/, [{ pendentes: 0, bloqueantes: 0 }]);
    expect(await porta.concluir('h1', pedido, trilha('concluir'))).toBe(true);
    expect(b.que(CICLO)[0]?.parametros).toEqual([5, EST]);
    const [u] = b.que(/^UPDATE ciclo_certificacao SET/);
    expect(u?.parametros).toEqual(expect.arrayContaining(['concluido', 'apto', 'Parecer sintético', USU]));
    expect(u?.parametros.slice(-2)).toEqual([5, 4]);
    expect(b.que(/^INSERT INTO trilha_auditoria/)[0]?.parametros).toEqual(
      expect.arrayContaining(['Parecer sintético']),
    );
  });

  it('cancelar: ciclo fechado ou de outro estabelecimento recusa sem trilha; aberto grava o motivo', async () => {
    const m1 = montar();
    expect(
      await m1.porta.cancelar('h1', { id: '5', motivo: 'Motivo sintético', por: 'x' }, trilha('cancelar')),
    ).toBe(false);
    nadaGravado(m1.b);
    const m2 = montar();
    m2.b.quando(CICLO, [{ id: 5, versao: 1 }]);
    expect(
      await m2.porta.cancelar('h1', { id: '5', motivo: 'Motivo sintético', por: 'x' }, trilha('cancelar')),
    ).toBe(true);
    expect(m2.b.que(/^UPDATE ciclo_certificacao SET/)[0]?.parametros).toEqual(
      expect.arrayContaining(['cancelado', 'Motivo sintético', USU]),
    );
  });

  it('restauração: o reenvio com a mesma chave devolve o mesmo id e não grava de novo', async () => {
    const { b, porta } = montar();
    const pedido = {
      tipo: 'diaria' as const,
      inicio: '2026-11-20T10:00:00.000Z',
      fim: '2026-11-20T10:30:00.000Z',
      resultado: 'ok' as const,
      integridade: 'ok' as const,
      ambiente: 'Ambiente sintético',
    };
    const t = trilha('registrar', 'chave-reenvio-0001');
    const primeiro = await porta.registrarRestauracao('h1', { por: 'x', pedido }, t);
    const [idem] = b.que(/^INSERT INTO idempotencia_operacao/);
    expect(idem?.parametros[1]).toBe('chave-reenvio-0001');
    b.quando(/FROM idempotencia_operacao WHERE operacao = \? AND chave = \?/, (p: readonly unknown[]) =>
      p[1] === 'chave-reenvio-0001'
        ? [
            {
              hash_entrada: idem?.parametros[4],
              usuario_id: USU,
              resultado: idem?.parametros[5],
              trilha_auditoria_id: 1,
            },
          ]
        : [],
    );
    const segundo = await porta.registrarRestauracao('h1', { por: 'x', pedido }, t);
    expect(segundo).toEqual(primeiro);
    expect(b.que(/^INSERT INTO verificacao_backup/)).toHaveLength(1);
    expect(b.que(/^INSERT INTO trilha_auditoria/)).toHaveLength(1);
  });
});
