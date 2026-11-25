// Contrato de efeito da RAAS (F8, 06-SUS linha 64) contra o MariaDB real (cliente de teste). Massa SINTÉTICA:
// estabelecimento com o código do teste e CNES fictício, paciente e profissional fictícios (CNS sintéticos) e dois
// destinos sintéticos da lista do motivo de saída (removidos na limpeza); procedimento da atenção psicossocial (instrumento
// 09), CID-10, CBO e usuário são ids já existentes do cliente (só lidos). Prova o que fica no banco: o registro incluído
// na competência RAAS aberta aqui, a recusa do repetido e do procedimento de outro instrumento, as ações lançadas e a
// retirada sem apagar, a crítica gravada por regra (aviso, bloqueante, corrigida), a remessa recusada com bloqueante e
// gerada com arquivo guardado, registro em `arquivo`, hash e substituição, o registro exportado travado, a continuação
// na competência seguinte e a conclusão com destino; o isolamento por estabelecimento.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { conferirEstrutura, LEIAUTE_RAAS } from '@sgh/dominio-faturamento';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { armazemSusMemoria } from './armazem.js';
import { PortaRaasPropria } from './raas-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c2124raas';
const P2 = 'c2124raas2';
const NOME_PF = 'Pessoa sintética c2124';

async function limpar(e: Escritor): Promise<void> {
  const est = `SELECT id FROM estabelecimento WHERE codigo IN (?, ?)`;
  const reg = `SELECT id FROM registro_raas WHERE estabelecimento_id IN (${est})`;
  await e.executar(`DELETE FROM critica_sus WHERE registro_raas_id IN (${reg})`, [P, P2]);
  await e.executar(`DELETE FROM registro_raas_procedimento WHERE registro_raas_id IN (${reg})`, [P, P2]);
  await e.executar(
    `UPDATE registro_raas SET continuacao_registro_raas_id = NULL, remessa_raas_id = NULL
      WHERE estabelecimento_id IN (${est})`,
    [P, P2],
  );
  await e.executar(`DELETE FROM registro_raas WHERE estabelecimento_id IN (${est})`, [P, P2]);
  await e.executar(
    `UPDATE remessa_raas SET substituta_remessa_raas_id = NULL WHERE estabelecimento_id IN (${est})`,
    [P, P2],
  );
  await e.executar(`DELETE FROM remessa_raas WHERE estabelecimento_id IN (${est})`, [P, P2]);
  await e.executar(`DELETE FROM arquivo WHERE estabelecimento_id IN (${est})`, [P, P2]);
  await e.executar(`DELETE FROM competencia_sus WHERE estabelecimento_id IN (${est})`, [P, P2]);
  await e.executar(`DELETE FROM sequencia_negocio WHERE estabelecimento_id IN (${est})`, [P, P2]);
  await e.executar(`DELETE FROM dominio_sus WHERE lista = 'motivo_saida' AND codigo LIKE 'C2124%'`);
  await e.executar(
    `DELETE p FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id WHERE pf.nome LIKE ?`,
    [`${NOME_PF}%`],
  );
  await e.executar(
    `DELETE p FROM profissional p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id WHERE pf.nome LIKE ?`,
    [`${NOME_PF}%`],
  );
  await e.executar('DELETE FROM pessoa_fisica WHERE nome LIKE ?', [`${NOME_PF}%`]);
  await limparTrilhaDaMassa(e, { codigos: [P, P2] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, P2]);
}

async function codigoDoErro(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'sem-erro';
  } catch (e) {
    const x = e as { problema?: { status?: number; codigo?: string }; message?: string };
    return `${x.problema?.status ?? ''} ${x.problema?.codigo ?? x.message ?? ''}`.trim();
  }
}

