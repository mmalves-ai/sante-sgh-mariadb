// Contrato de efeito dos registros da internação (F3.4, 04-INT linhas 65, 67 e 68) contra o MariaDB real, cliente de
// teste (massa SINTÉTICA, marca R de massa-adt.spec-util.ts):
//   - a admissão grava o diagnóstico de entrada e a guia inicial; a tela soma o secundário e a causa externa; nada é
//     apagado e as recusas (repetido, causa externa fora do capítulo XX) não gravam;
//   - o acidente de trabalho conferido na hora (sem empregador, recusa) e gravado com a sequência;
//   - a prorrogação entra como nova linha do histórico com a validade seguinte e o autorizador; a guia inicial fica;
//   - os operadores da unidade: com a regra, quem não está liberado não admite, não transfere para a unidade nem dá
//     alta nela; a linha só de material não conta como regra; a lista vazia tira as ações da internação (exclusão
//     lógica só da linha sem material) e devolve a unidade ao cargo;
//   - o principal novo substitui o vigente (fica no histórico); a retirada exige motivo e não apaga;
//   - a correção da guia não cria linha nem soma diárias; o retrato da internação guarda o total autorizado;
//   - outro estabelecimento não lê nem grava (404 sem vazamento).
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE_ADT,
  contextoAdt,
  encerrarMassaAdt,
  lerAdt,
  type MassaAdt,
  operacaoAdt,
  prepararMassaAdt,
  SEM_BANCO_ADT,
} from './massa-adt.spec-util.js';
import { carimboVersao } from './operacoes.js';
import { PortaAdtPropria } from './porta-propria.js';
import { lerOperadoresDaUnidade, lerRegistrosDaInternacao } from './registros-internacao.js';

const codigoDe = (e: unknown) =>
  (e as { problema?: { codigo?: string } }).problema?.codigo ?? (e as { codigo?: string }).codigo;

