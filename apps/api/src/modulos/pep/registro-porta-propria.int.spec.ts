// Integração da porta própria dos registros clínicos contra o MariaDB real (cliente de teste f22_o1, da onda 1 da
// F2.2). Massa SINTÉTICA com códigos do lote (prefixo l0106), montada no beforeAll e apagada no afterAll; nenhum dado
// de pessoa real. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MOTIVO_GRAVACAO_PENDENTE, PortaRegistroPropria } from './registro-porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o1';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'l0106';
const C = { rede: CLIENTE, hospital: P, cliente: CLIENTE, estabelecimento: null, usuario: null, correlacao: P };
/** Número de prontuário sintético do lote (fora da faixa de qualquer carga). */
const PRONTUARIO = 901_060_101;

interface Massa {
  estabelecimento: number;
  outroEstabelecimento: number;
  usuario: number;
  tipo: number;
  especialidade: number;
  publicado: number;
  rascunho: number;
  aposentado: number;
  versao: number;
  pessoa: number;
  paciente: number;
  profissional: number;
  categoriaInternacao: number;
  categoriaAmbulatorio: number;
  categoriaPronto: number;
  carater: number;
  fonte: number;
  unidade: number;
  atendimentoInternacao: number;
  atendimentoAmbulatorio: number;
  atendimentoOutroEstabelecimento: number;
  atendimentoExcluido: number;
  atendimentoAmbulatorioEncerrado: number;
  atendimentoProntoAberto: number;
}

