// Integração da porta própria da prescrição contra o MariaDB real (cliente de teste f22_o4). Massa SINTÉTICA do lote
// (prefixo l2403p): estabelecimentos, cadastros e prescrições com códigos do teste e ids de paciente fictícios, montada
// no beforeAll e apagada no afterAll; nenhum dado de pessoa. As chaves estrangeiras para cadastros que a porta não lê
// (pessoa, paciente, princípio ativo, convênio) ficam desligadas SÓ na transação do preparo; os CHECKs continuam
// valendo. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASE_PLANO_PROPRIO, PortaPrescricaoPropria } from './prescricao-porta-propria.js';
import { ServicoPrescricao } from './prescricao-servico.js';
import { dataHora } from './registro-porta-propria.js';
import { CLIENTE_F22_O4 } from './worklist-massa.spec-util.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'l2403p';
const FUSO = 'America/Sao_Paulo';
const HORA = 3_600_000;
const BASE = 924_030_000;
const ctx = (hospital: string) => ({
  cliente: CLIENTE_F22_O4,
  estabelecimento: null,
  usuario: null,
  correlacao: P,
  rede: 'rede-teste',
  hospital,
});

interface Massa {
  agora: Date;
  pac: number;
  atdInt: number;
  atdPa: number;
  atdB: number;
  cbo: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  i1: number;
  i2: number;
  med: number;
  tipoCuidado: number;
  freq: number;
  h1: number;
  h2: number;
  h3: number;
  liberada: Date;
  suspensaEm: Date;
  p5: number;
  p6: number;
  i4: number;
  i5: number;
  canceladaEm: Date;
  cboOcup: string;
}

