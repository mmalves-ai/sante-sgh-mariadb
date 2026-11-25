// Contrato de efeito do SAME: protocolo em lote entre setores e solicitação/empréstimo de prontuário (F3.9, 04-HOT L127
// e L128) contra o MariaDB real (cliente de teste, com a migração 96_same_emprestimo). Massa SINTÉTICA: estabelecimento
// com o código do teste, dois setores, um arquivo, dois setores de trâmite e dois volumes; usuário, paciente e tipo de
// documento são ids já existentes do cliente de teste (só lidos, nunca alterados).
// Prova o que fica no banco: o lote com os itens em sequência, a conferência item a item (recebido com instante e quem,
// recusado com motivo) e a situação do lote pelos itens; o cancelamento sem apagar; a solicitação com os itens; o
// empréstimo com o prazo do motivo, o volume emprestado fora do local e a solicitação atendida em parte; a cobrança do
// atraso e a devolução que devolve o volume ao arquivo. Custódia única com a guarda (F3.9-4): o volume recebido no lote
// ganha o movimento da guarda e a nova posse; o volume em trânsito ou emprestado não entra em outro lote nem sai por
// empréstimo; o empréstimo e a devolução aparecem no histórico da guarda; a devolução pela guarda fecha o empréstimo; a
// saída por empréstimo feita na guarda entra nos atrasados e é cobrada; a devolução restaura a situação 'aberto'; a
// solicitação sai da fila por item não localizado e por cancelamento com motivo; o motivo que exige autorização deixa a
// solicitação aguardando, barra a entrega até a decisão de outro usuário e grava quem e quando (migração 97).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaSameGuardaPropria } from './same-guarda-propria.js';
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
  v3: number;
  v4: number;
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
    await e.executar(`DELETE FROM movimento_prontuario WHERE estabelecimento_id IN ${est}`, [P]);
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
  let guarda: PortaSameGuardaPropria;
  const versaoVolume = async (v: number) =>
    Number((await um('SELECT versao FROM volume_prontuario WHERE id = ?', [v]))['versao']);
  const movimentos = (v: number) =>
    ler(
      `SELECT op.tipo, m.protocolo_tramite_id, m.destino_setor_funcional_id, m.previsao_retorno, m.devolvido_em
         FROM movimento_prontuario m JOIN operacao_movimento_prontuario op ON op.id = m.operacao_movimento_prontuario_id
        WHERE m.volume_prontuario_id = ? AND m.excluido_em IS NULL ORDER BY m.id`,
      [v],
    );
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
      const tr = (c: string, t: string, local: number | null, setorF: number | null) =>
        e.inserir(
          `INSERT INTO setor_tramite (codigo, descricao, tipo, setor_funcional_id, local_arquivo_id, registra_movimento, ativo, criado_em)
           VALUES (?, ?, ?, ?, ?, TRUE, TRUE, ?)`,
          [`${P}-${c}`, `Trâmite sintético ${c}`, t, setorF, local, agora],
        );
      const trA = await tr('A', 'arquivo', arquivo, null);
      const trB = await tr('B', 'faturamento', null, setorB);
      const volume = (n: number, situacao = 'arquivado') =>
        e.inserir(
          `INSERT INTO volume_prontuario (estabelecimento_id, paciente_id, tipo_documento_arquivo_id, numero_volume,
             local_arquivo_id, aberto_em, abertura_usuario_id, no_local, situacao, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?)`,
          [est, paciente['id'], tipo['id'], n, arquivo, agora, usuario['id'], situacao, agora],
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
        v3: await volume(3, 'aberto'),
        v4: await volume(4),
      };
    });
    porta = new PortaSameTramitePropria(nucleo, CLIENTE);
    guarda = new PortaSameGuardaPropria(nucleo, CLIENTE);
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
    // Em trânsito: o volume não entra noutro lote nem sai por empréstimo.
    await expect(
      porta.emitirProtocolo(ctx(), {
        remetente: m.trA,
        destinatario: m.trB,
        itens: [{ tipo: 'volume_prontuario', alvo: m.v2 }],
      }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    const motivoAud = Number(
      (await um("SELECT id FROM motivo_solicitacao_prontuario WHERE codigo = 'auditoria'"))['id'],
    );
    await expect(
      porta.emprestar(ctx(), { volume: m.v2, destinoSetor: m.setorA, motivo: motivoAud }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    // O volume tem de estar com o remetente: o v1 está no arquivo, não com o setor B.
    await expect(
      porta.emitirProtocolo(ctx(), {
        remetente: m.trB,
        destinatario: m.trA,
        itens: [{ tipo: 'volume_prontuario', alvo: m.v3 }],
      }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    const a = await porta.receber(ctx(), r.id, { itens: [{ item: ids[0], aceito: true }], versao: 1 });
    expect(a.situacao).toBe('recebido_parcial');
    // A nova posse do v1 vai para a trilha da guarda: com o setor B, fora do arquivo, situação mantida.
    expect(await movimentos(m.v1)).toMatchObject([
      { tipo: 'recebimento', protocolo_tramite_id: r.id, destino_setor_funcional_id: m.setorB },
    ]);
    const v1 = await um('SELECT situacao, no_local FROM volume_prontuario WHERE id = ?', [m.v1]);
    expect([v1['situacao'], Number(v1['no_local'])]).toEqual(['arquivado', 0]);
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
        { paciente: m.paciente, volume: m.v2 },
        { paciente: m.paciente, volume: m.v3 },
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

    const v = await um('SELECT versao FROM volume_prontuario WHERE id = ?', [m.v2]);
    const e = await porta.emprestar(ctx(), {
      volume: m.v2,
      destinoSetor: m.setorB,
      solicitacao: s.id,
      versao: Number(v['versao']),
    });
    expect(e.solicitacao).toBe('em_atendimento');
    const emp = await um('SELECT * FROM emprestimo_prontuario WHERE id = ?', [e.id]);
    expect(emp).toMatchObject({ situacao: 'emprestado', solicitacao_prontuario_id: s.id });
    expect(Number(emp['motivo_solicitacao_prontuario_id'])).toBe(motivo);
    const dias =
      (new Date(emp['prazo_devolucao'] as Date).getTime() -
        new Date(emp['emprestado_em'] as Date).getTime()) /
      86_400_000;
    expect(Math.round(dias)).toBe(5);
    expect(emp['situacao_anterior_volume']).toBe('arquivado');
    // O empréstimo é a saída da guarda: aparece no histórico do volume, com o destino e a previsão = prazo.
    const saida = await movimentos(m.v2);
    expect(saida).toMatchObject([
      { tipo: 'emprestimo', destino_setor_funcional_id: m.setorB, devolvido_em: null },
    ]);
    expect(new Date(saida[0]!['previsao_retorno'] as Date).getTime()).toBe(
      new Date(emp['prazo_devolucao'] as Date).getTime(),
    );
    const hist = (await guarda.volumesDoPaciente(ctx(), m.paciente)).find((x) => x.id === m.v2);
    expect(hist?.movimentos.map((x) => x.operacao.tipo)).toContain('emprestimo');
    const vol = await um('SELECT situacao, no_local, versao FROM volume_prontuario WHERE id = ?', [m.v2]);
    expect([vol['situacao'], Number(vol['no_local'])]).toEqual(['emprestado', 0]);
    expect((await um('SELECT situacao FROM solicitacao_prontuario WHERE id = ?', [s.id]))['situacao']).toBe(
      'em_atendimento',
    );
    expect(
      (
        await um(
          'SELECT situacao FROM solicitacao_prontuario_item WHERE solicitacao_prontuario_id = ? AND volume_prontuario_id = ?',
          [s.id, m.v2],
        )
      )['situacao'],
    ).toBe('emprestado');
    await expect(
      porta.emprestar(ctx(), { volume: m.v2, destinoSetor: m.setorA, motivo, versao: Number(vol['versao']) }),
    ).rejects.toMatchObject({ problema: { status: 422 } });

    // No prazo, não se cobra; vencido, cobra e aparece nos atrasados.
    await expect(porta.cobrar(ctx(), e.id, 1)).rejects.toMatchObject({ problema: { status: 422 } });
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `prazo-${P}` }, (w) =>
      w.executar(
        'UPDATE emprestimo_prontuario SET emprestado_em = NOW(3) - INTERVAL 9 DAY, prazo_devolucao = NOW(3) - INTERVAL 4 DAY + INTERVAL 1 HOUR WHERE id = ?',
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
    const volta = await um('SELECT situacao, no_local FROM volume_prontuario WHERE id = ?', [m.v2]);
    expect([volta['situacao'], Number(volta['no_local'])]).toEqual(['arquivado', 1]);
    const trilha = await movimentos(m.v2);
    expect(trilha.map((x) => x['tipo'])).toEqual(['emprestimo', 'devolucao']);
    expect(trilha[0]!['devolvido_em']).not.toBeNull();
    const doPaciente = await porta.emprestimos(ctx(), { paciente: m.paciente, atrasados: false });
    expect(doPaciente.find((x) => x.id === e.id)).toMatchObject({ situacao: 'devolvido', diasAtraso: 0 });
  });

  it('devolve o volume aberto à situação de antes; a devolução pela guarda fecha o empréstimo', async () => {
    const motivo = Number(
      (await um("SELECT id FROM motivo_solicitacao_prontuario WHERE codigo = 'assistencia'"))['id'],
    );
    const e1 = await porta.emprestar(ctx(), { volume: m.v3, destinoSetor: m.setorA, motivo });
    expect(
      (await um('SELECT situacao_anterior_volume FROM emprestimo_prontuario WHERE id = ?', [e1.id]))[
        'situacao_anterior_volume'
      ],
    ).toBe('aberto');
    const v1 = Number((await um('SELECT versao FROM emprestimo_prontuario WHERE id = ?', [e1.id]))['versao']);
    await porta.devolver(ctx(), e1.id, { versao: v1 });
    const aberto = await um('SELECT situacao, no_local FROM volume_prontuario WHERE id = ?', [m.v3]);
    expect([aberto['situacao'], Number(aberto['no_local'])]).toEqual(['aberto', 1]);

    // Emprestado pelo trâmite e devolvido pela guarda: o empréstimo sai dos abertos e não é mais cobrado.
    const e2 = await porta.emprestar(ctx(), { volume: m.v3, destinoSetor: m.setorA, motivo });
    await guarda.movimentar(ctx(), m.v3, {
      operacao: 'devolucao',
      responsavel: 'Arquivista sintética',
      versao: await versaoVolume(m.v3),
    });
    const abertos = await porta.emprestimos(ctx(), { paciente: null, atrasados: false });
    expect(abertos.map((x) => x.id)).not.toContain(e2.id);
    const doPaciente = await porta.emprestimos(ctx(), { paciente: m.paciente, atrasados: false });
    expect(doPaciente.find((x) => x.id === e2.id)?.situacao).toBe('devolvido');
    await expect(porta.cobrar(ctx(), e2.id, 1)).rejects.toMatchObject({ problema: { status: 422 } });
    const movs = (await movimentos(m.v3)).length;
    await porta.devolver(ctx(), e2.id, { versao: 1 });
    expect(
      (await um('SELECT situacao, devolvido_em FROM emprestimo_prontuario WHERE id = ?', [e2.id]))[
        'situacao'
      ],
    ).toBe('devolvido');
    expect((await movimentos(m.v3)).length).toBe(movs);

    // Emprestado pela guarda: entra nos atrasados e é cobrado, ganhando o documento do empréstimo.
    const amanha = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const g = await guarda.movimentar(ctx(), m.v3, {
      operacao: 'emprestimo',
      responsavel: 'Auditora sintética',
      setorDestino: m.setorA,
      previsaoRetorno: amanha,
      versao: await versaoVolume(m.v3),
    });
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `prazo-g-${P}` }, (w) =>
      w.executar(
        'UPDATE movimento_prontuario SET movimentado_em = NOW(3) - INTERVAL 6 DAY, previsao_retorno = NOW(3) - INTERVAL 3 DAY + INTERVAL 1 HOUR WHERE id = ?',
        [g.id],
      ),
    );
    const atrasados = await porta.emprestimos(ctx(), { paciente: null, atrasados: true });
    const daGuarda = atrasados.find((x) => x.movimento === g.id);
    expect(daGuarda).toMatchObject({ id: null, origem: 'guarda', diasAtraso: 3 });
    await expect(
      porta.emprestar(ctx(), { volume: m.v3, destinoSetor: m.setorB, motivo }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    const cob = await porta.cobrarSaidaGuarda(ctx(), g.id);
    expect(cob.cobrancas).toBe(1);
    expect(
      await um(
        'SELECT situacao, movimento_prontuario_id, cobrancas_enviadas FROM emprestimo_prontuario WHERE id = ?',
        [cob.id],
      ),
    ).toMatchObject({ situacao: 'emprestado', movimento_prontuario_id: g.id, cobrancas_enviadas: 1 });
    await expect(porta.cobrarSaidaGuarda(ctx(), g.id)).rejects.toMatchObject({ problema: { status: 422 } });
    expect(
      (await porta.emprestimos(ctx(), { paciente: null, atrasados: true })).filter(
        (x) => x.movimento === g.id,
      ),
    ).toHaveLength(1);
  });

  it('tira a solicitação da fila: item não localizado e cancelamento com motivo, sem apagar', async () => {
    const motivo = Number(
      (await um("SELECT id FROM motivo_solicitacao_prontuario WHERE codigo = 'faturamento'"))['id'],
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
    const itens = await porta.itensDaSolicitacao(ctx(), s.id);
    await expect(
      porta.naoLocalizado(ctx(), s.id, { item: itens[0]!.id, motivo: ' ', versao: 1 }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    const n = await porta.naoLocalizado(ctx(), s.id, {
      item: itens[0]!.id,
      motivo: 'Procurado na estante e no setor B',
      versao: 1,
    });
    expect(n.situacao).toBe('em_atendimento');
    await expect(porta.cancelarSolicitacao(ctx(), s.id, { motivo: '', versao: 2 })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    const c = await porta.cancelarSolicitacao(ctx(), s.id, { motivo: 'Paciente teve alta', versao: 2 });
    expect(c.situacao).toBe('cancelada');
    expect(
      await um(
        'SELECT situacao, justificativa_finalizacao, finalizada_em IS NOT NULL AS fechada, excluido_em FROM solicitacao_prontuario WHERE id = ?',
        [s.id],
      ),
    ).toMatchObject({
      situacao: 'cancelada',
      justificativa_finalizacao: 'Paciente teve alta',
      fechada: 1,
      excluido_em: null,
    });
    const fim = await ler(
      'SELECT situacao, observacao FROM solicitacao_prontuario_item WHERE solicitacao_prontuario_id = ? ORDER BY sequencia',
      [s.id],
    );
    expect(fim.map((x) => x['situacao'])).toEqual(['nao_localizado', 'cancelado']);
    expect(fim[0]!['observacao']).toBe('Procurado na estante e no setor B');
    expect((await porta.solicitacoesAbertas(ctx())).map((x) => x.id)).not.toContain(s.id);
  });

  it('autorização pelo motivo: aguarda, recusa a entrega e a decisão do solicitante, autoriza e nega com quem e quando', async () => {
    const motivo = Number(
      (await um("SELECT id FROM motivo_solicitacao_prontuario WHERE codigo = 'pesquisa'"))['id'],
    );
    const outro = await um(
      'SELECT id FROM usuario WHERE excluido_em IS NULL AND id <> ? ORDER BY id LIMIT 1',
      [m.usuario],
    );
    expect(outro?.['id']).toBeTruthy();
    const responsavel = () => ({ ...ctx(), usuario: Number(outro['id']) });
    // O motivo exige autorização: sem solicitação, o empréstimo direto é recusado.
    await expect(
      porta.emprestar(ctx(), { volume: m.v4, destinoSetor: m.setorB, motivo }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    const s = await porta.solicitar(ctx(), {
      localArquivo: m.arquivo,
      destino: m.trB,
      motivo,
      itens: [{ paciente: m.paciente, volume: m.v4 }],
    });
    expect(
      await um('SELECT autorizacao, situacao FROM solicitacao_prontuario WHERE id = ?', [s.id]),
    ).toMatchObject({
      autorizacao: 'aguardando',
      situacao: 'pendente',
    });
    expect((await porta.solicitacoesAbertas(ctx())).find((x) => x.id === s.id)?.autorizacao).toBe(
      'aguardando',
    );
    // Aguardando: nada sai; quem pediu não decide; a decisão de outro usuário fica com quem e quando.
    await expect(
      porta.emprestar(ctx(), { volume: m.v4, destinoSetor: m.setorB, solicitacao: s.id }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await expect(
      porta.autorizarSolicitacao(ctx(), s.id, { decisao: 'autorizar', versao: 1 }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    const a = await porta.autorizarSolicitacao(responsavel(), s.id, {
      decisao: 'autorizar',
      justificativa: 'Projeto aprovado pelo comitê de ética',
      versao: 1,
    });
    expect(a).toMatchObject({ autorizacao: 'autorizada', situacao: 'pendente' });
    expect(
      await um(
        `SELECT autorizacao, autorizacao_usuario_id, autorizacao_decidida_em IS NOT NULL AS decidida,
                autorizacao_justificativa, versao FROM solicitacao_prontuario WHERE id = ?`,
        [s.id],
      ),
    ).toMatchObject({
      autorizacao: 'autorizada',
      autorizacao_usuario_id: Number(outro['id']),
      decidida: 1,
      autorizacao_justificativa: 'Projeto aprovado pelo comitê de ética',
      versao: 2,
    });
    await expect(
      porta.autorizarSolicitacao(responsavel(), s.id, { decisao: 'negar', justificativa: 'x', versao: 2 }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    // Autorizada: o volume sai pela solicitação e ela fica atendida.
    const e = await porta.emprestar(ctx(), {
      volume: m.v4,
      destinoSetor: m.setorB,
      solicitacao: s.id,
      versao: await versaoVolume(m.v4),
    });
    expect(e.solicitacao).toBe('atendida');
    await porta.devolver(ctx(), e.id, {
      versao: Number((await um('SELECT versao FROM emprestimo_prontuario WHERE id = ?', [e.id]))['versao']),
    });

    // Negada: a justificativa é obrigatória; a solicitação fica cancelada com quem e quando, o item cancelado; nada se apaga.
    const n = await porta.solicitar(ctx(), {
      localArquivo: m.arquivo,
      destino: m.trB,
      motivo,
      itens: [{ paciente: m.paciente, volume: m.v2 }],
    });
    await expect(
      porta.autorizarSolicitacao(responsavel(), n.id, { decisao: 'negar', justificativa: ' ', versao: 1 }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    const r = await porta.autorizarSolicitacao(responsavel(), n.id, {
      decisao: 'negar',
      justificativa: 'Sem parecer do comitê de ética',
      versao: 1,
    });
    expect(r).toMatchObject({ autorizacao: 'negada', situacao: 'cancelada' });
    expect(
      await um(
        `SELECT situacao, autorizacao, autorizacao_usuario_id, autorizacao_justificativa, justificativa_finalizacao,
                finalizada_em IS NOT NULL AS fechada, excluido_em FROM solicitacao_prontuario WHERE id = ?`,
        [n.id],
      ),
    ).toMatchObject({
      situacao: 'cancelada',
      autorizacao: 'negada',
      autorizacao_usuario_id: Number(outro['id']),
      autorizacao_justificativa: 'Sem parecer do comitê de ética',
      justificativa_finalizacao: 'Autorização negada: Sem parecer do comitê de ética',
      fechada: 1,
      excluido_em: null,
    });
    expect(
      await um(
        'SELECT situacao, observacao FROM solicitacao_prontuario_item WHERE solicitacao_prontuario_id = ?',
        [n.id],
      ),
    ).toMatchObject({
      situacao: 'cancelado',
      observacao: 'Autorização negada: Sem parecer do comitê de ética',
    });
    await expect(
      porta.emprestar(ctx(), { volume: m.v2, destinoSetor: m.setorB, solicitacao: n.id }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
  });

  it('item sem volume (todos os volumes do paciente): atendido pelo empréstimo de um volume do paciente', async () => {
    const motivo = Number(
      (await um("SELECT id FROM motivo_solicitacao_prontuario WHERE codigo = 'auditoria'"))['id'],
    );
    const v5 = await nucleo.escrever({ cliente: CLIENTE, correlacao: `v5-${P}` }, async (e) => {
      const tipo = await e.uma('SELECT MIN(id) AS id FROM tipo_documento_arquivo');
      const agora = new Date();
      return e.inserir(
        `INSERT INTO volume_prontuario (estabelecimento_id, paciente_id, tipo_documento_arquivo_id, numero_volume,
           local_arquivo_id, aberto_em, abertura_usuario_id, no_local, situacao, criado_em)
         VALUES (?, ?, ?, 5, ?, ?, ?, TRUE, 'arquivado', ?)`,
        [m.est, m.paciente, tipo!['id'], m.arquivo, agora, m.usuario, agora],
      );
    });
    const s = await porta.solicitar(ctx(), {
      localArquivo: m.arquivo,
      destino: m.trB,
      motivo,
      itens: [{ paciente: m.paciente, volume: null }],
    });
    const [item] = await porta.itensDaSolicitacao(ctx(), s.id);
    expect(item).toMatchObject({ paciente: m.paciente, volume: null, situacao: 'pendente' });
    const e = await porta.emprestar(ctx(), { volume: v5, destinoSetor: m.setorB, solicitacao: s.id });
    expect(e.solicitacao).toBe('atendida');
    const emp = await um(
      'SELECT movimento_prontuario_id, solicitacao_prontuario_id, situacao FROM emprestimo_prontuario WHERE id = ?',
      [e.id],
    );
    expect(emp).toMatchObject({ situacao: 'emprestado', solicitacao_prontuario_id: s.id });
    const fim = await um(
      `SELECT i.situacao, i.volume_prontuario_id, i.atendido_em IS NOT NULL AS atendido, mv.volume_prontuario_id AS volume_entregue
         FROM solicitacao_prontuario_item i JOIN movimento_prontuario mv ON mv.id = i.movimento_prontuario_id
        WHERE i.solicitacao_prontuario_id = ?`,
      [s.id],
    );
    // O pedido continua "todos os volumes"; o volume entregue fica no movimento da guarda ligado ao item.
    expect(fim).toMatchObject({ situacao: 'emprestado', volume_prontuario_id: null, atendido: 1 });
    expect(Number(fim['volume_entregue'])).toBe(v5);
    expect(Number(emp['movimento_prontuario_id'])).toBeGreaterThan(0);
    expect(
      (await um('SELECT situacao, no_local FROM volume_prontuario WHERE id = ?', [v5]))['situacao'],
    ).toBe('emprestado');
  });
});
