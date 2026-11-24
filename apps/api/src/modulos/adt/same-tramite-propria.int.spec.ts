// Contrato de efeito do SAME: protocolo em lote entre setores e solicitação/empréstimo de prontuário (F3.9, 04-HOT L127
// e L128) contra o MariaDB real (cliente de teste, com a migração 96_same_emprestimo). Massa SINTÉTICA: estabelecimento
// com o código do teste, dois setores, um arquivo, dois setores de trâmite e dois volumes; usuário, paciente e tipo de
// documento são ids já existentes do cliente de teste (só lidos, nunca alterados).
// Prova o que fica no banco: o lote com os itens em sequência, a conferência item a item (recebido com instante e quem,
// recusado com motivo) e a situação do lote pelos itens; o cancelamento sem apagar; a solicitação com os itens; o
// empréstimo com o prazo do motivo, o volume emprestado fora do local e a solicitação atendida em parte; a cobrança do
// atraso e a devolução que devolve o volume ao arquivo.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaSameTramitePropria } from './same-tramite-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'f395trm';

interface Massa {
  est: number;
  usuario: number;
  paciente: number;
  setorA: number;
  setorB: number;
  arquivo: number;
  trA: number;
  trB: number;
  v1: number;
  v2: number;
}

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(`DELETE FROM emprestimo_prontuario WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(
      `DELETE i FROM solicitacao_prontuario_item i JOIN solicitacao_prontuario s ON s.id = i.solicitacao_prontuario_id
        WHERE s.estabelecimento_id IN ${est}`,
      [P],
    );
    await e.executar(`DELETE FROM solicitacao_prontuario WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(
      `DELETE i FROM protocolo_tramite_item i JOIN protocolo_tramite p ON p.id = i.protocolo_tramite_id
        WHERE p.estabelecimento_id IN ${est}`,
      [P],
    );
    await e.executar(`DELETE FROM protocolo_tramite WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM volume_prontuario WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar('DELETE FROM setor_tramite WHERE codigo LIKE ?', [`${P}-%`]);
    await e.executar(`DELETE FROM local_arquivo WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM setor_funcional WHERE estabelecimento_id IN ${est}`, [P]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('PortaSameTramitePropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaSameTramitePropria;
  let m: Massa;
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const um = async (sql: string, p: unknown[] = []) => (await ler(sql, p))[0]!;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const paciente = await e.uma('SELECT MIN(id) AS id FROM paciente WHERE excluido_em IS NULL');
      const tipo = await e.uma('SELECT MIN(id) AS id FROM tipo_documento_arquivo');
      if (!usuario?.['id'] || !paciente?.['id'] || !tipo?.['id'])
        throw new Error('O cliente de teste precisa de usuário, paciente e tipo de documento do arquivo.');
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const setor = (c: string) =>
        e.inserir(
          `INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, ?, 'administrativo', ?)`,
          [est, `${P}-${c}`, `Setor sintético ${c}`, agora],
        );
      const setorA = await setor('A');
      const setorB = await setor('B');
      const arquivo = await e.inserir(
        `INSERT INTO local_arquivo (estabelecimento_id, nivel, codigo, descricao, caminho, ativo, criado_em)
         VALUES (?, 'arquivo', ?, 'Arquivo sintético', 'Arquivo sintético', TRUE, ?)`,
        [est, `${P}-ARQ`, agora],
      );
      const tr = (c: string, t: string, local: number | null) =>
        e.inserir(
          `INSERT INTO setor_tramite (codigo, descricao, tipo, local_arquivo_id, registra_movimento, ativo, criado_em)
           VALUES (?, ?, ?, ?, TRUE, TRUE, ?)`,
          [`${P}-${c}`, `Trâmite sintético ${c}`, t, local, agora],
        );
      const trA = await tr('A', 'arquivo', arquivo);
      const trB = await tr('B', 'faturamento', null);
      const volume = (n: number) =>
        e.inserir(
          `INSERT INTO volume_prontuario (estabelecimento_id, paciente_id, tipo_documento_arquivo_id, numero_volume,
             local_arquivo_id, aberto_em, abertura_usuario_id, no_local, situacao, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, 'arquivado', ?)`,
          [est, paciente['id'], tipo['id'], n, arquivo, agora, usuario['id'], agora],
        );
      return {
        est,
        usuario: Number(usuario['id']),
        paciente: Number(paciente['id']),
        setorA,
        setorB,
        arquivo,
        trA,
        trB,
        v1: await volume(1),
        v2: await volume(2),
      };
    });
    porta = new PortaSameTramitePropria(nucleo, CLIENTE);
  }, 60_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar();
    }
  });

  it('emite o lote com os itens e recebe item a item até fechar', async () => {
    const r = await porta.emitirProtocolo(ctx(), {
      remetente: m.trA,
      destinatario: m.trB,
      itens: [
        { tipo: 'volume_prontuario', alvo: m.v1 },
        { tipo: 'volume_prontuario', alvo: m.v2 },
        { tipo: 'documento', descricao: 'Termo de consentimento avulso' },
      ],
    });
    expect(r.itens).toBe(3);
    const p = await um('SELECT * FROM protocolo_tramite WHERE id = ?', [r.id]);
    expect(p).toMatchObject({ situacao: 'enviado', tipo_conteudo: 'misto', estabelecimento_id: m.est });
    expect(p['enviado_em']).not.toBeNull();
    const itens = await ler(
      'SELECT id, sequencia, tipo_item, recebido FROM protocolo_tramite_item WHERE protocolo_tramite_id = ? ORDER BY sequencia',
      [r.id],
    );
    expect(itens.map((i) => [Number(i['sequencia']), i['tipo_item']])).toEqual([
      [1, 'volume_prontuario'],
      [2, 'volume_prontuario'],
      [3, 'documento'],
    ]);
    const ids = itens.map((i) => Number(i['id']));
    const a = await porta.receber(ctx(), r.id, { itens: [{ item: ids[0], aceito: true }], versao: 1 });
    expect(a.situacao).toBe('recebido_parcial');
    await expect(
      porta.receber(ctx(), r.id, { itens: [{ item: ids[1], aceito: false }], versao: 2 }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await expect(
      porta.receber(ctx(), r.id, { itens: [{ item: ids[0], aceito: true }], versao: 2 }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    const b = await porta.receber(ctx(), r.id, {
      itens: [
        { item: ids[1], aceito: false, motivo: 'Volume sem a folha de rosto' },
        { item: ids[2], aceito: true },
      ],
      versao: 2,
    });
    expect(b.situacao).toBe('recebido');
    const fim = await um(
      'SELECT situacao, recebido_em, recebedor_usuario_id FROM protocolo_tramite WHERE id = ?',
      [r.id],
    );
    expect(fim['situacao']).toBe('recebido');
    expect(fim['recebido_em']).not.toBeNull();
    expect(Number(fim['recebedor_usuario_id'])).toBe(m.usuario);
    const conf = await ler(
      'SELECT recebido, recebido_em, recusado, motivo_recusa FROM protocolo_tramite_item WHERE protocolo_tramite_id = ? ORDER BY sequencia',
      [r.id],
    );
    expect(conf.map((i) => [Number(i['recebido']), Number(i['recusado']), i['motivo_recusa']])).toEqual([
      [1, 0, null],
      [0, 1, 'Volume sem a folha de rosto'],
      [1, 0, null],
    ]);
    const lido = await porta.protocolo(ctx(), r.id);
    expect(lido.itens.filter((i) => i.recebido)).toHaveLength(2);
  });

  it('cancela o lote ainda não conferido, com motivo e sem apagar', async () => {
    const r = await porta.emitirProtocolo(ctx(), {
      remetente: m.trB,
      destinatario: m.trA,
      itens: [{ tipo: 'documento', descricao: 'Ofício sintético' }],
    });
    const fila = await porta.protocolos(ctx(), { setor: m.trA, sentido: 'entrada', abertos: true });
    expect(fila.map((x) => x.id)).toContain(r.id);
    await porta.cancelarProtocolo(ctx(), r.id, { motivo: 'Emitido por engano', versao: 1 });
    const p = await um(
      'SELECT situacao, motivo_cancelamento, cancelado_em, excluido_em FROM protocolo_tramite WHERE id = ?',
      [r.id],
    );
    expect(p).toMatchObject({
      situacao: 'cancelado',
      motivo_cancelamento: 'Emitido por engano',
      excluido_em: null,
    });
    await expect(
      porta.cancelarProtocolo(ctx(), r.id, { motivo: 'De novo', versao: 2 }),
    ).rejects.toMatchObject({
      problema: { status: 422 },
    });
  });

  it('solicita, empresta com o prazo do motivo, cobra o atraso e devolve ao arquivo', async () => {
    const motivo = Number(
      (await um("SELECT id FROM motivo_solicitacao_prontuario WHERE codigo = 'auditoria'"))['id'],
    );
    const s = await porta.solicitar(ctx(), {
      localArquivo: m.arquivo,
      destino: m.trB,
      motivo,
      itens: [
        { paciente: m.paciente, volume: m.v1 },
        { paciente: m.paciente, volume: m.v2 },
      ],
    });
    expect(
      Number(
        (
          await um(
            'SELECT COUNT(*) AS n FROM solicitacao_prontuario_item WHERE solicitacao_prontuario_id = ?',
            [s.id],
          )
        )['n'],
      ),
    ).toBe(2);
    expect((await porta.solicitacoesAbertas(ctx())).map((x) => x.id)).toContain(s.id);

    const v = await um('SELECT versao FROM volume_prontuario WHERE id = ?', [m.v1]);
    const e = await porta.emprestar(ctx(), {
      volume: m.v1,
      destinoSetor: m.setorB,
      solicitacao: s.id,
      versao: Number(v['versao']),
    });
    expect(e.solicitacao).toBe('atendida_parcial');
    const emp = await um('SELECT * FROM emprestimo_prontuario WHERE id = ?', [e.id]);
    expect(emp).toMatchObject({ situacao: 'emprestado', solicitacao_prontuario_id: s.id });
    expect(Number(emp['motivo_solicitacao_prontuario_id'])).toBe(motivo);
    const dias =
      (new Date(emp['prazo_devolucao'] as Date).getTime() -
        new Date(emp['emprestado_em'] as Date).getTime()) /
      86_400_000;
    expect(Math.round(dias)).toBe(5);
    const vol = await um('SELECT situacao, no_local, versao FROM volume_prontuario WHERE id = ?', [m.v1]);
    expect([vol['situacao'], Number(vol['no_local'])]).toEqual(['emprestado', 0]);
    expect((await um('SELECT situacao FROM solicitacao_prontuario WHERE id = ?', [s.id]))['situacao']).toBe(
      'atendida_parcial',
    );
    expect(
      (
        await um(
          'SELECT situacao FROM solicitacao_prontuario_item WHERE solicitacao_prontuario_id = ? AND volume_prontuario_id = ?',
          [s.id, m.v1],
        )
      )['situacao'],
    ).toBe('emprestado');
    await expect(
      porta.emprestar(ctx(), { volume: m.v1, destinoSetor: m.setorA, motivo, versao: Number(vol['versao']) }),
    ).rejects.toMatchObject({ problema: { status: 422 } });

    // No prazo, não se cobra; vencido, cobra e aparece nos atrasados.
    await expect(porta.cobrar(ctx(), e.id, 1)).rejects.toMatchObject({ problema: { status: 422 } });
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `prazo-${P}` }, (w) =>
      w.executar(
        'UPDATE emprestimo_prontuario SET emprestado_em = NOW(3) - INTERVAL 9 DAY, prazo_devolucao = NOW(3) - INTERVAL 4 DAY WHERE id = ?',
        [e.id],
      ),
    );
    const atrasados = await porta.emprestimos(ctx(), { paciente: null, atrasados: true });
    expect(atrasados.find((x) => x.id === e.id)?.diasAtraso).toBe(4);
    expect((await porta.cobrar(ctx(), e.id, 1)).cobrancas).toBe(1);
    const cob = await um(
      'SELECT cobrancas_enviadas, ultima_cobranca_em FROM emprestimo_prontuario WHERE id = ?',
      [e.id],
    );
    expect(Number(cob['cobrancas_enviadas'])).toBe(1);
    expect(cob['ultima_cobranca_em']).not.toBeNull();

    const d = await porta.devolver(ctx(), e.id, { versao: 2 });
    expect(d.diasAtraso).toBe(4);
    const dev = await um(
      'SELECT situacao, devolvido_em, recebedor_usuario_id FROM emprestimo_prontuario WHERE id = ?',
      [e.id],
    );
    expect(dev['situacao']).toBe('devolvido');
    expect(dev['devolvido_em']).not.toBeNull();
    expect(Number(dev['recebedor_usuario_id'])).toBe(m.usuario);
    const volta = await um('SELECT situacao, no_local FROM volume_prontuario WHERE id = ?', [m.v1]);
    expect([volta['situacao'], Number(volta['no_local'])]).toEqual(['arquivado', 1]);
    const doPaciente = await porta.emprestimos(ctx(), { paciente: m.paciente, atrasados: false });
    expect(doPaciente.find((x) => x.id === e.id)).toMatchObject({ situacao: 'devolvido', diasAtraso: 0 });
  });
});
