// Integração da porta própria das integrações do worker contra o MariaDB real (cliente de teste f22_o5; massa
// sintética com códigos f22-0514 / fo514 / fo514m; nenhuma pessoa real). Contrato de efeito: o consumidor grava UMA
// mensagem por parceiro e chave (a repetição não duplica); a falha agenda a retentativa com a versão nova e, no limite,
// abre a falha tratável; outro objeto não espera o morto; a entrega reserva pela versão, grava o recibo e o resumo e deixa
// a trilha; a vigia lê os fatos REAIS (liberacao_exame, remessa ao apoio) com o estado da liberação, não repete o fato
// publicado pela operação de origem (Executor) e publica a revogação; o conteúdo é lido no fuso da unidade e nada vaza
// para outro estabelecimento; o estabelecimento desconhecido é recusado.
import { createHash, randomUUID } from 'node:crypto';
import { chaveEventoFato } from '@sgh/dominio-integracao';
import { definirOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type AcessoIntegracao, acessoDoNucleo } from './acesso.js';
import { distribuirEvento } from './consumidor-idempotente.js';
import { cicloEntrega, ErroEntrega } from './entrega.js';
import { type ConfiguracaoEnviadores, conteudoHl7 } from './enviadores.js';
import { verificarAlertasMortos } from './integracao.service.js';
import * as porta from './porta-propria.js';
import { cicloVigiaFatos } from './vigia-fatos.js';

const CLIENTE = 'f22_o5';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'fo514';
/** A segunda unidade (fuso de Manaus): o isolamento por estabelecimento e a hora local. */
const EST2 = 'fo514m';
const PARCEIRO = 'f22-0514-lab';
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

let nucleo: NucleoProprio;
let acesso: AcessoIntegracao;
let est = 0;
let est2 = 0;
let inicio = new Date();

interface Massa {
  readonly t0: Date;
  readonly paciente: number;
  readonly itens: { a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number };
  readonly liberacoes: { a: number };
  readonly vacina: number;
}
let m: Massa;

/** O envio de um evento de exame (o conteúdo é lido na hora do envio). */
const envioDe = (tipoEvento: string, exame: number): porta.EnvioEntrega => ({
  id: '1',
  versao: 1,
  reservadaEm: null,
  idOutbox: '',
  chaveEvento: 'c'.repeat(64),
  tipoEvento,
  parceiro: 'f22-0514-ap',
  chaveOrdem: `exame:${exame}`,
  entidade: 'exame_item',
  objeto: String(exame),
  situacao: 'pendente',
  tentativas: 0,
  proximaTentativaEm: null,
  enviadoEm: null,
  recibo: null,
  resposta: null,
  hashConteudo: null,
  mortoEm: null,
  tratamento: null,
  criadoEm: new Date(),
});

const REQ = "SELECT q.id FROM requisicao_exame q WHERE q.numero LIKE 'f22-0514-%'";
const ITENS = `SELECT ei.id FROM exame_item ei WHERE ei.requisicao_exame_id IN (${REQ})`;

/** Apaga a massa clínica sintética (as chaves de catálogo que a porta só lê entram e saem com as FKs desligadas). */
async function limparMassa(e: Escritor): Promise<void> {
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(`DELETE FROM liberacao_exame WHERE exame_item_id IN (${ITENS})`);
    await e.executar("DELETE FROM item_lista_trabalho_imagem WHERE numero_acesso = 'F220514A'");
    await e.executar(
      "DELETE FROM remessa_laboratorio_apoio_item WHERE remessa_laboratorio_apoio_id IN (SELECT id FROM remessa_laboratorio_apoio WHERE numero LIKE 'f22-0514-%')",
    );
    await e.executar("DELETE FROM remessa_laboratorio_apoio WHERE numero LIKE 'f22-0514-%'");
    await e.executar(`DELETE FROM exame_item WHERE id IN (SELECT id FROM (${ITENS}) x)`);
    await e.executar("DELETE FROM requisicao_exame WHERE numero LIKE 'f22-0514-%'");
    await e.executar("DELETE FROM vacina_aplicada WHERE lote LIKE 'F220514L%'");
    for (const t of ['imunobiologico', 'via_de_uso', 'regiao_corporal'])
      await e.executar(`DELETE FROM ${t} WHERE codigo = 'f22-0514'`);
    await e.executar("DELETE FROM exame_laboratorio_apoio WHERE codigo_exame_apoio = 'F220514AP'");
    await e.executar("DELETE FROM laboratorio_apoio WHERE codigo = 'f22-0514-ap'");
    await e.executar("DELETE FROM setor_diagnostico WHERE codigo = 'f22-0514'");
    await e.executar("DELETE FROM exame WHERE codigo = 'f22-0514-ex'");
    await e.executar('DELETE FROM paciente WHERE numero_prontuario = 905140001');
    await e.executar(
      "DELETE FROM profissional WHERE pessoa_fisica_id IN (SELECT id FROM pessoa_fisica WHERE nome LIKE '% SINTETICO F220514')",
    );
    await e.executar("DELETE FROM pessoa_fisica WHERE nome LIKE '% SINTETICO F220514'");
    for (const x of [est, est2].filter(Boolean)) {
      await e.executar('DELETE FROM liberacao_chave WHERE estabelecimento_id = ?', [x]);
      await e.executar('DELETE FROM recurso_prerequisito WHERE estabelecimento_id = ?', [x]);
      await e.executar('DELETE FROM integracao_mensagem WHERE estabelecimento_id = ?', [x]);
      await e.executar("DELETE FROM marca_sincronismo WHERE estabelecimento_id = ? AND sistema_origem = 'integracao'", [x]);
    }
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
}

