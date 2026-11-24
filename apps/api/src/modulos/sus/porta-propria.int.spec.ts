// Integração da porta PRÓPRIA do faturamento SUS contra o MariaDB real (cliente f22_o3 da onda 3). Contrato de efeito:
// abrir a competência (linha, versão 1, quem e quando, trilha da operação com o evento da tela), recusar a segunda
// abertura, fechar pela versão vista (e recusar a versão velha), reabrir com o motivo; a equivalência SIGTAP por vigência
// (registrar, trocar o procedimento, desativar, recusar a versão velha, a página com os nomes); as leituras da tabela
// unificada (código, busca, nomes, valores e vínculos), dos leitos de UTI habilitados e do CNES; as recusas
// "modelo-pendente" no que esta porta ainda não escreve e o isolamento por estabelecimento. Também o serviço da tela sobre a porta própria (abrir pela
// ServicoSus). Massa SINTÉTICA (estabelecimentos, SIGTAP e itens fictícios), limpa no fim.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { armazemSusMemoria } from './armazem.js';
import type { ContextoSus, PortaSus } from './porta.js';
import { PortaSusMemoria } from './porta-memoria.js';
import { competenciaDaData, periodoDaCompetencia, PortaSusPropria, situacaoDaTela } from './porta-propria.js';
import { SeloSolicitanteApac } from './selo-solicitante.js';
import { ServicoSus, type SessaoSus } from './servico.js';
import type { LinhaTrilhaSus } from './tipos.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST_A = 'f2305a';
const EST_B = 'f2305b';
const CNES = '9030501';
// Códigos fictícios fora da SIGTAP oficial (a forma 021102 oficial vai até 0211020109; o cliente de teste tem a
// tabela oficial carregada e o código oficial traria o nome oficial).
const SIG_A = '0211029903';
const SIG_B = '0211029911';
const ITEM = '92305001';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe('regras puras da porta própria', () => {
  it('período da competência, competência da data (0 = vigente) e situação da tela', () => {
    expect(periodoDaCompetencia('202602')).toEqual({ inicio: '2026-02-01', fim: '2026-02-28' });
    expect(periodoDaCompetencia('202412')).toEqual({ inicio: '2024-12-01', fim: '2024-12-31' });
    expect(() => periodoDaCompetencia('202613')).toThrow();
    expect(competenciaDaData('2026-03-01')).toBe(202603);
    expect(competenciaDaData(null)).toBe(0);
    expect(situacaoDaTela('reaberta')).toBe('aberta');
    expect(situacaoDaTela('enviada')).toBe('fechada');
  });
});