describe.skipIf(SEM_BANCO_ADT)(`registros da internação (MariaDB, cliente ${CLIENTE_ADT})`, () => {
  let m: MassaAdt | null = null;
  let porta: PortaAdtPropria;
  const M = () => m!;
  const conta = async (sql: string, p: unknown[]) =>
    Number((await lerAdt<{ n: number }>(M(), sql, p))?.n ?? 0);
  const executar = (op: string, entrada: unknown) =>
    porta
      .executar(contextoAdt(M()), op, entrada, { ...operacaoAdt(M()), reautenticadoEm: Date.now() })
      .then((r) => r.resultado as Record<string, unknown>);
  const internar = (paciente: number, leito: string, extra: Record<string, unknown> = {}) =>
    executar('internacao.internar', {
      paciente,
      leito: { bloco: 'B1', acomodacao: 'Q1', leito },
      convenio: M().convenio,
      acomodacaoPlano: 'ENFERMARIA',
      carater: 'urgencia',
      clinica: 'M',
      especialidade: M().especialidade,
      medicoAssistente: M().medico,
      medicoSolicitante: M().medico,
      cidPrincipal: M().cid,
      procedimento: M().procedimento,
      procedimentoOrigem: 'sigtap',
      centroCusto: 1,
      unidade: 1,
      origem: 'ambulatorio',
      caraterAdmissao: M().carater,
      caraterTiss: M().caraterTiss,
      categoriaAtendimento: M().categoria,
      modalidade: M().modalidade,
      ...extra,
    });
  const unidadeDaMassa = async () =>
    Number(
      (
        await lerAdt<{ u: number }>(
          M(),
          `SELECT lh.unidade_internacao_id AS u FROM leito_hospitalar lh JOIN acomodacao ac ON ac.id = lh.acomodacao_id
            WHERE lh.estabelecimento_id = ? AND ac.codigo = 'Q1' AND lh.codigo = ?`,
          [M().est, M().leitos[2]],
        )
      )?.u,
    );
  let internacao = 0;
  const versaoDe = async (id: number) =>
    carimboVersao(
      (await lerAdt<{ versao: number }>(M(), 'SELECT versao FROM internacao WHERE id = ?', [id]))?.versao,
    );
  const cidDe = async (filtro: string, exceto: number[]) =>
    Number(
      (
        await lerAdt<{ id: number }>(
          M(),
          `SELECT t.id FROM termo_terminologia t JOIN terminologia tt ON tt.id = t.terminologia_id
            WHERE tt.codigo = 'cid10' AND t.id NOT IN (${exceto.map(() => '?').join(',')}) AND ${filtro} LIMIT 1`,
          exceto,
        )
      )?.id ?? 0,
    );

  // A conta da internação: a aberta na entrada; quando o cadastro de tipos de conta do cliente de teste não deixa abrir
  // (pendência do faturamento, fora deste contrato), uma conta sintética da mesma internação (apagada pela limpeza da
  // massa, que tira as contas do estabelecimento).
  const contaDaInternacao = async (id: number): Promise<number> => {
    const ja = await lerAdt<{ id: number }>(
      M(),
      `SELECT c.id FROM conta_hospitalar c JOIN internacao i ON i.atendimento_id = c.atendimento_id
        WHERE i.id = ? ORDER BY c.id LIMIT 1`,
      [id],
    );
    if (ja) return Number(ja.id);
    const tipo = await lerAdt<{ id: number }>(
      M(),
      "SELECT id FROM tipo_conta WHERE natureza = 'internacao' AND ativo ORDER BY ordem, id LIMIT 1",
      [],
    );
    await M().nucleo.escrever({ cliente: CLIENTE_ADT, correlacao: 'int-registros-conta' }, (e) =>
      e.executar(
        `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
                tipo_conta_id, natureza, competencia, inicio_em, criado_em)
         SELECT estabelecimento_id, CONCAT('R', id, '-1'), atendimento_id, paciente_id, fonte_pagadora_id, ?, 'internacao',
                DATE_FORMAT(data_hora_entrada, '%Y-%m-01'), data_hora_entrada, NOW(3)
           FROM internacao WHERE id = ?`,
        [Number(tipo?.id), id],
      ),
    );
    return Number(
      (
        await lerAdt<{ id: number }>(
          M(),
          `SELECT c.id FROM conta_hospitalar c JOIN internacao i ON i.atendimento_id = c.atendimento_id WHERE i.id = ?`,
          [id],
        )
      )?.id,
    );
  };

  beforeAll(async () => {
    m = await prepararMassaAdt('R');
    porta = new PortaAdtPropria(M().nucleo);
  }, 60_000);
  afterAll(() => encerrarMassaAdt(m));

  it('admissão: guia sem diárias recusada na hora, sem gravar nada', async () => {
    const antes = await conta('SELECT COUNT(*) AS n FROM internacao WHERE estabelecimento_id = ?', [M().est]);
    await expect(internar(M().pacientes[0]!, M().leitos[0]!, { guia: 'G-SEM-DIARIAS' })).rejects.toSatisfy(
      (e) => codigoDe(e) === 'guia-sem-diarias',
    );
    expect(await conta('SELECT COUNT(*) AS n FROM internacao WHERE estabelecimento_id = ?', [M().est])).toBe(
      antes,
    );
  });

  it('admissão: diagnóstico de entrada e guia inicial no histórico', async () => {
    const r = await internar(M().pacientes[0]!, M().leitos[0]!, {
      guia: 'G-INICIAL',
      senhaConvenio: 'S1',
      diariasAutorizadas: 3,
    });
    internacao = Number(r['internacao']);
    expect(
      await lerAdt(
        M(),
        'SELECT tipo, sequencia, cid_termo_terminologia_id AS cid, profissional_id AS prof FROM diagnostico_internacao WHERE internacao_id = ?',
        [internacao],
      ),
    ).toMatchObject({ tipo: 'entrada', sequencia: 1, cid: M().cid, prof: M().medico });
    const g = await lerAdt<Record<string, unknown>>(
      M(),
      `SELECT g.tipo, g.sequencia, g.numero_guia, g.senha, g.diarias_autorizadas,
              DATEDIFF(g.fim_validade, g.inicio_validade) AS dias, DATE(i.data_hora_entrada) = g.inicio_validade AS na_entrada
         FROM guia_internacao g JOIN internacao i ON i.id = g.internacao_id WHERE g.internacao_id = ?`,
      [internacao],
    );
    expect(g).toMatchObject({
      tipo: 'inicial',
      sequencia: 1,
      numero_guia: 'G-INICIAL',
      senha: 'S1',
      diarias_autorizadas: 3,
      dias: 2,
    });
  });

  it('diagnósticos: secundário e causa externa pelas regras; repetido e causa externa fora do capítulo XX recusados', async () => {
    const outro = Number(
      (
        await lerAdt<{ id: number }>(
          M(),
          `SELECT t.id FROM termo_terminologia t JOIN terminologia tt ON tt.id = t.terminologia_id
            WHERE tt.codigo = 'cid10' AND t.id <> ? AND t.codigo_termo NOT REGEXP '^[VWXY]' LIMIT 1`,
          [M().cid],
        )
      )?.id,
    );
    const externa = Number(
      (
        await lerAdt<{ id: number }>(
          M(),
          `SELECT t.id FROM termo_terminologia t JOIN terminologia tt ON tt.id = t.terminologia_id
            WHERE tt.codigo = 'cid10' AND t.codigo_termo LIKE 'W19%' LIMIT 1`,
          [],
        )
      )?.id,
    );
    const trilhas = () =>
      conta("SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'internacao' AND entidade_id = ?", [
        internacao,
      ]);
    const trilhasAntes = await trilhas();
    const r = await executar('internacao.registrarDiagnostico', {
      internacao,
      cid: outro,
      tipo: 'secundario',
    });
    expect(r['sequencia']).toBe(2);
    await expect(
      executar('internacao.registrarDiagnostico', { internacao, cid: outro, tipo: 'secundario' }),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'diagnostico-invalido');
    await expect(
      executar('internacao.registrarDiagnostico', { internacao, cid: outro, tipo: 'causa_externa' }),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'diagnostico-invalido');
    if (externa > 0) {
      await executar('internacao.registrarDiagnostico', { internacao, cid: externa, tipo: 'causa_externa' });
      expect(
        await conta(
          "SELECT COUNT(*) AS n FROM diagnostico_internacao WHERE internacao_id = ? AND tipo = 'causa_externa'",
          [internacao],
        ),
      ).toBe(1);
    }
    expect(
      await conta('SELECT COUNT(*) AS n FROM diagnostico_internacao WHERE internacao_id = ?', [internacao]),
    ).toBe(externa > 0 ? 3 : 2);
    // Cada gravação aceita deixa a sua linha na trilha da internação (as recusas não).
    expect(await trilhas()).toBe(trilhasAntes + (externa > 0 ? 2 : 1));
  });

  it('acidente de trabalho: sem empregador recusa; com empregador grava a linha com a sequência', async () => {
    const hoje = new Date().toISOString().slice(0, 10);
    await expect(
      executar('internacao.registrarAcidente', { internacao, tipo: 'trabalho', ocorridoEm: `${hoje}T00:01` }),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'acidente-invalido');
    const r = await executar('internacao.registrarAcidente', {
      internacao,
      tipo: 'trabalho',
      ocorridoEm: `${hoje}T00:01`,
      empregadorCnpj: '11.222.333/0001-81',
      vinculo: 'empregado',
      numeroComunicacao: 'CAT-1',
    });
    expect(r['sequencia']).toBe(1);
    expect(
      await lerAdt(
        M(),
        'SELECT tipo_acidente, empregador_cnpj, vinculo_previdenciario, numero_comunicacao_acidente, ocorrido_em IS NOT NULL AS tem_data FROM acidente_internacao WHERE internacao_id = ?',
        [internacao],
      ),
    ).toMatchObject({
      tipo_acidente: 'trabalho',
      empregador_cnpj: '11222333000181',
      vinculo_previdenciario: 'empregado',
      numero_comunicacao_acidente: 'CAT-1',
      tem_data: 1,
    });
  });

  it('prorrogação: nova linha com a validade seguinte e o autorizador; a guia inicial continua; buraco recusado', async () => {
    const c = await contaDaInternacao(internacao);
    await expect(
      executar('internacao.registrarGuia', {
        internacao,
        conta: c,
        guia: 'G-BURACO',
        validadeDias: 2,
        inicio: '2099-01-01',
      }),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'guia-invalida');
    await executar('internacao.registrarGuia', {
      internacao,
      conta: c,
      guia: 'G-PRORROGA',
      senha: 'S2',
      validadeDias: 4,
      autorizador: 'AUDITORIA SINTETICA',
    });
    const linhas = await lerAdt<{ n: number; ini: string; pro: string; seguida: number }>(
      M(),
      `SELECT COUNT(*) AS n, MAX(CASE WHEN sequencia = 1 THEN numero_guia END) AS ini,
              MAX(CASE WHEN sequencia = 2 THEN CONCAT(tipo, '|', autorizador_nome, '|', diarias_autorizadas) END) AS pro,
              MAX(CASE WHEN sequencia = 2 THEN inicio_validade END) =
                DATE_ADD(MAX(CASE WHEN sequencia = 1 THEN fim_validade END), INTERVAL 1 DAY) AS seguida
         FROM guia_internacao WHERE internacao_id = ?`,
      [internacao],
    );
    expect(linhas).toMatchObject({
      n: 2,
      ini: 'G-INICIAL',
      pro: 'prorrogacao|AUDITORIA SINTETICA|4',
      seguida: 1,
    });
    expect(
      await lerAdt(
        M(),
        'SELECT numero_guia, senha_autorizacao, diarias_autorizadas FROM internacao WHERE id = ?',
        [internacao],
      ),
    ).toMatchObject({ numero_guia: 'G-PRORROGA', senha_autorizacao: 'S2', diarias_autorizadas: 7 });
    const leitura = await porta.lerNoEstabelecimento(contextoAdt(M()), (l, est, fuso) =>
      lerRegistrosDaInternacao(l, est, fuso, internacao),
    );
    expect(leitura?.guias.map((g) => g.tipo)).toEqual(['inicial', 'prorrogacao']);
    expect(leitura?.diariasAutorizadas).toBe(7);
    expect(leitura?.acidentes).toHaveLength(1);
    expect(leitura?.diagnosticos[0]?.tipo).toBe('entrada');
  });

  it('correção da guia: sem linha nova nem diárias somadas; motivo obrigatório; período só na última', async () => {
    await expect(
      executar('internacao.corrigirGuia', { internacao, sequencia: 1, guia: 'G-INICIAL-OK', motivo: '' }),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'motivo-obrigatorio');
    await expect(
      executar('internacao.corrigirGuia', {
        internacao,
        sequencia: 1,
        guia: 'G-INICIAL',
        validadeDias: 9,
        motivo: 'periodo digitado errado',
      }),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'guia-invalida');
    await executar('internacao.corrigirGuia', {
      internacao,
      sequencia: 1,
      guia: 'G-INICIAL-OK',
      senha: 'S1',
      motivo: 'numero digitado errado',
    });
    expect(
      await lerAdt(
        M(),
        `SELECT COUNT(*) AS n, CAST(SUM(diarias_autorizadas) AS SIGNED) AS d,
                MAX(CASE WHEN sequencia = 1 THEN CONCAT(numero_guia, '|', motivo_retificacao, '|', versao) END) AS ini
           FROM guia_internacao WHERE internacao_id = ?`,
        [internacao],
      ),
    ).toMatchObject({ n: 2, d: 7, ini: 'G-INICIAL-OK|numero digitado errado|2' });
    // A correção da última muda o período e o total no retrato; a guia vigente continua a última.
    await executar('internacao.corrigirGuia', {
      internacao,
      sequencia: 2,
      guia: 'G-PRORROGA',
      senha: 'S2',
      autorizador: 'AUDITORIA SINTETICA',
      validadeDias: 2,
      motivo: 'operadora autorizou 2 diarias',
    });
    expect(
      await lerAdt(M(), 'SELECT numero_guia, diarias_autorizadas FROM internacao WHERE id = ?', [internacao]),
    ).toMatchObject({ numero_guia: 'G-PRORROGA', diarias_autorizadas: 5 });
    const leitura = await porta.lerNoEstabelecimento(contextoAdt(M()), (l, est, fuso) =>
      lerRegistrosDaInternacao(l, est, fuso, internacao),
    );
    expect(leitura?.diariasAutorizadas).toBe(5);
    expect(leitura?.guias[1]?.motivoCorrecao).toBe('operadora autorizou 2 diarias');
  });

  it('diagnósticos: o principal novo substitui o vigente; a retirada exige motivo e fica no histórico', async () => {
    const a = await cidDe("t.codigo_termo REGEXP '^I'", [M().cid]);
    const b = await cidDe("t.codigo_termo REGEXP '^J'", [M().cid, a]);
    expect(a * b).toBeGreaterThan(0);
    const p1 = await executar('internacao.registrarDiagnostico', { internacao, cid: a, tipo: 'principal' });
    const p2 = await executar('internacao.registrarDiagnostico', { internacao, cid: b, tipo: 'principal' });
    expect(p2['substituiu']).toBe(p1['sequencia']);
    expect(
      await lerAdt(
        M(),
        `SELECT SUM(substituido_em IS NULL) AS vigentes, SUM(substituido_por_diagnostico_id = ?) AS trocado
           FROM diagnostico_internacao WHERE internacao_id = ? AND tipo = 'principal'`,
        [p2['diagnostico'], internacao],
      ),
    ).toMatchObject({ vigentes: '1', trocado: '1' });
    await expect(
      executar('internacao.retirarDiagnostico', { internacao, sequencia: p2['sequencia'], motivo: 'x' }),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'motivo-obrigatorio');
    const total = await conta('SELECT COUNT(*) AS n FROM diagnostico_internacao WHERE internacao_id = ?', [
      internacao,
    ]);
    await executar('internacao.retirarDiagnostico', {
      internacao,
      sequencia: p2['sequencia'],
      motivo: 'lancado na internacao errada',
    });
    expect(
      await conta('SELECT COUNT(*) AS n FROM diagnostico_internacao WHERE internacao_id = ?', [internacao]),
    ).toBe(total);
    const leitura = await porta.lerNoEstabelecimento(contextoAdt(M()), (l, est, fuso) =>
      lerRegistrosDaInternacao(l, est, fuso, internacao),
    );
    const situacoes = leitura?.diagnosticos.filter((d) => d.tipo === 'principal').map((d) => d.situacao);
    expect(situacoes).toEqual(['substituido', 'retirado']);
    expect(leitura?.diagnosticos.find((d) => d.situacao === 'retirado')?.motivoRetirada).toBe(
      'lancado na internacao errada',
    );
  });

  it('outro estabelecimento: a internação e a unidade não são lidas nem gravadas (404)', async () => {
    const alheio = contextoAdt(M(), M().outro);
    expect(
      await porta.lerNoEstabelecimento(contextoAdt(M()), (l, _est, fuso) =>
        lerRegistrosDaInternacao(l, M().outro, fuso, internacao),
      ),
    ).toBeNull();
    const unidade = await unidadeDaMassa();
    expect(
      await porta.lerNoEstabelecimento(contextoAdt(M()), (l) =>
        lerOperadoresDaUnidade(l, M().outro, unidade),
      ),
    ).toBeNull();
    await expect(
      porta.executar(
        alheio,
        'internacao.registrarDiagnostico',
        { internacao, cid: M().cid, tipo: 'secundario' },
        { ...operacaoAdt(M(), M().outro), reautenticadoEm: Date.now() },
      ),
    ).rejects.toSatisfy(
      (e) => codigoDe(e) === 'registro-inexistente' || codigoDe(e) === 'sem-estabelecimento',
    );
  });

  it('operadores da unidade: com a regra, quem não está liberado não admite; lista vazia retira sem apagar', async () => {
    const unidade = await unidadeDaMassa();
    const outroUsuario = Number(
      (
        await lerAdt<{ id: number }>(M(), 'SELECT id FROM usuario WHERE id <> ? ORDER BY id LIMIT 1', [
          M().usuario,
        ])
      )?.id,
    );
    await executar('internacao.definirOperadoresUnidade', {
      unidade,
      operadores: [{ usuario: outroUsuario, podeAdmitir: true, podeTransferir: true, podeDarAlta: true }],
    });
    await expect(internar(M().pacientes[1]!, M().leitos[2]!)).rejects.toSatisfy(
      (e) => codigoDe(e) === 'unidade-sem-permissao',
    );
    const r = await executar('internacao.definirOperadoresUnidade', {
      unidade,
      operadores: [
        { usuario: outroUsuario, podeAdmitir: true, podeTransferir: true, podeDarAlta: true },
        { usuario: M().usuario, podeAdmitir: true, podeTransferir: false, podeDarAlta: false },
      ],
    });
    expect(r).toMatchObject({ incluidos: 1, alterados: 0, retirados: 0 });
    const i2 = Number((await internar(M().pacientes[1]!, M().leitos[2]!))['internacao']);
    expect(i2).toBeGreaterThan(0);
    // O usuário só admite: não transfere para a unidade (destino) nem dá alta nela.
    await expect(
      executar('internacao.transferirLeito', {
        internacao: i2,
        destino: { bloco: 'B1', acomodacao: 'Q1', leito: M().leitos[1]! },
        versao: await versaoDe(i2),
        motivoTroca: M().motivoTroca,
      }),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'unidade-sem-permissao');
    await expect(
      executar('internacao.darAlta', {
        internacao: i2,
        motivo: M().motivoSaida,
        medicoAlta: M().medico,
        versao: await versaoDe(i2),
      }),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'unidade-sem-permissao');
    // A linha do outro usuário também guarda permissão de material da unidade (outra função, mesma tabela).
    await M().nucleo.escrever({ cliente: CLIENTE_ADT, correlacao: 'int-registros-material' }, (e) =>
      e.executar(
        'UPDATE permissao_unidade_usuario SET pode_movimentar_estoque = TRUE WHERE unidade_internacao_id = ? AND usuario_id = ?',
        [unidade, outroUsuario],
      ),
    );
    const vazia = await executar('internacao.definirOperadoresUnidade', { unidade, operadores: [] });
    expect(vazia).toMatchObject({ retirados: 2 });
    // Sem ação de internação: a linha só de material fica viva (sem as ações) e a do usuário só de ADT sai.
    expect(
      await lerAdt(
        M(),
        `SELECT SUM(excluido_em IS NOT NULL) AS fora,
                SUM(excluido_em IS NULL AND pode_movimentar_estoque AND NOT pode_admitir AND NOT pode_dar_alta) AS material
           FROM permissao_unidade_usuario WHERE unidade_internacao_id = ?`,
        [unidade],
      ),
    ).toMatchObject({ fora: '1', material: '1' });
    // A linha só de material não conta como regra: a unidade volta ao cargo e o usuário dá alta.
    await executar('internacao.darAlta', {
      internacao: i2,
      motivo: M().motivoSaida,
      medicoAlta: M().medico,
      versao: await versaoDe(i2),
    });
    expect(await lerAdt(M(), 'SELECT situacao FROM internacao WHERE id = ?', [i2])).toMatchObject({
      situacao: 'alta',
    });
  });
});
