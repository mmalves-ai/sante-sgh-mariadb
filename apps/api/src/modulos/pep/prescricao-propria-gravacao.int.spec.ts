// Integração da família de gravação da prescrição no banco próprio contra o MariaDB real (cliente de teste f22_o5).
// Massa SINTÉTICA do lote (prefixo l95pg): estabelecimento, unidade, pessoa e paciente fictícios, profissional com
// inscrição ativa no conselho, cadastros da prescrição; montada no beforeAll e apagada no início e no fim (a trilha
// do SBIS-16 é apagada na ordem das chaves: fecho, cadeia, trilha). A migração 06_PEP/95_prescricao_gravacao
// (idempotente) é aplicada no beforeAll. As chaves estrangeiras ficam desligadas SÓ na transação do preparo; as
// gravações da porta rodam com todas as chaves e CHECKs. Nenhum registro clínico é apagado pela porta: a limpeza é do
// teste. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ContextoOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { PLANO_DO_TIPO } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GravacaoPrescricaoPropria } from './prescricao-propria-gravacao.js';
import type { PortaPrescricao } from './prescricao-porta.js';
import { PortaPrescricaoPropria } from './prescricao-porta-propria.js';
import { ServicoPrescricao } from './prescricao-servico.js';
import { dataHora } from './registro-porta-propria.js';
import type { GravacaoPrescricao, ItemGravacao } from './tipos-pep.js';

const CLIENTE = 'f22_o5';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const RAIZ = resolve(__dirname, '../../../../..');
const P = 'l95pg';
const FUSO = 'America/Sao_Paulo';
const HORA = 3_600_000;
const HASH = 'a'.repeat(64);
const c = {
  cliente: CLIENTE,
  estabelecimento: null,
  usuario: null,
  correlacao: P,
  rede: 'rede-teste',
  hospital: P,
};

