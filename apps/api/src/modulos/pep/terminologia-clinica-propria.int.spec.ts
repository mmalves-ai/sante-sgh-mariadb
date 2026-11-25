// Contrato de efeito da terminologia clínica (F8, 09-AREA linha 84) contra o MariaDB do cliente de teste (f22_o2 por
// padrão). Massa SINTÉTICA: a da enfermagem (estabelecimentos C2032/C2032B, paciente, atendimentos, profissional) mais
// conceitos clínicos sintéticos (códigos C2032-*), uma equivalência com a CID-10 e regiões anatômicas sintéticas
// (sistema c2032); a CID-10 é a oficial carregada. Tudo limpo antes e depois (a trilha pelo utilitário comum).
// Prova o que fica no banco: o diagnóstico do atendimento com a CID-10 e o conceito equivalente; a troca e a retirada
// do conceito (versão sobe, nada apagado); as recusas sem gravar (capítulo da CID, conceito inativo, conceito de outra
// terminologia, segundo principal, atendimento de outro paciente, diagnóstico inativado); a busca com a equivalência
// primeiro; a região anatômica ligada ao exame (padrão única, retirada só desativa, religação na mesma linha); a
// visão por paciente; a trilha de cada gravação. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import {
  CLIENTE,
  limparMassa,
  type MassaEnfermagem,
  montarMassa,
  SEM_BANCO,
} from '../enfermagem/massa-enfermagem.spec-util.js';
import { TerminologiaClinicaPropria } from './terminologia-clinica-propria.js';

const MARCA = 'C2032';
const recusada = (codigo: string) => ({ problema: expect.objectContaining({ codigo }) });

