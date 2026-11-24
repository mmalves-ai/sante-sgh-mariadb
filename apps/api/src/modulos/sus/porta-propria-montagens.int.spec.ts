// Integração das montagens do faturamento SUS na porta própria (porta-propria-montagens.ts) contra o MariaDB real
// (cliente f22_o3). Massa SINTÉTICA e idempotente (fica para a próxima execução, como a internação da AIH): um
// atendimento ambulatorial de fonte privada (CIHA), um ambulatorial de fonte SUS com executante e CBO (BPA, laudo da
// APAC) e uma internação SUS com alta na competência e item com lote (AIH). Prova a leitura da produção pela conta
// própria, a SIGTAP pela equivalência vigente, o isolamento por estabelecimento e as leituras das linhas sem remessa.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, type Leitor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ApoioMontagemSus, MontagensSusPropria } from './porta-propria-montagens.js';
import { LeituraSusPropria } from './porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'F24SM';
const SIG = '0301019324';
const CPF_MED = '24024024000';
const INTERVALO = { inicio: '2026-03-01', fim: '2026-03-31' };

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

/** O apoio da porta principal (os métodos protegidos da leitura própria). */
class LeituraComApoio extends LeituraSusPropria {
  apoio(): ApoioMontagemSus {
    return {
      sigtapDosIds: (ids) => this.sigtapDosIds(ids),
      cnesCadastrados: () => this.cnesCadastrados(),
      leitosUti: () => this.leitosUti(),
      sigtapPorCodigo: (c) => this.sigtapPorCodigo(c),
    };
  }
}