/** Apaga a massa do prefixo (só linhas com os códigos e os estabelecimentos do teste). */
async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo IN (?, ?))';
  const cods = [P, `${P}b`];
  const dasPrescricoes = `(SELECT id FROM prescricao WHERE estabelecimento_id IN ${est})`;
  const dosItens = `(SELECT i.id FROM prescricao_item i WHERE i.prescricao_id IN ${dasPrescricoes})`;
  await e.executar(`DELETE FROM decisao_alerta WHERE prescricao_item_id IN ${dosItens}`, cods);
  await e.executar(`DELETE FROM prescricao_evento WHERE prescricao_id IN ${dasPrescricoes}`, cods);
  await e.executar(
    `DELETE FROM afericao_valor WHERE afericao_id IN (SELECT id FROM afericao WHERE estabelecimento_id IN ${est})`,
    cods,
  );
  await e.executar(`DELETE FROM afericao WHERE estabelecimento_id IN ${est}`, cods);
  await e.executar(`DELETE FROM horario_administracao WHERE estabelecimento_id IN ${est}`, cods);
  await e.executar(`DELETE FROM prescricao_item_medicamento WHERE prescricao_item_id IN ${dosItens}`, cods);
  await e.executar(`DELETE FROM prescricao_item WHERE prescricao_id IN ${dasPrescricoes}`, cods);
  await e.executar(`DELETE FROM prescricao WHERE estabelecimento_id IN ${est}`, cods);
  await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN ${est}`, cods);
  await e.executar(`DELETE FROM trilha_auditoria WHERE estabelecimento_id IN ${est}`, cods);
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', cods);
  await e.executar(
    `DELETE up FROM usuario_profissional up JOIN usuario u ON u.id = up.usuario_id WHERE u.login = ?`,
    [`${P}med`],
  );
  await e.executar('DELETE FROM usuario WHERE login = ?', [`${P}med`]);
  await e.executar(
    'DELETE po FROM profissional_ocupacao po JOIN profissional pf ON pf.id = po.profissional_id WHERE pf.nome_exibicao LIKE ?',
    [`${P} %`],
  );
  await e.executar('DELETE FROM profissional WHERE nome_exibicao LIKE ?', [`${P} %`]);
  await e.executar('DELETE FROM item_prescritivel WHERE codigo LIKE ?', [`${P}%`]);
  for (const t of [
    'situacao_checagem',
    'tipo_item_prescricao',
    'frequencia_administracao',
    'via_de_uso',
    'unidade_prescricao',
    'categoria_atendimento',
  ])
    await e.executar(`DELETE FROM ${t} WHERE codigo LIKE ?`, [`${P}%`]);
}

const num = (v: unknown): number => Number(v);

async function montar(nucleo: NucleoProprio): Promise<Massa> {
  return nucleo.escrever({ cliente: CLIENTE_F22_O4, correlacao: `preparo-${P}` }, async (e) => {
    await limpar(e);
    const agora = new Date(Math.floor(Date.now() / 1000) * 1000);
    const em = (ms: number) => new Date(agora.getTime() + ms);
    const est = (codigo: string) =>
      e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [codigo, `Hospital sintético ${codigo}`, `Hospital sintético ${codigo} (fictício)`, agora],
      );
    const estA = await est(P);
    const estB = await est(`${P}b`);
    const ocup = await e.uma<{ id: unknown; codigo_cbo: unknown }>(
      "SELECT id, codigo_cbo FROM ocupacao_cbo WHERE codigo_cbo REGEXP '^[0-9]+$' ORDER BY id LIMIT 1",
    );
    await e.executar('SET FOREIGN_KEY_CHECKS = 0');
    try {
      const cad = (sql: string, p: unknown[]) => e.inserir(sql, [...p, agora]);
      const catInt = await cad(
        `INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'internacao', ?)`,
        [`${P}i`, 'Internação sintética'],
      );
      const catPa = await cad(
        `INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'pronto_atendimento', ?)`,
        [`${P}a`, 'Pronto atendimento sintético'],
      );
      const pac = BASE + 1;
      let numero = 0;
      const atendimento = (estab: number, categoria: number) =>
        e.inserir(
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
             carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, unidade_assistencial_id, situacao,
             entrada_em, criado_em)
           VALUES (?, ?, ?, ?, 1, 77, 1, 55, 'aberto', ?, ?)`,
          [estab, String(BASE + ++numero), pac, categoria, em(-48 * HORA), agora],
        );
      const atdInt = await atendimento(estA, catInt);
      const atdPa = await atendimento(estA, catPa);
      const atdB = await atendimento(estB, catInt);
      // Pessoa física fictícia (uma por profissional; a chave estrangeira está desligada no preparo).
      const prof = (nome: string, pessoa: number) =>
        cad(
          `INSERT INTO profissional (pessoa_fisica_id, tipo, nome_exibicao, criado_em) VALUES (?, 'corpo_clinico', ?, ?)`,
          [pessoa, `${P} ${nome}`],
        );
      const prof1 = await prof('Prescritor sintético', BASE + 101);
      const prof2 = await prof('Suspensor sintético', BASE + 102);
      const usuario = await cad(
        `INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, 'Usuário sintético', 'servico', ?)`,
        [`${P}med`],
      );
      await cad(
        `INSERT INTO usuario_profissional (usuario_id, profissional_id, vigencia_inicio, criado_em)
         VALUES (?, ?, '2026-01-01', ?)`,
        [usuario, prof1],
      );
      if (ocup)
        await cad(
          `INSERT INTO profissional_ocupacao (profissional_id, ocupacao_cbo_id, principal, criado_em) VALUES (?, ?, TRUE, ?)`,
          [prof1, ocup.id],
        );
      const tipoMed = await cad(
        `INSERT INTO tipo_item_prescricao (codigo, descricao, categoria, criado_em) VALUES (?, 'Medicamento sintético', 'medicamento', ?)`,
        [`${P}m`],
      );
      const tipoCuidado = await cad(
        `INSERT INTO tipo_item_prescricao (codigo, descricao, categoria, criado_em) VALUES (?, 'Cuidado sintético', 'cuidado', ?)`,
        [`${P}c`],
      );
      const freq = await cad(
        `INSERT INTO frequencia_administracao (codigo, descricao, tipo, doses_por_dia, criado_em)
         VALUES (?, '6 em 6 horas', 'vezes_ao_dia', 4, ?)`,
        [`${P}f`],
      );
      const via = await cad(
        `INSERT INTO via_de_uso (codigo, descricao, sigla, criado_em) VALUES (?, 'Endovenosa', 'EV', ?)`,
        [`${P}v`],
      );
      const unidade = await cad(
        `INSERT INTO unidade_prescricao (codigo, descricao, sigla, criado_em) VALUES (?, 'Miligrama', 'mg', ?)`,
        [`${P}u`],
      );
      const produto = await cad(
        `INSERT INTO item_prescritivel (codigo, descricao, tipo_item_prescricao_id, principio_ativo_id, criado_em)
         VALUES (?, 'Produto sintético', ?, 77, ?)`,
        [`${P}ip`, tipoMed],
      );
      const sitPend = await cad(
        `INSERT INTO situacao_checagem (codigo, descricao, categoria, criado_em) VALUES (?, 'Pendente', 'pendente', ?)`,
        [`${P}p`],
      );
      const sitAdm = await cad(
        `INSERT INTO situacao_checagem (codigo, descricao, categoria, criado_em) VALUES (?, 'Administrado', 'administrado', ?)`,
        [`${P}a`],
      );
      let nPresc = 0;
      const liberada = em(-20 * HORA);
      const suspensaEm = em(-2 * HORA);
      const prescricao = (
        estab: number,
        atd: number,
        prescrito: Date,
        o: { suspensa?: boolean; excluida?: boolean; liberada?: Date | null; situacao?: string } = {},
      ) =>
        e.inserir(
          `INSERT INTO prescricao (estabelecimento_id, numero, paciente_id, atendimento_id, prescritor_profissional_id,
             ocupacao_cbo_id, tipo, situacao, prescrito_em, vigencia_inicio_em, vigencia_fim_em, liberada_em,
             suspensa_em, suspensao_profissional_id, motivo_suspensao, excluido_em, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, 'medica', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            estab,
            BASE + ++nPresc,
            pac,
            atd,
            prof1,
            ocup ? ocup.id : null,
            o.situacao ?? (o.suspensa ? 'suspensa' : 'vigente'),
            prescrito,
            prescrito,
            new Date(prescrito.getTime() + 24 * HORA),
            o.liberada === undefined ? prescrito : o.liberada,
            o.suspensa ? suspensaEm : null,
            o.suspensa ? prof2 : null,
            o.suspensa ? 'Troca de conduta (sintético)' : null,
            o.excluida ? agora : null,
            prescrito,
          ],
        );
      const p1 = await prescricao(estA, atdInt, liberada);
      const p2 = await prescricao(estA, atdInt, em(-10 * HORA), { suspensa: true });
      const p3 = await prescricao(estA, atdInt, em(-5 * HORA), { excluida: true });
      const p4 = await prescricao(estB, atdB, em(-5 * HORA));
      // Rascunho ainda não liberado (não aparece para ninguém) e cancelada com o evento de cancelamento.
      const p5 = await prescricao(estA, atdInt, em(-1 * HORA), { situacao: 'rascunho', liberada: null });
      const p6 = await prescricao(estA, atdInt, em(-3 * HORA), { situacao: 'cancelada' });
      const canceladaEm = em(-150 * 60_000);
      await e.inserir(
        `INSERT INTO prescricao_evento (prescricao_id, operacao, evento, situacao_anterior, situacao_nova, motivo,
           profissional_id, ocorrido_em, usuario_id, criado_em)
         VALUES (?, 'alteracao', 'cancelamento', 'vigente', 'cancelada', 'Paciente errado (sintético)', ?, ?, ?, ?)`,
        [p6, prof2, canceladaEm, usuario, agora],
      );
      // Peso e altura aferidos (o mais recente vale) para os dados clínicos do cálculo de dose.
      const parametro = async (codigo: string) =>
        num((await e.uma<{ id: unknown }>('SELECT id FROM parametro_vital WHERE codigo = ?', [codigo]))?.id);
      const afericao = async (quando: Date, codigo: string, valor: number) => {
        const a = await e.inserir(
          'INSERT INTO afericao (estabelecimento_id, paciente_id, atendimento_id, aferido_em, criado_em) VALUES (?, ?, ?, ?, ?)',
          [estA, pac, atdInt, quando, agora],
        );
        await e.inserir(
          `INSERT INTO afericao_valor (afericao_id, sequencia, parametro_vital_id, valor_numerico, criado_em)
           VALUES (?, 1, ?, ?, ?)`,
          [a, await parametro(codigo), valor, agora],
        );
      };
      await afericao(em(-30 * HORA), 'peso', 70.5);
      await afericao(em(-6 * HORA), 'peso', 72);
      await afericao(em(-6 * HORA), 'altura', 170);
      const item = (prescricaoId: number, seq: number, tipo: number, o: Record<string, unknown> = {}) =>
        e.inserir(
          `INSERT INTO prescricao_item (prescricao_id, sequencia, tipo_item_prescricao_id, item_prescritivel_id,
             frequencia_administracao_id, via_de_uso_id, inicio_em, situacao, suspenso_em,
             lancamento_profissional_id, observacao_enfermagem, excluido_em, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            prescricaoId,
            seq,
            tipo,
            o['produto'] ?? null,
            o['freq'] ?? null,
            o['via'] ?? null,
            liberada,
            o['situacao'] ?? 'ativo',
            o['suspensoEm'] ?? null,
            prof1,
            o['obs'] ?? null,
            o['excluido'] ? agora : null,
            o['criado'] ?? liberada,
          ],
        );
      const i1 = await item(p1, 1, tipoMed, { produto, freq, via, obs: 'Correr em 30 min' });
      const i2 = await item(p1, 2, tipoCuidado, {
        situacao: 'suspenso_correcao',
        suspensoEm: em(-3 * HORA),
        criado: em(-4 * HORA),
      });
      await item(p1, 3, tipoCuidado, { excluido: true });
      await item(p2, 1, tipoCuidado);
      // Suspenso e cancelado pela situação do item, sem horários.
      const i4 = await item(p2, 2, tipoCuidado, { situacao: 'suspenso', suspensoEm: em(-3 * HORA) });
      const i5 = await item(p2, 3, tipoCuidado, { situacao: 'cancelado' });
      const med = await e.inserir(
        `INSERT INTO prescricao_item_medicamento (prescricao_item_id, item_prescritivel_id, dose, unidade_prescricao_id,
           iniciar_agora, criado_em) VALUES (?, ?, 500, ?, TRUE, ?)`,
        [i1, produto, unidade, agora],
      );
      const horario = (it: number, previsto: Date, sit: number, suspenso = false) =>
        e.inserir(
          `INSERT INTO horario_administracao (estabelecimento_id, atendimento_id, prescricao_id, prescricao_item_id,
             previsto_em, situacao_checagem_id, suspenso, suspenso_em, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [estA, atdInt, p1, it, previsto, sit, suspenso, suspenso ? em(-3 * HORA) : null, agora],
        );
      const h1 = await horario(i1, em(-19 * HORA), sitAdm);
      const h2 = await horario(i1, em(2 * HORA), sitPend);
      const h3 = await horario(i1, em(8 * HORA), sitPend, true);
      const decisao = (seq: number, decisao: string) =>
        e.inserir(
          `INSERT INTO decisao_alerta (prescricao_item_id, sequencia, regra_alerta_id, processo, mensagem, disparado_em,
             decisao, justificativa, decidido_em, decidido_por_profissional_id, criado_em)
           VALUES (?, ?, 33, 'interacao', 'Alerta sintético', ?, ?, ?, ?, ?, ?)`,
          [
            i1,
            seq,
            liberada,
            decisao,
            decisao === 'pendente' ? null : 'Benefício maior (sintético)',
            decisao === 'pendente' ? null : liberada,
            decisao === 'pendente' ? null : prof1,
            agora,
          ],
        );
      await decisao(1, 'justificou');
      await decisao(2, 'pendente');
      return {
        agora,
        pac,
        atdInt,
        atdPa,
        atdB,
        cbo: ocup ? Number(String(ocup.codigo_cbo)) : 0,
        p1,
        p2,
        p3,
        p4,
        i1,
        i2,
        med,
        tipoCuidado,
        freq,
        h1,
        h2,
        h3,
        liberada,
        suspensaEm,
        p5,
        p6,
        i4,
        i5,
        canceladaEm,
        cboOcup: ocup ? String(ocup.codigo_cbo).trim() : '',
      };
    } finally {
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    }
  });
}

describe.skipIf(SEM_BANCO)('PortaPrescricaoPropria contra o MariaDB (cliente f22_o4)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaPrescricaoPropria;
  let m: Massa;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE_F22_O4)).banco).toBe(`cliente_${CLIENTE_F22_O4}`);
    m = await montar(nucleo);
    porta = new PortaPrescricaoPropria(nucleo, CLIENTE_F22_O4);
  }, 120_000);
  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE_F22_O4, correlacao: `limpeza-${P}` }, (e) => limpar(e));
      await nucleo.encerrar();
    }
  });

  it('lista do atendimento: só as do estabelecimento e não excluídas, mais recente primeiro, com o cabeçalho', async () => {
    const r = await porta.prescricoes(ctx(P), m.atdInt);
    // O rascunho (p5) fica fora; a cancelada (p6) aparece encerrada.
    expect(r.map((x) => x.id)).toEqual([m.p6, m.p2, m.p1]);
    const [p6, p2, p1] = r;
    expect(p6).toMatchObject({
      suspensaoEm: dataHora(m.canceladaEm, FUSO),
      suspensaoPor: `${P} Suspensor sintético`,
      suspensaoJustificativa: 'Prescrição cancelada: Paciente errado (sintético)',
    });
    expect(p1).toEqual({
      id: m.p1,
      atendimento: m.atdInt,
      htPaciente: m.pac,
      htAtendimento: m.atdInt,
      dataHora: dataHora(m.liberada, FUSO),
      inicio: dataHora(m.liberada, FUSO),
      fim: dataHora(new Date(m.liberada.getTime() + 24 * HORA), FUSO),
      cbo: m.cbo,
      prescritor: `${P}med`,
      suspensaoEm: null,
      suspensaoPor: null,
      suspensaoJustificativa: null,
      gravacao: dataHora(m.liberada, FUSO),
      itens: 2,
    });
    // O suspensor sem conta de usuário aparece pelo nome de exibição.
    expect(p2).toMatchObject({
      suspensaoEm: dataHora(m.suspensaEm, FUSO),
      suspensaoPor: `${P} Suspensor sintético`,
      suspensaoJustificativa: 'Troca de conduta (sintético)',
      itens: 3,
    });
    expect(await porta.prescricoes(ctx(`${P}b`), m.atdB)).toHaveLength(1);
    expect(await porta.prescricoes(ctx(`${P}b`), m.atdInt)).toEqual([]);
  });

  it('cabeçalho: a de outro estabelecimento e a excluída não abrem', async () => {
    expect((await porta.cabecalho(ctx(P), m.p1))?.id).toBe(m.p1);
    expect(await porta.cabecalho(ctx(P), m.p3)).toBeNull();
    expect(await porta.cabecalho(ctx(P), m.p4)).toBeNull();
    expect(await porta.cabecalho(ctx(P), m.p5)).toBeNull();
    expect(await porta.itens(ctx(P), m.p5)).toEqual([]);
    expect((await porta.marcas(ctx(P), [m.p5, m.p6])).has(m.p5)).toBe(false);
  });

  it('itens: medicamento com dose, via e frequência; adendo e correção; horários pela checagem; sem excluídos', async () => {
    const itens = await porta.itens(ctx(P), m.p1);
    expect(itens.map((i) => i.id)).toEqual([m.i1, m.i2]);
    expect(itens[0]).toMatchObject({
      prescricao: m.p1,
      plano: 6,
      planoNome: 'Medicamento sintético',
      numDoses: 4,
      frequencia: m.freq,
      frequenciaNome: '6 em 6 horas',
      via: 'EV',
      observacaoEnfermagem: 'Correr em 30 min',
      cboLancamento: m.cbo,
      incluidoEm: null,
      corrigidoEm: null,
      detalhe: {
        tipo: 'medicamento',
        id: m.med,
        produtoNome: 'Produto sintético',
        dose: 500,
        unidade: 'mg',
        agora: true,
        principios: [77],
      },
    });
    expect(itens[0]!.horarios.map((h) => [h.id, h.situacao])).toEqual([
      [m.h1, `${P}a`],
      [m.h2, 'P'],
      [m.h3, 'S'],
    ]);
    expect(itens[0]!.horarios[1]!.dataHora).toBe(dataHora(new Date(m.agora.getTime() + 2 * HORA), FUSO));
    expect(itens[1]).toMatchObject({
      plano: BASE_PLANO_PROPRIO + m.tipoCuidado,
      detalhe: { tipo: 'outro', id: null },
      incluidoEm: dataHora(new Date(m.agora.getTime() - 4 * HORA), FUSO),
      corrigidoEm: dataHora(new Date(m.agora.getTime() - 3 * HORA), FUSO),
      horarios: [],
    });
    expect(await porta.itens(ctx(`${P}b`), m.p1)).toEqual([]);
  });

  it('atendimento, marcas e decisões', async () => {
    expect(await porta.atendimento(ctx(P), m.atdInt)).toEqual({
      id: m.atdInt,
      numero: expect.any(Number),
      paciente: m.pac,
      tipo: 'I',
      aberto: true,
      bloco: null,
      unidade: 55,
      convenio: 77,
    });
    expect((await porta.atendimento(ctx(P), m.atdPa))?.tipo).toBe('E');
    expect(await porta.atendimento(ctx(P), m.atdB)).toBeNull();
    const marcas = await porta.marcas(ctx(P), [m.p1, m.p4]);
    expect([...marcas.keys()]).toEqual([m.p1]);
    expect(marcas.get(m.p1)).toEqual({ feitaNoNovo: true, coassinaturaPendente: false });
    expect(await porta.decisoes(ctx(P), m.p1)).toEqual([
      {
        item: m.i1,
        chave: String(m.i1),
        tipo: 'interacao',
        decisao: 'mantido',
        justificativa: 'Benefício maior (sintético)',
        regra: '33',
        versao: expect.any(Number),
      },
    ]);
    expect(await porta.decisoes(ctx(`${P}b`), m.p1)).toEqual([]);
  });

  it('recusa: estabelecimento inexistente (404); gravação desligada', async () => {
    await expect(porta.prescricoes(ctx('l2403zz'), m.atdInt)).rejects.toMatchObject({
      problema: { status: 404 },
    });
    expect((await porta.podeGravar(ctx(P), 'pep.prescrever', `${P}.inexistente`)).pode).toBe(false);
  });

  it('item suspenso e item cancelado pela situação, sem horários: a porta marca e o domínio lê suspenso', async () => {
    const itens = await porta.itens(ctx(P), m.p2);
    expect(itens.filter((i) => i.suspenso).map((i) => i.id)).toEqual([m.i4, m.i5]);
    expect(itens.find((i) => i.id === m.i4)?.horarios).toEqual([]);
  });

  it('prescritor pelo vínculo do login e dados clínicos pela aferição mais recente', async () => {
    expect(await porta.prescritores(ctx(P), `${P}med`)).toEqual(
      m.cboOcup ? [{ cbo: Number(m.cboOcup), ocupacao: m.cboOcup, nome: `${P} Prescritor sintético` }] : [],
    );
    expect(await porta.prescritores(ctx(P), `${P}ninguem`)).toEqual([]);
    expect(await porta.dadosClinicos(ctx(P), m.pac)).toMatchObject({
      pesoKg: 72,
      alturaCm: 170,
      dataPeso: dataHora(new Date(m.agora.getTime() - 6 * HORA), FUSO)!.slice(0, 10),
      creatinina: null,
    });
    expect((await porta.dadosClinicos(ctx(`${P}b`), m.pac)).pesoKg).toBeNull();
  });

  it('serviço sobre a porta própria: o contexto abre, a lista e a leitura seguem a situação gravada', async () => {
    const servico = new ServicoPrescricao(porta);
    const agora = await porta.agora(ctx(P));
    const contexto = await servico.contexto(ctx(P), m.pac, `${P}med`, agora);
    expect(contexto.dadosClinicos).toMatchObject({ pesoKg: 72, alturaCm: 170 });
    expect(contexto.prescritor === null).toBe(m.cboOcup === '');
    const lista = await servico.prescricoes(ctx(P), m.pac, m.atdInt);
    expect(lista.map((x) => [x.id, x.situacao])).toEqual([
      [m.p6, 'suspensa'],
      [m.p2, 'suspensa'],
      [m.p1, 'vigente'],
    ]);
    const lida = await servico.lerPrescricao(ctx(P), m.pac, m.p2);
    expect(lida.itensLidos.map((i) => i.situacao)).toEqual(['ativo', 'suspenso', 'suspenso']);
    expect(lida.prova).toBe('sem-prova');
    const p1 = await servico.lerPrescricao(ctx(P), m.pac, m.p1);
    expect(p1.alertasDecididos).toEqual([
      { item: m.i1, tipo: 'interacao', decisao: 'mantido', justificativa: 'Benefício maior (sintético)' },
    ]);
    await expect(servico.lerPrescricao(ctx(P), m.pac, m.p5)).rejects.toMatchObject({
      tipo: 'nao-encontrado',
    });
  });
});
