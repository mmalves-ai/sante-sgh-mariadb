// Contrato de efeito da comunicação da internação e da alta à operadora (F78.04-2, 04-INT linha 80) contra o MariaDB
// real (cliente de teste). Massa SINTÉTICA: estabelecimento com o código do teste, duas fontes pagadoras fictícias (uma
// operadora com registro e uma pública), duas internações e um motivo de saída fictícios (chaves de catálogo
// desligadas só no preparo); usuário é id já existente do cliente (só lido).
// Prova o que fica no banco: a comunicação da internação nasce pendente com a fonte da internação, a segunda viva do
// mesmo tipo e a alta antes da alta registrada são recusadas sem gravar, a fonte pública é recusada, a mensagem de
// comunicação de beneficiário sai dos dados gravados (registro, carteira, evento, motivo de encerramento da alta), as
// transições gravam situação, datas, protocolo e resposta com a versão lida, o cancelamento guarda o motivo (nada
// apagado), o isolamento por estabelecimento e a trilha da operação.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaComunicacaoOperadoraPropria } from './comunicacao-operadora-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'f7804com';

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(
      `DELETE co FROM comunicacao_internacao_operadora co JOIN internacao i ON i.id = co.internacao_id
        WHERE i.estabelecimento_id IN ${est}`,
      [P],
    );
    await e.executar(
      `DELETE a FROM alta_hospitalar a JOIN internacao i ON i.id = a.internacao_id WHERE i.estabelecimento_id IN ${est}`,
      [P],
    );
    await e.executar(`DELETE FROM internacao WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar('DELETE FROM motivo_saida_hospitalar WHERE codigo LIKE ?', [`${P}-%`]);
    await e.executar('DELETE FROM fonte_pagadora WHERE codigo LIKE ?', [`${P}-%`]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('PortaComunicacaoOperadoraPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaComunicacaoOperadoraPropria;
  let m: { est: number; usuario: number; op: number; int: number; intPublica: number; motivo: number };
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const contar = async (int: number) =>
    Number(
      (
        await ler<{ n: number }>(
          'SELECT COUNT(*) AS n FROM comunicacao_internacao_operadora WHERE internacao_id = ?',
          [int],
        )
      )[0]!.n,
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
        const op = await e.inserir(
          `INSERT INTO fonte_pagadora (codigo, nome, tipo, registro_ans, criado_em) VALUES (?, ?, 'operadora', '999991', ?)`,
          [`${P}-OP`, 'Operadora sintética', agora],
        );
        const pub = await e.inserir(
          `INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'publico', ?)`,
          [`${P}-PUB`, 'Fonte pública sintética', agora],
        );
        const motivo = await e.inserir(
          `INSERT INTO motivo_saida_hospitalar (codigo, descricao, tipo_saida, codigo_tiss, criado_em)
           VALUES (?, 'Alta melhorada (sintético)', 'alta', '12', ?)`,
          [`${P}-M1`, agora],
        );
        const internar = (fonte: number, n: string, carteira: string | null) =>
          e.inserir(
            `INSERT INTO internacao (estabelecimento_id, numero, atendimento_id, paciente_id, data_hora_entrada,
               carater_admissao_id, modalidade_internacao_id, unidade_internacao_id, acomodacao_id, especialidade_medica_id,
               medico_assistente_profissional_id, fonte_pagadora_id, numero_carteira, numero_guia, criado_em)
             VALUES (?, ?, ?, ?, '2025-03-01 10:20:30', 1, 1, 1, 1, 1, 1, ?, ?, 'G-1', ?)`,
            [
              est,
              n,
              990000000 + est * 10 + (fonte % 7),
              990000000 + est * 10 + (fonte % 7),
              fonte,
              carteira,
              agora,
            ],
          );
        return {
          est,
          usuario: Number(usuario['id']),
          op,
          int: await internar(op, `${P}-1`, '0009990001'),
          intPublica: await internar(pub, `${P}-2`, null),
          motivo,
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

  it('a internação nasce pendente com a fonte da internação; repetida, alta sem alta e fonte pública são recusadas', async () => {
    const { id } = await porta.registrar(ctx(), m.int, { tipo: 'internacao' });
    const [r] = await ler<Record<string, unknown>>(
      'SELECT internacao_id, fonte_pagadora_id, tipo, situacao, enviado_em, origem, criado_por FROM comunicacao_internacao_operadora WHERE id = ?',
      [id],
    );
    expect(r).toMatchObject({
      internacao_id: m.int,
      fonte_pagadora_id: m.op,
      tipo: 'internacao',
      situacao: 'pendente',
      enviado_em: null,
      origem: 'sistema',
      criado_por: m.usuario,
    });
    await expect(porta.registrar(ctx(), m.int, { tipo: 'internacao' })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    await expect(porta.registrar(ctx(), m.int, { tipo: 'alta' })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    await expect(porta.registrar(ctx(), m.intPublica, { tipo: 'internacao' })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    expect(await contar(m.int)).toBe(1);
    expect(await contar(m.intPublica)).toBe(0);
    await expect(
      porta.registrar({ ...ctx(), hospital: 'inexistente-x' }, m.int, { tipo: 'internacao' }),
    ).rejects.toMatchObject({
      problema: { status: 404 },
    });
    const msg = await porta.mensagem(ctx(), id);
    expect(msg.problemas).toEqual([]);
    expect(msg.xml).toContain('<ans:registroANS>999991</ans:registroANS>');
    expect(msg.xml).toContain('<ans:numeroCarteira>0009990001</ans:numeroCarteira>');
    expect(msg.xml).toContain('<ans:tipoEvento>I</ans:tipoEvento>');
    expect(msg.xml).toContain('<ans:numeroGuiaOperadora>G-1</ans:numeroGuiaOperadora>');
  });

  it('transições gravam situação, datas, protocolo e resposta; cancelar guarda o motivo; alta depois da alta registrada', async () => {
    const [c] = await porta.comunicacoes(ctx(), m.int);
    await expect(
      porta.transicao(ctx(), c!.id, { acao: 'confirmar', versao: c!.versao, protocolo: 'X' }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await porta.transicao(ctx(), c!.id, { acao: 'enviar', versao: c!.versao });
    let [l] = await porta.comunicacoes(ctx(), m.int);
    expect(l).toMatchObject({ situacao: 'enviada', respondidoEm: null });
    expect(l!.enviadoEm).not.toBeNull();
    await expect(
      porta.transicao(ctx(), c!.id, { acao: 'confirmar', versao: c!.versao, protocolo: 'P-1' }),
    ).rejects.toMatchObject({
      problema: { status: 409 },
    });
    await porta.transicao(ctx(), c!.id, { acao: 'confirmar', versao: l!.versao, protocolo: 'P-1' });
    [l] = await porta.comunicacoes(ctx(), m.int);
    expect(l).toMatchObject({ situacao: 'confirmada', protocolo: 'P-1' });
    expect(l!.respondidoEm).not.toBeNull();

    await nucleo.escrever({ cliente: CLIENTE, correlacao: `alta-${P}` }, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        await e.inserir(
          `INSERT INTO alta_hospitalar (internacao_id, alta_em, motivo_saida_hospitalar_id, desfecho_internacao_id, destino, situacao, criado_em)
           VALUES (?, '2025-03-05 08:00:00', ?, 1, 'domicilio', 'confirmada', ?)`,
          [m.int, m.motivo, new Date()],
        );
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
    await expect(porta.registrar(ctx(), m.int, { tipo: 'obito' })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    const alta = await porta.registrar(ctx(), m.int, { tipo: 'alta' });
    const msg = await porta.mensagem(ctx(), alta.id);
    expect(msg.xml).toContain('<ans:tipoEvento>A</ans:tipoEvento>');
    expect(msg.xml).toContain('<ans:dataEvento>2025-03-05</ans:dataEvento>');
    expect(msg.xml).toContain('<ans:motivoEncerramento>12</ans:motivoEncerramento>');
    await porta.transicao(ctx(), alta.id, { acao: 'falhar', versao: 1, resposta: 'Sem resposta do serviço' });
    await expect(porta.transicao(ctx(), alta.id, { acao: 'cancelar', versao: 2 })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    await porta.transicao(ctx(), alta.id, {
      acao: 'cancelar',
      versao: 2,
      resposta: 'Comunicada por outro canal',
    });
    const [r] = await ler<Record<string, unknown>>(
      'SELECT situacao, resposta, enviado_em, versao FROM comunicacao_internacao_operadora WHERE id = ?',
      [alta.id],
    );
    expect(r).toMatchObject({ situacao: 'cancelada', resposta: 'Comunicada por outro canal', versao: 3 });
    expect(r!['enviado_em']).not.toBeNull();
    expect(await contar(m.int)).toBe(2);
    const trilha = await ler<{ n: number }>(
      `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND usuario_id = ?
          AND entidade = 'comunicacao_internacao_operadora'`,
      [m.est, m.usuario],
    );
    expect(Number(trilha[0]!.n)).toBeGreaterThanOrEqual(6);
  });
});
