// Favorecidos do repasse, prestadores terceiros e adiantamento ao profissional no MariaDB real (cliente f22_o3; massa
// SINTÉTICA com o prefixo "F3711", nenhuma pessoa real), F3.7, 06-FAT linha 46. Contrato de efeito:
//   - o favorecido incluído fica em `favorecido_repasse` com o tipo, o alvo, a parte e a vigência; o novo do mesmo tipo
//     encerra o anterior no dia de antes (as duas linhas ficam); a soma acima de 100%, o alvo de outro tipo e a conta
//     de outro credor são recusados sem gravar; encerrar grava `vigencia_fim` e nada é apagado;
//   - o prestador terceiro fica em `prestador_terceiro` com documento, CNES, percentual e base; código e documento
//     repetidos são recusados; inativar grava `ativo` e `inativado_em`;
//   - o extrato do profissional mostra o saldo a compensar dos adiantamentos (aprovado, pago, compensado em parte) ao
//     profissional e ao fornecedor da empresa favorecida dele; o cancelado não conta;
//   - (correção F3.7-11) a conta da empresa é a do fornecedor dela, a pessoal do médico é recusada; encerrar não estende
//     o fim; o lançamento se divide pelos favorecidos vigentes (60/40: duas linhas em `lancamento_repasse`, cada uma
//     com o seu favorecido, a sua parte e o centavo que sobra na maior); a conta do prestador fica com o documento dele.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaFavorecidosRepassePropria } from './favorecidos-propria.js';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaRepassePropria } from './porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'F3711';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  if (l) return Number(l.id);
  return e.inserir(ins, pi);
}

async function recusa(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e);
  }
  return 'gravou';
}

