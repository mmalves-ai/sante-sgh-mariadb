// Contrato de efeito da auditoria item a item, do protocolo entre setores e do acompanhamento da guia (F3.7, 06-FAT
// linhas 21, 22 e 24) contra o MariaDB real. Massa SINTÉTICA com códigos "F376" (nenhuma pessoa real). No fim, a massa
// e a trilha dela são apagadas. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, type Escritor, ErroOperacao, type Leitor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { ServicoAuditoriaTramite } from './auditoria-tramite.controller.js';
import {
  auditoriaItensPropria,
  guiaAcompanhamentoPropria,
  guiasConvenioPropria,
  protocolosPropria,
} from './auditoria-tramite-propria.js';
import { alvosProtocoloPropria, entradaBuscaAlvo } from './protocolo-alvos-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'F376';
const CNPJ = '11222333000181';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}
async function codigoDo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao) return String(e.problema['codigo'] ?? e.problema.type ?? '');
    throw e;
  }
  throw new Error('esperava recusa');
}

describe.skipIf(SEM_BANCO)('auditoria item a item, protocolo entre setores e guia (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let s: ServicoAuditoriaTramite;
  const ids: Record<string, number> = {};
  const op = (): ContextoOperacao => ({
    cliente: CLIENTE,
    estabelecimento: ids['est']!,
    usuario: ids['usuario']!,
    correlacao: 'teste-f376',
    chaveIdempotencia: `f376-${randomUUID()}`,
    reautenticadoEm: Date.now(),
  });
  const ler = <T>(fn: (l: Leitor, est: number) => Promise<T>) =>
    s.ler({ cliente: CLIENTE, estabelecimento: ids['est']!, usuario: null, correlacao: 'teste-f376' }, fn);
  const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f376' }, fn);
  const linhas = (sql: string, p: unknown[]) => escrever((e) => e.consultar<Record<string, unknown>>(sql, p));

  const limpar = async (e: Escritor) => {
    for (const outro of [ids['est'], ids['estB']])
      if (outro) {
        await e.executar('DELETE FROM documento_emitido WHERE estabelecimento_id = ?', [outro]);
        await e.executar('DELETE FROM volume_prontuario WHERE estabelecimento_id = ?', [outro]);
      }
    const est = ids['est'];
    if (est) {
      const porGuia = 'IN (SELECT id FROM guia_fonte_pagadora WHERE estabelecimento_id = ?)';
      for (const t of ['guia_historico', 'guia_anexo', 'guia_pendencia'])
        await e.executar(`DELETE FROM ${t} WHERE guia_fonte_pagadora_id ${porGuia}`, [est]);
      await e.executar('DELETE FROM guia_fonte_pagadora WHERE estabelecimento_id = ?', [est]);
      await e.executar('DELETE FROM arquivo WHERE estabelecimento_id = ?', [est]);
      await e.executar(
        'DELETE FROM protocolo_tramite_item WHERE protocolo_tramite_id IN (SELECT id FROM protocolo_tramite WHERE estabelecimento_id = ?)',
        [est],
      );
      await e.executar('DELETE FROM protocolo_tramite WHERE estabelecimento_id = ?', [est]);
      const porAud = 'IN (SELECT id FROM auditoria_conta WHERE estabelecimento_id = ?)';
      await e.executar(`DELETE FROM auditoria_conta_item WHERE auditoria_conta_id ${porAud}`, [est]);
      await e.executar(`DELETE FROM auditoria_conta_versao WHERE auditoria_conta_id ${porAud}`, [est]);
      await e.executar('DELETE FROM auditoria_conta WHERE estabelecimento_id = ?', [est]);
      const porConta = 'IN (SELECT id FROM conta_hospitalar WHERE estabelecimento_id = ?)';
      await e.executar(
        `DELETE m FROM conta_hospitalar_item_memoria m JOIN conta_hospitalar_item i ON i.id = m.conta_hospitalar_item_id WHERE i.conta_hospitalar_id ${porConta}`,
        [est],
      );
      await e.executar(
        `DELETE FROM producao_repasse WHERE conta_hospitalar_item_id IN (SELECT id FROM conta_hospitalar_item WHERE conta_hospitalar_id ${porConta})`,
        [est],
      );
      await e.executar(`DELETE FROM conta_hospitalar_item WHERE conta_hospitalar_id ${porConta}`, [est]);
      await e.executar('DELETE FROM conta_hospitalar WHERE estabelecimento_id = ?', [est]);
      await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [est]);
    }
    await e.executar(
      "DELETE x FROM empresa_auditoria_externa x JOIN pessoa_juridica p ON p.id = x.pessoa_juridica_id WHERE p.razao_social LIKE 'F376%'",
      [],
    );
    await e.executar("DELETE FROM pessoa_juridica WHERE razao_social LIKE 'F376%'", []);
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await escrever(async (e) => {
      const agora = new Date();
      const g = (tabela: string, codigo: string, ins: string, pi: unknown[]) =>
        garantir(e, `SELECT id FROM ${tabela} WHERE codigo = ?`, [codigo], ins, pi);
      ids['est'] = await g(
        'estabelecimento',
        `${P}A`,
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}A`, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, agora],
      );
      ids['estB'] = await g(
        'estabelecimento',
        `${P}B`,
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}B`, `ESTAB ${P} SINTETICO B`, `ESTAB ${P} SINTETICO B`, agora],
      );
      await limpar(e);
      ids['usuario'] = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['f376.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['f376.teste', `USUARIO SINTETICO ${P}`, agora],
      );
      ids['fonte'] = await g(
        'fonte_pagadora',
        `${P}F`,
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'operadora', ?)",
        [`${P}F`, `OPERADORA SINTETICA ${P}`, agora],
      );
      const pf = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [`PACIENTE SINTETICO ${P}`],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        [`PACIENTE SINTETICO ${P}`, agora],
      );
      ids['paciente'] = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pf],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pf, 837_601, agora],
      );
      ids['categoria'] = await g(
        'categoria_atendimento',
        P,
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'internacao', ?)",
        [P, `CATEGORIA SINTETICA ${P}`, agora],
      );
      ids['tipoConta'] = await g(
        'tipo_conta',
        P,
        "INSERT INTO tipo_conta (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'internacao', ?)",
        [P, `TIPO DE CONTA SINTETICO ${P}`, agora],
      );
      ids['grupo'] = await g(
        'grupo_faturamento',
        P,
        "INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, ?, 'sadt', ?)",
        [P, `GRUPO SINTETICO ${P}`, agora],
      );
      ids['itemFat'] = await g(
        'item_faturavel',
        '83760001',
        "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em) VALUES (?, ?, 'procedimento', ?, ?)",
        ['83760001', `PROCEDIMENTO SINTETICO ${P}`, ids['grupo'], agora],
      );
      ids['tipoAud'] = await g(
        'tipo_auditoria',
        P,
        "INSERT INTO tipo_auditoria (codigo, descricao, categoria, criado_em) VALUES (?, ?, 'medica', ?)",
        [P, `TIPO AUDITORIA SINTETICO ${P}`, agora],
      );
      ids['motivoGlosa'] = await garantir(
        e,
        'SELECT id FROM motivo_glosa WHERE codigo_tuss = ?',
        [P],
        "INSERT INTO motivo_glosa (codigo_tuss, descricao, vigencia_inicio, versao_fonte, criado_em) VALUES (?, ?, '2020-01-01', 'teste', ?)",
        [P, `MOTIVO GLOSA SINTETICO ${P}`, agora],
      );
      const setor = (c: string, tipo: string) =>
        g(
          'setor_tramite',
          c,
          'INSERT INTO setor_tramite (codigo, descricao, tipo, criado_em) VALUES (?, ?, ?, ?)',
          [c, `SETOR SINTETICO ${c}`, tipo, agora],
        );
      ids['setorFat'] = await setor(`${P}FAT`, 'faturamento');
      ids['setorAud'] = await setor(`${P}AUD`, 'auditoria');
      // Sem a numeração configurada: o primeiro protocolo do estabelecimento a cria (começa em 1).
      await e.executar(
        "DELETE FROM sequencia_negocio WHERE estabelecimento_id = ? AND tipo = 'protocolo_tramite'",
        [ids['est']],
      );
      ids['motivoPend'] = await g(
        'motivo_pendencia_guia',
        P,
        'INSERT INTO motivo_pendencia_guia (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [P, `MOTIVO PENDENCIA SINTETICO ${P}`, agora],
      );
      const carater = await e.uma<{ id: number }>(
        'SELECT id FROM carater_atendimento_tiss ORDER BY id LIMIT 1',
        [],
      );
      const medico = await e.uma<{ id: number }>('SELECT id FROM profissional ORDER BY id LIMIT 1', []);
      ids['atendimento'] = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id, carater_atendimento_tiss_id,
           fonte_pagadora_id, profissional_id, situacao, entrada_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto', '2026-01-20 08:00:00', ?)`,
        [
          ids['est'],
          `${P}-AT`,
          ids['paciente'],
          ids['categoria'],
          Number(carater!.id),
          ids['fonte'],
          Number(medico!.id),
          agora,
        ],
      );
      ids['conta'] = await e.inserir(
        `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
           tipo_conta_id, natureza, competencia, inicio_em, valor_itens, valor_total, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, 'internacao', '2026-01-01', '2026-01-20 08:00:00', 400, 400, ?)`,
        [ids['est'], `${P}-C1`, ids['atendimento'], ids['paciente'], ids['fonte'], ids['tipoConta'], agora],
      );
      const item = (seq: number, qtd: number, total: number) =>
        e.inserir(
          `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, grupo_faturamento_id,
             realizado_em, quantidade, valor_unitario, valor_honorario, valor_custo_operacional, valor_total, situacao, criado_em)
           VALUES (?, ?, ?, ?, '2026-01-21 10:00:00', ?, ?, 0, ?, ?, 'lancado', ?)`,
          [ids['conta'], seq, ids['itemFat'], ids['grupo'], qtd, total / qtd, total, total, agora],
        );
      ids['i1'] = await item(1, 4, 200);
      ids['i2'] = await item(2, 1, 100);
      ids['i3'] = await item(3, 1, 60);
      ids['i4'] = await item(4, 2, 40);
      ids['guia'] = await e.inserir(
        `INSERT INTO guia_fonte_pagadora (estabelecimento_id, numero, tipo_guia, paciente_id, atendimento_id,
           fonte_pagadora_id, dias_solicitados, data_solicitacao, situacao, criado_em)
         VALUES (?, ?, 'internacao', ?, ?, ?, 5, '2026-01-20 09:00:00', 'solicitada', ?)`,
        [ids['est'], `${P}-G1`, ids['paciente'], ids['atendimento'], ids['fonte'], agora],
      );
      // Volume de prontuário e documento clínico de OUTRO estabelecimento: o protocolo recusa.
      const tipoDoc = await e.uma<{ id: number }>(
        'SELECT id FROM tipo_documento_arquivo ORDER BY id LIMIT 1',
        [],
      );
      const prof = await e.uma<{ id: number }>('SELECT id FROM profissional ORDER BY id LIMIT 1', []);
      ids['volumeB'] = await e.inserir(
        `INSERT INTO volume_prontuario (estabelecimento_id, paciente_id, tipo_documento_arquivo_id, numero_volume,
           aberto_em, abertura_usuario_id, criado_em) VALUES (?, ?, ?, 1, ?, ?, ?)`,
        [ids['estB'], ids['paciente'], Number(tipoDoc!.id), agora, ids['usuario'], agora],
      );
      ids['documentoB'] = await e.inserir(
        `INSERT INTO documento_emitido (estabelecimento_id, paciente_id, atendimento_id, tipo, profissional_id,
           emitido_em, lancado_em, texto, criado_em) VALUES (?, ?, ?, 'declaracao', ?, ?, ?, ?, ?)`,
        [
          ids['estB'],
          ids['paciente'],
          ids['atendimento'],
          Number(prof!.id),
          agora,
          agora,
          `TEXTO SINTETICO ${P}`,
          agora,
        ],
      );
      ids['arquivo'] = await e.inserir(
        `INSERT INTO arquivo (estabelecimento_id, entidade, entidade_id, finalidade, nome_original, tipo_mime,
           tamanho_bytes, hash_sha256, chave_armazenamento, criado_em)
         VALUES (?, 'guia_fonte_pagadora', ?, 'anexo', 'laudo-sintetico.pdf', 'application/pdf', 1024, ?, ?, ?)`,
        [ids['est'], ids['guia'], 'a'.repeat(64), `teste/${P}/${randomUUID()}.pdf`, agora],
      );
    });
    s = new ServicoAuditoriaTramite(nucleo, null);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await escrever(async (e) => {
      await limpar(e);
      await limparTrilhaDaMassa(e, { ids: [ids['est']!, ids['estB']!] });
    });
    await nucleo.encerrar();
  });

  it('empresa externa: cadastro pelo CNPJ (pessoa jurídica criada), duplicada recusada, desativada', async () => {
    const r = await s.gravar('empresa.cadastrar', op(), {
      cnpj: '11.222.333/0001-81',
      razaoSocial: `${P} AUDITORIA SINTETICA LTDA`,
      nome: `${P} Auditoria`,
      codigo: `${P}EMP`,
    });
    ids['empresa'] = Number(r['id']);
    const [x] = await linhas(
      `SELECT x.nome, x.ativo, p.cnpj FROM empresa_auditoria_externa x JOIN pessoa_juridica p ON p.id = x.pessoa_juridica_id WHERE x.id = ?`,
      [ids['empresa']],
    );
    expect(x).toMatchObject({ cnpj: CNPJ, ativo: 1 });
    expect(
      await codigoDo(
        s.gravar('empresa.cadastrar', op(), { cnpj: CNPJ, razaoSocial: `${P} X`, nome: `${P} X` }),
      ),
    ).toBe('duplicado');
    expect(
      await codigoDo(
        s.gravar('empresa.cadastrar', op(), { cnpj: '11222333000182', razaoSocial: `${P} Y`, nome: 'Y' }),
      ),
    ).toBe('entrada-invalida');
  });

  it('auditoria: abre com retrato antes, parecer por item (refeito na mesma linha), conclui com efeito no valor', async () => {
    expect(
      await codigoDo(s.gravar('auditoria.abrir', op(), { contaId: ids['conta'], modalidade: 'operadora' })),
    ).toBe('entrada-invalida');
    const a = await s.gravar('auditoria.abrir', op(), {
      contaId: ids['conta'],
      modalidade: 'operadora',
      empresaExternaId: ids['empresa'],
    });
    const aud = Number(a['id']);
    expect(a).toMatchObject({ valorOriginal: 400 });
    expect(await codigoDo(s.gravar('auditoria.abrir', op(), { contaId: ids['conta'] }))).toBe(
      'entrada-invalida',
    );
    const [antes] = await linhas(
      "SELECT valor_total_conta, dados FROM auditoria_conta_versao WHERE auditoria_conta_id = ? AND momento = 'antes'",
      [aud],
    );
    expect(Number(antes!['valor_total_conta'])).toBe(400);
    expect(
      (
        (typeof antes!['dados'] === 'string' ? JSON.parse(antes!['dados']) : antes!['dados']) as {
          itens: unknown[];
        }
      ).itens,
    ).toHaveLength(4);

    const parecer = (itemId: number, x: Record<string, unknown>) =>
      s.gravar('auditoria.parecer', op(), { auditoriaId: aud, itemId, ...x });
    await parecer(ids['i1']!, { decisao: 'alterado', quantidadeAceita: 2, justificativa: 'Usou 3' });
    await parecer(ids['i1']!, { decisao: 'alterado', quantidadeAceita: 3, justificativa: 'Usou 3' });
    expect(await codigoDo(parecer(ids['i2']!, { decisao: 'glosado' }))).toBe('entrada-invalida');
    await parecer(ids['i2']!, { decisao: 'glosado', motivoGlosaId: ids['motivoGlosa'], valorAceito: 70 });
    await parecer(ids['i3']!, { decisao: 'excluido', justificativa: 'Lançado em duplicidade' });
    await parecer(ids['i4']!, { decisao: 'mantido' });
    const pareceres = await linhas(
      'SELECT conta_hospitalar_item_id AS item, decisao, quantidade_aceita, valor_aceito, valor_glosa_interna, versao FROM auditoria_conta_item WHERE auditoria_conta_id = ? ORDER BY sequencia',
      [aud],
    );
    expect(pareceres).toHaveLength(4);
    expect(pareceres[0]).toMatchObject({ decisao: 'alterado', versao: 2 });
    expect(Number(pareceres[0]!['valor_aceito'])).toBe(150);
    expect(Number(pareceres[1]!['valor_glosa_interna'])).toBe(30);

    const tela = await ler((l, est) => auditoriaItensPropria(l, est, ids['conta']!));
    expect(tela.auditoria).toMatchObject({ id: aud, modalidade: 'operadora' });
    expect(tela.itens.filter((i) => i.parecer)).toHaveLength(4);

    // Item lançado depois da abertura: fora do retrato "antes" e sem parecer, a conclusão é recusada (nunca conta como
    // mantido sem ter sido visto); com o parecer, entra no valor auditado.
    ids['i5'] = await escrever((e) =>
      e.inserir(
        `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, grupo_faturamento_id,
           realizado_em, quantidade, valor_unitario, valor_honorario, valor_custo_operacional, valor_total, situacao, criado_em)
         VALUES (?, 5, ?, ?, '2026-01-22 10:00:00', 1, 10, 0, 10, 10, 'lancado', ?)`,
        [ids['conta'], ids['itemFat'], ids['grupo'], new Date()],
      ),
    );
    expect(await codigoDo(s.gravar('auditoria.concluir', op(), { auditoriaId: aud }))).toBe(
      'item-sem-parecer',
    );
    await parecer(ids['i5']!, { decisao: 'mantido' });
    const fim = await s.gravar('auditoria.concluir', op(), { auditoriaId: aud });
    // Itens hoje: 200 + 100 + 60 + 40 + 10 = 410; - 50 (alterado) - 30 (glosa) - 60 (excluído) = 270, igual ao total
    // refeito da conta.
    expect(fim).toMatchObject({ resultado: 'com_glosa_interna', valorAuditado: 270, totalConta: 270 });
    const itens = await linhas(
      'SELECT id, quantidade, valor_total, situacao FROM conta_hospitalar_item WHERE conta_hospitalar_id = ? ORDER BY sequencia',
      [ids['conta']],
    );
    expect(itens.map((i) => [Number(i['quantidade']), Number(i['valor_total']), i['situacao']])).toEqual([
      [3, 150, 'lancado'],
      [1, 70, 'lancado'],
      [1, 0, 'sem_cobranca'], // excluído: fica com a quantidade lançada, sem cobrança
      [2, 40, 'lancado'],
      [1, 10, 'lancado'],
    ]);
    const [conta] = await linhas('SELECT valor_total FROM conta_hospitalar WHERE id = ?', [ids['conta']]);
    expect(Number(conta!['valor_total'])).toBe(270);
    const [cab] = await linhas(
      'SELECT situacao, resultado, valor_auditado, valor_glosa_interna, concluida_em FROM auditoria_conta WHERE id = ?',
      [aud],
    );
    expect(cab).toMatchObject({ situacao: 'concluida', resultado: 'com_glosa_interna' });
    expect(Number(cab!['valor_glosa_interna'])).toBe(140);
    expect(Number(cab!['valor_auditado'])).toBe(Number(conta!['valor_total']));
    const mem = await linhas(
      `SELECT COUNT(*) AS n FROM conta_hospitalar_item_memoria m JOIN conta_hospitalar_item i ON i.id = m.conta_hospitalar_item_id
        WHERE i.conta_hospitalar_id = ? AND JSON_VALUE(m.dados, '$.origem') = 'auditoria'`,
      [ids['conta']],
    );
    expect(Number(mem[0]!['n'])).toBe(3);
    const [depois] = await linhas(
      "SELECT valor_total_conta FROM auditoria_conta_versao WHERE auditoria_conta_id = ? AND momento = 'depois'",
      [aud],
    );
    expect(Number(depois!['valor_total_conta'])).toBe(270);
    expect(await codigoDo(s.gravar('auditoria.concluir', op(), { auditoriaId: aud }))).toBe(
      'auditoria-encerrada',
    );
  });

  it('auditoria cancelada: nenhum item muda', async () => {
    const a = await s.gravar('auditoria.abrir', op(), { contaId: ids['conta'] });
    await s.gravar('auditoria.parecer', op(), {
      auditoriaId: a['id'],
      itemId: ids['i4'],
      decisao: 'excluido',
      justificativa: 'teste',
    });
    await s.gravar('auditoria.cancelar', op(), { auditoriaId: a['id'], motivo: 'Aberta por engano' });
    const [c] = await linhas('SELECT situacao, cancelada_em FROM auditoria_conta WHERE id = ?', [a['id']]);
    expect(c!['situacao']).toBe('cancelada');
    const [i4] = await linhas('SELECT valor_total, situacao FROM conta_hospitalar_item WHERE id = ?', [
      ids['i4'],
    ]);
    expect(i4).toMatchObject({ situacao: 'lancado' });
    expect(Number(i4!['valor_total'])).toBe(40);
  });

  it('protocolo: o item é achado pelo número de negócio, só no estabelecimento da sessão', async () => {
    const conta = await ler((l, est) => alvosProtocoloPropria(l, est, 'conta', `${P}-C1`));
    expect(conta.itens).toEqual([expect.objectContaining({ id: ids['conta'], tipo: 'conta' })]);
    const at = await ler((l, est) => alvosProtocoloPropria(l, est, 'atendimento', `${P}-AT`));
    expect(at.itens.map((i) => i.id)).toEqual([ids['atendimento']]);
    expect((await ler((l, est) => alvosProtocoloPropria(l, est, 'conta', `${P}-NADA`))).itens).toEqual([]);
    const [pac] = await linhas('SELECT numero_prontuario FROM paciente WHERE id = ?', [ids['paciente']]);
    const volumes = await ler((l, est) =>
      alvosProtocoloPropria(l, est, 'volume_prontuario', String(pac!['numero_prontuario'])),
    );
    expect(volumes.itens.map((i) => i.id)).not.toContain(ids['volumeB']);
    expect(() => entradaBuscaAlvo('conta', "1' OR '1")).toThrow();
    expect(() => entradaBuscaAlvo('outro', '1')).toThrow();
  });

  it('protocolo: emitido e enviado com número, conferido em parte, depois recebido; aberto cancelado', async () => {
    expect(
      await codigoDo(
        s.gravar('protocolo.emitir', op(), {
          remetenteId: ids['setorFat'],
          destinatarioId: ids['setorFat'],
          itens: [],
        }),
      ),
    ).toBe('entrada-invalida');
    const p = await s.gravar('protocolo.emitir', op(), {
      remetenteId: ids['setorFat'],
      destinatarioId: ids['setorAud'],
      itens: [
        { tipo: 'conta', alvoId: ids['conta'] },
        { tipo: 'documento', descricao: 'Relatório médico em papel' },
      ],
    });
    expect(p).toMatchObject({ itens: 2, numero: 1 });
    const [seq] = await linhas(
      "SELECT proximo_valor FROM sequencia_negocio WHERE estabelecimento_id = ? AND tipo = 'protocolo_tramite'",
      [ids['est']],
    );
    expect(Number(seq!['proximo_valor'])).toBe(2);
    for (const item of [
      { tipo: 'volume_prontuario', alvoId: ids['volumeB'] },
      { tipo: 'documento', alvoId: ids['documentoB'] },
    ])
      expect(
        await codigoDo(
          s.gravar('protocolo.emitir', op(), {
            remetenteId: ids['setorFat'],
            destinatarioId: ids['setorAud'],
            itens: [item],
          }),
        ),
      ).toBe('nao-encontrado');
    const [cab] = await linhas(
      'SELECT situacao, tipo_conteudo, enviado_em FROM protocolo_tramite WHERE id = ?',
      [p['id']],
    );
    expect(cab).toMatchObject({ situacao: 'enviado', tipo_conteudo: 'misto' });
    const itens = await linhas(
      'SELECT id FROM protocolo_tramite_item WHERE protocolo_tramite_id = ? ORDER BY sequencia',
      [p['id']],
    );
    const [it1, it2] = itens.map((i) => Number(i['id']));
    expect(
      await codigoDo(s.gravar('protocolo.cancelar', op(), { protocoloId: p['id'], motivo: 'teste' })),
    ).toBe('situacao-invalida');
    expect(
      await codigoDo(
        s.gravar('protocolo.conferir', op(), {
          protocoloId: p['id'],
          itens: [{ itemId: it1, recebido: false }],
        }),
      ),
    ).toBe('entrada-invalida');
    const r1 = await s.gravar('protocolo.conferir', op(), {
      protocoloId: p['id'],
      itens: [{ itemId: it1, recebido: true }],
    });
    expect(r1).toMatchObject({ situacao: 'recebido_parcial' });
    const r2 = await s.gravar('protocolo.conferir', op(), {
      protocoloId: p['id'],
      itens: [{ itemId: it2, recebido: false, motivoRecusa: 'Documento ilegível' }],
    });
    expect(r2).toMatchObject({ situacao: 'recebido' });
    const fim = await linhas(
      'SELECT recebido, recusado, motivo_recusa FROM protocolo_tramite_item WHERE protocolo_tramite_id = ? ORDER BY sequencia',
      [p['id']],
    );
    expect(fim).toEqual([
      { recebido: 1, recusado: 0, motivo_recusa: null },
      { recebido: 0, recusado: 1, motivo_recusa: 'Documento ilegível' },
    ]);
    const aberto = await s.gravar('protocolo.emitir', op(), {
      remetenteId: ids['setorAud'],
      destinatarioId: ids['setorFat'],
      enviarJa: false,
      itens: [{ tipo: 'conta', alvoId: ids['conta'] }],
    });
    await s.gravar('protocolo.cancelar', op(), { protocoloId: aberto['id'], motivo: 'Lote refeito' });
    const tela = await ler((l, est) => protocolosPropria(l, est, ids['setorAud']!));
    expect(tela.protocolos.map((x) => x.situacao).sort()).toEqual(['cancelado', 'recebido']);
    expect(tela.protocolos.find((x) => x.situacao === 'recebido')!.itens[0]!.rotulo).toBe(`Conta ${P}-C1`);
  });

  it('guia: pendência leva a pendente e volta à situação anterior; responsável, anexo e autorização com histórico', async () => {
    const g = ids['guia']!;
    const p1 = await s.gravar('guia.pendencia.abrir', op(), {
      guiaId: g,
      motivoId: ids['motivoPend'],
      descricao: 'Falta laudo',
    });
    const p2 = await s.gravar('guia.pendencia.abrir', op(), { guiaId: g, motivoId: ids['motivoPend'] });
    const [g1] = await linhas(
      'SELECT situacao, motivo_pendencia_guia_id FROM guia_fonte_pagadora WHERE id = ?',
      [g],
    );
    expect(g1).toMatchObject({ situacao: 'pendente' });
    expect(
      await codigoDo(s.gravar('guia.responder', op(), { guiaId: g, resposta: 'autorizada', senha: 'S1' })),
    ).toBe('entrada-invalida');
    // Negada ou em análise também esperam as pendências: a guia não sai de "pendente" com pendência aberta.
    for (const resposta of ['negada', 'em_analise'])
      expect(
        await codigoDo(
          s.gravar('guia.responder', op(), { guiaId: g, resposta, motivoNegacao: 'Sem cobertura' }),
        ),
      ).toBe('entrada-invalida');
    const [gp] = await linhas(
      'SELECT situacao, motivo_pendencia_guia_id FROM guia_fonte_pagadora WHERE id = ?',
      [g],
    );
    expect(gp).toMatchObject({ situacao: 'pendente', motivo_pendencia_guia_id: ids['motivoPend'] });
    const fila = await ler((l, est) =>
      guiasConvenioPropria(l, est, { situacao: null, minhas: false, usuario: null }),
    );
    expect(fila.find((x) => x.id === g)).toMatchObject({
      paciente: `PACIENTE SINTETICO ${P}`,
      prontuario: 837_601,
      atendimentoId: ids['atendimento'],
      pendencias: 2,
    });
    const filaCc = await ler((l, est) =>
      guiasConvenioPropria(l, est, { situacao: null, minhas: false, usuario: null, cirurgia: true }),
    );
    expect(filaCc.find((x) => x.id === g)).toBeUndefined();
    await s.gravar('guia.pendencia.resolver', op(), { pendenciaId: p1['id'], solucao: 'Laudo anexado' });
    const [g2] = await linhas('SELECT situacao FROM guia_fonte_pagadora WHERE id = ?', [g]);
    expect(g2!['situacao']).toBe('pendente');
    const r = await s.gravar('guia.pendencia.resolver', op(), {
      pendenciaId: p2['id'],
      solucao: 'Resolvido',
    });
    expect(r).toMatchObject({ situacaoGuia: 'solicitada' });
    await s.gravar('guia.responsavel', op(), { guiaId: g, responsavelId: null });
    await s.gravar('guia.anexo', op(), { guiaId: g, arquivoId: ids['arquivo'], tipoDocumento: 'laudo' });
    expect(await codigoDo(s.gravar('guia.responder', op(), { guiaId: g, resposta: 'negada' }))).toBe(
      'entrada-invalida',
    );
    await s.gravar('guia.responder', op(), {
      guiaId: g,
      resposta: 'autorizada_parcial',
      numeroOperadora: 'OP123',
      senha: 'S1',
      diasAutorizados: 3,
    });
    const [g3] = await linhas(
      'SELECT situacao, senha, numero_guia_operadora, dias_autorizados, responsavel_usuario_id, data_autorizacao FROM guia_fonte_pagadora WHERE id = ?',
      [g],
    );
    expect(g3).toMatchObject({
      situacao: 'autorizada_parcial',
      senha: 'S1',
      numero_guia_operadora: 'OP123',
      dias_autorizados: 3,
      responsavel_usuario_id: ids['usuario'],
    });
    const pend = await linhas(
      'SELECT situacao, resolvido_por_usuario_id FROM guia_pendencia WHERE guia_fonte_pagadora_id = ?',
      [g],
    );
    expect(
      pend.every(
        (x) => x['situacao'] === 'resolvida' && Number(x['resolvido_por_usuario_id']) === ids['usuario'],
      ),
    ).toBe(true);
    const tela = await ler((l, est) => guiaAcompanhamentoPropria(l, est, g));
    expect(tela.anexos).toHaveLength(1);
    expect(tela.historico.map((h) => h.evento)).toEqual([
      'resposta',
      'anexo',
      'responsavel',
      'pendencia_resolvida',
      'pendencia_resolvida',
      'pendencia_aberta',
      'pendencia_aberta',
    ]);
  });
});
