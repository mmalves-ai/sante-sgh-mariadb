// Integração da porta própria do painel de indicadores de pessoas contra o MariaDB real (cliente f22_o3). Massa
// SINTÉTICA com códigos "L0308" (nenhuma pessoa real): dois estabelecimentos, dois setores, vínculos com e sem a
// enfermagem, fechamentos do ponto (com a apuração diária: atraso, falta abonada, item informativo e extra), um vínculo
// transferido no meio do período (histórico de lotação, com uma operação de exclusão), a folha com a rubrica de hora
// extra, uma turma concluída, comunicações de acidente às 23:30 locais nas bordas do período, o censo diário e os
// dimensionamentos. As colunas obrigatórias que o teste não fixa (catálogos e cadastros de apoio)
// são preenchidas por um gerador lido do information_schema (tipos, chaves estrangeiras e CHECK de lista).
// A mesma bateria roda na porta em memória com os mesmos fatos (describe.each). Só leitura na porta: o contrato de
// efeito é "nada gravado" (contagem da trilha e das mensagens de integração antes e depois). No fim, a massa é apagada.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomBytes } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContextoIndicadores, PortaIndicadoresPessoas } from './porta-indicadores.js';
import { type FatosIndicadoresPessoas, PortaIndicadoresPessoasMemoria } from './porta-indicadores-memoria.js';
import { PortaIndicadoresPessoasPropria } from './porta-indicadores-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST_A = 'L0308A';
const EST_B = 'L0308B';
const RODADA = randomBytes(3).toString('hex');
let seq = 0;

type Linha = Record<string, unknown>;
interface Criada {
  tabela: string;
  id: number;
}

/** Gera as colunas obrigatórias que faltam pelo information_schema (tipo, FK e CHECK de lista ou de dígitos). */
class Gerador {
  readonly criadas: Criada[] = [];
  constructor(private readonly e: Escritor) {}

  private unico(n: number): string {
    const s = `L${RODADA}${(++seq).toString(36)}`;
    return s.length <= n ? s : s.slice(-n);
  }
  private digitos(n: number): string {
    return `${Date.now()}${String(++seq).padStart(4, '0')}`.slice(-n).padStart(n, '1');
  }

