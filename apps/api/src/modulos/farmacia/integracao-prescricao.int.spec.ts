// Contrato de efeito DE PONTA A PONTA da integração prescrição × estoque (F3.6-04, 05-SUP linha 7) contra o MariaDB
// real (cliente f22_o2): grava a regra e a grade de horários padrão pelas operações da farmácia, prescreve pela
// gravação da prescrição do banco próprio e confere o que fica em integracao_dose_estoque para cada dose: a regra que
// decidiu, o local que atende (o substituto sem saldo no principal; nenhum sem saldo nos dois), o instante de
// liberação (antecedência antes de cada horário; à espera do farmacêutico) e os horários das doses (os da grade
// gravada). Depois, o parecer do farmacêutico libera as doses que o esperavam.
// Massa SINTÉTICA com o código "F3604" (nenhuma pessoa real), montada no beforeAll e apagada no início e no fim; as
// chaves estrangeiras ficam desligadas SÓ no preparo e na limpeza; as gravações rodam com todas as chaves e CHECKs.
// A migração 11_SUP/91_integracao_dose (idempotente) é aplicada no beforeAll. SGH_NUCLEO_SEM_BANCO=1 pula o arquivo.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ContextoNucleo, type ContextoOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { PLANO_DO_TIPO } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { CatalogoPrescricaoPropria } from '../pep/prescricao-propria-catalogo.js';
import { GravacaoPrescricaoPropria } from '../pep/prescricao-propria-gravacao.js';
import { dataHora } from '../pep/registro-porta-propria.js';
import type { GravacaoPrescricao, ItemGravacao } from '../pep/tipos-pep.js';
import { PortaFarmaciaPropria } from './porta-propria.js';

const CLIENTE = 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const RAIZ = resolve(__dirname, '../../../../..');
const P = 'F3604';
const FUSO = 'America/Sao_Paulo';
const HORA = 3_600_000;
const GRADE = ['06:00', '14:00', '22:00'];
const ANTECEDENCIA = 60;

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  const presc = `(SELECT id FROM prescricao WHERE estabelecimento_id IN ${est})`;
  const itens = `(SELECT id FROM prescricao_item WHERE prescricao_id IN ${presc})`;
  const aval = `(SELECT id FROM avaliacao_farmaceutica WHERE estabelecimento_id IN ${est})`;
  await limparTrilhaDaMassa(e, { codigos: [P] });
  for (const sql of [
    `DELETE FROM integracao_dose_estoque WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM avaliacao_farmaceutica_item WHERE avaliacao_farmaceutica_id IN ${aval}`,
    `DELETE FROM avaliacao_farmaceutica WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM decisao_alerta WHERE prescricao_id IN ${presc}`,
    `DELETE FROM prescricao_evento WHERE prescricao_id IN ${presc}`,
    `DELETE FROM horario_administracao WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM prescricao_item_medicamento WHERE prescricao_item_id IN ${itens}`,
    `DELETE FROM prescricao_item WHERE prescricao_id IN ${presc}`,
    `DELETE FROM prescricao WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM regra_integracao_prescricao WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM horario_padrao_medicacao WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM horario_padrao_dose WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM grade_horario_unidade WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM saldo_estoque WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM local_estoque WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM internacao WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM atendimento WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM unidade_internacao WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM unidade_assistencial WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM sequencia_negocio WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM integracao_mensagem WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM idempotencia_operacao WHERE estabelecimento_id IN ${est}`,
    'DELETE FROM estabelecimento WHERE codigo = ?',
  ])
    await e.executar(sql, [P]);
  await e.executar(
    'DELETE up FROM usuario_profissional up JOIN usuario u ON u.id = up.usuario_id WHERE u.login LIKE ?',
    [`${P}%`],
  );
  await e.executar('DELETE FROM usuario WHERE login LIKE ?', [`${P}%`]);
  const profs = '(SELECT id FROM profissional WHERE nome_exibicao LIKE ?)';
  await e.executar(`DELETE FROM inscricao_conselho WHERE profissional_id IN ${profs}`, [`${P} %`]);
  await e.executar('DELETE FROM profissional WHERE nome_exibicao LIKE ?', [`${P} %`]);
  await e.executar(
    'DELETE FROM paciente WHERE pessoa_fisica_id IN (SELECT id FROM pessoa_fisica WHERE nome LIKE ?)',
    [`${P} %`],
  );
  await e.executar('DELETE FROM pessoa_fisica WHERE nome LIKE ?', [`${P} %`]);
  for (const t of [
    'item_prescritivel',
    'insumo',
    'grupo_insumo',
    'frequencia_administracao',
    'situacao_checagem',
    'tipo_item_prescricao',
    'unidade_prescricao',
    'via_de_uso',
    'categoria_atendimento',
  ])
    await e.executar(`DELETE FROM ${t} WHERE codigo LIKE ?`, [`${P}%`]);
}

