// Contrato de efeito do disparo automático da comunicação de internação e de alta à operadora (C2-070, 06-FAT linha
// 26) contra o MariaDB real (cliente de teste). Massa SINTÉTICA: estabelecimento com o código do teste, três fontes
// fictícias (operadora com o serviço web da comunicação de beneficiário cadastrado, operadora sem, particular), a
// transação do catálogo e o endereço fictícios (.invalid), internações fictícias (chaves de catálogo desligadas só no
// preparo); usuário é id já existente do cliente (só lido). O serviço web não é chamado.
// Prova o que fica no banco: ao internar, a comunicação da internação nasce sozinha (origem 'sistema'); com o serviço
// web cadastrado já sai para a outbox (enviada, mensagem ligada, só IDs, códigos e o hash); sem ele fica pendente;
// com a alta, nasce a da alta; o segundo disparo não duplica; a cancelada pela equipe não renasce; a fonte que não é
// operadora não gera nada; a trilha da operação.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaComunicacaoOperadoraPropria } from './comunicacao-operadora-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c2070dis';
const TRANSACAO = 'C2070_COMUNICACAO_SINTETICA';

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
    await e.executar(
      `DELETE a FROM alta_hospitalar a JOIN internacao i ON i.id = a.internacao_id WHERE i.estabelecimento_id IN ${est}`,
      [P],
    );
    await e.executar(`DELETE FROM endpoint_tiss_fonte_pagadora WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar('DELETE FROM transacao_tiss_webservice WHERE codigo_transacao = ?', [TRANSACAO]);
    await e.executar(`DELETE FROM internacao WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar('DELETE FROM motivo_saida_hospitalar WHERE codigo LIKE ?', [`${P}-%`]);
    await e.executar('DELETE FROM modalidade_internacao WHERE codigo LIKE ?', [`${P}-%`]);
    await e.executar('DELETE FROM fonte_pagadora WHERE codigo LIKE ?', [`${P}-%`]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('Disparo da comunicação à operadora (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaComunicacaoOperadoraPropria;
  let m: {
    est: number;
    usuario: number;
    motivo: number;
    intWeb: number;
    intSem: number;
    intPart: number;
  };
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const comunicacoes = (internacao: number) =>
    ler(
      `SELECT id, tipo, situacao, origem, enviado_em, integracao_mensagem_id, versao
         FROM comunicacao_internacao_operadora WHERE internacao_id = ? ORDER BY id`,
      [internacao],
    );
  const darAlta = (internacao: number) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: `alta-${P}` }, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        await e.inserir(
          `INSERT INTO alta_hospitalar (internacao_id, alta_em, motivo_saida_hospitalar_id, desfecho_internacao_id, destino, situacao, criado_em)
           VALUES (?, '2025-04-06 08:00:00', ?, 1, 'domicilio', 'confirmada', ?)`,
          [internacao, m.motivo, new Date()],
        );
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      if (!usuario?.['id']) throw new Error('O cliente de teste precisa de usuário.');
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, codigo_cnes, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', '9990701', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        const fonte = (sufixo: string, tipo: string, ans: string | null) =>
          e.inserir(
            `INSERT INTO fonte_pagadora (codigo, nome, tipo, registro_ans, criado_em) VALUES (?, ?, ?, ?, ?)`,
            [`${P}-${sufixo}`, `Fonte sintética ${sufixo}`, tipo, ans, agora],
          );
        const opWeb = await fonte('WEB', 'operadora', '999971');
        const opSem = await fonte('SEM', 'operadora', '999972');
        const part = await fonte('PART', 'particular', null);
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
        const motivo = await e.inserir(
          `INSERT INTO motivo_saida_hospitalar (codigo, descricao, tipo_saida, codigo_tiss, criado_em)
           VALUES (?, 'Alta melhorada (sintético)', 'alta', '12', ?)`,
          [`${P}-M1`, agora],
        );
        const modalidade = await e.inserir(
          `INSERT INTO modalidade_internacao (codigo, descricao, codigo_tiss, classificacao, criado_em)
           VALUES (?, 'Clínica (sintético)', NULL, 'clinica', ?)`,
          [`${P}-MOD`, agora],
        );
        const internar = (f: number, n: number) =>
          e.inserir(
            `INSERT INTO internacao (estabelecimento_id, numero, atendimento_id, paciente_id, data_hora_entrada,
               carater_admissao_id, modalidade_internacao_id, unidade_internacao_id, acomodacao_id, especialidade_medica_id,
               medico_assistente_profissional_id, fonte_pagadora_id, numero_carteira, numero_guia, criado_em)
             VALUES (?, ?, ?, ?, '2025-04-02 11:00:00', 1, ?, 1, 1, 1, 1, ?, ?, 'G-2', ?)`,
            [
              est,
              `${P}-${n}`,
              970000000 + est * 10 + n,
              970000000 + est * 10 + n,
              modalidade,
              f,
              `00077700${n}`,
              agora,
            ],
          );
        return {
          est,
          usuario: Number(usuario['id']),
          motivo,
          intWeb: await internar(opWeb, 1),
          intSem: await internar(opSem, 2),
          intPart: await internar(part, 3),
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

  it('ao internar com serviço web, a comunicação nasce e já sai para a outbox; na alta, nasce a da alta', async () => {
    const r = await porta.disparar(ctx(), m.intWeb);
    expect(r.geradas).toEqual([expect.objectContaining({ tipo: 'internacao', situacao: 'enviada' })]);
    const [c] = await comunicacoes(m.intWeb);
    expect(c).toMatchObject({ tipo: 'internacao', situacao: 'enviada', origem: 'sistema', versao: 2 });
    expect(c!['enviado_em']).not.toBeNull();
    const msgs = await ler<Record<string, unknown>>(
      `SELECT ponto, direcao, situacao, entidade_id, conteudo FROM integracao_mensagem WHERE id = ?`,
      [c!['integracao_mensagem_id']],
    );
    expect(msgs[0]).toMatchObject({
      ponto: 'tiss.comunicacao_beneficiario',
      situacao: 'pendente',
      entidade_id: Number(c!['id']),
    });
    expect(JSON.stringify(msgs[0]!['conteudo'])).not.toContain('000777001');
    // Segundo disparo (mesma internação, sem alta): nada novo.
    expect((await porta.disparar(ctx(), m.intWeb)).geradas).toEqual([]);
    await darAlta(m.intWeb);
    const alta = await porta.disparar(ctx(), m.intWeb);
    expect(alta.geradas).toEqual([expect.objectContaining({ tipo: 'alta', situacao: 'enviada' })]);
    expect((await comunicacoes(m.intWeb)).map((x) => [x['tipo'], x['situacao']])).toEqual([
      ['internacao', 'enviada'],
      ['alta', 'enviada'],
    ]);
    const trilha = await ler<{ n: number }>(
      `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND usuario_id = ?
          AND entidade = 'comunicacao_internacao_operadora'`,
      [m.est, m.usuario],
    );
    expect(Number(trilha[0]!.n)).toBeGreaterThanOrEqual(2);
  });

  it('sem serviço web fica pendente; cancelada pela equipe não renasce e a alta espera a internação viva', async () => {
    const r = await porta.disparar(ctx(), m.intSem);
    expect(r.geradas).toEqual([expect.objectContaining({ tipo: 'internacao', situacao: 'pendente' })]);
    const [c] = await comunicacoes(m.intSem);
    expect(c).toMatchObject({ situacao: 'pendente', integracao_mensagem_id: null, origem: 'sistema' });
    await porta.transicao(ctx(), Number(c!['id']), { acao: 'cancelar', versao: 1, resposta: 'Particular' });
    await darAlta(m.intSem);
    expect((await porta.disparar(ctx(), m.intSem)).geradas).toEqual([]);
    expect(await comunicacoes(m.intSem)).toHaveLength(1);
  });

  it('fonte que não é operadora: nada é gerado', async () => {
    expect((await porta.disparar(ctx(), m.intPart)).geradas).toEqual([]);
    expect(await comunicacoes(m.intPart)).toHaveLength(0);
  });
});