/**
 * A massa: no fo514, A liberado (revogado no teste), B liberado (depois da conferência técnica), C liberado e desfeito,
 * H liberado agora e já publicado pela origem; D na remessa fechada, E cancelado na remessa fechada, F na remessa
 * aberta; no fo514m (Manaus), G liberado e a vacina com uma retificação.
 */
async function montarMassa(e: Escritor): Promise<Massa> {
  await limparMassa(e);
  const agora = new Date();
  const t0 = new Date(Date.now() - 3_600_000);
  const s = (n: number) => new Date(t0.getTime() + n * 1_000);
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    const pf = await e.inserir(
      "INSERT INTO pessoa_fisica (nome, data_nascimento, criado_em) VALUES ('PACIENTE SINTETICO F220514', '1980-01-02', ?)",
      [agora],
    );
    const paciente = await e.inserir(
      'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, 905140001, ?)',
      [pf, agora],
    );
    const pfp = await e.inserir("INSERT INTO pessoa_fisica (nome, criado_em) VALUES ('PROFISSIONAL SINTETICO F220514', ?)", [agora]);
    const prof = await e.inserir("INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'assistencial', ?)", [pfp, agora]);
    const setor = await e.inserir(
      "INSERT INTO setor_diagnostico (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, 'f22-0514', 'SETOR SINTETICO', 'laboratorio', ?)",
      [est, agora],
    );
    const lab = await e.inserir(
      "INSERT INTO laboratorio_apoio (estabelecimento_id, codigo, nome, empresa_fornecedora_id, criado_em) VALUES (?, 'f22-0514-ap', 'APOIO SINTETICO', 1, ?)",
      [est, agora],
    );
    const exame = await e.inserir(
      "INSERT INTO exame (codigo, sigla, nome, tipo_servico, criado_em) VALUES ('f22-0514-ex', 'F220514', 'EXAME SINTETICO F220514', 'laboratorio', ?)",
      [agora],
    );
    await e.inserir(
      `INSERT INTO exame_laboratorio_apoio (exame_id, laboratorio_apoio_id, codigo_exame_apoio, nome_exame_apoio, criado_em)
       VALUES (?, ?, 'F220514AP', 'GLICOSE APOIO SINTETICA', ?)`,
      [exame, lab, agora],
    );
    const item = async (rotulo: string, unidade: number, situacao = 'em_analise') => {
      const q = await e.inserir(
        `INSERT INTO requisicao_exame (estabelecimento_id, numero, paciente_id, atendimento_id, setor_diagnostico_id,
           solicitante_profissional_id, fonte_pagadora_id, solicitado_em, criado_em) VALUES (?, ?, ?, 1, ?, ?, 1, ?, ?)`,
        [unidade, `f22-0514-${rotulo}`, paciente, setor, prof, t0, agora],
      );
      return e.inserir(
        `INSERT INTO exame_item (requisicao_exame_id, sequencia, exame_id, laboratorio_apoio_id, situacao, cancelado_em,
           motivo_cancelamento_item_exame_id, criado_em) VALUES (?, 1, ?, ?, ?, ?, ?, ?)`,
        [q, exame, lab, situacao, situacao === 'cancelado' ? t0 : null, situacao === 'cancelado' ? 1 : null, agora],
      );
    };
    const itens = {
      a: await item('a', est),
      b: await item('b', est),
      c: await item('c', est),
      d: await item('d', est, 'coletado'),
      e: await item('e', est, 'cancelado'),
      f: await item('f', est, 'coletado'),
      g: await item('g', est2),
      h: await item('h', est),
    };
    const lib = (exameItem: number, etapa: string, quando: Date, operacao = 'inclusao') =>
      e.inserir(
        'INSERT INTO liberacao_exame (exame_item_id, operacao, ocorrido_em, etapa, criado_em) VALUES (?, ?, ?, ?, ?)',
        [exameItem, operacao, quando, etapa, agora],
      );
    const a = await lib(itens.a, 'liberacao_clinica', s(0));
    await lib(itens.b, 'conferencia_tecnica', s(0));
    await lib(itens.b, 'liberacao_clinica', s(1));
    await lib(itens.c, 'liberacao_clinica', s(2));
    await lib(itens.c, 'liberacao_clinica', s(3), 'exclusao');
    await lib(itens.g, 'liberacao_clinica', s(4));
    const remessa = (n: string, situacao: string) =>
      e.inserir(
        `INSERT INTO remessa_laboratorio_apoio (estabelecimento_id, numero, laboratorio_apoio_id, aberta_em, situacao,
           fechada_em, meio_envio, criado_em) VALUES (?, ?, ?, ?, ?, ?, 'integracao', ?)`,
        [est, `f22-0514-${n}`, lab, t0, situacao, situacao === 'fechada' ? s(0) : null, agora],
      );
    const fechada = await remessa('r1', 'fechada');
    const aberta = await remessa('r2', 'aberta');
    let seq = 0;
    for (const [r, x] of [
      [fechada, itens.d],
      [fechada, itens.e],
      [aberta, itens.f],
    ] as const)
      await e.inserir(
        `INSERT INTO remessa_laboratorio_apoio_item (remessa_laboratorio_apoio_id, sequencia, amostra_biologica_id,
           exame_item_id, criado_em) VALUES (?, ?, 1, ?, ?)`,
        [r, ++seq, x, agora],
      );
    await e.inserir(
      `INSERT INTO item_lista_trabalho_imagem (estabelecimento_id, exame_item_id, setor_diagnostico_id, numero_acesso,
         criado_em) VALUES (?, ?, ?, 'F220514A', ?)`,
      [est, itens.d, setor, agora],
    );
    await e.inserir(
      `INSERT INTO liberacao_chave (estabelecimento_id, tipo, chave, escopo, valor, ligada, criado_em)
       VALUES (?, 'recurso', 'imagem.worklist', 'hospital', '*', TRUE, ?)`,
      [est, agora],
    );
    await e.inserir(
      `INSERT INTO recurso_prerequisito (estabelecimento_id, recurso, tipo, situacao, validade, criado_em)
       VALUES (?, 'imagem.worklist', 'contrato', 'cumprido', '2099-12-31', ?)`,
      [est, agora],
    );
    const imuno = await e.inserir(
      "INSERT INTO imunobiologico (codigo, descricao, codigo_rnds, criado_em) VALUES ('f22-0514', 'VACINA SINTETICA', 'F220514RNDS', ?)",
      [agora],
    );
    const via = await e.inserir("INSERT INTO via_de_uso (codigo, descricao, criado_em) VALUES ('f22-0514', 'VIA SINTETICA', ?)", [agora]);
    const regiao = await e.inserir(
      "INSERT INTO regiao_corporal (codigo, descricao, nivel, criado_em) VALUES ('f22-0514', 'REGIAO SINTETICA', 'parte', ?)",
      [agora],
    );
    const vacina = (lote: string, original: number | null) =>
      e.inserir(
        `INSERT INTO vacina_aplicada (estabelecimento_id, paciente_id, imunobiologico_id, dose, lote, validade_lote,
           via_de_uso_id, regiao_corporal_id, aplicador_profissional_id, aplicada_em, prazo_envio_em,
           vacina_aplicada_original_id, situacao, motivo_correcao, criado_em)
         VALUES (?, ?, ?, 'D1', ?, '2030-01-01', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          est2,
          paciente,
          imuno,
          lote,
          via,
          regiao,
          prof,
          new Date('2026-11-10T15:00:00Z'),
          new Date('2026-11-12T15:00:00Z'),
          original,
          original === null ? 'retificada' : 'ativa',
          original === null ? 'Lote corrigido (teste sintético)' : null,
          agora,
        ],
      );
    const v = await vacina('F220514L1', null);
    await vacina('F220514L2', v);
    return { t0, paciente, itens, liberacoes: { a }, vacina: v };
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
}

/** A operação de origem publica o resultado liberado do H pelo Executor de verdade (alvo resultado_exame). */
async function publicarPelaOrigem(exame: number): Promise<void> {
  const op = definirOperacao<{ exame: number }, { resultado: number }>({
    nome: 'teste.f22-0514.origem',
    tabelas: ['resultado_exame'],
    entrada: z.object({ exame: z.number().int().positive() }),
    gravar: async () => ({ resultado: 1 }),
    alvo: () => ({ tabela: 'resultado_exame', id: 1 }),
    eventos: (x) => [{ tipo: 'fato.resultado.liberado', carga: { exame: x.exame, resultado: 1 } }],
  });
  await nucleo.criarExecutor().executar(op, CLIENTE, { exame }, {
    cliente: CLIENTE,
    estabelecimento: est,
    usuario: null,
    correlacao: 'teste-f22-0514',
    chaveIdempotencia: `teste.${randomUUID()}`,
  });
}

const escrever = <T>(fn: (e: Escritor) => Promise<T>): Promise<T> =>
  nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f22-0514' }, fn);
const ler = <T extends Record<string, unknown>>(sql: string, p: unknown[]): Promise<T[]> =>
  nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-f22-0514' }, (l) => l.consultar<T>(sql, p));

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: unknown }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

async function limpar(e: Escritor): Promise<void> {
  const s = await e.uma<{ id: unknown }>(
    `SELECT COALESCE((SELECT sistema_externo_id FROM parceiro_dados WHERE codigo = ?),
                     (SELECT id FROM sistema_externo WHERE codigo = ?)) AS id`,
    [PARCEIRO, PARCEIRO],
  );
  const sistema = s?.id ?? null;
  if (sistema !== null) {
    await e.executar(
      'DELETE FROM falha_integracao WHERE mensagem_integracao_saida_id IN (SELECT id FROM mensagem_integracao_saida WHERE sistema_externo_id = ?)',
      [sistema],
    );
    await e.executar('DELETE FROM mensagem_integracao_saida WHERE sistema_externo_id = ?', [sistema]);
    await e.executar('DELETE FROM ponto_integracao WHERE sistema_externo_id = ?', [sistema]);
  }
  await e.executar('DELETE FROM parceiro_dados WHERE codigo = ?', [PARCEIRO]);
  await e.executar('DELETE FROM sistema_externo WHERE codigo = ?', [PARCEIRO]);
  if (est) {
    await e.executar('DELETE FROM integracao_mensagem WHERE estabelecimento_id = ?', [est]);
    await e.executar("DELETE FROM marca_sincronismo WHERE estabelecimento_id = ? AND sistema_origem = 'integracao'", [est]);
  }
}

/** Um evento na fila comum do estabelecimento de teste (como a operação de origem grava). */
function evento(chave: string, carga: Record<string, unknown>): Promise<number> {
  return escrever((e) =>
    e.inserir(
      `INSERT INTO integracao_mensagem (estabelecimento_id, ponto, direcao, situacao, tentativas, referencia_externa,
         conteudo, criado_em, versao) VALUES (?, 'integracao.teste', 'saida', 'pendente', 0, ?, ?, ?, 1)`,
      [est, chave, JSON.stringify(carga), new Date()],
    ),
  );
}

const saida = async (chave: string) =>
  (
    await ler<Record<string, unknown>>(
      `SELECT s.id, s.situacao, s.versao, s.tentativas, s.proxima_tentativa_em, s.correlacao, s.codigo_resposta, s.recibo,
              s.hash_sha256, s.integracao_mensagem_id, p.codigo AS ponto
         FROM mensagem_integracao_saida s JOIN ponto_integracao p ON p.id = s.ponto_integracao_id
        WHERE s.estabelecimento_id = ? AND s.chave_idempotencia = ?`,
      [est, chave],
    )
  )[0];

beforeAll(async () => {
  if (SEM_BANCO) return;
  nucleo = new NucleoProprio();
  await escrever(async (e) => {
    est = await garantir(
      e,
      'SELECT id FROM estabelecimento WHERE codigo = ?',
      [EST],
      'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
      [EST, 'Hospital de teste fo514', 'Hospital de teste fo514 (fictício)', new Date()],
    );
    est2 = await garantir(
      e,
      'SELECT id FROM estabelecimento WHERE codigo = ?',
      [EST2],
      "INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em) VALUES (?, ?, ?, 'America/Manaus', ?)",
      [EST2, 'Hospital de teste fo514m', 'Hospital de teste fo514m (fictício)', new Date()],
    );
    for (const familia of ['hl7v2', 'fhir', 'api', 'proprio'])
      await garantir(
        e,
        'SELECT id FROM padrao_troca WHERE familia = ? AND ativo ORDER BY id LIMIT 1',
        [familia],
        'INSERT INTO padrao_troca (codigo, descricao, familia, criado_em) VALUES (?, ?, ?, ?)',
        [`f220514-${familia}`, `Padrão de teste ${familia}`, familia, new Date()],
      );
    await limpar(e);
    await e.inserir(
      `INSERT INTO parceiro_dados (codigo, nome, tipo, escopos, eventos, limite_tentativas, finalidade, base_legal, ativo,
         criado_em) VALUES (?, ?, 'api', ?, ?, 2, ?, 'tutela-da-saude', TRUE, ?)`,
      [
        PARCEIRO,
        'Parceiro de teste do lote 05-14',
        JSON.stringify([]),
        JSON.stringify(['integracao.teste', 'fato.resultado.liberado', 'fato.exame.apoio']),
        'Teste automatizado da entrega das integrações.',
        new Date(),
      ],
    );
  });
  m = await escrever(montarMassa);
  acesso = acessoDoNucleo(nucleo, CLIENTE, 'teste-f22-0514');
  inicio = new Date(Date.now() - 1_000);
  await publicarPelaOrigem(m.itens.h);
  // O H é liberado logo depois da publicação da origem (dentro da sobreposição de 5 s).
  await escrever((e) =>
    e.inserir(
      "INSERT INTO liberacao_exame (exame_item_id, operacao, ocorrido_em, etapa, criado_em) VALUES (?, 'inclusao', ?, 'liberacao_clinica', ?)",
      [m.itens.h, new Date(Date.now() - 1_000), new Date()],
    ),
  );
});

afterAll(async () => {
  if (SEM_BANCO) return;
  await escrever(limpar);
  await escrever(limparMassa);
  await nucleo.encerrar();
});

describe.skipIf(SEM_BANCO)('porta própria das integrações no worker (MariaDB, cliente f22_o5)', () => {
  it('o evento vira UMA mensagem; a falha agenda a retentativa e, no limite, abre a falha tratável e o alerta', async () => {
    const c1 = sha('f22-0514-evento-1');
    const idFila = await evento(c1, { parceiro: PARCEIRO });
    const ev = { chave: c1, tipo: 'integracao.teste', dados: { hospital: EST, parceiro: PARCEIRO } };
    expect(await distribuirEvento(acesso, ev)).toEqual({ parceiros: 1, incluidas: 1, repetidas: 0 });
    expect(await distribuirEvento(acesso, ev)).toEqual({ parceiros: 1, incluidas: 0, repetidas: 1 });
    const m0 = (await saida(c1))!;
    expect(m0).toMatchObject({
      situacao: 'pendente',
      ponto: `parceiro.${PARCEIRO}.saida`,
      correlacao: `estabelecimento:${EST}`,
    });
    expect(Number(m0['versao'])).toBe(1);
    expect(Number(m0['integracao_mensagem_id'])).toBe(idFila);

    const t0 = new Date('2026-11-21T10:00:00.000Z');
    const falhar = async (): Promise<never> => {
      throw new ErroEntrega('tempo esgotado');
    };
    const r1 = await cicloEntrega(acesso, EST, falhar, { agora: () => t0, tempoPorParceiroMs: 5_000 });
    expect(r1).toEqual({ prontas: 1, enviadas: 0, falhas: 1, mortas: 0, conflitos: 0 });
    const m1 = (await saida(c1))!;
    expect(m1).toMatchObject({ situacao: 'pendente' });
    // A reserva (versão 2) e a retentativa (versão 3).
    expect([Number(m1['versao']), Number(m1['tentativas'])]).toEqual([3, 1]);
    expect(porta.data(m1['proxima_tentativa_em'])?.toISOString()).toBe('2026-11-21T10:01:00.000Z');

    const t1 = new Date(t0.getTime() + 120_000);
    const r2 = await cicloEntrega(acesso, EST, falhar, { agora: () => t1, tempoPorParceiroMs: 5_000 });
    expect(r2.mortas).toBe(1);
    const m2 = (await saida(c1))!;
    expect([m2['situacao'], Number(m2['versao'])]).toEqual(['erro', 5]);
    const f = await ler<Record<string, unknown>>(
      'SELECT situacao, categoria_causa, etapa, versao FROM falha_integracao WHERE mensagem_integracao_saida_id = ?',
      [m2['id']],
    );
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ situacao: 'aberta', categoria_causa: 'tempo_esgotado', etapa: 'envio' });

    const mortos = await acesso.ler(EST, (l) => porta.lerMortos(l, EST, 10));
    expect(mortos.map((x) => x.id)).toContain(String(m2['id']));
    expect(mortos.find((x) => x.id === String(m2['id']))?.mortoEm?.toISOString()).toBe(t1.toISOString());
    const alertas: { envio: string }[] = [];
    const n = await verificarAlertasMortos(acesso, EST, 240, new Date(t1.getTime() + 5 * 3_600_000), (a) =>
      alertas.push(a),
    );
    expect(n).toBeGreaterThan(0);
    expect(alertas.map((a) => a.envio)).toContain(String(m2['id']));
  });

  it('outro objeto não espera o morto; a entrega grava a mensagem enviada com o recibo e o resumo', async () => {
    const c2 = sha('f22-0514-evento-2');
    await evento(c2, { paciente: 42 });
    expect(
      await distribuirEvento(acesso, {
        chave: c2,
        tipo: 'integracao.teste',
        dados: { hospital: EST, parceiro: PARCEIRO, paciente: 42 },
      }),
    ).toMatchObject({ incluidas: 1 });
    const r = await cicloEntrega(
      acesso,
      EST,
      async () => ({ recibo: 'AA-1', resposta: 'AA', conteudo: 'MSH|teste' }),
      { agora: () => new Date(), tempoPorParceiroMs: 5_000 },
    );
    expect(r).toEqual({ prontas: 1, enviadas: 1, falhas: 0, mortas: 0, conflitos: 0 });
    const x = (await saida(c2))!;
    expect(x).toMatchObject({ situacao: 'enviada', codigo_resposta: 'AA-1', recibo: 'AA-1', correlacao: 'paciente:42' });
    expect(x['hash_sha256']).toBe(sha('MSH|teste'));
    expect(Number(x['versao'])).toBe(3);
    // A trilha das operações da integração (processo automático: sem usuário, com a correlação do rótulo).
    const trilha = await ler<{ op: string; usuario_id: unknown }>(
      `SELECT DISTINCT JSON_VALUE(dados_depois, '$.operacao') AS op, usuario_id FROM trilha_auditoria
        WHERE estabelecimento_id = ? AND correlacao = 'teste-f22-0514' AND criado_em >= ?`,
      [est, inicio],
    );
    expect(trilha.map((t) => t.op)).toEqual(
      expect.arrayContaining([
        'integracao.distribuir-evento',
        'integracao.entrega-reservada',
        'integracao.entrega-enviada',
        'integracao.entrega-falha',
      ]),
    );
    expect(trilha.every((t) => t.usuario_id === null)).toBe(true);
  });

  it('vigia (fonte real): a liberação vigente sai uma vez; a superada e a desfeita não; a revogação sai depois da liberação entregue', async () => {
    const r1 = await cicloVigiaFatos(acesso, EST, 50);
    expect(r1).toEqual([
      { fato: 'resultado.liberado', lidos: 5, eventos: 2, repetidos: 1, ignorados: 2 },
      { fato: 'exame.apoio', lidos: 1, eventos: 1, repetidos: 0, ignorados: 0 },
    ]);
    const evs = () =>
      ler<Record<string, unknown>>(
        `SELECT ponto, entidade, entidade_id, referencia_externa, conteudo FROM integracao_mensagem
          WHERE estabelecimento_id = ? AND ponto LIKE 'fato.%' ORDER BY id`,
        [est],
      );
    const exameDe = (x: Record<string, unknown>) => (JSON.parse(String(x['conteudo'])) as { exame: number }).exame;
    const v1 = await evs();
    // A origem (Executor, alvo resultado_exame) já publicou o H: a vigia não repete; A e B saem; C (desfeita) não.
    expect(v1.map((x) => [x['ponto'], x['entidade'], exameDe(x)])).toEqual([
      ['fato.resultado.liberado', 'resultado_exame', m.itens.h],
      ['fato.resultado.liberado', 'liberacao_exame', m.itens.a],
      ['fato.resultado.liberado', 'liberacao_exame', m.itens.b],
      ['fato.exame.apoio', 'remessa_laboratorio_apoio_item', m.itens.d],
    ]);
    expect(v1[1]!['referencia_externa']).toBe(
      porta.chaveEvento(chaveEventoFato('resultado.liberado', EST, m.liberacoes.a, m.t0)),
    );
    expect(JSON.parse(String(v1[1]!['conteudo']))).toEqual({ exame: m.itens.a, paciente: m.paciente, atendimento: 1 });
    // O hospital revoga o A: a retirada sai como evento próprio; a releitura não repete nada.
    const revogacao = await escrever((e) =>
      e.inserir(
        `INSERT INTO liberacao_exame (exame_item_id, operacao, ocorrido_em, etapa, criado_em) VALUES (?, 'inclusao', ?, 'revogacao', ?)`,
        [m.itens.a, new Date(), new Date()],
      ),
    );
    expect((await cicloVigiaFatos(acesso, EST, 50))[0]).toEqual({
      fato: 'resultado.liberado',
      lidos: 2,
      eventos: 1,
      repetidos: 1,
      ignorados: 0,
    });
    const rev = (await evs()).filter((x) => x['ponto'] === 'fato.resultado.revogado');
    expect(rev.map((x) => [x['entidade'], Number(x['entidade_id']), exameDe(x)])).toEqual([
      ['liberacao_exame', revogacao, m.itens.a],
    ]);
    expect((await cicloVigiaFatos(acesso, EST, 50))[0]).toMatchObject({ eventos: 0, repetidos: 2 });
    // A revogação vai a quem assina o resultado liberado.
    expect(
      await distribuirEvento(acesso, {
        chave: String(rev[0]!['referencia_externa']),
        tipo: 'fato.resultado.revogado',
        dados: { hospital: EST, exame: m.itens.a, paciente: m.paciente },
      }),
    ).toEqual({ parceiros: 1, incluidas: 1, repetidas: 0 });
    // A marca do resultado fica na revogação; a outra unidade (fo514m) não viu nada.
    expect(await acesso.ler(EST, (l) => porta.lerMarcaFato(l, EST, 'resultado.liberado'))).toMatchObject({
      ultimoId: String(revogacao),
    });
    expect(
      await ler('SELECT 1 AS x FROM integracao_mensagem WHERE estabelecimento_id = ? AND ponto LIKE ?', [est2, 'fato.%']),
    ).toHaveLength(0);
  });

  it('reserva do envio: a versão lida reserva uma vez; outra réplica não pega; a mudança pela tela vira conflito', async () => {
    const c3 = sha('f22-0514-evento-3');
    await evento(c3, { paciente: 43 });
    await distribuirEvento(acesso, {
      chave: c3,
      tipo: 'integracao.teste',
      dados: { hospital: EST, parceiro: PARCEIRO, paciente: 43 },
    });
    const id = String((await saida(c3))!['id']);
    const reservar = () => acesso.gravar(EST, (tx) => porta.reservarEnvio(tx, id, 1, new Date()));
    expect(await reservar()).toBe(2);
    expect(await reservar()).toBeNull();
    expect((await saida(c3))!['situacao']).toBe('enviando');
    const recibo = { recibo: 'AA-3', resposta: 'AA', hash: sha('x') };
    await expect(acesso.gravar(EST, (tx) => porta.marcarEnviado(tx, id, 1, recibo))).rejects.toThrow(/conflito-versao/);
    // A tela descarta a mensagem no meio do envio: a marca não sobrescreve.
    await escrever((e) =>
      e.executar("UPDATE mensagem_integracao_saida SET situacao = 'cancelada', versao = versao + 1 WHERE id = ?", [Number(id)]),
    );
    await expect(acesso.gravar(EST, (tx) => porta.marcarEnviado(tx, id, 2, recibo))).rejects.toThrow(/conflito-versao/);
    await expect(acesso.gravar(EST, (tx) => porta.marcarEnviado(tx, id, 3, recibo))).rejects.toThrow(/conflito-versao/);
    expect((await saida(c3))!['situacao']).toBe('cancelada');
  });

  it('conteúdo: o exame pedido, o item da lista, a vacina (no fuso da unidade) e a liberação, sem vazar entre unidades', async () => {
    const r = await acesso.ler(EST, async (l) => ({
      d: await porta.examePedido(l, EST, m.itens.d),
      e: await porta.examePedido(l, EST, m.itens.e),
      outraUnidade: await porta.examePedido(l, EST, m.itens.g),
      item: await porta.itemListaTrabalho(l, EST, m.itens.d),
      itemOutra: await porta.itemListaTrabalho(l, EST2, m.itens.d),
      vacina: await porta.vacinaParaRia(l, EST2, m.vacina),
      vacinaOutra: await porta.vacinaParaRia(l, EST, m.vacina),
      chaves: await porta.lerChavesLiberacao(l, EST, 'imagem.worklist'),
      chavesOutra: await porta.lerChavesLiberacao(l, EST2, 'imagem.worklist'),
      prerequisitos: await porta.lerPrerequisitos(l, EST, 'imagem.worklist'),
      estabelecimentos: await porta.lerEstabelecimentos(l),
      parceiros: await porta.lerParceiros(l),
      outbox: await porta.idDaOutbox(l, EST, 'f22-0514-inexistente'),
      inexistente: await porta.examePedido(l, EST, 999_999_999),
    }));
    expect(r.d).toMatchObject({
      id: m.itens.d,
      cancelado: false,
      urgente: false,
      paciente: { id: m.paciente, prontuario: 905140001, nome: 'PACIENTE SINTETICO F220514', nascimento: '1980-01-02' },
      exame: { codigo: 'f22-0514-ex', nome: 'EXAME SINTETICO F220514' },
      apoio: { codigo: 'F220514AP', nome: 'GLICOSE APOIO SINTETICA', material: null },
      solicitante: 'PROFISSIONAL SINTETICO F220514',
      fuso: 'America/Sao_Paulo',
    });
    expect(r.e?.cancelado).toBe(true);
    expect([r.outraUnidade, r.itemOutra, r.vacinaOutra, r.outbox, r.inexistente]).toEqual([null, null, null, null, null]);
    expect(r.item).toEqual({ accession: 'F220514A', modalidade: null });
    expect(r.vacina?.paciente).toBe(m.paciente);
    expect(r.vacina?.versoes.map((v) => [v.lote, v.dose, v.aplicadaEm, v.imunobiologico])).toEqual([
      ['F220514L1', 'D1', '2026-11-10T11:00', 'F220514RNDS'],
      ['F220514L2', 'D1', '2026-11-10T11:00', 'F220514RNDS'],
    ]);
    expect(r.chaves).toEqual([{ chave: 'imagem.worklist', tipo: 'recurso', escopo: 'hospital', valor: '*', ligada: true }]);
    expect(r.chavesOutra).toEqual([]);
    expect(r.prerequisitos).toEqual([
      { recurso: 'imagem.worklist', tipo: 'contrato', situacao: 'cumprido', validade: '2099-12-31' },
    ]);
    expect(r.estabelecimentos).toEqual(expect.arrayContaining([EST, EST2]));
    expect(r.parceiros.find((p) => p.codigo === PARCEIRO)).toMatchObject({ ativo: true, limiteTentativas: 2, tipo: 'api' });

    // O pedido HL7 ao apoio sai com o código do laboratório; o exame cancelado depois da remessa é recusado.
    const cfg: ConfiguracaoEnviadores = {
      ambiente: 'teste',
      produto: 'SGH',
      hostMllp: '127.0.0.1',
      simuladorRnds: null,
      destinoApi: () => null,
      ler: acesso.ler,
      agora: () => new Date(),
    };
    const apoio: porta.ParceiroEntrega = {
      id: '1',
      codigo: 'f22-0514-ap',
      nome: 'Apoio sintético',
      tipo: 'apoio',
      canal: null,
      eventos: ['fato.exame.apoio'],
      limiteTentativas: 3,
      ativo: true,
    };
    expect(await conteudoHl7(cfg, apoio, envioDe('fato.exame.apoio', m.itens.d), EST)).toContain('F220514AP');
    await expect(conteudoHl7(cfg, apoio, envioDe('fato.exame.apoio', m.itens.e), EST)).rejects.toThrow(/cancelado/);
    await expect(conteudoHl7(cfg, apoio, envioDe('fato.resultado.liberado', m.itens.b), EST)).rejects.toThrow(
      /sem mensagem HL7/,
    );
  });

  it('recusa: estabelecimento desconhecido e parceiro inexistente não gravam nada', async () => {
    await expect(acesso.gravar('zz9', async () => 1)).rejects.toThrow();
    await expect(
      acesso.gravar(EST, (tx) =>
        porta.registrarEnvio(tx, {
          idOutbox: '',
          chaveEvento: sha('f22-0514-x'),
          tipoEvento: 'integracao.teste',
          parceiro: 'f22-0514-nao-existe',
          chaveOrdem: 'estabelecimento:fo514',
          entidade: null,
          objeto: null,
        }),
      ),
    ).rejects.toThrow();
    expect(await saida(sha('f22-0514-x'))).toBeUndefined();
  });
});
