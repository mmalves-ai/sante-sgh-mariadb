// Contrato de efeito do complemento da conta da AIH (F7, 06-SUS linha 58) contra o MariaDB real (cliente de teste).
// Massa SINTÉTICA (estabelecimento com o código do teste, paciente, profissional, procedimentos, domínio do SUS e
// habilitação fictícios; removidos na limpeza). Prova o que fica no banco: a equipe (conta_aih_profissional), os
// diagnósticos secundários (conta_aih_diagnostico) e os incrementos (conta_aih_incremento) com o valor pela SIGTAP da
// saída; a gravação pela diferença (a linha que sai fica excluída, nunca apagada, e volta a mesma ao ser incluída de
// novo); a versão da conta e a da autorização que sobem; o CID secundário da AIH lido do primeiro diagnóstico; as
// recusas (versão vista, habilitação que o hospital não tem, CNS fora do cadastro, conta apresentada) sem gravar; a
// reapresentação que leva o complemento à conta nova; a trilha de cada gravação.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { definirOperacao, type Escritor, NucleoProprio, type ResultadoOperacao } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaContaAihComplementoPropria } from './conta-aih-complemento-propria.js';
import { LeiturasAihPropria, PonteAihPropria, TABELAS_SUS_AIH } from './porta-propria-aih.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const P = 'c2121aih';
const SIG = ['0415999901', '0415999902'] as const;
const HAB = '9921';
const CBO = '225125';
/** CNS sintético com o dígito certo (soma ponderada múltipla de 11), achado na carga da massa. */
function cnsSintetico(semente: number): string {
  for (let k = 0; k < 1000; k++) {
    const corpo = `7${String(semente * 1000 + k).padStart(14, '0')}`;
    let s = 0;
    for (let i = 0; i < 15; i++) s += Number(corpo[i]) * (15 - i);
    if (s % 11 === 0) return corpo;
  }
  throw new Error('sem CNS');
}
const CNS = cnsSintetico(21210);
const CNS_NINGUEM = cnsSintetico(21219);