describe.skipIf(SEM_BANCO)('PortaRaasPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaRaasPropria;
  const armazem = armazemSusMemoria();
  let m: {
    u1: number;
    paciente: number;
    profissional: number;
    proc: string;
    cid: string;
    cbo: string;
    destino: number;
  };
  const ctx = (hospital = P) => ({ cliente: CLIENTE, hospital, usuario: m.u1, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const versaoDe = async (id: number) =>
    Number((await ler('SELECT versao FROM registro_raas WHERE id = ?', [id]))[0]!['versao']);

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const us = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const pr = await e.uma(
        `SELECT ps.codigo_sigtap FROM procedimento_sigtap ps
           JOIN procedimento_sigtap_registro g ON g.procedimento_sigtap_id = ps.id AND g.vigencia_fim IS NULL
           JOIN dominio_sigtap d ON d.id = g.instrumento_dominio_sigtap_id
          WHERE d.lista = 'instrumento_registro' AND d.codigo_sigtap = '09'
            AND NOT EXISTS (SELECT 1 FROM procedimento_sigtap_registro g2 JOIN dominio_sigtap d2
                              ON d2.id = g2.instrumento_dominio_sigtap_id
                             WHERE g2.procedimento_sigtap_id = ps.id AND d2.codigo_sigtap = '08')
          ORDER BY ps.id LIMIT 1`,
      );
      const cid = await e.uma(
        `SELECT t.codigo_termo FROM termo_terminologia t JOIN terminologia g ON g.id = t.terminologia_id
          WHERE g.codigo = 'cid10' AND t.codigo_termo REGEXP '^F[0-9]{2}[.]?[0-9]$' ORDER BY t.id LIMIT 1`,
      );
      const cbo = await e.uma(
        `SELECT codigo_cbo FROM ocupacao_cbo WHERE codigo_cbo REGEXP '^[0-9]{6}$' ORDER BY id LIMIT 1`,
      );
      if (!us?.['id'] || !pr || !cid || !cbo) throw new Error('Catálogos do cliente de teste incompletos.');
      const novoEst = (cod: string, cnes: string) =>
        e.inserir(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, codigo_cnes, fuso_horario, criado_em)
           VALUES (?, ?, ?, ?, 'America/Sao_Paulo', ?)`,
          [cod, `Hospital sintético ${cod}`, `Hospital sintético ${cod} (fictício)`, cnes, agora],
        );
      await novoEst(P, '9912401');
      await novoEst(P2, '9912402');
      const pfPac = await e.inserir(
        'INSERT INTO pessoa_fisica (nome, cns, data_nascimento, criado_em) VALUES (?, ?, ?, ?)',
        [`${NOME_PF} paciente`, '798765432100001', '1980-03-04', agora],
      );
      const paciente = await e.inserir(
        "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, 99212401, 'ativo', ?)",
        [pfPac, agora],
      );
      const pfPro = await e.inserir('INSERT INTO pessoa_fisica (nome, cns, criado_em) VALUES (?, ?, ?)', [
        `${NOME_PF} profissional`,
        '898765432100002',
        agora,
      ]);
      const profissional = await e.inserir(
        "INSERT INTO profissional (pessoa_fisica_id, tipo, observacao, criado_em) VALUES (?, 'corpo_clinico', 'teste', ?)",
        [pfPro, agora],
      );
      const destino = await e.inserir(
        `INSERT INTO dominio_sus (lista, codigo, descricao, ativo, criado_em)
         VALUES ('motivo_saida', 'C2124A', 'Destino sintético', TRUE, ?)`,
        [agora],
      );
      return {
        u1: Number(us['id']),
        paciente,
        profissional,
        proc: String(pr['codigo_sigtap']),
        cid: String(cid['codigo_termo']),
        cbo: String(cbo['codigo_cbo']),
        destino,
      };
    });
    porta = new PortaRaasPropria(nucleo, CLIENTE, armazem);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await nucleo.encerrar?.();
  });

  const acao = (x: Record<string, unknown> = {}) => ({
    procedimento: m.proc,
    cbo: m.cbo,
    profissional: m.profissional,
    dataInicio: '2026-01-10',
    quantidade: 2,
    local: 'unidade',
    ...x,
  });

  it('registro, ações, crítica, remessa, continuação e conclusão deixam o efeito certo no banco', async () => {
    const r = await porta.incluirRegistro(ctx(), {
      tipo: 'atencao_psicossocial',
      competencia: '202601',
      paciente: m.paciente,
      dataAdmissao: '2025-12-20',
      cidPrincipal: m.cid,
    });
    expect(r.numero).toMatch(/^RA-\d+$/);
    const [linha] = await ler(
      `SELECT r.situacao, r.tipo_raas, cs.instrumento, cs.competencia, cs.situacao AS sc
         FROM registro_raas r JOIN competencia_sus cs ON cs.id = r.competencia_sus_id WHERE r.id = ?`,
      [r.id],
    );
    expect(linha).toMatchObject({
      situacao: 'aberto',
      tipo_raas: 'atencao_psicossocial',
      instrumento: 'raas',
      competencia: '202601',
      sc: 'aberta',
    });

    // Repetido no mesmo tipo e competência: recusa; outro estabelecimento não enxerga o registro.
    expect(
      await codigoDoErro(
        porta.incluirRegistro(ctx(), {
          tipo: 'atencao_psicossocial',
          competencia: '202601',
          paciente: m.paciente,
          dataAdmissao: '2025-12-20',
          cidPrincipal: m.cid,
        }),
      ),
    ).toMatch(/^422/);
    expect(await codigoDoErro(porta.detalhe(ctx(P2), r.id))).toMatch(/^404/);

    // Ações: duas iguais (aviso), uma fora da competência recusada sem gravar.
    const a1 = await porta.lancarAcao(ctx(), r.id, { ...acao(), versao: await versaoDe(r.id) });
    const a2 = await porta.lancarAcao(ctx(), r.id, { ...acao(), versao: await versaoDe(r.id) });
    expect([a1.sequencia, a2.sequencia]).toEqual([1, 2]);
    expect(
      await codigoDoErro(
        porta.lancarAcao(ctx(), r.id, {
          ...acao({ dataInicio: '2026-02-01' }),
          versao: await versaoDe(r.id),
        }),
      ),
    ).toMatch(/^422/);
    expect(
      (
        await ler('SELECT COUNT(*) AS n FROM registro_raas_procedimento WHERE registro_raas_id = ?', [r.id])
      )[0],
    ).toEqual({
      n: 2,
    });

    // Registro da atenção domiciliar do mesmo paciente: o procedimento da psicossocial é recusado.
    const d = await porta.incluirRegistro(ctx(), {
      tipo: 'atencao_domiciliar',
      competencia: '202601',
      paciente: m.paciente,
      dataAdmissao: '2026-01-02',
      cidPrincipal: m.cid,
    });
    expect(
      await codigoDoErro(porta.lancarAcao(ctx(), d.id, { ...acao(), versao: await versaoDe(d.id) })),
    ).toMatch(/^422/);

    // Crítica: aviso de ação repetida na psicossocial; bloqueante de registro sem ação na domiciliar.
    const k1 = await porta.criticar(ctx(), { competencia: '202601', tipo: 'atencao_psicossocial' });
    expect(k1).toMatchObject({ registros: 1, criticas: 1, bloqueantes: 0, corrigidas: 0 });
    const k2 = await porta.criticar(ctx(), { competencia: '202601', tipo: 'atencao_domiciliar' });
    expect(k2).toMatchObject({ registros: 1, bloqueantes: 1 });
    const criticas = await ler<{
      codigo_regra: string;
      gravidade: string;
      situacao: string;
      registro_raas_id: number;
    }>(
      `SELECT codigo_regra, gravidade, situacao, registro_raas_id FROM critica_sus
        WHERE registro_raas_id IN (?, ?) ORDER BY id`,
      [r.id, d.id],
    );
    expect(criticas.map((x) => [x.codigo_regra, x.gravidade, x.situacao])).toEqual([
      ['raas.acao-repetida', 'aviso', 'aberta'],
      ['raas.sem-acao', 'bloqueante', 'aberta'],
    ]);
    const remessaDomiciliar = porta.gerarRemessa(ctx(), {
      competencia: '202601',
      tipo: 'atencao_domiciliar',
      orgaoDestino: 'Secretaria sintética',
      indicadorDestino: 'M',
    });
    expect(await codigoDoErro(remessaDomiciliar)).toMatch(/^422/);
    expect(
      (
        await ler(
          `SELECT COUNT(*) AS n FROM remessa_raas WHERE tipo_raas = 'atencao_domiciliar'
                        AND estabelecimento_id = (SELECT id FROM estabelecimento WHERE codigo = ?)`,
          [P],
        )
      )[0],
    ).toEqual({
      n: 0,
    });

    // Retirar a ação repetida marca excluído (nada apagado) e a crítica que sumiu passa a corrigida.
    const [v2] = await ler('SELECT versao FROM registro_raas_procedimento WHERE id = ?', [a2.id]);
    await porta.retirarAcao(ctx(), a2.id, { versao: Number(v2!['versao']) });
    const [ret] = await ler(
      'SELECT excluido_em IS NOT NULL AS x, excluido_por FROM registro_raas_procedimento WHERE id = ?',
      [a2.id],
    );
    expect(ret).toEqual({ x: 1, excluido_por: m.u1 });
    const k3 = await porta.criticar(ctx(), { competencia: '202601', tipo: 'atencao_psicossocial' });
    expect(k3).toMatchObject({ criticas: 0, corrigidas: 1 });
    expect((await ler('SELECT situacao FROM critica_sus WHERE registro_raas_id = ?', [r.id]))[0]).toEqual({
      situacao: 'corrigida',
    });

    // Remessa: arquivo guardado, registro em `arquivo`, hash, registro exportado; a segunda substitui a primeira.
    const corpoRemessa = {
      competencia: '202601',
      tipo: 'atencao_psicossocial',
      orgaoDestino: 'Secretaria sintética',
      indicadorDestino: 'M',
    };
    const g1 = await porta.gerarRemessa(ctx(), corpoRemessa);
    expect(g1).toMatchObject({ registros: 1, substituidas: 0 });
    expect(conferirEstrutura(LEIAUTE_RAAS, g1.conteudo)).toEqual([]);
    const [rem] = await ler(
      `SELECT x.situacao, x.quantidade_registros, x.quantidade_procedimentos, x.hash_sha256, a.hash_sha256 AS ha,
              a.entidade_id, a.imutavel, a.retencao_ate IS NOT NULL AS guarda, a.chave_armazenamento
         FROM remessa_raas x JOIN arquivo a ON a.id = x.arquivo_id WHERE x.id = ?`,
      [g1.id],
    );
    expect(rem).toMatchObject({
      situacao: 'gerada',
      quantidade_registros: 1,
      hash_sha256: g1.hash,
      ha: g1.hash,
      entidade_id: g1.id,
      imutavel: 1,
      guarda: 1,
    });
    expect(Number(rem!['quantidade_procedimentos'])).toBe(2);
    expect(armazem.fixados.has(String(rem!['chave_armazenamento']))).toBe(true);
    expect(
      (await ler('SELECT situacao, remessa_raas_id FROM registro_raas WHERE id = ?', [r.id]))[0],
    ).toEqual({
      situacao: 'exportado',
      remessa_raas_id: g1.id,
    });
    const g2 = await porta.gerarRemessa(ctx(), corpoRemessa);
    expect(g2.substituidas).toBe(1);
    expect(
      (await ler('SELECT situacao, substituta_remessa_raas_id FROM remessa_raas WHERE id = ?', [g1.id]))[0],
    ).toEqual({
      situacao: 'substituida',
      substituta_remessa_raas_id: g2.id,
    });
    expect(
      await codigoDoErro(porta.lancarAcao(ctx(), r.id, { ...acao(), versao: await versaoDe(r.id) })),
    ).toMatch(/^422/);

    // Continuação na competência seguinte (uma vez só) e conclusão com destino.
    const c = await porta.continuar(ctx(), r.id, { versao: await versaoDe(r.id) });
    expect(c.competencia).toBe('202602');
    const [cont] = await ler(
      `SELECT r.continuacao_registro_raas_id, r.situacao, DATE_FORMAT(r.data_admissao, '%Y-%m-%d') AS adm,
              cs.competencia, cs.instrumento
         FROM registro_raas r JOIN competencia_sus cs ON cs.id = r.competencia_sus_id WHERE r.id = ?`,
      [c.id],
    );
    expect(cont).toEqual({
      continuacao_registro_raas_id: r.id,
      situacao: 'aberto',
      adm: '2025-12-20',
      competencia: '202602',
      instrumento: 'raas',
    });
    expect(await codigoDoErro(porta.continuar(ctx(), r.id, { versao: await versaoDe(r.id) }))).toMatch(
      /^422/,
    );
    expect(
      await codigoDoErro(
        porta.concluir(ctx(), c.id, {
          dataConclusao: '2026-03-01',
          destino: m.destino,
          versao: await versaoDe(c.id),
        }),
      ),
    ).toMatch(/^422/);
    await porta.concluir(ctx(), c.id, {
      dataConclusao: '2026-02-10',
      destino: m.destino,
      versao: await versaoDe(c.id),
    });
    expect(
      (
        await ler(
          `SELECT DATE_FORMAT(data_conclusao, '%Y-%m-%d') AS d, destino_dominio_sus_id AS x FROM registro_raas WHERE id = ?`,
          [c.id],
        )
      )[0],
    ).toEqual({ d: '2026-02-10', x: m.destino });
    expect(await codigoDoErro(porta.continuar(ctx(), c.id, { versao: await versaoDe(c.id) }))).toMatch(
      /^422/,
    );

    // Painel: a visão do paciente traz os três registros; a da competência, as remessas.
    const pac = await porta.painel(ctx(), '202601', null, m.paciente);
    expect(pac.registros.map((x) => x.competencia).sort()).toEqual(['202601', '202601', '202602']);
    const comp = await porta.painel(ctx(), '202601', 'atencao_psicossocial', null);
    expect(comp.remessas.map((x) => x.situacao)).toEqual(['gerada', 'substituida']);
    expect(comp.criticadaEm).not.toBeNull();
  });
});
