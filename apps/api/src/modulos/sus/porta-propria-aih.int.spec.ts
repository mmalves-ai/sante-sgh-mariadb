// Integração da AIH própria (porta-propria-aih.ts) contra o MariaDB real (cliente f22_o3, com a migração 93_aih_tela).
// Contrato de efeito: o laudo vira autorização "solicitada" (internação, paciente, SIGTAP, caráter do domínio SUS,
// solicitante pela chave do cadastro); autorizar dá o número e a faixa; negar e cancelar guardam o motivo; fechar cria a
// conta da AIH (fechamento 1) com os procedimentos, a diária de UTI e a OPM; reabrir deixa a conta "reaberta" e o
// fechamento seguinte é uma conta nova que aponta a anterior; o arquivo do SISAIH grava a remessa e apresenta a AIH
// (competência e remessa na conta). Versão velha e situação errada são recusadas sem mudar nada; número em uso também.
// Leituras: aih, por número, das internações, para apresentar, a página com filtros e a contagem por situação, os
// itens do fechamento e o isolamento por estabelecimento. Massa SINTÉTICA, limpa no fim (a internação fica, reaproveitada).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { createHash, randomUUID } from 'node:crypto';
import {
  definirOperacao,
  type Escritor,
  ErroOperacao,
  NucleoProprio,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { numeroAih } from '@sgh/dominio-faturamento';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  GravacoesAihPropria,
  LeiturasAihPropria,
  PonteAihPropria,
  TABELAS_SUS_AIH,
} from './porta-propria-aih.js';
import type { PonteAihDoRetorno } from './porta-propria-apac-retorno.js';
import { type AihMontada, criticasTetoDiariasUti } from './montagem-aih.js';
import { GravacaoSusPropria, LeituraSusPropria, TABELAS_SUS } from './porta-propria.js';
import { ErroAih, type NovoArquivoSus } from './tipos.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'T93AIH';
const SIG_P = '0303069301';
const SIG_U = '0802019301';
const SIG_O = '0702049301';
const CPF = '93093093000';
const CARATER = 'T93-ELETIVO';
const BASE = 930_093_000_000n;
const TIPO_UTI = '9302';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO)('AIH própria contra o MariaDB (cliente f22_o3)', () => {
  let nucleo: NucleoProprio;
  const ids = { est: 0, estB: 0, internacao: 0, paciente: 0, sigP: 0, sigU: 0, sigO: 0, faixa: 0, habUti: 0 };
  const correlacao = `t93-aih-${Date.now()}`;

  async function gravar<T>(
    est: number,
    fn: (g: GravacoesAihPropria, tx: TxOperacao) => Promise<T>,
  ): Promise<T> {
    let saida: { v: T } | null = null;
    let recusada: unknown = null;
    const op = definirOperacao({
      nome: 'faturamento.sus.gravacao',
      tabelas: [...TABELAS_SUS, ...TABELAS_SUS_AIH],
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        try {
          saida = { v: await fn(new GravacoesAihPropria(tx, est), tx) };
        } catch (erro) {
          recusada = erro;
          throw erro;
        }
        return {} as ResultadoOperacao;
      },
      alvo: () => ({ tabela: 'autorizacao_internacao_sus', id: null }),
    });
    const chave = `sus:${randomUUID()}`;
    try {
      await nucleo
        .criarExecutor()
        .executar(
          op,
          CLIENTE,
          { chave },
          { cliente: CLIENTE, estabelecimento: est, usuario: null, correlacao, chaveIdempotencia: chave },
        );
    } catch (erro) {
      throw recusada ?? erro;
    }
    return (saida as unknown as { v: T }).v;
  }
  const ler = <T>(est: number, fn: (l: LeiturasAihPropria) => Promise<T>) =>
    nucleo.lerSomente({ cliente: CLIENTE, estabelecimento: est, correlacao }, (l) =>
      fn(new LeiturasAihPropria(l, est)),
    );
  const contar = async (sql: string, p: unknown[]) =>
    Number(
      (await nucleo.lerSomente({ cliente: CLIENTE, correlacao }, (l) => l.uma<{ n: number }>(sql, p)))?.n ??
        0,
    );

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't93-aih-limpa' }, async (e) => {
      for (const est of [ids.est, ids.estB].filter(Boolean)) {
        for (const t of ['conta_aih_procedimento', 'conta_aih_opm', 'diaria_uti_sus'])
          await e.executar(
            `DELETE x FROM ${t} x JOIN conta_aih c ON c.id = x.conta_aih_id WHERE c.estabelecimento_id = ?`,
            [est],
          );
        await e.executar('UPDATE conta_aih SET anterior_conta_aih_id = NULL WHERE estabelecimento_id = ?', [
          est,
        ]);
        await e.executar('DELETE FROM conta_aih WHERE estabelecimento_id = ?', [est]);
        await e.executar('DELETE FROM autorizacao_internacao_sus WHERE estabelecimento_id = ?', [est]);
        await e.executar('DELETE FROM remessa_sisaih WHERE estabelecimento_id = ?', [est]);
        await e.executar(
          'DELETE k FROM critica_sus k JOIN competencia_sus c ON c.id = k.competencia_sus_id WHERE c.estabelecimento_id = ?',
          [est],
        );
        await e.executar('DELETE FROM competencia_sus WHERE estabelecimento_id = ?', [est]);
        await e.executar('DELETE FROM faixa_numeracao_aih WHERE estabelecimento_id = ?', [est]);
        await e.executar(
          "DELETE FROM idempotencia_operacao WHERE operacao = 'faturamento.sus.gravacao' AND estabelecimento_id = ?",
          [est],
        );
      }
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't93-aih-massa' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, codigo_cnes, criado_em) VALUES (?, ?, ?, NULL, ?)',
          [codigo, `Hospital fictício ${codigo}`, `Hospital fictício ${codigo} (teste)`, agora],
        );
      ids.est = await est(`${P}A`);
      ids.estB = await est(`${P}B`);
      const grupo = (nivel: string, codigo: string, pai: number | null) =>
        garantir(
          e,
          'SELECT id FROM grupo_sigtap WHERE codigo_sigtap = ? AND vigencia_inicio = ?',
          [codigo, '2008-01-01'],
          `INSERT INTO grupo_sigtap (nivel, codigo_sigtap, pai_grupo_sigtap_id, descricao, vigencia_inicio, versao_fonte, criado_em)
           VALUES (?, ?, ?, ?, '2008-01-01', 'teste', ?)`,
          [nivel, codigo, pai, `Grupo fictício ${codigo}`, agora],
        );
      const forma = async (codigo: string) => {
        const g = await grupo('grupo', codigo.slice(0, 2), null);
        const sg = await grupo('subgrupo', codigo.slice(0, 4), g);
        return grupo('forma_organizacao', codigo.slice(0, 6), sg);
      };
      const proc = async (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM procedimento_sigtap WHERE codigo_sigtap = ?',
          [codigo],
          `INSERT INTO procedimento_sigtap (codigo_sigtap, descricao, grupo_sigtap_id, sexo, vigencia_inicio, versao_fonte, criado_em)
           VALUES (?, ?, ?, 'ambos', '2008-01-01', 'teste', ?)`,
          [codigo, `Procedimento fictício ${codigo}`, await forma(codigo), agora],
        );
      ids.sigP = await proc(SIG_P);
      ids.sigU = await proc(SIG_U);
      // F7 (06-SUS linha 59): o tipo de UTI do SIH (código improvável) e a habilitação do tipo desde janeiro.
      const tipoUti = await garantir(
        e,
        "SELECT id FROM dominio_sus WHERE lista = 'tipo_leito_uti' AND codigo = ?",
        [`${P}-UTI2`],
        `INSERT INTO dominio_sus (lista, codigo, codigo_oficial, descricao, criado_em)
         VALUES ('tipo_leito_uti', ?, ?, 'UTI adulto tipo II (teste)', ?)`,
        [`${P}-UTI2`, TIPO_UTI, agora],
      );
      await e.executar('DELETE FROM leito_uti_habilitado WHERE estabelecimento_id = ?', [ids.est]);
      ids.habUti = await e.inserir(
        `INSERT INTO leito_uti_habilitado (estabelecimento_id, tipo_uti_dominio_sus_id, quantidade_leitos, vigencia_inicio, criado_em)
         VALUES (?, ?, 5, '2026-01-01', ?)`,
        [ids.est, tipoUti, agora],
      );
      ids.sigO = await proc(SIG_O);
      await garantir(
        e,
        "SELECT id FROM dominio_sus WHERE lista = 'carater_atendimento' AND codigo = ?",
        [CARATER],
        "INSERT INTO dominio_sus (lista, codigo, codigo_oficial, descricao, criado_em) VALUES ('carater_atendimento', ?, NULL, 'ELETIVO FICTICIO', ?)",
        [CARATER, agora],
      );
      const pessoa = (nome: string, nasc: string, cpf: string | null) =>
        garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, data_nascimento, cpf, criado_em) VALUES (?, ?, ?, ?)',
          [nome, nasc, cpf, agora],
        );
      const pp = await pessoa(`PACIENTE SINTETICO ${P}`, '1958-03-04', null);
      const pm = await pessoa(`MEDICO SOLICITANTE SINTETICO ${P}`, '1970-01-01', CPF);
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pp],
        "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, ?, 'ativo', ?)",
        [pp, 930_093_001, agora],
      );
      const prof = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pm],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pm, agora],
      );
      const um = (tabela: string, cod: string, ins: string, pi: unknown[]) =>
        garantir(e, `SELECT id FROM ${tabela} WHERE codigo = ?`, [cod], ins, pi);
      const ua = await garantir(
        e,
        'SELECT id FROM unidade_assistencial WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-UA`],
        "INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em) VALUES (?, ?, 'INTERNACAO T93', 'internacao', ?)",
        [ids.est, `${P}-UA`, agora],
      );
      const ui = await garantir(
        e,
        'SELECT id FROM unidade_internacao WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-UI`],
        "INSERT INTO unidade_internacao (estabelecimento_id, unidade_assistencial_id, codigo, descricao, tipo, criado_em) VALUES (?, ?, ?, 'ENFERMARIA T93', 'enfermaria', ?)",
        [ids.est, ua, `${P}-UI`, agora],
      );
      const bloco = await garantir(
        e,
        'SELECT id FROM bloco_internacao WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, 'B1'],
        'INSERT INTO bloco_internacao (estabelecimento_id, codigo, nome, criado_em) VALUES (?, ?, ?, ?)',
        [ids.est, 'B1', 'BLOCO T93', agora],
      );
      const cat = await um(
        'categoria_acomodacao',
        `${P}-ENF`,
        "INSERT INTO categoria_acomodacao (codigo, descricao, tipo, criado_em) VALUES (?, 'ENFERMARIA T93', 'enfermaria', ?)",
        [`${P}-ENF`, agora],
      );
      const acomodacao = await garantir(
        e,
        'SELECT id FROM acomodacao WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, 'ENF1'],
        `INSERT INTO acomodacao (estabelecimento_id, bloco_internacao_id, unidade_internacao_id, categoria_acomodacao_id, codigo, nome,
           quantidade_leitos, criado_em) VALUES (?, ?, ?, ?, 'ENF1', 'ENFERMARIA 1', 2, ?)`,
        [ids.est, bloco, ui, cat, agora],
      );
      const tiss = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['M2'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('M2', 'CARATER T93', 'teste', ?)",
        [agora],
      );
      const catAt = await um(
        'categoria_atendimento',
        `${P}-INT`,
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, 'INTERNACAO T93', 'internacao', ?)",
        [`${P}-INT`, agora],
      );
      const carater = await um(
        'carater_admissao',
        `${P}-ELE`,
        "INSERT INTO carater_admissao (codigo, descricao, urgencia, criado_em) VALUES (?, 'ELETIVA T93', FALSE, ?)",
        [`${P}-ELE`, agora],
      );
      const modal = await um(
        'modalidade_internacao',
        `${P}-CLI`,
        "INSERT INTO modalidade_internacao (codigo, descricao, criado_em) VALUES (?, 'CLINICA T93', ?)",
        [`${P}-CLI`, agora],
      );
      const esp = await um(
        'especialidade_medica',
        `${P}-CLM`,
        "INSERT INTO especialidade_medica (codigo, descricao, criado_em) VALUES (?, 'CLINICA MEDICA T93', ?)",
        [`${P}-CLM`, agora],
      );
      const fonte = await um(
        'fonte_pagadora',
        `${P}-SUS`,
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, 'SUS FICTICIO T93', 'operadora', 'ativa', ?)",
        [`${P}-SUS`, agora],
      );
      const existente = await e.uma<{ id: number }>(
        'SELECT id FROM internacao WHERE estabelecimento_id = ? AND numero = ?',
        [ids.est, `${P}-IN1`],
      );
      if (existente) ids.internacao = Number(existente.id);
      else {
        const entrada = new Date('2026-03-02T10:00:00Z');
        const at = await e.inserir(
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id, carater_atendimento_tiss_id,
             fonte_pagadora_id, profissional_id, entrada_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [ids.est, `${P}-AT1`, ids.paciente, catAt, tiss, fonte, prof, entrada, agora],
        );
        ids.internacao = await e.inserir(
          `INSERT INTO internacao (estabelecimento_id, numero, atendimento_id, paciente_id, data_hora_entrada, carater_admissao_id,
             modalidade_internacao_id, unidade_internacao_id, acomodacao_id, especialidade_medica_id,
             medico_assistente_profissional_id, fonte_pagadora_id, situacao, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ativa', ?)`,
          [
            ids.est,
            `${P}-IN1`,
            at,
            ids.paciente,
            entrada,
            carater,
            modal,
            ui,
            acomodacao,
            esp,
            prof,
            fonte,
            agora,
          ],
        );
      }
    });
    await limpar();
    ids.faixa = await gravar(ids.est, (_g, tx) =>
      new GravacaoSusPropria(tx, ids.est).inserirFaixaAih({
        inicio: BASE,
        fim: BASE + 99n,
        orgaoEmissor: 'T93',
        dataLiberacao: '2026-01-01',
        por: 'FATURISTA.SINT',
      }),
    );
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    await limpar();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't93-aih-limpa-uti' }, async (e) => {
      await e.executar('DELETE FROM leito_uti_habilitado WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM capacidade_leito_sus WHERE estabelecimento_id = ?', [ids.est]);
    });
    await nucleo.encerrar?.();
  });

  const laudo = () => ({
    registro: ids.internacao,
    prontuario: 930_093_001,
    conta: null,
    atendimento: null,
    procedimentoSolicitado: SIG_P,
    cidPrincipal: 'I21',
    cidSecundario: 'I10',
    carater: CARATER,
    solicitante: CPF,
    dataLaudo: '2026-03-02',
    justificativa: 'Justificativa sintética do laudo',
    por: 'FATURISTA.SINT',
  });

  it('o ciclo inteiro: laudo, autorização, fechamento, reabertura, novo fechamento e apresentação no SISAIH', async () => {
    const id = await gravar(ids.est, (g) => g.inserirAih(laudo()));
    let a = await ler(ids.est, (l) => l.aih(id));
    expect(a).toMatchObject({
      situacao: 'solicitada',
      registro: ids.internacao,
      prontuario: 930_093_001,
      procedimentoSolicitado: SIG_P,
      cidPrincipal: 'I21',
      cidSecundario: 'I10',
      carater: CARATER,
      solicitante: CPF,
      dataLaudo: '2026-03-02',
      justificativa: 'Justificativa sintética do laudo',
      numero: null,
      fechamento: 0,
      versao: 1,
    });
    expect(await ler(ids.est, (l) => l.solicitanteAih(CPF))).toMatchObject({ cpf: CPF });
    expect(await ler(ids.est, (l) => l.aihsDasInternacoes([ids.internacao]))).toHaveLength(1);

    const numero = numeroAih(BASE + 1n);
    // Versão velha: recusa e nada muda.
    await expect(
      gravar(ids.est, (g) =>
        g.autorizarAih(
          { id, versao: 9 },
          {
            faixa: ids.faixa,
            numero,
            autorizador: '700000000000005',
            dataAutorizacao: '2026-03-03',
            por: 'x',
          },
        ),
      ),
    ).rejects.toBeInstanceOf(ErroAih);
    await gravar(ids.est, (g) =>
      g.autorizarAih(
        { id, versao: 1 },
        { faixa: ids.faixa, numero, autorizador: '700000000000005', dataAutorizacao: '2026-03-03', por: 'x' },
      ),
    );
    a = await ler(ids.est, (l) => l.aih(id));
    expect(a).toMatchObject({
      situacao: 'autorizada',
      numero,
      faixa: ids.faixa,
      cnsAutorizador: '700000000000005',
      dataAutorizacao: '2026-03-03',
      versao: 2,
    });
    expect((await ler(ids.est, (l) => l.aihPorNumero(numero)))?.id).toBe(id);

    // Outro laudo não pode usar o mesmo número.
    const outro = await gravar(ids.est, (g) => g.inserirAih(laudo()));
    await expect(
      gravar(ids.est, (g) =>
        g.autorizarAih(
          { id: outro, versao: 1 },
          { faixa: ids.faixa, numero, autorizador: '', dataAutorizacao: '2026-03-03', por: 'x' },
        ),
      ),
    ).rejects.toMatchObject({ codigo: 'numero-em-uso' });
    await gravar(ids.est, (g) => g.negarAih({ id: outro, versao: 1 }, 'Negada pelo gestor (teste)'));
    expect(await ler(ids.est, (l) => l.aih(outro))).toMatchObject({
      situacao: 'negada',
      justificativaSituacao: 'Negada pelo gestor (teste)',
      versao: 2,
    });
    expect(await ler(ids.est, (l) => l.aihsDasInternacoes([ids.internacao]))).toHaveLength(1);

    const itens = [
      {
        tipo: 'principal' as const,
        procedimento: SIG_P,
        sigtap: null,
        quantidade: 1,
        cbo: null,
        item: null,
        tipoUti: null,
        opm: null,
      },
      {
        tipo: 'diaria-uti' as const,
        procedimento: SIG_U,
        sigtap: ids.sigU,
        quantidade: 3,
        cbo: null,
        item: null,
        tipoUti: 2,
        opm: null,
      },
      {
        tipo: 'opm' as const,
        procedimento: SIG_O,
        sigtap: ids.sigO,
        quantidade: 1,
        cbo: null,
        item: null,
        tipoUti: null,
        opm: {
          cnpjFornecedor: '11222333000181',
          notaFiscal: 'NF93',
          registroAnvisa: 'ANV93',
          serie: 'S93',
          lote: 'L93',
        },
      },
    ];
    const fechar = {
      procedimentoRealizado: SIG_P,
      permanencia: 10,
      diariasUti: 3,
      diariasUtiAnterior: 0,
      itens,
      por: 'x',
    };
    await expect(
      gravar(ids.est, (g) => g.fecharAih({ id, versao: 2, fechamento: 1 }, fechar)),
    ).rejects.toBeInstanceOf(ErroAih);
    // As diárias de UTI por competência (F7, 06-SUS linha 59): uma passagem de janeiro a fevereiro partida em duas.
    const diariasCompetencia = [
      {
        tipo: Number(TIPO_UTI),
        procedimento: SIG_U,
        competencia: '202601',
        dataEntrada: '2026-01-30',
        dataSaida: '2026-02-01',
        diarias: 2,
        unidade: null,
      },
      {
        tipo: Number(TIPO_UTI),
        procedimento: SIG_U,
        competencia: '202602',
        dataEntrada: '2026-02-01',
        dataSaida: '2026-02-02',
        diarias: 1,
        unidade: null,
      },
    ];
    await gravar(ids.est, (g) =>
      g.fecharAih({ id, versao: 2, fechamento: 0 }, { ...fechar, diariasCompetencia }),
    );
    expect(
      await nucleo.lerSomente({ cliente: CLIENTE, correlacao }, (l) =>
        l.consultar(
          `SELECT d.sequencia, d.competencia, d.tipo_uti, d.nivel, d.leito_uti_habilitado_id AS hab,
                  DATE_FORMAT(d.data_entrada, '%Y-%m-%d') AS entrada, DATE_FORMAT(d.data_saida, '%Y-%m-%d') AS saida,
                  d.quantidade_lancada AS lancada, d.quantidade_cortada AS cortada, d.quantidade_cobrada AS cobrada,
                  d.procedimento_sigtap_id AS sig, d.criado_por
             FROM diaria_uti_sus d JOIN conta_aih c ON c.id = d.conta_aih_id
            WHERE c.autorizacao_internacao_sus_id = ? ORDER BY d.sequencia`,
          [id],
        ),
      ),
    ).toEqual([
      {
        sequencia: 1,
        competencia: '202601',
        tipo_uti: 'adulto',
        nivel: 2,
        hab: ids.habUti,
        entrada: '2026-01-30',
        saida: '2026-02-01',
        lancada: 2,
        cortada: 0,
        cobrada: 2,
        sig: ids.sigU,
        criado_por: null,
      },
      {
        sequencia: 2,
        competencia: '202602',
        tipo_uti: 'adulto',
        nivel: 2,
        hab: ids.habUti,
        entrada: '2026-02-01',
        saida: '2026-02-02',
        lancada: 1,
        cortada: 0,
        cobrada: 1,
        sig: ids.sigU,
        criado_por: null,
      },
    ]);
    a = await ler(ids.est, (l) => l.aih(id));
    expect(a).toMatchObject({
      situacao: 'fechada',
      fechamento: 1,
      procedimentoRealizado: SIG_P,
      permanencia: 10,
      diariasUti: 3,
      versao: 3,
    });
    const lidos = await ler(ids.est, (l) => l.itensAih(id, 1));
    expect(lidos.map((x) => [x.sequencia, x.tipo, x.procedimento, x.quantidade, x.tipoUti])).toEqual([
      [1, 'principal', SIG_P, 1, null],
      [2, 'diaria-uti', SIG_U, 3, 2],
      [3, 'opm', SIG_O, 1, null],
    ]);
    expect(lidos[2]?.opm).toEqual({
      cnpjFornecedor: '11222333000181',
      notaFiscal: 'NF93',
      registroAnvisa: 'ANV93',
      serie: 'S93',
      lote: 'L93',
    });

    // Reabrir: a conta fica (reaberta, com o motivo); o fechamento seguinte é outra conta que aponta a anterior.
    await gravar(ids.est, (g) => g.reabrirAih({ id, versao: 3 }, 'Correção do procedimento (teste)'));
    a = await ler(ids.est, (l) => l.aih(id));
    expect(a).toMatchObject({
      situacao: 'autorizada',
      fechamento: 1,
      justificativaSituacao: 'Correção do procedimento (teste)',
      versao: 4,
    });
    await gravar(ids.est, (g) =>
      g.fecharAih({ id, versao: 4, fechamento: 1 }, { ...fechar, itens: itens.slice(0, 1) }),
    );
    a = await ler(ids.est, (l) => l.aih(id));
    expect(a).toMatchObject({ situacao: 'fechada', fechamento: 2, justificativaSituacao: null, versao: 5 });
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM conta_aih WHERE autorizacao_internacao_sus_id = ? AND situacao = 'reaberta'",
        [id],
      ),
    ).toBe(1);
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM conta_aih WHERE autorizacao_internacao_sus_id = ? AND anterior_conta_aih_id IS NOT NULL',
        [id],
      ),
    ).toBe(1);
    expect(await ler(ids.est, (l) => l.itensAih(id, 2))).toHaveLength(1);
    expect(await ler(ids.est, (l) => l.itensAih(id, 1))).toHaveLength(3);

    // Página: filtros e contagem por situação; o outro estabelecimento não vê nada.
    const pag = await ler(ids.est, (l) => l.paginaAihs({ pagina: 0, porPagina: 10 }));
    expect(pag.total).toBe(2);
    expect(pag.porSituacao).toEqual({ fechada: 1, negada: 1 });
    expect(
      (await ler(ids.est, (l) => l.paginaAihs({ situacao: 'negada', pagina: 0, porPagina: 10 }))).itens.map(
        (x) => x.id,
      ),
    ).toEqual([outro]);
    expect(
      (
        await ler(ids.est, (l) => l.paginaAihs({ numero: numero.slice(0, 8), pagina: 0, porPagina: 10 }))
      ).itens.map((x) => x.id),
    ).toEqual([id]);
    expect(
      (
        await ler(ids.est, (l) =>
          l.paginaAihs({ prontuario: 930_093_001, registro: ids.internacao, pagina: 0, porPagina: 1 }),
        )
      ).itens,
    ).toHaveLength(1);
    expect(await ler(ids.estB, (l) => l.paginaAihs({ pagina: 0, porPagina: 10 }))).toEqual({
      itens: [],
      total: 0,
      porSituacao: {},
    });
    expect(await ler(ids.estB, (l) => l.aih(id))).toBeNull();

    // Apresentação no SISAIH.
    expect((await ler(ids.est, (l) => l.aihsParaApresentar('202603'))).map((x) => x.id)).toEqual([id]);
    const comp = await gravar(ids.est, (_g, tx) =>
      new GravacaoSusPropria(tx, ids.est).abrir({ instrumento: 'aih', competencia: '202603', por: 'x' }),
    );
    const arq = await gravar(ids.est, (_g, tx) => new GravacaoSusPropria(tx, ids.est).proximoArquivo());
    const conteudo = `SISAIH sintetico ${arq}`;
    const sha = createHash('sha256').update(conteudo).digest('hex');
    const novo: NovoArquivoSus = {
      id: arq,
      competencia: { id: comp.id, instrumento: 'aih', competencia: '202603' },
      leiaute: 'TESTE',
      versaoLeiaute: '1.0',
      conferidoOficial: true,
      nome: `AIH${arq}.TXT`,
      linhas: 1,
      registros: 1,
      procedimentos: 1,
      semMovimento: false,
      hash: sha,
      bytes: conteudo.length,
      chaveObjeto: `sus/${P}/aih/202603/${arq}-${sha.slice(0, 16)}.txt`,
      versaoObjeto: null,
      por: 'x',
    };
    await expect(
      gravar(ids.est, (g) => g.gravarArquivoSisaih(novo, [{ id, versao: 4 }])),
    ).rejects.toBeInstanceOf(ErroAih);
    expect(
      await contar('SELECT COUNT(*) AS n FROM remessa_sisaih WHERE estabelecimento_id = ?', [ids.est]),
    ).toBe(0);
    const r = await gravar(ids.est, (g) => g.gravarArquivoSisaih(novo, [{ id, versao: 5 }]));
    expect(r.substituidos).toBe(0);
    a = await ler(ids.est, (l) => l.aih(id));
    expect(a).toMatchObject({
      situacao: 'apresentada',
      competenciaApresentacao: '202603',
      arquivo: arq,
      versao: 6,
    });
    expect(await contar('SELECT quantidade_aih AS n FROM remessa_sisaih WHERE id = ?', [r.remessa])).toBe(1);
    expect((await ler(ids.est, (l) => l.aihsParaApresentar('202603'))).map((x) => x.id)).toEqual([id]);
    expect(await ler(ids.est, (l) => l.aihsParaApresentar('202604'))).toEqual([]);

    // Apresentada não se cancela nem reabre.
    await expect(gravar(ids.est, (g) => g.cancelarAih({ id, versao: 6 }, 'x'))).rejects.toBeInstanceOf(
      ErroAih,
    );
    await expect(gravar(ids.est, (g) => g.reabrirAih({ id, versao: 6 }, 'x'))).rejects.toBeInstanceOf(
      ErroAih,
    );
  }, 120_000);

  it('cancelar: da solicitada (autorização) e da fechada (conta e autorização), com o motivo', async () => {
    const s = await gravar(ids.est, (g) => g.inserirAih(laudo()));
    await gravar(ids.est, (g) => g.cancelarAih({ id: s, versao: 1 }, 'Laudo em duplicidade (teste)'));
    expect(await ler(ids.est, (l) => l.aih(s))).toMatchObject({
      situacao: 'cancelada',
      justificativaSituacao: 'Laudo em duplicidade (teste)',
    });

    const f = await gravar(ids.est, (g) => g.inserirAih(laudo()));
    await gravar(ids.est, (g) =>
      g.autorizarAih(
        { id: f, versao: 1 },
        {
          faixa: ids.faixa,
          numero: numeroAih(BASE + 2n),
          autorizador: '',
          dataAutorizacao: '2026-03-04',
          por: 'x',
        },
      ),
    );
    await gravar(ids.est, (g) =>
      g.fecharAih(
        { id: f, versao: 2, fechamento: 0 },
        {
          procedimentoRealizado: SIG_P,
          permanencia: 2,
          diariasUti: 0,
          diariasUtiAnterior: 0,
          itens: [],
          por: 'x',
        },
      ),
    );
    await gravar(ids.est, (g) => g.cancelarAih({ id: f, versao: 3 }, 'Conta cancelada (teste)'));
    expect(await ler(ids.est, (l) => l.aih(f))).toMatchObject({
      situacao: 'cancelada',
      justificativaSituacao: 'Conta cancelada (teste)',
      versao: 4,
    });
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM conta_aih WHERE autorizacao_internacao_sus_id = ? AND situacao = 'cancelada'",
        [f],
      ),
    ).toBe(1);
    // Laudo sem solicitante no cadastro ou de internação de outro estabelecimento: recusado.
    await expect(
      gravar(ids.est, (g) => g.inserirAih({ ...laudo(), solicitante: '00000000000' })),
    ).rejects.toMatchObject({
      problema: { codigo: 'solicitante-inexistente' },
    });
    await expect(gravar(ids.estB, (g) => g.inserirAih(laudo()))).rejects.toMatchObject({
      codigo: 'nao-encontrado',
    });
    // Caráter fora do domínio do SUS: recusado já no laudo (antes de consumir número da faixa), nada gravado.
    const antes = await contar(
      'SELECT COUNT(*) AS n FROM autorizacao_internacao_sus WHERE estabelecimento_id = ?',
      [ids.est],
    );
    await expect(
      gravar(ids.est, (g) => g.inserirAih({ ...laudo(), carater: 'T93-NAO-EXISTE' })),
    ).rejects.toMatchObject({
      problema: { codigo: 'carater-inexistente' },
    });
    expect(
      await contar('SELECT COUNT(*) AS n FROM autorizacao_internacao_sus WHERE estabelecimento_id = ?', [
        ids.est,
      ]),
    ).toBe(antes);
  }, 120_000);

  it('cancelar depois de fechar e reabrir: a justificativa é a do cancelamento, não a da reabertura', async () => {
    const f = await gravar(ids.est, (g) => g.inserirAih(laudo()));
    await gravar(ids.est, (g) =>
      g.autorizarAih(
        { id: f, versao: 1 },
        {
          faixa: ids.faixa,
          numero: numeroAih(BASE + 3n),
          autorizador: '',
          dataAutorizacao: '2026-03-04',
          por: 'x',
        },
      ),
    );
    await gravar(ids.est, (g) =>
      g.fecharAih(
        { id: f, versao: 2, fechamento: 0 },
        {
          procedimentoRealizado: SIG_P,
          permanencia: 2,
          diariasUti: 0,
          diariasUtiAnterior: 0,
          itens: [],
          por: 'x',
        },
      ),
    );
    await gravar(ids.est, (g) => g.reabrirAih({ id: f, versao: 3 }, 'Motivo R da reabertura (teste)'));
    expect(await ler(ids.est, (l) => l.aih(f))).toMatchObject({
      situacao: 'autorizada',
      justificativaSituacao: 'Motivo R da reabertura (teste)',
    });
    await gravar(ids.est, (g) => g.cancelarAih({ id: f, versao: 4 }, 'Motivo C do cancelamento (teste)'));
    expect(await ler(ids.est, (l) => l.aih(f))).toMatchObject({
      situacao: 'cancelada',
      justificativaSituacao: 'Motivo C do cancelamento (teste)',
      versao: 5,
    });
  }, 120_000);

  it('retorno do gestor pela ponte: aprovar, rejeitar e reapresentar (conta nova, a rejeitada fica)', async () => {
    // Pelo contrato da ponte (o que a gravação do retorno chama), com o "por" da tela.
    const ponte: PonteAihDoRetorno = new PonteAihPropria();
    const id = await gravar(ids.est, (g) => g.inserirAih(laudo()));
    // Fora de apresentada: o retorno não muda nada.
    expect(
      await gravar(ids.est, (_g, tx) => ponte.aplicarRetornoNaAih(tx, ids.est, id, 'aprovada', 'x')),
    ).toBe(false);
    await gravar(ids.est, (g) =>
      g.autorizarAih(
        { id, versao: 1 },
        {
          faixa: ids.faixa,
          numero: numeroAih(BASE + 4n),
          autorizador: '',
          dataAutorizacao: '2026-03-04',
          por: 'x',
        },
      ),
    );
    const itens = [
      {
        tipo: 'principal' as const,
        procedimento: SIG_P,
        sigtap: null,
        quantidade: 1,
        cbo: null,
        item: null,
        tipoUti: null,
        opm: null,
      },
      {
        tipo: 'opm' as const,
        procedimento: SIG_O,
        sigtap: ids.sigO,
        quantidade: 1,
        cbo: null,
        item: null,
        tipoUti: null,
        opm: {
          cnpjFornecedor: '11222333000181',
          notaFiscal: 'NF93',
          registroAnvisa: 'ANV93',
          serie: 'S93',
          lote: 'L93',
        },
      },
    ];
    await gravar(ids.est, (g) =>
      g.fecharAih(
        { id, versao: 2, fechamento: 0 },
        {
          procedimentoRealizado: SIG_P,
          permanencia: 3,
          diariasUti: 0,
          diariasUtiAnterior: 0,
          itens,
          por: 'x',
        },
      ),
    );
    await expect(gravar(ids.est, (_g, tx) => ponte.reapresentarAih(tx, ids.est, id))).rejects.toMatchObject({
      codigo: 'versao-alterada',
    });
    const comp = await gravar(ids.est, (_g, tx) =>
      new GravacaoSusPropria(tx, ids.est).abrir({ instrumento: 'aih', competencia: '202605', por: 'x' }),
    );
    const arq = await gravar(ids.est, (_g, tx) => new GravacaoSusPropria(tx, ids.est).proximoArquivo());
    const conteudo = `SISAIH sintetico retorno ${arq}`;
    const sha = createHash('sha256').update(conteudo).digest('hex');
    const novo: NovoArquivoSus = {
      id: arq,
      competencia: { id: comp.id, instrumento: 'aih', competencia: '202605' },
      leiaute: 'TESTE',
      versaoLeiaute: '1.0',
      conferidoOficial: true,
      nome: `AIH${arq}.TXT`,
      linhas: 1,
      registros: 1,
      procedimentos: 1,
      semMovimento: false,
      hash: sha,
      bytes: conteudo.length,
      chaveObjeto: `sus/${P}/aih/202605/${arq}-${sha.slice(0, 16)}.txt`,
      versaoObjeto: null,
      por: 'x',
    };
    await gravar(ids.est, (g) => g.gravarArquivoSisaih(novo, [{ id, versao: 3 }]));
    expect(await ler(ids.est, (l) => l.aih(id))).toMatchObject({
      situacao: 'apresentada',
      competenciaApresentacao: '202605',
      arquivo: arq,
      versao: 4,
    });

    expect(
      await gravar(ids.est, (_g, tx) => ponte.aplicarRetornoNaAih(tx, ids.est, id, 'aprovada', 'x')),
    ).toBe(true);
    expect(await ler(ids.est, (l) => l.aih(id))).toMatchObject({
      situacao: 'aprovada',
      competenciaApresentacao: '202605',
      versao: 5,
    });
    expect(
      await gravar(ids.est, (_g, tx) => ponte.aplicarRetornoNaAih(tx, ids.est, id, 'rejeitada', 'x')),
    ).toBe(true);
    expect(await ler(ids.est, (l) => l.aih(id))).toMatchObject({
      situacao: 'rejeitada',
      reapresentacoes: 0,
      versao: 6,
    });

    await gravar(ids.est, (_g, tx) => ponte.reapresentarAih(tx, ids.est, id));
    const a = await ler(ids.est, (l) => l.aih(id));
    expect(a).toMatchObject({
      situacao: 'fechada',
      competenciaApresentacao: null,
      arquivo: null,
      reapresentacoes: 1,
      procedimentoRealizado: SIG_P,
      permanencia: 3,
      fechamento: 2,
      versao: 7,
    });
    // A rejeitada fica com a competência e a remessa; a nova aponta para ela e traz os mesmos itens.
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM conta_aih WHERE autorizacao_internacao_sus_id = ? AND situacao = 'rejeitada' AND remessa_sisaih_id IS NOT NULL",
        [id],
      ),
    ).toBe(1);
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM conta_aih WHERE autorizacao_internacao_sus_id = ? AND anterior_conta_aih_id IS NOT NULL',
        [id],
      ),
    ).toBe(1);
    const lidos = await ler(ids.est, (l) => l.itensAih(id, 2));
    expect(lidos.map((x) => [x.sequencia, x.tipo, x.procedimento])).toEqual([
      [1, 'principal', SIG_P],
      [2, 'opm', SIG_O],
    ]);
    expect(lidos[1]?.opm).toEqual({
      cnpjFornecedor: '11222333000181',
      notaFiscal: 'NF93',
      registroAnvisa: 'ANV93',
      serie: 'S93',
      lote: 'L93',
    });
    // Reapresentar na competência em que a AIH já foi apresentada (202605): recusa de negócio 409, antes do UNIQUE do
    // banco; nada muda (a conta nova segue fechada, sem competência nem remessa).
    const arq2 = await gravar(ids.est, (_g, tx) => new GravacaoSusPropria(tx, ids.est).proximoArquivo());
    const conteudo2 = `SISAIH sintetico reapresentacao ${arq2}`;
    const sha2 = createHash('sha256').update(conteudo2).digest('hex');
    const mesma = gravar(ids.est, (g) =>
      g.gravarArquivoSisaih(
        {
          ...novo,
          id: arq2,
          nome: `AIH${arq2}.TXT`,
          hash: sha2,
          bytes: conteudo2.length,
          chaveObjeto: `sus/${P}/aih/202605/${arq2}-${sha2.slice(0, 16)}.txt`,
        },
        [{ id, versao: 7 }],
      ),
    );
    await expect(mesma).rejects.toBeInstanceOf(ErroOperacao);
    await expect(mesma).rejects.toMatchObject({
      problema: { status: 409, codigo: 'aih-reapresentada-mesma-competencia' },
    });
    expect(await ler(ids.est, (l) => l.aih(id))).toMatchObject({
      situacao: 'fechada',
      competenciaApresentacao: null,
      versao: 7,
    });
    // A leitura já deixa a reapresentada fora da competência em que a AIH foi apresentada (o arquivo dela não fica
    // bloqueado) e a oferece na seguinte.
    expect((await ler(ids.est, (l) => l.aihsParaApresentar('202605'))).map((x) => x.id)).not.toContain(id);
    expect((await ler(ids.est, (l) => l.aihsParaApresentar('202606'))).map((x) => x.id)).toContain(id);
    // Reapresentar de novo, sem estar rejeitada: recusa e nada muda.
    await expect(gravar(ids.est, (_g, tx) => ponte.reapresentarAih(tx, ids.est, id))).rejects.toMatchObject({
      codigo: 'versao-alterada',
    });
    expect(
      await contar('SELECT COUNT(*) AS n FROM conta_aih WHERE autorizacao_internacao_sus_id = ?', [id]),
    ).toBe(2);
  }, 120_000);

  it('a diária de UTI pela habilitação da competência, não pela de hoje (F7, 06-SUS linha 59)', async () => {
    // A habilitação encerrada em janeiro, antes do fechamento: janeiro passa e aponta a habilitação; fevereiro, sem
    // habilitação na competência, recusa o fechamento inteiro e nada fica.
    const vigencia = (fim: string | null) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: 't93-aih-uti-vigencia' }, (e) =>
        e.executar('UPDATE leito_uti_habilitado SET vigencia_fim = ? WHERE id = ?', [fim, ids.habUti]),
      );
    await vigencia('2026-01-31');
    try {
      expect(
        await nucleo.lerSomente({ cliente: CLIENTE, estabelecimento: ids.est, correlacao }, (l) =>
          new LeituraSusPropria(l, ids.est).habilitacoesUti(),
        ),
      ).toEqual([
        {
          id: ids.habUti,
          tipo: Number(TIPO_UTI),
          unidade: null,
          vigenciaInicio: '2026-01-01',
          vigenciaFim: '2026-01-31',
          ativo: true,
        },
      ]);
      const id = await gravar(ids.est, (g) => g.inserirAih(laudo()));
      await gravar(ids.est, (g) =>
        g.autorizarAih(
          { id, versao: 1 },
          {
            faixa: ids.faixa,
            numero: numeroAih(BASE + 5n),
            autorizador: '',
            dataAutorizacao: '2026-03-04',
            por: 'x',
          },
        ),
      );
      const fechar = {
        procedimentoRealizado: SIG_P,
        permanencia: 4,
        diariasUti: 3,
        diariasUtiAnterior: 2,
        itens: [],
        por: 'x',
      };
      const jan = {
        tipo: Number(TIPO_UTI),
        procedimento: SIG_U,
        competencia: '202601',
        dataEntrada: '2026-01-29',
        dataSaida: '2026-01-31',
        diarias: 2,
        unidade: null,
      };
      const fev = {
        ...jan,
        competencia: '202602',
        dataEntrada: '2026-02-01',
        dataSaida: '2026-02-02',
        diarias: 1,
      };
      await expect(
        gravar(ids.est, (g) =>
          g.fecharAih({ id, versao: 2, fechamento: 0 }, { ...fechar, diariasCompetencia: [jan, fev] }),
        ),
      ).rejects.toThrow(/uti-nao-habilitada/);
      expect(
        await contar('SELECT COUNT(*) AS n FROM conta_aih WHERE autorizacao_internacao_sus_id = ?', [id]),
      ).toBe(0);
      expect(await ler(ids.est, (l) => l.aih(id))).toMatchObject({ situacao: 'autorizada', versao: 2 });

      await gravar(ids.est, (g) =>
        g.fecharAih(
          { id, versao: 2, fechamento: 0 },
          { ...fechar, diariasUti: 2, diariasCompetencia: [jan] },
        ),
      );
      expect(
        await contar(
          `SELECT COUNT(*) AS n FROM diaria_uti_sus d JOIN conta_aih c ON c.id = d.conta_aih_id
            WHERE c.autorizacao_internacao_sus_id = ? AND d.leito_uti_habilitado_id = ? AND d.competencia = '202601'
              AND d.quantidade_lancada = 2 AND d.quantidade_cobrada = 2`,
          [id, ids.habUti],
        ),
      ).toBe(1);
      expect(await ler(ids.est, (l) => l.aih(id))).toMatchObject({ situacao: 'fechada', versao: 3 });
    } finally {
      await vigencia(null);
    }
  }, 120_000);

  it('o teto das diárias de UTI pela capacidade contratada do tipo (Leitos do sistema público, 04-INT linha 79)', async () => {
    // A especialidade de leito de terapia intensiva com o código do tipo de UTI do SIH e o histórico da capacidade de
    // fevereiro (inclusão de 1 leito, depois alteração para 2 com a crítica liberada, depois volta a 1 sem liberação).
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't93-aih-capacidade' }, async (e) => {
      const agora = new Date();
      const esp = await garantir(
        e,
        "SELECT id FROM especialidade_leito WHERE codigo_cnes = ? AND versao_fonte = 'teste'",
        [TIPO_UTI],
        `INSERT INTO especialidade_leito (codigo_cnes, descricao, codigo_cnes_tipo_leito, terapia_intensiva, vigencia_inicio,
                                          versao_fonte, criado_em)
         VALUES (?, 'UTI adulto tipo II (teste)', '03', TRUE, '2008-01-01', 'teste', ?)`,
        [TIPO_UTI, agora],
      );
      await e.executar('DELETE FROM capacidade_leito_sus WHERE estabelecimento_id = ?', [ids.est]);
      for (const [n, liberada, operacao, quando] of [
        [1, false, 'inclusao', '2026-02-01 10:00:00'],
        [2, true, 'alteracao', '2026-02-02 10:00:00'],
        [1, false, 'alteracao', '2026-02-03 10:00:00'],
      ] as const)
        await e.inserir(
          `INSERT INTO capacidade_leito_sus (estabelecimento_id, especialidade_leito_id, competencia, quantidade_leitos,
                                             critica_liberada, operacao, ocorrido_em, criado_em)
           VALUES (?, ?, '2026-02-01', ?, ?, ?, ?, ?)`,
          [ids.est, esp, n, liberada, operacao, quando, agora],
        );
    });
    const lidas = await nucleo.lerSomente({ cliente: CLIENTE, estabelecimento: ids.est, correlacao }, (l) =>
      new LeituraSusPropria(l, ids.est).capacidadesUti(),
    );
    expect(
      lidas.map((x) => [x.especialidade, x.competencia, x.quantidadeLeitos, x.criticaLiberada, x.operacao]),
    ).toEqual([
      [Number(TIPO_UTI), '2026-02-01', 1, false, 'inclusao'],
      [Number(TIPO_UTI), '2026-02-01', 2, true, 'alteracao'],
      [Number(TIPO_UTI), '2026-02-01', 1, false, 'alteracao'],
    ]);
    // A montagem da AIH recebe o histórico pela mesma leitura (dadosAih) e a crítica sai do domínio: 1 leito em
    // fevereiro de 2026 dá teto de 28 diárias; 30 diárias do tipo passam dele sem liberação (a vigente é a última).
    const dados = await nucleo.lerSomente({ cliente: CLIENTE, estabelecimento: ids.est, correlacao }, (l) =>
      new LeituraSusPropria(l, ids.est).dadosAih([ids.internacao], [], [], []),
    );
    expect(dados.capacidadesUti).toEqual(lidas);
    const diarias = (n: number) =>
      [
        {
          diariasCompetencia: [
            {
              tipo: Number(TIPO_UTI),
              procedimento: SIG_U,
              competencia: '202602',
              dataEntrada: '2026-02-01',
              dataSaida: '2026-02-28',
              diarias: n,
              unidade: null,
            },
          ],
        },
      ] as unknown as AihMontada[];
    expect(criticasTetoDiariasUti(diarias(30), dados.capacidadesUti ?? [])).toEqual([
      expect.objectContaining({
        regra: 'diarias-uti-acima-do-teto',
        gravidade: 'bloqueante',
        detalhe: {
          tipoUti: Number(TIPO_UTI),
          competenciaDiarias: '202602',
          diarias: 30,
          teto: 28,
          excedente: 2,
        },
      }),
    ]);
    expect(criticasTetoDiariasUti(diarias(28), dados.capacidadesUti ?? [])).toEqual([]);
  }, 120_000);
});