describe.skipIf(SEM_BANCO)('PortaRegistroPropria contra o MariaDB (cliente f22_o1)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaRegistroPropria;
  let m: Massa;

  async function limpar(e: Escritor): Promise<void> {
    // Ordem inversa das chaves estrangeiras; só linhas com os códigos do lote.
    const est = '(SELECT id FROM estabelecimento WHERE codigo IN (?, ?))';
    await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN ${est}`, [P, `${P}b`]);
    await e.executar(`DELETE FROM unidade_assistencial WHERE estabelecimento_id IN ${est}`, [P, `${P}b`]);
    await e.executar(
      `DELETE me FROM modelo_especialidade me JOIN modelo_documento_clinico m ON m.id = me.modelo_documento_clinico_id
        WHERE m.codigo LIKE ?`,
      [`${P.toUpperCase()}_%`],
    );
    await e.executar(
      'UPDATE modelo_documento_clinico SET publicada_modelo_documento_versao_id = NULL, situacao = ? WHERE codigo LIKE ?',
      ['rascunho', `${P.toUpperCase()}_%`],
    );
    await e.executar(
      `DELETE v FROM modelo_documento_versao v JOIN modelo_documento_clinico m ON m.id = v.modelo_documento_clinico_id
        WHERE m.codigo LIKE ?`,
      [`${P.toUpperCase()}_%`],
    );
    await e.executar('DELETE FROM modelo_documento_clinico WHERE codigo LIKE ?', [`${P.toUpperCase()}_%`]);
    await e.executar('DELETE FROM tipo_documento_clinico WHERE codigo LIKE ?', [`${P.toUpperCase()}_%`]);
    await e.executar('DELETE FROM especialidade_medica WHERE codigo LIKE ?', [`${P}%`]);
    await e.executar(
      'DELETE FROM paciente WHERE pessoa_fisica_id IN (SELECT id FROM pessoa_fisica WHERE nome LIKE ?)',
      [`Pessoa sintética ${P}%`],
    );
    await e.executar('DELETE FROM profissional WHERE observacao = ?', [`massa ${P}`]);
    await e.executar('DELETE FROM pessoa_fisica WHERE nome LIKE ?', [`Pessoa sintética ${P}%`]);
    await e.executar('DELETE FROM categoria_atendimento WHERE codigo LIKE ?', [`${P}%`]);
    await e.executar('DELETE FROM carater_atendimento_tiss WHERE codigo_tiss LIKE ?', [`${P}%`]);
    await e.executar('DELETE FROM fonte_pagadora WHERE codigo LIKE ?', [`${P}%`]);
    await e.executar('DELETE FROM usuario WHERE login LIKE ?', [`${P}.%`]);
    await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, `${P}b`]);
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const ins = (sql: string, p: unknown[]) => e.inserir(sql, p);
      const estabelecimento = await ins(
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const outroEstabelecimento = await ins(
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}b`, `Hospital sintético ${P}b`, `Hospital sintético ${P}b (fictício)`, agora],
      );
      const usuario = await ins(
        'INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}.publicador`, 'Conta de serviço sintética', 'servico', agora],
      );
      const tipo = await ins(
        'INSERT INTO tipo_documento_clinico (codigo, descricao, categoria, criado_em) VALUES (?, ?, ?, ?)',
        [`${P.toUpperCase()}_EVOL`, 'Evolução sintética', 'evolucao', agora],
      );
      const especialidade = await ins(
        'INSERT INTO especialidade_medica (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [`${P}esp`, 'Especialidade sintética', agora],
      );
      const modelo = (codigo: string, titulo: string) =>
        ins(
          `INSERT INTO modelo_documento_clinico (codigo, titulo, tipo_documento_clinico_id, tipo_registro, criado_em)
           VALUES (?, ?, ?, 'evolucao', ?)`,
          [codigo, titulo, tipo, agora],
        );
      const publicado = await modelo(`${P.toUpperCase()}_PUB`, 'Evolução sintética publicada');
      const rascunho = await modelo(`${P.toUpperCase()}_RAS`, 'Evolução sintética em rascunho');
      const versao = await ins(
        `INSERT INTO modelo_documento_versao (modelo_documento_clinico_id, numero_versao, situacao, publicada_em,
           publicacao_usuario_id, hash_definicao, operacao, dados, ocorrido_em, usuario_id, criado_em)
         VALUES (?, 1, 'publicada', ?, ?, ?, 'inclusao', ?, ?, ?, ?)`,
        [publicado, agora, usuario, 'a'.repeat(64), '{"campos":[]}', agora, usuario, agora],
      );
      await e.executar(
        "UPDATE modelo_documento_clinico SET situacao = 'publicado', publicada_modelo_documento_versao_id = ? WHERE id = ?",
        [versao, publicado],
      );
      const aposentado = await modelo(`${P.toUpperCase()}_APO`, 'Evolução sintética aposentada');
      const versaoAposentada = await ins(
        `INSERT INTO modelo_documento_versao (modelo_documento_clinico_id, numero_versao, situacao, publicada_em,
           publicacao_usuario_id, hash_definicao, operacao, dados, ocorrido_em, usuario_id, criado_em)
         VALUES (?, 1, 'publicada', ?, ?, ?, 'inclusao', ?, ?, ?, ?)`,
        [aposentado, agora, usuario, 'b'.repeat(64), '{"campos":[]}', agora, usuario, agora],
      );
      await e.executar(
        "UPDATE modelo_documento_clinico SET situacao = 'aposentado', publicada_modelo_documento_versao_id = ? WHERE id = ?",
        [versaoAposentada, aposentado],
      );
      await ins(
        'INSERT INTO modelo_especialidade (modelo_documento_clinico_id, especialidade_medica_id, criado_em) VALUES (?, ?, ?)',
        [publicado, especialidade, agora],
      );
      const pessoa = await ins('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
        `Pessoa sintética ${P} paciente`,
        agora,
      ]);
      const pessoaProf = await ins('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
        `Pessoa sintética ${P} profissional`,
        agora,
      ]);
      const paciente = await ins(
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pessoa, PRONTUARIO, agora],
      );
      const profissional = await ins(
        "INSERT INTO profissional (pessoa_fisica_id, tipo, observacao, criado_em) VALUES (?, 'assistencial', ?, ?)",
        [pessoaProf, `massa ${P}`, agora],
      );
      const categoria = (codigo: string, base: string) =>
        ins('INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, ?, ?)', [
          codigo,
          `Categoria sintética ${codigo}`,
          base,
          agora,
        ]);
      const categoriaInternacao = await categoria(`${P}int`, 'internacao');
      const categoriaAmbulatorio = await categoria(`${P}amb`, 'ambulatorio');
      const categoriaPronto = await categoria(`${P}pa`, 'pronto_atendimento');
      const carater = await ins(
        'INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}c`, 'Caráter sintético', 'teste', agora],
      );
      const fonte = await ins(
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'particular', ?)",
        [`${P}fp`, 'Fonte pagadora sintética', agora],
      );
      const unidade = await ins(
        "INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em) VALUES (?, ?, ?, 'internacao', ?)",
        [estabelecimento, `${P}u`, 'Unidade sintética', agora],
      );
      const atendimento = (
        est: number,
        numero: string,
        cat: number,
        entrada: string,
        extra: { unidade?: number; excluido?: boolean; saida?: string } = {},
      ) =>
        ins(
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
             carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, unidade_assistencial_id, entrada_em,
             criado_em, excluido_em, situacao, saida_em, desfecho)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            est,
            numero,
            paciente,
            cat,
            carater,
            fonte,
            profissional,
            extra.unidade ?? null,
            new Date(entrada),
            agora,
            extra.excluido ? agora : null,
            extra.saida ? 'encerrado' : 'aberto',
            extra.saida ? new Date(extra.saida) : null,
            extra.saida ? 'alta' : null,
          ],
        );
      const atendimentoInternacao = await atendimento(estabelecimento, '1001', categoriaInternacao, '2026-11-10T08:00:00Z', {
        unidade,
      });
      const atendimentoAmbulatorio = await atendimento(estabelecimento, 'A-7', categoriaAmbulatorio, '2026-11-01T10:30:00Z');
      const atendimentoOutroEstabelecimento = await atendimento(
        outroEstabelecimento,
        '2001',
        categoriaAmbulatorio,
        '2026-11-12T09:00:00Z',
      );
      const atendimentoExcluido = await atendimento(estabelecimento, '1002', categoriaAmbulatorio, '2026-11-15T09:00:00Z', {
        excluido: true,
      });
      // Ambulatório encerrado no mesmo dia e pronto atendimento aberto há mais de 2 dias (dias antes de "agora").
      const atendimentoAmbulatorioEncerrado = await atendimento(
        estabelecimento,
        '1003',
        categoriaAmbulatorio,
        '2026-10-20T11:00:00Z',
        { saida: '2026-10-20T11:40:00Z' },
      );
      const atendimentoProntoAberto = await atendimento(estabelecimento, '1004', categoriaPronto, '2026-10-15T23:30:00Z');
      return {
        estabelecimento,
        aposentado,
        categoriaPronto,
        atendimentoAmbulatorioEncerrado,
        atendimentoProntoAberto,
        outroEstabelecimento,
        usuario,
        tipo,
        especialidade,
        publicado,
        rascunho,
        versao,
        pessoa,
        paciente,
        profissional,
        categoriaInternacao,
        categoriaAmbulatorio,
        carater,
        fonte,
        unidade,
        atendimentoInternacao,
        atendimentoAmbulatorio,
        atendimentoOutroEstabelecimento,
        atendimentoExcluido,
      };
    });
    porta = new PortaRegistroPropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar();
    }
  });

  it('modelos: publicados e aposentados (marcados), sem o rascunho; publicado sem uso não é aposentado', async () => {
    const lista = (await porta.modelos(C)).filter((x) => x.codigo?.startsWith(P.toUpperCase()));
    expect(lista).toEqual([
      {
        id: m.aposentado,
        codigo: `${P.toUpperCase()}_APO`,
        nome: 'Evolução sintética aposentada',
        tipoComposicao: m.tipo,
        nomeTipoComposicao: 'Evolução sintética',
        especialidades: [],
        aposentado: true,
        usoRecente: 0,
      },
      {
        id: m.publicado,
        codigo: `${P.toUpperCase()}_PUB`,
        nome: 'Evolução sintética publicada',
        tipoComposicao: m.tipo,
        nomeTipoComposicao: 'Evolução sintética',
        especialidades: [m.especialidade],
        aposentado: false,
        usoRecente: 0,
      },
    ]);
  });

  it('selo: o hash da versão publicada; modelo em rascunho recusa com 404', async () => {
    expect(await porta.selo(C, m.publicado)).toBe('a'.repeat(64));
    await expect(porta.selo(C, m.rascunho)).rejects.toMatchObject({ problema: { status: 404 } });
  });

  it('atendimentos: os do estabelecimento da sessão, sem os excluídos, do mais recente, no fuso do estabelecimento', async () => {
    const lista = await porta.atendimentos(C, m.paciente);
    expect(lista.map((a) => a.id)).toEqual([
      m.atendimentoInternacao,
      m.atendimentoAmbulatorio,
      m.atendimentoAmbulatorioEncerrado,
      m.atendimentoProntoAberto,
    ]);
    expect(lista[0]).toMatchObject({
      numero: 1001,
      tipo: 'internacao',
      aberto: true,
      // 08:00Z no fuso padrão do estabelecimento (America/Sao_Paulo, UTC-3).
      entrada: '2026-11-10T05:00:00',
      unidade: 'Unidade sintética',
      leito: null,
      altaMedica: null,
      saida: null,
    });
    // Número de negócio fora do formato numérico não vira sentinela: fica null.
    expect(lista[1]).toMatchObject({ numero: null, tipo: 'ambulatorio', aberto: true });
    // Ambulatório encerrado no mesmo dia: fechado. Pronto atendimento aberto há mais de 2 dias: em curso.
    expect(lista[2]).toMatchObject({ tipo: 'ambulatorio', aberto: false, saida: '2026-10-20T08:40:00' });
    expect(lista[3]).toMatchObject({ tipo: 'pronto_atendimento', aberto: true, entrada: '2026-10-15T20:30:00' });
    // Outro estabelecimento: só o atendimento de lá.
    const outro = await porta.atendimentos({ ...C, hospital: `${P}b` }, m.paciente);
    expect(outro.map((a) => a.id)).toEqual([m.atendimentoOutroEstabelecimento]);
  });

  it('retratos: confere atendimento × paciente no estabelecimento da sessão', async () => {
    expect(await porta.retratos(C, m.atendimentoInternacao, m.paciente)).toEqual({
      htAtendimento: m.atendimentoInternacao,
      htPaciente: m.paciente,
      doPaciente: true,
    });
    expect(await porta.retratos(C, m.atendimentoInternacao, m.paciente + 1_000_000)).toMatchObject({
      doPaciente: false,
    });
    // Atendimento de outro estabelecimento ou excluído: não existe para a sessão.
    expect(await porta.retratos(C, m.atendimentoOutroEstabelecimento, m.paciente)).toBeNull();
    expect(await porta.retratos(C, m.atendimentoExcluido, m.paciente)).toBeNull();
  });

  it('estabelecimento inexistente recusa com 404; agora no fuso do estabelecimento', async () => {
    await expect(porta.atendimentos({ ...C, hospital: `${P}zz` }, m.paciente)).rejects.toMatchObject({
      problema: { status: 404, codigo: 'estabelecimento-inexistente' },
    });
    const agora = await porta.agora(C);
    expect(agora).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    // Igual à hora civil de São Paulo de agora (com folga de um minuto), não à de UTC.
    const esperado = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'medium',
    })
      .format(new Date())
      .replace(' ', 'T');
    expect(Math.abs(Date.parse(`${agora}Z`) - Date.parse(`${esperado}Z`))).toBeLessThan(60_000);
  });

  it('gravação desligada (consulta) e pendentes recusam com 501, sem gravar', async () => {
    expect(await porta.podeGravar()).toEqual({
      pode: false,
      codigo: 'pendente-modelo-proprio',
      motivo: MOTIVO_GRAVACAO_PENDENTE,
    });
    await expect(porta.registrar()).rejects.toMatchObject({ problema: { status: 501 } });
    await expect(porta.profissional()).rejects.toMatchObject({ problema: { codigo: 'pendente-modelo-proprio' } });
  });
});
