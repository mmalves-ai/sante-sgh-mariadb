// Integração da família APAC e retorno do faturamento SUS na porta PRÓPRIA (porta-propria-apac-retorno.ts) contra o
// MariaDB real (cliente de teste). Contrato de efeito: a APAC incluída grava o laudo (número pela sequência de negócio,
// solicitante pelo CPF, tipo do laudo pelo catálogo), a autorização "solicitada" e o complemento de terapia renal; a
// mudança confere a versão vista (apac-alterada), o número único no estabelecimento (apac-numero-duplicado), sobe as
// duas versões e nunca apaga o complemento retirado; o encerramento sem o motivo na lista oficial recusa
// (catalogo-incompleto). O retorno do gestor grava o cabeçalho por arquivo (SHA-256) e uma linha por identificação
// (a repetida não entra), com as contagens no cabeçalho; o tratamento confere a versão; sem a ponte da AIH, mudar a
// AIH recusa (modelo-pendente). Massa SINTÉTICA, limpa no fim. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { definirOperacao, NucleoProprio, type ResultadoOperacao } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  GravacaoApacRetorno,
  LeituraApacRetorno,
  TABELAS_APAC_RETORNO,
} from './porta-propria-apac-retorno.js';
import { TABELAS_SUS } from './porta-propria.js';
import { type NovaApac, type RetornoSusParaGravar } from './tipos.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'sapac1';
const SIG = '0899990001';
const TIPO_LAUDO = ['SAPAC-T1', 'SAPAC-T2'];

/** CPF fictício com os dígitos verificadores certos. */
function cpfFicticio(base: string): string {
  const d = base.split('').map(Number);
  for (const n of [9, 10]) {
    const s = d.slice(0, n).reduce((t, x, i) => t + x * (n + 1 - i), 0);
    d.push(((s * 10) % 11) % 10);
  }
  return d.join('');
}
const CPF = cpfFicticio('990001771');
const textoDoErro = (e: unknown): string =>
  e instanceof Error ? `${e.message} ${JSON.stringify(e)}` : JSON.stringify(e);

