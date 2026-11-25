// Contrato de efeito da consulta de elegibilidade pelo serviço web da operadora (C2-070, 06-FAT linha 26) contra o
// MariaDB real (cliente de teste). Massa SINTÉTICA: estabelecimento com o código do teste, duas fontes fictícias (uma
// com o serviço web de elegibilidade cadastrado, endereço .invalid, outra sem), a transação do catálogo fictícia e
// coberturas com carteiras sintéticas do primeiro paciente do cliente (só o id é lido). O serviço web não é chamado: o
// retorno é escrito na mensagem de integração como o relay e o transmissor deixam.
// Prova o que fica no banco: com o serviço web, a consulta nova sai para a outbox na mesma transação (mensagem pendente
// no ponto tiss.elegibilidade, só IDs e códigos, nunca a carteira) e fica pendente ligada à mensagem; na fila, o
// retorno não muda nada; o recibo elegível grava a situação, o código de validação e a última elegibilidade da
// cobertura; o negado grava o motivo; a falha de envio fica 'erro'; sem serviço web nada vai à outbox e o retorno é
// recusado; a consulta respondida não lê retorno de novo; a trilha da operação. A enviada sem retorno aceita a resposta
// à mão (a recepção nunca fica presa no 'aguardando'); em produção sem transporte TISS nada vai à outbox.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaElegibilidadePropria } from './elegibilidade-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c2070ele';
const TRANSACAO = 'C2070_ELEGIBILIDADE_SINTETICA';
const CARTEIRA = 'SINTC2070EL';

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(
      `DELETE FROM integracao_mensagem WHERE entidade = 'consulta_elegibilidade' AND estabelecimento_id IN ${est}`,
      [P],
    );
    await e.executar(`DELETE FROM consulta_elegibilidade WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar('DELETE FROM cobertura_paciente WHERE numero_carteira LIKE ?', [`${CARTEIRA}%`]);
    await e.executar(`DELETE FROM endpoint_tiss_fonte_pagadora WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar('DELETE FROM transacao_tiss_webservice WHERE codigo_transacao = ?', [TRANSACAO]);
    await e.executar('DELETE FROM fonte_pagadora WHERE codigo LIKE ?', [`${P}-%`]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('Elegibilidade pelo serviço web da operadora (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaElegibilidadePropria;
  let m: { est: number; usuario: number; cobWeb: number; cobSem: number };
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p));
  const consulta = async (id: number) =>
    (
      await ler(
        `SELECT situacao, motivo_negativa, codigo_validacao, respondida_em, integracao_mensagem_id, versao
           FROM consulta_elegibilidade WHERE id = ?`,
        [id],
      )
    )[0]!;
  const servicoDevolve = (
    mensagem: unknown,
    situacao: string,
    resposta: string | null,
    erro: string | null,
  ) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: `servico-${P}` }, (e) =>
      e.executar(
        'UPDATE integracao_mensagem SET situacao = ?, resposta = ?, erro = ?, processada_em = ? WHERE id = ?',
        [situacao, resposta, erro, new Date(), mensagem],
      ),
    );
  /** Nova consulta no mesmo dia: a anterior respondida sai do caminho (a elegível do dia seria reaproveitada). */
  const tirarDoDia = (id: number) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: `dia-${P}` }, (e) =>
      e.executar('UPDATE consulta_elegibilidade SET solicitada_em = ? WHERE id = ?', [
        new Date('2025-01-02T12:00:00Z'),
        id,
      ]),
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const paciente = await e.uma('SELECT MIN(id) AS id FROM paciente WHERE excluido_em IS NULL');
      if (!usuario?.['id'] || !paciente?.['id'])
        throw new Error('O cliente de teste precisa de usuário e paciente.');
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        const fonte = (sufixo: string, ans: string) =>
          e.inserir(
            `INSERT INTO fonte_pagadora (codigo, nome, tipo, registro_ans, criado_em) VALUES (?, ?, 'operadora', ?, ?)`,
            [`${P}-${sufixo}`, `Operadora sintética ${sufixo}`, ans, agora],
          );
        const web = await fonte('WEB', '999961');
        const sem = await fonte('SEM', '999962');
        const transacao = await e.inserir(
          `INSERT INTO transacao_tiss_webservice (versao_tiss, codigo_transacao, nome, tipo_transacao, criado_em)
           VALUES ('4.03.00', ?, 'Verificação de elegibilidade (sintética)', 'elegibilidade', ?)`,
          [TRANSACAO, agora],
        );
        await e.inserir(
          `INSERT INTO endpoint_tiss_fonte_pagadora (estabelecimento_id, fonte_pagadora_id, transacao_tiss_webservice_id,
             forma_envio, url, criado_em) VALUES (?, ?, ?, 'servico_web', 'https://operadora.invalid/elegibilidade', ?)`,
          [est, web, transacao, agora],
        );
        const cobertura = (f: number, carteira: string) =>
          e.inserir(
            `INSERT INTO cobertura_paciente (paciente_id, fonte_pagadora_id, numero_carteira, validade, vigencia_inicio, situacao, criado_em)
             VALUES (?, ?, ?, '2030-12-31', '2026-01-01', 'ativa', ?)`,
            [paciente['id'], f, carteira, agora],
          );
        return {
          est,
          usuario: Number(usuario['id']),
          cobWeb: await cobertura(web, `${CARTEIRA}01`),
          cobSem: await cobertura(sem, `${CARTEIRA}02`),
        };
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
    porta = new PortaElegibilidadePropria(nucleo, CLIENTE);
  }, 60_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar();
    }
  });

  it('com o serviço web, a consulta sai para a outbox; o recibo elegível grava a resposta e a cobertura', async () => {
    const c = await porta.consultar(ctx(), { cobertura: m.cobWeb });
    expect(c).toMatchObject({ situacao: 'pendente', reaproveitada: false, enviada: true });
    const g = await consulta(c.id);
    expect(g).toMatchObject({ situacao: 'pendente', versao: 2 });
    const msg = (
      await ler(
        'SELECT ponto, situacao, entidade, entidade_id, conteudo FROM integracao_mensagem WHERE id = ?',
        [g['integracao_mensagem_id']],
      )
    )[0]!;
    expect(msg).toMatchObject({
      ponto: 'tiss.elegibilidade',
      situacao: 'pendente',
      entidade: 'consulta_elegibilidade',
      entidade_id: c.id,
    });
    expect(JSON.stringify(msg['conteudo'])).not.toContain(CARTEIRA);
    // Na fila: nada muda.
    expect(await porta.retorno(ctx(), c.id)).toMatchObject({ aguardando: true, situacao: 'pendente' });
    expect((await consulta(c.id))['versao']).toBe(2);
    await servicoDevolve(
      g['integracao_mensagem_id'],
      'processada',
      JSON.stringify({ elegivel: true, codigoValidacao: 'VW77' }),
      null,
    );
    expect(await porta.retorno(ctx(), c.id)).toMatchObject({ aguardando: false, situacao: 'elegivel' });
    const r = await consulta(c.id);
    expect(r).toMatchObject({ situacao: 'elegivel', codigo_validacao: 'VW77', motivo_negativa: null });
    expect(r['respondida_em']).not.toBeNull();
    const cob = (
      await ler(
        'SELECT ultima_elegibilidade_em, ultima_elegibilidade_aprovada FROM cobertura_paciente WHERE id = ?',
        [m.cobWeb],
      )
    )[0]!;
    expect(cob['ultima_elegibilidade_em']).not.toBeNull();
    expect(Number(cob['ultima_elegibilidade_aprovada'])).toBe(1);
    // Respondida: o retorno não é lido de novo.
    await expect(porta.retorno(ctx(), c.id)).rejects.toMatchObject({ problema: { status: 422 } });
    await tirarDoDia(c.id);
  });

  it('o negado grava o motivo; a falha de envio fica erro', async () => {
    const n = await porta.consultar(ctx(), { cobertura: m.cobWeb });
    const gn = await consulta(n.id);
    await servicoDevolve(
      gn['integracao_mensagem_id'],
      'processada',
      JSON.stringify({ elegivel: false, motivo: 'Carência' }),
      null,
    );
    await porta.retorno(ctx(), n.id);
    expect(await consulta(n.id)).toMatchObject({
      situacao: 'inelegivel',
      motivo_negativa: 'Carência',
      codigo_validacao: null,
    });
    const f = await porta.consultar(ctx(), { cobertura: m.cobWeb });
    const gf = await consulta(f.id);
    await servicoDevolve(gf['integracao_mensagem_id'], 'erro', null, 'HTTP_503');
    expect(await porta.retorno(ctx(), f.id)).toMatchObject({ situacao: 'erro' });
    expect(String((await consulta(f.id))['motivo_negativa'])).toContain('HTTP_503');
  });

  it('sem o serviço web nada vai à outbox e o retorno é recusado (a resposta fica à mão)', async () => {
    const c = await porta.consultar(ctx(), { cobertura: m.cobSem });
    expect(c).toMatchObject({ enviada: false });
    expect(await consulta(c.id)).toMatchObject({ integracao_mensagem_id: null, versao: 1 });
    await expect(porta.retorno(ctx(), c.id)).rejects.toMatchObject({ problema: { status: 422 } });
    const msgs = await ler(
      `SELECT COUNT(*) AS n FROM integracao_mensagem WHERE entidade = 'consulta_elegibilidade' AND estabelecimento_id = ?`,
      [m.est],
    );
    expect(Number(msgs[0]!['n'])).toBe(3);
    const trilha = await ler(
      `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND usuario_id = ?
          AND entidade = 'consulta_elegibilidade'`,
      [m.est, m.usuario],
    );
    expect(Number(trilha[0]!['n'])).toBeGreaterThanOrEqual(6);
  });

  it('a enviada que não teve retorno aceita a resposta à mão (a recepção não fica presa)', async () => {
    const c = await porta.consultar(ctx(), { cobertura: m.cobWeb });
    expect(c).toMatchObject({ enviada: true });
    expect(await porta.retorno(ctx(), c.id)).toMatchObject({ aguardando: true });
    await porta.responder(ctx(), c.id, { situacao: 'elegivel', codigoValidacao: 'MAO1', versao: 2 });
    expect(await consulta(c.id)).toMatchObject({ situacao: 'elegivel', codigo_validacao: 'MAO1' });
    await tirarDoDia(c.id);
  });

  it('produção sem transporte: a consulta não vai à outbox e a resposta fica à mão', async () => {
    const antes = process.env['AMBIENTE'];
    process.env['AMBIENTE'] = 'producao';
    const criadas: number[] = [];
    try {
      const c = await porta.consultar(ctx(), { cobertura: m.cobWeb });
      expect(c).toMatchObject({ situacao: 'pendente', enviada: false });
      criadas.push(c.id);
    } finally {
      if (antes === undefined) delete process.env['AMBIENTE'];
      else process.env['AMBIENTE'] = antes;
    }
    const id = criadas[0]!;
    expect(await consulta(id)).toMatchObject({ integracao_mensagem_id: null, versao: 1 });
    const msgs = await ler(
      `SELECT COUNT(*) AS n FROM integracao_mensagem WHERE entidade = 'consulta_elegibilidade' AND entidade_id = ?`,
      [id],
    );
    expect(Number(msgs[0]!['n'])).toBe(0);
    await porta.responder(ctx(), id, { situacao: 'inelegivel', motivoNegativa: 'Carência', versao: 1 });
    expect(await consulta(id)).toMatchObject({ situacao: 'inelegivel', motivo_negativa: 'Carência' });
  });
});
