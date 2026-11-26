// Contrato de efeito da auditoria da prescrição de antimicrobiano pela comissão de controle de infecção (F7, 03-PEP
// linha 110) contra o MariaDB do cliente de teste. Massa SINTÉTICA própria (prefixo c2am): estabelecimento, paciente,
// atendimento, prescritor, auditor com vínculo de profissional, antimicrobiano, prescrição com o item e a ficha pendente,
// tipo de auditoria e pareceres padrão. As chaves ficam desligadas SÓ na transação do preparo; a gravação da porta roda
// com todas as chaves e CHECKs. Prova o que fica no banco: a fila com a ficha pendente, as recusas sem escrita (regra
// do domínio, versão vista, parecer padrão de outro estabelecimento, auditor sem profissional), a auditoria com o
// parecer na ficha, a segunda auditoria que encerra a primeira (nada apagado) e o histórico por paciente. Por fim, a
// ficha migrada sem atendimento ligado na origem (D2 das recusas da carga): sem item de prescrição, finalidade nem
// prescritor, aparece na fila e a auditoria grava com o atendimento nulo; com item de prescrição, o atendimento vem da
// prescrição.
import { randomUUID } from 'node:crypto';
import { ErroOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import type { ContextoPortaM18, TrilhaDaGravacao } from '../exames/public-api.js';
import {
  type NovaAuditoria,
  PortaAuditoriaAntimicrobianoPropria,
} from './porta-auditoria-antimicrobiano-propria.js';

const CLIENTE = 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'c2am';

interface Massa {
  est: number;
  est2: number;
  pac: number;
  auditor: number;
  profAuditor: number;
  ficha: number;
  tipoSuspender: number;
  parecerPadrao: number;
  parecerOutro: number;
  /** Para a ficha migrada sem atendimento (criada nos últimos casos). */
  atd: number;
  item: number;
  am: number;
  prescritor: number;
  fin: number;
}

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo IN (?, ?))';
  const par = [P, `${P}2`];
  await limparTrilhaDaMassa(e, { codigos: par });
  for (const sql of [
    `DELETE FROM auditoria_prescricao_ccih WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM ficha_antimicrobiano WHERE estabelecimento_id IN ${est}`,
    `DELETE i FROM prescricao_item i JOIN prescricao p ON p.id = i.prescricao_id WHERE p.estabelecimento_id IN ${est}`,
    `DELETE FROM prescricao WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM atendimento WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM parecer_padrao_auditoria_antimicrobiano WHERE estabelecimento_id IN ${est}`,
    `DELETE FROM idempotencia_operacao WHERE estabelecimento_id IN ${est}`,
  ])
    await e.executar(sql, par);
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', par);
  await e.executar('DELETE FROM tipo_auditoria_ccih WHERE codigo LIKE ?', [`${P}%`]);
  await e.executar(
    'DELETE up FROM usuario_profissional up JOIN usuario u ON u.id = up.usuario_id WHERE u.login LIKE ?',
    [`${P}%`],
  );
  await e.executar('DELETE FROM usuario WHERE login LIKE ?', [`${P}%`]);
  await e.executar('DELETE FROM profissional WHERE nome_exibicao LIKE ?', [`${P} %`]);
  await e.executar(
    'DELETE FROM paciente WHERE pessoa_fisica_id IN (SELECT id FROM pessoa_fisica WHERE nome LIKE ?)',
    [`${P} %`],
  );
  await e.executar('DELETE FROM pessoa_fisica WHERE nome LIKE ?', [`${P} %`]);
  await e.executar('DELETE FROM item_prescritivel WHERE codigo LIKE ?', [`${P}%`]);
  await e.executar('DELETE FROM antimicrobiano WHERE codigo LIKE ?', [`${P}%`]);
  await e.executar('DELETE FROM principio_ativo WHERE codigo_dcb LIKE ?', [`${P}%`]);
}

