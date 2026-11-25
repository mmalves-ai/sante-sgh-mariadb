// Contrato de efeito do carregador real do data mart sobre o MariaDB real (01-ADM L115; cliente f22_o5): a rotina lê o
// banco próprio só do estabelecimento carregado e publica o arquivo dele, com os agregados por mês (atendimentos por
// categoria, convênio e especialidade; itens de conta sem o estornado, com o baixado só da conta paga; dispensações),
// a linha da carga (versão do esquema, modo por estabelecimento, impressão da chave) e nenhuma coluna identificadora;
// o registro em carga_data_mart fica concluído com uma etapa por objeto e as linhas somadas. A internação (com óbito)
// passa da enfermaria para a terapia intensiva: fato_internacao com o pseudônimo HMAC (nunca o id cru), a faixa etária
// e o sexo da demografia, o convênio, a permanência e o óbito; os pacientes-dia por trecho, com a terapia intensiva
// pela categoria da acomodação (nunca por código fixo); a dispensação soma a quantidade líquida da devolução, sem o
// item cancelado nem a dispensação cancelada. O outro estabelecimento não entra no arquivo. O arquivo da Rede é
// remontado com o estabelecimento de BI da Rede liberado e registrado como carga própria (estabelecimento nulo); a
// junção com chave diferente é recusada, apaga o arquivo da Rede e fica registrada como falha. Massa sintética
// (f528p, f528q), com as chaves estrangeiras desligadas só na montagem; apagada no fim com a trilha.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CHAVE_LIBERACAO_BI_REDE, recursoDesligado } from '@sgh/contratos';
import {
  colunasIdentificadoras,
  impressaoDaChave,
  pseudonimo,
  VERSAO_ESQUEMA_DATAMART,
} from '@sgh/dominio-relatorio/datamart';
import type { Escritor } from '@sgh/nucleo';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaDataMartPropria } from './datamart-carga-propria.js';
import { cicloDataMart } from './datamart-carga.service.js';
import { carregadorProprio } from './datamart-carregador-proprio.js';
import { ASSUNTO_CARGA_DATAMART_REDE, remontadorRedeProprio } from './datamart-rede-propria.js';
import {
  CLIENTE,
  escrever,
  garantirCliente,
  garantirEstabelecimento,
  garantirUsuario,
  inserirSintetico,
  SEM_BANCO,
} from './importadores/integracao.spec-util.js';
import type { AlvoEstabelecimento } from './servico-worker.js';
import { limparTrilhaDaMassa } from './teste/limpar-trilha.spec-util.js';

