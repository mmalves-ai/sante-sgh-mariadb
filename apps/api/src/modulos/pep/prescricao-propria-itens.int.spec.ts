// Contrato de efeito dos tipos de item da prescrição no banco próprio (03-PEP L105), contra o MariaDB real (cliente de
// teste f22_o5): medicamento com "se necessário", dieta com característica, solução em duas etapas (componentes e a
// velocidade de cada etapa) e ventilação mecânica invasiva, numa prescrição só; a incoerência clínica recusa sem
// gravar nada; procedimento e hemoterapia seguem 501. Massa SINTÉTICA (prefixo l105it), montada no beforeAll e apagada
// no início e no fim (a trilha pelo utilitário comum). Nenhum registro clínico é apagado pela porta: a limpeza é do
// teste. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type ContextoOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { PLANO_DO_TIPO } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GravacaoPrescricaoPropria } from './prescricao-propria-gravacao.js';
import { dataHora } from './registro-porta-propria.js';
import type { GravacaoPrescricao, ItemGravacao } from './tipos-pep.js';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';

const CLIENTE = 'f22_o5';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'l105it';
const FUSO = 'America/Sao_Paulo';
const HORA = 3_600_000;
const c = {
  cliente: CLIENTE,
  estabelecimento: null,
  usuario: null,
  correlacao: P,
  rede: 'rede-teste',
  hospital: P,
};
const CATALOGOS = [
  'situacao_checagem',
  'tipo_item_prescricao',
  'unidade_prescricao',
  'via_de_uso',
  'categoria_atendimento',
  'modalidade_dieta',
  'via_dieta',
  'caracteristica_dieta',
  'tipo_infusao',
  'unidade_infusao',
  'via_aerea',
  'modo_ventilatorio',
  'condicao_se_necessario',
] as const;