async function montar(nucleo: NucleoProprio): Promise<Massa> {
  return nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
    await e.executar('SET FOREIGN_KEY_CHECKS = 0');
    try {
      await limpar(e);
      const agora = new Date();
      const ins = (sql: string, p: unknown[]) => e.inserir(sql, [...p, agora]);
      const estab = (cod: string) =>
        ins(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
           VALUES (?, 'Hospital sintético', 'Hospital sintético (fictício)', 'America/Sao_Paulo', ?)`,
          [cod],
        );
      const est = await estab(P);
      const est2 = await estab(`${P}2`);
      const pessoa = (n: string) =>
        ins('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [`${P} ${n}`]);
      const pac = await ins(
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [await pessoa('paciente'), 961_300_001],
      );
      const prof = (n: string) =>
        (async () =>
          ins(
            `INSERT INTO profissional (pessoa_fisica_id, tipo, nome_exibicao, criado_em) VALUES (?, 'corpo_clinico', ?, ?)`,
            [await pessoa(n), `${P} ${n}`],
          ))();
      const prescritor = await prof('prescritor');
      const profAuditor = await prof('auditor');
      const auditor = await ins(
        `INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, 'Auditor sintético', 'servico', ?)`,
        [`${P}aud`],
      );
      await ins(
        `INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, 'Sem vínculo', 'servico', ?)`,
        [`${P}sem`],
      );
      await ins(
        `INSERT INTO usuario_profissional (usuario_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, '2026-01-01', ?)`,
        [auditor, profAuditor],
      );
      const atd = await ins(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, situacao, entrada_em, criado_em)
         VALUES (?, 'C2AM-1', ?, 1, 1, 1, ?, 'aberto', ?, ?)`,
        [est, pac, prescritor, agora],
      );
      const pa = await ins(
        'INSERT INTO principio_ativo (codigo_dcb, descricao, versao_fonte, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}pa`, 'PRINCIPIO SINTETICO', 'teste'],
      );
      const produto = await ins(
        'INSERT INTO item_prescritivel (codigo, descricao, tipo_item_prescricao_id, principio_ativo_id, criado_em) VALUES (?, ?, 1, ?, ?)',
        [`${P}ip`, 'PRODUTO SINTETICO', pa],
      );
      const am = await ins(
        'INSERT INTO antimicrobiano (codigo, descricao, principio_ativo_id, dias_liberados, criado_em) VALUES (?, ?, ?, 10, ?)',
        [`${P}am`, 'ANTIMICROBIANO SINTETICO', pa],
      );
      const presc = await ins(
        `INSERT INTO prescricao (estabelecimento_id, numero, paciente_id, atendimento_id, prescritor_profissional_id,
           tipo, situacao, prescrito_em, vigencia_inicio_em, vigencia_fim_em, criado_em)
         VALUES (?, 961301, ?, ?, ?, 'medica', 'vigente', ?, ?, ?, ?)`,
        [est, pac, atd, prescritor, agora, agora, new Date(agora.getTime() + 86_400_000)],
      );
      const item = await ins(
        `INSERT INTO prescricao_item (prescricao_id, sequencia, tipo_item_prescricao_id, item_prescritivel_id, inicio_em,
           lancamento_profissional_id, criado_em) VALUES (?, 1, 1, ?, ?, ?, ?)`,
        [presc, produto, agora, prescritor],
      );
      const fin = await e.uma("SELECT id FROM finalidade_terapeutica WHERE codigo = 'empirica'");
      const ficha = await ins(
        `INSERT INTO ficha_antimicrobiano (estabelecimento_id, paciente_id, atendimento_id, prescricao_item_id,
           antimicrobiano_id, prescritor_profissional_id, finalidade_terapeutica_id, origem_infeccao, cultura_coletada,
           justificativa, data_inicio, dias_previstos, data_fim_prevista, avaliacao_situacao, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'indeterminada', TRUE, 'Indicação sintética', '2026-11-20', 7, '2026-11-26', 'pendente', ?)`,
        [est, pac, atd, item, am, prescritor, Number(fin?.['id'])],
      );
      const tipoSuspender = await ins(
        `INSERT INTO tipo_auditoria_ccih (codigo, descricao, ativo, acao, criado_em) VALUES (?, 'Suspender (sintético)', TRUE, 'suspender', ?)`,
        [`${P}susp`],
      );
      const pp = (estab: number, prorroga: boolean) =>
        ins(
          `INSERT INTO parecer_padrao_auditoria_antimicrobiano (codigo, descricao, estabelecimento_id, permite_prorrogacao, ativo, criado_em)
           VALUES (?, 'Parecer sintético', ?, ?, TRUE, ?)`,
          [`${P}${String(estab)}`.slice(0, 30), estab, prorroga],
        );
      return {
        est,
        est2,
        pac,
        auditor,
        profAuditor,
        ficha,
        tipoSuspender,
        parecerPadrao: await pp(est, true),
        parecerOutro: await pp(est2, false),
        atd,
        item,
        am,
        prescritor,
        fin: Number(fin?.['id']),
      };
    } finally {
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    }
  });
}

const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema.codigo) : String(e);
  }
};

