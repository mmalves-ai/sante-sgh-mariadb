// Contrato de efeito da nota clínica em quatro partes codificada (03-PEP L98), contra o MariaDB real (cliente de teste
// f22_o4 por padrão). Massa SINTÉTICA própria (estabelecimento c2080, logins c2080.*, termos da CIAP-2 C2080*), limpa
// antes e depois (a trilha pelo utilitário comum); os CID-10 são os do catálogo oficial já carregado. Prova o que fica
// no banco: o rascunho em nota_soap (paciente e profissional do atendimento e da conta, gestação calculada) com os
// códigos numerados em nota_soap_codigo; a repetição pela mesma chave não grava de novo; a alteração do rascunho exclui
// logicamente os códigos trocados e continua a numeração; a assinatura grava a situação e a hora e cria o problema do
// paciente (ou liga ao ativo com o mesmo CID); a nota assinada não muda e fica sem efeito só com justificativa (a linha
// fica); as recusas (CIAP-2 desligada, CID faltando na avaliação, não autor, data da última menstruação futura,
// configuração repetida) sem gravar nada; a visão por paciente com a configuração aplicável; a busca de termos e a
// correspondência; e as rotas com o vínculo assistencial. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { criarAbility, regrasDeAcesso, VinculoSintetico } from '@sgh/dominio-acesso';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { NotaSoapController } from './nota-soap.controller.js';
import { NotaSoapPropria } from './nota-soap-propria.js';
import { EstadoProntuario } from './sessao-prontuario.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'c2080';
const M = 'C2080';
const AUTOR = `${P}.autor`;
const OUTRO = `${P}.outro`;
const PRONTUARIO = 208_008_001;
const recusada = (codigo: string) => ({ problema: expect.objectContaining({ codigo }) });

