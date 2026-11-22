// Integração da fonte própria do M16 contra o MariaDB real (cliente f22_o1, já criado pela obra da onda 1). Massa
// SINTÉTICA com códigos "L0105" (nenhuma pessoa real): um bloco, uma acomodação e dois leitos (um inativo). Confere
// o painel (leitos, situação e tipos), o movimento (unidades e contagens), a conferência sem divergência, os dias de
// censo fechado, uma internação encerrada por óbito (grupo pelo tipo de saída e clínica pela especialidade) e o
// selo do vigia pela trilha, com operações reais do Executor e o MotorVigia ligado à fonte.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { normalizarTrajetorias } from '@sgh/dominio-internacao';
import { conferirLeitos } from '@sgh/dominio-organizacao';
import {
  type ContextoNucleo,
  definirOperacao,
  type Escritor,
  gravarTrilha,
  NucleoProprio,
} from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import type { CtxInternacao } from './fonte.js';
import { FonteInternacaoPropria } from './fonte-propria.js';
import { MARCA_ZERO, MotorVigia } from './vigia.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o1';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L0105';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO)('fonte própria do M16 (MariaDB, cliente f22_o1)', () => {
  let nucleo: NucleoProprio;
  let fonte: FonteInternacaoPropria;
  const ids = {
    est: 0,
    usuario: 0,
    bloco: 0,
    acomodacao: 0,
    leitos: [] as number[],
    censo: 0,
    internacao: 0,
    atendimento: 0,
    catalogos: [] as [string, number][],
    pessoas: [] as number[],
    paciente: 0,
    profissional: 0,
  };
  let c: CtxInternacao;
  let alvo: ContextoNucleo;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-01-05-int' }, async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [`${P}I`],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}I`, 'ESTAB SINTETICO INTERNACAO', 'ESTAB SINTETICO INTERNACAO', agora],
      );
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['l0105.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['l0105.teste', 'USUARIO SINTETICO L0105', agora],
      );
      const ua = await garantir(
        e,
        'SELECT id FROM unidade_assistencial WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-UA`],
        "INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em) VALUES (?, ?, ?, 'internacao', ?)",
        [ids.est, `${P}-UA`, 'INTERNACAO SINTETICA', agora],
      );
      const ui = await garantir(
        e,
        'SELECT id FROM unidade_internacao WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-UI`],
        "INSERT INTO unidade_internacao (estabelecimento_id, unidade_assistencial_id, codigo, descricao, tipo, criado_em) VALUES (?, ?, ?, ?, 'enfermaria', ?)",
        [ids.est, ua, `${P}-UI`, 'ENFERMARIA SINTETICA', agora],
      );
      ids.bloco = await garantir(
        e,
        'SELECT id FROM bloco_internacao WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, 'B1'],
        'INSERT INTO bloco_internacao (estabelecimento_id, codigo, nome, criado_em) VALUES (?, ?, ?, ?)',
        [ids.est, 'B1', 'BLOCO SINTETICO', agora],
      );
      const cat = await garantir(
        e,
        'SELECT id FROM categoria_acomodacao WHERE codigo = ?',
        [`${P}-ENF`],
        "INSERT INTO categoria_acomodacao (codigo, descricao, tipo, criado_em) VALUES (?, ?, 'enfermaria', ?)",
        [`${P}-ENF`, 'ENFERMARIA L0105', agora],
      );
      ids.acomodacao = await garantir(
        e,
        'SELECT id FROM acomodacao WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, 'ENF1'],
        `INSERT INTO acomodacao (estabelecimento_id, bloco_internacao_id, unidade_internacao_id, categoria_acomodacao_id,
           codigo, nome, quantidade_leitos, criado_em) VALUES (?, ?, ?, ?, ?, ?, 2, ?)`,
        [ids.est, ids.bloco, ui, cat, 'ENF1', 'ENFERMARIA 1', agora],
      );
      const sit = await garantir(
        e,
        "SELECT id FROM situacao_leito WHERE situacao_base = 'livre' ORDER BY id LIMIT 1",
        [],
        "INSERT INTO situacao_leito (codigo, descricao, situacao_base, criado_em) VALUES (?, 'LIVRE', 'livre', ?)",
        [`${P}-LIVRE`, agora],
      );
      ids.leitos = [];
      for (const [codigo, ativo] of [
        ['01', true],
        ['02', false],
      ] as const)
        ids.leitos.push(
          await garantir(
            e,
            'SELECT id FROM leito_hospitalar WHERE unidade_internacao_id = ? AND codigo = ?',
            [ui, codigo],
            `INSERT INTO leito_hospitalar (estabelecimento_id, unidade_internacao_id, acomodacao_id, bloco_internacao_id,
               codigo, ramal, situacao_leito_id, ativo, criado_em) VALUES (?, ?, ?, ?, ?, '2101', ?, ?, ?)`,
            [ids.est, ui, ids.acomodacao, ids.bloco, codigo, sit, ativo, agora],
          ),
        );
      ids.censo = await garantir(
        e,
        'SELECT id FROM fechamento_censo WHERE estabelecimento_id = ? AND data_referencia = ?',
        [ids.est, '2026-01-10'],
        `INSERT INTO fechamento_censo (estabelecimento_id, unidade_internacao_id, data_referencia, corte_em, situacao,
           fechado_em, criado_em) VALUES (?, ?, '2026-01-10', ?, 'fechado', ?, ?)`,
        [ids.est, ui, new Date('2026-01-11T02:59:00Z'), agora, agora],
      );
      // Uma internação encerrada por óbito, 3 dias depois da entrada (massa sintética mínima do atendimento).
      await e.executar('DELETE FROM internacao WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [ids.est]);
      const catalogo = async (tabela: string, sel: string, p: unknown[], ins: string, pi: unknown[]) => {
        const id = await garantir(e, sel, p, ins, pi);
        ids.catalogos.push([tabela, id]);
        return id;
      };
      const tiss = await catalogo(
        'carater_atendimento_tiss',
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['L5'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('L5', 'CARATER L0105', 'teste', ?)",
        [agora],
      );
      const catAt = await catalogo(
        'categoria_atendimento',
        'SELECT id FROM categoria_atendimento WHERE codigo = ?',
        [`${P}-INT`],
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, 'INTERNACAO L0105', 'internacao', ?)",
        [`${P}-INT`, agora],
      );
      const carater = await catalogo(
        'carater_admissao',
        'SELECT id FROM carater_admissao WHERE codigo = ?',
        [`${P}-URG`],
        "INSERT INTO carater_admissao (codigo, descricao, urgencia, criado_em) VALUES (?, 'URGENCIA L0105', TRUE, ?)",
        [`${P}-URG`, agora],
      );
      const modal = await catalogo(
        'modalidade_internacao',
        'SELECT id FROM modalidade_internacao WHERE codigo = ?',
        [`${P}-CLI`],
        "INSERT INTO modalidade_internacao (codigo, descricao, criado_em) VALUES (?, 'CLINICA L0105', ?)",
        [`${P}-CLI`, agora],
      );
      const esp = await catalogo(
        'especialidade_medica',
        'SELECT id FROM especialidade_medica WHERE codigo = ?',
        [`${P}-CARD`],
        "INSERT INTO especialidade_medica (codigo, descricao, criado_em) VALUES (?, 'CARDIOLOGIA L0105', ?)",
        [`${P}-CARD`, agora],
      );
      const motivo = await catalogo(
        'motivo_saida_hospitalar',
        'SELECT id FROM motivo_saida_hospitalar WHERE codigo = ?',
        [`${P}-OBITO`],
        `INSERT INTO motivo_saida_hospitalar (codigo, descricao, tipo_saida, exige_declaracao_obito, criado_em)
           VALUES (?, 'OBITO L0105', 'obito', TRUE, ?)`,
        [`${P}-OBITO`, agora],
      );
      const fonte = await catalogo(
        'fonte_pagadora',
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}-INT`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, 'OPERADORA L0105 INT', 'operadora', 'ativa', ?)",
        [`${P}-INT`, agora],
      );
      const pessoa = (nome: string) =>
        garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
          [nome, agora],
        );
      const pp = await pessoa(`PACIENTE SINTETICO ${P} INT`);
      const pm = await pessoa(`MEDICO SINTETICO ${P} INT`);
      ids.pessoas = [pp, pm];
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pp],
        "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, ?, 'ativo', ?)",
        [pp, 910_105_101, agora],
      );
      ids.profissional = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pm],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pm, agora],
      );
      const entrada = new Date('2026-01-05T13:00:00Z');
      const alta = new Date('2026-01-08T13:00:00Z');
      ids.atendimento = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ids.est, `${P}-AT1`, ids.paciente, catAt, tiss, fonte, ids.profissional, entrada, agora],
      );
      ids.internacao = await e.inserir(
        `INSERT INTO internacao (estabelecimento_id, numero, atendimento_id, paciente_id, data_hora_entrada,
           carater_admissao_id, modalidade_internacao_id, unidade_internacao_id, acomodacao_id, especialidade_medica_id,
           medico_assistente_profissional_id, fonte_pagadora_id, situacao, data_hora_alta, motivo_saida_hospitalar_id,
           criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'alta', ?, ?, ?)`,
        [
          ids.est,
          `${P}-IN1`,
          ids.atendimento,
          ids.paciente,
          entrada,
          carater,
          modal,
          ui,
          ids.acomodacao,
          esp,
          ids.profissional,
          fonte,
          alta,
          motivo,
          agora,
        ],
      );
    });
    c = {
      rede: 'teste',
      hospital: `${P}I`,
      traceId: 'teste-01-05-m16',
      porta: {
        cliente: CLIENTE,
        estabelecimento: ids.est,
        usuario: ids.usuario,
        correlacao: 'teste-01-05-m16',
      },
    };
    alvo = { cliente: CLIENTE, estabelecimento: ids.est, usuario: null, correlacao: 'teste-01-05-vigia' };
    fonte = new FonteInternacaoPropria(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-01-05-int' }, async (e) => {
      await e.executar('DELETE FROM internacao WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [ids.est]);
      if (ids.profissional) await e.executar('DELETE FROM profissional WHERE id = ?', [ids.profissional]);
      if (ids.paciente) await e.executar('DELETE FROM paciente WHERE id = ?', [ids.paciente]);
      for (const p of ids.pessoas) await e.executar('DELETE FROM pessoa_fisica WHERE id = ?', [p]);
      for (const [t, id] of ids.catalogos) {
        if (!/^[a-z_]+$/.test(t)) continue;
        await e.executar(`DELETE FROM ${t} WHERE id = ?`, [id]);
      }
      await e.executar('DELETE FROM fechamento_censo WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM leito_hospitalar WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM acomodacao WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM bloco_internacao WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM unidade_internacao WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM unidade_assistencial WHERE estabelecimento_id = ?', [ids.est]);
    });
    await nucleo.encerrar();
  });

  it('painel: blocos, acomodação com o tipo, leitos com situação e ramal; nenhuma internação aberta', async () => {
    const p = await fonte.leiturasPainel(c);
    expect(p.blocos).toEqual([{ bloco: 'B1', nome: 'BLOCO SINTETICO' }]);
    expect(p.acomodacoes).toEqual([
      expect.objectContaining({ bloco: 'B1', acomodacao: 'ENF1', nome: 'ENFERMARIA 1' }),
    ]);
    expect(p.leitos.map((l) => [l.leito, l.status, l.reg, l.ramal])).toEqual([
      ['01', 'A', 0, 2101],
      ['02', 'I', 0, 2101],
    ]);
    expect(p.abertas).toEqual([]);
    const tipo = p.acomodacoes[0]?.tipo ?? 0;
    expect(p.tipos.get(tipo)).toBe('ENFERMARIA L0105');
  });

  it('movimento: a unidade com 2 leitos e 1 ativo; o óbito pelo tipo de saída e a clínica pela especialidade', async () => {
    const m = await fonte.movimento(c);
    expect(m.unidades).toEqual([
      expect.objectContaining({ bloco: 'B1', acomodacao: 'ENF1', leitos: 2, leitosAtivos: 1 }),
    ]);
    expect(m.dadosAte.getTime()).toBeLessThanOrEqual(Date.now());
    expect(m.internacoes).toEqual([
      expect.objectContaining({
        reg: ids.internacao,
        motivo: null,
        grupoSaida: 'obito',
        clinica: 'CARDIOLOGIA L0105',
        carater: '2',
      }),
    ]);
    // O motor conta o óbito institucional (mais de 24 horas) e recorta pela clínica da internação.
    const t = normalizarTrajetorias(m, Date.now());
    expect(t.internacoes).toEqual([
      expect.objectContaining({
        reg: ids.internacao,
        grupo: 'obito',
        obitoInstitucional: true,
        clinica: 'CARDIOLOGIA L0105',
      }),
    ]);
  });

  it('conferência: cadastro e retrato do mesmo banco não divergem', async () => {
    const { cadastro, espelho } = await fonte.conferencia(c);
    expect(cadastro.leitos).toHaveLength(2);
    const r = conferirLeitos(
      { acomodacoes: cadastro.acomodacoes, leitos: cadastro.leitos.map((l) => ({ ...l, ativo: l.ativo })) },
      espelho,
    );
    expect(r.divergencias).toEqual([]);
  });

  it('dias de censo fechado do período, só do estabelecimento', async () => {
    expect(await fonte.diasFechados(c, '2026-01-01', '2026-01-31')).toEqual(['2026-01-10']);
    expect(await fonte.diasFechados(c, '2026-02-01', '2026-02-28')).toEqual([]);
  });

  it('vigia: a marca perdida recomeça do topo; uma gravação de leito na trilha muda o selo, outra tabela não', async () => {
    const r0 = await fonte.canal(alvo, 'leitos', MARCA_ZERO);
    expect(r0.marca.maiorId).toBeGreaterThanOrEqual(0);
    const r1 = await fonte.canal(alvo, 'leitos', { ...r0.marca, maiorId: Math.max(1, r0.marca.maiorId) });
    const igual = await fonte.canal(alvo, 'leitos', r1.marca);
    expect(igual.selo).toBe(r1.selo);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-01-05-vigia' }, async (e) => {
      await gravarTrilha(e, {
        estabelecimento: ids.est,
        usuario: ids.usuario,
        acao: 'alteracao',
        entidade: 'agenda_servico',
        entidadeId: 1,
        correlacao: 'teste-01-05-vigia',
        ocorridoEm: new Date(),
      });
    });
    const outra = await fonte.canal(alvo, 'leitos', r1.marca);
    expect(outra.selo).toBe(r1.selo);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-01-05-vigia' }, async (e) => {
      await gravarTrilha(e, {
        estabelecimento: ids.est,
        usuario: ids.usuario,
        acao: 'alteracao',
        entidade: 'leito_hospitalar',
        entidadeId: ids.leitos[0] ?? null,
        correlacao: 'teste-01-05-vigia',
        ocorridoEm: new Date(),
      });
    });
    const mudou = await fonte.canal(alvo, 'leitos', outra.marca);
    expect(mudou.selo).not.toBe(outra.selo);
    expect(mudou.consultas).toBe(1);
  });

  it('vigia pelo Executor: operação com alvo fora do canal que ESCREVE no leito muda o selo; o MotorVigia avisa', async () => {
    const executor = nucleo.criarExecutor();
    const opCtx = () => ({ ...alvo, usuario: ids.usuario, chaveIdempotencia: `t0105-vigia-${randomUUID()}` });
    // Alvo da trilha: o estabelecimento (como uma operação de ADT cujo alvo é outra tabela); escrita: o bloco.
    const renomearBloco = definirOperacao({
      nome: 'teste.l0105_bloco',
      tabelas: ['bloco_internacao'],
      entrada: z.object({ bloco: z.number().int().positive() }).strict(),
      async gravar(tx, e) {
        const b = await tx.uma<{ versao: number }>('SELECT versao FROM bloco_internacao WHERE id = ?', [
          e.bloco,
        ]);
        await tx.alterar('bloco_internacao', e.bloco, Number(b?.versao), { nome: 'BLOCO SINTETICO' });
        return { bloco: e.bloco };
      },
      alvo: () => ({ tabela: 'estabelecimento', id: ids.est }),
    });
    const semLeito = definirOperacao({
      nome: 'teste.l0105_sem_leito',
      tabelas: ['bloco_internacao'],
      entrada: z.object({}).strict(),
      async gravar() {
        return {};
      },
      alvo: () => ({ tabela: 'estabelecimento', id: ids.est }),
    });
    const vigia = new MotorVigia({
      lerCanal: (ctx, canal, marca) => fonte.canal(ctx, canal, marca),
      armazem: new ArmazemMemoria(),
      tipoArmazem: 'memoria',
    });
    // Sem ouvinte (nenhum temporizador): os ciclos são só os chamados aqui; a versão conta as mudanças vistas.
    await vigia.cicloAgora(alvo, 'leitos');
    await vigia.cicloAgora(alvo, 'leitos');
    expect(vigia.versao(alvo, 'leitos')).toBe(0);
    await executor.executar(semLeito, CLIENTE, {}, opCtx());
    await vigia.cicloAgora(alvo, 'leitos');
    expect(vigia.versao(alvo, 'leitos')).toBe(0);
    await executor.executar(renomearBloco, CLIENTE, { bloco: ids.bloco }, opCtx());
    await vigia.cicloAgora(alvo, 'leitos');
    expect(vigia.versao(alvo, 'leitos')).toBe(1);
    expect(vigia.ultimoCiclo(alvo, 'leitos')).not.toBeNull();
    const saude = vigia.saude().canais.find((x) => x.estabelecimento === String(ids.est));
    expect(saude).toMatchObject({ erros: 0, mudancas: 1 });
    vigia.parar();
  });

  it('sem estabelecimento na sessão: recusa sem ler', async () => {
    await expect(fonte.leiturasPainel({ rede: 'teste', hospital: 'x', traceId: 't' })).rejects.toThrow();
  });
});
