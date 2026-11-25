// Contrato de efeito do exame físico estruturado por sistema e região do corpo (03-PEP L97), contra o MariaDB real
// (cliente de teste f22_o3 por padrão). Massa SINTÉTICA própria (estabelecimento c2069, logins c2069.*, sistemas,
// regiões e achados padronizados C2069_*), limpa antes e depois (a trilha pelo utilitário comum). Prova o que fica no
// banco: cada achado em exame_fisico_achado ligado ao registro clínico, numerado no registro, com o sistema e a região
// completados pelo achado padronizado, o lado, o normal e a descrição; o acréscimo continua a numeração; a repetição
// pela mesma chave não grava de novo; o selo do lote na trilha; as recusas (não autor, registro suspenso, registro
// assinado, janela de complemento encerrada, registro de outro estabelecimento, lado faltando, achado de outro público,
// normal contra o já gravado) sem gravar nada; os achados no texto do registro (leitura do prontuário e busca); a visão
// por paciente com o resumo por sistema; e as rotas com o vínculo assistencial. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { criarAbility, regrasDeAcesso, VinculoSintetico } from '@sgh/dominio-acesso';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { ExameFisicoController } from './exame-fisico.controller.js';
import { ExameFisicoPropria, seloDoExame, textosDoExameFisico } from './exame-fisico-propria.js';
import { PortaProntuarioPropria } from './prontuario-porta-propria.js';
import { EstadoProntuario } from './sessao-prontuario.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'c2069';
const M = 'C2069';
const AUTOR = `${P}.autor`;
const OUTRO = `${P}.outro`;
const PRONTUARIO = 206_906_901;
const recusada = (codigo: string) => ({ problema: expect.objectContaining({ codigo }) });