describe.skipIf(SEM_BANCO)('auditoria da prescrição de antimicrobiano (porta própria, MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaAuditoriaAntimicrobianoPropria;
  let m: Massa;
  const c = (): ContextoPortaM18 =>
    ({
      cliente: CLIENTE,
      estabelecimento: m.est,
      usuario: m.auditor,
      correlacao: `${P}-${randomUUID().slice(0, 8)}`,
    }) as ContextoPortaM18;
  const trilha = (r: { id: number }): TrilhaDaGravacao => ({
    estabelecimento: m.est,
    usuario: m.auditor,
    acao: 'operacao',
    entidade: 'auditoria_prescricao_ccih',
    entidadeId: r.id,
    correlacao: P,
  });
  const base: NovaAuditoria = {
    versaoFicha: 1,
    avaliavel: true,
    droga: 'adequada',
    dose: 'adequada',
    tempo: 'adequada',
    via: 'adequada',
    indicacao: null,
    parecer: 'aprovado',
    permiteProrrogacao: null,
    recomendacao: null,
    tipo: null,
    parecerPadrao: null,
  };
  const ler = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p, { teto: 50 }));
  const auditorias = async () =>
    Number(
      (
        await ler('SELECT COUNT(*) AS n FROM auditoria_prescricao_ccih WHERE estabelecimento_id = ?', [m.est])
      )[0]?.['n'],
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    m = await montar(nucleo);
    porta = new PortaAuditoriaAntimicrobianoPropria(nucleo);
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

  it('fila: a ficha pendente do estabelecimento, com o antimicrobiano e a finalidade; o cadastro com os pareceres daqui', async () => {
    const f = await porta.fila(c(), { soPendentes: true, paciente: null });
    expect(f.map((x) => x.id)).toEqual([m.ficha]);
    expect(f[0]).toMatchObject({
      avaliacao: 'pendente',
      finalidadeCodigo: 'empirica',
      diasPrevistos: 7,
      versao: 1,
    });
    const cad = await porta.cadastro(c());
    expect(cad.pareceres.map((x) => x.id)).toContain(m.parecerPadrao);
    expect(cad.pareceres.map((x) => x.id)).not.toContain(m.parecerOutro);
    expect(cad.tipos.find((t) => t.id === m.tipoSuspender)?.acao).toBe('suspender');
  });

  it('recusas sem escrita: regra do domínio, versão vista, parecer de outro estabelecimento, auditor sem profissional', async () => {
    expect(
      await codigo(porta.registrar(c(), `${P}aud`, m.ficha, { ...base, dose: 'inadequada' }, trilha)),
    ).toBe('parecer-incoerente');
    expect(
      await codigo(porta.registrar(c(), `${P}aud`, m.ficha, { ...base, tipo: m.tipoSuspender }, trilha)),
    ).toBe('parecer-incoerente');
    expect(
      await codigo(porta.registrar(c(), `${P}aud`, m.ficha, { ...base, parecer: 'reprovado' }, trilha)),
    ).toBe('recomendacao-obrigatoria');
    expect(await codigo(porta.registrar(c(), `${P}aud`, m.ficha, { ...base, versaoFicha: 9 }, trilha))).toBe(
      'conflito-versao',
    );
    expect(
      await codigo(
        porta.registrar(c(), `${P}aud`, m.ficha, { ...base, parecerPadrao: m.parecerOutro }, trilha),
      ),
    ).toBe('parecer-padrao-nao-aplicavel');
    expect(await codigo(porta.registrar(c(), `${P}sem`, m.ficha, base, trilha))).toBe(
      'auditor-sem-profissional',
    );
    expect(await auditorias()).toBe(0);
    const [fi] = await ler('SELECT avaliacao_situacao, versao FROM ficha_antimicrobiano WHERE id = ?', [
      m.ficha,
    ]);
    expect(fi).toMatchObject({ avaliacao_situacao: 'pendente', versao: 1 });
  });

  it('aprova com o parecer padrão: auditoria ativa com a prorrogação herdada e a ficha aprovada pelo auditor', async () => {
    const r = await porta.registrar(
      c(),
      `${P}aud`,
      m.ficha,
      { ...base, parecerPadrao: m.parecerPadrao },
      trilha,
    );
    expect(r).toMatchObject({ ficha: m.ficha, avaliacao: 'aprovada', encerradas: 0 });
    const [a] = await ler(
      `SELECT situacao, parecer, permite_prorrogacao, indicacao, adequacao_dose, auditor_usuario_id, paciente_id,
              prescricao_item_id, item_prescritivel_id, parecer_padrao_auditoria_antimicrobiano_id AS pp
         FROM auditoria_prescricao_ccih WHERE id = ?`,
      [r.id],
    );
    expect(a).toMatchObject({
      situacao: 'ativa',
      parecer: 'aprovado',
      indicacao: 'empirico',
      adequacao_dose: 'adequada',
      auditor_usuario_id: m.auditor,
      paciente_id: m.pac,
      pp: m.parecerPadrao,
    });
    expect(Boolean(a?.['permite_prorrogacao'])).toBe(true);
    const [fi] = await ler(
      'SELECT avaliacao_situacao, avaliado_por_profissional_id, avaliado_em, versao FROM ficha_antimicrobiano WHERE id = ?',
      [m.ficha],
    );
    expect(fi).toMatchObject({
      avaliacao_situacao: 'aprovada',
      avaliado_por_profissional_id: m.profAuditor,
      versao: 2,
    });
    expect(fi?.['avaliado_em']).not.toBeNull();
    expect(await porta.fila(c(), { soPendentes: true, paciente: null })).toEqual([]);
  });

  it('a nova auditoria (suspender) encerra a anterior, que fica no histórico; a ficha fica suspensa', async () => {
    const r = await porta.registrar(
      c(),
      `${P}aud`,
      m.ficha,
      {
        ...base,
        versaoFicha: 2,
        tempo: 'inadequada',
        parecer: 'suspenso',
        tipo: m.tipoSuspender,
        recomendacao: 'Suspender: tempo excedido sem cultura positiva',
      },
      trilha,
    );
    expect(r).toMatchObject({ avaliacao: 'suspensa', encerradas: 1 });
    const h = await porta.historico(c(), { paciente: m.pac });
    expect(h.map((x) => [x.parecer, x.situacao])).toEqual([
      ['suspenso', 'ativa'],
      ['aprovado', 'encerrada'],
    ]);
    expect(h[0]).toMatchObject({ tipo: 'Suspender (sintético)', permiteProrrogacao: false, ficha: m.ficha });
    const [fi] = await ler(
      'SELECT avaliacao_situacao, parecer, versao FROM ficha_antimicrobiano WHERE id = ?',
      [m.ficha],
    );
    expect(fi).toMatchObject({
      avaliacao_situacao: 'suspensa',
      parecer: 'Suspender: tempo excedido sem cultura positiva',
      versao: 3,
    });
    expect(await auditorias()).toBe(2);
    const trilhas = await ler(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND entidade = 'auditoria_prescricao_ccih'",
      [m.est],
    );
    expect(Number(trilhas[0]?.['n'])).toBeGreaterThanOrEqual(2);
  });

  const fichaMigrada = (item: number | null, comPrescricao: boolean) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}-mig` }, (e) =>
      e.inserir(
        `INSERT INTO ficha_antimicrobiano (estabelecimento_id, paciente_id, atendimento_id, prescricao_item_id,
           antimicrobiano_id, prescritor_profissional_id, finalidade_terapeutica_id, origem_infeccao, cultura_coletada,
           justificativa, data_inicio, dias_previstos, data_fim_prevista, avaliacao_situacao, origem, criado_em)
         VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, FALSE, NULL, '2026-11-20', NULL, NULL, 'pendente', 'migracao', ?)`,
        [
          m.est,
          m.pac,
          item,
          comPrescricao ? m.am : null,
          comPrescricao ? m.prescritor : null,
          comPrescricao ? m.fin : null,
          new Date(),
        ],
      ),
    );
  const daFicha = async (ficha: number) =>
    ler(
      `SELECT atendimento_id, ficha_antimicrobiano_id, paciente_id, prescricao_item_id, item_prescritivel_id, origem,
              situacao FROM auditoria_prescricao_ccih WHERE ficha_antimicrobiano_id = ?`,
      [ficha],
    );

  it('ficha migrada sem atendimento nem item de prescrição: aparece na fila e a auditoria grava com o atendimento nulo', async () => {
    const migrada = await fichaMigrada(null, false);
    const f = await porta.fila(c(), { soPendentes: true, paciente: null });
    expect(f.filter((x) => x.id === migrada).map((x) => [x.atendimento, x.item, x.finalidadeCodigo])).toEqual(
      [[null, null, '']],
    );
    const r = await porta.registrar(c(), `${P}aud`, migrada, base, trilha);
    expect(r).toMatchObject({ ficha: migrada, avaliacao: 'aprovada', encerradas: 0 });
    const a = await daFicha(migrada);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({
      atendimento_id: null,
      ficha_antimicrobiano_id: migrada,
      paciente_id: m.pac,
      prescricao_item_id: null,
      item_prescritivel_id: null,
      origem: 'sistema',
      situacao: 'ativa',
    });
  });

  it('ficha migrada sem atendimento com item de prescrição: a auditoria grava o atendimento da prescrição', async () => {
    const migrada = await fichaMigrada(m.item, true);
    const f = await porta.fila(c(), { soPendentes: true, paciente: null });
    expect(f.filter((x) => x.id === migrada).map((x) => [x.atendimento, x.item])).toEqual([[m.atd, m.item]]);
    const r = await porta.registrar(c(), `${P}aud`, migrada, base, trilha);
    expect(r).toMatchObject({ ficha: migrada, avaliacao: 'aprovada', encerradas: 0 });
    const a = await daFicha(migrada);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({
      atendimento_id: m.atd,
      ficha_antimicrobiano_id: migrada,
      prescricao_item_id: m.item,
      situacao: 'ativa',
    });
  });
});
