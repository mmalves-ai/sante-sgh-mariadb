// Contrato de efeito do envio da comunicação de internação e alta pelo serviço web da operadora e da leitura do retorno
// (C1-108, 04-INT linha 80) contra o MariaDB real (cliente de teste). Massa SINTÉTICA: estabelecimento com o código do
// teste, duas operadoras fictícias (uma com o serviço web da comunicação de beneficiário cadastrado, outra sem), a
// transação do catálogo e o endereço fictícios, três internações fictícias (chaves de catálogo desligadas só no
// preparo); usuário é id já existente do cliente (só lido). O serviço web não é chamado: o retorno é escrito na mensagem
// de integração como o relay e o transmissor deixam (situação, recibo JSON ou código de erro).
// Prova o que fica no banco: sem serviço web cadastrado o envio é recusado sem gravar mensagem; com ele, a comunicação
// fica 'enviada' com enviado_em e integracao_mensagem_id, e a outbox tem a mensagem pendente de saída no ponto da
// comunicação de beneficiário com só IDs, códigos e o hash (nada da carteira); retorno na fila não muda nada; recibo
// aceito confirma com o protocolo; erro falha com o código; reenvio gera mensagem nova; recibo recusado rejeita com o
// motivo; comunicação marcada à mão não lê retorno; a trilha da operação.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaComunicacaoOperadoraPropria } from './comunicacao-operadora-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c1108com';
const TRANSACAO = 'C1108_COMUNICACAO_SINTETICA';

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(
      `DELETE FROM integracao_mensagem WHERE entidade = 'comunicacao_internacao_operadora' AND estabelecimento_id IN ${est}`,
      [P],
    );
    await e.executar(
      `DELETE co FROM comunicacao_internacao_operadora co JOIN internacao i ON i.id = co.internacao_id
        WHERE i.estabelecimento_id IN ${est}`,
      [P],
    );
    await e.executar(`DELETE FROM endpoint_tiss_fonte_pagadora WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar('DELETE FROM transacao_tiss_webservice WHERE codigo_transacao = ?', [TRANSACAO]);
    await e.executar(`DELETE FROM internacao WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar('DELETE FROM modalidade_internacao WHERE codigo LIKE ?', [`${P}-%`]);
    await e.executar('DELETE FROM fonte_pagadora WHERE codigo LIKE ?', [`${P}-%`]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('Comunicação à operadora pelo serviço web (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaComunicacaoOperadoraPropria;
  let m: { est: number; usuario: number; intSem: number; int1: number; int2: number };
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const linha = async (id: number) =>
    (
      await ler(
        'SELECT situacao, protocolo, resposta, enviado_em, respondido_em, integracao_mensagem_id, versao FROM comunicacao_internacao_operadora WHERE id = ?',
        [id],
      )
    )[0]!;
  const mensagens = async () =>
    ler(
      `SELECT id, ponto, direcao, situacao, entidade, entidade_id, conteudo FROM integracao_mensagem
        WHERE entidade = 'comunicacao_internacao_operadora' AND estabelecimento_id = ? ORDER BY id`,
      [m.est],
    );
  /** O que o relay e o transmissor deixam na mensagem (o serviço web não é chamado no teste). */
  const servicoDevolve = (mensagem: number, situacao: string, resposta: string | null, erro: string | null) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: `servico-${P}` }, (e) =>
      e.executar(
        'UPDATE integracao_mensagem SET situacao = ?, resposta = ?, erro = ?, processada_em = ? WHERE id = ?',
        [situacao, resposta, erro, new Date(), mensagem],
      ),
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      if (!usuario?.['id']) throw new Error('O cliente de teste precisa de usuário.');
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, codigo_cnes, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', NULL, ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        const opWeb = await e.inserir(
          `INSERT INTO fonte_pagadora (codigo, nome, tipo, registro_ans, criado_em) VALUES (?, ?, 'operadora', '999981', ?)`,
          [`${P}-WEB`, 'Operadora sintética com serviço web', agora],
        );
        const opSem = await e.inserir(
          `INSERT INTO fonte_pagadora (codigo, nome, tipo, registro_ans, criado_em) VALUES (?, ?, 'operadora', '999982', ?)`,
          [`${P}-SEM`, 'Operadora sintética sem serviço web', agora],
        );
        const transacao = await e.inserir(
          `INSERT INTO transacao_tiss_webservice (versao_tiss, codigo_transacao, nome, tipo_transacao, criado_em)
           VALUES ('4.03.00', ?, 'Comunicação de beneficiário (sintética)', 'comunicacao_beneficiario', ?)`,
          [TRANSACAO, agora],
        );
        await e.inserir(
          `INSERT INTO endpoint_tiss_fonte_pagadora (estabelecimento_id, fonte_pagadora_id, transacao_tiss_webservice_id,
             forma_envio, url, criado_em) VALUES (?, ?, ?, 'servico_web', 'https://operadora.invalid/comunicacao', ?)`,
          [est, opWeb, transacao, agora],
        );
        const modalidade = await e.inserir(
          `INSERT INTO modalidade_internacao (codigo, descricao, codigo_tiss, classificacao, criado_em)
           VALUES (?, 'Clínica (sintético)', NULL, 'clinica', ?)`,
          [`${P}-MOD`, agora],
        );
        const internar = (fonte: number, n: number) =>
          e.inserir(
            `INSERT INTO internacao (estabelecimento_id, numero, atendimento_id, paciente_id, data_hora_entrada,
               carater_admissao_id, modalidade_internacao_id, unidade_internacao_id, acomodacao_id, especialidade_medica_id,
               medico_assistente_profissional_id, fonte_pagadora_id, numero_carteira, numero_guia, criado_em)
             VALUES (?, ?, ?, ?, '2025-04-02 11:00:00', 1, ?, 1, 1, 1, 1, ?, ?, 'G-2', ?)`,
            [
              est,
              `${P}-${n}`,
              980000000 + est * 10 + n,
              980000000 + est * 10 + n,
              modalidade,
              fonte,
              `00088800${n}`,
              agora,
            ],
          );
        return {
          est,
          usuario: Number(usuario['id']),
          intSem: await internar(opSem, 1),
          int1: await internar(opWeb, 2),
          int2: await internar(opWeb, 3),
        };
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
    porta = new PortaComunicacaoOperadoraPropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  });

  it('sem o serviço web cadastrado o envio é recusado sem gravar mensagem; a marcada à mão não lê retorno', async () => {
    const { id } = await porta.registrar(ctx(), m.intSem, { tipo: 'internacao' });
    await expect(porta.transmitir(ctx(), id, { versao: 1 })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    expect(await linha(id)).toMatchObject({ situacao: 'pendente', integracao_mensagem_id: null, versao: 1 });
    expect(await mensagens()).toHaveLength(0);
    await porta.transicao(ctx(), id, { acao: 'enviar', versao: 1 });
    await expect(porta.retorno(ctx(), id)).rejects.toMatchObject({ problema: { status: 422 } });
  });

  it('envia pela outbox, aguarda na fila e confirma com o protocolo do recibo', async () => {
    const { id } = await porta.registrar(ctx(), m.int1, { tipo: 'internacao' });
    await expect(porta.transmitir(ctx(), id, { versao: 9 })).rejects.toMatchObject({
      problema: { status: 409 },
    });
    const t = await porta.transmitir(ctx(), id, { versao: 1 });
    expect(t.situacao).toBe('enviada');
    const l = await linha(id);
    expect(l).toMatchObject({ situacao: 'enviada', integracao_mensagem_id: t.mensagem, respondido_em: null });
    expect(l['enviado_em']).not.toBeNull();
    const [msg] = await mensagens();
    expect(msg).toMatchObject({
      id: t.mensagem,
      ponto: 'tiss.comunicacao_beneficiario',
      direcao: 'saida',
      situacao: 'pendente',
      entidade: 'comunicacao_internacao_operadora',
      entidade_id: id,
    });
    const carga = JSON.parse(String(msg!['conteudo'])) as Record<string, unknown>;
    expect(carga).toMatchObject({ comunicacao: id, internacao: m.int1, tipo: 'internacao' });
    expect(String(carga['hash'])).toMatch(/^[0-9a-f]{32}$/);
    expect(String(msg!['conteudo'])).not.toContain('000888002');
    // Envio em dobro: a comunicação já não está pendente.
    await expect(porta.transmitir(ctx(), id, { versao: 2 })).rejects.toMatchObject({
      problema: { status: 422 },
    });

    expect(await porta.retorno(ctx(), id)).toMatchObject({ situacao: 'enviada', aguardando: true });
    await servicoDevolve(t.mensagem, 'enviada', null, null);
    expect(await porta.retorno(ctx(), id)).toMatchObject({ aguardando: true });
    expect((await linha(id))['versao']).toBe(2);
    await servicoDevolve(
      t.mensagem,
      'processada',
      JSON.stringify({ aceita: true, protocolo: 'PR-1108' }),
      null,
    );
    expect(await porta.retorno(ctx(), id)).toMatchObject({ situacao: 'confirmada', aguardando: false });
    const c = await linha(id);
    expect(c).toMatchObject({ situacao: 'confirmada', protocolo: 'PR-1108', versao: 3 });
    expect(c['respondido_em']).not.toBeNull();
    const [lida] = await porta.comunicacoes(ctx(), m.int1);
    expect(lida).toMatchObject({ pelaIntegracao: true, situacaoEnvio: 'processada' });
  });

  it('erro falha com o código, o reenvio gera mensagem nova e o recibo recusado rejeita com o motivo', async () => {
    const { id } = await porta.registrar(ctx(), m.int2, { tipo: 'internacao' });
    const t1 = await porta.transmitir(ctx(), id, { versao: 1 });
    await servicoDevolve(t1.mensagem, 'erro', null, 'tempo-esgotado');
    expect(await porta.retorno(ctx(), id)).toMatchObject({ situacao: 'erro' });
    expect(await linha(id)).toMatchObject({
      situacao: 'erro',
      resposta: 'Falha no envio pelo serviço web (tempo-esgotado).',
      respondido_em: null,
      versao: 3,
    });
    await porta.transicao(ctx(), id, { acao: 'reenviar', versao: 3 });
    const t2 = await porta.transmitir(ctx(), id, { versao: 4 });
    expect(t2.mensagem).not.toBe(t1.mensagem);
    await servicoDevolve(
      t2.mensagem,
      'processada',
      JSON.stringify({ aceita: false, motivo: 'Beneficiário sem cobertura de internação' }),
      null,
    );
    await porta.retorno(ctx(), id);
    const r = await linha(id);
    expect(r).toMatchObject({
      situacao: 'rejeitada',
      resposta: 'Beneficiário sem cobertura de internação',
      integracao_mensagem_id: t2.mensagem,
    });
    expect(r['respondido_em']).not.toBeNull();
    const todas = (await mensagens()).filter((x) => x['entidade_id'] === id);
    expect(todas.map((x) => x['situacao'])).toEqual(['erro', 'processada']);
    const trilha = await ler<{ n: number }>(
      `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND usuario_id = ?
          AND entidade = 'comunicacao_internacao_operadora'`,
      [m.est, m.usuario],
    );
    expect(Number(trilha[0]!.n)).toBeGreaterThanOrEqual(10);
  });
});