describe.skipIf(SEM_BANCO)('nota clínica em quatro partes codificada (banco próprio, MariaDB)', () => {
  let nucleo: NucleoProprio;
  let notas: NotaSoapPropria;
  let criouTerminologia = false;
  const ids = {
    est: 0,
    autor: 0,
    paciente: 0,
    atend: 0,
    config: 0,
    ciap: 0,
    ciapB: 0,
    i10: 0,
    e11: 0,
    i15: 0,
  };

  const limpar = async (e: Escritor) => {
    const pac = '(SELECT id FROM paciente WHERE numero_prontuario = ?)';
    await e.executar(
      `DELETE FROM nota_soap_codigo WHERE nota_soap_id IN (SELECT id FROM nota_soap WHERE paciente_id IN ${pac})`,
      [PRONTUARIO],
    );
    await e.executar(`DELETE FROM nota_soap WHERE paciente_id IN ${pac}`, [PRONTUARIO]);
    await e.executar(`DELETE FROM problema_paciente WHERE paciente_id IN ${pac}`, [PRONTUARIO]);
    await e.executar(
      'DELETE FROM configuracao_nota_soap WHERE estabelecimento_id IN (SELECT id FROM estabelecimento WHERE codigo = ?)',
      [P],
    );
    const sint = `(SELECT id FROM termo_terminologia WHERE codigo_termo LIKE '${M}%')`;
    await e.executar(`DELETE FROM correspondencia_ciap_cid WHERE ciap_termo_terminologia_id IN ${sint}`);
    await e.executar('DELETE FROM termo_terminologia WHERE codigo_termo LIKE ?', [`${M}%`]);
    if (criouTerminologia) await e.executar("DELETE FROM terminologia WHERE codigo = 'ciap2'");
    await e.executar(`DELETE FROM atendimento WHERE paciente_id IN ${pac}`, [PRONTUARIO]);
    await e.executar('DELETE FROM paciente WHERE numero_prontuario = ?', [PRONTUARIO]);
    const profs = '(SELECT id FROM profissional WHERE observacao = ?)';
    await e.executar(`DELETE FROM usuario_profissional WHERE profissional_id IN ${profs}`, [`massa ${P}`]);
    await e.executar('DELETE FROM profissional WHERE observacao = ?', [`massa ${P}`]);
    await e.executar('DELETE FROM pessoa_fisica WHERE nome LIKE ?', [`Pessoa sintética ${P}%`]);
    await e.executar('DELETE FROM categoria_atendimento WHERE codigo LIKE ?', [`${P}%`]);
    await e.executar('DELETE FROM carater_atendimento_tiss WHERE codigo_tiss LIKE ?', [`${P}%`]);
    await e.executar('DELETE FROM fonte_pagadora WHERE codigo LIKE ?', [`${P}%`]);
    await limparTrilhaDaMassa(e, { codigos: [P] });
    await e.executar('DELETE FROM usuario WHERE login IN (?, ?)', [AUTOR, OUTRO]);
  };
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: `leitura-${P}` }, (l) =>
      l.consultar(sql, p),
    ) as Promise<T[]>;
  const ctx = (login = AUTOR, chave = `${P}-${randomUUID()}`) => ({
    hospital: P,
    login,
    correlacao: `teste-${P}`,
    chaveIdempotencia: chave,
  });
  const contar = async () =>
    (
      await ler<{ n: number; c: number; p: number }>(
        `SELECT (SELECT COUNT(*) FROM nota_soap WHERE paciente_id = ?) AS n,
                (SELECT COUNT(*) FROM nota_soap_codigo k JOIN nota_soap s ON s.id = k.nota_soap_id
                  WHERE s.paciente_id = ?) AS c,
                (SELECT COUNT(*) FROM problema_paciente WHERE paciente_id = ?) AS p`,
        [ids.paciente, ids.paciente, ids.paciente],
      )
    ).map((x) => ({ n: Number(x.n), c: Number(x.c), p: Number(x.p) }))[0]!;
  const nota = (o: Record<string, unknown> = {}) => ({
    atendimento: ids.atend,
    subjetivo: `Queixa sintética ${P}`,
    avaliacao: 'Avaliação sintética',
    plano: 'Plano sintético',
    codigos: [
      { parte: 'avaliacao', ciap: ids.ciap, cid: ids.i10, incluirListaProblemas: true },
      { parte: 'plano', cid: ids.e11 },
    ],
    ...o,
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    notas = new NotaSoapPropria(nucleo, CLIENTE);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const ins = (sql: string, p: unknown[]) => e.inserir(sql, p);
      const est = await e.uma<{ id: unknown }>('SELECT id FROM estabelecimento WHERE codigo = ?', [P]);
      ids.est = est
        ? Number(est.id)
        : await ins(
            'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
            [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
          );
      const usuario = (login: string, cpf: string) =>
        ins('INSERT INTO usuario (login, nome, cpf, criado_em) VALUES (?, ?, ?, ?)', [
          login,
          `Conta sintética ${login}`,
          cpf,
          agora,
        ]);
      ids.autor = await usuario(AUTOR, '20800800001');
      const outro = await usuario(OUTRO, '20800800002');
      const pessoa = (sufixo: string, nascimento: string | null = null) =>
        ins('INSERT INTO pessoa_fisica (nome, data_nascimento, criado_em) VALUES (?, ?, ?)', [
          `Pessoa sintética ${P} ${sufixo}`,
          nascimento,
          agora,
        ]);
      const profissional = async (sufixo: string, u: number) => {
        const p = await ins(
          "INSERT INTO profissional (pessoa_fisica_id, tipo, observacao, criado_em) VALUES (?, 'assistencial', ?, ?)",
          [await pessoa(sufixo), `massa ${P}`, agora],
        );
        await ins(
          'INSERT INTO usuario_profissional (usuario_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
          [u, p, '2026-01-01', agora],
        );
        return p;
      };
      const medico = await profissional('médica', ids.autor);
      await profissional('outro médico', outro);
      ids.paciente = await ins(
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [await pessoa('paciente', '1990-03-10'), PRONTUARIO, agora],
      );
      const categoria = await ins(
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'ambulatorio', ?)",
        [`${P}amb`, 'Categoria sintética', agora],
      );
      const carater = await ins(
        'INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}c`, 'Caráter sintético', 'teste', agora],
      );
      const fonte = await ins(
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'particular', ?)",
        [`${P}fp`, 'Fonte pagadora sintética', agora],
      );
      ids.atend = await ins(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em, situacao)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'aberto')`,
        [
          ids.est,
          '208001',
          ids.paciente,
          categoria,
          carater,
          fonte,
          medico,
          new Date('2026-11-20T10:00:00Z'),
          agora,
        ],
      );
      // CID-10 do catálogo oficial já carregado; CIAP-2 com termos sintéticos (a terminologia criada só se faltar).
      const cid = async (codigo: string) =>
        Number(
          (
            await e.uma<{ id: unknown }>(
              `SELECT tt.id FROM termo_terminologia tt JOIN terminologia t ON t.id = tt.terminologia_id
                WHERE t.codigo = 'cid10' AND tt.codigo_termo = ?`,
              [codigo],
            )
          )?.id ?? 0,
        );
      ids.i10 = await cid('I10');
      ids.e11 = await cid('E11');
      ids.i15 = await cid('I150');
      let tid = Number(
        (await e.uma<{ id: unknown }>("SELECT id FROM terminologia WHERE codigo = 'ciap2'"))?.id ?? 0,
      );
      if (!tid) {
        criouTerminologia = true;
        tid = await ins(
          `INSERT INTO terminologia (codigo, nome, sigla, tipo, criado_em) VALUES ('ciap2', ?, 'CIAP-2', 'diagnostico', ?)`,
          ['Classificação de atenção primária (teste)', agora],
        );
      }
      const termo = (codigo: string, descricao: string) =>
        ins(
          'INSERT INTO termo_terminologia (terminologia_id, codigo_termo, descricao, nivel, criado_em) VALUES (?, ?, ?, 2, ?)',
          [tid, `${M}${codigo}`, descricao, agora],
        );
      ids.ciap = await termo('K86', 'Hipertensão sintética sem complicações');
      ids.ciapB = await termo('T90', 'Diabetes sintético');
      for (const [c, p] of [
        [ids.i15, false],
        [ids.i10, true],
      ] as const)
        await ins(
          'INSERT INTO correspondencia_ciap_cid (ciap_termo_terminologia_id, cid_termo_terminologia_id, preferencial, criado_em) VALUES (?, ?, ?, ?)',
          [ids.ciap, c, p, agora],
        );
    });
    expect(ids.i10 && ids.e11 && ids.i15).toBeTruthy();
    const cfg = await notas.gravarConfiguracao(ctx(), {
      estabelecimento: ids.est,
      descricao: `Ambulatório sintético ${P}`,
      usaCiap: true,
    });
    ids.config = cfg.resultado.id;
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, (e) => limpar(e));
    await nucleo.encerrar?.();
  });

  it('grava o rascunho com os códigos numerados; a repetição pela mesma chave não grava de novo', async () => {
    const chave = `${P}-${randomUUID()}`;
    const r = await notas.criarNota(ctx(AUTOR, chave), nota());
    expect(r.resultado).toMatchObject({ situacao: 'rascunho', versao: 1, avisos: '' });
    const n = (await ler('SELECT * FROM nota_soap WHERE id = ?', [r.resultado.nota]))[0]!;
    expect(n).toMatchObject({
      estabelecimento_id: ids.est,
      atendimento_id: ids.atend,
      paciente_id: ids.paciente,
      situacao: 'rascunho',
      tipo: 'consulta',
      subjetivo: `Queixa sintética ${P}`,
      objetivo: null,
      assinada_em: null,
      origem: 'sistema',
      criado_por: ids.autor,
      excluido_em: null,
    });
    const cods = await ler(
      `SELECT sequencia, parte, ciap_termo_terminologia_id, cid_termo_terminologia_id, incluir_lista_problemas
         FROM nota_soap_codigo WHERE nota_soap_id = ? ORDER BY sequencia`,
      [r.resultado.nota],
    );
    expect(cods).toEqual([
      {
        sequencia: 1,
        parte: 'avaliacao',
        ciap_termo_terminologia_id: ids.ciap,
        cid_termo_terminologia_id: ids.i10,
        incluir_lista_problemas: 1,
      },
      {
        sequencia: 2,
        parte: 'plano',
        ciap_termo_terminologia_id: null,
        cid_termo_terminologia_id: ids.e11,
        incluir_lista_problemas: 0,
      },
    ]);
    const antes = await contar();
    const de2 = await notas.criarNota(ctx(AUTOR, chave), nota());
    expect(de2.repetida).toBe(true);
    expect(await contar()).toEqual(antes);
  });

  it('pré-natal guarda a data provável do parto e a idade gestacional; CID fora da correspondência dá aviso', async () => {
    const dum = new Date(Date.now() - 70 * 86_400_000).toISOString().slice(0, 10);
    const r = await notas.criarNota(
      ctx(),
      nota({
        tipo: 'pre_natal',
        dataUltimaMenstruacao: dum,
        edema: '+',
        codigos: [{ parte: 'avaliacao', ciap: ids.ciap, cid: ids.e11 }],
      }),
    );
    expect(r.resultado.avisos).toContain('correspondentes');
    const n = (
      await ler<{ ig: number; dpp: string; edema: string }>(
        `SELECT idade_gestacional_dias AS ig, DATE_FORMAT(data_provavel_parto, '%Y-%m-%d') AS dpp, edema
           FROM nota_soap WHERE id = ?`,
        [r.resultado.nota],
      )
    )[0]!;
    expect(Number(n.ig)).toBe(70);
    expect(n.dpp).toBe(
      new Date(Date.parse(`${dum}T00:00:00Z`) + 280 * 86_400_000).toISOString().slice(0, 10),
    );
    expect(n.edema).toBe('+');
  });

  it('recusa sem gravar: CIAP-2 desligada, data da última menstruação futura, configuração repetida', async () => {
    const antes = await contar();
    await expect(
      notas.criarNota(ctx(), nota({ tipo: 'pre_natal', dataUltimaMenstruacao: '2099-01-01' })),
    ).rejects.toMatchObject(recusada('dum-futura'));
    await expect(
      notas.gravarConfiguracao(ctx(), { estabelecimento: ids.est, descricao: 'Repetida' }),
    ).rejects.toMatchObject(recusada('configuracao-repetida'));
    const desl = await notas.gravarConfiguracao(ctx(), {
      id: ids.config,
      versao: 1,
      estabelecimento: ids.est,
      descricao: `Ambulatório sintético ${P}`,
      usaCiap: false,
    });
    expect(desl.resultado.versao).toBe(2);
    await expect(notas.criarNota(ctx(), nota())).rejects.toMatchObject(recusada('ciap-desligada'));
    await notas.gravarConfiguracao(ctx(), {
      id: ids.config,
      versao: 2,
      estabelecimento: ids.est,
      descricao: `Ambulatório sintético ${P}`,
      usaCiap: true,
    });
    expect(await contar()).toEqual(antes);
    const cfg = (
      await ler('SELECT usa_ciap, exige_cid_avaliacao, versao FROM configuracao_nota_soap WHERE id = ?', [
        ids.config,
      ])
    )[0]!;
    expect(cfg).toEqual({ usa_ciap: 1, exige_cid_avaliacao: 1, versao: 3 });
  });

  it('alteração do rascunho: só o autor; os códigos trocados ficam excluídos e a numeração continua', async () => {
    const r = await notas.criarNota(ctx(), nota());
    await expect(
      notas.alterarNota(ctx(OUTRO), { nota: r.resultado.nota, versao: 1, plano: 'outro' }),
    ).rejects.toMatchObject(recusada('nao-autor'));
    const a = await notas.alterarNota(ctx(), {
      nota: r.resultado.nota,
      versao: 1,
      subjetivo: 'Queixa revista',
      avaliacao: 'Avaliação revista',
      plano: 'Plano revisto',
      codigos: [{ parte: 'avaliacao', cid: ids.i15, incluirListaProblemas: true }],
    });
    expect(a.resultado.versao).toBe(2);
    const cods = await ler<{ sequencia: number; excluido: number; cid: number }>(
      `SELECT sequencia, excluido_em IS NOT NULL AS excluido, cid_termo_terminologia_id AS cid
         FROM nota_soap_codigo WHERE nota_soap_id = ? ORDER BY sequencia`,
      [r.resultado.nota],
    );
    expect(cods.map((c) => [Number(c.sequencia), Number(c.excluido), Number(c.cid)])).toEqual([
      [1, 1, ids.i10],
      [2, 1, ids.e11],
      [3, 0, ids.i15],
    ]);
    await expect(
      notas.alterarNota(ctx(), { nota: r.resultado.nota, versao: 1, plano: 'velho' }),
    ).rejects.toMatchObject(recusada('conflito-versao'));
  });

  it('assinatura: exige CID na avaliação; cria o problema do paciente ou liga ao ativo; a assinada não muda', async () => {
    const semCid = await notas.criarNota(ctx(), nota({ codigos: [{ parte: 'avaliacao', ciap: ids.ciapB }] }));
    await expect(notas.assinarNota(ctx(), { nota: semCid.resultado.nota, versao: 1 })).rejects.toMatchObject(
      recusada('avaliacao-sem-cid'),
    );
    const a = await notas.criarNota(ctx(), nota());
    const b = await notas.criarNota(ctx(), nota());
    const pAntes = (await contar()).p;
    await expect(notas.assinarNota(ctx(OUTRO), { nota: a.resultado.nota, versao: 1 })).rejects.toMatchObject(
      recusada('nao-autor'),
    );
    const sa = await notas.assinarNota(ctx(), { nota: a.resultado.nota, versao: 1 });
    expect(sa.resultado.situacao).toBe('assinada');
    const prob = Number(sa.resultado.problemas);
    expect(prob).toBeGreaterThan(0);
    expect(
      (
        await ler('SELECT situacao, assinada_em IS NOT NULL AS assinada FROM nota_soap WHERE id = ?', [
          a.resultado.nota,
        ])
      )[0],
    ).toEqual({ situacao: 'assinada', assinada: 1 });
    expect(
      (
        await ler(
          `SELECT tipo, situacao, cid_termo_terminologia_id AS cid, ciap_termo_terminologia_id AS ciap, atendimento_id,
                  registrado_por_profissional_id IS NOT NULL AS por, descricao LIKE 'I10%' AS desc_cid
             FROM problema_paciente WHERE id = ?`,
          [prob],
        )
      )[0],
    ).toEqual({
      tipo: 'diagnostico',
      situacao: 'ativo',
      cid: ids.i10,
      ciap: ids.ciap,
      atendimento_id: ids.atend,
      por: 1,
      desc_cid: 1,
    });
    expect(
      (
        await ler(
          'SELECT problema_paciente_id AS p FROM nota_soap_codigo WHERE nota_soap_id = ? AND sequencia = 1',
          [a.resultado.nota],
        )
      )[0],
    ).toEqual({ p: prob });
    const sb = await notas.assinarNota(ctx(), { nota: b.resultado.nota, versao: 1 });
    expect(Number(sb.resultado.problemas)).toBe(prob);
    expect((await contar()).p).toBe(pAntes + 1);
    await expect(
      notas.alterarNota(ctx(), { nota: a.resultado.nota, versao: 2, plano: 'mudou' }),
    ).rejects.toMatchObject(recusada('nota-assinada'));
    await expect(
      notas.semEfeitoNota(ctx(), { nota: a.resultado.nota, versao: 2, justificativa: 'curta' }),
    ).rejects.toMatchObject(recusada('justificativa-obrigatoria'));
    const se = await notas.semEfeitoNota(ctx(), {
      nota: a.resultado.nota,
      versao: 2,
      justificativa: 'Nota lançada no atendimento errado',
    });
    expect(se.resultado.situacao).toBe('sem_efeito');
    expect(
      (await ler('SELECT situacao, excluido_em FROM nota_soap WHERE id = ?', [a.resultado.nota]))[0],
    ).toEqual({ situacao: 'sem_efeito', excluido_em: null });
  });

  it('visão por paciente com a configuração aplicável, busca de termos e correspondência', async () => {
    const v = await notas.doPaciente({ hospital: P, login: AUTOR }, ids.paciente);
    expect(v.atendimentos).toEqual([
      expect.objectContaining({
        id: ids.atend,
        configuracao: expect.objectContaining({ id: ids.config, usaCiap: true }),
      }),
    ]);
    expect(v.notas.length).toBeGreaterThanOrEqual(5);
    const ass = v.notas.find((n) => n.situacao === 'assinada')!;
    expect(ass.podeEditar).toBe(false);
    expect(ass.codigos[0]).toMatchObject({
      ciap: { codigo: `${M}K86`, sistema: 'ciap2' },
      cid: { codigo: 'I10' },
    });
    expect(v.notas.some((n) => n.situacao === 'rascunho' && n.podeEditar)).toBe(true);
    expect((await notas.termos('ciap2', `${M}K`)).map((t) => t.id)).toEqual([ids.ciap]);
    expect((await notas.termos('cid10', 'I10')).map((t) => t.codigo)).toContain('I10');
    expect((await notas.correspondencia(ids.ciap)).map((t) => t.id)).toEqual([ids.i10, ids.i15]);
  });

  it('as rotas exigem o vínculo assistencial com o paciente', async () => {
    const PERMS = ['pep.prontuario.ler', 'pep.evolucao.criar'];
    const montar = (vinculo: boolean) => {
      const trilha = new RegistradorTrilhaMemoria();
      const ctrl = new NotaSoapController(
        new EstadoProntuario(),
        trilha,
        notas,
        null,
        null,
        new VinculoSintetico(
          vinculo ? [{ login: AUTOR, idPaciente: ids.paciente, forma: 'atendimento-em-curso' }] : [],
        ),
        null,
      );
      const req = () =>
        ({
          headers: { 'idempotency-key': `${P}-ctrl-${randomUUID()}`, 'x-correlation-id': `${P}-ctrl` },
          ip: '127.0.0.1',
          sgh: {
            real: false,
            ability: criarAbility(regrasDeAcesso([...PERMS], null)),
            sessao: {
              usuario: { id: String(ids.autor), nome: 'Conta sintética', login: AUTOR },
              rede: `rede-${P}`,
              estabelecimentos: [],
              estabelecimentoAtivo: P,
              unidadeAtiva: null,
              permissoes: [...PERMS],
              restricaoVinculo: true,
              sintetica: true,
              bloqueioInatividadeSegundos: 0,
              expiraEm: '',
            },
          },
        }) as unknown as RequisicaoAutorizada;
      return { trilha, ctrl, req };
    };
    const antes = await contar();
    const sem = montar(false);
    await expect(sem.ctrl.doPaciente(ids.paciente, sem.req())).rejects.toMatchObject({ status: 403 });
    await expect(sem.ctrl.criar(nota(), sem.req())).rejects.toMatchObject({ status: 403 });
    expect(await contar()).toEqual(antes);
    const com = montar(true);
    const tela = await com.ctrl.doPaciente(ids.paciente, com.req());
    expect(tela.atendimentos[0]!.id).toBe(ids.atend);
    const r = await com.ctrl.criar(nota(), com.req());
    expect(r).toMatchObject({ ok: true, repetida: false });
    expect((await contar()).n).toBe(antes.n + 1);
  });
});
