// Contrato de efeito da prescrição digital por plataforma externa (F8, 08-INTG L132) contra o MariaDB real (cliente de
// teste; massa SINTÉTICA com o código do teste, nenhuma pessoa real). Prova o que fica no banco: a receita sem
// assinatura ICP-Brasil e a de outro signatário são recusadas sem gravar nada; a receita assinada pelo prescritor grava
// o envio pendente (documento, assinatura e resumo ligados) e a mensagem JSON na fila de saída do ponto da plataforma
// (criado por HTTP REST), com o envio apontando para a mensagem; o repetido é recusado; a visão por paciente traz a
// receita com o envio e os itens no pedido; o cancelamento exige motivo e a versão lida, espera enquanto o worker entrega
// (mensagem em "enviando"), não apaga nada, tira da fila a mensagem ainda não entregue e, quando a plataforma já
// devolveu o identificador, põe o pedido de cancelamento na fila. A gravação REAL do retorno da plataforma (e a aceita
// atrasada de envio cancelado) é provada no contrato do worker: apps/worker/src/integracao/prescricao-digital.int.spec.ts.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaPrescricaoDigitalPropria } from './prescricao-digital-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c2018pd';
const NOME_PAC = 'c2018 Paciente sintético';
const NOME_PRESC = 'c2018 Prescritor sintético';
const NOME_OUTRO = 'c2018 Outro profissional sintético';
const H = (c: string) => c.repeat(64);

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(`DELETE FROM envio_prescricao_plataforma WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM mensagem_integracao_saida WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM ponto_integracao WHERE estabelecimento_id IN ${est}`, [P]);
    const doc = `(SELECT x.id FROM (SELECT id FROM documento_assinado WHERE estabelecimento_id IN ${est}) x)`;
    await e.executar(`DELETE FROM assinatura_documento WHERE documento_assinado_id IN ${doc}`, [P]);
    await e.executar(`DELETE FROM documento_assinado WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(
      `DELETE FROM receita_medica_item WHERE receita_medica_id IN (SELECT x.id FROM (SELECT id FROM receita_medica WHERE estabelecimento_id IN ${est}) x)`,
      [P],
    );
    await e.executar(`DELETE FROM receita_medica WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar("DELETE FROM tipo_receita WHERE codigo = 'c2018-tr'");
    await e.executar("DELETE FROM parceiro_dados WHERE codigo LIKE 'c2018-%'");
    await e.executar("DELETE FROM sistema_externo WHERE codigo LIKE 'c2018-%'");
    await e.executar("DELETE FROM padrao_troca WHERE codigo = 'c2018-api'");
    await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN ${est}`, [P]);
    const pf = '(SELECT x.id FROM (SELECT id FROM pessoa_fisica WHERE nome IN (?, ?, ?)) x)';
    await e.executar(`DELETE FROM paciente WHERE pessoa_fisica_id IN ${pf}`, [
      NOME_PAC,
      NOME_PRESC,
      NOME_OUTRO,
    ]);
    await e.executar(`DELETE FROM profissional WHERE pessoa_fisica_id IN ${pf}`, [
      NOME_PAC,
      NOME_PRESC,
      NOME_OUTRO,
    ]);
    await e.executar('DELETE FROM pessoa_fisica WHERE nome IN (?, ?, ?)', [NOME_PAC, NOME_PRESC, NOME_OUTRO]);
    await limparTrilhaDaMassa(e, { codigos: [P] });
    await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
}

describe.skipIf(SEM_BANCO)('Prescrição digital por plataforma externa (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaPrescricaoDigitalPropria;
  let m: {
    est: number;
    usuario: number;
    paciente: number;
    presc: number;
    r1: number;
    r2: number;
    r3: number;
  };
  const ctx = () => ({ cliente: CLIENTE, usuario: m.usuario, correlacao: P, hospital: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p));
  const contar = async (tabela: string) =>
    Number((await ler(`SELECT COUNT(*) AS n FROM ${tabela} WHERE estabelecimento_id = ?`, [m.est]))[0]!['n']);
  const erro = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return (e as { problema?: { status?: number; codigo?: string } }).problema ?? {};
    }
    throw new Error('Era para recusar.');
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    porta = new PortaPrescricaoDigitalPropria(nucleo, CLIENTE);
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const us = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, 'Hospital Teste', 'Hospital sintético (fictício)', 'America/Sao_Paulo', ?)`,
        [P, agora],
      );
      const sis = await e.inserir(
        `INSERT INTO sistema_externo (codigo, nome, categoria, finalidade, criado_em)
         VALUES ('c2018-plat', 'Plataforma de prescrição (teste)', 'prontuario', 'Prescrição digital (teste)', ?)`,
        [agora],
      );
      await e.executar(
        `INSERT INTO parceiro_dados (codigo, nome, tipo, sistema_externo_id, finalidade, base_legal, criado_em)
         VALUES ('c2018-par', 'Plataforma (teste)', 'api', ?, 'Prescrição digital (teste)', 'tutela-da-saude', ?)`,
        [sis, agora],
      );
      await e.executar(
        `INSERT INTO sistema_externo (codigo, nome, categoria, finalidade, criado_em)
         VALUES ('c2018-lab', 'Laboratório (teste)', 'laboratorio', 'Exames (teste)', ?)`,
        [agora],
      );
      if (
        !(await e.uma(
          "SELECT id FROM padrao_troca WHERE familia IN ('api','proprio') AND ativo = TRUE LIMIT 1",
        ))
      )
        await e.executar(
          "INSERT INTO padrao_troca (codigo, descricao, familia, criado_em) VALUES ('c2018-api', 'API (teste)', 'api', ?)",
          [agora],
        );
      const tr = await e.inserir(
        "INSERT INTO tipo_receita (codigo, descricao, estruturada, criado_em) VALUES ('c2018-tr', 'Receita (teste)', TRUE, ?)",
        [agora],
      );
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        const pf = (nome: string) =>
          e.inserir('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [nome, agora]);
        const pfPac = await pf(NOME_PAC);
        const pront = await e.uma('SELECT COALESCE(MAX(numero_prontuario), 0) + 1 AS n FROM paciente');
        const paciente = await e.inserir(
          'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
          [pfPac, pront!['n'], agora],
        );
        const prof = (pessoa: number) =>
          e.inserir(
            "INSERT INTO profissional (pessoa_fisica_id, tipo, situacao, criado_em) VALUES (?, 'corpo_clinico', 'ativo', ?)",
            [pessoa, agora],
          );
        const presc = await prof(await pf(NOME_PRESC));
        const outro = await prof(await pf(NOME_OUTRO));
        const atd = await e.inserir(
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em)
           VALUES (?, ?, ?, 1, 1, 1, ?, ?, ?)`,
          [est, `${P}-a`, paciente, presc, new Date(agora.getTime() - 3_600_000), agora],
        );
        const receita = (n: string) =>
          e.inserir(
            `INSERT INTO receita_medica (estabelecimento_id, numero, paciente_id, atendimento_id, prescritor_profissional_id,
             tipo_receita_id, emitida_em, registrada_em, situacao, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'emitida', ?)`,
            [est, `${P}-${n}`, paciente, atd, presc, tr, agora, agora, agora],
          );
        const assinar = async (r: number, nivel: string, signatario: number, letra: string) => {
          const d = await e.inserir(
            `INSERT INTO documento_assinado (estabelecimento_id, codigo_verificacao, tipo_documento, entidade, entidade_id,
             paciente_id, atendimento_id, titulo, hash_conteudo, arquivo_id, nivel_exigido, gerado_em, concluido_em,
             situacao, criado_em) VALUES (?, ?, 'receita', 'receita_medica', ?, ?, ?, 'Receita (teste)', ?, 999999, ?, ?, ?,
             'assinado', ?)`,
            [est, `${P}-${letra}`, r, paciente, atd, H(letra), nivel, agora, agora, agora],
          );
          await e.executar(
            `INSERT INTO assinatura_documento (documento_assinado_id, sequencia, profissional_id, nome_signatario,
             cpf_signatario, certificado_usuario_id, nivel, hash_assinado, assinado_em, criado_em)
             VALUES (?, 1, ?, 'Signatário (teste)', '99920180001', 999999, ?, ?, ?, ?)`,
            [d, signatario, nivel, H(letra), agora, agora],
          );
        };
        const r1 = await receita('r1');
        await assinar(r1, 'icp-brasil', presc, 'a');
        const item = (seq: number, suspenso: boolean) =>
          e.executar(
            `INSERT INTO receita_medica_item (receita_medica_id, sequencia, medicamento, concentracao, posologia,
             quantidade_descricao, suspenso, motivo_suspensao, criado_em) VALUES (?, ?, 'Fármaco sintético', '500 mg',
             '1 comprimido de 8 em 8 horas', '1 caixa', ?, ?, ?)`,
            [r1, seq, suspenso, suspenso ? 'Troca (teste)' : null, agora],
          );
        await item(1, false);
        await item(2, true);
        const r2 = await receita('r2');
        await assinar(r2, 'eletronica-avancada', presc, 'b');
        const r3 = await receita('r3');
        await assinar(r3, 'icp-brasil', outro, 'c');
        return { est, usuario: Number(us!['id']), paciente, presc, r1, r2, r3 };
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await nucleo.encerrar?.();
  });

  it('recusa a receita sem ICP-Brasil, a de outro signatário e a plataforma alheia, sem gravar nada', async () => {
    expect((await erro(porta.enviar(ctx(), { receita: m.r2, plataforma: 'c2018-plat' }))).codigo).toBe(
      'assinatura-nao-icp',
    );
    expect((await erro(porta.enviar(ctx(), { receita: m.r3, plataforma: 'c2018-plat' }))).codigo).toBe(
      'assinatura-de-outro',
    );
    expect((await erro(porta.enviar(ctx(), { receita: m.r1, plataforma: 'c2018-lab' }))).codigo).toBe(
      'plataforma-inativa',
    );
    expect(await contar('envio_prescricao_plataforma')).toBe(0);
    expect(await contar('mensagem_integracao_saida')).toBe(0);
  });

  it('a receita assinada grava o envio pendente e a mensagem JSON na fila; o repetido é recusado', async () => {
    const r = await porta.enviar(ctx(), { receita: m.r1, plataforma: 'c2018-plat' });
    const [e] = await ler(
      `SELECT situacao, receita_medica_id, paciente_id, profissional_id, documento_assinado_id, assinatura_documento_id,
              hash_documento, mensagem_integracao_saida_id, criado_por, versao FROM envio_prescricao_plataforma WHERE id = ?`,
      [r.id],
    );
    expect(e).toMatchObject({ situacao: 'pendente', hash_documento: H('a') });
    expect(Number(e!['receita_medica_id'])).toBe(m.r1);
    expect(Number(e!['profissional_id'])).toBe(m.presc);
    expect(e!['documento_assinado_id']).not.toBeNull();
    expect(e!['assinatura_documento_id']).not.toBeNull();
    expect(Number(e!['mensagem_integracao_saida_id'])).toBe(r.mensagem);
    expect(Number(e!['criado_por'])).toBe(m.usuario);
    const [s] = await ler(
      `SELECT s.situacao, s.formato, s.tipo_mensagem, s.entidade, s.entidade_id, s.conteudo, p.transporte, p.formato_conteudo
         FROM mensagem_integracao_saida s JOIN ponto_integracao p ON p.id = s.ponto_integracao_id WHERE s.id = ?`,
      [r.mensagem],
    );
    expect(s).toMatchObject({
      situacao: 'pendente',
      formato: 'json',
      tipo_mensagem: 'integracao.prescricao_digital.envio',
      entidade: 'envio_prescricao_plataforma',
      transporte: 'http_rest',
      formato_conteudo: 'json',
    });
    const pedido = JSON.parse(String(s!['conteudo'])) as Record<string, unknown>;
    expect(pedido['documento']).toMatchObject({ hash: H('a'), codigoVerificacao: `${P}-a` });
    // Os itens da receita vão no pedido (o suspenso não).
    expect(pedido['itens']).toEqual([
      expect.objectContaining({ sequencia: 1, medicamento: 'Fármaco sintético', quantidade: '1 caixa' }),
    ]);
    expect((await erro(porta.enviar(ctx(), { receita: m.r1, plataforma: 'c2018-plat' }))).codigo).toBe(
      'envio-repetido',
    );
    expect(await contar('envio_prescricao_plataforma')).toBe(1);
    const visao = await porta.doPaciente(ctx(), m.paciente);
    expect(visao).toHaveLength(3);
    expect(visao.find((x) => x.id === m.r1)!.envios.map((x) => x.situacao)).toEqual(['pendente']);
    expect((await porta.pacientes(ctx(), 'c2018 Paciente')).map((x) => x.id)).toEqual([m.paciente]);
  });

  it('o cancelamento exige motivo e versão; tira da fila a não entregue e não apaga nada', async () => {
    const [e] = await ler(
      'SELECT id, versao, mensagem_integracao_saida_id FROM envio_prescricao_plataforma WHERE receita_medica_id = ?',
      [m.r1],
    );
    const id = Number(e!['id']);
    expect(
      (await erro(porta.cancelar(ctx(), id, { motivo: 'curto', versao: Number(e!['versao']) }))).codigo,
    ).toBe('motivo-curto');
    expect(
      (await erro(porta.cancelar(ctx(), id, { motivo: 'Troca do tratamento', versao: 99 }))).codigo,
    ).toBe('conflito-versao');
    // O worker reservou a mensagem (entregando agora): o cancelamento espera e nada muda.
    const msg = Number(e!['mensagem_integracao_saida_id']);
    const fila = (s: string) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: `fila-${P}` }, (w) =>
        w.executar('UPDATE mensagem_integracao_saida SET situacao = ? WHERE id = ?', [s, msg]),
      );
    await fila('enviando');
    expect(
      (await erro(porta.cancelar(ctx(), id, { motivo: 'Troca do tratamento', versao: Number(e!['versao']) })))
        .codigo,
    ).toBe('envio-em-andamento');
    const [ainda] = await ler('SELECT situacao FROM envio_prescricao_plataforma WHERE id = ?', [id]);
    expect(ainda!['situacao']).toBe('pendente');
    await fila('pendente');
    const r = await porta.cancelar(ctx(), id, {
      motivo: 'Troca do tratamento',
      versao: Number(e!['versao']),
    });
    expect(r.mensagem).toBeNull();
    const [d] = await ler(
      `SELECT e.situacao, e.motivo_cancelamento, e.cancelado_em, e.excluido_em, s.situacao AS fila
         FROM envio_prescricao_plataforma e JOIN mensagem_integracao_saida s ON s.id = e.mensagem_integracao_saida_id
        WHERE e.id = ?`,
      [id],
    );
    expect(d).toMatchObject({
      situacao: 'cancelada',
      motivo_cancelamento: 'Troca do tratamento',
      excluido_em: null,
      fila: 'cancelada',
    });
    expect(d!['cancelado_em']).not.toBeNull();
  });

  it('com o identificador devolvido, o cancelamento vai à fila da plataforma', async () => {
    const r = await porta.enviar(ctx(), { receita: m.r1, plataforma: 'c2018-plat' });
    // O retorno do worker (o simulador fora de produção): aceita, com identificador, código e endereço.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `retorno-${P}` }, async (e) => {
      await e.executar(
        `UPDATE envio_prescricao_plataforma SET situacao = 'aceita', identificador_externo = 'SIM-C2018',
           codigo_validacao = '123456', url_validacao = 'https://validar.prescricao-simulada.invalid/receita/SIM-C2018',
           versao = versao + 1 WHERE id = ?`,
        [r.id],
      );
      await e.executar("UPDATE mensagem_integracao_saida SET situacao = 'enviada' WHERE id = ?", [
        r.mensagem,
      ]);
    });
    const [e] = await ler('SELECT versao FROM envio_prescricao_plataforma WHERE id = ?', [r.id]);
    const c = await porta.cancelar(ctx(), r.id, {
      motivo: 'Receita substituída',
      versao: Number(e!['versao']),
    });
    expect(c.mensagem).not.toBeNull();
    const [s] = await ler(
      'SELECT situacao, tipo_mensagem, conteudo FROM mensagem_integracao_saida WHERE id = ?',
      [c.mensagem],
    );
    expect(s).toMatchObject({
      situacao: 'pendente',
      tipo_mensagem: 'integracao.prescricao_digital.cancelamento',
    });
    expect(JSON.parse(String(s!['conteudo']))).toMatchObject({
      identificadorExterno: 'SIM-C2018',
      motivo: 'Receita substituída',
    });
    const [env] = await ler('SELECT situacao FROM mensagem_integracao_saida WHERE id = ?', [r.mensagem]);
    expect(env!['situacao']).toBe('enviada');
    expect(await contar('envio_prescricao_plataforma')).toBe(2);
  });
});
