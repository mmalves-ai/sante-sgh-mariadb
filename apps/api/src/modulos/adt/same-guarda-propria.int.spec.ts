// Contrato de efeito do SAME pelo volume (F3.9, 04-HOT L126) contra o MariaDB real (cliente de teste), num
// estabelecimento SINTÉTICO sem nada do conector: as operações vêm só da semeadura da migração 09_HOT/95 (códigos de
// negócio, tipo e sentido). Paciente, usuário e tipo de documento são ids já existentes do cliente (só lidos).
// Prova o que fica no banco: o local com o caminho; a abertura do volume com número, matrícula, local, posição e o
// registro; a saída (previsão, responsável, volume emprestado fora do local); o recebimento conferido pelo setor; a
// devolução (volume de volta ao local, saída marcada como devolvida); a transferência de local no arquivo; o desfazer
// (exclusão lógica + ocorrência com motivo, estado refeito); o extravio; o descarte com aval (eliminado + ocorrência);
// e as recusas (sem aval, local cheio, volume em outro lugar). SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaSameGuardaPropria } from './same-guarda-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'f394same';

interface Massa {
  est: number;
  usuario: number;
  paciente: number;
  tipo: number;
  arquivo: number;
  sala: number;
  setorSame: number;
  setorUti: number;
}

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const t of [
      'ocorrencia_arquivo_prontuario',
      'movimento_prontuario',
      'volume_prontuario',
      'local_arquivo',
      'setor_funcional',
    ])
      await e.executar(`DELETE FROM ${t} WHERE estabelecimento_id IN ${est}`, [P]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('PortaSameGuardaPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaSameGuardaPropria;
  let m: Massa;
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const volume = async (id: number) => (await ler('SELECT * FROM volume_prontuario WHERE id = ?', [id]))[0]!;
  const amanha = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const falha = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return `${String(e)} ${JSON.stringify(e)}`;
    }
    throw new Error('era para recusar');
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const paciente = await e.uma('SELECT MIN(id) AS id FROM paciente WHERE excluido_em IS NULL');
      const tipo = await e.uma("SELECT id FROM tipo_documento_arquivo WHERE codigo = 'prontuario-antigo'");
      if (!usuario?.['id'] || !paciente?.['id'] || !tipo?.['id'])
        throw new Error('O cliente de teste precisa de usuário, paciente e tipo de documento.');
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const setor = (codigo: string, tipoSetor: string) =>
        e.inserir(
          'INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, ?, ?, ?)',
          [est, `${P}-${codigo}`, `Setor ${codigo} sintético`, tipoSetor, agora],
        );
      return {
        est,
        usuario: Number(usuario['id']),
        paciente: Number(paciente['id']),
        tipo: Number(tipo['id']),
        arquivo: 0,
        sala: 0,
        setorSame: await setor('SAME', 'administrativo'),
        setorUti: await setor('UTI', 'assistencial'),
      };
    });
    porta = new PortaSameGuardaPropria(nucleo, CLIENTE);
  }, 60_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  }, 60_000);

  it('o cliente sem conector tem as operações padrão com códigos de negócio, tipo e sentido', async () => {
    const ops = await porta.operacoes(ctx());
    const padrao = ops.filter((o) =>
      ['registro', 'saida', 'emprestimo', 'devolucao', 'transferencia', 'recebimento', 'descarte'].includes(
        o.codigo,
      ),
    );
    expect(padrao).toHaveLength(7);
    expect(padrao.find((o) => o.codigo === 'descarte')).toMatchObject({
      sentido: 'saida',
      encerraGuarda: true,
    });
    expect(padrao.find((o) => o.codigo === 'saida')).toMatchObject({
      exigeDestino: true,
      exigePrevisaoRetorno: true,
    });
  });

  it('o local na árvore guarda o caminho e a capacidade', async () => {
    m.arquivo = (
      await porta.incluirLocal(ctx(), { nivel: 'sala', codigo: `${P}-S1`, descricao: 'Sala 1' })
    ).id;
    m.sala = (
      await porta.incluirLocal(ctx(), {
        nivel: 'armario',
        codigo: `${P}-A3`,
        descricao: 'Armário 3',
        pai: m.arquivo,
        capacidade: 2,
      })
    ).id;
    const [l] = await ler('SELECT caminho, capacidade_volumes, nivel FROM local_arquivo WHERE id = ?', [
      m.sala,
    ]);
    expect(l).toMatchObject({ caminho: 'Sala 1 > Armário 3', capacidade_volumes: 2, nivel: 'armario' });
    expect(
      await falha(porta.incluirLocal(ctx(), { nivel: 'caixa', codigo: `${P}-X`, descricao: 'Caixa solta' })),
    ).toMatch(/topo/);
  });

  it('o ciclo do volume: abrir, sair, receber, devolver, transferir, desfazer, extraviar e descartar', async () => {
    const aberto = await porta.abrirVolume(ctx(), {
      paciente: m.paciente,
      tipoDocumento: m.tipo,
      localArquivo: m.sala,
      posicaoLinha: 'B',
      posicaoColuna: '4',
      setor: m.setorSame,
    });
    let v = await volume(aberto.id);
    expect(v).toMatchObject({
      numero_volume: 1,
      numero_matricula: aberto.matricula,
      local_arquivo_id: m.sala,
      posicao_linha: 'B',
      posicao_coluna: '4',
      situacao: 'arquivado',
      no_local: 1,
    });
    const [reg] = await ler(
      `SELECT op.tipo, m.destino_local_arquivo_id FROM movimento_prontuario m
         JOIN operacao_movimento_prontuario op ON op.id = m.operacao_movimento_prontuario_id WHERE m.id = ?`,
      [aberto.movimento],
    );
    expect(reg).toMatchObject({ tipo: 'registro', destino_local_arquivo_id: m.sala });
    expect(await porta.volumePorEtiqueta(ctx(), aberto.matricula)).toEqual({
      paciente: m.paciente,
      volume: aberto.id,
    });

    // Saída sem previsão recusa; com tudo, o volume fica emprestado e fora do local.
    expect(
      await falha(
        porta.movimentar(ctx(), aberto.id, {
          operacao: 'saida',
          setorDestino: m.setorUti,
          versao: Number(v['versao']),
        }),
      ),
    ).toMatch(/previs/i);
    const saida = await porta.movimentar(ctx(), aberto.id, {
      operacao: 'saida',
      setorDestino: m.setorUti,
      previsaoRetorno: amanha,
      responsavel: 'ENFERMAGEM UTI',
      versao: Number(v['versao']),
    });
    v = await volume(aberto.id);
    expect(v).toMatchObject({ situacao: 'emprestado', no_local: 0 });
    const [ms] = await ler(
      'SELECT destino_setor_funcional_id, previsao_retorno, responsavel_nome FROM movimento_prontuario WHERE id = ?',
      [saida.id],
    );
    expect(ms!['destino_setor_funcional_id']).toBe(m.setorUti);
    expect(ms!['previsao_retorno']).not.toBeNull();

    // Fora do arquivo não sai de novo (um lugar por vez); o recebimento no setor errado recusa.
    expect(
      await falha(
        porta.movimentar(ctx(), aberto.id, {
          operacao: 'emprestimo',
          setorDestino: m.setorSame,
          previsaoRetorno: amanha,
          responsavel: 'PESQUISA',
          versao: Number(v['versao']),
        }),
      ),
    ).toMatch(/um lugar por vez/);
    expect(
      await falha(
        porta.movimentar(ctx(), aberto.id, {
          operacao: 'recebimento',
          setorDestino: m.setorSame,
          responsavel: 'X',
          versao: Number(v['versao']),
        }),
      ),
    ).toMatch(/não foi enviado/);
    await porta.movimentar(ctx(), aberto.id, {
      operacao: 'recebimento',
      setorDestino: m.setorUti,
      responsavel: 'ENF',
      versao: Number(v['versao']),
    });
    v = await volume(aberto.id);

    // Devolução: volta ao local, a saída fica devolvida.
    await porta.movimentar(ctx(), aberto.id, {
      operacao: 'devolucao',
      setorOrigem: m.setorUti,
      versao: Number(v['versao']),
    });
    v = await volume(aberto.id);
    expect(v).toMatchObject({ situacao: 'arquivado', no_local: 1, local_arquivo_id: m.sala });
    const [dev] = await ler('SELECT devolvido_em FROM movimento_prontuario WHERE id = ?', [saida.id]);
    expect(dev!['devolvido_em']).not.toBeNull();

    // Transferência de local no arquivo e o desfazer com motivo (exclusão lógica, estado refeito).
    const tr = await porta.movimentar(ctx(), aberto.id, {
      operacao: 'transferencia',
      localDestino: m.arquivo,
      versao: Number(v['versao']),
    });
    v = await volume(aberto.id);
    expect(v['local_arquivo_id']).toBe(m.arquivo);
    await porta.desfazerUltimo(ctx(), aberto.id, {
      motivo: 'transferência lançada por engano',
      versao: Number(v['versao']),
    });
    v = await volume(aberto.id);
    expect(v).toMatchObject({ local_arquivo_id: m.sala, no_local: 1, situacao: 'arquivado' });
    const [mt] = await ler('SELECT excluido_em FROM movimento_prontuario WHERE id = ?', [tr.id]);
    expect(mt!['excluido_em']).not.toBeNull();
    const [oc] = await ler(
      "SELECT COUNT(*) AS n FROM ocorrencia_arquivo_prontuario WHERE movimento_prontuario_id = ? AND tipo = 'exclusao' AND motivo IS NOT NULL",
      [tr.id],
    );
    expect(Number(oc!['n'])).toBe(1);

    // Descarte sem aval recusa; com aval, eliminado e a ocorrência com o aval.
    expect(
      await falha(
        porta.movimentar(ctx(), aberto.id, {
          operacao: 'descarte',
          responsavel: 'COMISSAO',
          versao: Number(v['versao']),
        }),
      ),
    ).toMatch(/aval/);
    await porta.movimentar(ctx(), aberto.id, {
      operacao: 'descarte',
      responsavel: 'COMISSAO',
      avalComissao: 'ATA SINTÉTICA 1',
      observacao: 'prazo de guarda cumprido',
      versao: Number(v['versao']),
    });
    v = await volume(aberto.id);
    expect(v['situacao']).toBe('eliminado');
    expect(v['encerrado_em']).not.toBeNull();
    const [desc] = await ler(
      "SELECT aval_comissao, volume_prontuario_id FROM ocorrencia_arquivo_prontuario WHERE volume_prontuario_id = ? AND tipo = 'descarte'",
      [aberto.id],
    );
    expect(desc).toMatchObject({ aval_comissao: 'ATA SINTÉTICA 1', volume_prontuario_id: aberto.id });
    const movs = await ler('SELECT COUNT(*) AS n FROM movimento_prontuario WHERE volume_prontuario_id = ?', [
      aberto.id,
    ]);
    expect(Number(movs[0]!['n'])).toBe(6);
  });

  it('o segundo volume ganha o número seguinte; o extravio fica registrado; o local cheio recusa', async () => {
    const v2 = await porta.abrirVolume(ctx(), {
      paciente: m.paciente,
      tipoDocumento: m.tipo,
      localArquivo: m.sala,
    });
    const v3 = await porta.abrirVolume(ctx(), {
      paciente: m.paciente,
      tipoDocumento: m.tipo,
      localArquivo: m.sala,
    });
    expect((await volume(v2.id))['numero_volume']).toBe(2);
    expect(
      await falha(
        porta.abrirVolume(ctx(), { paciente: m.paciente, tipoDocumento: m.tipo, localArquivo: m.sala }),
      ),
    ).toMatch(/cheio/);
    const x = await volume(v3.id);
    await porta.registrarExtravio(ctx(), v3.id, {
      motivo: 'não localizado na conferência',
      versao: Number(x['versao']),
    });
    expect(await volume(v3.id)).toMatchObject({
      situacao: 'extraviado',
      no_local: 0,
      extravio_usuario_id: m.usuario,
    });
    const [oc] = await ler(
      "SELECT COUNT(*) AS n FROM ocorrencia_arquivo_prontuario WHERE volume_prontuario_id = ? AND tipo = 'extravio'",
      [v3.id],
    );
    expect(Number(oc!['n'])).toBe(1);
    const lidos = await porta.volumesDoPaciente(ctx(), m.paciente);
    expect(lidos.map((l) => l.situacao).sort()).toEqual(['arquivado', 'eliminado', 'extraviado']);
    expect(lidos.find((l) => l.id === v2.id)?.ondeEsta).toBe('Sala 1 > Armário 3');
  });
});