describe.skipIf(SEM_BANCO)('porta própria do faturamento SUS contra o MariaDB (cliente f22_o3)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaSusPropria;
  let estA = 0;
  let estB = 0;
  let sigA = 0;
  let sigB = 0;
  let item = 0;
  const correlacao = `f22-0305-${Date.now()}`;
  let ctxA: ContextoSus;
  let ctxB: ContextoSus;

  const linha = (evento: string, tabela: string, id: string | null): LinhaTrilhaSus => ({
    rede: 'rede-teste',
    hospital: EST_A,
    usuario: 'FATURISTA.SINT',
    evento,
    recurso: 'faturamento.sus',
    operacao: 'teste',
    tabelaAlvo: tabela,
    idAlvo: id,
    chaveNaturalAlvo: null,
    resultado: 'sucesso',
    estacao: 'TESTE',
    correlacao,
    diferenca: 'situacao',
  });
  const uma = (sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f22-0305-conta' }, (l) =>
      l.uma<Record<string, unknown>>(sql, p),
    );

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-0305-limpa' }, async (e) => {
      for (const est of [estA, estB].filter(Boolean)) {
        await e.executar(
          'DELETE k FROM critica_sus k JOIN competencia_sus c ON c.id = k.competencia_sus_id WHERE c.estabelecimento_id = ?',
          [est],
        );
        await e.executar('DELETE FROM faixa_numeracao_aih WHERE estabelecimento_id = ?', [est]);
        await e.executar('DELETE FROM competencia_sus WHERE estabelecimento_id = ?', [est]);
        await e.executar('DELETE FROM leito_uti_habilitado WHERE estabelecimento_id = ?', [est]);
        await e.executar(
          "DELETE FROM idempotencia_operacao WHERE operacao = 'faturamento.sus.gravacao' AND estabelecimento_id = ?",
          [est],
        );
      }
      if (item) await e.executar('DELETE FROM equivalencia_sigtap_item WHERE item_faturavel_id = ?', [item]);
      for (const s of [sigA, sigB].filter(Boolean))
        await e.executar('DELETE FROM procedimento_sigtap_valor WHERE procedimento_sigtap_id = ?', [s]);
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-0305-massa' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string, cnes: string | null) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, codigo_cnes, criado_em) VALUES (?, ?, ?, ?, ?)',
          [codigo, `Hospital fictício ${codigo}`, `Hospital fictício ${codigo} (teste)`, cnes, agora],
        );
      estA = await est(EST_A, CNES);
      estB = await est(EST_B, null);
      const grupo = (nivel: string, codigo: string, pai: number | null) =>
        garantir(
          e,
          'SELECT id FROM grupo_sigtap WHERE codigo_sigtap = ? AND vigencia_inicio = ?',
          [codigo, '2008-01-01'],
          `INSERT INTO grupo_sigtap (nivel, codigo_sigtap, pai_grupo_sigtap_id, descricao, vigencia_inicio, versao_fonte, criado_em)
           VALUES (?, ?, ?, ?, '2008-01-01', 'teste', ?)`,
          [nivel, codigo, pai, `Grupo fictício ${codigo}`, agora],
        );
      const g = await grupo('grupo', '02', null);
      const sg = await grupo('subgrupo', '0211', g);
      const f = await grupo('forma_organizacao', '021102', sg);
      const proc = (codigo: string, nome: string) =>
        garantir(
          e,
          'SELECT id FROM procedimento_sigtap WHERE codigo_sigtap = ?',
          [codigo],
          `INSERT INTO procedimento_sigtap (codigo_sigtap, descricao, grupo_sigtap_id, sexo, vigencia_inicio, versao_fonte, criado_em)
           VALUES (?, ?, ?, 'ambos', '2008-01-01', 'teste', ?)`,
          [codigo, nome, f, agora],
        );
      sigA = await proc(SIG_A, 'Eletrocardiograma fictício (teste)');
      sigB = await proc(SIG_B, 'Teste ergométrico fictício (teste)');
      const gf = await garantir(
        e,
        'SELECT id FROM grupo_faturamento WHERE codigo = ?',
        ['F2305'],
        'INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, ?, ?, ?)',
        ['F2305', 'Grupo de faturamento fictício', 'sadt', agora],
      );
      item = await garantir(
        e,
        'SELECT id FROM item_faturavel WHERE codigo = ?',
        [ITEM],
        `INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em)
         VALUES (?, 'Eletrocardiograma do hospital (teste)', 'procedimento', ?, ?)`,
        [ITEM, gf, agora],
      );
      await garantir(
        e,
        "SELECT id FROM dominio_sus WHERE lista = 'tipo_leito_uti' AND codigo = ?",
        ['f2305_uti_adulto_2'],
        `INSERT INTO dominio_sus (lista, codigo, codigo_oficial, descricao, criado_em)
         VALUES ('tipo_leito_uti', ?, '26', 'UTI adulto tipo II (teste)', ?)`,
        ['f2305_uti_adulto_2', agora],
      );
    });
    await limpar();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-0305-massa2' }, async (e) => {
      await e.executar(
        `INSERT INTO leito_uti_habilitado (estabelecimento_id, tipo_uti_dominio_sus_id, quantidade_leitos, vigencia_inicio, criado_em)
         SELECT ?, id, 10, '2020-01-01', ? FROM dominio_sus WHERE lista = 'tipo_leito_uti' AND codigo = 'f2305_uti_adulto_2'`,
        [estA, new Date()],
      );
      await e.executar(
        `INSERT INTO procedimento_sigtap_valor (procedimento_sigtap_id, valor_servico_hospitalar, valor_servico_profissional,
           valor_servico_ambulatorial, valor_total_ambulatorial, vigencia_inicio, versao_fonte, criado_em)
         VALUES (?, 0, 0, 5.15, 5.15, '2008-01-01', 'teste', ?)`,
        [sigA, new Date()],
      );
    });
    porta = new PortaSusPropria(nucleo, CLIENTE);
    ctxA = { rede: 'rede-teste', hospital: EST_A, estabelecimento: estA, usuario: null, correlacao };
    ctxB = { rede: 'rede-teste', hospital: EST_B, estabelecimento: estB, usuario: null, correlacao };
  });

  afterAll(async () => {
    if (nucleo) {
      await limpar();
      await nucleo.encerrar();
    }
  });

  it('abre a competência: linha, versão 1, CNES do estabelecimento e a trilha da operação com o evento da tela', async () => {
    const c = await porta.gravar(ctxA, async (g) => {
      const x = await g.abrir({ instrumento: 'ciha', competencia: '202601', por: 'FATURISTA.SINT' });
      await g.trilha(linha('faturamento.competenciaSus.aberta', 'competencia_sus', String(x.id)));
      return x;
    });
    expect(c).toMatchObject({
      instrumento: 'ciha',
      competencia: '202601',
      situacao: 'aberta',
      versao: 1,
      cnes: CNES,
    });
    expect(c.bloqueantes + c.avisos).toBe(0);
    const linhaBanco = await uma(
      "SELECT DATE_FORMAT(periodo_inicio, '%Y-%m-%d') AS i, DATE_FORMAT(periodo_fim, '%Y-%m-%d') AS f, situacao FROM competencia_sus WHERE id = ?",
      [c.id],
    );
    expect(linhaBanco).toMatchObject({ i: '2026-01-01', f: '2026-01-31', situacao: 'aberta' });
    const t = await uma(
      "SELECT entidade, entidade_id, dados_depois FROM trilha_auditoria WHERE correlacao = ? AND entidade = 'competencia_sus' ORDER BY id DESC LIMIT 1",
      [correlacao],
    );
    expect(Number(t?.['entidade_id'])).toBe(c.id);
    const dados = JSON.stringify(t?.['dados_depois']);
    expect(dados).toContain('faturamento.competenciaSus.aberta');
    expect(dados).not.toContain('FATURISTA');
    const ida = await uma(
      "SELECT COUNT(*) AS n FROM idempotencia_operacao WHERE operacao = 'faturamento.sus.gravacao' AND estabelecimento_id = ?",
      [estA],
    );
    expect(Number(ida?.['n'])).toBeGreaterThan(0);
    await expect(
      porta.gravar(ctxA, (g) => g.abrir({ instrumento: 'ciha', competencia: '202601', por: 'x' })),
    ).rejects.toMatchObject({ codigo: 'competencia-ja-aberta' });
  });

  it('fecha pela versão vista, recusa a versão velha e reabre com o motivo; outro estabelecimento não vê', async () => {
    const c = await porta.ler(ctxA, (l) => l.competencia('ciha', '202601'));
    expect(c).not.toBeNull();
    await expect(
      porta.gravar(ctxA, (g) => g.fechar({ id: c!.id, versao: c!.versao + 5 }, 'x')),
    ).rejects.toMatchObject({
      codigo: 'versao-alterada',
    });
    await porta.gravar(ctxA, (g) => g.fechar({ id: c!.id, versao: c!.versao }, 'x'));
    const f = await porta.ler(ctxA, (l) => l.competencia('ciha', '202601'));
    expect(f).toMatchObject({ situacao: 'fechada', versao: c!.versao + 1 });
    expect(f?.fechadaEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    await expect(
      porta.gravar(ctxA, (g) => g.fechar({ id: f!.id, versao: f!.versao }, 'x')),
    ).rejects.toMatchObject({
      codigo: 'competencia-ja-fechada',
    });
    await porta.gravar(ctxA, (g) =>
      g.reabrir({ id: f!.id, versao: f!.versao }, 'x', 'Correção da produção (teste)'),
    );
    const r = await uma('SELECT situacao, motivo_reabertura, versao FROM competencia_sus WHERE id = ?', [
      f!.id,
    ]);
    expect(r).toMatchObject({ situacao: 'reaberta', motivo_reabertura: 'Correção da produção (teste)' });
    expect((await porta.ler(ctxA, (l) => l.competencia('ciha', '202601')))?.situacao).toBe('aberta');
    expect(await porta.ler(ctxB, (l) => l.competencias(null))).toEqual([]);
    expect(await porta.ler(ctxB, (l) => l.competencia('ciha', '202601'))).toBeNull();
    // Outra competência do mesmo instrumento no B não colide com a do A.
    await porta.gravar(ctxB, (g) => g.abrir({ instrumento: 'ciha', competencia: '202601', por: 'x' }));
    expect((await porta.ler(ctxB, (l) => l.competencias('ciha'))).length).toBe(1);
  });

  it('equivalência SIGTAP por vigência: registra, troca, recusa versão velha, desativa e pagina com os nomes', async () => {
    const r1 = await porta.gravar(ctxA, (g) =>
      g.registrarEquivalencia({
        procedimento: item,
        codigoProcedimento: Number(ITEM),
        sigtap: sigA,
        codigo: SIG_A,
        por: 'x',
      }),
    );
    expect(r1).toMatchObject({
      antes: null,
      mudou: true,
      depois: { procedimento: item, sigtap: sigA, ativa: true },
    });
    const r2 = await porta.gravar(ctxA, (g) =>
      g.registrarEquivalencia({
        procedimento: item,
        codigoProcedimento: 0,
        sigtap: sigA,
        codigo: SIG_A,
        por: 'x',
        versao: r1.depois.versao,
      }),
    );
    expect(r2.mudou).toBe(false);
    await expect(
      porta.gravar(ctxA, (g) =>
        g.registrarEquivalencia({
          procedimento: item,
          codigoProcedimento: 0,
          sigtap: sigB,
          codigo: SIG_B,
          por: 'x',
          versao: 99,
        }),
      ),
    ).rejects.toMatchObject({ codigo: 'equivalencia-alterada' });
    const r3 = await porta.gravar(ctxA, (g) =>
      g.registrarEquivalencia({
        procedimento: item,
        codigoProcedimento: 0,
        sigtap: sigB,
        codigo: SIG_B,
        por: 'x',
        versao: r1.depois.versao,
      }),
    );
    expect(r3).toMatchObject({ mudou: true, antes: { sigtap: sigA }, depois: { sigtap: sigB, ativa: true } });
    const vigentes = await porta.ler(ctxA, (l) => l.equivalencias());
    expect(vigentes.filter((x) => x.procedimento === item).map((x) => x.sigtap)).toEqual([sigB]);
    const pagina = await porta.ler(ctxA, (l) =>
      l.paginaEquivalencias({ procedimento: item, inativas: true, pagina: 1, porPagina: 10 }),
    );
    expect(pagina.total).toBe(2);
    expect(pagina.itens[0]).toMatchObject({
      ativa: true,
      sigtapNome: 'Teste ergométrico fictício (teste)',
      procedimentoNome: 'Eletrocardiograma do hospital (teste)',
      codigoProcedimento: Number(ITEM),
    });
    const fechada = await uma(
      'SELECT vigencia_fim IS NOT NULL AS fechada FROM equivalencia_sigtap_item WHERE item_faturavel_id = ? AND procedimento_sigtap_id = ?',
      [item, sigA],
    );
    expect(Number(fechada?.['fechada'])).toBe(1);
    await expect(
      porta.gravar(ctxA, (g) => g.desativarEquivalencia({ procedimento: item, versao: 99, por: 'x' })),
    ).rejects.toMatchObject({ codigo: 'equivalencia-alterada' });
    const d = await porta.gravar(ctxA, (g) =>
      g.desativarEquivalencia({ procedimento: item, versao: r3.depois.versao, por: 'x' }),
    );
    expect(d.depois.ativa).toBe(false);
    expect(d.depois.versao).toBe(r3.depois.versao + 1);
    await expect(
      porta.gravar(ctxA, (g) => g.desativarEquivalencia({ procedimento: item, versao: 1, por: 'x' })),
    ).rejects.toMatchObject({ codigo: 'nao-encontrado' });
    // A mesma ligação fechada hoje volta a valer (sem ferir a chave única do dia).
    const r4 = await porta.gravar(ctxA, (g) =>
      g.registrarEquivalencia({
        procedimento: item,
        codigoProcedimento: 0,
        sigtap: sigB,
        codigo: SIG_B,
        por: 'x',
      }),
    );
    expect(r4.depois).toMatchObject({ id: r3.depois.id, ativa: true });
  });

  it.each(['memoria', 'propria'] as const)(
    'trava otimista da equivalência (%s): havendo vigente, versão ausente ou diferente é recusa',
    async (qual) => {
      const memoria = new PortaSusMemoria();
      const p: PortaSus = qual === 'memoria' ? memoria : porta;
      const c: ContextoSus = qual === 'memoria' ? { rede: 'rede-teste', hospital: 'pc' } : ctxA;
      if (qual === 'propria')
        await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-0305-trava' }, (e) =>
          e.executar('DELETE FROM equivalencia_sigtap_item WHERE item_faturavel_id = ?', [item]),
        );
      // Na memória, um item fora da massa sintética (o id do banco poderia coincidir com um item sintético).
      const proc = qual === 'memoria' ? 990_001 : item;
      const base = { procedimento: proc, codigoProcedimento: 0, por: 'x' };
      const r1 = await p.gravar(c, (g) => g.registrarEquivalencia({ ...base, sigtap: sigA, codigo: SIG_A }));
      expect(r1).toMatchObject({ antes: null, mudou: true });
      // O formulário aberto antes da primeira equivalência (sem versão) não a substitui em silêncio.
      await expect(
        p.gravar(c, (g) => g.registrarEquivalencia({ ...base, sigtap: sigB, codigo: SIG_B })),
      ).rejects.toMatchObject({ codigo: 'equivalencia-alterada' });
      await expect(
        p.gravar(c, (g) =>
          g.registrarEquivalencia({ ...base, sigtap: sigB, codigo: SIG_B, versao: r1.depois.versao + 7 }),
        ),
      ).rejects.toMatchObject({ codigo: 'equivalencia-alterada' });
      const r2 = await p.gravar(c, (g) =>
        g.registrarEquivalencia({ ...base, sigtap: sigB, codigo: SIG_B, versao: r1.depois.versao }),
      );
      expect(r2).toMatchObject({ mudou: true, depois: { sigtap: sigB, ativa: true } });
      const vigentes = await p.ler(c, (l) => l.equivalencias());
      expect(vigentes.filter((x) => x.procedimento === proc && x.ativa).map((x) => x.sigtap)).toEqual([sigB]);
    },
  );

  it('tabela unificada, itens do hospital, leitos de UTI e CNES', async () => {
    const x = await porta.ler(ctxA, async (l) => ({
      codigo: await l.sigtapPorCodigo(SIG_A),
      busca: await l.buscarSigtap('0211029', 202601),
      nomes: await l.nomesSigtap([sigA, sigB]),
      valores: await l.valoresSigtap([sigA]),
      itens: await l.buscarProcedimentosHospital('Eletrocardiograma do hospital'),
      porId: await l.procedimentosHospital([item]),
      uti: await l.leitosUti(),
      ciha: await l.dadosCiha({ inicio: '2026-01-01', fim: '2026-01-31' }, [], [sigA]),
    }));
    expect(x.codigo).toEqual({ id: sigA, codigo: SIG_A, nome: 'Eletrocardiograma fictício (teste)' });
    expect(x.busca.map((b) => b.codigo)).toEqual(expect.arrayContaining([SIG_A, SIG_B]));
    expect(x.busca.every((b) => b.vigente)).toBe(true);
    expect(x.nomes.get(sigB)).toBe('Teste ergométrico fictício (teste)');
    expect(x.valores).toEqual([
      {
        id: sigA,
        data: '2008-01-01',
        servicoHospitalar: 0,
        servicoProfissional: 0,
        sadt: 5.15,
        ambulatorial: 5.15,
      },
    ]);
    expect(x.itens.map((i) => i.id)).toContain(item);
    expect(x.porId[0]).toMatchObject({ id: item, codigo: Number(ITEM), tabela: 'procedimento' });
    expect(x.uti).toEqual([{ tipo: 26, nome: 'UTI adulto tipo II (teste)', leitos: 10 }]);
    expect(x.ciha.cnesCadastrados).toEqual([Number(CNES)]);
    expect(x.ciha.procedimentos[0]).toMatchObject({
      id: sigA,
      codigo: SIG_A,
      competenciaInicial: 200801,
      competenciaFinal: 0,
    });
    expect(x.ciha.atendimentos).toEqual([]);
    expect(await porta.ler(ctxB, (l) => l.leitosUti())).toEqual([]);
  });

  it('crítica prévia: rodada com chave estável, justificativa do aviso, correção na rodada seguinte e recusa atômica', async () => {
    const c = (await porta.ler(ctxA, (l) => l.competencia('ciha', '202601')))!;
    const nova = (chave: string, regra: string, gravidade: 'bloqueante' | 'aviso') => ({
      chave,
      regra,
      gravidade,
      conta: null,
      convenio: null,
      atendimento: null,
      item: null,
      detalhe: '{"campo":"cid"}',
    });
    const r1 = await porta.gravar(ctxA, (g) =>
      g.gravarCriticas(
        { id: c.id, versao: c.versao },
        [nova('R1:202601', 'R1', 'bloqueante'), nova('R2:202601', 'R2', 'aviso')],
        { registros: 5, cnes: CNES },
      ),
    );
    expect(r1).toEqual({ novas: 2, mantidas: 0, reabertas: 0, corrigidas: 0, bloqueantes: 1, avisos: 1 });
    const c2 = (await porta.ler(ctxA, (l) => l.competencia('ciha', '202601')))!;
    expect(c2).toMatchObject({ registros: 5, bloqueantes: 1, avisos: 1, versao: c.versao + 1 });
    expect(c2.criticadaEm).toBeTruthy();
    const pagina = await porta.ler(ctxA, (l) =>
      l.criticas(c.id, { convenios: null, pagina: 0, porPagina: 50 }),
    );
    expect(pagina.total).toBe(2);
    expect(pagina.porRegra).toEqual({ R1: 1, R2: 1 });
    expect(pagina.itens[0]).toMatchObject({
      regra: 'R1',
      gravidade: 'bloqueante',
      situacao: 'aberta',
      detalhe: '{"campo":"cid"}',
    });
    const aviso = pagina.itens.find((x) => x.regra === 'R2')!;
    expect(await porta.ler(ctxB, (l) => l.critica(aviso.id))).toBeNull();
    await porta.gravar(ctxA, (g) =>
      g.justificar({ id: aviso.id, versao: aviso.versao }, 'Conferido com o laudo (teste)', 'x'),
    );
    expect(await porta.ler(ctxA, (l) => l.critica(aviso.id))).toMatchObject({
      situacao: 'justificada',
      justificativa: 'Conferido com o laudo (teste)',
      competencia: c.id,
    });
    await expect(
      porta.gravar(ctxA, (g) => g.justificar({ id: aviso.id, versao: aviso.versao + 1 }, 'de novo', 'x')),
    ).rejects.toMatchObject({ codigo: 'critica-nao-justificavel' });
    const r2 = await porta.gravar(ctxA, (g) =>
      g.gravarCriticas({ id: c2.id, versao: c2.versao }, [nova('R1:202601', 'R1', 'bloqueante')], {
        registros: 4,
        cnes: CNES,
      }),
    );
    expect(r2).toMatchObject({ novas: 0, mantidas: 1, corrigidas: 1, bloqueantes: 1, avisos: 0 });

    // A recusa desfaz a transação inteira: o fechamento feito antes da recusa não fica.
    const c3 = (await porta.ler(ctxA, (l) => l.competencia('ciha', '202601')))!;
    await expect(
      porta.gravar(ctxA, async (g) => {
        await g.fechar({ id: c3.id, versao: c3.versao }, 'x');
        return g.gravarCriticas({ id: c3.id, versao: c3.versao }, [], { registros: 0, cnes: CNES });
      }),
    ).rejects.toMatchObject({ codigo: 'versao-alterada' });
    expect(await uma('SELECT versao, situacao FROM competencia_sus WHERE id = ?', [c3.id])).toMatchObject({
      versao: c3.versao,
    });
  });

  it('faixa de AIH: número de 13 dígitos, sobreposição recusada, cancelamento com motivo; outro estabelecimento não vê', async () => {
    const id = await porta.gravar(ctxA, (g) =>
      g.inserirFaixaAih({
        inicio: 412610000001n,
        fim: 412610000100n,
        orgaoEmissor: 'M410000',
        dataLiberacao: '2026-01-05',
        por: 'x',
      }),
    );
    expect(await porta.ler(ctxA, (l) => l.faixasAih())).toMatchObject([
      {
        id,
        inicio: '412610000001',
        fim: '412610000100',
        orgaoEmissor: 'M410000',
        dataLiberacao: '2026-01-05',
        situacao: 'ativa',
        usados: 0,
        versao: 1,
      },
    ]);
    expect(
      String(
        (await uma('SELECT numero_inicial FROM faixa_numeracao_aih WHERE id = ?', [id]))?.['numero_inicial'],
      ),
    ).toMatch(/^412610000001\d$/);
    expect(await porta.ler(ctxA, (l) => l.maiorNumeroDaFaixa(id))).toBeNull();
    expect(await porta.ler(ctxB, (l) => l.faixasAih())).toEqual([]);
    await expect(
      porta.gravar(ctxA, (g) =>
        g.inserirFaixaAih({
          inicio: 412610000050n,
          fim: 412610000200n,
          orgaoEmissor: 'M410000',
          dataLiberacao: '2026-01-06',
          por: 'x',
        }),
      ),
    ).rejects.toMatchObject({ codigo: 'faixa-sobreposta' });
    await porta.gravar(ctxA, (g) =>
      g.mudarFaixaAih({
        id,
        versao: 1,
        situacao: 'cancelada',
        justificativa: 'Faixa trocada pelo gestor',
        por: 'x',
      }),
    );
    expect(await porta.ler(ctxA, (l) => l.faixaAih(id))).toMatchObject({
      situacao: 'cancelada',
      justificativa: 'Faixa trocada pelo gestor',
      versao: 2,
    });
    await expect(
      porta.gravar(ctxA, (g) =>
        g.mudarFaixaAih({ id, versao: 2, situacao: 'esgotada', justificativa: null, por: 'x' }),
      ),
    ).rejects.toMatchObject({ codigo: 'versao-alterada' });
    expect(await porta.ler(ctxA, (l) => l.numeroAihEmUso('4126100000017'))).toBe(false);
  });

  it('o retorno do gestor ainda não é tratado por esta porta: recusa e nada muda', async () => {
    await expect(
      porta.gravar(ctxA, (g) =>
        g.tratarRetornoSus(
          { id: 1, versao: 1 },
          { decisao: 'aceita', justificativa: 'x', por: 'x', aih: null },
        ),
      ),
    ).rejects.toMatchObject({
      problema: { codigo: 'modelo-pendente' },
    });
  });

  it('o serviço da tela sobre a porta própria: abre a competência do BPA pela ServicoSus', async () => {
    const trilhas: LinhaTrilhaSus[] = [];
    const servico = new ServicoSus(
      porta,
      armazemSusMemoria(),
      () => undefined,
      new SeloSolicitanteApac(null),
    );
    const sessao: SessaoSus = {
      rede: 'rede-teste',
      hospital: EST_A,
      login: 'FATURISTA.SINT',
      estabelecimento: estA,
      usuario: null,
      correlacao,
      hoje: '2026-11-21',
      convenios: null,
      parametros: { cnes: CNES } as unknown as SessaoSus['parametros'],
      liberado: async () => true,
      trilha: (evento, operacao, alvo) => {
        const l = { ...linha(evento, alvo.tabela, alvo.id), operacao };
        trilhas.push(l);
        return l;
      },
    };
    const r = await servico.abrir(sessao, { instrumento: 'bpa', competencia: '202601' });
    expect(r).toMatchObject({ instrumento: 'bpa', competencia: '202601', situacao: 'aberta' });
    expect(trilhas.map((t) => t.tabelaAlvo)).toContain('competencia_sus');
    const lista = await porta.ler(ctxA, (l) => l.competencias('bpa'));
    expect(lista.map((x) => x.competencia)).toEqual(['202601']);
  });
});