describe.skipIf(SEM_BANCO)(
  'terminologia clínica: conceito do diagnóstico e região anatômica (MariaDB)',
  () => {
    const nucleo = new NucleoProprio();
    let m: MassaEnfermagem | null = null;
    let porta: TerminologiaClinicaPropria;
    const ids = { snomed: 0, fratura: 0, fraturaB: 0, inativo: 0, cid: 0, capitulo: 0, exame: 0 };
    const reg = { mao: 0, dedo: 0, velha: 0 };
    let pacienteOutro = 0;

    const ctx = (login = m!.login) => ({
      hospital: MARCA,
      login,
      correlacao: 'teste-c2032',
      chaveIdempotencia: `c2032-${randomUUID()}`,
    });
    const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-c2032' }, (l) =>
        l.consultar(sql, p),
      ) as Promise<T[]>;
    const diag = async (id: number) =>
      (await ler('SELECT * FROM diagnostico_atendimento WHERE id = ?', [id]))[0] as Record<string, unknown>;
    const contarDiag = async () =>
      Number(
        (
          await ler<{ n: number }>(
            'SELECT COUNT(*) AS n FROM diagnostico_atendimento WHERE paciente_id = ?',
            [m!.paciente],
          )
        )[0]!.n,
      );
    const registrar = (o: Record<string, unknown> = {}) =>
      porta.gravarDiagnosticoAtendimento(ctx(), {
        acao: 'registrar',
        paciente: m!.paciente,
        atendimento: m!.atendimento,
        cid: ids.cid,
        ...o,
      });

    const limpar = async (e: Escritor) => {
      if (m) {
        await e.executar('DELETE FROM diagnostico_atendimento WHERE paciente_id = ?', [m.paciente]);
        await limparTrilhaDaMassa(e, { codigos: [MARCA, `${MARCA}B`] });
      }
      await e.executar(
        `DELETE x FROM exame_regiao_anatomica x JOIN regiao_anatomica_codificada r
          ON r.id = x.regiao_anatomica_codificada_id WHERE r.sistema_codificacao = 'c2032'`,
      );
      await e.executar(
        "UPDATE regiao_anatomica_codificada SET regiao_superior_id = NULL WHERE sistema_codificacao = 'c2032'",
      );
      await e.executar("DELETE FROM regiao_anatomica_codificada WHERE sistema_codificacao = 'c2032'");
      await e.executar(
        `DELETE q FROM termo_equivalencia q JOIN termo_terminologia t ON t.id = q.termo_terminologia_id
        WHERE t.codigo_termo LIKE 'C2032-%'`,
      );
      await e.executar("DELETE FROM termo_terminologia WHERE codigo_termo LIKE 'C2032-%'");
    };

    beforeAll(async () => {
      m = await montarMassa(nucleo, MARCA, false);
      porta = new TerminologiaClinicaPropria(nucleo, CLIENTE);
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-c2032' }, async (e) => {
        await limpar(e);
        const agora = new Date();
        const t = await e.uma<{ id: number }>("SELECT id FROM terminologia WHERE codigo = 'snomed'");
        ids.snomed = t
          ? Number(t.id)
          : await e.inserir(
              `INSERT INTO terminologia (codigo, nome, sigla, tipo, licenciada, criado_em)
             VALUES ('snomed', 'Terminologia clínica (sintética no teste)', 'SNOMED CT', 'clinica', TRUE, ?)`,
              [agora],
            );
        const cid10 = async (codigo: string) => {
          const r = await e.uma<{ id: number }>(
            `SELECT t.id FROM termo_terminologia t JOIN terminologia g ON g.id = t.terminologia_id
            WHERE g.codigo = 'cid10' AND t.codigo_termo = ?`,
            [codigo],
          );
          if (!r) throw new Error(`CID-10 sem o termo ${codigo} no cliente de teste`);
          return Number(r.id);
        };
        ids.cid = await cid10('I219');
        ids.capitulo = await cid10('IX');
        const conceito = (codigo: string, descricao: string, ativo = true) =>
          e.inserir(
            `INSERT INTO termo_terminologia (terminologia_id, codigo_termo, descricao, ativo, criado_em)
           VALUES (?, ?, ?, ?, ?)`,
            [ids.snomed, codigo, descricao, ativo, agora],
          );
        ids.fratura = await conceito('C2032-1', 'Infarto sintético C2032 de parede anterior');
        ids.fraturaB = await conceito('C2032-2', 'Infarto sintético C2032 de parede inferior');
        ids.inativo = await conceito('C2032-3', 'Conceito sintético C2032 retirado', false);
        await e.inserir(
          `INSERT INTO termo_equivalencia (termo_terminologia_id, equivalente_termo_terminologia_id, tipo_equivalencia,
           principal, fonte, vigencia_inicio, criado_em) VALUES (?, ?, 'equivalente', TRUE, 'teste C2032', '2020-01-01', ?)`,
          [ids.fraturaB, ids.cid, agora],
        );
        const regiao = (codigo: string, nivel: string, superior: number | null, ativo = true) =>
          e.inserir(
            `INSERT INTO regiao_anatomica_codificada (sistema_codificacao, nivel, codigo_anatomico, descricao,
             regiao_superior_id, ativo, criado_em) VALUES ('c2032', ?, ?, ?, ?, ?, ?)`,
            [nivel, codigo, `Região sintética ${codigo}`, superior, ativo, agora],
          );
        reg.mao = await regiao('C2032-MAO', 'regiao', null);
        reg.dedo = await regiao('C2032-DEDO', 'localizacao_primaria', reg.mao);
        reg.velha = await regiao('C2032-VELHA', 'regiao', null, false);
        const ex = await e.uma<{ id: number }>('SELECT id FROM exame ORDER BY id LIMIT 1');
        if (!ex) throw new Error('cliente de teste sem exame no catálogo');
        ids.exame = Number(ex.id);
        const outro = await e.uma<{ id: number }>(
          'SELECT id FROM paciente WHERE id <> ? ORDER BY id LIMIT 1',
          [m!.paciente],
        );
        pacienteOutro = Number(outro!.id);
      });
    }, 120_000);

    afterAll(async () => {
      if (!m) return;
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c2032' }, limpar);
      await limparMassa(nucleo, m);
    }, 120_000);

    it('busca: com a CID, a equivalência principal vem primeiro; por texto, só os ativos', async () => {
      const r = await porta.conceitos({ texto: 'sintético C2032', cid: ids.cid });
      expect(r[0]).toMatchObject({ id: ids.fraturaB, equivalencia: 'equivalente' });
      expect(r.map((x) => x.id)).toEqual([ids.fraturaB, ids.fratura]);
      expect((await porta.conceitos({ texto: 'C2032-1' }))[0]!.id).toBe(ids.fratura);
    });

    it('registra o diagnóstico com a CID-10 e o conceito equivalente, e o profissional da conta', async () => {
      const r = await registrar({
        conceito: ids.fratura,
        tipo: 'principal',
        observacao: ' parede anterior ',
      });
      const d = await diag(r.resultado.diagnostico);
      expect(d).toMatchObject({
        paciente_id: m!.paciente,
        atendimento_id: m!.atendimento,
        cid_termo_terminologia_id: ids.cid,
        snomed_termo_terminologia_id: ids.fratura,
        tipo: 'principal',
        certeza: 'confirmado',
        situacao: 'ativo',
        profissional_id: m!.profissional,
        observacao: 'parede anterior',
        versao: 1,
      });
      const trilha = await ler(
        `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'diagnostico_atendimento' AND entidade_id = ?`,
        [r.resultado.diagnostico],
      );
      expect(Number(trilha[0]!['n'])).toBeGreaterThanOrEqual(1);
    });

    it('as recusas não gravam nada', async () => {
      const antes = await contarDiag();
      await expect(registrar({ cid: ids.capitulo })).rejects.toMatchObject(recusada('cid-nao-codificavel'));
      await expect(registrar({ conceito: ids.inativo })).rejects.toMatchObject(recusada('conceito-inativo'));
      await expect(registrar({ conceito: ids.cid })).rejects.toMatchObject(
        recusada('conceito-de-outra-terminologia'),
      );
      await expect(registrar({ tipo: 'principal' })).rejects.toMatchObject(
        recusada('principal-ja-registrado'),
      );
      await expect(registrar({ paciente: pacienteOutro })).rejects.toMatchObject(
        recusada('atendimento-de-outro-paciente'),
      );
      expect(await contarDiag()).toBe(antes);
    });

    it('troca e tira o conceito: a versão sobe e a CID fica; o inativado não muda', async () => {
      const r = await registrar();
      const id = r.resultado.diagnostico;
      expect((await diag(id))['snomed_termo_terminologia_id']).toBeNull();
      await porta.gravarDiagnosticoAtendimento(ctx(), {
        acao: 'conceito',
        diagnostico: id,
        versao: 1,
        conceito: ids.fraturaB,
      });
      expect(await diag(id)).toMatchObject({
        snomed_termo_terminologia_id: ids.fraturaB,
        cid_termo_terminologia_id: ids.cid,
        versao: 2,
      });
      await porta.gravarDiagnosticoAtendimento(ctx(), {
        acao: 'conceito',
        diagnostico: id,
        versao: 2,
        conceito: null,
      });
      expect(await diag(id)).toMatchObject({ snomed_termo_terminologia_id: null, versao: 3 });
      await expect(
        porta.gravarDiagnosticoAtendimento(ctx(), {
          acao: 'conceito',
          diagnostico: id,
          versao: 1,
          conceito: ids.fratura,
        }),
      ).rejects.toMatchObject(recusada('conflito-versao'));
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'c2032-inativar' }, (e) =>
        e.executar(
          `UPDATE diagnostico_atendimento SET situacao = 'inativado', inativado_em = NOW(3),
           inativado_por_profissional_id = ?, justificativa_inativacao = 'Registro sintético corrigido' WHERE id = ?`,
          [m!.profissional, id],
        ),
      );
      await expect(
        porta.gravarDiagnosticoAtendimento(ctx(), {
          acao: 'conceito',
          diagnostico: id,
          versao: 3,
          conceito: ids.fratura,
        }),
      ).rejects.toMatchObject(recusada('diagnostico-inativado'));
      expect(await diag(id)).toMatchObject({ snomed_termo_terminologia_id: null, versao: 3 });
    });

    it('visão por paciente: os diagnósticos com a CID e o conceito, o mais recente primeiro', async () => {
      const lista = await porta.diagnosticosDoPaciente(m!.paciente);
      expect(lista.length).toBe(2);
      const comConceito = lista.find((d) => d.conceito !== null)!;
      expect(comConceito).toMatchObject({
        tipo: 'principal',
        cid: { id: ids.cid, codigo: 'I219' },
        conceito: { id: ids.fratura, codigo: 'C2032-1' },
      });
      expect(lista.find((d) => d.conceito === null)!.situacao).toBe('inativado');
    });

    it('regiões: raiz, filhas, texto; a inativa não aparece', async () => {
      expect((await porta.regioes({ texto: 'C2032' })).map((r) => r.id).sort()).toEqual(
        [reg.mao, reg.dedo].sort(),
      );
      expect((await porta.regioes({ superior: reg.mao })).map((r) => r.id)).toEqual([reg.dedo]);
    });

    it('região do exame: liga com padrão única, recusa repetida e inativa, retira só desativando e religa', async () => {
      const um = await porta.gravarRegiaoDoExame(ctx(), {
        acao: 'ligar',
        exame: ids.exame,
        regiao: reg.mao,
        padrao: true,
      });
      await porta.gravarRegiaoDoExame(ctx(), {
        acao: 'ligar',
        exame: ids.exame,
        regiao: reg.dedo,
        padrao: true,
      });
      let lista = await porta.regioes({ exame: ids.exame });
      expect(lista.filter((r) => r.padrao).map((r) => r.id)).toEqual([reg.dedo]);
      await expect(
        porta.gravarRegiaoDoExame(ctx(), { acao: 'ligar', exame: ids.exame, regiao: reg.mao }),
      ).rejects.toMatchObject(recusada('regiao-ja-ligada'));
      await expect(
        porta.gravarRegiaoDoExame(ctx(), { acao: 'ligar', exame: ids.exame, regiao: reg.velha }),
      ).rejects.toMatchObject(recusada('regiao-inativa'));
      await porta.gravarRegiaoDoExame(ctx(), { acao: 'retirar', exame: ids.exame, regiao: reg.mao });
      const linha = (
        await ler('SELECT ativo, desativado_em, desativado_por FROM exame_regiao_anatomica WHERE id = ?', [
          um.resultado.ligacao,
        ])
      )[0]!;
      expect(Number(linha['ativo'])).toBe(0);
      expect(linha['desativado_em']).not.toBeNull();
      expect(Number(linha['desativado_por'])).toBe(m!.usuario);
      lista = await porta.regioes({ exame: ids.exame });
      expect(lista.map((r) => r.id)).toEqual([reg.dedo]);
      const de_novo = await porta.gravarRegiaoDoExame(ctx(), {
        acao: 'ligar',
        exame: ids.exame,
        regiao: reg.mao,
      });
      expect(de_novo.resultado.ligacao).toBe(um.resultado.ligacao);
      const n = await ler(
        'SELECT COUNT(*) AS n FROM exame_regiao_anatomica WHERE exame_id = ? AND regiao_anatomica_codificada_id IN (?, ?)',
        [ids.exame, reg.mao, reg.dedo],
      );
      expect(Number(n[0]!['n'])).toBe(2);
    });
  },
);