interface Massa {
  est: number;
  pac: number;
  atd: number;
  usuario: number;
  cbo: number;
  produto: number;
  soro: number;
  cat: Record<string, number>;
}

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  const presc = `(SELECT id FROM prescricao WHERE estabelecimento_id IN ${est})`;
  const itens = `(SELECT id FROM prescricao_item WHERE prescricao_id IN ${presc})`;
  const sol = `(SELECT id FROM prescricao_item_solucao WHERE prescricao_item_id IN ${itens})`;
  const die = `(SELECT id FROM prescricao_item_dieta WHERE prescricao_item_id IN ${itens})`;
  await limparTrilhaDaMassa(e, { codigos: [P] });
  for (const sql of [
    `DELETE FROM decisao_alerta WHERE prescricao_id IN ${presc}`,
    `DELETE FROM prescricao_evento WHERE prescricao_id IN ${presc}`,
    `DELETE FROM horario_administracao WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM prescricao_item_velocidade WHERE prescricao_item_solucao_id IN ${sol}`,
    `DELETE FROM prescricao_item_solucao_componente WHERE prescricao_item_solucao_id IN ${sol}`,
    `DELETE FROM prescricao_item_solucao WHERE prescricao_item_id IN ${itens}`,
    `DELETE FROM prescricao_item_dieta_caracteristica WHERE prescricao_item_dieta_id IN ${die}`,
    `DELETE FROM prescricao_item_dieta WHERE prescricao_item_id IN ${itens}`,
    `DELETE FROM prescricao_item_ventilacao WHERE prescricao_item_id IN ${itens}`,
    `DELETE FROM prescricao_item_se_necessario WHERE prescricao_item_id IN ${itens}`,
    `DELETE FROM prescricao_item_medicamento WHERE prescricao_item_id IN ${itens}`,
    `DELETE FROM prescricao_item WHERE prescricao_id IN ${presc}`,
    `DELETE FROM prescricao WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM atendimento WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM unidade_assistencial WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM sequencia_negocio WHERE estabelecimento_id IN ${est}`,
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
  await e.executar('DELETE FROM item_prescritivel WHERE codigo LIKE ?', [`${P}%`]);
  for (const t of CATALOGOS) await e.executar(`DELETE FROM ${t} WHERE codigo LIKE ?`, [`${P}%`]);
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
      const pac = await ins(
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [await pessoa('p1'), 951_050_001],
      );
      const catAtd = await ins(
        `INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, 'Internação sintética', 'internacao', ?)`,
        [`${P}i`],
      );
      const atd = await ins(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, unidade_assistencial_id, situacao,
           entrada_em, criado_em)
         VALUES (?, '105001', ?, ?, 1, 1, 1, ?, 'aberto', ?, ?)`,
        [est, pac, catAtd, unidade, new Date(agora.getTime() - 48 * HORA)],
      );
      const ocup = await e.uma<{ id: unknown; codigo_cbo: unknown }>(
        "SELECT id, codigo_cbo FROM ocupacao_cbo WHERE codigo_cbo REGEXP '^2251[0-9]+$' ORDER BY id LIMIT 1",
      );
      const prof = await ins(
        `INSERT INTO profissional (pessoa_fisica_id, tipo, nome_exibicao, criado_em) VALUES (?, 'corpo_clinico', ?, ?)`,
        [await pessoa('prof'), `${P} Prescritor`],
      );
      await ins(
        `INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id, unidade_federativa_id,
           numero_inscricao, ocupacao_cbo_id, principal, situacao, criado_em)
         VALUES (?, 1, 1, 1, '105001', ?, TRUE, 'ativa', ?)`,
        [prof, ocup?.id],
      );
      const usuario = await ins(
        `INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, 'Usuário sintético', 'servico', ?)`,
        [`${P}med`],
      );
      await ins(
        `INSERT INTO usuario_profissional (usuario_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, '2026-01-01', ?)`,
        [usuario, prof],
      );
      const cat: Record<string, number> = {};
      for (const categoria of ['medicamento', 'dieta', 'solucao', 'ventilacao'])
        cat[`tipo_${categoria}`] = await ins(
          `INSERT INTO tipo_item_prescricao (codigo, descricao, categoria, criado_em) VALUES (?, ?, ?, ?)`,
          [`${P}${categoria.slice(0, 3)}`, `Tipo sintético ${categoria}`, categoria],
        );
      await ins(
        `INSERT INTO via_de_uso (codigo, descricao, sigla, criado_em) VALUES (?, 'Endovenosa', 'EV105', ?)`,
        [`${P}v`],
      );
      cat['mg'] = await ins(
        `INSERT INTO unidade_prescricao (codigo, descricao, sigla, criado_em) VALUES (?, 'Miligrama', 'mg105', ?)`,
        [`${P}u`],
      );
      cat['ml'] = await ins(
        `INSERT INTO unidade_prescricao (codigo, descricao, sigla, criado_em) VALUES (?, 'Mililitro', 'ml105', ?)`,
        [`${P}ml`],
      );
      const produto = await ins(
        `INSERT INTO item_prescritivel (codigo, descricao, tipo_item_prescricao_id, criado_em) VALUES (?, 'Produto sintético', ?, ?)`,
        [`${P}ip`, cat['tipo_medicamento']],
      );
      const soro = await ins(
        `INSERT INTO item_prescritivel (codigo, descricao, tipo_item_prescricao_id, criado_em) VALUES (?, 'Soro sintético', ?, ?)`,
        [`${P}sr`, cat['tipo_solucao']],
      );
      await ins(
        `INSERT INTO situacao_checagem (codigo, descricao, categoria, ordem, criado_em) VALUES (?, 'Pendente', 'pendente', 0, ?)`,
        [`${P}p`],
      );
      cat['dieta'] = await ins(
        `INSERT INTO modalidade_dieta (codigo, descricao, classe, criado_em) VALUES (?, 'Dieta sintética', 'enteral', ?)`,
        [`${P}d`],
      );
      cat['viaDieta'] = await ins(
        `INSERT INTO via_dieta (codigo, descricao, modalidade, criado_em) VALUES (?, 'Sonda sintética', 'enteral', ?)`,
        [`${P}vd`],
      );
      cat['caract'] = await ins(
        `INSERT INTO caracteristica_dieta (codigo, descricao, categoria, tipo_resposta, criado_em) VALUES (?, 'Restrição sintética', 'restricao', 'texto', ?)`,
        [`${P}c`],
      );
      cat['tipoInfusao'] = await ins(
        `INSERT INTO tipo_infusao (codigo, descricao, modo, criado_em) VALUES (?, 'Contínua sintética', 'continua', ?)`,
        [`${P}ti`],
      );
      cat['mlh'] = await ins(
        `INSERT INTO unidade_infusao (codigo, descricao, sigla, criado_em) VALUES (?, 'Mililitro por hora', 'ml/h105', ?)`,
        [`${P}ui`],
      );
      cat['viaAerea'] = await ins(
        `INSERT INTO via_aerea (codigo, descricao, criado_em) VALUES (?, 'Tubo sintético', ?)`,
        [`${P}va`],
      );
      cat['modo'] = await ins(
        `INSERT INTO modo_ventilatorio (codigo, descricao, criado_em) VALUES (?, 'Modo sintético', ?)`,
        [`${P}mv`],
      );
      cat['febre'] = await ins(
        `INSERT INTO condicao_se_necessario (codigo, descricao, criado_em) VALUES (?, 'Febre sintética', ?)`,
        [`${P}sn`],
      );
      await ins(
        'INSERT INTO sequencia_negocio (estabelecimento_id, tipo, proximo_valor, criado_em) VALUES (?, ?, 1, ?)',
        [est, 'prescricao'],
      );
      return { est, pac, atd, usuario, cbo: Number(String(ocup?.codigo_cbo)), produto, soro, cat };
    } finally {
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    }
  });
}

describe.skipIf(SEM_BANCO)('tipos de item da prescrição no banco próprio (integração, 03-PEP L105)', () => {
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
  const base = (chave: string, plano: number, detalhe: unknown, horas: number[] = []): ItemGravacao =>
    ({
      chave,
      plano,
      numDose: horas.length,
      frequencia: null,
      via: null,
      observacao: null,
      integracaoEstoque: false,
      detalhe,
      horarios: horas.map((h) => ({ dataHora: local(h * HORA), relativo: null })),
    }) as ItemGravacao;
  const medicamento = () =>
    base(
      'med',
      PLANO_DO_TIPO.medicamento,
      {
        tipo: 'medicamento',
        produto: m.produto,
        dose: 500,
        unidade: 'mg105',
        agora: false,
        naoAjustar: false,
        tempoInfusaoMinutos: null,
        naoPadronizado: null,
        justificativaAlergia: null,
        seNecessario: [m.cat['febre']],
        kit: [],
      },
      [2],
    );
  const dieta = () =>
    base('die', PLANO_DO_TIPO['dieta-enteral'], {
      tipo: 'dieta',
      dieta: m.cat['dieta'],
      viaDieta: m.cat['viaDieta'],
      quantidade: 1500,
      unidade: 'ml105',
      tipoInfusao: m.cat['tipoInfusao'],
      velocidade: 62.5,
      unidadeInfusao: m.cat['mlh'],
      caracteristicas: [{ caracteristica: m.cat['caract'], resposta: 'Sem sacarose' }],
    });
  const solucao = (principal = true) =>
    base('sol', PLANO_DO_TIPO.solucao, {
      tipo: 'solucao',
      unidade: 'ml105',
      tipoInfusao: m.cat['tipoInfusao'],
      agora: true,
      naoAjustar: false,
      componentes: [
        { produto: m.soro, dose: 500, unidade: 'ml105', principal, etapa: 1 },
        { produto: m.produto, dose: 10, unidade: 'mg105', principal: false, etapa: 1 },
        { produto: m.soro, dose: 500, unidade: 'ml105', principal, etapa: 2 },
      ],
      etapas: [
        {
          etapa: 1,
          inicio: local(0),
          fim: local(6 * HORA),
          velocidade: 83.3,
          unidadeInfusao: m.cat['mlh'],
          volume: 500,
        },
        {
          etapa: 2,
          inicio: local(6 * HORA),
          fim: local(16 * HORA),
          velocidade: 50,
          unidadeInfusao: m.cat['mlh'],
          volume: 500,
        },
      ],
    });
  const vmi = () =>
    base('vmi', PLANO_DO_TIPO.vmi, {
      tipo: 'vmi',
      viaAerea: m.cat['viaAerea'],
      modo: m.cat['modo'],
      unidade: 'ml105',
      frequenciaRespiratoria: 16,
      peep: 5,
      volumeCorrente: 450,
      pressao: null,
      unidadePressao: null,
      fio2: 40,
      unidadeFio2: null,
      tempoInspiratorio: 1,
      tempoExpiratorio: 2.5,
    });
  const gravacao = (itens: ItemGravacao[]): GravacaoPrescricao => ({
    paciente: m.pac,
    atendimento: m.atd,
    cbo: m.cbo,
    retratos: { htAtendimento: m.atd, htPaciente: m.pac },
    dataHora: local(0),
    vigencia: { inicio: local(0), fim: local(24 * HORA) },
    justificativaRetroativo: null,
    observacaoGeral: null,
    protocolos: [],
    itens,
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
  });
  const ler = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p));
  const contarPrescricoes = async () =>
    Number(
      (await ler('SELECT COUNT(*) AS n FROM prescricao WHERE estabelecimento_id = ?', [m.est]))[0]?.['n'],
    );

  beforeAll(async () => {
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

  it('incoerência clínica (solução sem componente principal) e tipo sem adaptador recusam sem gravar nada', async () => {
    await expect(
      porta.prescrever(c, 'pep.prescrever', gravacao([medicamento(), solucao(false)]), ctx()),
    ).rejects.toMatchObject({ problema: { status: 422, codigo: 'solucao-sem-principal' } });
    await expect(
      porta.prescrever(
        c,
        'pep.prescrever',
        gravacao([
          base('hem', PLANO_DO_TIPO.hemoterapia, {
            tipo: 'hemoterapia',
            ato: 0,
            codigo: 'X',
            dose: 1,
            unidade: 'ml105',
            tipoInfusao: 1,
            indicacao: null,
            agora: false,
          }),
        ]),
        ctx(),
      ),
    ).rejects.toMatchObject({ problema: { status: 501 } });
    expect(await contarPrescricoes()).toBe(0);
  });

  it('prescreve medicamento "se necessário", dieta, solução em etapas e VMI na mesma prescrição, cada um no seu detalhe', async () => {
    const r = await porta.prescrever(
      c,
      'pep.prescrever',
      gravacao([medicamento(), dieta(), solucao(), vmi()]),
      ctx(),
    );
    expect(await contarPrescricoes()).toBe(1);
    const itens = await ler(
      `SELECT pi.id, pi.sequencia, t.categoria, pi.item_prescritivel_id AS produto, pi.se_necessario, pi.prioridade,
              pi.quantidade
         FROM prescricao_item pi JOIN tipo_item_prescricao t ON t.id = pi.tipo_item_prescricao_id
        WHERE pi.prescricao_id = ? ORDER BY pi.sequencia`,
      [r.prescricao],
    );
    expect(itens.map((x) => x['categoria'])).toEqual(['medicamento', 'dieta', 'solucao', 'ventilacao']);
    const [med, die, sol, ven] = itens.map((x) => Number(x['id']));
    expect(Number(itens[0]!['se_necessario'])).toBe(1);
    expect(Number(itens[2]!['produto'])).toBe(m.soro);
    expect(itens[2]!['prioridade']).toBe('agora');
    expect(Number(itens[1]!['quantidade'])).toBe(1500);
    expect(r.horarios).toBe(1);

    const sn = await ler(
      'SELECT condicao_se_necessario_id AS c FROM prescricao_item_se_necessario WHERE prescricao_item_id = ?',
      [med],
    );
    expect(sn.map((x) => Number(x['c']))).toEqual([m.cat['febre']]);
    expect(
      await ler('SELECT dose FROM prescricao_item_medicamento WHERE prescricao_item_id = ?', [med]),
    ).toHaveLength(1);

    const d = await ler(
      `SELECT d.modalidade_dieta_id AS dieta, d.via_dieta_id AS via, d.volume, d.velocidade_infusao AS vel,
              d.unidade_infusao_id AS ui, d.unidade_prescricao_id AS up, c.caracteristica_dieta_id AS car, c.resposta
         FROM prescricao_item_dieta d JOIN prescricao_item_dieta_caracteristica c ON c.prescricao_item_dieta_id = d.id
        WHERE d.prescricao_item_id = ?`,
      [die],
    );
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ resposta: 'Sem sacarose' });
    expect([d[0]!['dieta'], d[0]!['via'], d[0]!['ui'], d[0]!['up'], d[0]!['car']].map(Number)).toEqual([
      m.cat['dieta'],
      m.cat['viaDieta'],
      m.cat['mlh'],
      m.cat['ml'],
      m.cat['caract'],
    ]);
    expect([Number(d[0]!['volume']), Number(d[0]!['vel'])]).toEqual([1500, 62.5]);

    const s = await ler(
      `SELECT id, volume_total, etapas, esquema_alternado, velocidade_infusao, iniciar_agora FROM prescricao_item_solucao
        WHERE prescricao_item_id = ?`,
      [sol],
    );
    expect(s).toHaveLength(1);
    expect(Number(s[0]!['volume_total'])).toBe(1000);
    expect(Number(s[0]!['etapas'])).toBe(2);
    expect(Number(s[0]!['esquema_alternado'])).toBe(1);
    expect(Number(s[0]!['iniciar_agora'])).toBe(1);
    const comp = await ler(
      `SELECT sequencia, etapa, tipo_componente AS t, item_prescritivel_id AS p, quantidade AS q
         FROM prescricao_item_solucao_componente WHERE prescricao_item_solucao_id = ? ORDER BY sequencia`,
      [s[0]!['id']],
    );
    expect(comp.map((x) => [Number(x['etapa']), x['t'], Number(x['p']), Number(x['q'])])).toEqual([
      [1, 'principal', m.soro, 500],
      [1, 'aditivo', m.produto, 10],
      [2, 'principal', m.soro, 500],
    ]);
    const vel = await ler(
      `SELECT etapa, velocidade, volume_ml, duracao_minutos AS dur, operacao, tipo_registro AS tr
         FROM prescricao_item_velocidade WHERE prescricao_item_solucao_id = ? ORDER BY etapa`,
      [s[0]!['id']],
    );
    expect(
      vel.map((x) => [
        Number(x['etapa']),
        Number(x['velocidade']),
        Number(x['volume_ml']),
        Number(x['dur']),
        x['operacao'],
        x['tr'],
      ]),
    ).toEqual([
      [1, 83.3, 500, 360, 'inclusao', 'prescricao'],
      [2, 50, 500, 600, 'inclusao', 'prescricao'],
    ]);

    const v = await ler(
      `SELECT modalidade, via_aerea_id AS va, modo_ventilatorio_id AS mo, frequencia_respiratoria AS fr, peep_cmh2o AS peep,
              volume_corrente_ml AS vc, fracao_inspirada_oxigenio AS fio2
         FROM prescricao_item_ventilacao WHERE prescricao_item_id = ?`,
      [ven],
    );
    expect(v).toHaveLength(1);
    expect(v[0]!['modalidade']).toBe('invasiva');
    expect(['va', 'mo', 'fr', 'peep', 'vc', 'fio2'].map((k) => Number(v[0]![k]))).toEqual([
      m.cat['viaAerea'],
      m.cat['modo'],
      16,
      5,
      450,
      40,
    ]);
  });
});