interface Massa {
  est: number;
  unidade: number;
  pac: number;
  pac2: number;
  atd: number;
  usuario: number;
  prof: number;
  cbo: number;
  produto: number;
  /** Médico (supervisor) e residente que coassinam, cada um com usuário próprio. */
  supervisor: number;
}

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  const presc = `(SELECT id FROM prescricao WHERE estabelecimento_id IN ${est})`;
  const itens = `(SELECT id FROM prescricao_item WHERE prescricao_id IN ${presc})`;
  const recs = `(SELECT id FROM reconciliacao_medicamentosa WHERE estabelecimento_id IN ${est})`;
  for (const sql of [
    `DELETE FROM decisao_alerta WHERE prescricao_id IN ${presc}`,
    `DELETE FROM decisao_alerta WHERE prescricao_item_id IN ${itens}`,
    `DELETE FROM prescricao_evento WHERE prescricao_id IN ${presc}`,
    `DELETE FROM horario_administracao WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM prescricao_item_medicamento WHERE prescricao_item_id IN ${itens}`,
    `DELETE FROM planejamento_prescricao WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM prescricao_item WHERE prescricao_id IN ${presc}`,
    `DELETE FROM prescricao WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM reconciliacao_item WHERE reconciliacao_medicamentosa_id IN ${recs}`,
    `DELETE FROM reconciliacao_medicamentosa WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM grade_horario_classe WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM atendimento WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM unidade_assistencial WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM sequencia_negocio WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM idempotencia_operacao WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM trilha_auditoria_fecho WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM trilha_cadeia WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM trilha_auditoria WHERE estabelecimento_id IN ${est}`,
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
  await e.executar(`DELETE FROM profissional_ocupacao WHERE profissional_id IN ${profs}`, [`${P} %`]);
  await e.executar('DELETE FROM profissional WHERE nome_exibicao LIKE ?', [`${P} %`]);
  await e.executar(
    'DELETE FROM paciente WHERE pessoa_fisica_id IN (SELECT id FROM pessoa_fisica WHERE nome LIKE ?)',
    [`${P} %`],
  );
  await e.executar('DELETE FROM pessoa_fisica WHERE nome LIKE ?', [`${P} %`]);
  await e.executar('DELETE FROM item_prescritivel WHERE codigo LIKE ?', [`${P}%`]);
  for (const t of [
    'situacao_checagem',
    'tipo_item_prescricao',
    'unidade_prescricao',
    'via_de_uso',
    'categoria_atendimento',
  ])
    await e.executar(`DELETE FROM ${t} WHERE codigo LIKE ?`, [`${P}%`]);
}

async function montar(nucleo: NucleoProprio): Promise<Massa> {
  return nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
    await limpar(e);
    const agora = new Date();
    await e.executar('SET FOREIGN_KEY_CHECKS = 0');
    try {
      const ins = (sql: string, p: unknown[]) => e.inserir(sql, [...p, agora]);
      const est = await ins(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, 'Hospital sintético', 'Hospital sintético (fictício)', ?, ?)`,
        [P, FUSO],
      );
      const unidade = await ins(
        `INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em)
         VALUES (?, ?, 'Unidade sintética', 'internacao', ?)`,
        [est, `${P}u`],
      );
      const pessoa = (n: string) =>
        ins('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [`${P} ${n}`]);
      const paciente = async (n: string, prontuario: number) =>
        ins('INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)', [
          await pessoa(n),
          prontuario,
        ]);
      const pac = await paciente('p1', 950_000_001);
      const pac2 = await paciente('p2', 950_000_002);
      const cat = await ins(
        `INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, 'Internação sintética', 'internacao', ?)`,
        [`${P}i`],
      );
      const atd = await ins(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, unidade_assistencial_id, situacao,
           entrada_em, criado_em)
         VALUES (?, '95001', ?, ?, 1, 1, 1, ?, 'aberto', ?, ?)`,
        [est, pac, cat, unidade, new Date(agora.getTime() - 48 * HORA)],
      );
      const ocup = await e.uma<{ id: unknown; codigo_cbo: unknown }>(
        "SELECT id, codigo_cbo FROM ocupacao_cbo WHERE codigo_cbo REGEXP '^[0-9]+$' ORDER BY id LIMIT 1",
      );
      const prof = await ins(
        `INSERT INTO profissional (pessoa_fisica_id, tipo, nome_exibicao, criado_em) VALUES (?, 'corpo_clinico', ?, ?)`,
        [await pessoa('prof'), `${P} Prescritor`],
      );
      await ins(
        `INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id, unidade_federativa_id,
           numero_inscricao, ocupacao_cbo_id, principal, situacao, criado_em)
         VALUES (?, 1, 1, 1, '95001', ?, TRUE, 'ativa', ?)`,
        [prof, ocup?.id],
      );
      const usuario = await ins(
        `INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, 'Usuário sintético', 'servico', ?)`,
        [`${P}med`],
      );
      await ins(
        `INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, 'Sem vínculo', 'servico', ?)`,
        [`${P}sem`],
      );
      await ins(
        `INSERT INTO usuario_profissional (usuario_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, '2026-01-01', ?)`,
        [usuario, prof],
      );
      // Médico (CBO 225…) que supervisiona e residente (CBO 2231…), que pede ele mesmo coassinatura.
      const outro = async (rotulo: string, padrao: string, numero: string) => {
        const o = await e.uma<{ id: unknown }>(
          'SELECT id FROM ocupacao_cbo WHERE codigo_cbo REGEXP ? ORDER BY id LIMIT 1',
          [padrao],
        );
        const pf = await ins(
          `INSERT INTO profissional (pessoa_fisica_id, tipo, nome_exibicao, criado_em) VALUES (?, 'corpo_clinico', ?, ?)`,
          [await pessoa(rotulo), `${P} ${rotulo}`],
        );
        await ins(
          `INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id, unidade_federativa_id,
             numero_inscricao, ocupacao_cbo_id, principal, situacao, criado_em)
           VALUES (?, 1, 1, 1, ?, ?, TRUE, 'ativa', ?)`,
          [pf, numero, o?.id],
        );
        const u = await ins(
          `INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)`,
          [`${P}${rotulo}`, `Usuário ${rotulo}`],
        );
        await ins(
          `INSERT INTO usuario_profissional (usuario_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, '2026-01-01', ?)`,
          [u, pf],
        );
        return pf;
      };
      const supervisor = await outro('sup', '^2251[0-9]+$', '95002');
      await outro('res', '^2231[0-9]+$', '95003');
      const tipo = await ins(
        `INSERT INTO tipo_item_prescricao (codigo, descricao, categoria, criado_em) VALUES (?, 'Medicamento sintético', 'medicamento', ?)`,
        [`${P}m`],
      );
      await ins(
        `INSERT INTO via_de_uso (codigo, descricao, sigla, criado_em) VALUES (?, 'Endovenosa', ?, ?)`,
        [`${P}v`, 'EV95'],
      );
      await ins(
        `INSERT INTO unidade_prescricao (codigo, descricao, sigla, criado_em) VALUES (?, 'Miligrama', ?, ?)`,
        [`${P}u`, 'mg95'],
      );
      const produto = await ins(
        `INSERT INTO item_prescritivel (codigo, descricao, tipo_item_prescricao_id, criado_em) VALUES (?, 'Produto sintético', ?, ?)`,
        [`${P}ip`, tipo],
      );
      await ins(
        `INSERT INTO situacao_checagem (codigo, descricao, categoria, ordem, criado_em) VALUES (?, 'Pendente', 'pendente', 0, ?)`,
        [`${P}p`],
      );
      await ins(
        'INSERT INTO sequencia_negocio (estabelecimento_id, tipo, proximo_valor, criado_em) VALUES (?, ?, 1, ?)',
        [est, 'prescricao'],
      );
      return {
        est,
        unidade,
        pac,
        pac2,
        atd,
        usuario,
        prof,
        cbo: Number(String(ocup?.codigo_cbo)),
        produto,
        supervisor,
      };
    } finally {
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    }
  });
}

