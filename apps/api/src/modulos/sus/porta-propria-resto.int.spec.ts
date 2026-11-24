// Integração de porta-propria-resto.ts contra o MariaDB real (cliente f22_o3), numa operação do núcleo que declara
// TABELAS_SUS e TABELAS_SUS_RESTO (como a porta própria fará com a ligação). Contrato de efeito:
// - CIHA (comunicação de internação hospitalar): a remessa com um registro_ciha (paciente, CNS, fonte pela lista
//   fechada, datas da conta) e os procedimentos com a quantidade;
// - BPA (boletim de produção ambulatorial): uma folha por tipo e número, exportada pela remessa, com as linhas; a
//   geração nova da competência guarda as folhas novas sem apagar as da remessa substituída (chave única por remessa);
// - APAC (autorização de procedimento de alta complexidade): a apac apresentada com o número da autorização e os
//   procedimentos (principal e secundário); a geração nova também guarda a sua;
// - recusa (fonte fora da lista): nada fica, nem a remessa;
// - leituras: o médico solicitante pelo CRM e os parâmetros ambulatoriais.
// Massa SINTÉTICA: o cadastro fica (idempotente); remessas, linhas e competências são limpas no fim.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { createHash, randomUUID } from 'node:crypto';
import {
  definirOperacao,
  type Escritor,
  NucleoProprio,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { gravarRemessa, proximoNumeroArquivo } from './porta-propria-arquivos.js';
import { TABELAS_SUS } from './porta-propria.js';
import {
  contagemCiha,
  GravacoesLinhasSusPropria,
  LeiturasRestoSusPropria,
  type RegistroCihaComItens,
  TABELAS_SUS_RESTO,
} from './porta-propria-resto.js';
import type { InstrumentoSusPorta, NovoArquivoSus } from './tipos.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'F24SR';
const SIG = '0301019340';
const CRM = '924031';
const NUM_APAC = '2624024000099';
const COMP = '202603';

const sha = (t: string) => createHash('sha256').update(t).digest('hex');

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO)('linhas guardadas dos arquivos do SUS na porta própria (cliente f22_o3)', () => {
  let nucleo: NucleoProprio;
  const ids = { est: 0, conta: 0, paciente: 0, laudo: 0, cbo: '', ciha: 0, bpa: 0, apac: 0 };

  const uma = (sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${P}-conta` }, (l) =>
      l.uma<Record<string, unknown>>(sql, p),
    );
  const n = async (sql: string, p: readonly unknown[]) => Number((await uma(sql, p))?.['n'] ?? -1);

  /** Uma gravação na operação do faturamento SUS com as tabelas desta porta. */
  async function gravar<T>(fn: (tx: TxOperacao) => Promise<T>): Promise<T> {
    let saida: { v: T } | null = null;
    const op = definirOperacao({
      nome: 'faturamento.sus.gravacao',
      tabelas: [...TABELAS_SUS, ...TABELAS_SUS_RESTO],
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        saida = { v: await fn(tx) };
        return {} as ResultadoOperacao;
      },
      alvo: () => ({ tabela: 'competencia_sus', id: null }),
      trilha: () => ({ dados: { teste: P } }),
    });
    const chave = `sus:${randomUUID()}`;
    await nucleo
      .criarExecutor()
      .executar(
        op,
        CLIENTE,
        { chave },
        {
          cliente: CLIENTE,
          estabelecimento: ids.est,
          usuario: null,
          correlacao: `${P}-grava`,
          chaveIdempotencia: chave,
        },
      );
    if (!saida) throw new Error('sem resultado');
    return (saida as { v: T }).v;
  }

  const novo = (
    id: number,
    comp: number,
    instrumento: InstrumentoSusPorta,
    registros: number,
  ): NovoArquivoSus => ({
    id,
    competencia: { id: comp, instrumento, competencia: COMP },
    leiaute: 'TESTE',
    versaoLeiaute: '9.9',
    conferidoOficial: true,
    nome: `ARQ${id}.TXT`,
    linhas: registros + 1,
    registros,
    procedimentos: registros,
    semMovimento: false,
    hash: sha(`${P}-${id}`),
    bytes: 10,
    chaveObjeto: `sus/${P}/${instrumento}/${COMP}/${id}.txt`,
    versaoObjeto: null,
    por: 'FATURISTA.SINT',
  });

  async function limpar(): Promise<void> {
    if (!ids.est) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-limpa` }, async (e) => {
      const est = ids.est;
      await e.executar(
        `DELETE p FROM registro_ciha_procedimento p JOIN registro_ciha r ON r.id = p.registro_ciha_id
           JOIN remessa_ciha m ON m.id = r.remessa_ciha_id WHERE m.estabelecimento_id = ?`,
        [est],
      );
      await e.executar(
        'DELETE r FROM registro_ciha r JOIN remessa_ciha m ON m.id = r.remessa_ciha_id WHERE m.estabelecimento_id = ?',
        [est],
      );
      await e.executar(
        `DELETE i FROM producao_ambulatorial_sus_item i
           JOIN producao_ambulatorial_sus f ON f.id = i.producao_ambulatorial_sus_id WHERE f.estabelecimento_id = ?`,
        [est],
      );
      await e.executar('DELETE FROM producao_ambulatorial_sus WHERE estabelecimento_id = ?', [est]);
      await e.executar(
        'DELETE p FROM apac_procedimento p JOIN apac a ON a.id = p.apac_id WHERE a.estabelecimento_id = ?',
        [est],
      );
      await e.executar('DELETE FROM apac WHERE estabelecimento_id = ?', [est]);
      for (const t of ['remessa_ciha', 'remessa_bpa', 'remessa_apac']) {
        await e.executar(`UPDATE ${t} SET substituta_${t}_id = NULL WHERE estabelecimento_id = ?`, [est]);
        await e.executar(`DELETE FROM ${t} WHERE estabelecimento_id = ?`, [est]);
      }
      await e.executar(
        "DELETE FROM arquivo WHERE estabelecimento_id = ? AND finalidade = 'arquivo_faturamento_sus'",
        [est],
      );
      await e.executar('DELETE FROM competencia_sus WHERE estabelecimento_id = ?', [est]);
      await e.executar(
        "DELETE FROM sequencia_negocio WHERE tipo = 'arquivo_sus' AND estabelecimento_id = ?",
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
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-massa` }, async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [`${P}A`],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, codigo_cnes, criado_em) VALUES (?, ?, ?, NULL, ?)',
        [`${P}A`, `Hospital fictício ${P}A`, `Hospital fictício ${P}A (teste)`, agora],
      );
      const um = (tabela: string, cod: string, ins: string, pi: unknown[]) =>
        garantir(e, `SELECT id FROM ${tabela} WHERE codigo = ?`, [cod], ins, pi);
      const grupo = (nivel: string, codigo: string, pai: number | null) =>
        garantir(
          e,
          'SELECT id FROM grupo_sigtap WHERE codigo_sigtap = ? AND vigencia_inicio = ?',
          [codigo, '2008-01-01'],
          `INSERT INTO grupo_sigtap (nivel, codigo_sigtap, pai_grupo_sigtap_id, descricao, vigencia_inicio, versao_fonte, criado_em)
           VALUES (?, ?, ?, ?, '2008-01-01', 'teste', ?)`,
          [nivel, codigo, pai, `Grupo fictício ${codigo}`, agora],
        );
      const g = await grupo('grupo', SIG.slice(0, 2), null);
      const sg = await grupo('subgrupo', SIG.slice(0, 4), g);
      const fo = await grupo('forma_organizacao', SIG.slice(0, 6), sg);
      await garantir(
        e,
        'SELECT id FROM procedimento_sigtap WHERE codigo_sigtap = ?',
        [SIG],
        `INSERT INTO procedimento_sigtap (codigo_sigtap, descricao, grupo_sigtap_id, sexo, vigencia_inicio, versao_fonte, criado_em)
         VALUES (?, 'Procedimento fictício F24SR', ?, 'ambos', '2008-01-01', 'teste', ?)`,
        [SIG, fo, agora],
      );
      const pessoa = (nome: string, cpf: string | null, cns: string | null) =>
        garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, data_nascimento, cpf, cns, criado_em) VALUES (?, ?, ?, ?, ?)',
          [nome, '1960-05-06', cpf, cns, agora],
        );
      const pp = await pessoa(`PACIENTE SINTETICO ${P}`, null, '700000000240031');
      const pm = await pessoa(`MEDICO SINTETICO ${P}`, '24024024031', null);
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pp],
        "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, ?, 'ativo', ?)",
        [pp, 240_024_031, agora],
      );
      const prof = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pm],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pm, agora],
      );
      const crm = await e.uma<{ id: number }>("SELECT id FROM conselho_classe WHERE sigla = 'CRM'", []);
      const uf = await e.uma<{ id: number }>('SELECT MIN(id) AS id FROM unidade_federativa', []);
      const cbo = await e.uma<{ codigo_cbo: string }>(
        'SELECT codigo_cbo FROM ocupacao_cbo ORDER BY id LIMIT 1',
        [],
      );
      if (!crm || !uf?.id || !cbo) throw new Error('massa: CRM, UF ou CBO ausente no cliente de teste');
      ids.cbo = cbo.codigo_cbo;
      await garantir(
        e,
        'SELECT id FROM inscricao_conselho WHERE profissional_id = ? AND sequencia = 1',
        [prof],
        `INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id, unidade_federativa_id,
           numero_inscricao, principal, criado_em) VALUES (?, 1, ?, ?, ?, TRUE, ?)`,
        [prof, crm.id, uf.id, CRM, agora],
      );
      const fonte = await um(
        'fonte_pagadora',
        `${P}-PRIV`,
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, registro_ans, criado_em) VALUES (?, 'OPERADORA FICTICIA F24SR', 'operadora', 'ativa', '123456', ?)",
        [`${P}-PRIV`, agora],
      );
      const tiss = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['M2'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('M2', 'CARATER F24', 'teste', ?)",
        [agora],
      );
      const catAt = await um(
        'categoria_atendimento',
        `${P}-AMB`,
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, 'AMBULATORIO F24SR', 'internacao', ?)",
        [`${P}-AMB`, agora],
      );
      const tipoConta = await um(
        'tipo_conta',
        `${P}-TC`,
        "INSERT INTO tipo_conta (codigo, descricao, natureza, criado_em) VALUES (?, 'CONTA F24SR', 'ambulatorial', ?)",
        [`${P}-TC`, agora],
      );
      const at = await garantir(
        e,
        'SELECT id FROM atendimento WHERE estabelecimento_id = ? AND numero = ?',
        [ids.est, `${P}-AT1`],
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id, carater_atendimento_tiss_id,
           fonte_pagadora_id, profissional_id, entrada_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ids.est,
          `${P}-AT1`,
          ids.paciente,
          catAt,
          tiss,
          fonte,
          prof,
          new Date('2026-03-10T10:00:00Z'),
          agora,
        ],
      );
      ids.conta = await garantir(
        e,
        'SELECT id FROM conta_hospitalar WHERE estabelecimento_id = ? AND numero = ?',
        [ids.est, `${P}-C1`],
        `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id, tipo_conta_id,
           natureza, competencia, inicio_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, 'ambulatorial', '2026-03-01', ?, ?)`,
        [ids.est, `${P}-C1`, at, ids.paciente, fonte, tipoConta, new Date('2026-03-10T10:00:00Z'), agora],
      );
      const tipoLaudo = await garantir(
        e,
        'SELECT id FROM tipo_laudo_apac WHERE codigo = ?',
        [`${P}-TL`],
        "INSERT INTO tipo_laudo_apac (codigo, descricao, grupo_laudo, criado_em) VALUES (?, 'LAUDO FICTICIO F24SR', 'outro', ?)",
        [`${P}-TL`, agora],
      );
      const sigId = (
        await e.uma<{ id: number }>('SELECT id FROM procedimento_sigtap WHERE codigo_sigtap = ?', [SIG])
      )?.id;
      ids.laudo = await garantir(
        e,
        'SELECT id FROM laudo_apac WHERE estabelecimento_id = ? AND numero_laudo = ?',
        [ids.est, `${P}-L1`],
        `INSERT INTO laudo_apac (estabelecimento_id, numero_laudo, paciente_id, atendimento_id, tipo_laudo_apac_id, data_laudo,
           solicitado_procedimento_sigtap_id, codigo_cid10_principal, solicitante_profissional_id, justificativa, criado_em)
         VALUES (?, ?, ?, ?, ?, '2026-03-12', ?, 'N180', ?, 'JUSTIFICATIVA FICTICIA', ?)`,
        [ids.est, `${P}-L1`, ids.paciente, at, tipoLaudo, sigId, prof, agora],
      );
      await garantir(
        e,
        'SELECT id FROM autorizacao_apac WHERE laudo_apac_id = ?',
        [ids.laudo],
        `INSERT INTO autorizacao_apac (estabelecimento_id, laudo_apac_id, data_solicitacao, numero_apac, tipo_apac, criado_em)
         VALUES (?, ?, '2026-03-12', ?, 'inicial', ?)`,
        [ids.est, ids.laudo, NUM_APAC, agora],
      );
    });
    await limpar();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-comp` }, async (e) => {
      const agora = new Date();
      for (const i of ['ciha', 'bpa', 'apac'] as const)
        ids[i] = await e.inserir(
          `INSERT INTO competencia_sus (estabelecimento_id, instrumento, competencia, periodo_inicio, periodo_fim, aberta_em,
             criado_em) VALUES (?, ?, ?, '2026-03-01', '2026-03-31', ?, ?)`,
          [ids.est, i, COMP, agora, agora],
        );
    });
  });

  afterAll(async () => {
    if (nucleo) {
      await limpar();
      await nucleo.encerrar();
    }
  });

  const registro = (fonte: string): RegistroCihaComItens => ({
    modalidade: 'ambulatorial',
    conta: ids.conta,
    atendimento: null,
    registro: null,
    fonte,
    cidPrincipal: 'N180',
    procedimentoPrincipal: SIG,
    procedimentos: 1,
    itens: [{ codigo: SIG, quantidade: 2 }],
  });

  it('CIHA: grava o registro com paciente, CNS, fonte da lista, data da conta e o procedimento com a quantidade', async () => {
    const regs = [registro('plano-privado')];
    const r = await gravar(async (tx) => {
      const id = await proximoNumeroArquivo(tx);
      const { remessa } = await gravarRemessa(
        tx,
        ids.est,
        novo(id, ids.ciha, 'ciha', 1),
        'ciha',
        contagemCiha(regs),
      );
      return {
        remessa,
        gravados: await new GravacoesLinhasSusPropria(tx, ids.est).registrosCiha(remessa, regs),
      };
    });
    expect(r.gravados).toBe(1);
    const x = await uma(
      `SELECT r.sequencia, r.tipo_registro, r.paciente_id, r.cns IS NOT NULL AS tem_cns, r.cpf IS NULL AS sem_cpf,
              DATE_FORMAT(r.data_atendimento, '%Y-%m-%d') AS data, d.codigo_oficial, m.quantidade_registro_ambulatorial AS amb,
              (SELECT SUM(p.quantidade) FROM registro_ciha_procedimento p WHERE p.registro_ciha_id = r.id) AS qtd
         FROM registro_ciha r JOIN remessa_ciha m ON m.id = r.remessa_ciha_id
         JOIN dominio_sus d ON d.id = r.fonte_remuneracao_dominio_sus_id WHERE m.id = ?`,
      [r.remessa],
    );
    expect(x).toMatchObject({
      sequencia: 1,
      tipo_registro: 'ambulatorial',
      data: '2026-03-10',
      codigo_oficial: '1',
    });
    expect(Number(x?.['paciente_id'])).toBe(ids.paciente);
    expect(Number(x?.['tem_cns'])).toBe(1);
    expect(Number(x?.['sem_cpf'])).toBe(1);
    expect(Number(x?.['amb'])).toBe(1);
    expect(Number(x?.['qtd'])).toBe(2);
  });

  it('CIHA: a fonte fora da lista recusa e nada fica (nem a remessa)', async () => {
    const antes = await n('SELECT COUNT(*) AS n FROM remessa_ciha WHERE estabelecimento_id = ?', [ids.est]);
    await expect(
      gravar(async (tx) => {
        const id = await proximoNumeroArquivo(tx);
        const { remessa } = await gravarRemessa(tx, ids.est, novo(id, ids.ciha, 'ciha', 1), 'ciha', {});
        return new GravacoesLinhasSusPropria(tx, ids.est).registrosCiha(remessa, [
          registro('fonte-inventada'),
        ]);
      }),
    ).rejects.toThrow();
    expect(await n('SELECT COUNT(*) AS n FROM remessa_ciha WHERE estabelecimento_id = ?', [ids.est])).toBe(
      antes,
    );
  });

  it('BPA: uma folha por tipo e número, com as linhas; a geração nova guarda as suas e a anterior fica', async () => {
    const linhas = [
      { tipo: 'c' as const, folha: 1, sequencia: 1, idade: 40, data: null },
      { tipo: 'c' as const, folha: 1, sequencia: 2, idade: 41, data: null },
      { tipo: 'i' as const, folha: 1, sequencia: 1, idade: null, data: '2026-03-10' },
    ].map((x) => ({
      ...x,
      procedimento: SIG,
      cbo: ids.cbo,
      quantidade: 3,
      conta: ids.conta,
      atendimento: null,
      registro: null,
    }));
    const gerar = () =>
      gravar(async (tx) => {
        const id = await proximoNumeroArquivo(tx);
        const { remessa } = await gravarRemessa(tx, ids.est, novo(id, ids.bpa, 'bpa', 3), 'bpa', {
          tipo_bpa: 'misto',
          quantidade_registros: 3,
        });
        return {
          remessa,
          folhas: await new GravacoesLinhasSusPropria(tx, ids.est).folhasBpa(remessa, ids.bpa, linhas),
        };
      });
    const a = await gerar();
    expect(a.folhas).toBe(2);
    const b = await gerar();
    expect(b.folhas).toBe(2);
    const por = async (remessa: number) =>
      uma(
        `SELECT COUNT(DISTINCT f.id) AS folhas, COUNT(i.id) AS linhas, SUM(i.quantidade) AS qtd,
                SUM(f.situacao = 'exportada') AS exportadas, SUM(i.paciente_id IS NOT NULL) AS com_paciente
           FROM producao_ambulatorial_sus f JOIN producao_ambulatorial_sus_item i ON i.producao_ambulatorial_sus_id = f.id
          WHERE f.remessa_bpa_id = ?`,
        [remessa],
      );
    for (const r of [a.remessa, b.remessa]) {
      const x = await por(r);
      expect(
        [x?.['folhas'], x?.['linhas'], x?.['qtd'], x?.['exportadas'], x?.['com_paciente']].map(Number),
      ).toEqual([2, 3, 9, 3, 3]);
    }
    const sit = await uma('SELECT situacao FROM remessa_bpa WHERE id = ?', [a.remessa]);
    expect(sit?.['situacao']).toBe('substituida');
  });

  it('APAC: a apac apresentada com o número da autorização e os procedimentos; a geração nova guarda a sua', async () => {
    const linhas = [
      { principal: true, quantidade: 1 },
      { principal: false, quantidade: 4 },
    ].map((x) => ({
      ...x,
      apac: ids.laudo,
      tipoNoArquivo: '1' as const,
      procedimento: SIG,
      cbo: ids.cbo,
      conta: ids.conta,
    }));
    const gerar = () =>
      gravar(async (tx) => {
        const id = await proximoNumeroArquivo(tx);
        const { remessa } = await gravarRemessa(tx, ids.est, novo(id, ids.apac, 'apac', 1), 'apac', {
          competencia_apresentacao: '2026-03-01',
          quantidade_apac: 1,
        });
        const apacs = await new GravacoesLinhasSusPropria(tx, ids.est).apacsDaRemessa(
          remessa,
          { id: ids.apac, competencia: COMP },
          linhas,
        );
        return { remessa, apacs };
      });
    const a = await gerar();
    const b = await gerar();
    expect([a.apacs, b.apacs]).toEqual([1, 1]);
    for (const r of [a.remessa, b.remessa]) {
      const x = await uma(
        `SELECT a.numero_apac, a.tipo_apac, a.situacao, a.codigo_cid10_principal,
                DATE_FORMAT(a.data_inicio, '%Y-%m-%d') AS inicio, DATE_FORMAT(a.data_fim, '%Y-%m-%d') AS fim,
                SUM(p.tipo = 'principal') AS principais, SUM(p.quantidade) AS qtd
           FROM apac a JOIN apac_procedimento p ON p.apac_id = a.id WHERE a.remessa_apac_id = ?
          GROUP BY a.id`,
        [r],
      );
      expect(x).toMatchObject({
        numero_apac: NUM_APAC,
        tipo_apac: 'inicial',
        situacao: 'apresentada',
        codigo_cid10_principal: 'N180',
        inicio: '2026-03-01',
        fim: '2026-03-31',
      });
      expect([Number(x?.['principais']), Number(x?.['qtd'])]).toEqual([1, 5]);
    }
  });

  it('leituras: o médico solicitante pelo CRM e os parâmetros ambulatoriais do banco', async () => {
    const r = await nucleo.lerSomente(
      { cliente: CLIENTE, correlacao: `${P}-ler`, estabelecimento: ids.est },
      async (l) => {
        const leit = new LeiturasRestoSusPropria(l, ids.est);
        return { med: await leit.buscarSolicitantes(CRM), par: await leit.parametrosCadastro() };
      },
    );
    const med = r.med.find((x) => x.conselho === Number(CRM));
    expect(med).toMatchObject({ conselho: Number(CRM), ativo: true });
    expect(r.par).toEqual({ competenciaAmbulatorio: COMP, versao: '9.9', orgao: 'municipal' });
  });
});