describe.skipIf(SEM_BANCO)('PortaContaAihComplementoPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaContaAihComplementoPropria;
  let usuario = 0;
  let est = 0;
  let aih = 0;
  let conta = 0;
  const criados: { tabela: string; id: number }[] = [];
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const versaoConta = async (id = conta) =>
    Number((await ler<{ versao: number }>('SELECT versao FROM conta_aih WHERE id = ?', [id]))[0]?.versao);
  const versaoAih = async () =>
    Number(
      (await ler<{ versao: number }>('SELECT versao FROM autorizacao_internacao_sus WHERE id = ?', [aih]))[0]
        ?.versao,
    );

  async function limpar(e: Escritor): Promise<void> {
    const ests = 'SELECT id FROM estabelecimento WHERE codigo = ?';
    await e.executar('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of [
      'conta_aih_incremento',
      'conta_aih_profissional',
      'conta_aih_diagnostico',
      'conta_aih_procedimento',
      'conta_aih_opm',
      'diaria_uti_sus',
    ])
      await e.executar(
        `DELETE x FROM ${t} x JOIN conta_aih c ON c.id = x.conta_aih_id WHERE c.estabelecimento_id IN (${ests})`,
        [P],
      );
    await e.executar(`DELETE FROM conta_aih WHERE estabelecimento_id IN (${ests})`, [P]);
    await e.executar(`DELETE FROM autorizacao_internacao_sus WHERE estabelecimento_id IN (${ests})`, [P]);
    await e.executar(`DELETE FROM remessa_sisaih WHERE estabelecimento_id IN (${ests})`, [P]);
    await e.executar(`DELETE FROM competencia_sus WHERE estabelecimento_id IN (${ests})`, [P]);
    await e.executar(`DELETE FROM internacao WHERE estabelecimento_id IN (${ests})`, [P]);
    await e.executar(`DELETE FROM habilitacao_estabelecimento WHERE estabelecimento_id IN (${ests})`, [P]);
    await limparTrilhaDaMassa(e, { codigos: [P] });
    await e.executar(`DELETE FROM idempotencia_operacao WHERE estabelecimento_id IN (${ests})`, [P]);
    await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    porta = new PortaContaAihComplementoPropria(nucleo, CLIENTE);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      const agora = new Date();
      const garantir = async (tabela: string, sel: string, sp: unknown[], ins: string, ip: unknown[]) => {
        const x = await e.uma<{ id: number }>(sel, sp);
        if (x) return Number(x.id);
        const id = await e.inserir(ins, ip);
        criados.push({ tabela, id });
        return id;
      };
      const novo = async (tabela: string, ins: string, ip: unknown[]) => {
        const id = await e.inserir(ins, ip);
        criados.push({ tabela, id });
        return id;
      };
      const u = await e.uma('SELECT id FROM usuario WHERE excluido_em IS NULL ORDER BY id LIMIT 1');
      usuario = Number(u?.['id']);
      est = await e.inserir(
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, codigo_cnes, criado_em) VALUES (?, ?, ?, ?, ?)',
        [P, 'Hospital fictício C2121', 'Hospital fictício C2121 (teste)', '9021210', agora],
      );
      const pfPac = await novo('pessoa_fisica', 'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
        'Paciente fictício C2121',
        agora,
      ]);
      const paciente = await novo(
        'paciente',
        "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, 921210, 'ativo', ?)",
        [pfPac, agora],
      );
      const pfMed = await garantir(
        'pessoa_fisica',
        'SELECT id FROM pessoa_fisica WHERE cns = ?',
        [CNS],
        'INSERT INTO pessoa_fisica (nome, cns, criado_em) VALUES (?, ?, ?)',
        ['Cirurgiã fictícia C2121', CNS, agora],
      );
      await garantir(
        'profissional',
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ? AND excluido_em IS NULL',
        [pfMed],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, observacao, criado_em) VALUES (?, 'corpo_clinico', 'teste', ?)",
        [pfMed, agora],
      );
      await garantir(
        'ocupacao_cbo',
        'SELECT id FROM ocupacao_cbo WHERE codigo_cbo = ?',
        [CBO],
        "INSERT INTO ocupacao_cbo (codigo_cbo, descricao, criado_em) VALUES (?, 'Médico clínico (teste)', ?)",
        [CBO, agora],
      );
      for (const [lista, codigo] of [
        ['atividade_profissional', 'C2121A'],
        ['credor', 'C2121C'],
      ] as const)
        await garantir(
          'dominio_sus',
          'SELECT id FROM dominio_sus WHERE lista = ? AND codigo = ?',
          [lista, codigo],
          'INSERT INTO dominio_sus (lista, codigo, descricao, criado_em) VALUES (?, ?, ?, ?)',
          [lista, codigo, `Valor fictício ${lista}`, agora],
        );
      const sig: number[] = [];
      for (const [i, codigo] of SIG.entries()) {
        const id = await garantir(
          'procedimento_sigtap',
          'SELECT id FROM procedimento_sigtap WHERE codigo_sigtap = ?',
          [codigo],
          `INSERT INTO procedimento_sigtap (codigo_sigtap, descricao, grupo_sigtap_id, sexo, vigencia_inicio, versao_fonte, criado_em)
           VALUES (?, 'Procedimento fictício C2121 (teste)', 1, 'ambos', '2008-01-01', 'teste', ?)`,
          [codigo, agora],
        );
        sig.push(id);
        await garantir(
          'procedimento_sigtap_valor',
          'SELECT id FROM procedimento_sigtap_valor WHERE procedimento_sigtap_id = ?',
          [id],
          `INSERT INTO procedimento_sigtap_valor (procedimento_sigtap_id, valor_servico_hospitalar, valor_servico_profissional,
             vigencia_inicio, versao_fonte, criado_em) VALUES (?, ?, ?, '2020-01-01', 'teste', ?)`,
          [id, i === 0 ? 1000 : 200, i === 0 ? 500 : 100, agora],
        );
      }
      const habSus = await garantir(
        'habilitacao_sus',
        'SELECT id FROM habilitacao_sus WHERE codigo_cnes = ?',
        [HAB],
        "INSERT INTO habilitacao_sus (codigo_cnes, descricao, criado_em) VALUES (?, 'Habilitação fictícia C2121', ?)",
        [HAB, agora],
      );
      await garantir(
        'habilitacao_sigtap',
        "SELECT id FROM habilitacao_sigtap WHERE tipo = 'habilitacao' AND codigo_habilitacao = ?",
        [HAB],
        `INSERT INTO habilitacao_sigtap (tipo, codigo_habilitacao, descricao, vigencia_inicio, versao_fonte, criado_em)
         VALUES ('habilitacao', ?, 'Habilitação fictícia C2121', '2020-01-01', 'teste', ?)`,
        [HAB, agora],
      );
      await e.inserir(
        `INSERT INTO habilitacao_estabelecimento (estabelecimento_id, habilitacao_sus_id, vigencia_inicio, criado_em)
         VALUES (?, ?, '2020-01-01', ?)`,
        [est, habSus, agora],
      );
      const internacao = await e.inserir(
        `INSERT INTO internacao (estabelecimento_id, numero, atendimento_id, paciente_id, data_hora_entrada,
           carater_admissao_id, modalidade_internacao_id, unidade_internacao_id, acomodacao_id, especialidade_medica_id,
           medico_assistente_profissional_id, fonte_pagadora_id, situacao, criado_em)
         VALUES (?, '921210', 1, ?, '2025-10-01 08:00:00', 1, 1, 1, 1, 1, 1, 77, 'ativa', ?)`,
        [est, paciente, agora],
      );
      aih = await e.inserir(
        `INSERT INTO autorizacao_internacao_sus (estabelecimento_id, paciente_id, internacao_id, data_solicitacao,
           solicitado_procedimento_sigtap_id, codigo_cid10_principal, codigo_cid10_secundario, situacao, numero_aih,
           data_autorizacao, criado_em)
         VALUES (?, ?, ?, '2025-10-01', ?, 'K358', 'E119', 'autorizada', '9212100000011', '2025-10-02', ?)`,
        [est, paciente, internacao, sig[0], agora],
      );
      conta = await e.inserir(
        `INSERT INTO conta_aih (estabelecimento_id, internacao_id, paciente_id, autorizacao_internacao_sus_id,
           numero_aih, numero_fechamento, data_internacao, data_saida, carater_dominio_sus_id,
           solicitado_procedimento_sigtap_id, realizado_procedimento_sigtap_id, codigo_cid10_principal, dias_permanencia,
           situacao, criado_em)
         VALUES (?, ?, ?, ?, '9212100000011', 1, '2025-10-01', '2025-10-05', 1, ?, ?, 'K358', 4, 'fechada', ?)`,
        [est, internacao, paciente, aih, sig[0], sig[0], agora],
      );
      for (const [i, tipo] of (['principal', 'secundario'] as const).entries())
        await e.executar(
          `INSERT INTO conta_aih_procedimento (conta_aih_id, sequencia, procedimento_sigtap_id, tipo, quantidade, criado_em)
           VALUES (?, ?, ?, ?, 1, ?)`,
          [conta, i + 1, sig[i], tipo, agora],
        );
      // O primeiro fechamento grava o CID secundário do laudo como o primeiro diagnóstico (como a porta da AIH faz).
      await e.executar(
        `INSERT INTO conta_aih_diagnostico (conta_aih_id, sequencia, codigo_cid10, tipo, criado_em)
         VALUES (?, 1, 'E119', 'secundario', ?)`,
        [conta, agora],
      );
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    });
    expect(usuario).toBeGreaterThan(0);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `fim-${P}` }, async (e) => {
      await limpar(e);
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      for (const m of [...criados].reverse())
        await e.executar(`DELETE FROM ${m.tabela} WHERE id = ?`, [m.id]);
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    });
    await nucleo.encerrar();
  });

  const entrada = (versao: number, mudar: Record<string, unknown> = {}) => ({
    versao,
    diagnosticos: [
      { cid: 'E11.9', tipo: 'secundario', classificacao: 'preexistente' },
      { cid: 'T81.4', tipo: 'secundario', classificacao: 'adquirido' },
    ],
    equipe: [
      {
        procedimento: 1,
        cns: CNS,
        cbo: CBO,
        atividade: 'C2121A',
        credor: 'C2121C',
        documentoCredor: '12345678000190',
      },
    ],
    incrementos: [{ habilitacao: HAB, procedimento: null, percentual: 20 }],
    ...mudar,
  });

  it('consulta a última conta com as opções da tela (procedimentos, domínio do SUS e a habilitação do hospital)', async () => {
    const r = await porta.consultar(ctx(), aih);
    expect(r.conta).toBe(conta);
    expect(r.editavel).toBe(true);
    expect(r.diagnosticos).toEqual([{ cid: 'E119', tipo: 'secundario', classificacao: null }]);
    expect(r.opcoes.procedimentos.map((p) => p.codigo)).toEqual([...SIG]);
    expect(r.opcoes.habilitacoes.map((h) => h.codigo)).toContain(HAB);
    expect(r.opcoes.atividades.map((a) => a.codigo)).toContain('C2121A');
  });

  it('grava equipe, diagnósticos e incremento com o valor pela SIGTAP; as versões sobem; a trilha fica', async () => {
    const vc = await versaoConta();
    const va = await versaoAih();
    const r = await porta.salvar(ctx(), aih, entrada(vc));
    expect(r.diagnosticos.map((d) => `${d.cid}:${d.classificacao}`)).toEqual([
      'E119:preexistente',
      'T814:adquirido',
    ]);
    expect(r.equipe).toHaveLength(1);
    expect(r.equipe[0]?.codigoProcedimento).toBe(SIG[0]);
    // 20% sobre a AIH toda: SH 1000 + 200 = 1200 → 240; SP 500 + 100 = 600 → 120.
    expect(r.incrementos[0]).toMatchObject({
      habilitacao: HAB,
      procedimento: null,
      valorServicoHospitalar: 240,
      valorServicoProfissional: 120,
      valorTotal: 360,
    });
    const prof = await ler(
      'SELECT tipo_documento_credor, documento_credor, sequencia FROM conta_aih_profissional WHERE conta_aih_id = ?',
      [conta],
    );
    expect(prof).toEqual([
      { tipo_documento_credor: 'cnpj', documento_credor: '12345678000190', sequencia: 1 },
    ]);
    expect(await versaoConta()).toBe(vc + 1);
    expect(await versaoAih()).toBe(va + 1);
    const trilha = await ler<{ n: number }>(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND entidade = 'conta_aih' AND entidade_id = ?",
      [est, conta],
    );
    expect(Number(trilha[0]?.n)).toBeGreaterThan(0);
    // O CID secundário da AIH (arquivo e tela) é o primeiro diagnóstico secundário da conta.
    const lida = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) =>
      new LeiturasAihPropria(l, est).aih(aih),
    );
    expect(lida?.cidSecundario).toBe('E119');
  });

  it('a lista sai pela diferença: a linha retirada fica excluída (não apagada) e volta a mesma', async () => {
    let vc = await versaoConta();
    await porta.salvar(
      ctx(),
      aih,
      entrada(vc, {
        diagnosticos: [{ cid: 'T81.4', tipo: 'secundario', classificacao: 'adquirido' }],
        equipe: [],
      }),
    );
    const diags = await ler<{ id: number; codigo_cid10: string; excluido: number }>(
      'SELECT id, codigo_cid10, excluido_em IS NOT NULL AS excluido FROM conta_aih_diagnostico WHERE conta_aih_id = ? ORDER BY sequencia',
      [conta],
    );
    expect(diags.map((d) => `${d.codigo_cid10}:${Number(d.excluido)}`)).toEqual(['E119:1', 'T814:0']);
    expect(
      Number(
        (
          await ler<{ n: number }>(
            'SELECT COUNT(*) AS n FROM conta_aih_profissional WHERE conta_aih_id = ? AND excluido_em IS NOT NULL',
            [conta],
          )
        )[0]?.n,
      ),
    ).toBe(1);
    vc = await versaoConta();
    const r = await porta.salvar(ctx(), aih, entrada(vc));
    expect(r.diagnosticos.map((d) => d.cid).sort()).toEqual(['E119', 'T814']);
    const depois = await ler<{ id: number }>(
      'SELECT id FROM conta_aih_diagnostico WHERE conta_aih_id = ? AND excluido_em IS NULL ORDER BY sequencia',
      [conta],
    );
    expect(depois.map((d) => Number(d.id))).toEqual(diags.map((d) => Number(d.id)));
    expect(r.equipe).toHaveLength(1);
  });

  it('recusa versão velha, habilitação que o hospital não tem e CNS fora do cadastro, sem gravar', async () => {
    const vc = await versaoConta();
    const antes = await ler('SELECT COUNT(*) AS n FROM conta_aih_incremento WHERE conta_aih_id = ?', [conta]);
    await expect(porta.salvar(ctx(), aih, entrada(vc - 1))).rejects.toMatchObject({
      problema: { status: 409 },
    });
    await expect(
      porta.salvar(
        ctx(),
        aih,
        entrada(vc, { incrementos: [{ habilitacao: '0001', procedimento: 2, percentual: 10 }] }),
      ),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await expect(
      porta.salvar(
        ctx(),
        aih,
        entrada(vc, {
          equipe: [
            {
              procedimento: 2,
              cns: CNS_NINGUEM,
              cbo: CBO,
              atividade: 'C2121A',
              credor: null,
              documentoCredor: null,
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    expect(await versaoConta()).toBe(vc);
    expect(
      await ler('SELECT COUNT(*) AS n FROM conta_aih_incremento WHERE conta_aih_id = ?', [conta]),
    ).toEqual(antes);
  });

  it('a reapresentação leva o complemento à conta nova; a conta apresentada não aceita mudança', async () => {
    // A conta apresentada numa remessa e rejeitada pelo gestor (competência e remessa fictícias).
    const apresentar = (id: number, competencia: string, situacao: string) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: P }, async (e) => {
        const agora = new Date();
        const comp = await e.inserir(
          `INSERT INTO competencia_sus (estabelecimento_id, instrumento, competencia, periodo_inicio, periodo_fim, situacao,
             aberta_em, criado_em) VALUES (?, 'aih', ?, ?, LAST_DAY(?), 'aberta', ?, ?)`,
          [
            est,
            competencia,
            `${competencia.slice(0, 4)}-${competencia.slice(4)}-01`,
            `${competencia.slice(0, 4)}-${competencia.slice(4)}-01`,
            agora,
            agora,
          ],
        );
        const remessa = await e.inserir(
          `INSERT INTO remessa_sisaih (estabelecimento_id, competencia_sus_id, numero, situacao, aberta_em, criado_em)
           VALUES (?, ?, ?, 'aberta', ?, ?)`,
          [est, comp, `92121${competencia.slice(4)}`, agora, agora],
        );
        await e.executar(
          'UPDATE conta_aih SET situacao = ?, competencia_sus_id = ?, remessa_sisaih_id = ? WHERE id = ?',
          [situacao, comp, remessa, id],
        );
      });
    await apresentar(conta, '202510', 'rejeitada');
    const op = definirOperacao({
      nome: 'faturamento.sus.gravacao',
      tabelas: [...TABELAS_SUS_AIH],
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        await new PonteAihPropria().reapresentarAih(tx, est, aih);
        return {} as ResultadoOperacao;
      },
      alvo: () => ({ tabela: 'conta_aih', id: conta }),
    });
    const chave = `${P}-${randomUUID()}`;
    await nucleo.criarExecutor().executar(
      op,
      CLIENTE,
      { chave },
      {
        cliente: CLIENTE,
        estabelecimento: est,
        usuario,
        correlacao: P,
        chaveIdempotencia: chave,
      },
    );
    const r = await porta.consultar(ctx(), aih);
    expect(r.conta).not.toBe(conta);
    expect(r.situacaoConta).toBe('fechada');
    expect(r.diagnosticos.map((d) => d.cid).sort()).toEqual(['E119', 'T814']);
    expect(r.equipe.map((x) => x.codigoProcedimento)).toEqual([SIG[0]]);
    expect(r.incrementos.map((x) => `${x.habilitacao}:${x.valorTotal}`)).toEqual([`${HAB}:360`]);
    // A conta rejeitada fica com o complemento dela (a história não muda).
    expect(
      Number(
        (
          await ler<{ n: number }>(
            'SELECT COUNT(*) AS n FROM conta_aih_diagnostico WHERE conta_aih_id = ? AND excluido_em IS NULL',
            [conta],
          )
        )[0]?.n,
      ),
    ).toBe(2);
    await apresentar(r.conta, '202511', 'apresentada');
    await expect(porta.salvar(ctx(), aih, entrada(r.versao))).rejects.toMatchObject({
      problema: { status: 422 },
    });
  });
});