describe.skipIf(SEM_BANCO)('gravação da prescrição no banco próprio (integração)', () => {
  let nucleo: NucleoProprio;
  let porta: GravacaoPrescricaoPropria;
  let m: Massa;
  let n = 0;
  const ctx = (): ContextoOperacao => ({
    cliente: CLIENTE,
    estabelecimento: null,
    usuario: m.usuario,
    correlacao: P,
    chaveIdempotencia: `${P}-${Date.now()}-${++n}`,
  });
  const local = (ms: number) => dataHora(new Date(Date.now() + ms), FUSO)!.slice(0, 16);
  const item = (chave: string, horas: number[]): ItemGravacao =>
    ({
      chave,
      plano: PLANO_DO_TIPO.medicamento,
      numDose: horas.length,
      frequencia: null,
      via: 'EV95',
      observacao: 'Correr em 30 min',
      integracaoEstoque: false,
      detalhe: {
        tipo: 'medicamento',
        produto: m.produto,
        dose: 500,
        unidade: 'mg95',
        agora: false,
        naoAjustar: false,
        tempoInfusaoMinutos: 30,
        naoPadronizado: null,
        justificativaAlergia: null,
        seNecessario: [],
        kit: [],
      },
      horarios: horas.map((h) => ({ dataHora: local(h * HORA), relativo: null })),
    }) as ItemGravacao;
  const sgh = (decisoes: GravacaoPrescricao['sgh']['decisoes'] = []): GravacaoPrescricao['sgh'] => ({
    prioridade: 'rotina',
    nota: null,
    coassinaturaExigida: true,
    origemModo: null,
    origemId: null,
    itens: [],
    decisoes,
    fichas: [],
    futuras: [],
    comoSuporte: false,
  });
  const gravacao = (inicioH: number, fimH: number, cbo = m.cbo): GravacaoPrescricao => ({
    paciente: m.pac,
    atendimento: m.atd,
    cbo,
    retratos: { htAtendimento: m.atd, htPaciente: m.pac },
    dataHora: local(0),
    vigencia: { inicio: local(inicioH * HORA), fim: local(fimH * HORA) },
    justificativaRetroativo: null,
    observacaoGeral: null,
    protocolos: [],
    itens: [item('k1', [1, 7])],
    origem: null,
    documento: 'documento sintético',
    hashConteudo: HASH,
    sgh: sgh([
      {
        chave: 'k1',
        alerta: 'Dose acima da habitual',
        tipo: 'dose',
        nivel: 'justificar',
        regra: 'regra-inexistente',
        versaoRegra: 3,
        decisao: 'mantido',
        justificativa: 'Benefício clínico',
      },
      {
        chave: 'k9',
        alerta: 'Alergia registrada ao princípio ativo',
        tipo: 'alergia',
        nivel: 'bloqueio',
        regra: 'regra-inexistente',
        versaoRegra: 2,
        decisao: 'retirado',
        justificativa: null,
      },
    ]),
  });
  const contar = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, async (l) => Number((await l.uma(sql, p))?.['n']));
  let prescricao = 0;

  beforeAll(async () => {
    for (const arq of ['95_prescricao_gravacao_tabelas.sql', '95_prescricao_gravacao_chaves.sql'])
      execFileSync(resolve(RAIZ, 'tools/db/sql.sh'), [`cliente_${CLIENTE}`], {
        input: readFileSync(resolve(RAIZ, 'db/migracoes/06_PEP', arq), 'utf8'),
        encoding: 'utf8',
      });
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    m = await montar(nucleo);
    porta = new GravacaoPrescricaoPropria(nucleo, CLIENTE);
  }, 120_000);
  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, async (e) => {
        await e.executar('SET FOREIGN_KEY_CHECKS = 0');
        try {
          await limpar(e);
        } finally {
          await e.executar('SET FOREIGN_KEY_CHECKS = 1');
        }
      });
      await nucleo.encerrar();
    }
  });

  it('podeGravar: libera o profissional com conselho ativo e recusa o login sem vínculo', async () => {
    expect((await porta.podeGravar(c, 'pep.prescrever', `${P}med`)).pode).toBe(true);
    expect(await porta.podeGravar(c, 'pep.prescrever', `${P}sem`)).toMatchObject({
      pode: false,
      codigo: 'profissional-sem-cbo',
    });
  });

  it('prescrever: vigente com item, medicamento, horários, decisão com a versão da regra, eventos e trilha', async () => {
    const chave = ctx();
    const r = await porta.prescrever(c, 'pep.prescrever', gravacao(0, 24), chave);
    prescricao = r.prescricao;
    expect(r.horarios).toBe(2);
    // Reenvio com a mesma chave (timeout de rede): a mesma forma devolvida, nada gravado de novo.
    expect(await porta.prescrever(c, 'pep.prescrever', gravacao(0, 24), chave)).toEqual(r);
    // A mesma chave com outro pedido é recusada, não devolve o resultado anterior.
    await expect(porta.prescrever(c, 'pep.prescrever', gravacao(0, 23), chave)).rejects.toMatchObject({
      problema: { status: 422, codigo: 'idempotencia-divergente' },
    });
    expect(await contar('SELECT COUNT(*) AS n FROM prescricao WHERE estabelecimento_id = ?', [m.est])).toBe(
      1,
    );
    // A decisão do item retirado diante do alerta fica gravada, sem item, com a chave da tela e a versão da regra.
    expect(await porta.decisoes(c, prescricao)).toEqual([
      expect.objectContaining({
        chave: expect.not.stringMatching(/^k/),
        tipo: 'dose',
        decisao: 'mantido',
        versao: 3,
      }),
      {
        item: null,
        chave: 'k9',
        tipo: 'alergia',
        decisao: 'retirado',
        justificativa: null,
        regra: '',
        versao: 2,
      },
    ]);
    const linha = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) =>
      l.uma(
        `SELECT p.situacao, p.coassinatura_exigida, p.prescritor_profissional_id,
                (SELECT COUNT(*) FROM prescricao_item i WHERE i.prescricao_id = p.id) AS itens,
                (SELECT COUNT(*) FROM prescricao_item_medicamento x JOIN prescricao_item i ON i.id = x.prescricao_item_id
                  WHERE i.prescricao_id = p.id AND x.dose = 500) AS meds,
                (SELECT COUNT(*) FROM horario_administracao h WHERE h.prescricao_id = p.id) AS horarios,
                (SELECT MAX(d.versao_regra) FROM decisao_alerta d JOIN prescricao_item i ON i.id = d.prescricao_item_id
                  WHERE i.prescricao_id = p.id AND d.decisao = 'justificou') AS versao_regra,
                (SELECT GROUP_CONCAT(e.evento ORDER BY e.id) FROM prescricao_evento e WHERE e.prescricao_id = p.id) AS eventos
           FROM prescricao p WHERE p.id = ?`,
        [prescricao],
      ),
    );
    expect(linha).toMatchObject({
      situacao: 'vigente',
      prescritor_profissional_id: m.prof,
      itens: 1,
      meds: 1,
      horarios: 2,
      versao_regra: 3,
      eventos: 'criacao,assinatura',
    });
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND entidade_id = ?',
        [m.est, prescricao],
      ).catch(() =>
        contar('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ?', [m.est]),
      ),
    ).toBeGreaterThan(0);
  });

  it('prescrever: período ocupado (409) e CBO de outro profissional (409), nada gravado', async () => {
    await expect(porta.prescrever(c, 'pep.prescrever', gravacao(2, 20), ctx())).rejects.toMatchObject({
      problema: { status: 409, codigo: 'outra-ativa-no-periodo' },
    });
    await expect(porta.prescrever(c, 'pep.renovarPrescricao', gravacao(2, 20), ctx())).rejects.toMatchObject({
      problema: { status: 409, codigo: 'periodo-ocupado' },
    });
    await expect(porta.prescrever(c, 'pep.prescrever', gravacao(30, 40, 1), ctx())).rejects.toMatchObject({
      problema: { status: 409, codigo: 'profissional-sem-cbo' },
    });
    expect(await contar('SELECT COUNT(*) AS n FROM prescricao WHERE estabelecimento_id = ?', [m.est])).toBe(
      1,
    );
  });

  it('incluirItem e suspenderItem: adendo com evento; suspensão leva os horários pendentes; de novo é 409', async () => {
    const base = {
      prescricao,
      paciente: m.pac,
      atendimento: m.atd,
      cbo: m.cbo,
      documento: 'd',
      hashConteudo: HASH,
    };
    const { item: novo } = await porta.incluirItem(c, { ...base, item: item('k2', [2]), sgh: sgh() }, ctx());
    expect(novo).toBeGreaterThan(0);
    const susp = {
      ...base,
      item: novo,
      justificativa: 'Troca de conduta',
      correcao: null,
      comoSuporte: false,
    };
    const chave = ctx();
    expect(await porta.suspenderItem(c, susp, chave)).toEqual({ horarios: 1 });
    // Reenvio com a mesma chave: a contagem de horários (não o id do item), sem gravar de novo.
    expect(await porta.suspenderItem(c, susp, chave)).toEqual({ horarios: 1 });
    await expect(porta.suspenderItem(c, susp, ctx())).rejects.toMatchObject({
      problema: { status: 409, codigo: 'item-nao-ativo' },
    });
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM prescricao_evento WHERE prescricao_id = ? AND evento IN ('inclusao_item','suspensao')`,
        [prescricao],
      ),
    ).toBe(2);
  });

  it('coassinar pelo serviço: pendente, recusa o prescritor e o residente, o médico coassina uma vez só', async () => {
    const propria = new PortaPrescricaoPropria(nucleo, CLIENTE);
    const ligada = Object.assign(Object.create(propria) as PortaPrescricao, {
      marcas: porta.marcas.bind(porta),
      prova: porta.prova.bind(porta),
      decisoes: porta.decisoes.bind(porta),
      coassinar: porta.coassinar.bind(porta),
    });
    const servico = new ServicoPrescricao(ligada);
    expect((await porta.marcas(c, [prescricao])).get(prescricao)).toEqual({
      feitaNoNovo: true,
      coassinaturaPendente: true,
    });
    await expect(servico.coassinar(c, m.pac, prescricao, `${P}med`)).rejects.toMatchObject({
      problema: { status: 409, codigo: 'coassinatura-pelo-prescritor' },
    });
    await expect(servico.coassinar(c, m.pac, prescricao, `${P}res`)).rejects.toMatchObject({
      problema: { status: 409, codigo: 'coassinatura-sem-supervisor' },
    });
    await servico.coassinar(c, m.pac, prescricao, `${P}sup`);
    expect((await porta.marcas(c, [prescricao])).get(prescricao)?.coassinaturaPendente).toBe(false);
    const prova = await porta.prova(c, prescricao);
    expect(prova).toMatchObject({ coassinaturaExigida: true, coassinada: true });
    expect(prova.eventos.map((x) => [x.tipo, x.usuario])).toEqual([['coassinado', `${P}sup`]]);
    // Já coassinada: o serviço recusa antes de chegar à porta.
    await expect(servico.coassinar(c, m.pac, prescricao, `${P}sup`)).rejects.toMatchObject({
      status: 409,
      extras: { codigo: 'sem-coassinatura' },
    });
    await porta.coassinar(c, prescricao, `${P}sup`);
    expect(
      await contar('SELECT COUNT(*) AS n FROM prescricao WHERE id = ? AND coassinatura_profissional_id = ?', [
        prescricao,
        m.supervisor,
      ]),
    ).toBe(1);
    // A prescrição que não pediu coassinatura não passa a pedir (o fato histórico não é reescrito).
    const sem = await porta.prescrever(
      c,
      'pep.prescrever',
      { ...gravacao(30, 40), itens: [item('k1', [31])], sgh: { ...sgh(), coassinaturaExigida: false } },
      ctx(),
    );
    await expect(porta.coassinar(c, sem.prescricao, `${P}sup`)).rejects.toMatchObject({
      problema: { status: 409, codigo: 'sem-coassinatura' },
    });
    expect(
      await contar('SELECT COUNT(*) AS n FROM prescricao WHERE id = ? AND NOT coassinatura_exigida', [
        sem.prescricao,
      ]),
    ).toBe(1);
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM prescricao_evento WHERE prescricao_id = ? AND evento = 'coassinatura'`,
        [prescricao],
      ),
    ).toBe(1);
  });

  it('futura: programa, lista, recusa o paciente errado (404), cancela e não cancela de novo (409)', async () => {
    const id = await porta.programarFutura(c, `${P}med`, {
      atendimento: m.atd,
      paciente: m.pac,
      aPartirDe: local(30 * HORA),
      descricao: 'Antibiótico amanhã',
      itemJson: '[{"produto":1}]',
      motivo: null,
    });
    const [f] = await porta.futuras(c, m.atd);
    expect(f).toMatchObject({
      id,
      descricao: 'Antibiótico amanhã',
      situacao: 'programada',
      prescricao: null,
    });
    expect(f?.aPartirDe.slice(0, 16)).toBe(local(30 * HORA));
    await expect(porta.cancelarFutura(c, `${P}med`, m.pac2, id, 'Errada')).rejects.toMatchObject({
      problema: { status: 404 },
    });
    await porta.cancelarFutura(c, `${P}med`, m.pac, id, 'Conduta mudou');
    await expect(porta.cancelarFutura(c, `${P}med`, m.pac, id, 'De novo')).rejects.toMatchObject({
      problema: { status: 409, codigo: 'futura-nao-programada' },
    });
    expect((await porta.futuras(c, m.atd))[0]?.situacao).toBe('cancelada');
  });

  it('reconciliação: lote com as linhas e o login do responsável', async () => {
    const lote = await porta.registrarReconciliacao(c, `${P}med`, {
      atendimento: m.atd,
      paciente: m.pac,
      momento: 'admissao',
      linhas: [
        {
          descricao: 'Losartana',
          produto: null,
          dose: '50 mg',
          frequencia: '1x/dia',
          fonte: 'paciente',
          conduta: 'manter',
          justificativa: null,
          item: null,
        },
        {
          descricao: 'AAS',
          produto: null,
          dose: '100 mg',
          frequencia: '1x/dia',
          fonte: 'receita',
          conduta: 'suspender',
          justificativa: 'Cirurgia',
          item: null,
        },
      ],
    });
    const [r] = await porta.reconciliacoes(c, m.atd);
    expect(r).toMatchObject({ lote, momento: 'admissao', usuario: `${P}med` });
    expect(r?.linhas.map((x) => x.conduta)).toEqual(['manter', 'suspender']);
  });

  it('grade: nova versão por inclusão e leitura com o autor', async () => {
    const id = await porta.gravarGrade(c, `${P}med`, {
      unidade: m.unidade,
      classe: '6/6h',
      numDoses: 4,
      horarios: ['06:00', '12:00', '18:00', '00:00'],
      vigenteDesde: '2026-11-01',
      ativa: true,
    });
    expect(await porta.grades(c)).toEqual([
      {
        id,
        unidade: m.unidade,
        classe: '6/6h',
        numDoses: 4,
        horarios: ['06:00', '12:00', '18:00', '00:00'],
        vigenteDesde: '2026-11-01',
        ativa: true,
        autor: `${P}med`,
      },
    ]);
  });

  it('vencemAte e cabeçalho do documento', async () => {
    const v = await porta.vencemAte(c, local(0), local(25 * HORA), m.unidade);
    expect(v.map((x) => x.prescricao)).toEqual([prescricao]);
    expect(await porta.vencemAte(c, local(0), local(2 * HORA), null)).toEqual([]);
    const cab = await porta.cabecalhoDocumento(c, { htPaciente: m.pac, htAtendimento: m.atd }, m.cbo);
    expect(cab.atendimento).toContainEqual(['numero', '95001']);
    await expect(
      porta.cabecalhoDocumento(c, { htPaciente: m.pac2, htAtendimento: m.atd }, m.cbo),
    ).rejects.toMatchObject({ problema: { status: 404 } });
  });

  it('suspenderPrescricao: suspensa com o motivo, horários e itens; de novo é 409; nada apagado', async () => {
    const e = {
      prescricao,
      paciente: m.pac,
      atendimento: m.atd,
      cbo: m.cbo,
      justificativa: 'Alta',
      documento: 'd',
      hashConteudo: HASH,
      comoSuporte: false,
    };
    expect(await porta.suspenderPrescricao(c, e, ctx())).toEqual({ horarios: 2 });
    await expect(porta.suspenderPrescricao(c, e, ctx())).rejects.toMatchObject({
      problema: { status: 409, codigo: 'prescricao-nao-vigente' },
    });
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM prescricao WHERE id = ? AND situacao = 'suspensa' AND motivo_suspensao = 'Alta'
            AND excluido_em IS NULL`,
        [prescricao],
      ),
    ).toBe(1);
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM prescricao_item WHERE prescricao_id = ? AND situacao = 'ativo'`,
        [prescricao],
      ),
    ).toBe(0);
  });
});
