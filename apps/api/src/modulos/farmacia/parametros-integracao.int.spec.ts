// Contrato de efeito dos parâmetros da integração prescrição × estoque (F3.6, 05-SUP linha 7) contra o MariaDB real
// (cliente f22_o2). Massa SINTÉTICA com o código "F36PAR" (nenhuma pessoa real): dois estabelecimentos, uma unidade
// de internação, dois locais de estoque (e um de outro estabelecimento) e duas frequências (3 vezes ao dia e de 8 em 8
// horas sem número de doses). Confere a regra de integração (inclusão, alteração com trava de versão, idempotência,
// trilha, outbox e as recusas antes de gravar) e a grade de horários padrão UNIFICADA (horario_padrao_dose, a mesma
// que o aprazamento lê: inclusão, alteração com versão sem apagar, recusa pelo número de doses, frequência sem doses,
// grade de outro estabelecimento, escopo da grade da unidade e a migração 11_SUP/97 que copia a grade antiga).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ContextoNucleo, type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { CatalogoPrescricaoPropria } from '../pep/prescricao-propria-catalogo.js';
import { PortaFarmaciaPropria } from './porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'F36PAR';
const RAIZ = resolve(__dirname, '../../../../..');

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}
const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));

describe.skipIf(SEM_BANCO)('parâmetros da integração prescrição × estoque (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaFarmaciaPropria;
  let ctx: ContextoNucleo;
  const ids = {
    est: 0,
    outroEst: 0,
    usuario: 0,
    unidade: 0,
    ua: 0,
    setor: 0,
    setorAlheio: 0,
    gradeSetor: 0,
    farmacia: 0,
    satelite: 0,
    alheio: 0,
    f3x: 0,
    f8h: 0,
    fsn: 0,
    f12h: 0,
    gradeUnidade: 0,
    gradeAlheia: 0,
  };
  let chave = 0;

  const limpar = async (e: Escritor) => {
    for (const t of [
      'idempotencia_operacao',
      'integracao_mensagem',
      'regra_integracao_prescricao',
      'horario_padrao_dose',
      'horario_padrao_medicacao',
      'grade_horario_unidade',
    ])
      await e.executar(`DELETE FROM ${t} WHERE estabelecimento_id IN (?, ?)`, [ids.est, ids.outroEst]);
    await e.executar(
      "DELETE FROM pendencia WHERE tipo = 'migracao' AND entidade = 'horario_padrao_medicacao' AND estabelecimento_id IN (?, ?)",
      [ids.est, ids.outroEst],
    );
    await limparTrilhaDaMassa(e, { ids: [ids.est, ids.outroEst] });
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f36-par' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `ESTAB ${codigo} SINTETICO`, `ESTAB ${codigo} SINTETICO`, agora],
        );
      ids.est = await est(P);
      ids.outroEst = await est(`${P}B`);
      await limpar(e);
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['f36par.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['f36par.teste', 'USUARIO SINTETICO F36PAR', agora],
      );
      const ua = (ids.ua = await garantir(
        e,
        'SELECT id FROM unidade_assistencial WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-UA`],
        "INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em) VALUES (?, ?, ?, 'internacao', ?)",
        [ids.est, `${P}-UA`, 'UTI SINTETICA', agora],
      ));
      ids.unidade = await garantir(
        e,
        'SELECT id FROM unidade_internacao WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-UTI`],
        "INSERT INTO unidade_internacao (estabelecimento_id, unidade_assistencial_id, codigo, descricao, tipo, criado_em) VALUES (?, ?, ?, ?, 'uti_adulto', ?)",
        [ids.est, ua, `${P}-UTI`, 'UTI SINTETICA F36PAR', agora],
      );
      const local = (estab: number, codigo: string, tipo: string) =>
        garantir(
          e,
          'SELECT id FROM local_estoque WHERE estabelecimento_id = ? AND codigo = ?',
          [estab, codigo],
          'INSERT INTO local_estoque (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, ?, ?, ?)',
          [estab, codigo, `LOCAL ${codigo} SINTETICO`, tipo, agora],
        );
      ids.farmacia = await local(ids.est, `${P}-FC`, 'farmacia_central');
      ids.satelite = await local(ids.est, `${P}-FS`, 'farmacia_satelite');
      ids.alheio = await local(ids.outroEst, `${P}-FX`, 'farmacia_central');
      const freq = (codigo: string, tipo: string, intervalo: number | null, doses: number | null) =>
        garantir(
          e,
          'SELECT id FROM frequencia_administracao WHERE codigo = ?',
          [codigo],
          'INSERT INTO frequencia_administracao (codigo, descricao, tipo, intervalo_minutos, doses_por_dia, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
          [codigo, `FREQ ${codigo} SINTETICA`, tipo, intervalo, doses, agora],
        );
      ids.f3x = await freq(`${P}-3X`, 'vezes_ao_dia', null, 3);
      ids.f8h = await freq(`${P}-8H`, 'intervalo', 480, null);
      // De 7 em 7 horas: o intervalo não fecha o dia, a frequência não dá número de doses.
      ids.fsn = await freq(`${P}-7H`, 'intervalo', 420, null);
      ids.f12h = await freq(`${P}-12H`, 'vezes_ao_dia', null, 2);
      const gradeDe = (estab: number, unidade: number | null) =>
        e.inserir(
          `INSERT INTO grade_horario_unidade (estabelecimento_id, tipo_atendimento, unidade_internacao_id, hora_inicio_dia,
                  criado_em) VALUES (?, 'internacao', ?, '07:00:00', ?)`,
          [estab, unidade, agora],
        );
      ids.gradeUnidade = await gradeDe(ids.est, ids.unidade);
      const setor = (estab: number, codigo: string) =>
        garantir(
          e,
          'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = ?',
          [estab, codigo],
          "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, 'SETOR SINTETICO F36PAR', 'assistencial', ?)",
          [estab, codigo, agora],
        );
      ids.setor = await setor(ids.est, `${P}-SF`);
      ids.setorAlheio = await setor(ids.outroEst, `${P}-SFB`);
      // A grade só de setor (sem unidade nem bloco): o aprazamento não a escolhe.
      ids.gradeSetor = await e.inserir(
        `INSERT INTO grade_horario_unidade (estabelecimento_id, tipo_atendimento, setor_funcional_id, hora_inicio_dia,
                criado_em) VALUES (?, 'internacao', ?, '07:00:00', ?)`,
        [ids.est, ids.setor, agora],
      );
      ids.gradeAlheia = await gradeDe(ids.outroEst, null);
    });
    ctx = { cliente: CLIENTE, estabelecimento: ids.est, usuario: ids.usuario, correlacao: 'teste-f36-par' };
    porta = new PortaFarmaciaPropria(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-f36-par' }, limpar);
    await nucleo.encerrar();
  });

  const op = (nome: string, entrada: unknown, k?: string) =>
    porta.executar(ctx, nome, entrada, {
      ...ctx,
      chaveIdempotencia: k ?? `f36par-${Date.now()}-${(chave += 1)}`,
    });
  const ler = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-f36-par' }, (l) =>
      l.uma<Record<string, unknown>>(sql, p),
    );
  const contar = async (sql: string, p: unknown[]) => Number((await ler(sql, p))?.['n']);
  const outbox = (ponto: string) =>
    contar('SELECT COUNT(*) AS n FROM integracao_mensagem WHERE ponto = ? AND estabelecimento_id = ?', [
      ponto,
      ids.est,
    ]);
  const regras = () =>
    contar('SELECT COUNT(*) AS n FROM regra_integracao_prescricao WHERE estabelecimento_id = ?', [ids.est]);
  const regra = () => ({
    unidade: ids.unidade,
    localAtendente: ids.farmacia,
    localSubstituto: ids.satelite,
    tipoIntegracao: 'requisicao_automatica',
    momento: 'antes_do_horario',
    antecedenciaMinutos: 120,
    forma: 'dose_individualizada',
  });

  it('regra de integração: inclusão, alteração com versão, idempotência, trilha e outbox', async () => {
    const k = `f36par-inc-${Date.now()}`;
    const r = await op('suprimentos.gravarRegraIntegracao', regra(), k);
    const id = Number(r.resultado['regra']);
    expect(await ler('SELECT * FROM regra_integracao_prescricao WHERE id = ?', [id])).toMatchObject({
      estabelecimento_id: ids.est,
      unidade_internacao_id: ids.unidade,
      atendente_local_estoque_id: ids.farmacia,
      substituto_local_estoque_id: ids.satelite,
      momento_integracao: 'antes_do_horario',
      antecedencia_minutos: 120,
      prioridade: 100,
      versao: 1,
    });
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = ? AND entidade_id = ? AND estabelecimento_id = ?',
        ['regra_integracao_prescricao', id, ids.est],
      ),
    ).toBeGreaterThanOrEqual(1);
    expect(await outbox('farmacia.regra_integracao.gravada')).toBe(1);
    // O mesmo pedido repetido não grava de novo.
    expect((await op('suprimentos.gravarRegraIntegracao', regra(), k)).repetida).toBe(true);
    expect(await regras()).toBe(1);
    // Alteração com a versão lida: muda a prioridade e a forma; a versão sobe.
    await op('suprimentos.gravarRegraIntegracao', {
      ...regra(),
      regra: id,
      versao: 1,
      prioridade: 50,
      forma: 'dose_unitaria',
    });
    expect(
      await ler(
        'SELECT prioridade, forma_dispensacao, versao FROM regra_integracao_prescricao WHERE id = ?',
        [id],
      ),
    ).toMatchObject({
      prioridade: 50,
      forma_dispensacao: 'dose_unitaria',
      versao: 2,
    });
    // A versão velha é recusada (outro usuário alterou antes).
    expect(
      codigoDe(
        await op('suprimentos.gravarRegraIntegracao', { ...regra(), regra: id, versao: 1 }).catch(
          (e: unknown) => e,
        ),
      ),
    ).toMatch(/versao|conflito/);
    // Inativar não apaga.
    await op('suprimentos.gravarRegraIntegracao', {
      ...regra(),
      regra: id,
      versao: 2,
      prioridade: 50,
      ativo: false,
    });
    expect(await regras()).toBe(1);
    const lidos = await porta.parametrosEditaveis(ctx);
    expect(lidos.regras.find((x) => x.regra === id)).toMatchObject({
      ativo: false,
      versao: 3,
      localAtendente: ids.farmacia,
    });
    expect(lidos.opcoes.locais.map((x) => x.id)).toEqual(
      expect.arrayContaining([ids.farmacia, ids.satelite]),
    );
    expect(lidos.opcoes.locais.map((x) => x.id)).not.toContain(ids.alheio);
  });

  it('regra de integração: recusas antes de gravar (nada gravado)', async () => {
    const antes = await regras();
    const recusa = async (e: unknown) =>
      codigoDe(await op('suprimentos.gravarRegraIntegracao', e).catch((x: unknown) => x));
    await op('suprimentos.gravarRegraIntegracao', { ...regra(), prioridade: 10 });
    const depois = antes + 1;
    expect(await recusa({ ...regra(), prioridade: 10 })).toBe('regra-duplicada');
    expect(await recusa({ ...regra(), unidade: null })).toBe('escopo-obrigatorio');
    expect(await recusa({ ...regra(), localSubstituto: ids.alheio })).toBe('referencia-inexistente');
    expect(await recusa({ ...regra(), localSubstituto: ids.farmacia })).toBe('mesmo-local');
    expect(await recusa({ ...regra(), momento: 'na_prescricao' })).toBe('antecedencia-sem-uso');
    expect(await regras()).toBe(depois);
  });

  it('grade padrão unificada: grava em horario_padrao_dose pelo número de doses, sem apagar, e recusa antes de gravar', async () => {
    const grade = (frequencia: number, g: number | null, ...horas: string[]) => ({
      frequencia,
      grade: g,
      horarios: horas.map((hora) => ({ hora })),
    });
    const doses = (g: number | null, nDoses: number, soAtivas = false) =>
      contar(
        `SELECT COUNT(*) AS n FROM horario_padrao_dose WHERE estabelecimento_id = ? AND grade_horario_unidade_id <=> ?
            AND doses_por_dia = ?${soAtivas ? ' AND ativo' : ''}`,
        [ids.est, g, nDoses],
      );
    expect(
      (await op('suprimentos.gravarHorariosPadrao', grade(ids.f3x, null, '06:00', '14:00', '22:00')))
        .resultado,
    ).toMatchObject({ doses: 3, incluidos: 3 });
    expect(
      await ler(
        `SELECT TIME_FORMAT(horario, '%H:%i') AS h, criado_por FROM horario_padrao_dose
          WHERE estabelecimento_id = ? AND grade_horario_unidade_id IS NULL AND doses_por_dia = 3 AND ordem_dose = 3`,
        [ids.est],
      ),
    ).toMatchObject({ h: '22:00', criado_por: ids.usuario });
    expect(await outbox('farmacia.horarios_padrao.gravados')).toBe(1);
    // A grade antiga não é mais gravada.
    expect(
      await contar('SELECT COUNT(*) AS n FROM horario_padrao_medicacao WHERE estabelecimento_id = ?', [
        ids.est,
      ]),
    ).toBe(0);
    // A frequência de 3 doses por dia recusa a grade de 2 horários, sem escrita.
    expect(
      codigoDe(
        await op('suprimentos.gravarHorariosPadrao', grade(ids.f3x, null, '08:00', '20:00')).catch(
          (e: unknown) => e,
        ),
      ),
    ).toBe('doses-da-frequencia');
    // De 8 em 8 horas (sem doses declaradas) dá 3 doses pelo intervalo: é a MESMA grade, alterada só no horário que
    // mudou (versão 2), nada apagado.
    expect(
      (await op('suprimentos.gravarHorariosPadrao', grade(ids.f8h, null, '06:00', '14:00', '21:00')))
        .resultado,
    ).toMatchObject({ doses: 3, incluidos: 0, alterados: 1, inativados: 0 });
    expect(await doses(null, 3)).toBe(3);
    expect(
      await ler(
        `SELECT versao FROM horario_padrao_dose
          WHERE estabelecimento_id = ? AND grade_horario_unidade_id IS NULL AND doses_por_dia = 3 AND ordem_dose = 3`,
        [ids.est],
      ),
    ).toMatchObject({ versao: 2 });
    // A frequência sem número de doses não tem grade padrão; a grade de outro estabelecimento é recusada.
    expect(
      codigoDe(
        await op('suprimentos.gravarHorariosPadrao', grade(ids.fsn, null, '08:00')).catch((e: unknown) => e),
      ),
    ).toBe('frequencia-sem-doses');
    expect(
      codigoDe(
        await op(
          'suprimentos.gravarHorariosPadrao',
          grade(ids.f3x, ids.gradeAlheia, '06:00', '14:00', '22:00'),
        ).catch((e: unknown) => e),
      ),
    ).toBe('referencia-inexistente');
    // Escopo da grade da unidade: a própria grade, ao lado da do estabelecimento.
    await op('suprimentos.gravarHorariosPadrao', grade(ids.f3x, ids.gradeUnidade, '08:00', '16:00', '00:00'));
    expect(await doses(ids.gradeUnidade, 3, true)).toBe(3);
    const lidas = (await porta.parametrosEditaveis(ctx)).grades;
    expect(lidas.find((g) => g.grade === null && g.dosesPorDia === 3)?.horarios.map((h) => h.hora)).toEqual([
      '06:00',
      '14:00',
      '21:00',
    ]);
    const daUnidade = lidas.find((g) => g.grade === ids.gradeUnidade);
    expect(daUnidade?.horarios.map((h) => h.hora)).toEqual(['08:00', '16:00', '00:00']);
    expect(daUnidade?.frequencia).not.toBeNull();
    const oferecidas = (await porta.parametrosEditaveis(ctx)).opcoes.gradesHorario.map((g) => g.id);
    expect(oferecidas).toContain(ids.gradeUnidade);
    // A grade gravada com escopo de unidade é a que o aprazamento escolhe para aquela unidade, com os horários gravados
    // para 3 doses ao dia (o aprazamento usa a hora em HHMM).
    const aprazamento = await new CatalogoPrescricaoPropria(nucleo, CLIENTE).regras({
      cliente: CLIENTE,
      estabelecimento: null,
      usuario: null,
      correlacao: P,
      rede: 'rede-teste',
      hospital: P,
    } as never);
    expect(aprazamento.porUnidade.get(ids.ua)).toBe(ids.gradeUnidade);
    const daRegra = aprazamento.regras.find((r) => r.id === ids.gradeUnidade);
    expect(daRegra?.grade.get(3)).toEqual(['0800', '1600', '0000']);
    // A grade só de setor não é oferecida nem aceita: gravada ali, ficaria sem efeito no aprazamento.
    expect(oferecidas).not.toContain(ids.gradeSetor);
    expect([...aprazamento.porUnidade.values(), ...aprazamento.porBloco.values()]).not.toContain(
      ids.gradeSetor,
    );
    expect(
      codigoDe(
        await op(
          'suprimentos.gravarHorariosPadrao',
          grade(ids.f3x, ids.gradeSetor, '06:00', '14:00', '22:00'),
        ).catch((e: unknown) => e),
      ),
    ).toBe('grade-sem-aprazamento');
    expect(
      await contar('SELECT COUNT(*) AS n FROM horario_padrao_dose WHERE grade_horario_unidade_id = ?', [
        ids.gradeSetor,
      ]),
    ).toBe(0);
  });

  it('migração 11_SUP/97: copia a grade antiga completa para a unificada, uma vez, sem apagar a antiga', async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f36-par-migra' }, async (e) => {
      await e.executar('DELETE FROM horario_padrao_dose WHERE estabelecimento_id = ?', [ids.outroEst]);
      await e.executar('DELETE FROM horario_padrao_medicacao WHERE estabelecimento_id = ?', [ids.outroEst]);
      for (const [ordem, hora] of [
        [1, '07:00:00'],
        [2, '15:00:00'],
        [3, '23:00:00'],
      ] as const)
        await e.executar(
          `INSERT INTO horario_padrao_medicacao (estabelecimento_id, frequencia_administracao_id, setor_funcional_id,
                  ordem_dose, horario, ativo, criado_em) VALUES (?, ?, NULL, ?, ?, TRUE, NOW(3))`,
          [ids.outroEst, ids.f8h, ordem, hora],
        );
      // Grade de um setor (o aprazamento não escolhe grade só de setor) e grade com horário restrito a dias da semana
      // (a grade unificada é diária): nenhuma das duas é copiada; cada uma vira UMA pendência de migração.
      for (const [setor, ordem, hora, dias] of [
        [ids.setorAlheio, 1, '05:00:00', null],
        [ids.setorAlheio, 2, '17:00:00', null],
        [null, 1, '10:00:00', '2,4'],
        [null, 2, '22:00:00', null],
      ] as const)
        await e.executar(
          `INSERT INTO horario_padrao_medicacao (estabelecimento_id, frequencia_administracao_id, setor_funcional_id,
                  ordem_dose, horario, dias_semana, ativo, criado_em) VALUES (?, ?, ?, ?, ?, ?, TRUE, NOW(3))`,
          [ids.outroEst, ids.f12h, setor, ordem, hora, dias],
        );
      // Incompleta (1 de 3 doses): não é copiada.
      await e.executar(
        `INSERT INTO horario_padrao_medicacao (estabelecimento_id, frequencia_administracao_id, setor_funcional_id,
                ordem_dose, horario, ativo, criado_em) VALUES (?, ?, ?, 1, '09:00:00', TRUE, NOW(3))`,
        [ids.outroEst, ids.f3x, null],
      );
    });
    const migrar = () =>
      execFileSync(resolve(RAIZ, 'tools/db/sql.sh'), [`cliente_${CLIENTE}`], {
        input: readFileSync(resolve(RAIZ, 'db/migracoes/11_SUP/97_grade_padrao_unificada_tabelas.sql')),
      });
    migrar();
    migrar();
    const copia = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f36-par-migra' }, (l) =>
      l.consultar<{ h: string }>(
        `SELECT TIME_FORMAT(horario, '%H:%i') AS h FROM horario_padrao_dose
          WHERE estabelecimento_id = ? AND grade_horario_unidade_id IS NULL AND doses_por_dia = 3 AND ativo
          ORDER BY ordem_dose`,
        [ids.outroEst],
      ),
    );
    expect(copia.map((r) => r.h)).toEqual(['07:00', '15:00', '23:00']);
    // Nada de 2 doses ao dia foi copiado: nem a grade do setor, nem a restrita a dias (que não vira diária).
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM horario_padrao_dose WHERE estabelecimento_id = ? AND doses_por_dia = 2',
        [ids.outroEst],
      ),
    ).toBe(0);
    // Uma pendência de migração por grade não copiada, mesmo rodando duas vezes.
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM pendencia WHERE tipo = 'migracao' AND entidade = 'horario_padrao_medicacao'
            AND estabelecimento_id = ? AND situacao = 'aberta'`,
        [ids.outroEst],
      ),
    ).toBe(2);
    expect(
      await contar('SELECT COUNT(*) AS n FROM horario_padrao_medicacao WHERE estabelecimento_id = ?', [
        ids.outroEst,
      ]),
    ).toBe(8);
  });
});