describe.skipIf(SEM_BANCO)('APAC e retorno do gestor na porta própria (cliente de teste)', () => {
  let nucleo: NucleoProprio;
  let est = 0;
  let paciente = 0;
  let atendimento = 0;
  let sigtap = 0;
  let usuario = 0;
  let dom: number[] = [];
  const massa: { tabela: string; id: number }[] = [];

  async function ler<T>(fn: (l: LeituraApacRetorno) => Promise<T>): Promise<T> {
    return nucleo.lerSomente({ cliente: CLIENTE, estabelecimento: est, correlacao: 'sapac-ler' }, (l) =>
      fn(new LeituraApacRetorno(l, est)),
    );
  }

  async function gravar<T>(fn: (g: GravacaoApacRetorno) => Promise<T>): Promise<T> {
    let saida: { v: T } | null = null;
    let recusada: unknown = null;
    const op = definirOperacao({
      nome: 'faturamento.sus.gravacao',
      tabelas: [...new Set([...TABELAS_SUS, ...TABELAS_APAC_RETORNO])],
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        try {
          saida = { v: await fn(new GravacaoApacRetorno(tx, est)) };
        } catch (e) {
          recusada = e;
          throw e;
        }
        return {} as ResultadoOperacao;
      },
      alvo: () => ({ tabela: 'laudo_apac', id: null }),
    });
    const chave = `sapac:${randomUUID()}`;
    try {
      await nucleo
        .criarExecutor()
        .executar(op, CLIENTE, { chave }, {
          cliente: CLIENTE,
          estabelecimento: est,
          usuario,
          correlacao: 'sapac-gravar',
          chaveIdempotencia: chave,
        });
    } catch (e) {
      // A recusa de negócio volta como a porta a lançou (como na PortaSusPropria).
      throw recusada ?? e;
    }
    if (!saida) throw new Error('sem saída');
    return (saida as { v: T }).v;
  }

  const contar = (sql: string, p: readonly unknown[]) =>
    nucleo
      .lerSomente({ cliente: CLIENTE, correlacao: 'sapac-conta' }, (l) => l.uma<{ n: number }>(sql, p))
      .then((x) => Number(x?.n ?? 0));

  async function limpar(): Promise<void> {
    if (!est) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'sapac-limpa' }, async (e) => {
      await e.executar(
        'DELETE i FROM retorno_sus_item i JOIN retorno_sus r ON r.id = i.retorno_sus_id WHERE r.estabelecimento_id = ?',
        [est],
      );
      await e.executar('DELETE FROM retorno_sus WHERE estabelecimento_id = ?', [est]);
      await e.executar(
        'DELETE n FROM laudo_apac_nefrologia n JOIN laudo_apac l ON l.id = n.laudo_apac_id WHERE l.estabelecimento_id = ?',
        [est],
      );
      await e.executar('DELETE FROM autorizacao_apac WHERE estabelecimento_id = ?', [est]);
      await e.executar('DELETE FROM laudo_apac WHERE estabelecimento_id = ?', [est]);
      await e.executar('DELETE FROM competencia_sus WHERE estabelecimento_id = ?', [est]);
      await e.executar(
        "DELETE FROM sequencia_negocio WHERE tipo IN ('laudo_apac','retorno_sus') AND estabelecimento_id = ?",
        [est],
      );
      await e.executar(
        "DELETE FROM idempotencia_operacao WHERE operacao = 'faturamento.sus.gravacao' AND estabelecimento_id = ?",
        [est],
      );
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'sapac-massa' }, async (e) => {
      const agora = new Date();
      const garantir = async (tabela: string, sel: string, sp: unknown[], ins: string, ip: unknown[]) => {
        const x = await e.uma<{ id: number }>(sel, sp);
        if (x) return Number(x.id);
        const id = await e.inserir(ins, ip);
        massa.push({ tabela, id });
        return id;
      };
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      est = await garantir(
        'estabelecimento',
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [EST],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, codigo_cnes, criado_em) VALUES (?, ?, ?, ?, ?)',
        [EST, 'Hospital fictício APAC', 'Hospital fictício APAC (teste)', '9039771', agora],
      );
      await limpar();
      const pfPac = await e.inserir('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
        'Paciente fictício APAC',
        agora,
      ]);
      massa.push({ tabela: 'pessoa_fisica', id: pfPac });
      paciente = await e.inserir(
        "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, 977001, 'ativo', ?)",
        [pfPac, agora],
      );
      massa.push({ tabela: 'paciente', id: paciente });
      atendimento = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, unidade_assistencial_id, situacao,
           entrada_em, criado_em) VALUES (?, '977001', ?, 1, 1, 77, 1, 55, 'aberto', ?, ?)`,
        [est, paciente, agora, agora],
      );
      massa.push({ tabela: 'atendimento', id: atendimento });
      const pfMed = await garantir(
        'pessoa_fisica',
        'SELECT id FROM pessoa_fisica WHERE cpf = ?',
        [CPF],
        'INSERT INTO pessoa_fisica (nome, cpf, criado_em) VALUES (?, ?, ?)',
        ['Médica fictícia APAC', CPF, agora],
      );
      await garantir(
        'profissional',
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pfMed],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, observacao, criado_em) VALUES (?, 'corpo_clinico', 'teste', ?)",
        [pfMed, agora],
      );
      sigtap = await garantir(
        'procedimento_sigtap',
        'SELECT id FROM procedimento_sigtap WHERE codigo_sigtap = ?',
        [SIG],
        `INSERT INTO procedimento_sigtap (codigo_sigtap, descricao, grupo_sigtap_id, sexo, vigencia_inicio, versao_fonte, criado_em)
         VALUES (?, 'Procedimento fictício APAC (teste)', 1, 'ambos', '2008-01-01', 'teste', ?)`,
        [SIG, agora],
      );
      for (const [codigo, grupo] of [
        [TIPO_LAUDO[0], 'outro'],
        [TIPO_LAUDO[1], 'nefrologia'],
      ] as const)
        await garantir(
          'tipo_laudo_apac',
          'SELECT id FROM tipo_laudo_apac WHERE codigo = ?',
          [codigo],
          'INSERT INTO tipo_laudo_apac (codigo, descricao, grupo_laudo, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `Tipo de laudo fictício ${grupo}`, grupo, agora],
        );
      await e.executar(
        `INSERT INTO competencia_sus (estabelecimento_id, instrumento, competencia, periodo_inicio, periodo_fim, situacao,
           aberta_em, criado_em) VALUES (?, 'bpa', '202509', '2025-09-01', '2025-09-30', 'aberta', ?, ?)`,
        [est, agora, agora],
      );
      dom = [];
      for (const lista of [
        'caracteristica_tratamento_dialitico',
        'contraindicacao_transplante',
        'situacao_transplante',
        'acesso_vascular',
      ])
        dom.push(
          await garantir(
            'dominio_sus',
            'SELECT id FROM dominio_sus WHERE lista = ? AND codigo = ?',
            [lista, 'SAPAC'],
            'INSERT INTO dominio_sus (lista, codigo, descricao, criado_em) VALUES (?, ?, ?, ?)',
            [lista, 'SAPAC', `Valor fictício ${lista}`, agora],
          ),
        );
      const u = await e.uma<{ id: number }>('SELECT MIN(id) AS id FROM usuario', []);
      usuario = Number(u?.id ?? 0);
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    });
    expect(usuario).toBeGreaterThan(0);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await limpar();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'sapac-massa-fim' }, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      for (const m of [...massa].reverse())
        if (m.tabela !== 'estabelecimento') await e.executar(`DELETE FROM ${m.tabela} WHERE id = ?`, [m.id]);
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    });
    await nucleo.encerrar();
  });

  const nova = (n: Partial<NovaApac> = {}): NovaApac => ({
    paciente,
    prontuario: 977001,
    registro: atendimento,
    atendimento: null,
    sigtap,
    procedimento: SIG,
    cidPrincipal: 'N18.0',
    cidSecundario: null,
    cidAssociado: null,
    solicitante: CPF,
    dataSolicitacao: '2025-09-02',
    justificativa: 'Justificativa fictícia do laudo.',
    nefrologia: {
      caracteristicaTratamento: dom[0]!,
      contraindicacaoTransplante: dom[1]!,
      situacaoTransplante: dom[2]!,
      acessoVascular: dom[3]!,
      inicioTratamento: '2025-08-01',
    },
    por: 'teste',
    ...n,
  });

  it('inclui a APAC (laudo, autorização solicitada e terapia renal) e a lê como a memória', async () => {
    const a = await gravar((g) => g.incluirApac(nova()));
    expect(a).toMatchObject({
      situacao: 'solicitada',
      paciente,
      prontuario: 977001,
      registro: atendimento,
      atendimento: 977001,
      sigtap,
      procedimento: SIG,
      cidPrincipal: 'N180',
      solicitante: CPF,
      dataSolicitacao: '2025-09-02',
      laudoEspecifico: 'nefrologia',
      numero: null,
      versao: 1,
    });
    expect(a.nefrologia?.inicioTratamento).toBe('2025-08-01');
    const p = await ler((l) => l.paginaApacs({ pagina: 0, porPagina: 10 }));
    expect(p.total).toBe(1);
    expect(p.porSituacao).toEqual({ solicitada: 1 });
    expect(await contar('SELECT COUNT(*) AS n FROM autorizacao_apac WHERE laudo_apac_id = ?', [a.id])).toBe(1);
  });

  it('autoriza, confere a versão e o número único, continua e entra na competência', async () => {
    const [a] = (await ler((l) => l.paginaApacs({ pagina: 0, porPagina: 10 }))).itens;
    const aut = {
      acao: 'autorizar' as const,
      numero: '3525000000017',
      tipo: 'inicial' as const,
      autorizador: '700000000000005',
      dataAutorizacao: '2025-09-03',
      competenciaInicial: '202509',
      competenciaFinal: '202511',
    };
    const r = await gravar((g) => g.mudarApac({ id: a!.id, versao: a!.versao, por: 'teste', mudanca: aut }));
    expect(r.antes.situacao).toBe('solicitada');
    expect(r.depois).toMatchObject({
      situacao: 'autorizada',
      numero: '3525000000017',
      tipo: 'inicial',
      competenciaInicial: '202509',
      competenciaFinal: '202511',
      ultimaCompetencia: '202509',
      versao: 2,
    });
    await expect(
      gravar((g) => g.mudarApac({ id: a!.id, versao: 1, por: 'teste', mudanca: aut })),
    ).rejects.toMatchObject({ codigo: 'apac-alterada' });
    const b = await gravar((g) => g.incluirApac(nova({ nefrologia: null })));
    expect(b.laudoEspecifico).toBe('nenhum');
    await expect(
      gravar((g) => g.mudarApac({ id: b.id, versao: b.versao, por: 'teste', mudanca: aut })),
    ).rejects.toMatchObject({ codigo: 'apac-numero-duplicado' });
    const c = await gravar((g) =>
      g.mudarApac({ id: a!.id, versao: 2, por: 'teste', mudanca: { acao: 'continuar', ultimaCompetencia: '202510' } }),
    );
    expect(c.depois.ultimaCompetencia).toBe('202510');
    expect((await ler((l) => l.apacsDaCompetencia('202510'))).map((x) => x.id)).toEqual([a!.id]);
    expect(await ler((l) => l.apacsDaCompetencia('202511'))).toEqual([]);
    expect((await ler((l) => l.paginaApacs({ competencia: '202509', pagina: 0, porPagina: 5 }))).total).toBe(1);
    const can = await gravar((g) =>
      g.mudarApac({ id: b.id, versao: b.versao, por: 'teste', mudanca: { acao: 'cancelar', justificativa: 'Duplicada.' } }),
    );
    expect(can.depois).toMatchObject({ situacao: 'cancelada', justificativaSituacao: 'Duplicada.' });
  });

  it('corrige sem apagar o complemento e recusa o encerramento sem o motivo no catálogo', async () => {
    const b = await gravar((g) => g.incluirApac(nova()));
    const r = await gravar((g) =>
      g.mudarApac({
        id: b.id,
        versao: b.versao,
        por: 'teste',
        mudanca: {
          acao: 'corrigir',
          cidPrincipal: 'N18.5',
          cidSecundario: 'I10',
          cidAssociado: null,
          solicitante: CPF,
          dataSolicitacao: '2025-09-04',
          justificativa: 'Corrigida.',
          nefrologia: null,
        },
      }),
    );
    expect(r.depois).toMatchObject({ cidPrincipal: 'N185', cidSecundario: 'I10', laudoEspecifico: 'nenhum' });
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM laudo_apac_nefrologia WHERE laudo_apac_id = ? AND excluido_em IS NOT NULL',
        [b.id],
      ),
    ).toBe(1);
    const [a] = (await ler((l) => l.paginaApacs({ situacao: 'autorizada', pagina: 0, porPagina: 5 }))).itens;
    const erro = await gravar((g) =>
      g.mudarApac({
        id: a!.id,
        versao: a!.versao,
        por: 'teste',
        mudanca: { acao: 'encerrar', motivo: '99', dataEncerramento: '2025-10-20', ultimaCompetencia: '202510' },
      }),
    ).catch((e: unknown) => e);
    expect(textoDoErro(erro)).toContain('catalogo-incompleto');
    expect(textoDoErro(erro)).toContain('motivo de cobrança');
    expect((await ler((l) => l.apac(a!.id)))?.situacao).toBe('autorizada');
  });

  it('grava o retorno por linha (sem repetir), soma no cabeçalho e trata com a versão', async () => {
    const base: RetornoSusParaGravar = {
      instrumento: 'bpa',
      competencia: '202509',
      identificacao: 'L0001',
      procedimento: SIG,
      aih: null,
      linhaBpa: null,
      arquivo: null,
      situacao: 'glosada',
      motivo: 'Motivo fictício',
      valorApresentado: 100,
      valorAprovado: 60,
      valorGlosado: 40,
      arquivoRetorno: 'retorno-ficticio.txt',
      hashRetorno: 'a'.repeat(64),
      por: 'teste',
    };
    const id = await gravar((g) => g.inserirRetornoSus(base));
    expect(id).toBeGreaterThan(0);
    expect(await gravar((g) => g.inserirRetornoSus(base))).toBeNull();
    await gravar((g) =>
      g.inserirRetornoSus({ ...base, identificacao: 'L0002', situacao: 'aprovada', valorGlosado: 0, motivo: null }),
    );
    const p = await ler((l) => l.paginaRetornos({ competencia: '202509', pagina: 0, porPagina: 10 }));
    expect(p.total).toBe(2);
    expect(p.porSituacao).toEqual({ glosada: 1, aprovada: 1 });
    expect(p.valorGlosado).toBe(40);
    expect(p.itens.map((x) => x.tratamento).sort()).toEqual(['aceita', 'pendente']);
    expect(
      await contar(
        "SELECT quantidade_registros AS n FROM retorno_sus WHERE estabelecimento_id = ? AND quantidade_glosados = 1 AND valor_glosado = 40",
        [est],
      ),
    ).toBe(2);
    const r = await ler((l) => l.retornoSus(id!));
    expect(r).toMatchObject({ identificacao: 'L0001', procedimento: SIG, situacao: 'glosada', versao: 1 });
    await gravar((g) =>
      g.tratarRetornoSus({ id: id!, versao: 1 }, { decisao: 'aceita', justificativa: 'Aceita.', por: 'teste', aih: null }),
    );
    expect((await ler((l) => l.retornoSus(id!)))?.tratamento).toBe('aceita');
    await expect(
      gravar((g) =>
        g.tratarRetornoSus({ id: id!, versao: 1 }, { decisao: 'aceita', justificativa: 'x', por: 'teste', aih: null }),
      ),
    ).rejects.toMatchObject({ codigo: 'versao-alterada' });
    const semPonte = await gravar((g) => g.aplicarRetornoNaAih(1, 'aprovada', 'teste')).catch((e: unknown) => e);
    expect(textoDoErro(semPonte)).toContain('modelo-pendente');
    expect(await ler((l) => l.ultimoRetornoDaAih(1))).toBeNull();
  });
});
