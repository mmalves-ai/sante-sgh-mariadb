// Rateio do repasse por setor e custos do prestador no MariaDB real (cliente f22_o3; massa SINTÉTICA com o prefixo
// "C2111", nenhuma pessoa real), F8, 06-FAT linha 49. Contrato de efeito:
//   - o tipo de desconto fica em `tipo_desconto_repasse` (código repetido e forma sem padrão: 422 sem gravar); inativar
//     só marca `ativo`;
//   - o custo do prestador fica em `custo_profissional` (outro vigente do mesmo médico, tipo e descrição: 422);
//   - a regra de rateio fica em `regra_rateio_repasse` com os setores em `regra_rateio_repasse_setor` (centro de custo
//     tirado do setor); soma diferente de 100% e vigência cruzada: 422 sem gravar;
//   - ratear a apuração grava `apuracao_repasse_rateio_setor` por médico e setor (a regra do médico pela produção; a
//     do grupo, base custo, pelo custo descontado); ratear de novo não duplica; regra encerrada antes da competência
//     marca as linhas como excluídas (nada apagado) e deixa o médico pendente; apuração aprovada: 422;
//   - encerrar grava `vigencia_fim` e não estende.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaRateioCustoRepassePropria } from './rateio-custo-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'C2111';
const COMP = '2026-10-01';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  if (l) return Number(l.id);
  return e.inserir(ins, pi);
}

const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

async function recusa(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e);
  }
  return 'gravou';
}