const LETRAS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
type Letra = (typeof LETRAS)[number];

describe.skipIf(SEM_BANCO)(
  'integração prescrição × estoque de ponta a ponta (MariaDB, cliente f22_o2)',
  () => {
    let nucleo: NucleoProprio;
    let farmacia: PortaFarmaciaPropria;
    let prescricaoPorta: GravacaoPrescricaoPropria;
    let ctx: ContextoNucleo;
    const ids = { est: 0, unidade: 0, pac: 0, atd: 0, usuario: 0, cbo: 0, central: 0, satelite: 0, f3x: 0 };
    const produto = {} as Record<Letra, number>;
    const insumo = {} as Record<Letra, number>;
    const regra = { geral: 0, semIntegracao: 0, liberacao: 0 };
    let chave = 0;

    beforeAll(async () => {
      for (const arq of ['91_integracao_dose_tabelas.sql', '91_integracao_dose_chaves.sql'])
        execFileSync(resolve(RAIZ, 'tools/db/sql.sh'), [`cliente_${CLIENTE}`], {
          input: readFileSync(resolve(RAIZ, 'db/migracoes/11_SUP', arq), 'utf8'),
          encoding: 'utf8',
        });
      nucleo = new NucleoProprio();
      expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
        await e.executar('SET FOREIGN_KEY_CHECKS = 0');
        try {
          await limpar(e);
          const agora = new Date();
          const ins = (sql: string, p: unknown[]) => e.inserir(sql, [...p, agora]);
          ids.est = await ins(
            `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
           VALUES (?, 'Hospital sintético F3604', 'Hospital sintético F3604 (fictício)', ?, ?)`,
            [P, FUSO],
          );
          const ua = await ins(
            `INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em)
           VALUES (?, ?, 'UTI sintética', 'internacao', ?)`,
            [ids.est, `${P}-UA`],
          );
          ids.unidade = await ins(
            `INSERT INTO unidade_internacao (estabelecimento_id, unidade_assistencial_id, codigo, descricao, tipo, criado_em)
           VALUES (?, ?, ?, 'UTI sintética F3604', 'uti_adulto', ?)`,
            [ids.est, ua, `${P}-UTI`],
          );
          const pessoa = (n: string) =>
            ins('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [`${P} ${n}`]);
          ids.pac = await ins(
            'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
            [await pessoa('p1'), 936_040_001],
          );
          const cat = await ins(
            `INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, 'Internação sintética', 'internacao', ?)`,
            [`${P}i`],
          );
          ids.atd = await ins(
            `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
             carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, unidade_assistencial_id, situacao,
             entrada_em, criado_em)
           VALUES (?, '360401', ?, ?, 1, 1, 1, ?, 'aberto', ?, ?)`,
            [ids.est, ids.pac, cat, ua, new Date(agora.getTime() - 48 * HORA)],
          );
          await ins(
            `INSERT INTO internacao (estabelecimento_id, numero, atendimento_id, paciente_id, data_hora_entrada,
             carater_admissao_id, modalidade_internacao_id, unidade_internacao_id, acomodacao_id,
             especialidade_medica_id, medico_assistente_profissional_id, fonte_pagadora_id, situacao, criado_em)
           VALUES (?, '360401', ?, ?, ?, 1, 1, ?, 1, 1, 1, 1, 'ativa', ?)`,
            [ids.est, ids.atd, ids.pac, new Date(agora.getTime() - 48 * HORA), ids.unidade],
          );
          const ocup = await e.uma<{ id: unknown; codigo_cbo: unknown }>(
            "SELECT id, codigo_cbo FROM ocupacao_cbo WHERE codigo_cbo REGEXP '^[0-9]+$' ORDER BY id LIMIT 1",
          );
          ids.cbo = Number(String(ocup?.codigo_cbo));
          const prof = await ins(
            `INSERT INTO profissional (pessoa_fisica_id, tipo, nome_exibicao, criado_em) VALUES (?, 'corpo_clinico', ?, ?)`,
            [await pessoa('prof'), `${P} Prescritor`],
          );
          await ins(
            `INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id, unidade_federativa_id,
             numero_inscricao, ocupacao_cbo_id, principal, situacao, criado_em)
           VALUES (?, 1, 1, 1, '360401', ?, TRUE, 'ativa', ?)`,
            [prof, ocup?.id],
          );
          ids.usuario = await ins(
            `INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, 'Usuário sintético F3604', 'servico', ?)`,
            [`${P}med`],
          );
          await ins(
            `INSERT INTO usuario_profissional (usuario_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, '2026-01-01', ?)`,
            [ids.usuario, prof],
          );
          const tipo = await ins(
            `INSERT INTO tipo_item_prescricao (codigo, descricao, categoria, criado_em) VALUES (?, 'Medicamento sintético', 'medicamento', ?)`,
            [`${P}m`],
          );
          await ins(
            `INSERT INTO via_de_uso (codigo, descricao, sigla, criado_em) VALUES (?, 'Endovenosa', ?, ?)`,
            [`${P}v`, 'EV36'],
          );
          await ins(
            `INSERT INTO unidade_prescricao (codigo, descricao, sigla, criado_em) VALUES (?, 'Miligrama', ?, ?)`,
            [`${P}u`, 'mg36'],
          );
          await ins(
            `INSERT INTO situacao_checagem (codigo, descricao, categoria, ordem, criado_em) VALUES (?, 'Pendente', 'pendente', 0, ?)`,
            [`${P}p`],
          );
          await ins(
            'INSERT INTO sequencia_negocio (estabelecimento_id, tipo, proximo_valor, criado_em) VALUES (?, ?, 1, ?)',
            [ids.est, 'prescricao'],
          );
          const local = (codigo: string, t: string) =>
            ins(
              'INSERT INTO local_estoque (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, ?, ?, ?)',
              [ids.est, codigo, `LOCAL ${codigo} SINTETICO`, t],
            );
          ids.central = await local(`${P}-FC`, 'farmacia_central');
          ids.satelite = await local(`${P}-FS`, 'farmacia_satelite');
          ids.f3x = await ins(
            `INSERT INTO frequencia_administracao (codigo, descricao, tipo, intervalo_minutos, doses_por_dia, criado_em)
           VALUES (?, 'FREQ 3X SINTETICA', 'vezes_ao_dia', NULL, 3, ?)`,
            [`${P}-3X`],
          );
          const grupo = await ins(
            `INSERT INTO grupo_insumo (codigo, descricao, natureza, criado_em) VALUES (?, 'Grupo sintético', 'medicamento', ?)`,
            [`${P}g`],
          );
          for (const l of LETRAS) {
            // F: item prescritível sem produto de estoque (não entra na integração).
            if (l !== 'F')
              insumo[l] = await ins(
                `INSERT INTO insumo (codigo, nome, tipo, grupo_insumo_id, estoque_unidade_medida_id, criado_em)
               VALUES (?, ?, 'medicamento', ?, 1, ?)`,
                [`${P}i${l}`, `INSUMO SINTETICO ${l}`, grupo],
              );
            produto[l] = await ins(
              `INSERT INTO item_prescritivel (codigo, descricao, tipo_item_prescricao_id, insumo_id, criado_em)
             VALUES (?, ?, ?, ?, ?)`,
              [`${P}p${l}`, `Produto sintético ${l}`, tipo, l === 'F' ? null : insumo[l]],
            );
          }
          // Saldo: A, D e E na central; B só na satélite (substituto); C em nenhum.
          const saldo = (loc: number, i: number) =>
            ins(
              'INSERT INTO saldo_estoque (estabelecimento_id, local_estoque_id, insumo_id, quantidade, criado_em) VALUES (?, ?, ?, 50, ?)',
              [ids.est, loc, i],
            );
          for (const l of ['A', 'D', 'E'] as const) await saldo(ids.central, insumo[l]);
          await saldo(ids.satelite, insumo.B);
        } finally {
          await e.executar('SET FOREIGN_KEY_CHECKS = 1');
        }
      });
      ctx = { cliente: CLIENTE, estabelecimento: ids.est, usuario: ids.usuario, correlacao: `teste-${P}` };
      farmacia = new PortaFarmaciaPropria(nucleo);
      prescricaoPorta = new GravacaoPrescricaoPropria(nucleo, CLIENTE);
    }, 120_000);

    afterAll(async () => {
      if (!nucleo) return;
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, async (e) => {
        await e.executar('SET FOREIGN_KEY_CHECKS = 0');
        try {
          await limpar(e);
        } finally {
          await e.executar('SET FOREIGN_KEY_CHECKS = 1');
        }
      });
      await nucleo.encerrar();
    });

    const op = (nome: string, entrada: unknown) =>
      farmacia.executar(ctx, nome, entrada, {
        ...ctx,
        chaveIdempotencia: `${P}-${Date.now()}-${(chave += 1)}`,
      });
    const linhas = (sql: string, p: unknown[]) =>
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: `teste-${P}` }, (l) =>
        l.consultar<Record<string, unknown>>(sql, p),
      );
    const doses = (l: Letra) =>
      linhas(
        `SELECT d.regra_integracao_prescricao_id AS regra, d.integra_estoque AS integra, d.tipo_integracao AS tipo,
              d.momento_integracao AS momento, d.forma_dispensacao AS forma, d.atendente_local_estoque_id AS local,
              d.usou_substituto AS substituto, d.evento_liberacao AS evento, d.liberar_em IS NULL AS sem_liberacao,
              TIMESTAMPDIFF(MINUTE, d.liberar_em, h.previsto_em) AS antes, h.previsto_em
         FROM integracao_dose_estoque d
         JOIN horario_administracao h ON h.id = d.horario_administracao_id
         JOIN prescricao_item pi ON pi.id = d.prescricao_item_id
        WHERE d.estabelecimento_id = ? AND pi.item_prescritivel_id = ?
        ORDER BY h.previsto_em`,
        [ids.est, produto[l]],
      );
    const local = (ms: number) => dataHora(new Date(Date.now() + ms), FUSO)!.slice(0, 16);

    it('grava a regra geral da unidade, as exceções por item e a grade de horários da frequência', async () => {
      const base = {
        unidade: ids.unidade,
        localAtendente: ids.central,
        localSubstituto: ids.satelite,
        tipoIntegracao: 'dispensacao_direta',
        momento: 'antes_do_horario',
        antecedenciaMinutos: ANTECEDENCIA,
        forma: 'dose_unitaria',
      };
      const gravar = async (e: unknown) =>
        Number((await op('suprimentos.gravarRegraIntegracao', e)).resultado['regra']);
      regra.geral = await gravar(base);
      regra.semIntegracao = await gravar({
        ...base,
        item: insumo.D,
        localSubstituto: null,
        tipoIntegracao: 'sem_integracao',
        momento: 'na_prescricao',
        antecedenciaMinutos: null,
      });
      regra.liberacao = await gravar({
        ...base,
        item: insumo.E,
        momento: 'na_liberacao_farmaceutica',
        antecedenciaMinutos: null,
      });
      await op('suprimentos.gravarHorariosPadrao', {
        frequencia: ids.f3x,
        grade: null,
        horarios: GRADE.map((hora) => ({ hora })),
      });
      const lidos = await farmacia.parametrosEditaveis(ctx);
      expect(
        lidos.regras
          .filter((r) => r.ativo)
          .map((r) => r.regra)
          .sort(),
      ).toEqual([regra.geral, regra.semIntegracao, regra.liberacao].sort());
      expect(
        lidos.grades.find((g) => g.grade === null && g.dosesPorDia === 3)?.horarios.map((h) => h.hora),
      ).toEqual(GRADE);
      // A grade gravada pela farmácia é a que o aprazamento lê (grade unificada, 05-SUP linha 7): a regra de horário
      // do estabelecimento traz, para 3 doses ao dia, os horários gravados.
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-grade` }, (e) =>
        e.inserir(
          `INSERT INTO grade_horario_unidade (estabelecimento_id, tipo_atendimento, hora_inicio_dia, padrao, criado_em)
           VALUES (?, 'internacao', '07:00:00', TRUE, NOW(3))`,
          [ids.est],
        ),
      );
      const aprazamento = await new CatalogoPrescricaoPropria(nucleo, CLIENTE).regras({
        cliente: CLIENTE,
        estabelecimento: null,
        usuario: null,
        correlacao: P,
        rede: 'rede-teste',
        hospital: P,
      } as never);
      expect(aprazamento.regras).toHaveLength(1);
      // (o aprazamento usa a hora em HHMM)
      expect(aprazamento.regras[0]?.grade.get(3)).toEqual(GRADE.map((h) => h.replace(':', '')));
    });

    it('prescrever aplica a regra a cada dose: local, substituto, liberação e horários da grade gravada', async () => {
      // Os horários de cada item são os da grade gravada (lida de volta), na próxima ocorrência dentro da vigência.
      const grade =
        (await farmacia.parametrosEditaveis(ctx)).grades
          .find((g) => g.grade === null && g.dosesPorDia === 3)
          ?.horarios.map((h) => h.hora) ?? [];
      const agora = local(0);
      const hoje = agora.slice(0, 10);
      const amanha = local(24 * HORA).slice(0, 10);
      const horarios = grade
        .map((h) => (`${hoje}T${h}` > agora ? `${hoje}T${h}` : `${amanha}T${h}`))
        .sort()
        .map((dataHoraLocal) => ({ dataHora: dataHoraLocal, relativo: null }));
      const item = (l: Letra): ItemGravacao =>
        ({
          chave: `k${l}`,
          plano: PLANO_DO_TIPO.medicamento,
          numDose: horarios.length,
          frequencia: ids.f3x,
          via: 'EV36',
          observacao: null,
          // O cliente diz "sem integração": o servidor ignora e decide pela regra vigente (as doses abaixo integram).
          integracaoEstoque: false,
          detalhe: {
            tipo: 'medicamento',
            produto: produto[l],
            dose: 500,
            unidade: 'mg36',
            agora: false,
            naoAjustar: false,
            tempoInfusaoMinutos: 30,
            naoPadronizado: null,
            justificativaAlergia: null,
            seNecessario: [],
            kit: [],
          },
          horarios,
        }) as unknown as ItemGravacao;
      const e: GravacaoPrescricao = {
        paciente: ids.pac,
        atendimento: ids.atd,
        cbo: ids.cbo,
        retratos: { htAtendimento: ids.atd, htPaciente: ids.pac },
        dataHora: agora,
        vigencia: { inicio: agora, fim: local(24 * HORA) },
        justificativaRetroativo: null,
        observacaoGeral: null,
        protocolos: [],
        itens: LETRAS.map(item),
        origem: null,
        documento: 'documento sintético',
        hashConteudo: 'b'.repeat(64),
        sgh: {
          prioridade: 'rotina',
          nota: null,
          coassinaturaExigida: false,
          origemModo: null,
          origemId: null,
          itens: [],
          decisoes: [],
          fichas: [],
          futuras: [],
          comoSuporte: false,
        },
      };
      const chaveOp: ContextoOperacao = {
        cliente: CLIENTE,
        estabelecimento: null,
        usuario: ids.usuario,
        correlacao: P,
        chaveIdempotencia: `${P}-presc-${Date.now()}`,
      };
      const r = await prescricaoPorta.prescrever(
        {
          cliente: CLIENTE,
          estabelecimento: null,
          usuario: null,
          correlacao: P,
          rede: 'rede-teste',
          hospital: P,
        },
        'pep.prescrever',
        e,
        chaveOp,
      );
      expect(r.horarios).toBe(LETRAS.length * GRADE.length);

      // A: regra geral, saldo na central: as 3 doses na central, liberadas 60 minutos antes de cada horário da grade.
      const a = await doses('A');
      expect(a).toHaveLength(GRADE.length);
      expect(a.map((d) => dataHora(d['previsto_em'] as Date, FUSO)!.slice(11, 16)).sort()).toEqual(GRADE);
      for (const d of a)
        expect(d).toMatchObject({
          regra: regra.geral,
          integra: 1,
          tipo: 'dispensacao_direta',
          momento: 'antes_do_horario',
          forma: 'dose_unitaria',
          local: ids.central,
          substituto: 0,
          antes: ANTECEDENCIA,
          evento: null,
        });
      // B: sem saldo na central, o substituto atende.
      const b = await doses('B');
      expect(b).toHaveLength(GRADE.length);
      for (const d of b)
        expect(d).toMatchObject({
          regra: regra.geral,
          local: ids.satelite,
          substituto: 1,
          antes: ANTECEDENCIA,
        });
      // C: sem saldo em nenhum dos dois: a dose fica decidida, sem local (a farmácia a vê como sem saldo).
      const c = await doses('C');
      expect(c).toHaveLength(GRADE.length);
      for (const d of c)
        expect(d).toMatchObject({
          regra: regra.geral,
          integra: 1,
          local: null,
          substituto: 0,
          antes: ANTECEDENCIA,
        });
      // D: a exceção por item (mais específica que a regra da unidade) diz sem integração.
      const dd = await doses('D');
      expect(dd).toHaveLength(GRADE.length);
      for (const d of dd)
        expect(d).toMatchObject({ regra: regra.semIntegracao, integra: 0, local: null, sem_liberacao: 1 });
      // E: espera a liberação do farmacêutico.
      const ee = await doses('E');
      expect(ee).toHaveLength(GRADE.length);
      for (const d of ee)
        expect(d).toMatchObject({
          regra: regra.liberacao,
          local: ids.central,
          sem_liberacao: 1,
          evento: null,
        });
      // F: item sem produto de estoque: nenhuma decisão.
      expect(await doses('F')).toHaveLength(0);
    });

    it('o parecer do farmacêutico libera as doses que o esperavam, e só elas', async () => {
      const [h] = await linhas(
        `SELECT h.id FROM horario_administracao h JOIN prescricao_item pi ON pi.id = h.prescricao_item_id
        WHERE h.estabelecimento_id = ? AND pi.item_prescritivel_id = ? ORDER BY h.previsto_em LIMIT 1`,
        [ids.est, produto.E],
      );
      const antes = Date.now();
      await op('suprimentos.avaliarPrescricao', { horario: Number(h?.['id']), decisao: 'valido' });
      const ee = await linhas(
        `SELECT d.evento_liberacao AS evento, d.liberar_em, d.versao FROM integracao_dose_estoque d
         JOIN prescricao_item pi ON pi.id = d.prescricao_item_id
        WHERE d.estabelecimento_id = ? AND pi.item_prescritivel_id = ?`,
        [ids.est, produto.E],
      );
      expect(ee).toHaveLength(GRADE.length);
      for (const d of ee) {
        expect(d).toMatchObject({ evento: 'liberacao_farmaceutica', versao: 2 });
        expect(Math.abs((d['liberar_em'] as Date).getTime() - antes)).toBeLessThan(60_000);
      }
      // As doses da regra "antes do horário" não mudam com o parecer.
      for (const d of await doses('A')) expect(d).toMatchObject({ antes: ANTECEDENCIA, evento: null });
    });
  },
);