  async inserir(tabela: string, valores: Linha, prof = 0): Promise<number> {
    if (prof > 6) throw new Error(`gerador: profundidade demais em ${tabela}`);
    const cols = await this.e.consultar<{ nome: string; tipo: string; tamanho: unknown }>(
      `SELECT COLUMN_NAME AS nome, DATA_TYPE AS tipo, CHARACTER_MAXIMUM_LENGTH AS tamanho
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND IS_NULLABLE = 'NO'
          AND COLUMN_DEFAULT IS NULL AND EXTRA NOT LIKE '%auto_increment%'`,
      [tabela],
    );
    const fks = new Map(
      (
        await this.e.consultar<{ nome: string; ref: string }>(
          `SELECT COLUMN_NAME AS nome, REFERENCED_TABLE_NAME AS ref FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
          [tabela],
        )
      ).map((x) => [String(x.nome), String(x.ref)]),
    );
    const checks = (
      await this.e.consultar<{ c: string }>(
        `SELECT CHECK_CLAUSE AS c FROM information_schema.CHECK_CONSTRAINTS
          WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [tabela],
      )
    ).map((x) => String(x.c));
    const escolha = (col: string): string | null => {
      for (const c of checks) {
        const m = new RegExp(`\`${col}\`\\s+in\\s*\\(\\s*'([^']*)'`, 'i').exec(c);
        if (m) return m[1]!;
      }
      return null;
    };
    const regra = (col: string): string | null => {
      for (const c of checks) {
        const m = new RegExp(`\`${col}\`\\s+regexp\\s+'([^']*)'`, 'i').exec(c);
        if (m) return m[1]!;
      }
      return null;
    };
    const v: Linha = { ...valores };
    for (const c of cols) {
      const nome = String(c.nome);
      if (nome in v) continue;
      const tipo = String(c.tipo).toLowerCase();
      const tam = c.tamanho === null || c.tamanho === undefined ? 0 : Number(c.tamanho);
      const ref = fks.get(nome);
      if (ref && ref !== tabela) {
        const ex = await this.e.uma<{ id: unknown }>(`SELECT id FROM \`${ref}\` ORDER BY id LIMIT 1`, []);
        v[nome] = ex ? Number(ex.id) : await this.inserir(ref, {}, prof + 1);
        continue;
      }
      if (nome === 'criado_em' || ['datetime', 'timestamp'].includes(tipo)) v[nome] = new Date();
      else if (tipo === 'date') v[nome] = '2020-01-01';
      else if (tipo === 'time') v[nome] = '00:00:00';
      else if (['char', 'varchar', 'text', 'mediumtext', 'longtext', 'tinytext'].includes(tipo)) {
        const lista = escolha(nome);
        const re = regra(nome);
        let d: RegExpExecArray | null;
        if (lista !== null) v[nome] = lista;
        else if (re && (d = /^\^\[0-9\]\{(\d+)\}\$$/.exec(re))) v[nome] = this.digitos(Number(d[1]));
        else if (re && (d = /^\^\[A-Z\]\{(\d+)/.exec(re))) v[nome] = 'L'.repeat(Number(d[1]));
        else if (re?.startsWith('^(0[1-9]')) v[nome] = '01';
        else if (tipo === 'longtext') v[nome] = '{}';
        else v[nome] = this.unico(tam || 30);
      } else v[nome] = 1;
    }
    const nomes = Object.keys(v);
    const id = await this.e.inserir(
      `INSERT INTO \`${tabela}\` (${nomes.map((n) => `\`${n}\``).join(', ')}) VALUES (${nomes.map(() => '?').join(', ')})`,
      nomes.map((n) => v[n]),
    );
    this.criadas.push({ tabela, id });
    return id;
  }

  async desfazer(): Promise<number> {
    let falhas = 0;
    for (const c of [...this.criadas].reverse()) {
      try {
        await this.e.executar(`DELETE FROM \`${c.tabela}\` WHERE id = ?`, [c.id]);
      } catch {
        falhas += 1;
      }
    }
    return falhas;
  }
}

/** Apaga a massa de negócio de execuções anteriores dos estabelecimentos de teste (ordem das chaves). */
async function limpar(e: Escritor, ests: readonly number[]): Promise<void> {
  if (!ests.length) return;
  const q = ests.map(() => '?').join(', ');
  const passos = [
    `DELETE i FROM apuracao_ponto_item i JOIN apuracao_ponto a ON a.id = i.apuracao_ponto_id WHERE a.estabelecimento_id IN (${q})`,
    `DELETE FROM apuracao_ponto WHERE estabelecimento_id IN (${q})`,
    `DELETE l FROM lotacao l JOIN vinculo_trabalho v ON v.id = l.vinculo_trabalho_id WHERE v.estabelecimento_id IN (${q})`,
    `DELETE i FROM calculo_folha_item i JOIN calculo_folha c ON c.id = i.calculo_folha_id WHERE c.estabelecimento_id IN (${q})`,
    `DELETE FROM calculo_folha WHERE estabelecimento_id IN (${q})`,
    `DELETE FROM competencia_folha WHERE estabelecimento_id IN (${q})`,
    `DELETE FROM rubrica WHERE estabelecimento_id IN (${q})`,
    `DELETE FROM fechamento_ponto WHERE estabelecimento_id IN (${q})`,
    `DELETE p FROM presenca_treinamento p JOIN turma_treinamento t ON t.id = p.turma_treinamento_id WHERE t.estabelecimento_id IN (${q})`,
    `DELETE FROM turma_treinamento WHERE estabelecimento_id IN (${q})`,
    `DELETE FROM comunicacao_acidente WHERE estabelecimento_id IN (${q})`,
    `DELETE FROM fechamento_censo WHERE estabelecimento_id IN (${q})`,
    `DELETE FROM dimensionamento_enfermagem WHERE estabelecimento_id IN (${q})`,
    `DELETE FROM unidade_internacao WHERE estabelecimento_id IN (${q})`,
    `DELETE FROM vinculo_trabalho WHERE estabelecimento_id IN (${q})`,
    `DELETE FROM setor_funcional WHERE estabelecimento_id IN (${q})`,
  ];
  for (const sql of passos) await e.executar(sql, ests);
}