describe.skipIf(SEM_BANCO)('exame físico estruturado (banco próprio, MariaDB)', () => {
  let nucleo: NucleoProprio;
  let exame: ExameFisicoPropria;
  const ids = {
    est: 0,
    autor: 0,
    paciente: 0,
    registro: 0,
    suspenso: 0,
    antigo: 0,
    assinado: 0,
    outraUnidade: 0,
    estB: 0,
    cardio: 0,
    resp: 0,
    torax: 0,
    membros: 0,
    membroSup: 0,
    cardioNormal: 0,
    edema: 0,
    pediatrico: 0,
  };

  const limpar = async (e: Escritor) => {
    const regs = `(SELECT id FROM registro_assistencial WHERE paciente_id IN
                     (SELECT id FROM paciente WHERE numero_prontuario = ?))`;
    await e.executar(`DELETE FROM exame_fisico_achado WHERE registro_assistencial_id IN ${regs}`, [
      PRONTUARIO,
    ]);
    await e.executar('DELETE FROM achado_exame_fisico_padrao WHERE codigo LIKE ?', [`${M}%`]);
    await e.executar('UPDATE regiao_corporal SET superior_regiao_corporal_id = NULL WHERE codigo LIKE ?', [
      `${M}%`,
    ]);
    await e.executar('DELETE FROM regiao_corporal WHERE codigo LIKE ?', [`${M}%`]);
    await e.executar('DELETE FROM sistema_corporal WHERE codigo LIKE ?', [`${M}%`]);
    await e.executar(
      'DELETE FROM registro_assistencial WHERE paciente_id IN (SELECT id FROM paciente WHERE numero_prontuario = ?)',
      [PRONTUARIO],
    );
    await e.executar('DELETE FROM documento_prontuario WHERE titulo = ?', [`Documento sintético ${P}`]);
    await e.executar(
      'DELETE FROM atendimento WHERE paciente_id IN (SELECT id FROM paciente WHERE numero_prontuario = ?)',
      [PRONTUARIO],
    );
    await e.executar('DELETE FROM situacao_documento_prontuario WHERE codigo = ?', [`${M}_ASS`]);
    await e.executar('DELETE FROM modelo_documento_clinico WHERE codigo LIKE ?', [`${M}_%`]);
    await e.executar('DELETE FROM tipo_documento_clinico WHERE codigo LIKE ?', [`${M}_%`]);
    await e.executar('DELETE FROM paciente WHERE numero_prontuario = ?', [PRONTUARIO]);
    const profs = '(SELECT id FROM profissional WHERE observacao = ?)';
    await e.executar(`DELETE FROM usuario_profissional WHERE profissional_id IN ${profs}`, [`massa ${P}`]);
    await e.executar('DELETE FROM profissional WHERE observacao = ?', [`massa ${P}`]);
    await e.executar('DELETE FROM pessoa_fisica WHERE nome LIKE ?', [`Pessoa sintética ${P}%`]);
    await e.executar('DELETE FROM categoria_atendimento WHERE codigo LIKE ?', [`${P}%`]);
    await e.executar('DELETE FROM carater_atendimento_tiss WHERE codigo_tiss LIKE ?', [`${P}%`]);
    await e.executar('DELETE FROM fonte_pagadora WHERE codigo LIKE ?', [`${P}%`]);
    await limparTrilhaDaMassa(e, { codigos: [P, `${P}b`] });
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
  const achados = (registro = ids.registro) =>
    ler(
      `SELECT sequencia, sistema_corporal_id, regiao_corporal_id, achado_exame_fisico_padrao_id, lateralidade, normal,
              descricao, origem, criado_por, excluido_em
         FROM exame_fisico_achado WHERE registro_assistencial_id = ? ORDER BY sequencia`,
      [registro],
    );
  const contar = async () =>
    Number(
      (
        await ler<{ n: number }>(
          `SELECT COUNT(*) AS n FROM exame_fisico_achado a JOIN registro_assistencial r
              ON r.id = a.registro_assistencial_id WHERE r.paciente_id = ?`,
          [ids.paciente],
        )
      )[0]!.n,
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    exame = new ExameFisicoPropria(nucleo, CLIENTE);
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
      const estB = await e.uma<{ id: unknown }>('SELECT id FROM estabelecimento WHERE codigo = ?', [`${P}b`]);
      ids.estB = estB
        ? Number(estB.id)
        : await ins(
            'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
            [`${P}b`, `Hospital sintético ${P}b`, `Hospital sintético ${P}b (fictício)`, agora],
          );
      ids.autor = await usuario(AUTOR, '20690690001');
      const outro = await usuario(OUTRO, '20690690002');
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
        [await pessoa('paciente', '1980-05-10'), PRONTUARIO, agora],
      );
      const tipo = await ins(
        'INSERT INTO tipo_documento_clinico (codigo, descricao, categoria, criado_em) VALUES (?, ?, ?, ?)',
        [`${M}_EVOL`, 'Evolução sintética', 'evolucao', agora],
      );
      const modelo = await ins(
        `INSERT INTO modelo_documento_clinico (codigo, titulo, tipo_documento_clinico_id, tipo_registro, criado_em)
         VALUES (?, ?, ?, 'evolucao', ?)`,
        [`${M}_EVO`, 'Evolução sintética', tipo, agora],
      );
      const categoria = await ins(
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'internacao', ?)",
        [`${P}int`, 'Categoria sintética', agora],
      );
      const carater = await ins(
        'INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}c`, 'Caráter sintético', 'teste', agora],
      );
      const fonte = await ins(
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'particular', ?)",
        [`${P}fp`, 'Fonte pagadora sintética', agora],
      );
      const atend = await ins(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em, situacao)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'aberto')`,
        [
          ids.est,
          '206901',
          ids.paciente,
          categoria,
          carater,
          fonte,
          medico,
          new Date('2026-11-01T10:00:00Z'),
          agora,
        ],
      );
      // Lançados há 1 hora (dentro da janela de complemento), menos o antigo (há 3 dias).
      const horasAtras = (h: number) => new Date(agora.getTime() - h * 3_600_000).toISOString();
      const registro = (clinica: string, suspenso = false, est = ids.est) =>
        ins(
          `INSERT INTO registro_assistencial (estabelecimento_id, paciente_id, atendimento_id, modelo_documento_clinico_id,
             tipo_documento_clinico_id, autor_profissional_id, autor_usuario_id, data_hora_clinica, data_hora_lancamento,
             impressao_digital, situacao, suspenso_em, suspenso_por_usuario_id, justificativa_suspensao, texto_consolidado,
             criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            est,
            ids.paciente,
            atend,
            modelo,
            tipo,
            medico,
            ids.autor,
            new Date(clinica),
            new Date(clinica),
            '0'.repeat(64),
            suspenso ? 'suspenso' : 'finalizado',
            suspenso ? agora : null,
            suspenso ? ids.autor : null,
            suspenso ? `Lançado no paciente errado ${P}` : null,
            `Evolução sintética ${P}`,
            agora,
          ],
        );
      ids.registro = await registro(horasAtras(2));
      ids.suspenso = await registro(horasAtras(1), true);
      ids.antigo = await registro(horasAtras(72));
      ids.assinado = await registro(horasAtras(1));
      ids.outraUnidade = await registro(horasAtras(1), false, ids.estB);
      // O documento do registro "assinado" com assinatura concluída (situação sintética da categoria assinado).
      const situacaoAssinada = await ins(
        `INSERT INTO situacao_documento_prontuario (codigo, descricao, categoria, criado_em) VALUES (?, ?, 'assinado', ?)`,
        [`${M}_ASS`, 'Assinado sintético', agora],
      );
      const documento = await ins(
        `INSERT INTO documento_prontuario (estabelecimento_id, paciente_id, atendimento_id, tipo_documento_clinico_id,
           modelo_documento_clinico_id, situacao_documento_prontuario_id, entidade_origem, entidade_origem_id, titulo,
           profissional_id, referencia_em, lancado_em, numero_versao, confidencial, origem, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, 'registro_assistencial', ?, ?, ?, ?, ?, 1, FALSE, 'sistema', ?)`,
        [
          ids.est,
          ids.paciente,
          atend,
          tipo,
          modelo,
          situacaoAssinada,
          ids.assinado,
          `Documento sintético ${P}`,
          medico,
          new Date(horasAtras(1)),
          new Date(horasAtras(1)),
          agora,
        ],
      );
      await e.executar('UPDATE registro_assistencial SET documento_prontuario_id = ? WHERE id = ?', [
        documento,
        ids.assinado,
      ]);
      const sistema = (codigo: string, descricao: string, ordem: number) =>
        ins('INSERT INTO sistema_corporal (codigo, descricao, ordem, criado_em) VALUES (?, ?, ?, ?)', [
          `${M}_${codigo}`,
          descricao,
          ordem,
          agora,
        ]);
      ids.cardio = await sistema('CV', 'Cardiovascular sintético', 1);
      ids.resp = await sistema('RESP', 'Respiratório sintético', 2);
      const regiao = (codigo: string, descricao: string, nivel: string, lado: boolean, sup: number | null) =>
        ins(
          `INSERT INTO regiao_corporal (codigo, descricao, nivel, admite_lateralidade, superior_regiao_corporal_id,
             criado_em) VALUES (?, ?, ?, ?, ?, ?)`,
          [`${M}_${codigo}`, descricao, nivel, lado, sup, agora],
        );
      ids.torax = await regiao('TORAX', 'Tórax sintético', 'parte', false, null);
      ids.membros = await regiao('MMSS', 'Membros superiores sintéticos', 'parte', true, null);
      ids.membroSup = await regiao('BRACO', 'Braço sintético', 'membro', true, ids.membros);
      const padrao = (
        codigo: string,
        descricao: string,
        sis: number | null,
        reg: number | null,
        normal: boolean,
        publico = 'todos',
      ) =>
        ins(
          `INSERT INTO achado_exame_fisico_padrao (codigo, descricao, sistema_corporal_id, regiao_corporal_id, normal,
             publico_alvo, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [`${M}_${codigo}`, descricao, sis, reg, normal, publico, agora],
        );
      ids.cardioNormal = await padrao(
        'CVN',
        'Ritmo regular em dois tempos, sem sopros',
        ids.cardio,
        null,
        true,
      );
      ids.edema = await padrao('EDEMA', 'Edema', null, ids.membros, false);
      ids.pediatrico = await padrao(
        'PED',
        'Murmúrio vesicular do lactente',
        ids.resp,
        null,
        true,
        'pediatrico',
      );
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, (e) => limpar(e));
    await nucleo.encerrar?.();
  });

  it('grava os achados numerados no registro, completados pelo achado padronizado; a repetição não grava de novo', async () => {
    const chave = `${P}-${randomUUID()}`;
    const entrada = {
      registro: ids.registro,
      itens: [
        { padrao: ids.cardioNormal },
        { regiao: ids.membroSup, padrao: ids.edema, lateralidade: 'esquerdo', descricao: ' Cacifo ++/4+ ' },
        { sistema: ids.resp, regiao: ids.torax, normal: false, descricao: 'Estertores em base' },
      ],
    };
    const r = await exame.gravarExame(ctx(AUTOR, chave), entrada);
    expect(r.repetida).toBe(false);
    expect(r.resultado).toMatchObject({ de: 1, ate: 3, quantidade: 3 });
    // O complemento é selado: o SHA-256 das linhas do lote vai à trilha encadeada e confere com o recalculado.
    const selo = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: `selo-${P}` }, (l) =>
      seloDoExame(l, ids.registro, 1, 3),
    );
    expect(r.resultado.selo).toBe(selo);
    const trilha = await ler<{ selo: string; est: number }>(
      `SELECT JSON_VALUE(dados_depois, '$.dados.selo') AS selo, estabelecimento_id AS est FROM trilha_auditoria
        WHERE entidade = 'exame_fisico_achado' AND entidade_id = ?`,
      [r.resultado.primeiro],
    );
    expect(trilha).toEqual([{ selo, est: ids.est }]);
    const linhas = await achados();
    expect(linhas).toHaveLength(3);
    expect(linhas[0]).toMatchObject({
      sequencia: 1,
      sistema_corporal_id: ids.cardio,
      regiao_corporal_id: null,
      achado_exame_fisico_padrao_id: ids.cardioNormal,
      lateralidade: 'nao_se_aplica',
      normal: 1,
      descricao: null,
      origem: 'sistema',
      criado_por: ids.autor,
      excluido_em: null,
    });
    expect(linhas[1]).toMatchObject({
      sequencia: 2,
      sistema_corporal_id: null,
      regiao_corporal_id: ids.membroSup,
      achado_exame_fisico_padrao_id: ids.edema,
      lateralidade: 'esquerdo',
      normal: 0,
      descricao: 'Cacifo ++/4+',
    });
    expect(linhas[2]).toMatchObject({ sequencia: 3, sistema_corporal_id: ids.resp, normal: 0 });
    const repetida = await exame.gravarExame(ctx(AUTOR, chave), entrada);
    expect(repetida.repetida).toBe(true);
    expect(await achados()).toHaveLength(3);
  });

  it('o acréscimo continua a numeração; normal contra o já gravado e repetido são recusados sem gravar', async () => {
    const r = await exame.gravarExame(ctx(), {
      registro: ids.registro,
      itens: [{ regiao: ids.membroSup, lateralidade: 'direito', normal: true }],
    });
    expect(r.resultado).toMatchObject({ de: 4, ate: 4, quantidade: 1 });
    const antes = await contar();
    await expect(
      exame.gravarExame(ctx(), {
        registro: ids.registro,
        itens: [{ sistema: ids.cardio, normal: false, descricao: 'Sopro sistólico' }],
      }),
    ).rejects.toMatchObject(recusada('normal-e-alterado'));
    await expect(
      exame.gravarExame(ctx(), { registro: ids.registro, itens: [{ padrao: ids.cardioNormal }] }),
    ).rejects.toMatchObject(recusada('achado-repetido'));
    expect(await contar()).toBe(antes);
  });

  it('recusas sem gravar nada: não autor, registro suspenso, lado faltando, achado de outro público', async () => {
    const antes = await contar();
    // Complemento recusado: registro com assinatura concluída, fora da janela e de outro estabelecimento.
    await expect(
      exame.gravarExame(ctx(), { registro: ids.assinado, itens: [{ sistema: ids.resp, normal: true }] }),
    ).rejects.toMatchObject(recusada('registro-assinado'));
    await expect(
      exame.gravarExame(ctx(), { registro: ids.antigo, itens: [{ sistema: ids.resp, normal: true }] }),
    ).rejects.toMatchObject(recusada('janela-de-complemento-encerrada'));
    await expect(
      exame.gravarExame(ctx(), { registro: ids.outraUnidade, itens: [{ sistema: ids.resp, normal: true }] }),
    ).rejects.toMatchObject({
      problema: expect.objectContaining({ codigo: 'registro-inexistente', status: 404 }),
    });
    // A sessão no estabelecimento B não grava no registro da unidade A.
    await expect(
      exame.gravarExame(
        { ...ctx(), hospital: `${P}b` },
        { registro: ids.registro, itens: [{ sistema: ids.resp, normal: true }] },
      ),
    ).rejects.toMatchObject({
      problema: expect.objectContaining({ codigo: 'registro-inexistente', status: 404 }),
    });
    await expect(
      exame.gravarExame(ctx(OUTRO), { registro: ids.registro, itens: [{ sistema: ids.resp, normal: true }] }),
    ).rejects.toMatchObject(recusada('nao-e-autor'));
    await expect(
      exame.gravarExame(ctx(), { registro: ids.suspenso, itens: [{ sistema: ids.resp, normal: true }] }),
    ).rejects.toMatchObject(recusada('registro-fora-de-vigor'));
    await expect(
      exame.gravarExame(ctx(), { registro: ids.registro, itens: [{ regiao: ids.membros, normal: true }] }),
    ).rejects.toMatchObject(recusada('lado-obrigatorio'));
    await expect(
      exame.gravarExame(ctx(), { registro: ids.registro, itens: [{ padrao: ids.pediatrico }] }),
    ).rejects.toMatchObject(recusada('achado-padrao-outro-publico'));
    expect(await contar()).toBe(antes);
  });

  it('visão por paciente: achados com o texto, resumo por sistema e quem pode acrescentar; catálogo do mapa', async () => {
    const v = await exame.doPaciente({ hospital: P, login: AUTOR }, ids.paciente);
    expect(v.faixa).toBe('adulto');
    const reg = v.registros.find((x) => x.registro === ids.registro)!;
    expect(reg.podeAcrescentar).toBe(true);
    expect(reg.achados.map((a) => a.sequencia)).toEqual([1, 2, 3, 4]);
    expect(reg.achados[1]!.texto).toBe('Braço sintético (esquerdo): Edema; Cacifo ++/4+');
    expect(reg.resumo).toEqual(
      expect.arrayContaining([
        { sistema: 'Cardiovascular sintético', examinados: 1, normais: 1, alterados: 0 },
        { sistema: null, examinados: 2, normais: 1, alterados: 1 },
      ]),
    );
    expect(v.registros.find((x) => x.registro === ids.suspenso)!.podeAcrescentar).toBe(false);
    expect(v.registros.find((x) => x.registro === ids.assinado)!.podeAcrescentar).toBe(false);
    expect(v.registros.find((x) => x.registro === ids.antigo)!.podeAcrescentar).toBe(false);
    expect(v.registros.find((x) => x.registro === ids.outraUnidade)!.podeAcrescentar).toBe(false);
    expect(reg.achados[0]!.lancadoEm).not.toBeNull();
    const outro = await exame.doPaciente({ hospital: P, login: OUTRO }, ids.paciente);
    expect(outro.registros.every((x) => !x.podeAcrescentar)).toBe(true);
    const cat = await exame.catalogo();
    expect(cat.regioes.find((r) => r.id === ids.membroSup)).toMatchObject({
      superior: ids.membros,
      admiteLateralidade: true,
    });
    expect(cat.padroes.find((p) => p.id === ids.pediatrico)).toMatchObject({ publicoAlvo: 'pediatrico' });
  });

  it('os achados entram no texto do registro: leitura do prontuário (como emitido) e busca, em bloco datado', async () => {
    const textos = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: `texto-${P}` }, (l) =>
      textosDoExameFisico(l, [ids.registro, ids.antigo], 'America/Sao_Paulo'),
    );
    expect(textos.has(ids.antigo)).toBe(false);
    const texto = textos.get(ids.registro)!;
    expect(texto).toMatch(/^Exame físico estruturado \(lançado em \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}\):\n/);
    expect(texto).toContain('- Cardiovascular sintético: Ritmo regular em dois tempos, sem sopros');
    expect(texto).toContain('- Braço sintético (esquerdo): Edema; Cacifo ++/4+');
    expect(texto).toContain('- Respiratório sintético · Tórax sintético: alterado; Estertores em base');
    const prontuario = new PortaProntuarioPropria(nucleo, CLIENTE);
    const C = {
      rede: CLIENTE,
      hospital: P,
      cliente: CLIENTE,
      estabelecimento: null,
      usuario: null,
      correlacao: P,
    };
    const conteudo = await prontuario.conteudo(C, ids.registro, { rtf: true, xml: false });
    expect(conteudo?.rtf).toContain(`Evolu\\u231?\\u227?o sint\\u233?tica ${P}`);
    expect(conteudo?.rtf).toContain('Ritmo regular em dois tempos, sem sopros');
    expect(conteudo?.rtf).toContain('Cacifo ++/4+');
    const busca = await prontuario.textos(C, ids.paciente, {}, 50);
    expect(busca.registros.find((x) => x.id === ids.registro)?.rtf).toContain('Estertores em base');
    expect(busca.registros.find((x) => x.id === ids.antigo)?.rtf).not.toContain('Exame f');
  });

  it('as rotas exigem o vínculo assistencial com o paciente e a leitura vai à trilha', async () => {
    const PERMS = ['pep.prontuario.ler', 'pep.evolucao.criar'];
    const montar = (vinculo: boolean) => {
      const trilha = new RegistradorTrilhaMemoria();
      const ctrl = new ExameFisicoController(
        new EstadoProntuario(),
        trilha,
        exame,
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
    expect(
      sem.trilha.eventos.some(
        (e) => e.evento === EVENTOS_AUDITAVEIS.permissaoNegada.codigo && e.paciente === ids.paciente,
      ),
    ).toBe(true);
    await expect(
      sem.ctrl.gravar({ registro: ids.registro, itens: [{ sistema: ids.resp, normal: true }] }, sem.req()),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      sem.ctrl.gravar({ registro: 999_999_999, itens: [{ sistema: ids.resp, normal: true }] }, sem.req()),
    ).rejects.toMatchObject({ status: 404 });
    expect(await contar()).toBe(antes);
    const com = montar(true);
    const tela = await com.ctrl.doPaciente(ids.paciente, com.req());
    expect(tela.registros.length).toBe(5);
    expect(
      com.trilha.eventos.filter(
        (e) =>
          e.evento === EVENTOS_AUDITAVEIS.consultaRes.codigo &&
          e.paciente === ids.paciente &&
          e.recurso === 'pep.prontuario',
      ),
    ).toHaveLength(1);
    const r = await com.ctrl.gravar(
      { registro: ids.registro, itens: [{ sistema: ids.resp, normal: true }] },
      com.req(),
    );
    expect(r.ok).toBe(true);
    expect(r.resultado).toMatchObject({ de: 5, ate: 5, quantidade: 1 });
    expect(await contar()).toBe(antes + 1);
  });
});