describe.skipIf(SEM_BANCO)('rateio do repasse por setor e custo do prestador (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaRateioCustoRepassePropria;
  const ids = {
    est: 0,
    usuario: 0,
    profA: 0,
    profB: 0,
    grupo: 0,
    centro1: 0,
    centro2: 0,
    setor1: 0,
    setor2: 0,
    apuracao: 0,
    aprovada: 0,
    tipo: 0,
    custo: 0,
    regraA: 0,
  };
  const c = () => ({ cliente: CLIENTE, hospital: P, usuario: ids.usuario, correlacao: 't-c2111' });
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c2111' }, (l) => l.uma(sql, p));
  const contar = async (sql: string, p: unknown[]) => Number((await um(sql, p))?.['n'] ?? 0);
  const limpar = (e: Escritor) =>
    (async () => {
      const ap = 'SELECT id FROM apuracao_repasse WHERE estabelecimento_id = ?';
      await e.executar(`DELETE FROM apuracao_repasse_rateio_setor WHERE apuracao_repasse_id IN (${ap})`, [
        ids.est,
      ]);
      await e.executar(`DELETE FROM desconto_custo_repasse WHERE apuracao_repasse_id IN (${ap})`, [ids.est]);
      await e.executar(`DELETE FROM apuracao_repasse_item WHERE apuracao_repasse_id IN (${ap})`, [ids.est]);
      await e.executar('DELETE FROM apuracao_repasse WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar(
        'DELETE FROM regra_rateio_repasse_setor WHERE regra_rateio_repasse_id IN (SELECT id FROM regra_rateio_repasse WHERE estabelecimento_id = ?)',
        [ids.est],
      );
      await limparTrilhaDaMassa(e, { ids: [ids.est] });
      await e.executar('DELETE FROM regra_rateio_repasse WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM custo_profissional WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM grupo_repasse_profissional WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar("DELETE FROM tipo_desconto_repasse WHERE codigo LIKE 'C2111%'", []);
    })();

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    porta = new PortaRateioCustoRepassePropria(nucleo, CLIENTE);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2111' }, async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [P],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [P, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, agora],
      );
      await limpar(e);
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['c2111.analista'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['c2111.analista', 'USUARIO SINTETICO C2111', agora],
      );
      const medico = async (n: string) => {
        const pf = await garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [`MEDICO SINTETICO ${P} ${n}`],
          'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
          [`MEDICO SINTETICO ${P} ${n}`, agora],
        );
        return garantir(
          e,
          'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
          [pf],
          "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
          [pf, agora],
        );
      };
      ids.profA = await medico('A');
      ids.profB = await medico('B');
      const centro = (n: string) =>
        garantir(
          e,
          'SELECT id FROM centro_custo WHERE estabelecimento_id = ? AND codigo = ?',
          [ids.est, `${P}-CC${n}`],
          `INSERT INTO centro_custo (estabelecimento_id, codigo, nome, sigla, vigencia_inicio, ativo, criado_em)
           VALUES (?, ?, ?, ?, '2025-01-01', TRUE, ?)`,
          [ids.est, `${P}-CC${n}`, `CENTRO SINTETICO C2111 ${n}`, `C1${n}`, agora],
        );
      ids.centro1 = await centro('1');
      ids.centro2 = await centro('2');
      const setor = (n: string, cc: number) =>
        garantir(
          e,
          'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = ?',
          [ids.est, `${P}-S${n}`],
          `INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, centro_custo_id, criado_em)
           VALUES (?, ?, ?, 'assistencial', ?, ?)`,
          [ids.est, `${P}-S${n}`, `SETOR SINTETICO C2111 ${n}`, cc, agora],
        );
      ids.setor1 = await setor('1', ids.centro1);
      ids.setor2 = await setor('2', ids.centro2);
      ids.grupo = await garantir(
        e,
        'SELECT id FROM grupo_repasse WHERE codigo = ?',
        [`${P}-G`],
        "INSERT INTO grupo_repasse (codigo, descricao, criado_em) VALUES (?, 'GRUPO SINTETICO C2111', ?)",
        [`${P}-G`, agora],
      );
      await e.inserir(
        `INSERT INTO grupo_repasse_profissional (grupo_repasse_id, profissional_id, estabelecimento_id, vigencia_inicio, criado_em)
         VALUES (?, ?, ?, '2026-01-01', ?)`,
        [ids.grupo, ids.profB, ids.est, agora],
      );
      const apuracao = (numero: string, situacao: string) =>
        e.inserir(
          `INSERT INTO apuracao_repasse (estabelecimento_id, numero, competencia, tipo_apuracao, iniciada_em, iniciada_por_usuario_id,
             valor_faturado, valor_bruto, valor_liquido, situacao, concluida_em, aprovada_em, criado_em)
           VALUES (?, ?, ?, 'producao', ?, ?, 9000, 7000, 7000, ?, ?, ?, ?)`,
          [
            ids.est,
            numero,
            COMP,
            agora,
            ids.usuario,
            situacao,
            agora,
            situacao === 'aprovada' ? agora : null,
            agora,
          ],
        );
      ids.apuracao = await apuracao(`${P}-1`, 'apurada');
      ids.aprovada = await apuracao(`${P}-2`, 'aprovada');
      for (const a of [ids.apuracao, ids.aprovada]) {
        await e.inserir(
          `INSERT INTO apuracao_repasse_item (apuracao_repasse_id, sequencia, profissional_id, competencia_producao,
             valor_faturado, percentual_repasse, valor_repasse, criado_em) VALUES (?, 1, ?, ?, 8000, 75, 6000, ?)`,
          [a, ids.profA, COMP, agora],
        );
        await e.inserir(
          `INSERT INTO apuracao_repasse_item (apuracao_repasse_id, sequencia, profissional_id, competencia_producao,
             valor_faturado, percentual_repasse, valor_repasse, criado_em) VALUES (?, 2, ?, ?, 1000, 100, 1000, ?)`,
          [a, ids.profB, COMP, agora],
        );
      }
    });
  });

  afterAll(async () => {
    if (ids.est)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2111' }, async (e) => {
        await limpar(e);
      });
    await nucleo.encerrar();
  });

  it('grava o tipo de desconto, recusa o código repetido e a forma sem padrão, e inativa sem apagar', async () => {
    const t = await porta.incluirTipo(c(), {
      codigo: `${P}-SALA`,
      descricao: 'USO DE SALA C2111',
      natureza: 'custo',
    });
    ids.tipo = t.id;
    const linha = await um(
      'SELECT natureza, forma_calculo, ativo, criado_por FROM tipo_desconto_repasse WHERE id = ?',
      [t.id],
    );
    expect(linha?.['natureza']).toBe('custo');
    expect(linha?.['forma_calculo']).toBe('informado');
    expect(Number(linha?.['criado_por'])).toBe(ids.usuario);
    expect(
      await recusa(porta.incluirTipo(c(), { codigo: `${P}-SALA`, descricao: 'OUTRO', natureza: 'taxa' })),
    ).toBe('regra-violada');
    expect(
      await recusa(
        porta.incluirTipo(c(), {
          codigo: `${P}-FIX`,
          descricao: 'FIXO',
          natureza: 'taxa',
          forma: 'valor_fixo',
        }),
      ),
    ).toBe('regra-violada');
    expect(
      await contar("SELECT COUNT(*) AS n FROM tipo_desconto_repasse WHERE codigo LIKE 'C2111%'", []),
    ).toBe(1);
    const inativo = await porta.incluirTipo(c(), {
      codigo: `${P}-OFF`,
      descricao: 'INATIVO C2111',
      natureza: 'taxa',
    });
    await porta.situacaoTipo(c(), inativo.id, { versao: 1, ativo: false });
    expect(
      Number((await um('SELECT ativo FROM tipo_desconto_repasse WHERE id = ?', [inativo.id]))?.['ativo']),
    ).toBe(0);
    expect(
      await recusa(
        porta.incluirCusto(c(), {
          profissional: ids.profB,
          tipo: inativo.id,
          descricao: 'SALA',
          forma: 'valor',
          valor: 300,
          inicio: '2026-01-01',
        }),
      ),
    ).toBe('regra-violada');
  });

  it('grava o custo do prestador e recusa o que cruza outro vigente', async () => {
    const r = await porta.incluirCusto(c(), {
      profissional: ids.profB,
      tipo: ids.tipo,
      centroCusto: ids.centro2,
      descricao: 'SALA',
      forma: 'valor',
      valor: 300,
      inicio: '2026-01-01',
    });
    ids.custo = r.id;
    const linha = await um(
      'SELECT forma_calculo, valor, percentual, frequencia, centro_custo_id, vigencia_fim FROM custo_profissional WHERE id = ?',
      [r.id],
    );
    expect(linha?.['forma_calculo']).toBe('valor');
    expect(Number(linha?.['valor'])).toBe(300);
    expect(linha?.['percentual']).toBeNull();
    expect(linha?.['frequencia']).toBe('mensal');
    expect(Number(linha?.['centro_custo_id'])).toBe(ids.centro2);
    expect(
      await recusa(
        porta.incluirCusto(c(), {
          profissional: ids.profB,
          tipo: ids.tipo,
          descricao: 'SALA',
          forma: 'percentual',
          percentual: 2,
          inicio: '2026-06-01',
        }),
      ),
    ).toBe('regra-violada');
    expect(
      await contar('SELECT COUNT(*) AS n FROM custo_profissional WHERE estabelecimento_id = ?', [ids.est]),
    ).toBe(1);
    // O desconto do custo na apuração vem do lançamento da remuneração variável (C2-083); aqui, o já lançado.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2111' }, (e) =>
      e.inserir(
        `INSERT INTO desconto_custo_repasse (apuracao_repasse_id, sequencia, custo_profissional_id, tipo_desconto_repasse_id,
           competencia, valor, criado_em) VALUES (?, 1, ?, ?, ?, 300, ?)`,
        [ids.apuracao, ids.custo, ids.tipo, COMP, new Date()],
      ),
    );
  });

  it('grava a regra de rateio com os setores e recusa soma diferente de 100% e vigência cruzada', async () => {
    const r = await porta.incluirRegra(c(), {
      descricao: 'RATEIO CENTRO CIRURGICO',
      profissional: ids.profA,
      inicio: '2026-01-01',
      setores: [
        { setor: ids.setor1, percentual: 60 },
        { setor: ids.setor2, percentual: 40 },
      ],
    });
    ids.regraA = r.id;
    expect(
      (await um('SELECT base_rateio, grupo_repasse_id FROM regra_rateio_repasse WHERE id = ?', [r.id]))?.[
        'base_rateio'
      ],
    ).toBe('repasse');
    const s2 = await um(
      'SELECT centro_custo_id, percentual FROM regra_rateio_repasse_setor WHERE regra_rateio_repasse_id = ? AND sequencia = 2',
      [r.id],
    );
    expect(Number(s2?.['centro_custo_id'])).toBe(ids.centro2);
    expect(Number(s2?.['percentual'])).toBe(40);
    expect(
      await recusa(
        porta.incluirRegra(c(), {
          descricao: 'SOMA ERRADA',
          grupoRepasse: ids.grupo,
          inicio: '2026-01-01',
          setores: [{ setor: ids.setor1, percentual: 90 }],
        }),
      ),
    ).toBe('regra-violada');
    expect(
      await recusa(
        porta.incluirRegra(c(), {
          descricao: 'CRUZA',
          profissional: ids.profA,
          inicio: '2026-06-01',
          setores: [{ setor: ids.setor1, percentual: 100 }],
        }),
      ),
    ).toBe('regra-violada');
    await porta.incluirRegra(c(), {
      descricao: 'RATEIO DO CUSTO DO GRUPO',
      grupoRepasse: ids.grupo,
      base: 'custo',
      inicio: '2026-01-01',
      setores: [{ setor: ids.setor2, percentual: 100 }],
    });
    expect(
      await contar('SELECT COUNT(*) AS n FROM regra_rateio_repasse WHERE estabelecimento_id = ?', [ids.est]),
    ).toBe(2);
    const painel = await porta.painel(c(), ids.profB);
    expect(painel.regras.map((x) => x.base)).toEqual(['custo']);
    expect(painel.custos).toHaveLength(1);
    expect(painel.apuracoes.map((x) => x.situacao).sort()).toEqual(['aprovada', 'apurada']);
    expect(painel.setores.map((x) => x.centroCusto)).toEqual([ids.centro1, ids.centro2]);
  });

  it('rateia a apuração por médico e setor, sem duplicar, e marca como excluída a linha que deixou de valer', async () => {
    const r = await porta.ratear(c(), { apuracao: ids.apuracao });
    expect(r).toMatchObject({ gravadas: 3, excluidas: 0, pendencias: [] });
    const valor = async (prof: number, setor: number) =>
      Number(
        (
          await um(
            'SELECT valor_rateio FROM apuracao_repasse_rateio_setor WHERE apuracao_repasse_id = ? AND profissional_id = ? AND setor_funcional_id = ? AND excluido_em IS NULL',
            [ids.apuracao, prof, setor],
          )
        )?.['valor_rateio'],
      );
    expect(await valor(ids.profA, ids.setor1)).toBe(3600);
    expect(await valor(ids.profA, ids.setor2)).toBe(2400);
    expect(await valor(ids.profB, ids.setor2)).toBe(300);
    expect(await porta.ratear(c(), { apuracao: ids.apuracao })).toMatchObject({ gravadas: 0, excluidas: 0 });
    const n = 'SELECT COUNT(*) AS n FROM apuracao_repasse_rateio_setor WHERE apuracao_repasse_id = ?';
    expect(await contar(n, [ids.apuracao])).toBe(3);
    const visto = await porta.rateioDaApuracao(c(), ids.apuracao);
    expect(visto.totaisPorSetor.map((x) => x.valor)).toEqual([3600, 2700]);
    expect(visto.simulado).toHaveLength(3);

    // Encerrar não estende; encerrada antes da competência, a regra do médico A deixa de valer.
    expect(await recusa(porta.encerrar(c(), 'rateio', ids.regraA, { versao: 1, fim: '2025-12-31' }))).toBe(
      'regra-violada',
    );
    await porta.encerrar(c(), 'rateio', ids.regraA, { versao: 1, fim: '2026-09-30' });
    expect(
      dia(
        (await um('SELECT vigencia_fim FROM regra_rateio_repasse WHERE id = ?', [ids.regraA]))?.[
          'vigencia_fim'
        ],
      ),
    ).toBe('2026-09-30');
    const r2 = await porta.ratear(c(), { apuracao: ids.apuracao });
    expect(r2).toMatchObject({ gravadas: 0, excluidas: 2 });
    expect(r2.pendencias).toEqual([{ profissional: ids.profA, motivo: 'sem-regra' }]);
    expect(await contar(n, [ids.apuracao])).toBe(3);
    expect(
      await contar(`${n} AND excluido_em IS NOT NULL AND excluido_por = ?`, [ids.apuracao, ids.usuario]),
    ).toBe(2);

    expect(await recusa(porta.ratear(c(), { apuracao: ids.aprovada }))).toBe('regra-violada');
    expect(await contar(n, [ids.aprovada])).toBe(0);
  });

  it('encerra o custo do prestador sem apagar', async () => {
    await porta.encerrar(c(), 'custo', ids.custo, { versao: 1, fim: '2026-12-31' });
    expect(
      dia(
        (await um('SELECT vigencia_fim FROM custo_profissional WHERE id = ?', [ids.custo]))?.['vigencia_fim'],
      ),
    ).toBe('2026-12-31');
  });
});