const RECORTE = { inicio: '2026-01-01', fim: '2026-03-31', setor: null };

describe.skipIf(SEM_BANCO)('porta própria dos indicadores de pessoas (MariaDB, cliente f22_o3)', () => {
  let nucleo: NucleoProprio;
  const ids = { estA: 0, estB: 0, uti: 0, clinica: 0, setorB: 0 };
  let ctxA: ContextoIndicadores;
  let ctxB: ContextoIndicadores;
  let fatos: FatosIndicadoresPessoas;
  let gerador: Gerador | null = null;

  const contar = () =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conta-l0308' }, async (l) => {
      const [t] = await l.consultar<{ n: unknown }>('SELECT COUNT(*) AS n FROM trilha_auditoria', []);
      const [o] = await l.consultar<{ n: unknown }>('SELECT COUNT(*) AS n FROM integracao_mensagem', []);
      return [Number(t?.n), Number(o?.n)];
    });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-l0308' }, async (e) => {
      const g = new Gerador(e);
      const est = async (codigo: string) => {
        const l = await e.uma<{ id: unknown }>('SELECT id FROM estabelecimento WHERE codigo = ?', [codigo]);
        return l
          ? Number(l.id)
          : e.inserir(
              'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
              [codigo, `ESTAB ${codigo} SINTETICO`, `ESTAB ${codigo} SINTETICO`, new Date()],
            );
      };
      ids.estA = await est(EST_A);
      ids.estB = await est(EST_B);
      await e.executar("UPDATE estabelecimento SET fuso_horario = 'America/Sao_Paulo' WHERE id IN (?, ?)", [
        ids.estA,
        ids.estB,
      ]);
      await limpar(e, [ids.estA, ids.estB]);
      const agora = new Date();
      const setor = (estId: number, nome: string) =>
        g.inserir('setor_funcional', { estabelecimento_id: estId, nome, tipo: 'assistencial', ativo: true });
      ids.uti = await setor(ids.estA, 'L0308 UTI');
      ids.clinica = await setor(ids.estA, 'L0308 Clinica');
      ids.setorB = await setor(ids.estB, 'L0308 Outro');
      const coren =
        Number(
          (await e.uma<{ id: unknown }>("SELECT id FROM conselho_classe WHERE sigla = 'COREN'", []))?.id ?? 0,
        ) ||
        (await g.inserir('conselho_classe', { sigla: 'COREN', descricao: 'Conselho de enfermagem (teste)' }));
      const cargoEnf = await g.inserir('cargo', {
        nome: 'L0308 Enfermeiro',
        exige_registro_conselho: true,
        conselho_classe_id: coren,
        data_inicio: '2020-01-01',
      });
      const cargoAdm = await g.inserir('cargo', { nome: 'L0308 Administrativo', data_inicio: '2020-01-01' });
      const vinculo = async (
        estId: number,
        setorId: number,
        cargo: number,
        admissao: string,
        desligamento: string | null = null,
      ) => {
        const col = await g.inserir('colaborador', {
          nome: `L0308 SINTETICO ${++seq}`,
          grau_instrucao: '01',
        });
        const extra: Linha = desligamento
          ? {
              data_desligamento: desligamento,
              situacao: 'desligado',
              tipo_rescisao_id:
                Number(
                  (await e.uma<{ id: unknown }>('SELECT id FROM tipo_rescisao ORDER BY id LIMIT 1', []))
                    ?.id ?? 0,
                ) || (await g.inserir('tipo_rescisao', {})),
            }
          : {};
        const id = await g.inserir('vinculo_trabalho', {
          estabelecimento_id: estId,
          colaborador_id: col,
          setor_funcional_id: setorId,
          cargo_id: cargo,
          data_admissao: admissao,
          salario_base: 1000,
          ...extra,
        });
        return { id, col };
      };
      const v1 = await vinculo(ids.estA, ids.uti, cargoEnf, '2020-01-01');
      const v2 = await vinculo(ids.estA, ids.uti, cargoAdm, '2020-01-01', '2026-02-15');
      const v3 = await vinculo(ids.estA, ids.clinica, cargoAdm, '2026-02-01');
      await vinculo(ids.estA, ids.uti, cargoAdm, '2026-05-01'); // admitido depois do fim: fora
      const vx = await vinculo(ids.estA, ids.uti, cargoAdm, '2021-01-01');
      await e.executar('UPDATE vinculo_trabalho SET excluido_em = ? WHERE id = ?', [agora, vx.id]); // excluído: fora
      await vinculo(ids.estB, ids.setorB, cargoAdm, '2020-01-01'); // outro estabelecimento
      // Transferido: o cadastro já diz Clínica, mas até 14/02 a lotação era a UTI.
      const vt = await vinculo(ids.estA, ids.clinica, cargoAdm, '2020-01-01');
      const lotacao = (
        setorId: number,
        inicio: string,
        fim: string | null,
        operacao: string,
        ocorrido: string,
      ) =>
        g.inserir('lotacao', {
          vinculo_trabalho_id: vt.id,
          setor_funcional_id: setorId,
          data_inicio: inicio,
          data_fim: fim,
          operacao,
          ocorrido_em: new Date(ocorrido),
        });
      await lotacao(ids.uti, '2020-01-01', '2026-02-14', 'inclusao', '2026-02-14T10:00:00Z');
      await lotacao(ids.clinica, '2026-02-15', null, 'inclusao', '2026-02-14T10:00:00Z');
      // Uma lotação simultânea lançada e depois excluída: a última operação é a exclusão, não conta.
      await lotacao(ids.uti, '2026-02-15', null, 'inclusao', '2026-02-14T10:00:00Z');
      await lotacao(ids.uti, '2026-02-15', null, 'exclusao', '2026-02-14T11:00:00Z');

      // Ponto: só o fechado/assinado/integrado das competências do período.
      const ponto = (
        v: number,
        comp: string,
        fim: string,
        situacao: string,
        trab: number,
        ext: number,
        falta: number,
      ) =>
        g.inserir('fechamento_ponto', {
          estabelecimento_id: ids.estA,
          vinculo_trabalho_id: v,
          competencia: comp,
          periodo_inicio: comp,
          periodo_fim: fim,
          horas_trabalhadas: trab,
          horas_extras: ext,
          horas_falta: falta,
          situacao,
          fechado_em: situacao === 'aberto' ? null : agora,
        });
      const jan = await ponto(v1.id, '2026-01-01', '2026-01-31', 'fechado', 160, 10, 8);
      // A apuração diária do fechamento de janeiro: 2 dias de 10 h previstas; atraso de 30 min (descontado), falta
      // abonada de 600 min, um item informativo e uma extra (não contam como ausência).
      const thFalta = await g.inserir('tipo_hora', { descricao: 'L0308 Falta', natureza: 'falta' });
      const thExtra = await g.inserir('tipo_hora', { descricao: 'L0308 Extra', natureza: 'extra' });
      const dia = (data: string) =>
        g.inserir('apuracao_ponto', {
          estabelecimento_id: ids.estA,
          colaborador_id: v1.col,
          vinculo_trabalho_id: v1.id,
          data,
          fechamento_ponto_id: jan,
          minutos_previstos: 600,
          situacao: 'fechada',
        });
      const d1 = await dia('2026-01-05');
      const d2 = await dia('2026-01-06');
      const item = (ap: number, sequencia: number, tipo: number, minutos: number, destino: string) =>
        g.inserir('apuracao_ponto_item', {
          apuracao_ponto_id: ap,
          sequencia,
          tipo_hora_id: tipo,
          minutos,
          destino,
        });
      await item(d1, 1, thFalta, 30, 'descontado');
      await item(d1, 2, thExtra, 60, 'folha');
      await item(d2, 1, thFalta, 600, 'abonado');
      await item(d2, 2, thFalta, 100, 'informativo');
      await ponto(vt.id, '2026-01-01', '2026-01-31', 'fechado', 80, 0, 0); // janeiro: UTI
      await ponto(vt.id, '2026-03-01', '2026-03-31', 'fechado', 40, 0, 0); // março: Clínica
      await ponto(v2.id, '2026-02-01', '2026-02-28', 'assinado', 100, 0, 20);
      await ponto(v1.id, '2026-02-01', '2026-02-28', 'aberto', 999, 999, 999);
      await ponto(v1.id, '2025-12-01', '2025-12-31', 'fechado', 999, 999, 999);

      // Folha: a rubrica de hora extra (proventos) nas competências do período.
      const rubrica = (adicional: string | null) =>
        g.inserir('rubrica', { estabelecimento_id: ids.estA, adicional, vigencia_inicio: '2020-01-01' });
      const rHe = await rubrica('hora_extra');
      const rSal = await rubrica(null);
      const comp = (mes: number) =>
        g.inserir('competencia_folha', {
          estabelecimento_id: ids.estA,
          ano: 2026,
          mes,
          apuracao_inicio: `2026-0${mes}-01`,
          apuracao_fim: `2026-0${mes}-28`,
          aberta_em: agora,
        });
      const calculo = async (competencia: number, v: number, itens: [number, number][]) => {
        const total = itens.reduce((s, [, x]) => s + x, 0);
        const c = await g.inserir('calculo_folha', {
          estabelecimento_id: ids.estA,
          competencia_folha_id: competencia,
          colaborador_id: v === v1.id ? v1.col : v3.col,
          vinculo_trabalho_id: v,
          total_proventos: total,
          total_descontos: 0,
          valor_liquido: total,
          calculado_em: agora,
        });
        let s = 0;
        for (const [rub, valor] of itens)
          await g.inserir('calculo_folha_item', {
            calculo_folha_id: c,
            sequencia: ++s,
            rubrica_id: rub,
            natureza: 'provento',
            valor,
          });
      };
      await calculo(await comp(2), v1.id, [
        [rHe, 250.5],
        [rSal, 749.5],
      ]);
      await calculo(await comp(4), v1.id, [[rHe, 999]]); // competência fora do período

      // Treinamento: turma concluída no período; presença cumprida (minutos ou a carga da turma).
      const curso = await g.inserir('curso', { nome: 'L0308 Curso', carga_minutos: 120 });
      const turma = (fim: string, situacao: string) =>
        g.inserir('turma_treinamento', {
          estabelecimento_id: ids.estA,
          curso_id: curso,
          data_inicio: fim,
          data_fim: fim,
          carga_horaria_minutos: 120,
          modalidade: 'presencial',
          instrutor_nome: 'L0308 INSTRUTOR',
          situacao,
        });
      const t1 = await turma('2026-03-10', 'concluida');
      const t2 = await turma('2026-04-10', 'concluida');
      let sq = 0;
      const presenca = (t: number, col: number, situacao: string, minutos: number) =>
        g.inserir('presenca_treinamento', {
          turma_treinamento_id: t,
          sequencia: ++sq,
          colaborador_id: col,
          situacao,
          minutos_cumpridos: minutos,
        });
      await presenca(t1, v1.col, 'presente', 90);
      await presenca(t1, v3.col, 'presente', 0);
      await presenca(t1, v2.col, 'ausente', 0);
      await presenca(t2, v1.col, 'presente', 500);

      // SESMT: a comunicação inicial emitida no período.
      const acidente = (v: number, col: number, em: string, situacao: string, afastou: boolean) =>
        g.inserir('comunicacao_acidente', {
          estabelecimento_id: ids.estA,
          colaborador_id: col,
          vinculo_trabalho_id: v,
          tipo: 'inicial',
          tipo_acidente: 'tipico',
          tipo_local: 'estabelecimento_empregador',
          acidente_em: new Date(`${em}T12:00:00Z`),
          houve_afastamento: afastou,
          situacao,
        });
      await acidente(v1.id, v1.col, '2026-02-20', 'emitida', true);
      await acidente(v1.id, v1.col, '2026-02-21', 'rascunho', false);
      await acidente(v3.id, v3.col, '2026-04-01', 'emitida', false);
      // Bordas no fuso (23:30 em São Paulo = 02:30Z do dia seguinte): 14/02 local ainda na UTI; último dia do período
      // entra (Clínica); véspera do início fica de fora.
      const local = (v: number, col: number, instante: string) =>
        g.inserir('comunicacao_acidente', {
          estabelecimento_id: ids.estA,
          colaborador_id: col,
          vinculo_trabalho_id: v,
          tipo: 'inicial',
          tipo_acidente: 'tipico',
          tipo_local: 'estabelecimento_empregador',
          acidente_em: new Date(instante),
          houve_afastamento: false,
          situacao: 'emitida',
        });
      await local(vt.id, vt.col, '2026-02-15T02:30:00Z');
      await local(vt.id, vt.col, '2026-04-01T02:30:00Z');
      await local(vt.id, vt.col, '2026-01-01T02:30:00Z');

      // Censo: só o fechamento diário fechado no período, pela unidade de internação do setor.
      const unidade = await g.inserir('unidade_internacao', {
        estabelecimento_id: ids.estA,
        setor_funcional_id: ids.uti,
        tipo: 'uti_adulto',
        unidade_assistencial_id: await g.inserir('unidade_assistencial', { estabelecimento_id: ids.estA }),
      });
      const censo = (data: string, situacao: string, pacientes: number) =>
        g.inserir('fechamento_censo', {
          estabelecimento_id: ids.estA,
          unidade_internacao_id: unidade,
          data_referencia: data,
          corte_em: agora,
          situacao,
          fechado_em: situacao === 'fechado' ? agora : null,
          pacientes_dia: pacientes,
        });
      await censo('2026-01-31', 'fechado', 30);
      await censo('2026-02-28', 'fechado', 40);
      await censo('2026-03-01', 'aberto', 99);
      await censo('2026-04-30', 'fechado', 999);

      // Dimensionamento: o último não cancelado do setor até o fim do período.
      const dim = (data: string, situacao: string, p: { minimo?: number; intensivo?: number }) =>
        g.inserir('dimensionamento_enfermagem', {
          estabelecimento_id: ids.estA,
          setor_funcional_id: ids.uti,
          data_referencia: data,
          fonte: 'informada',
          jornada_semanal_horas: 36,
          indice_seguranca_tecnica: 0.15,
          pacientes_cuidado_minimo: p.minimo ?? 0,
          pacientes_intensivo: p.intensivo ?? 0,
          total_horas_enfermagem: 0,
          quantidade_profissionais_calculada: 0,
          percentual_enfermeiros: 52,
          quantidade_enfermeiros: 0,
          quantidade_tecnicos: 0,
          situacao,
        });
      await dim('2025-06-01', 'calculado', { minimo: 9 });
      await dim('2026-02-01', 'calculado', { intensivo: 5 });
      await dim('2026-03-01', 'cancelado', { minimo: 3 });
      await dim('2026-05-01', 'calculado', { minimo: 7 });
      gerador = g;
    });
    const base = { cliente: CLIENTE, usuario: null, correlacao: 'teste-l0308', rede: 'rede-teste' };
    ctxA = { ...base, estabelecimento: ids.estA, hospital: EST_A };
    ctxB = { ...base, estabelecimento: ids.estB, hospital: EST_B };
    const UTI = { setor: ids.uti, nomeSetor: 'L0308 UTI' };
    const CLI = { setor: ids.clinica, nomeSetor: 'L0308 Clinica' };
    const zero = { minimos: 0, intermediarios: 0, altaDependencia: 0, semiIntensivos: 0, intensivos: 0 };
    fatos = {
      vinculos: [
        { ...UTI, admissao: '2020-01-01', desligamento: null },
        { ...UTI, admissao: '2020-01-01', desligamento: '2026-02-15' },
        { ...CLI, admissao: '2026-02-01', desligamento: null },
        { ...CLI, admissao: '2020-01-01', desligamento: null },
      ],
      ponto: [
        {
          ...UTI,
          data: '2026-01-31',
          horasPrevistas: 220,
          horasTrabalhadas: 340,
          horasAusencia: 30.5,
          horasExtras: 10,
          horasEnfermagem: 160,
        },
        {
          ...CLI,
          data: '2026-03-31',
          horasPrevistas: 40,
          horasTrabalhadas: 40,
          horasAusencia: 0,
          horasExtras: 0,
          horasEnfermagem: 0,
        },
      ],
      folhaHorasExtras: [{ ...UTI, competencia: '2026-02', valorCent: 25_050 }],
      treinamento: [
        { ...UTI, data: '2026-03-10', horas: 1.5 },
        { ...CLI, data: '2026-03-10', horas: 2 },
      ],
      acidentes: [
        { ...UTI, data: '2026-02-20', comAfastamento: true },
        { ...UTI, data: '2026-02-14', comAfastamento: false },
        { ...CLI, data: '2026-03-31', comAfastamento: false },
      ],
      censo: [{ ...UTI, data: '2026-02-28', pacientesDia: 70 }],
      dimensionamento: [{ ...UTI, data: '2026-02-01', pacientes: { ...zero, intensivos: 5 } }],
    };
  }, 120_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-l0308' }, async (e) => {
        await limpar(e, [ids.estA, ids.estB]);
        if (gerador) {
          const g = new Gerador(e);
          g.criadas.push(...gerador.criadas);
          await g.desfazer();
        }
      });
      await nucleo.encerrar();
    }
  }, 120_000);

  const fabricas: [string, () => PortaIndicadoresPessoas][] = [
    ['banco', () => new PortaIndicadoresPessoasPropria(nucleo)],
    [
      'memoria',
      () => {
        const m = new PortaIndicadoresPessoasMemoria();
        m.semear(EST_A, fatos);
        return m;
      },
    ],
  ];

  describe.each(fabricas)('a mesma bateria (%s)', (_nome, fabrica) => {
    const ordenar = <T extends { setor: number | null }>(xs: readonly T[]) =>
      [...xs].sort((a, b) => Number(a.setor) - Number(b.setor));

    it('a base do trimestre traz só os fatos do período, do estabelecimento e não excluídos', async () => {
      const { base, indisponiveis } = await fabrica().base(ctxA, { ...RECORTE, hospital: EST_A });
      expect(indisponiveis).toEqual([]);
      const h = { hospital: EST_A };
      const UTI = { ...h, setor: ids.uti, nomeSetor: 'L0308 UTI' };
      const CLI = { ...h, setor: ids.clinica, nomeSetor: 'L0308 Clinica' };
      expect(base.vinculos.map((v) => [v.setor, v.admissao, v.desligamento]).sort()).toEqual(
        [
          [ids.uti, '2020-01-01', null],
          [ids.uti, '2020-01-01', '2026-02-15'],
          [ids.clinica, '2026-02-01', null],
          [ids.clinica, '2020-01-01', null],
        ].sort(),
      );
      // UTI: janeiro do v1 pela apuração diária (previstas 2 × 600 min = 20 h; ausência = atraso 30 + falta abonada
      // 600 min = 10,5 h; o informativo e a extra não contam); fevereiro do v2 sem apuração diária (100 − 0 + 20 = 120
      // previstas, 20 de ausência); janeiro do transferido (80 h) ainda na UTI. Previstas 20 + 120 + 80 = 220; ausência
      // 10,5 + 20 = 30,5. Março do transferido vai à Clínica (40 h). Enfermagem só o cargo do conselho (160).
      expect(ordenar(base.ponto)).toEqual(
        ordenar([
          {
            ...UTI,
            horasPrevistas: 220,
            horasTrabalhadas: 340,
            horasAusencia: 30.5,
            horasExtras: 10,
            horasEnfermagem: 160,
          },
          {
            ...CLI,
            horasPrevistas: 40,
            horasTrabalhadas: 40,
            horasAusencia: 0,
            horasExtras: 0,
            horasEnfermagem: 0,
          },
        ]),
      );
      expect(base.folhaHorasExtras).toEqual([{ ...UTI, valorCent: 25_050 }]);
      // 90 minutos cumpridos na UTI; na Clínica, presença sem minutos registrados, a carga da turma (120).
      expect(ordenar(base.treinamento)).toEqual(
        ordenar([
          { ...UTI, horas: 1.5 },
          { ...CLI, horas: 2 },
        ]),
      );
      // UTI: o de 20/02 e o de 14/02 às 23:30 locais (lotação da data); Clínica: 31/03 às 23:30 locais. A véspera do
      // início às 23:30 locais (01/01 02:30Z) fica de fora.
      expect(ordenar(base.acidentes)).toEqual(
        ordenar([
          { ...UTI, quantidade: 2, comAfastamento: 1 },
          { ...CLI, quantidade: 1, comAfastamento: 0 },
        ]),
      );
      expect(base.censo).toEqual([{ ...UTI, pacientesDia: 70 }]);
      expect(base.dimensionamento).toEqual([
        {
          ...UTI,
          pacientes: { minimos: 0, intermediarios: 0, altaDependencia: 0, semiIntensivos: 0, intensivos: 5 },
        },
      ]);
    });

    it('o setor recorta todas as fontes', async () => {
      const { base } = await fabrica().base(ctxA, { ...RECORTE, setor: ids.clinica, hospital: EST_A });
      expect(base.vinculos).toHaveLength(2);
      expect(base.ponto.map((x) => [x.setor, x.horasTrabalhadas])).toEqual([[ids.clinica, 40]]);
      expect(base.acidentes.map((x) => [x.setor, x.quantidade])).toEqual([[ids.clinica, 1]]);
      expect(base.treinamento.map((x) => x.horas)).toEqual([2]);
      expect(base.censo).toEqual([]);
      expect(base.dimensionamento).toEqual([]);
    });
  });

  it('banco: setores do estabelecimento, hoje em data ISO e outro estabelecimento sem os fatos de A', async () => {
    const p = new PortaIndicadoresPessoasPropria(nucleo);
    expect(await p.setores(ctxA)).toEqual([
      { codigo: ids.clinica, rotulo: 'L0308 Clinica' },
      { codigo: ids.uti, rotulo: 'L0308 UTI' },
    ]);
    expect(await p.hoje(ctxA)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const b = await p.base(ctxB, { ...RECORTE, hospital: EST_B });
    expect(b.base.vinculos.map((v) => v.setor)).toEqual([ids.setorB]);
    expect([b.base.ponto, b.base.folhaHorasExtras, b.base.acidentes, b.base.censo]).toEqual([[], [], [], []]);
  });

  it('banco: só leitura (a trilha e a outbox não mudam) e sem estabelecimento é recusa', async () => {
    const antes = await contar();
    await new PortaIndicadoresPessoasPropria(nucleo).base(ctxA, { ...RECORTE, hospital: EST_A });
    expect(await contar()).toEqual(antes);
    await expect(
      new PortaIndicadoresPessoasPropria(nucleo).base(
        { ...ctxA, estabelecimento: null },
        { ...RECORTE, hospital: EST_A },
      ),
    ).rejects.toThrow(/estabelecimento/);
  });
});