describe.skipIf(SEM_BANCO)('montagens do faturamento SUS na porta própria (cliente f22_o3)', () => {
  let nucleo: NucleoProprio;
  const ids = { est: 0, estB: 0, sig: 0, privada: 0, sus: 0, atPriv: 0, atSus: 0, internacao: 0, item: 0 };

  const ler = <T>(est: number, fn: (m: MontagensSusPropria) => Promise<T>) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${P}-ler`, estabelecimento: est }, (l: Leitor) =>
      fn(new MontagensSusPropria(l, est, new LeituraComApoio(l, est).apoio())),
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-massa` }, async (e) => {
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
      ids.sig = await garantir(
        e,
        'SELECT id FROM procedimento_sigtap WHERE codigo_sigtap = ?',
        [SIG],
        `INSERT INTO procedimento_sigtap (codigo_sigtap, descricao, grupo_sigtap_id, sexo, vigencia_inicio, versao_fonte, criado_em)
         VALUES (?, 'Procedimento fictício F24', ?, 'ambos', '2008-01-01', 'teste', ?)`,
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
      const pp = await pessoa(`PACIENTE SINTETICO ${P}`, null, '700000000240001');
      const pm = await pessoa(`MEDICO SINTETICO ${P}`, CPF_MED, '700000000240002');
      const paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pp],
        "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, ?, 'ativo', ?)",
        [pp, 240_024_001, agora],
      );
      const prof = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pm],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pm, agora],
      );
      const cbo = await e.uma<{ id: number }>("SELECT id FROM ocupacao_cbo WHERE codigo_cbo = '225125'", []);
      if (cbo)
        await garantir(
          e,
          'SELECT id FROM profissional_ocupacao WHERE profissional_id = ? AND ocupacao_cbo_id = ?',
          [prof, cbo.id],
          'INSERT INTO profissional_ocupacao (profissional_id, ocupacao_cbo_id, principal, ativo, criado_em) VALUES (?, ?, TRUE, TRUE, ?)',
          [prof, cbo.id, agora],
        );
      const fonte = (cod: string, nome: string) =>
        um(
          'fonte_pagadora',
          cod,
          "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, registro_ans, criado_em) VALUES (?, ?, 'operadora', 'ativa', '123456', ?)",
          [cod, nome, agora],
        );
      ids.privada = await fonte(`${P}-PRIV`, 'OPERADORA FICTICIA F24');
      ids.sus = await fonte(`${P}-SUS`, 'SUS FICTICIO F24');
      const grupoFat = await e.uma<{ id: number }>(
        'SELECT id FROM grupo_faturamento ORDER BY id LIMIT 1',
        [],
      );
      ids.item = await um(
        'item_faturavel',
        `${P}-IT`,
        `INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, situacao, criado_em)
         VALUES (?, 'ITEM FICTICIO F24', 'procedimento', ?, 'ativo', ?)`,
        [`${P}-IT`, grupoFat?.id ?? null, agora],
      );
      await garantir(
        e,
        "SELECT id FROM equivalencia_sigtap_item WHERE item_faturavel_id = ? AND procedimento_sigtap_id = ? AND instrumento = 'todos'",
        [ids.item, ids.sig],
        "INSERT INTO equivalencia_sigtap_item (item_faturavel_id, procedimento_sigtap_id, instrumento, vigencia_inicio, criado_em) VALUES (?, ?, 'todos', '2026-01-01', ?)",
        [ids.item, ids.sig, agora],
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
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, 'AMBULATORIO F24', 'internacao', ?)",
        [`${P}-AMB`, agora],
      );
      const tipoConta = await um(
        'tipo_conta',
        `${P}-TC`,
        "INSERT INTO tipo_conta (codigo, descricao, natureza, criado_em) VALUES (?, 'CONTA F24', 'ambulatorial', ?)",
        [`${P}-TC`, agora],
      );
      const atendimento = (n: string, fonteId: number, entrada: string) =>
        garantir(
          e,
          'SELECT id FROM atendimento WHERE estabelecimento_id = ? AND numero = ?',
          [ids.est, n],
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id, carater_atendimento_tiss_id,
             fonte_pagadora_id, profissional_id, entrada_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [ids.est, n, paciente, catAt, tiss, fonteId, prof, new Date(entrada), agora],
        );
      const conta = async (n: string, at: number, fonteId: number, natureza: string, lote: string | null) => {
        const c = await garantir(
          e,
          'SELECT id FROM conta_hospitalar WHERE estabelecimento_id = ? AND numero = ?',
          [ids.est, n],
          `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id, tipo_conta_id,
             natureza, competencia, inicio_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, '2026-03-01', ?, ?)`,
          [ids.est, n, at, paciente, fonteId, tipoConta, natureza, new Date('2026-03-10T10:00:00Z'), agora],
        );
        await garantir(
          e,
          'SELECT id FROM conta_hospitalar_item WHERE conta_hospitalar_id = ? AND sequencia = 1',
          [c],
          `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, realizado_em, quantidade,
             valor_unitario, valor_total, executante_profissional_id, numero_lote, criado_em)
           VALUES (?, 1, ?, ?, 2, 10, 20, ?, ?, ?)`,
          [c, ids.item, new Date('2026-03-10T11:00:00Z'), prof, lote, agora],
        );
        return c;
      };
      ids.atPriv = await atendimento(`${P}-AT1`, ids.privada, '2026-03-10T10:00:00Z');
      await conta(`${P}-C1`, ids.atPriv, ids.privada, 'ambulatorial', null);
      ids.atSus = await atendimento(`${P}-AT2`, ids.sus, '2026-03-12T10:00:00Z');
      await conta(`${P}-C2`, ids.atSus, ids.sus, 'ambulatorial', null);
      // A internação SUS com alta na competência reaproveita a acomodação e os catálogos da massa da AIH, se houver.
      const acom = await e.uma<{ id: number; unidade_internacao_id: number }>(
        'SELECT id, unidade_internacao_id FROM acomodacao ORDER BY id LIMIT 1',
        [],
      );
      const car = await e.uma<{ id: number }>('SELECT id FROM carater_admissao ORDER BY id LIMIT 1', []);
      const mod = await e.uma<{ id: number }>('SELECT id FROM modalidade_internacao ORDER BY id LIMIT 1', []);
      const esp = await e.uma<{ id: number }>('SELECT id FROM especialidade_medica ORDER BY id LIMIT 1', []);
      const saida = await e.uma<{ id: number }>(
        'SELECT id FROM motivo_saida_hospitalar ORDER BY id LIMIT 1',
        [],
      );
      if (acom && car && mod && esp && saida) {
        const at3 = await atendimento(`${P}-AT3`, ids.sus, '2026-03-02T10:00:00Z');
        ids.internacao = await garantir(
          e,
          'SELECT id FROM internacao WHERE estabelecimento_id = ? AND numero = ?',
          [ids.est, `${P}-IN1`],
          `INSERT INTO internacao (estabelecimento_id, numero, atendimento_id, paciente_id, data_hora_entrada, carater_admissao_id,
             modalidade_internacao_id, unidade_internacao_id, acomodacao_id, especialidade_medica_id,
             medico_assistente_profissional_id, fonte_pagadora_id, situacao, data_hora_alta, motivo_saida_hospitalar_id,
             criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'alta', ?, ?, ?)`,
          [
            ids.est,
            `${P}-IN1`,
            at3,
            paciente,
            new Date('2026-03-02T10:00:00Z'),
            car.id,
            mod.id,
            acom.unidade_internacao_id,
            acom.id,
            esp.id,
            prof,
            ids.sus,
            new Date('2026-03-06T10:00:00Z'),
            saida.id,
            agora,
          ],
        );
        await conta(`${P}-C3`, at3, ids.sus, 'internacao', 'LOTE-F24');
      }
    });
  }, 120_000);

  afterAll(async () => {
    await nucleo?.encerrar?.();
  });

  it('CIHA: a conta de fonte não SUS do intervalo, com o paciente, os itens e a SIGTAP pela equivalência', async () => {
    const d = await ler(ids.est, (m) => m.dadosCiha(INTERVALO, [ids.sus], []));
    const at = d.atendimentos.find((a) => a.conta.registro === ids.atPriv);
    expect(at).toBeDefined();
    expect(at?.conta).toMatchObject({
      modalidade: 'ambulatorial',
      convenio: ids.privada,
      entrada: '2026-03-10',
    });
    expect(at?.conta.paciente).toMatchObject({
      cns: '700000000240001',
      nascimento: '1960-05-06',
      prontuario: 240_024_001,
    });
    expect(at?.conta.operadora.regAns).toBe(123456);
    expect(at?.itens).toEqual([
      expect.objectContaining({ sigtap: ids.sig, quantidade: 2, procedimento: ids.item }),
    ]);
    expect(d.procedimentos.map((p) => p.codigo)).toContain(SIG);
    // As contas SUS não entram na CIHA; fora do intervalo, nada.
    expect(d.atendimentos.some((a) => a.conta.convenio === ids.sus)).toBe(false);
    const fora = await ler(ids.est, (m) =>
      m.dadosCiha({ inicio: '2026-05-01', fim: '2026-05-31' }, [ids.sus], []),
    );
    expect(fora.atendimentos.filter((a) => a.conta.registro === ids.atPriv)).toEqual([]);
  });

  it('BPA: a conta ambulatorial SUS, o executante com CNS e o isolamento por estabelecimento', async () => {
    const d = await ler(ids.est, (m) => m.dadosBpa(INTERVALO, [ids.sus], []));
    const at = d.atendimentos.find((a) => a.conta.registro === ids.atSus);
    expect(at?.conta).toMatchObject({
      convenio: ids.sus,
      data: '2026-03-12',
      pacienteId: expect.any(Number),
    });
    expect(at?.itens[0]).toMatchObject({ sigtap: ids.sig, quantidade: 2 });
    expect(at?.itens[0]?.executante).toMatchObject({ cns: '700000000240002', cpf: CPF_MED });
    // A internação não entra no BPA; sem fonte SUS configurada, nada; o outro estabelecimento não vê a produção.
    expect(d.atendimentos.every((a) => a.conta.registro !== ids.atPriv)).toBe(true);
    expect((await ler(ids.est, (m) => m.dadosBpa(INTERVALO, [], []))).atendimentos).toEqual([]);
    expect((await ler(ids.estB, (m) => m.dadosBpa(INTERVALO, [ids.sus], []))).atendimentos).toEqual([]);
  });

  it('APAC: o atendimento do laudo (conta SUS primeiro), os domínios e os solicitantes pela chave', async () => {
    const a = await ler(ids.est, (m) => m.atendimentoLaudoApac(ids.atSus, [ids.sus]));
    expect(a).toMatchObject({
      registro: ids.atSus,
      convenio: ids.sus,
      prontuario: 240_024_001,
      data: '2026-03-12',
    });
    expect(await ler(ids.estB, (m) => m.atendimentoLaudoApac(ids.atSus, [ids.sus]))).toBeNull();
    const dom = await ler(ids.est, (m) => m.dominiosApac());
    expect(Object.keys(dom).sort()).toEqual([
      'acessoVascular',
      'caracteristicaTratamento',
      'contraindicacaoTransplante',
      'situacaoTransplante',
    ]);
    const sol = await ler(ids.est, (m) => m.solicitantesApacPorChave([CPF_MED, 'x']));
    expect(sol).toEqual([expect.objectContaining({ chave: CPF_MED, cns: '700000000240002' })]);
    expect(await ler(ids.est, (m) => m.buscarSolicitantesApac('a'))).toEqual([]);
    expect(Array.isArray(await ler(ids.est, (m) => m.buscarSolicitantesApac(`MEDICO SINTETICO ${P}`)))).toBe(
      true,
    );
  });

  it('linhas dos arquivos: sem a remessa, vazias (BPA, APAC e a linha do BPA da competência)', async () => {
    expect(
      await ler(ids.est, (m) => m.linhasBpa({ arquivo: 999_999_991, pagina: 0, porPagina: 10 })),
    ).toEqual({
      itens: [],
      total: 0,
      porTipo: {},
    });
    expect(
      await ler(ids.est, (m) => m.linhasApac({ arquivo: 999_999_991, pagina: 0, porPagina: 10 })),
    ).toEqual({
      itens: [],
      total: 0,
      apacs: 0,
      quantidade: 0,
    });
    expect(
      await ler(ids.est, (m) => m.linhaBpaDaCompetencia('202603', { tipo: 'i', folha: 1, sequencia: 1 })),
    ).toBeNull();
  });

  it('AIH: a internação SUS com alta na competência, a conta, os itens e os lotes', async () => {
    expect(ids.internacao).toBeGreaterThan(0);
    const lista = await ler(ids.est, (m) => m.internacoesSus(INTERVALO, [ids.sus]));
    expect(lista.map((x) => x.registro)).toContain(ids.internacao);
    const i = await ler(ids.est, (m) => m.internacaoAih(ids.internacao, [ids.sus]));
    expect(i).toMatchObject({
      registro: ids.internacao,
      convenio: ids.sus,
      entrada: '2026-03-02',
      alta: '2026-03-06',
    });
    expect(i?.contasSus).toHaveLength(1);
    const d = await ler(ids.est, (m) => m.dadosAih([ids.internacao], [SIG], [], [ids.sus]));
    expect(d.internacoes).toHaveLength(1);
    expect(d.itens).toEqual([expect.objectContaining({ sigtap: ids.sig, quantidade: 2, tipo: 1 })]);
    expect(d.porCodigo.map((x) => x.codigo)).toEqual([SIG]);
    expect(await ler(ids.est, (m) => m.lotesSaida(ids.internacao))).toEqual([
      { item: ids.item, nome: 'ITEM FICTICIO F24', quantidade: 2, lote: 'LOTE-F24' },
    ]);
    expect(await ler(ids.estB, (m) => m.internacaoAih(ids.internacao, [ids.sus]))).toBeNull();
  });
});