const FUSO = 'America/Sao_Paulo';
const P = 'F528DM';
const CHAVE = 'chave-sintetica-do-data-mart-f528';
const CATEGORIAS = ['F528ENF', 'F528UTI'];
const GLOBAIS = { carater: 'F528CA', especialidade: 'F528ESP', motivo: 'F528OB' };
/** A lista de códigos fixos que a cópia antiga usava como terapia intensiva (a categoria daqui não pode depender dela). */
const CODIGOS_ANTIGOS = [3, 7, 8, 9, 17];
// 05:00 local: depois da hora da carga.
const AGORA = new Date('2026-11-25T08:00:00.000Z');

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO)('carregador real do data mart (f22_o5)', () => {
  let nucleo: NucleoProprio;
  let est: AlvoEstabelecimento;
  let outro: AlvoEstabelecimento;
  let pasta: string;
  const ids: Record<string, number> = {};
  const cat = { enf: 0, uti: 0 };

  const ler = (sql: string, p: unknown[]) => escrever(nucleo, (e) => e.consultar(sql, p));

  async function limpar(): Promise<void> {
    await escrever(nucleo, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      await e.executar(
        'DELETE x FROM carga_data_mart_etapa x JOIN carga_data_mart c ON c.id = x.carga_data_mart_id WHERE c.estabelecimento_id IS NULL AND c.assunto = ?',
        [ASSUNTO_CARGA_DATAMART_REDE],
      );
      await e.executar('DELETE FROM carga_data_mart WHERE estabelecimento_id IS NULL AND assunto = ?', [
        ASSUNTO_CARGA_DATAMART_REDE,
      ]);
      for (const id of [est?.id, outro?.id].filter(Boolean)) {
        await e.executar(
          'DELETE di FROM dispensacao_item di JOIN dispensacao d ON d.id = di.dispensacao_id WHERE d.estabelecimento_id = ?',
          [id],
        );
        for (const t of ['dispensacao', 'ocupacao_leito', 'internacao', 'leito_hospitalar', 'acomodacao'])
          await e.executar(`DELETE FROM ${t} WHERE estabelecimento_id = ?`, [id]);
        await e.executar('DELETE FROM unidade_internacao WHERE estabelecimento_id = ?', [id]);
        await e.executar('DELETE FROM liberacao_chave WHERE estabelecimento_id = ? AND chave = ?', [
          id,
          CHAVE_LIBERACAO_BI_REDE,
        ]);
        await e.executar('DELETE FROM recurso_prerequisito WHERE estabelecimento_id = ? AND recurso = ?', [
          id,
          CHAVE_LIBERACAO_BI_REDE,
        ]);
        await e.executar(
          'DELETE it FROM conta_hospitalar_item it JOIN conta_hospitalar c ON c.id = it.conta_hospitalar_id WHERE c.estabelecimento_id = ?',
          [id],
        );
        await e.executar('DELETE FROM conta_hospitalar WHERE estabelecimento_id = ?', [id]);
        await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [id]);
        await e.executar(
          'DELETE x FROM carga_data_mart_etapa x JOIN carga_data_mart c ON c.id = x.carga_data_mart_id WHERE c.estabelecimento_id = ?',
          [id],
        );
        await e.executar('DELETE FROM carga_data_mart WHERE estabelecimento_id = ?', [id]);
      }
      await e.executar(
        'DELETE p FROM paciente p JOIN pessoa_fisica f ON f.id = p.pessoa_fisica_id WHERE f.nome = ?',
        [`PACIENTE SINTETICO ${P}`],
      );
      await e.executar(
        'DELETE FROM profissional WHERE pessoa_fisica_id IN (SELECT id FROM pessoa_fisica WHERE nome = ?)',
        [`PROFISSIONAL SINTETICO ${P}`],
      );
      await e.executar('DELETE FROM pessoa_fisica WHERE nome IN (?, ?)', [
        `PACIENTE SINTETICO ${P}`,
        `PROFISSIONAL SINTETICO ${P}`,
      ]);
      await e.executar('DELETE FROM categoria_acomodacao WHERE codigo IN (?, ?)', CATEGORIAS);
      await e.executar('DELETE FROM carater_admissao WHERE codigo = ?', [GLOBAIS.carater]);
      await e.executar('DELETE FROM especialidade_medica WHERE codigo = ?', [GLOBAIS.especialidade]);
      await e.executar('DELETE FROM motivo_saida_hospitalar WHERE codigo = ?', [GLOBAIS.motivo]);
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      await limparTrilhaDaMassa(e, { codigos: ['f528p', 'f528q'] });
    });
  }

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    pasta = mkdtempSync(join(tmpdir(), 'datamart-f528-'));
    const a = await escrever(nucleo, (e) => garantirEstabelecimento(e, 'f528p'));
    const b = await escrever(nucleo, (e) => garantirEstabelecimento(e, 'f528q'));
    est = { cliente: CLIENTE, id: a, codigo: 'f528p', fuso: FUSO };
    outro = { cliente: CLIENTE, id: b, codigo: 'f528q', fuso: FUSO };
    await limpar();
    const quando = new Date('2026-10-15T13:00:00.000Z');
    await escrever(nucleo, async (e) => {
      ids.usuario = await garantirUsuario(e, 'f528dm-servico');
      const pessoa = (nome: string) =>
        e.inserir('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [nome, quando]);
      const pac = await pessoa(`PACIENTE SINTETICO ${P}`);
      ids.paciente = await e.inserir(
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pac, 528_901, quando],
      );
      ids.prof = await e.inserir(
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [await pessoa(`PROFISSIONAL SINTETICO ${P}`), quando],
      );
      ids.fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}FP`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'operadora', ?)",
        [`${P}FP`, 'OPERADORA SINTETICA F528', quando],
      );
      ids.categoria = await garantir(
        e,
        'SELECT id FROM categoria_atendimento WHERE codigo = ?',
        [P],
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'ambulatorio', ?)",
        [P, 'CATEGORIA SINTETICA F528', quando],
      );
      ids.carater = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['L9'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('L9', ?, 'teste', ?)",
        ['CARATER SINTETICO F528', quando],
      );
      ids.tipoConta = await garantir(
        e,
        'SELECT id FROM tipo_conta WHERE codigo = ?',
        [P],
        "INSERT INTO tipo_conta (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'ambulatorial', ?)",
        [P, 'TIPO DE CONTA SINTETICO F528', quando],
      );
      const grupo = await garantir(
        e,
        'SELECT id FROM grupo_faturamento WHERE codigo = ?',
        [P],
        "INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, ?, 'sadt', ?)",
        [P, 'GRUPO SINTETICO F528', quando],
      );
      ids.item = await garantir(
        e,
        'SELECT id FROM item_faturavel WHERE codigo = ?',
        ['85280001'],
        "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em) VALUES (?, ?, 'procedimento', ?, ?)",
        ['85280001', 'PROCEDIMENTO SINTETICO 85280001', grupo, quando],
      );
      const atendimento = (estab: number, numero: string) =>
        e.inserir(
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
             carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, situacao, entrada_em, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto', ?, ?)`,
          [estab, numero, ids.paciente, ids.categoria, ids.carater, ids.fonte, ids.prof, quando, quando],
        );
      const conta = (estab: number, atend: number, numero: string, situacao: string) =>
        e.inserir(
          `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
             tipo_conta_id, natureza, competencia, inicio_em, situacao, fechada_em, fechada_por_usuario_id, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, 'ambulatorial', '2026-10-01', ?, ?, ?, ?, ?)`,
          [
            estab,
            numero,
            atend,
            ids.paciente,
            ids.fonte,
            ids.tipoConta,
            quando,
            situacao,
            quando,
            ids.usuario,
            quando,
          ],
        );
      const item = (c: number, seq: number, total: number, pago: number, situacao: string) =>
        e.inserir(
          `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, realizado_em, quantidade,
             valor_unitario, valor_total, valor_pago, situacao, criado_em)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
          [c, seq, ids.item, quando, total, total, pago, situacao, quando],
        );
      const a1 = await atendimento(est.id, `${P}-1`);
      const a2 = await atendimento(est.id, `${P}-2`);
      const paga = await conta(est.id, a1, `${P}-C1`, 'paga');
      await item(paga, 1, 100, 90, 'conferido');
      await item(paga, 2, 50, 50, 'conferido');
      await item(paga, 3, 999, 0, 'estornado');
      const fechada = await conta(est.id, a2, `${P}-C2`, 'fechada');
      await item(fechada, 1, 30, 0, 'lancado');
      // O outro estabelecimento: atendimento e conta que não podem entrar no arquivo do f528p.
      const b1 = await atendimento(outro.id, `${P}-3`);
      await item(await conta(outro.id, b1, `${P}-C3`, 'paga'), 1, 7000, 7000, 'conferido');
    });
    // Internação, dispensação e a liberação do BI da Rede (chaves estrangeiras desligadas só na montagem).
    await escrever(nucleo, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      const sexo = await garantir(
        e,
        "SELECT id FROM sexo WHERE sigla = 'F' ORDER BY id LIMIT 1",
        [],
        "INSERT INTO sexo (codigo, descricao, sigla, criado_em) VALUES ('F528F', 'Feminino sintético', 'F', ?)",
        [quando],
      );
      await e.executar(
        "UPDATE pessoa_fisica SET data_nascimento = '1980-05-10', sexo_id = ? WHERE id = (SELECT pessoa_fisica_id FROM paciente WHERE id = ?)",
        [sexo, ids.paciente],
      );
      const unidade = await inserirSintetico(e, 'unidade_internacao', {
        estabelecimento_id: est.id,
        unidade_assistencial_id: 9_905_281,
        codigo: 'F528UI',
        descricao: 'Unidade sintética F528',
        tipo: 'enfermaria',
        criado_em: quando,
      });
      cat.enf = await inserirSintetico(e, 'categoria_acomodacao', {
        codigo: CATEGORIAS[0],
        descricao: 'Enfermaria sintética F528',
        tipo: 'enfermaria',
        criado_em: quando,
      });
      // A terapia intensiva com um id fora da lista de códigos antigos (o carregador tem de achá-la pela categoria).
      cat.uti = await inserirSintetico(e, 'categoria_acomodacao', {
        id: 52_801,
        codigo: CATEGORIAS[1],
        descricao: 'Terapia intensiva sintética F528',
        tipo: 'terapia_intensiva',
        criado_em: quando,
      });
      const acom = (codigo: string, categoria: number) =>
        inserirSintetico(e, 'acomodacao', {
          estabelecimento_id: est.id,
          unidade_internacao_id: unidade,
          categoria_acomodacao_id: categoria,
          codigo,
          nome: `Quarto ${codigo}`,
          sexo_permitido: 'indiferente',
          tipo_atendimento: 'internacao',
          abrangencia_cobertura: 'todas',
          criado_em: quando,
        });
      const leito = (acomodacao: number, codigo: string) =>
        inserirSintetico(e, 'leito_hospitalar', {
          estabelecimento_id: est.id,
          unidade_internacao_id: unidade,
          acomodacao_id: acomodacao,
          codigo,
          sexo_permitido: 'qualquer',
          criticidade: 'baixa',
          criado_em: quando,
        });
      const aEnf = await acom('101', cat.enf);
      const aUti = await acom('201', cat.uti);
      const lEnf = await leito(aEnf, '101A');
      const lUti = await leito(aUti, '201A');
      const carater = await inserirSintetico(e, 'carater_admissao', {
        codigo: GLOBAIS.carater,
        descricao: 'Eletiva sintética F528',
        criado_em: quando,
      });
      const esp = await inserirSintetico(e, 'especialidade_medica', {
        codigo: GLOBAIS.especialidade,
        descricao: 'Clinica sintetica F528',
        tipo: 'medica',
        sexo_atendido: 'ambos',
        criado_em: quando,
      });
      const obito = await inserirSintetico(e, 'motivo_saida_hospitalar', {
        codigo: GLOBAIS.motivo,
        descricao: 'Óbito sintético F528',
        tipo_saida: 'obito',
        exige_declaracao_obito: true,
        criado_em: quando,
      });
      const internacao = (estab: number, numero: string, v: Record<string, unknown>) =>
        inserirSintetico(e, 'internacao', {
          estabelecimento_id: estab,
          numero,
          atendimento_id: 9_905_281_000,
          paciente_id: ids.paciente,
          carater_admissao_id: carater,
          especialidade_medica_id: esp,
          fonte_pagadora_id: ids.fonte,
          origem: 'sistema',
          criado_em: quando,
          ...v,
        });
      // Entra na enfermaria em 05/10 às 10:00 (São Paulo), passa à terapia intensiva em 07/10 e morre em 09/10 às 12:00.
      ids.internacao = await internacao(est.id, `${P}-I1`, {
        data_hora_entrada: new Date('2026-10-05T13:00:00Z'),
        data_hora_alta: new Date('2026-10-09T15:00:00Z'),
        motivo_saida_hospitalar_id: obito,
        unidade_internacao_id: unidade,
        acomodacao_id: aUti,
        leito_hospitalar_id: lUti,
        situacao: 'alta',
      });
      const ocupacao = (v: Record<string, unknown>) =>
        inserirSintetico(e, 'ocupacao_leito', {
          estabelecimento_id: est.id,
          internacao_id: ids.internacao,
          unidade_internacao_id: unidade,
          origem: 'sistema',
          situacao: 'encerrada',
          criado_em: quando,
          ...v,
        });
      const o1 = await ocupacao({
        leito_hospitalar_id: lEnf,
        acomodacao_id: aEnf,
        data_hora_inicio: new Date('2026-10-05T13:00:00Z'),
        data_hora_fim: new Date('2026-10-07T13:00:00Z'),
        tipo_movimento: 'admissao',
      });
      await ocupacao({
        leito_hospitalar_id: lUti,
        acomodacao_id: aUti,
        data_hora_inicio: new Date('2026-10-07T13:00:00Z'),
        data_hora_fim: new Date('2026-10-09T15:00:00Z'),
        tipo_movimento: 'transferencia',
        anterior_ocupacao_leito_id: o1,
      });
      // A internação do outro estabelecimento (sem leito): não pode entrar no arquivo do f528p.
      await internacao(outro.id, `${P}-I2`, {
        data_hora_entrada: new Date('2026-10-03T13:00:00Z'),
        unidade_internacao_id: 9_905_282,
        atendimento_id: 9_905_281_001,
        situacao: 'ativa',
      });
      const dispensacao = (estab: number, numero: number, v: Record<string, unknown> = {}) =>
        inserirSintetico(e, 'dispensacao', {
          estabelecimento_id: estab,
          numero,
          tipo: 'avulsa',
          atendimento_id: 9_905_281_000,
          setor_funcional_id: 9_905_281,
          centro_custo_id: 9_905_281,
          paciente_id: ids.paciente,
          dispensado_em: new Date('2026-10-06T15:00:00Z'),
          situacao: 'dispensada',
          criado_em: quando,
          ...v,
        });
      const itemDisp = (d: number, seq: number, qtd: number, devolvida: number, situacao: string) =>
        inserirSintetico(e, 'dispensacao_item', {
          dispensacao_id: d,
          sequencia: seq,
          quantidade: qtd,
          quantidade_devolvida: devolvida,
          situacao,
          justificativa_nao_prescrito: 'Item sintético F528',
          criado_em: quando,
        });
      // 5 dispensados com 2 devolvidos (líquido 3) e um item cancelado (fora).
      const d1 = await dispensacao(est.id, 9_528_001);
      await itemDisp(d1, 1, 5, 2, 'devolvido');
      await itemDisp(d1, 2, 40, 0, 'cancelado');
      // A dispensação cancelada e a do outro estabelecimento: fora.
      const d2 = await dispensacao(est.id, 9_528_002, {
        situacao: 'cancelada',
        cancelado_em: quando,
        motivo_cancelamento: 'Cancelamento sintético',
      });
      await itemDisp(d2, 1, 100, 0, 'dispensado');
      await itemDisp(await dispensacao(outro.id, 9_528_003), 1, 50, 0, 'dispensado');
      // O BI da Rede liberado só no f528p (estabelecimento inteiro, pré-requisitos cumpridos).
      await inserirSintetico(e, 'liberacao_chave', {
        estabelecimento_id: est.id,
        tipo: 'recurso',
        chave: CHAVE_LIBERACAO_BI_REDE,
        escopo: 'hospital',
        valor: '*',
        ligada: 1,
        criado_em: quando,
      });
      for (const tipo of new Set(
        (recursoDesligado(CHAVE_LIBERACAO_BI_REDE)?.prerequisitos ?? []).map((p) => p.tipo),
      ))
        await inserirSintetico(e, 'recurso_prerequisito', {
          estabelecimento_id: est.id,
          recurso: CHAVE_LIBERACAO_BI_REDE,
          tipo,
          situacao: 'cumprido',
          criado_em: quando,
        });
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    await limpar();
    await nucleo.encerrar();
    if (pasta) rmSync(pasta, { recursive: true, force: true });
  });

  it('publica o arquivo do estabelecimento só com agregados dele e registra a carga concluída com as etapas', async () => {
    const carregador = carregadorProprio(nucleo, { pasta, chave: CHAVE, agora: () => AGORA.getTime() });
    const porta = new PortaDataMartPropria(nucleo, CLIENTE);
    const r = await cicloDataMart(porta, CLIENTE, est, carregador, AGORA, () => AGORA);
    expect(r).toMatchObject({ devida: true, situacao: 'concluida' });

    const db = new DatabaseSync(join(pasta, 'f528p.sqlite'), { readOnly: true });
    try {
      const at = db.prepare('SELECT * FROM fato_atendimento').all() as Record<string, unknown>[];
      expect(at).toEqual([
        {
          estabelecimento: 'f528p',
          mes: '2026-10',
          tipo_atendimento: P,
          convenio: `${P}FP`,
          especialidade: null,
          quantidade: 2,
        },
      ]);
      const it2 = db.prepare('SELECT * FROM fato_item_conta').all() as Record<string, unknown>[];
      expect(it2).toEqual([
        {
          estabelecimento: 'f528p',
          mes_item: '2026-10',
          mes_competencia: '2026-10',
          tipo_conta: P,
          natureza: 'ambulatorial',
          convenio: `${P}FP`,
          itens: 3,
          cobrado: 180,
          pago: 140,
          cobrado_baixado: 150,
          pago_baixado: 140,
        },
      ]);
      // A internação: pseudônimos HMAC (nunca o id cru), faixa etária e sexo da demografia, convênio, óbito.
      const pac = pseudonimo(CHAVE, 'f528p:paciente', ids.paciente!);
      const int = pseudonimo(CHAVE, 'f528p:internacao', ids.internacao!);
      expect(pac).not.toBe(String(ids.paciente));
      expect(int).not.toBe(String(ids.internacao));
      const fi = db.prepare('SELECT * FROM fato_internacao').all() as Record<string, unknown>[];
      expect(fi).toHaveLength(1);
      expect(fi[0]).toMatchObject({
        estabelecimento: 'f528p',
        internacao_pseudonimo: int,
        paciente_pseudonimo: pac,
        mes_entrada: '2026-10',
        mes_saida: '2026-10',
        carater: 'eletiva',
        clinica: 'Clinica sintetica F528',
        permanencia_dias: 4.1,
        obito_institucional: 1,
        faixa_etaria: '45-59',
        sexo: 'F',
        convenio: `${P}FP`,
      });
      // Pacientes-dia: 05 e 06/10 na enfermaria, 07 e 08/10 na terapia intensiva (pela categoria, não por código).
      expect(CODIGOS_ANTIGOS).not.toContain(cat.uti);
      const dias = db
        .prepare(
          'SELECT data, tipo_acomodacao, intensiva, paciente_pseudonimo, internacao_pseudonimo, faixa_etaria, sexo FROM fato_internacao_dia ORDER BY data',
        )
        .all() as Record<string, unknown>[];
      expect(dias.map((d) => [d['data'], d['tipo_acomodacao'], d['intensiva']])).toEqual([
        ['2026-10-05', 'Enfermaria sintética F528', 0],
        ['2026-10-06', 'Enfermaria sintética F528', 0],
        ['2026-10-07', 'Terapia intensiva sintética F528', 1],
        ['2026-10-08', 'Terapia intensiva sintética F528', 1],
      ]);
      for (const d of dias)
        expect(d).toMatchObject({
          paciente_pseudonimo: pac,
          internacao_pseudonimo: int,
          faixa_etaria: '45-59',
          sexo: 'F',
        });
      // Dispensação: 1 registro, 5 - 2 devolvidos = 3 (sem o item cancelado, a cancelada e o outro estabelecimento).
      expect(db.prepare('SELECT * FROM fato_dispensacao').all()).toEqual([
        { estabelecimento: 'f528p', mes: '2026-10', registros: 1, quantidade: 3 },
      ]);
      const carga = db.prepare('SELECT * FROM carga').get() as Record<string, unknown>;
      expect(carga['estabelecimento']).toBe('f528p');
      expect(carga['versao_esquema']).toBe(VERSAO_ESQUEMA_DATAMART);
      expect(carga['modo_pseudonimo']).toBe('por-estabelecimento');
      expect(carga['chave_impressao']).toBe(impressaoDaChave(CHAVE));
      expect(carga['carregado_em']).toBe(AGORA.toISOString());
      // Nenhuma coluna identificadora no arquivo publicado.
      const tabelas = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
      ).map((t) => ({
        nome: t.name,
        colunas: Object.fromEntries(
          (db.prepare(`PRAGMA table_info(${t.name})`).all() as { name: string }[]).map((c) => [
            c.name,
            'texto' as const,
          ]),
        ),
      }));
      expect(colunasIdentificadoras(tabelas)).toEqual([]);
    } finally {
      db.close();
    }

    const [c] = await ler(
      'SELECT situacao, linhas_gravadas, mensagem_erro, concluido_em IS NOT NULL AS fechada FROM carga_data_mart WHERE id = ?',
      [r.carga],
    );
    expect(c!['situacao']).toBe('concluida');
    expect(c!['mensagem_erro']).toBeNull();
    expect(Number(c!['fechada'])).toBe(1);
    // fato_internacao 1 + fato_internacao_dia 4 + fato_atendimento 1 + fato_item_conta 1 + fato_dispensacao 1 + carga 1.
    expect(Number(c!['linhas_gravadas'])).toBe(9);
    const etapas = await ler(
      'SELECT objeto_carga, linhas_gravadas, situacao FROM carga_data_mart_etapa WHERE carga_data_mart_id = ? ORDER BY objeto_carga',
      [r.carga],
    );
    expect(etapas.map((x) => [x['objeto_carga'], Number(x['linhas_gravadas']), x['situacao']])).toEqual([
      ['carga', 1, 'concluida'],
      ['fato_atendimento', 1, 'concluida'],
      ['fato_dispensacao', 1, 'concluida'],
      ['fato_internacao', 1, 'concluida'],
      ['fato_internacao_dia', 4, 'concluida'],
      ['fato_item_conta', 1, 'concluida'],
    ]);
    // O outro estabelecimento não foi carregado nem registrado.
    expect(await ler('SELECT id FROM carga_data_mart WHERE estabelecimento_id = ?', [outro.id])).toHaveLength(
      0,
    );
  });

  it('remonta o arquivo da Rede com o estabelecimento liberado e registra a remontagem; chave diferente é recusada', async () => {
    const remontar = remontadorRedeProprio(nucleo, { pasta });
    const r = await remontar(CLIENTE, AGORA);
    expect(r).toMatchObject({
      situacao: 'concluida',
      modo: 'por-estabelecimento',
      estabelecimentos: ['f528p'],
      linhas: 9,
    });
    // O outro estabelecimento (sem o BI da Rede liberado) fica fora.
    expect(r.foraDoBi).toBeGreaterThanOrEqual(1);
    const db = new DatabaseSync(join(pasta, 'rede.sqlite'), { readOnly: true });
    try {
      const contar = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
      expect([
        contar('fato_internacao'),
        contar('fato_internacao_dia'),
        contar('fato_dispensacao'),
        contar('carga'),
      ]).toEqual([1, 4, 1, 1]);
      expect(
        db.prepare("SELECT COUNT(*) AS n FROM fato_atendimento WHERE estabelecimento <> 'f528p'").get(),
      ).toEqual({ n: 0 });
    } finally {
      db.close();
    }
    const [c] = await ler(
      'SELECT estabelecimento_id, assunto, situacao, linhas_gravadas, mensagem_erro, JSON_EXTRACT(dados, "$.estabelecimentos") AS ests FROM carga_data_mart WHERE id = ?',
      [r.carga],
    );
    expect(c).toMatchObject({
      estabelecimento_id: null,
      assunto: ASSUNTO_CARGA_DATAMART_REDE,
      situacao: 'concluida',
    });
    expect(Number(c!['linhas_gravadas'])).toBe(9);
    expect(Number(c!['ests'])).toBe(1);
    const etapas = await ler(
      'SELECT objeto_carga, linhas_gravadas FROM carga_data_mart_etapa WHERE carga_data_mart_id = ? ORDER BY objeto_carga',
      [r.carga],
    );
    expect(etapas.map((x) => [x['objeto_carga'], Number(x['linhas_gravadas'])])).toEqual([
      ['carga', 1],
      ['fato_atendimento', 1],
      ['fato_dispensacao', 1],
      ['fato_internacao', 1],
      ['fato_internacao_dia', 4],
      ['fato_item_conta', 1],
    ]);

    // O outro estabelecimento passa a ter o BI da Rede liberado, mas o arquivo dele sai com outra chave: a junção
    // recusa, o arquivo da Rede anterior é apagado e a remontagem fica registrada como falha, com a mensagem.
    await escrever(nucleo, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      await inserirSintetico(e, 'liberacao_chave', {
        estabelecimento_id: outro.id,
        tipo: 'recurso',
        chave: CHAVE_LIBERACAO_BI_REDE,
        escopo: 'hospital',
        valor: '*',
        ligada: 1,
        criado_em: AGORA,
      });
      for (const tipo of new Set(
        (recursoDesligado(CHAVE_LIBERACAO_BI_REDE)?.prerequisitos ?? []).map((p) => p.tipo),
      ))
        await inserirSintetico(e, 'recurso_prerequisito', {
          estabelecimento_id: outro.id,
          recurso: CHAVE_LIBERACAO_BI_REDE,
          tipo,
          situacao: 'cumprido',
          criado_em: AGORA,
        });
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    });
    await carregadorProprio(nucleo, { pasta, chave: `${CHAVE}-outra`, agora: () => AGORA.getTime() })(
      CLIENTE,
      outro,
    );
    const recusa = await remontar(CLIENTE, AGORA);
    expect(recusa).toMatchObject({ situacao: 'falhou', estabelecimentos: [], linhas: 0 });
    expect(existsSync(join(pasta, 'rede.sqlite'))).toBe(false);
    const [f] = await ler(
      'SELECT estabelecimento_id, situacao, linhas_gravadas, mensagem_erro FROM carga_data_mart WHERE id = ?',
      [recusa.carga],
    );
    expect(f).toMatchObject({ estabelecimento_id: null, situacao: 'falhou' });
    expect(Number(f!['linhas_gravadas'])).toBe(0);
    expect(String(f!['mensagem_erro'])).toMatch(/chaves de pseudônimo diferentes/);
  });
});