describe.skipIf(SEM_BANCO)('favorecidos e prestadores terceiros do repasse (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaFavorecidosRepassePropria;
  const ids = {
    est: 0,
    usuario: 0,
    prof: 0,
    outroProf: 0,
    pj: 0,
    contaOutro: 0,
    contaProf: 0,
    fornecedor: 0,
    contaPj: 0,
    evento: 0,
  };
  const c = () => ({ cliente: CLIENTE, hospital: P, usuario: ids.usuario, correlacao: 't-f3711' });
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-f3711' }, (l) => l.uma(sql, p));
  const limpar = (e: Escritor) =>
    (async () => {
      await e.executar('DELETE FROM adiantamento WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM lancamento_repasse WHERE estabelecimento_id = ?', [ids.est]);
      await limparTrilhaDaMassa(e, { ids: [ids.est] });
      await e.executar('DELETE FROM favorecido_repasse WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar(
        'DELETE FROM conta_bancaria_credor WHERE prestador_terceiro_id IN (SELECT id FROM prestador_terceiro WHERE estabelecimento_id = ?)',
        [ids.est],
      );
      await e.executar('DELETE FROM prestador_terceiro WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM conta_bancaria_credor WHERE titular_nome = ?', [`CONTA ${P}`]);
    })();

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    porta = new PortaFavorecidosRepassePropria(nucleo, CLIENTE);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-f3711' }, async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [P],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [P, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, agora],
      );
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['f3711.analista'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['f3711.analista', 'USUARIO SINTETICO F3711', agora],
      );
      const prof = async (n: string) => {
        const pf = await garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [`MEDICO SINTETICO ${n}`],
          'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
          [`MEDICO SINTETICO ${n}`, agora],
        );
        return garantir(
          e,
          'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
          [pf],
          "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
          [pf, agora],
        );
      };
      ids.prof = await prof(`${P}A`);
      ids.outroProf = await prof(`${P}B`);
      ids.pj = await garantir(
        e,
        'SELECT id FROM pessoa_juridica WHERE razao_social = ?',
        [`EMPRESA SINTETICA ${P}`],
        'INSERT INTO pessoa_juridica (razao_social, criado_em) VALUES (?, ?)',
        [`EMPRESA SINTETICA ${P}`, agora],
      );
      await limpar(e);
      ids.fornecedor = await garantir(
        e,
        'SELECT id FROM empresa_fornecedora WHERE pessoa_juridica_id = ?',
        [ids.pj],
        `INSERT INTO empresa_fornecedora (tipo_pessoa, cnpj, pessoa_juridica_id, razao_social, criado_em)
         VALUES ('juridica', '37110492000188', ?, ?, ?)`,
        [ids.pj, `EMPRESA SINTETICA ${P}`, agora],
      );
      ids.evento = await garantir(
        e,
        'SELECT id FROM evento_repasse WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, 3711],
        "INSERT INTO evento_repasse (estabelecimento_id, codigo, nome, natureza, tipo_lancamento, vigencia_inicio, criado_em) VALUES (?, 3711, 'HONORARIOS F3711', 'rendimento', 'credito', '2026-01-01', ?)",
        [ids.est, agora],
      );
      ids.contaProf = await e.inserir(
        `INSERT INTO conta_bancaria_credor (profissional_id, chave_pix, tipo_chave_pix, titular_nome, titular_documento, criado_em)
         VALUES (?, 'f3711a@exemplo.invalid', 'email', ?, '00000000191', ?)`,
        [ids.prof, `CONTA ${P}`, agora],
      );
      ids.contaPj = await e.inserir(
        `INSERT INTO conta_bancaria_credor (empresa_fornecedora_id, chave_pix, tipo_chave_pix, titular_nome, titular_documento, criado_em)
         VALUES (?, '37110492000188', 'cnpj', ?, '37110492000188', ?)`,
        [ids.fornecedor, `CONTA ${P}`, agora],
      );
      ids.contaOutro = await e.inserir(
        `INSERT INTO conta_bancaria_credor (profissional_id, chave_pix, tipo_chave_pix, titular_nome, titular_documento, criado_em)
         VALUES (?, 'f3711@exemplo.invalid', 'email', ?, '00000000191', ?)`,
        [ids.outroProf, `CONTA ${P}`, agora],
      );
    });
  }, 60_000);

  afterAll(async () => {
    if (ids.est) await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-f3711' }, limpar);
    await nucleo.encerrar();
  });

  it('favorecido: inclui, substitui pelo novo (o anterior termina no dia de antes) e encerra sem apagar', async () => {
    const a = await porta.incluirFavorecido(c(), {
      profissional: ids.prof,
      tipo: 'proprio_profissional',
      inicio: '2026-01-01',
    });
    const b = await porta.incluirFavorecido(c(), {
      profissional: ids.prof,
      tipo: 'proprio_profissional',
      percentual: 60,
      inicio: '2026-11-01',
    });
    expect(b.encerrados).toEqual([a.id]);
    const ant = await um('SELECT vigencia_fim AS f, ativo FROM favorecido_repasse WHERE id = ?', [a.id]);
    expect(String((ant!['f'] as Date).toISOString?.() ?? ant!['f']).slice(0, 10)).toBe('2026-10-31');
    // empresa do médico com 40%: cabe; mais 1% não cabe (soma 101%)
    // a conta pessoal do médico não serve à empresa dele; a do fornecedor da empresa serve
    expect(
      await recusa(
        porta.incluirFavorecido(c(), {
          profissional: ids.prof,
          tipo: 'pessoa_juridica',
          pessoaJuridica: ids.pj,
          contaBancaria: ids.contaProf,
          percentual: 40,
          inicio: '2026-11-01',
        }),
      ),
    ).toBe('regra-violada');
    expect((await porta.listarContas(c(), { tipo: 'pessoa_juridica', id: ids.pj })).map((x) => x.id)).toEqual(
      [ids.contaPj],
    );
    const pj = await porta.incluirFavorecido(c(), {
      profissional: ids.prof,
      tipo: 'pessoa_juridica',
      pessoaJuridica: ids.pj,
      contaBancaria: ids.contaPj,
      percentual: 40,
      inicio: '2026-11-01',
    });
    expect(
      await recusa(
        porta.incluirFavorecido(c(), {
          profissional: ids.prof,
          tipo: 'terceiro_profissional',
          terceiroProfissional: ids.outroProf,
          percentual: 1,
          inicio: '2026-11-15',
        }),
      ),
    ).toBe('regra-violada');
    // alvo de outro tipo e conta de outro credor: recusados
    expect(
      await recusa(
        porta.incluirFavorecido(c(), {
          profissional: ids.prof,
          tipo: 'proprio_profissional',
          cooperativa: 1,
          inicio: '2027-01-01',
        }),
      ),
    ).toBe('regra-violada');
    expect(
      await recusa(
        porta.incluirFavorecido(c(), {
          profissional: ids.prof,
          tipo: 'proprio_profissional',
          contaBancaria: ids.contaOutro,
          inicio: '2027-01-01',
        }),
      ),
    ).toBe('regra-violada');
    const lista = await porta.listarFavorecidos(c(), ids.prof);
    expect(lista.map((f) => f.id).sort()).toEqual([a.id, b.id, pj.id].sort());
    const v = lista.find((f) => f.id === pj.id)!;
    expect(v.retencoes.situacao).toBe('sem_enquadramento');
    await porta.encerrarFavorecido(c(), pj.id, { versao: v.versao, fim: '2026-12-31' });
    // encerrar não estende o fim (nem reabre): 422
    expect(
      await recusa(porta.encerrarFavorecido(c(), pj.id, { versao: v.versao + 1, fim: '2027-03-31' })),
    ).toBe('regra-violada');
    const fim = await um(
      "SELECT COUNT(*) AS q, SUM(vigencia_fim = '2026-12-31') AS enc FROM favorecido_repasse WHERE estabelecimento_id = ?",
      [ids.est],
    );
    expect(Number(fim!['q'])).toBe(3);
    expect(Number(fim!['enc'])).toBe(1);
  });

  it('prestador terceiro: inclui, recusa repetido e documento inválido, inativa sem apagar', async () => {
    const p = await porta.incluirPrestador(c(), {
      codigo: `${P}LAB`,
      nome: 'LABORATORIO SINTETICO',
      tipoPessoa: 'juridica',
      cnpj: '11.222.333/0001-81',
      cnes: '1234567',
      percentualRepasse: 60,
      baseRepasse: 'recebido',
    });
    const g = await um(
      'SELECT cnpj, cnes, percentual_repasse AS pr, base_repasse AS b FROM prestador_terceiro WHERE id = ?',
      [p.id],
    );
    expect([g!['cnpj'], g!['cnes'], Number(g!['pr']), g!['b']]).toEqual([
      '11222333000181',
      '1234567',
      60,
      'recebido',
    ]);
    expect(
      await recusa(
        porta.incluirPrestador(c(), {
          codigo: `${P}LAB2`,
          nome: 'OUTRO',
          tipoPessoa: 'juridica',
          cnpj: '11222333000181',
        }),
      ),
    ).toBe('prestador-repetido');
    expect(
      await recusa(
        porta.incluirPrestador(c(), {
          codigo: `${P}X`,
          nome: 'OUTRO',
          tipoPessoa: 'fisica',
          cpf: '52998224700',
        }),
      ),
    ).toBe('regra-violada');
    const [lido] = await porta.listarPrestadores(c(), `${P}LAB`);
    await porta.alterarPrestador(c(), p.id, { versao: lido!.versao, ativo: false });
    const ina = await um('SELECT ativo, inativado_em AS i FROM prestador_terceiro WHERE id = ?', [p.id]);
    expect(Number(ina!['ativo'])).toBe(0);
    expect(ina!['i']).not.toBeNull();
  });

  it('adiantamento ao profissional: o extrato soma o saldo a compensar, sem o cancelado', async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-f3711' }, async (e) => {
      const agora = new Date();
      for (const [num, situacao, valor, saldo] of [
        ['A1', 'pago', 500, 300],
        ['A2', 'aprovado', 200, 200],
        ['A3', 'cancelado', 900, 900],
      ] as const)
        await e.inserir(
          `INSERT INTO adiantamento (estabelecimento_id, numero, tipo_credor, profissional_id, data_emissao, valor,
             saldo_compensar, situacao, criado_em) VALUES (?, ?, 'profissional', ?, '2026-11-01', ?, ?, ?, ?)`,
          [ids.est, `${P}${num}`, ids.prof, valor, saldo, situacao, agora],
        );
    });
    const repasse = new PortaRepassePropria(nucleo);
    const ctx = { cliente: CLIENTE, estabelecimento: ids.est, usuario: ids.usuario, correlacao: 't-f3711' };
    expect(await repasse.adiantamentos(ctx, [ids.prof])).toBe(500);
    expect(await repasse.adiantamentos(ctx, [ids.outroProf])).toBe(0);
    // o fornecedor da empresa favorecida do médico também conta
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-f3711' }, (e) =>
      e.inserir(
        `INSERT INTO adiantamento (estabelecimento_id, numero, tipo_credor, empresa_fornecedora_id, data_emissao, valor,
           saldo_compensar, situacao, criado_em) VALUES (?, ?, 'fornecedor', ?, '2026-11-01', 80, 80, 'pago', ?)`,
        [ids.est, `${P}F1`, ids.fornecedor, new Date()],
      ),
    );
    expect(await repasse.adiantamentos(ctx, [ids.prof])).toBe(580);
    expect(await repasse.adiantamentos(ctx, [ids.outroProf])).toBe(0);
  });

  it('lançamento dividido pelos favorecidos vigentes: 60% ao próprio e 40% à empresa', async () => {
    const repasse = new PortaRepassePropria(nucleo);
    const ctx = { cliente: CLIENTE, estabelecimento: ids.est, usuario: ids.usuario, correlacao: 't-f3711' };
    const r = await repasse.executar(
      ctx,
      'repasse.lancarEvento',
      {
        origem: 'ajuste',
        empresa: 1,
        competencia: '2026-11',
        data: '2026-11-10',
        evento: ids.evento,
        tipo: 'M',
        prestador: ids.prof,
        profissional: ids.prof,
        valor: 1000.01,
        justificativa: 'Ajuste F3711',
      },
      { ...ctx, chaveIdempotencia: `${P}-div-${Date.now()}`, reautenticadoEm: Date.now() },
    );
    expect((r.resultado['lancamentos'] as unknown as number[]).length).toBe(2);
    const linhas = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-f3711' }, (l) =>
      l.consultar<Record<string, unknown>>(
        `SELECT fr.tipo_favorecido AS t, l.tipo_favorecido AS tl, l.valor AS v, l.percentual AS p
           FROM lancamento_repasse l JOIN favorecido_repasse fr ON fr.id = l.favorecido_repasse_id
          WHERE l.estabelecimento_id = ? AND l.data_lancamento = '2026-11-10' ORDER BY l.valor DESC`,
        [ids.est],
      ),
    );
    expect(linhas.map((x) => [x['t'], x['tl'], Number(x['v']), Number(x['p'])])).toEqual([
      ['proprio_profissional', 'medico', 600.01, 60],
      ['pessoa_juridica', 'empresa', 400, 40],
    ]);
  });

  it('conta do prestador terceiro: titular é o próprio prestador; sem destino, recusa', async () => {
    const p = await porta.incluirPrestador(c(), {
      codigo: `${P}CLI`,
      nome: 'CLINICA SINTETICA',
      tipoPessoa: 'juridica',
      cnpj: '37110492000188',
    });
    expect(await recusa(porta.incluirContaPrestador(c(), p.id, { banco: null }))).toBe('regra-violada');
    const conta = await porta.incluirContaPrestador(c(), p.id, {
      tipoChavePix: 'cnpj',
      chavePix: '37110492000188',
    });
    const g = await um(
      'SELECT prestador_terceiro_id AS p, titular_documento AS d FROM conta_bancaria_credor WHERE id = ?',
      [conta.id],
    );
    expect([Number(g!['p']), g!['d']]).toEqual([p.id, '37110492000188']);
    expect(
      (await porta.listarContas(c(), { tipo: 'prestador_terceiro', id: p.id })).map((x) => x.id),
    ).toEqual([conta.id]);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-f3711' }, (e) =>
      e.executar('DELETE FROM conta_bancaria_credor WHERE prestador_terceiro_id = ?', [p.id]),
    );
  });
});
