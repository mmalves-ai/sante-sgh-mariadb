// Integração das montagens do faturamento SUS na porta própria (porta-propria-montagens.ts) contra o MariaDB real
// (cliente f22_o3). Massa SINTÉTICA e idempotente (fica para a próxima execução, como a internação da AIH): um
// atendimento ambulatorial de fonte privada (CIHA), um ambulatorial de fonte SUS com executante e CBO (BPA, laudo da
// APAC) e uma internação SUS com alta na competência e item com lote (AIH, mais uma conta particular com lote no mesmo
// atendimento); as remessas do BPA e da APAC com linhas nos dois estabelecimentos; o CRM do médico e um profissional sem
// CRM. Prova a leitura da produção pela conta própria, a SIGTAP pela equivalência vigente, as linhas guardadas dos
// arquivos (totais, paginação e filtros) e o isolamento por estabelecimento.
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
const CPF_SEM_CRM = '24024024001';
const CRM_MED = '924024';
const ARQ_BPA = 924_024_001;
const ARQ_APAC = 924_024_002;
const NUM_APAC = '2624024000011';
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
  const ids = {
    est: 0,
    estB: 0,
    sig: 0,
    privada: 0,
    sus: 0,
    atPriv: 0,
    atSus: 0,
    internacao: 0,
    item: 0,
    linhaC2: 0,
    linhaB: 0,
    apac: 0,
    laudo: 0,
  };

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
        // Uma conta particular no mesmo atendimento da internação, com lote: não entra nos lotes do espelho da AIH.
        await conta(`${P}-C4`, at3, ids.privada, 'internacao', 'LOTE-F24-PRIV');
      }
      // O CRM do médico sintético e um segundo profissional sem CRM (não aparece na busca de solicitantes da APAC).
      const crm = await e.uma<{ id: number }>("SELECT id FROM conselho_classe WHERE sigla = 'CRM'", []);
      const uf = await e.uma<{ id: number }>('SELECT MIN(id) AS id FROM unidade_federativa', []);
      if (!crm || !uf?.id)
        throw new Error('massa: o catálogo do CRM ou das UFs está vazio no cliente de teste');
      await garantir(
        e,
        'SELECT id FROM inscricao_conselho WHERE profissional_id = ? AND sequencia = 1',
        [prof],
        `INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id, unidade_federativa_id,
           numero_inscricao, principal, criado_em) VALUES (?, 1, ?, ?, ?, TRUE, ?)`,
        [prof, crm.id, uf.id, CRM_MED, agora],
      );
      const pSem = await pessoa(`MEDICO SINTETICO ${P} SEM CRM`, CPF_SEM_CRM, null);
      await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pSem],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pSem, agora],
      );
      // As remessas do BPA e da APAC da competência, com linhas, nos dois estabelecimentos (o mesmo número de arquivo).
      const cboLinha =
        cbo?.id ?? (await e.uma<{ id: number }>('SELECT MIN(id) AS id FROM ocupacao_cbo', []))?.id;
      if (!cboLinha) throw new Error('massa: o catálogo de ocupações (CBO) está vazio no cliente de teste');
      const competencia = (estId: number, instrumento: string) =>
        garantir(
          e,
          'SELECT id FROM competencia_sus WHERE estabelecimento_id = ? AND instrumento = ? AND competencia = ?',
          [estId, instrumento, '202603'],
          `INSERT INTO competencia_sus (estabelecimento_id, instrumento, competencia, periodo_inicio, periodo_fim, aberta_em,
             criado_em) VALUES (?, ?, '202603', '2026-03-01', '2026-03-31', ?, ?)`,
          [estId, instrumento, agora, agora],
        );
      const remessaBpa = async (estId: number) => {
        const c = await competencia(estId, 'bpa');
        const r = await garantir(
          e,
          'SELECT id FROM remessa_bpa WHERE estabelecimento_id = ? AND numero = ?',
          [estId, String(ARQ_BPA)],
          `INSERT INTO remessa_bpa (estabelecimento_id, competencia_sus_id, numero, tipo_bpa, aberta_em, criado_em)
           VALUES (?, ?, ?, 'misto', ?, ?)`,
          [estId, c, String(ARQ_BPA), agora, agora],
        );
        return { c, r };
      };
      const folha = (estId: number, c: number, r: number, tipo: string) =>
        garantir(
          e,
          'SELECT id FROM producao_ambulatorial_sus WHERE competencia_sus_id = ? AND tipo_folha = ? AND numero_folha = 1',
          [c, tipo],
          `INSERT INTO producao_ambulatorial_sus (estabelecimento_id, competencia_sus_id, tipo_folha, numero_folha,
             remessa_bpa_id, criado_em) VALUES (?, ?, ?, 1, ?, ?)`,
          [estId, c, tipo, r, agora],
        );
      const linha = (folhaId: number, seq: number, qtd: number, pacienteId: number | null) =>
        garantir(
          e,
          'SELECT id FROM producao_ambulatorial_sus_item WHERE producao_ambulatorial_sus_id = ? AND sequencia = ?',
          [folhaId, seq],
          `INSERT INTO producao_ambulatorial_sus_item (producao_ambulatorial_sus_id, sequencia, procedimento_sigtap_id,
             ocupacao_cbo_id, paciente_id, atendimento_id, data_atendimento, idade_anos, quantidade, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, '2026-03-12', 65, ?, ?)`,
          [folhaId, seq, ids.sig, cboLinha, pacienteId, pacienteId ? ids.atSus : null, qtd, agora],
        );
      const bA = await remessaBpa(ids.est);
      const consA = await folha(ids.est, bA.c, bA.r, 'consolidado');
      await linha(consA, 1, 5, null);
      ids.linhaC2 = await linha(consA, 2, 7, null);
      await linha(await folha(ids.est, bA.c, bA.r, 'individualizado'), 1, 2, paciente);
      const bB = await remessaBpa(ids.estB);
      ids.linhaB = await linha(await folha(ids.estB, bB.c, bB.r, 'consolidado'), 1, 9, null);
      // A APAC: laudo, autorização, remessa e uma APAC com dois procedimentos no estabelecimento A; no B, a remessa
      // com o mesmo número, sem APAC.
      const tipoLaudo = await garantir(
        e,
        'SELECT id FROM tipo_laudo_apac WHERE codigo = ?',
        [`${P}-TL`],
        "INSERT INTO tipo_laudo_apac (codigo, descricao, grupo_laudo, criado_em) VALUES (?, 'LAUDO FICTICIO F24', 'outro', ?)",
        [`${P}-TL`, agora],
      );
      ids.laudo = await garantir(
        e,
        'SELECT id FROM laudo_apac WHERE estabelecimento_id = ? AND numero_laudo = ?',
        [ids.est, `${P}-L1`],
        `INSERT INTO laudo_apac (estabelecimento_id, numero_laudo, paciente_id, atendimento_id, tipo_laudo_apac_id, data_laudo,
           solicitado_procedimento_sigtap_id, codigo_cid10_principal, solicitante_profissional_id, justificativa, criado_em)
         VALUES (?, ?, ?, ?, ?, '2026-03-12', ?, 'N180', ?, 'JUSTIFICATIVA FICTICIA', ?)`,
        [ids.est, `${P}-L1`, paciente, ids.atSus, tipoLaudo, ids.sig, prof, agora],
      );
      const aut = await garantir(
        e,
        'SELECT id FROM autorizacao_apac WHERE laudo_apac_id = ?',
        [ids.laudo],
        `INSERT INTO autorizacao_apac (estabelecimento_id, laudo_apac_id, data_solicitacao, criado_em)
         VALUES (?, ?, '2026-03-12', ?)`,
        [ids.est, ids.laudo, agora],
      );
      const remessaApac = async (estId: number) =>
        garantir(
          e,
          'SELECT id FROM remessa_apac WHERE estabelecimento_id = ? AND numero = ?',
          [estId, String(ARQ_APAC)],
          `INSERT INTO remessa_apac (estabelecimento_id, competencia_sus_id, numero, competencia_apresentacao, criado_em)
           VALUES (?, ?, ?, '2026-03-01', ?)`,
          [estId, await competencia(estId, 'apac'), String(ARQ_APAC), agora],
        );
      const rApacA = await remessaApac(ids.est);
      await remessaApac(ids.estB);
      ids.apac = await garantir(
        e,
        'SELECT id FROM apac WHERE estabelecimento_id = ? AND numero_apac = ?',
        [ids.est, NUM_APAC],
        `INSERT INTO apac (estabelecimento_id, autorizacao_apac_id, competencia_sus_id, numero_apac, tipo_apac, atendimento_id,
           data_inicio, data_fim, principal_procedimento_sigtap_id, codigo_cid10_principal, remessa_apac_id, criado_em)
         VALUES (?, ?, ?, ?, 'inicial', ?, '2026-03-01', '2026-03-31', ?, 'N180', ?, ?)`,
        [ids.est, aut, await competencia(ids.est, 'apac'), NUM_APAC, ids.atSus, ids.sig, rApacA, agora],
      );
      const procApac = (seq: number, tipo: string, qtd: number) =>
        garantir(
          e,
          'SELECT id FROM apac_procedimento WHERE apac_id = ? AND sequencia = ?',
          [ids.apac, seq],
          `INSERT INTO apac_procedimento (apac_id, sequencia, procedimento_sigtap_id, tipo, quantidade, ocupacao_cbo_id, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [ids.apac, seq, ids.sig, tipo, qtd, cboLinha, agora],
        );
      await procApac(1, 'principal', 1);
      await procApac(2, 'secundario', 3);
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
    // Pela chave: o profissional sem CRM também vem (crm nulo); a chave de CPF fora do cadastro, nada.
    expect(await ler(ids.est, (m) => m.solicitantesApacPorChave([CPF_SEM_CRM]))).toEqual([
      expect.objectContaining({ chave: CPF_SEM_CRM, crm: null }),
    ]);
    expect(await ler(ids.est, (m) => m.solicitantesApacPorChave(['24024024999']))).toEqual([]);
    expect(await ler(ids.est, (m) => m.buscarSolicitantesApac('a'))).toEqual([]);
    // A busca só traz médico com CRM: pelo nome (o sem CRM, de nome parecido, fica fora) e pelo começo do CRM.
    const porNome = await ler(ids.est, (m) => m.buscarSolicitantesApac(`MEDICO SINTETICO ${P}`));
    expect(porNome).toEqual([
      { chave: CPF_MED, nome: `MEDICO SINTETICO ${P}`, crm: Number(CRM_MED), cns: '700000000240002' },
    ]);
    const porCrm = await ler(ids.est, (m) => m.buscarSolicitantesApac(CRM_MED.slice(0, 5)));
    expect(porCrm.map((x) => x.chave)).toContain(CPF_MED);
    expect(porCrm.map((x) => x.chave)).not.toContain(CPF_SEM_CRM);
  });

  it('linhas do BPA: itens, total, porTipo, paginação, filtros e isolamento por estabelecimento', async () => {
    const tudo = await ler(ids.est, (m) => m.linhasBpa({ arquivo: ARQ_BPA, pagina: 0, porPagina: 10 }));
    expect(tudo.total).toBe(3);
    expect(tudo.porTipo).toEqual({ c: { linhas: 2, quantidade: 12 }, i: { linhas: 1, quantidade: 2 } });
    expect(tudo.itens.map((x) => [x.tipo, x.folha, x.sequencia, x.quantidade])).toEqual([
      ['c', 1, 1, 5],
      ['c', 1, 2, 7],
      ['i', 1, 1, 2],
    ]);
    expect(tudo.itens[2]).toMatchObject({
      procedimento: SIG,
      idade: 65,
      data: '2026-03-12',
      atendimento: ids.atSus,
    });
    expect(tudo.itens.map((x) => x.id)).not.toContain(ids.linhaB);
    // Paginação: duas por página, a segunda página tem a individualizada.
    const p1 = await ler(ids.est, (m) => m.linhasBpa({ arquivo: ARQ_BPA, pagina: 1, porPagina: 2 }));
    expect([p1.total, p1.itens.map((x) => x.tipo)]).toEqual([3, ['i']]);
    // Filtros: tipo e começo do procedimento.
    const c = await ler(ids.est, (m) =>
      m.linhasBpa({ arquivo: ARQ_BPA, tipo: 'c', pagina: 0, porPagina: 10 }),
    );
    expect([c.total, c.itens.every((x) => x.tipo === 'c')]).toEqual([2, true]);
    const proc = (procedimento: string) =>
      ler(ids.est, (m) => m.linhasBpa({ arquivo: ARQ_BPA, procedimento, pagina: 0, porPagina: 10 }));
    expect((await proc(SIG.slice(0, 6))).total).toBe(3);
    expect((await proc('99')).total).toBe(0);
    // O outro estabelecimento, com o mesmo número de arquivo, vê só a linha dele; sem a remessa, vazio.
    const b = await ler(ids.estB, (m) => m.linhasBpa({ arquivo: ARQ_BPA, pagina: 0, porPagina: 10 }));
    expect([b.total, b.itens.map((x) => x.id), b.porTipo]).toEqual([
      1,
      [ids.linhaB],
      { c: { linhas: 1, quantidade: 9 } },
    ]);
    expect(
      await ler(ids.est, (m) => m.linhasBpa({ arquivo: 999_999_991, pagina: 0, porPagina: 10 })),
    ).toEqual({ itens: [], total: 0, porTipo: {} });
  });

  it('linha do BPA da competência: pela folha e sequência, só no estabelecimento dela', async () => {
    expect(
      await ler(ids.est, (m) => m.linhaBpaDaCompetencia('202603', { tipo: 'c', folha: 1, sequencia: 2 })),
    ).toEqual({ linha: ids.linhaC2, arquivo: ARQ_BPA, procedimento: SIG });
    expect(
      await ler(ids.estB, (m) => m.linhaBpaDaCompetencia('202603', { tipo: 'c', folha: 1, sequencia: 1 })),
    ).toEqual({ linha: ids.linhaB, arquivo: ARQ_BPA, procedimento: SIG });
    // O B não tem a sequência 2; o tipo errado e outra competência, nada.
    expect(
      await ler(ids.estB, (m) => m.linhaBpaDaCompetencia('202603', { tipo: 'c', folha: 1, sequencia: 2 })),
    ).toBeNull();
    expect(
      await ler(ids.est, (m) => m.linhaBpaDaCompetencia('202603', { tipo: 'i', folha: 1, sequencia: 2 })),
    ).toBeNull();
    expect(
      await ler(ids.est, (m) => m.linhaBpaDaCompetencia('202604', { tipo: 'c', folha: 1, sequencia: 1 })),
    ).toBeNull();
  });

  it('linhas da APAC: os procedimentos da remessa, totais, paginação e isolamento por estabelecimento', async () => {
    const a = await ler(ids.est, (m) => m.linhasApac({ arquivo: ARQ_APAC, pagina: 0, porPagina: 10 }));
    expect([a.total, a.apacs, a.quantidade]).toEqual([2, 1, 4]);
    expect(
      a.itens.map((x) => [x.apac, x.numero, x.tipoNoArquivo, x.procedimento, x.principal, x.quantidade]),
    ).toEqual([
      [ids.laudo, NUM_APAC, '1', SIG, true, 1],
      [ids.laudo, NUM_APAC, '1', SIG, false, 3],
    ]);
    expect(a.itens[0]?.conta).toEqual(expect.any(Number));
    const p1 = await ler(ids.est, (m) => m.linhasApac({ arquivo: ARQ_APAC, pagina: 1, porPagina: 1 }));
    expect([p1.total, p1.itens.map((x) => x.principal)]).toEqual([2, [false]]);
    // O B tem a remessa com o mesmo número, sem APAC: não vê as linhas do A.
    expect(await ler(ids.estB, (m) => m.linhasApac({ arquivo: ARQ_APAC, pagina: 0, porPagina: 10 }))).toEqual(
      {
        itens: [],
        total: 0,
        apacs: 0,
        quantidade: 0,
      },
    );
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
    // Só os lotes da conta na fonte da internação: o lote da conta particular do mesmo atendimento fica fora.
    expect(await ler(ids.est, (m) => m.lotesSaida(ids.internacao))).toEqual([
      { item: ids.item, nome: 'ITEM FICTICIO F24', quantidade: 2, lote: 'LOTE-F24' },
    ]);
    expect(await ler(ids.estB, (m) => m.lotesSaida(ids.internacao))).toEqual([]);
    expect(await ler(ids.estB, (m) => m.internacaoAih(ids.internacao, [ids.sus]))).toBeNull();
  });
});
